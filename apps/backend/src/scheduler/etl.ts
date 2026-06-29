import 'dotenv/config';
import { randomUUID } from 'crypto';
import pino from 'pino';
import { getPool } from '../config/database.js';
import { fetchJustJoin } from '../scrapers/justjoin.js';
import { fetchNoFluff } from '../scrapers/nofluff.js';
import { fetchTheProtocol } from '../scrapers/theprotocol.js';
import { fetchRocketJobs } from '../scrapers/rocketjobs.js';
import { scoreJob, isRelevantJob } from '../ai/ollama.js';
import { sendJobAlert, sendCriticalAlert, sendOllamaWarning } from '../bot/telegram.js';
import type { Job } from '@pl-jobhunter/shared';

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
  whyGood: string,
): Promise<void> {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      `MERGE INTO ai_analysis dst
       USING (SELECT :job_id AS job_id FROM dual) src
       ON (dst.job_id = src.job_id)
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

export async function runEtl(): Promise<void> {
  const etl_run_id = randomUUID();
  logger.info({ etl_run_id }, '[ETL] Starting run');

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

    let inserted = 0;
    let scored = 0;
    let filtered = 0;
    const threshold = Number(process.env.ALERT_SCORE_THRESHOLD ?? 80);

    for (const job of jobs) {
      // Step 1: persist all scraped jobs to raw_jobs staging table
      try {
        await mergeRawJob(job);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn({ etl_run_id, job_id: job.id, err: error.message }, '[ETL] raw_jobs insert failed — skipping job');
        continue;
      }

      // Step 2: pre-filter — only promote relevant dev jobs
      if (!isRelevantJob(job)) {
        logger.debug({ etl_run_id, job_id: job.id, title: job.title }, '[ETL] Pre-filter: blocked irrelevant job');
        filtered++;
        continue;
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

      if (!wasInserted) continue;
      inserted++;

      // Step 4: score via Ollama
      let analysis;
      try {
        analysis = await scoreJob(job);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn({ etl_run_id, job_id: job.id, err: error.message }, '[ETL] Ollama threw — persisting without score');
        await sendOllamaWarning(job.id, error);
        continue;
      }

      if (!analysis) {
        const error = new Error('scoreJob returned null');
        logger.warn({ etl_run_id, job_id: job.id }, '[ETL] Ollama returned null — persisting without score');
        await sendOllamaWarning(job.id, error);
        continue;
      }

      try {
        await persistAnalysis(job.id, analysis.match_score, analysis.summary, analysis.tech_stack, analysis.why_good);
        scored++;
        logger.info({ etl_run_id, job_id: job.id, match_score: analysis.match_score }, '[ETL] Scored job');

        if (analysis.match_score >= threshold) {
          await sendJobAlert(job, analysis.match_score);
        }
      } catch (err) {
        logger.warn({ etl_run_id, job_id: job.id, err: String(err) }, '[ETL] Failed to persist analysis');
      }
    }

    logger.info({ etl_run_id, rawTotal: jobs.length, filtered, inserted, scored }, '[ETL] Run complete');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ etl_run_id, err: error.message }, '[ETL] Unexpected error');
    await sendCriticalAlert('etl-orchestrator', error);
    process.exitCode = 1;
  }
}

if (process.argv.includes('--run-once')) {
  runEtl().then(() => process.exit(process.exitCode ?? 0));
}
