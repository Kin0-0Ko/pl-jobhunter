import 'dotenv/config';
import { randomUUID } from 'crypto';
import pino from 'pino';
import oracledb from 'oracledb';
import { getPool } from '../config/database.js';
import { fetchJustJoin, fetchJustJoinDetail } from '../scrapers/justjoin.js';
import { fetchNoFluff } from '../scrapers/nofluff.js';
import { fetchTheProtocol } from '../scrapers/theprotocol.js';
import { fetchRocketJobs } from '../scrapers/rocketjobs.js';
import { scoreJob, isRelevantJob, isNegativeJob, getFilterProfile, getProfileFromDb, SCORING_DESC_MAX_CHARS } from '../ai/ollama.js';
import { sendCriticalAlert, sendOllamaWarning, sendNewJobAlert } from '../bot/telegram.js';
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

// C3/H1: WHEN MATCHED UPDATE persists enriched descriptions and changed salary.
// Guards: description only replaced when incoming is non-null AND stored is null/stub.
// Salary: NVL semantics — never clobber a known value with null.
// status/created_at/id/title/company/url/source/currency are insert-only.
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
       )
       WHEN MATCHED THEN UPDATE SET
         description = CASE
           WHEN :description IS NOT NULL AND (
             dst.description IS NULL OR dst.description LIKE '[category:%'
           ) THEN :description
           ELSE NVL(:description, dst.description)
         END,
         salary_b2b_min = NVL(:salary_b2b_min, dst.salary_b2b_min),
         salary_b2b_max = NVL(:salary_b2b_max, dst.salary_b2b_max),
         salary_uop_min = NVL(:salary_uop_min, dst.salary_uop_min),
         salary_uop_max = NVL(:salary_uop_max, dst.salary_uop_max)`,
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
    const result = await conn.execute<[number, number | null]>(
      `SELECT COUNT(*), MAX(match_score) FROM ai_analysis WHERE job_id = :job_id`,
      { job_id: jobId },
      { outFormat: oracledb.OUT_FORMAT_ARRAY },
    );
    const row = result.rows?.[0];
    if (!row || (row[0] as number) === 0) return false;
    const score = row[1];
    // Only consider scored when match_score is a real value (>=0); -1 means fallback/failed
    return typeof score === 'number' && score >= 0;
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

  const runInsertedJobs: Array<{ job: Job; score: number; stack: string[] }> = [];

  try {
    // M2: Read profile once per run and thread into scoreJob
    const filterProfile = await getFilterProfile();
    const hasPrefs = Object.keys(filterProfile).length > 0;
    if (hasPrefs) {
      logger.info({ etl_run_id, filterProfile }, '[ETL] Filter profile resolved');
    } else {
      logger.info({ etl_run_id }, '[ETL] Filter profile: no preferences configured');
    }

    // M1: Fetch all sources concurrently — one failure doesn't block others
    const scrapers: Array<{ name: string; fn: () => Promise<Job[]> }> = [
      { name: 'justjoin', fn: fetchJustJoin },
      { name: 'nofluff', fn: fetchNoFluff },
      { name: 'theprotocol', fn: fetchTheProtocol },
      { name: 'rocketjobs', fn: fetchRocketJobs },
    ];

    const scraperResults = await Promise.allSettled(scrapers.map(s => s.fn()));
    const jobs: Job[] = [];
    const counts: Record<string, number> = {};
    for (let i = 0; i < scrapers.length; i++) {
      const name = scrapers[i]!.name;
      const result = scraperResults[i]!;
      if (result.status === 'fulfilled') {
        counts[name] = result.value.length;
        jobs.push(...result.value);
      } else {
        const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        logger.warn({ etl_run_id, scraper: name, err: error.message }, '[ETL] Scraper failed — continuing');
        counts[name] = 0;
      }
    }

    logger.info({ etl_run_id, total: jobs.length, ...counts }, '[ETL] Fetched jobs');

    // Dedup region-variants: same (title, company) appear once per Polish voivodeship on nofluff.
    // Score once, persist once — keep first occurrence (stable sort by id).
    const seenTitleCompany = new Set<string>();
    const dedupedJobs: Job[] = [];
    for (const job of jobs) {
      const key = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
      if (seenTitleCompany.has(key)) continue;
      seenTitleCompany.add(key);
      dedupedJobs.push(job);
    }
    if (dedupedJobs.length < jobs.length) {
      logger.info({ etl_run_id, before: jobs.length, after: dedupedJobs.length }, '[ETL] Deduped region-variants');
    }

    let inserted = 0;
    let scored = 0;
    let filtered = 0;
    let fallback = 0;
    const threshold = Number(process.env.ALERT_SCORE_THRESHOLD ?? 80);
    const chunkSize = Math.max(1, Number(process.env.ETL_CHUNK_SIZE ?? 50));
    // C1: consecutive DB failure counter — reset on success, abort on threshold exceeded
    const dbFailureAbortThreshold = Number(process.env.ETL_DB_FAILURE_ABORT_THRESHOLD ?? 10);
    let consecutiveDbFailures = 0;
    const total = dedupedJobs.length;

    // M2: resolve scoring profile string once for the whole run (not per-job)
    const dbProfile = await getProfileFromDb();
    const runProfile = dbProfile ?? (process.env.OLLAMA_USER_PROFILE ?? 'TypeScript/Node.js developer, remote, B2B');

    for (let chunkStart = 0; chunkStart < total; chunkStart += chunkSize) {
      const chunk = dedupedJobs.slice(chunkStart, chunkStart + chunkSize);
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

          // C2: dedup check BEFORE detail fetch — skip already-complete jobs entirely.
          // Description updates (C3) only matter when we re-score; if analysis is valid, skip.
          const existingValidAnalysis = await checkAnalysisExists(job.id).catch(() => false);
          if (existingValidAnalysis) {
            logger.debug({ etl_run_id, job_id: job.id }, '[ETL] Already stored with valid analysis — skipping');
            continue;
          }

          // Step 2b: enrich JustJoin jobs with full description from v1 detail API
          // Only reached when job is new OR missing valid analysis (C2 gate above)
          if (job.source === 'justjoin' && (!job.description || job.description.startsWith('[category:'))) {
            const slug = job.url.replace('https://justjoin.it/offers/', '');
            const detail = await fetchJustJoinDetail(slug);
            if (detail) {
              job = { ...job, description: detail.slice(0, SCORING_DESC_MAX_CHARS) };
              logger.debug({ etl_run_id, job_id: job.id }, '[ETL] JJ detail fetched');
            }
          }

          // Step 3: promote to jobs table (C3/H1: MERGE now also updates description+salary on match)
          let wasInserted: boolean;
          try {
            wasInserted = await mergeJob(job);
            consecutiveDbFailures = 0; // reset on success
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            consecutiveDbFailures++;
            logger.warn({ etl_run_id, job_id: job.id, err: error.message, consecutiveDbFailures }, '[ETL] DB write failed — skipping job');
            // C1: only abort on sustained failure, not a single blip
            if (consecutiveDbFailures > dbFailureAbortThreshold) {
              logger.error({ etl_run_id, consecutiveDbFailures }, '[ETL] DB failure threshold exceeded — aborting run');
              await sendCriticalAlert('oracle', error);
              return;
            }
            continue;
          }

          if (wasInserted) {
            inserted++;
          } else {
            // Job already existed and is missing valid analysis — re-score it
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

          // Step 5: score via Ollama — M2: pass pre-resolved profile
          const analysis = await scoreJob(job, runProfile);
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
              // Post per-job alert immediately after scoring — only for new jobs above threshold
              if (analysis.match_score >= threshold) {
                await sendNewJobAlert({
                  id: job.id,
                  title: job.title,
                  company: job.company,
                  url: job.url,
                  salaryDisplay: formatSalaryShort(job.salary_b2b_min, job.salary_b2b_max, job.salary_uop_min, job.salary_uop_max, job.currency),
                  score: analysis.match_score,
                  summary: analysis.summary,
                  stack: analysis.tech_stack,
                }).catch(() => undefined);
              }
            }
          } catch (err) {
            logger.warn({ etl_run_id, job_id: job.id, err: String(err) }, '[ETL] Failed to persist analysis');
          }
        } catch (jobErr) {
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
  } finally {
    etlState.setRunning(false);
  }
}

if (process.argv.includes('--run-once')) {
  runEtl().then(() => process.exit(process.exitCode ?? 0));
}
