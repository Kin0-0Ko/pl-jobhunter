import pino from 'pino';
import { getPool } from '../config/database.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/** Rows older than this many days are purged. Override with RETENTION_DAYS. */
const DEFAULT_RETENTION_DAYS = 30;

export interface RetentionResult {
  jobsDeleted: number;
  rawJobsDeleted: number;
  cutoffDays: number;
}

function resolveRetentionDays(): number {
  const raw = process.env.RETENTION_DAYS;
  if (raw === undefined) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn({ RETENTION_DAYS: raw }, 'retention: invalid RETENTION_DAYS, falling back to default');
    return DEFAULT_RETENTION_DAYS;
  }
  return Math.floor(parsed);
}

/**
 * Deletes jobs and raw_jobs whose created_at is older than the retention window.
 * ai_analysis rows follow their job via ON DELETE CASCADE (fk_job).
 * Runs in a single transaction so a mid-purge failure leaves the DB untouched.
 */
export async function runRetention(): Promise<RetentionResult> {
  const cutoffDays = resolveRetentionDays();
  const pool = await getPool();
  const conn = await pool.getConnection();

  try {
    const jobsRes = await conn.execute(
      `DELETE FROM jobs WHERE created_at < (SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY'))`,
      { days: cutoffDays },
      { autoCommit: false },
    );

    const rawRes = await conn.execute(
      `DELETE FROM raw_jobs WHERE created_at < (SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY'))`,
      { days: cutoffDays },
      { autoCommit: false },
    );

    await conn.commit();

    const result: RetentionResult = {
      jobsDeleted: jobsRes.rowsAffected ?? 0,
      rawJobsDeleted: rawRes.rowsAffected ?? 0,
      cutoffDays,
    };
    logger.info(result, 'retention: purge complete');
    return result;
  } catch (err) {
    // Never let a rollback failure mask the original error.
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, 'retention: rollback failed');
    }
    throw err;
  } finally {
    await conn.close();
  }
}
