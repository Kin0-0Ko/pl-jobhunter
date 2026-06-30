import 'dotenv/config';
import { randomUUID } from 'crypto';
import pino from 'pino';
import oracledb from 'oracledb';
import { getPool } from '../config/database.js';
import { fetchJustJoin, fetchJustJoinDetail } from '../scrapers/justjoin.js';
import { fetchNoFluff } from '../scrapers/nofluff.js';
import { fetchTheProtocol } from '../scrapers/theprotocol.js';
import { fetchRocketJobs } from '../scrapers/rocketjobs.js';
import { scoreJob, isRelevantJob, isNegativeJob, getFilterProfile } from '../ai/ollama.js';
import { sendCriticalAlert, sendOllamaWarning } from '../bot/telegram.js';
import * as etlState from './etl-state.js';
import type { TopJobEntry } from './etl-state.js';
export type { ETLRunSummary, TopJobEntry } from './etl-state.js';
import type { Job } from '@pl-jobhunter/shared';

function formatSalaryShort(
  b2bMin: number | null, b2bMax: number | null,
  uopMin: number | null, uopMax: number | null,
  currency: string,
): string | null {
  const fmt = (min: number | null, max: number | null, label: string): string | null => {
    if (min == null && max == null) return null;
    const lo = min != null ? `${Math.round(min / 1000)}k` : null;
    const hi = max != null ? `${Math.round(max / 1000)}k` : null;
    const range = [lo, hi].filter(Boolean).join('–');
    return `${range} ${currency} (${label})`;
  };
  return fmt(b2bMin, b2bMax, 'B2B') ?? fmt(uopMin, uopMax, 'UoP');
}

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

async function mergeRawJob(job: Job): Promise<void> {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      `MERGE INTO raw_jobs dst
       USING (SELECT :id AS id FROM dual) src
       ON (dst.id = src.id)
       WHEN NOT MATCHED THEN INSERT (
         id, title, company, url, source, description,
         salary_b2b_min, salary_b2b_max,
         salary_uop_min, salary_uop_max,
         currency, created_at
       ) VALUES (
         :id, :title, :company, :url, :source, :description,
         :salary_b2b_min, :salary_b2b_max,
         :salary_uop_min, :salary_uop_max,
         :currency, :created_at
       )`,
      {
        id: job.id,
        title: job.title,
        company: job.company,
        url: job.url,
        source: job.source,
        description: job.description ?? null,
        salary_b2b_min: job.salary_b2b_min,
        salary_b2b_max: job.salary_b2b_max,
        salary_uop_min: job.salary_uop_min,
        salary_uop_max: job.salary_uop_max,
        currency: job.currency,
        created_at: new Date(job.created_at),
      },
      { autoCommit: true },
    );
  } finally {
    await conn.close();
  }
}

async function mergeJob(job: Job): Promise<boolean> {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    const result = await conn.execute(
      `MERGE INTO jobs dst
       USING (SELECT :id AS id FROM dual) src
       ON (dst.id = src.id)
       WHEN NOT MATCHED THEN INSERT (
         id, title, company, url, source, description,
         salary_b2b_min, salary_b2b_max,
         salary_uop_min, salary_uop_max,
         currency, status, created_at
       ) VALUES (
         :id, :title, :company, :url, :source, :description,
         :salary_b2b_min, :salary_b2b_max,
         :salary_uop_min, :salary_uop_max,
         :currency, :status, :created_at
       )`,
      {
        id: job.id,
        title: job.title,
        company: job.company,
        url: job.url,
        source: job.source,
        description: job.description ?? null,
        salary_b2b_min: job.salary_b2b_min,
        salary_b2b_max: job.salary_b2b_max,
        salary_uop_min: job.salary_uop_min,
        salary_uop_max: job.salary_uop_max,
        currency: job.currency,
        status: job.status,
        created_at: new Date(job.created_at),
      },
      { autoCommit: true },
    );
    return (result.rowsAffected ?? 0) > 0;
  } finally {
    await conn.close();
  }
}

async function persistAnalysis(
  jobId: string,
  score: number,
  summary: string,
  techStack: string[],
  whyGood: string | null,
): Promise<void> {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      `MERGE INTO ai_analysis dst
       USING (SELECT :job_id AS job_id FROM dual) src
       ON (dst.job_id = src.job_id)
       WHEN MATCHED THEN UPDATE SET
         match_score = :match_score, summary = :summary,
         tech_stack = :tech_stack, why_good = :why_good
       WHEN NOT MATCHED THEN INSERT (job_id, match_score, summary, tech_stack, why_good)
       VALUES (:job_id, :match_score, :summary, :tech_stack, :why_good)`,
      {
        job_id: jobId,
        match_score: score,
        summary,
        tech_stack: JSON.stringify(techStack),
        why_good: whyGood,
      },
      { autoCommit: true },
    );
  } finally {
    await conn.close();
  }
}

async function checkAnalysisExists(jobId: string): Promise<boolean> {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    const result = await conn.execute<[number, string | null]>(
      `SELECT COUNT(*), MAX(tech_stack) FROM ai_analysis WHERE job_id = :job_id`,
      { job_id: jobId },
      {
        outFormat: oracledb.OUT_FORMAT_ARRAY,
        fetchInfo: { TECH_STACK: { type: oracledb.STRING } },
      },
    );
    const row = result.rows?.[0];
    if (!row || (row[0] as number) === 0) return false;
    // Re-score if tech_stack is empty array or null (scored before detail-fetch fix)
    const techStack = row[1];
    if (!techStack) return false;
    try {
      const parsed = JSON.parse(techStack) as unknown;
      if (Array.isArray(parsed) && parsed.length === 0) return false;
    } catch {
      return false;
    }
    return true;
  } finally {
    await conn.close();
  }
}

export async function runEtl(): Promise<void> {
  if (etlState.isRunning) {
    logger.warn('[ETL] Already running — skipping duplicate trigger');
    return;
  }
  etlState.setRunning(true);

  const etl_run_id = randomUUID();
  logger.info({ etl_run_id }, '[ETL] Starting run');

  // Reset accumulator for this run
  const runInsertedJobs: Array<{ job: Job; score: number; stack: string[] }> = [];

  try {
    const jobs: Job[] = [];

    const scrapers: Array<{ name: string; fn: () => Promise<Job[]> }> = [
      { name: 'justjoin', fn: fetchJustJoin },
      { name: 'nofluff', fn: fetchNoFluff },
      { name: 'theprotocol', fn: fetchTheProtocol },
      { name: 'rocketjobs', fn: fetchRocketJobs },
    ];

    const counts: Record<string, number> = {};
    for (const { name, fn } of scrapers) {
      try {
        const results = await fn();
        counts[name] = results.length;
        jobs.push(...results);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn({ etl_run_id, scraper: name, err: error.message }, '[ETL] Scraper failed — continuing');
        counts[name] = 0;
      }
    }

    logger.info({ etl_run_id, total: jobs.length, ...counts }, '[ETL] Fetched jobs');

    const filterProfile = await getFilterProfile();
    const hasPrefs = Object.keys(filterProfile).length > 0;
    if (hasPrefs) {
      logger.info({ etl_run_id, filterProfile }, '[ETL] Filter profile resolved');
    } else {
      logger.info({ etl_run_id }, '[ETL] Filter profile: no preferences configured — all seniority/experience filters inactive');
    }

    let inserted = 0;
    let scored = 0;
    let filtered = 0;
    let fallback = 0;
    const threshold = Number(process.env.ALERT_SCORE_THRESHOLD ?? 80);
    const chunkSize = Math.max(1, Number(process.env.ETL_CHUNK_SIZE ?? 50));
    const total = jobs.length;

    for (let chunkStart = 0; chunkStart < total; chunkStart += chunkSize) {
      const chunk = jobs.slice(chunkStart, chunkStart + chunkSize);
      const chunkIndex = Math.floor(chunkStart / chunkSize) + 1;
      logger.info({ etl_run_id, chunk: chunkIndex, chunkSize: chunk.length, processed: chunkStart, total }, '[ETL] Processing chunk');

      for (let job of chunk) {
        try {
          // Step 1: persist all scraped jobs to raw_jobs staging table
          try {
            await mergeRawJob(job);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            logger.warn({ etl_run_id, job_id: job.id, err: error.message }, '[ETL] raw_jobs insert failed — skipping job');
            continue;
          }

          // Step 2: pre-filter — only promote relevant dev jobs
          const relevance = isRelevantJob(job, filterProfile);
          if (!relevance.pass) {
            logger.debug({ etl_run_id, job_id: job.id, title: job.title, reason: relevance.reason }, '[ETL] Pre-filter: blocked');
            filtered++;
            continue;
          }
          if (relevance.reason === 'wildcard') {
            logger.info({ etl_run_id, job_id: job.id, title: job.title }, '[ETL] Pre-filter: wildcard pass (cross-training)');
          }

          // Step 2b: enrich JustJoin jobs with full description from v1 detail API
          if (job.source === 'justjoin' && (!job.description || job.description.startsWith('[category:'))) {
            const slug = job.url.replace('https://justjoin.it/offers/', '');
            const detail = await fetchJustJoinDetail(slug);
            if (detail) {
              job = { ...job, description: detail };
              logger.debug({ etl_run_id, job_id: job.id }, '[ETL] JJ detail fetched');
            }
          }

          // Step 3: promote to jobs table
          let wasInserted: boolean;
          try {
            wasInserted = await mergeJob(job);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            logger.error({ etl_run_id, job_id: job.id, err: error.message }, '[ETL] DB error — aborting');
            await sendCriticalAlert('oracle', error);
            process.exitCode = 1;
            return;
          }

          if (wasInserted) {
            inserted++;
          } else {
            // Job already exists — skip if it already has a valid analysis row
            const hasAnalysis = await checkAnalysisExists(job.id);
            if (hasAnalysis) continue;
            logger.info({ etl_run_id, job_id: job.id }, '[ETL] Existing job missing analysis — re-scoring');
          }

          // Step 4: negative blocklist — persist score 0 without Ollama call
          if (isNegativeJob(job)) {
            logger.info({ etl_run_id, job_id: job.id, title: job.title }, '[ETL] Negative-list: score 0, skip Ollama');
            try {
              await persistAnalysis(job.id, 0, job.title, [], null);
              scored++;
            } catch (err) {
              logger.warn({ etl_run_id, job_id: job.id, err: String(err) }, '[ETL] Failed to persist negative analysis');
            }
            continue;
          }

          // Step 5: score via Ollama — scoreJob always returns a record (fallback on failure)
          const analysis = await scoreJob(job);
          const isFallback = analysis.match_score === -1;

          if (isFallback) {
            await sendOllamaWarning(job.id, new Error('scoreJob returned fallback'));
            fallback++;
          }

          try {
            await persistAnalysis(job.id, analysis.match_score, analysis.summary, analysis.tech_stack, analysis.why_good);
            scored++;
            logger.info({ etl_run_id, job_id: job.id, match_score: analysis.match_score, fallback: isFallback }, '[ETL] Scored job');

            if (!isFallback && wasInserted) {
              runInsertedJobs.push({ job, score: analysis.match_score, stack: analysis.tech_stack });
            }
          } catch (err) {
            logger.warn({ etl_run_id, job_id: job.id, err: String(err) }, '[ETL] Failed to persist analysis');
          }
        } catch (jobErr) {
          // Per-item isolation: one job's unexpected error must not abort the chunk
          logger.warn({ etl_run_id, job_id: job.id, err: String(jobErr) }, '[ETL] Unexpected per-job error — continuing');
        }
      }
    }

    const topJobs: TopJobEntry[] = runInsertedJobs
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ job, score, stack }) => ({
        id: job.id,
        title: job.title,
        company: job.company,
        url: job.url,
        salaryDisplay: formatSalaryShort(job.salary_b2b_min, job.salary_b2b_max, job.salary_uop_min, job.salary_uop_max, job.currency),
        score,
        stack,
      }));

    etlState.setLastRunSummary({ completedAt: new Date(), rawTotal: total, filtered, inserted, scored, fallback, topJobs });

    logger.info({ etl_run_id, rawTotal: total, filtered, inserted, scored, fallback }, '[ETL] Run complete');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ etl_run_id, err: error.message }, '[ETL] Unexpected error');
    await sendCriticalAlert('etl-orchestrator', error);
    process.exitCode = 1;
  } finally {
    etlState.setRunning(false);
  }
}

if (process.argv.includes('--run-once')) {
  runEtl().then(() => process.exit(process.exitCode ?? 0));
}
