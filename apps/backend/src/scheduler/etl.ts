import 'dotenv/config';
import { getPool } from '../config/database.js';
import { fetchJustJoin } from '../scrapers/justjoin.js';
import { fetchNoFluff } from '../scrapers/nofluff.js';
import { scoreJob } from '../ai/ollama.js';
import { sendJobAlert } from '../bot/telegram.js';
import type { Job } from '@pl-jobhunter/shared';

async function mergeJob(job: Job): Promise<boolean> {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    // MERGE: insert only if id doesn't exist
    const result = await conn.execute(
      `MERGE INTO jobs dst
       USING (SELECT :id AS id FROM dual) src
       ON (dst.id = src.id)
       WHEN NOT MATCHED THEN INSERT (
         id, title, company, url, source,
         salary_b2b_min, salary_b2b_max,
         salary_uop_min, salary_uop_max,
         currency, status, created_at
       ) VALUES (
         :id, :title, :company, :url, :source,
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
        salary_b2b_min: job.salary_b2b_min,
        salary_b2b_max: job.salary_b2b_max,
        salary_uop_min: job.salary_uop_min,
        salary_uop_max: job.salary_uop_max,
        currency: job.currency,
        status: job.status,
        created_at: job.created_at,
      },
      { autoCommit: true }
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
  whyGood: string
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
      { autoCommit: true }
    );
  } finally {
    await conn.close();
  }
}

export async function runEtl(): Promise<void> {
  console.log('[ETL] Starting run at', new Date().toISOString());

  let jobs: Job[];
  try {
    const [jjJobs, nfJobs] = await Promise.all([fetchJustJoin(), fetchNoFluff()]);
    jobs = [...jjJobs, ...nfJobs];
    console.log(`[ETL] Fetched ${jobs.length} jobs (JJ: ${jjJobs.length}, NF: ${nfJobs.length})`);
  } catch (err) {
    console.error('[ETL] Scraper error — aborting:', err);
    process.exitCode = 1;
    return;
  }

  let inserted = 0;
  let scored = 0;
  const threshold = Number(process.env.ALERT_SCORE_THRESHOLD ?? 80);

  for (const job of jobs) {
    let wasInserted: boolean;
    try {
      wasInserted = await mergeJob(job);
    } catch (err) {
      console.error('[ETL] DB unreachable, aborting ETL:', err);
      process.exitCode = 1;
      return;
    }

    if (!wasInserted) continue;
    inserted++;

    const analysis = await scoreJob(job);
    if (!analysis) {
      console.warn(`[ETL] Ollama unavailable for job ${job.id} — persisted without score`);
      continue;
    }

    try {
      await persistAnalysis(
        job.id,
        analysis.match_score,
        analysis.summary,
        analysis.tech_stack,
        analysis.why_good
      );
      scored++;

      if (analysis.match_score >= threshold) {
        await sendJobAlert(job, analysis.match_score);
      }
    } catch (err) {
      console.warn(`[ETL] Failed to persist analysis for ${job.id}:`, err);
    }
  }

  console.log(`[ETL] Done — inserted: ${inserted}, scored: ${scored}`);
}

if (process.argv.includes('--run-once')) {
  runEtl().then(() => process.exit(process.exitCode ?? 0));
}
