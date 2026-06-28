import 'dotenv/config';
import pino from 'pino';
import { getPool, closePool } from './database.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const CREATE_JOBS = `
  CREATE TABLE jobs (
    id VARCHAR2(100) PRIMARY KEY,
    title VARCHAR2(255) NOT NULL,
    company VARCHAR2(255) NOT NULL,
    url VARCHAR2(500) NOT NULL,
    source VARCHAR2(50) NOT NULL,
    salary_b2b_min NUMBER,
    salary_b2b_max NUMBER,
    salary_uop_min NUMBER,
    salary_uop_max NUMBER,
    currency VARCHAR2(10) DEFAULT 'PLN',
    status VARCHAR2(50) DEFAULT 'NEW',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_AI_ANALYSIS = `
  CREATE TABLE ai_analysis (
    job_id VARCHAR2(100) PRIMARY KEY,
    match_score NUMBER NOT NULL,
    summary CLOB NOT NULL,
    tech_stack CLOB NOT NULL,
    why_good CLOB NOT NULL,
    CONSTRAINT fk_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )
`;

const CREATE_USER_PROFILE = `
  CREATE TABLE user_profile (
    id NUMBER DEFAULT 1 NOT NULL,
    skills CLOB NOT NULL,
    resume_text CLOB,
    preferred_contract VARCHAR2(10) DEFAULT 'both' NOT NULL,
    search_preferences CLOB,
    updated_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_user_profile PRIMARY KEY (id),
    CONSTRAINT chk_contract CHECK (preferred_contract IN ('b2b','uop','both'))
  )
`;

async function runStatement(conn: import('oracledb').Connection, sql: string, label: string): Promise<void> {
  try {
    await conn.execute(sql);
    logger.info({ table: label }, 'init-db: created table');
  } catch (err: unknown) {
    const ora = err as { errorNum?: number; message?: string };
    if (ora.errorNum === 955) {
      logger.info({ table: label }, 'init-db: table already exists, skipping');
    } else {
      throw err;
    }
  }
}

async function main(): Promise<void> {
  try {
    const pool = await getPool();
    const conn = await pool.getConnection();
    try {
      await runStatement(conn, CREATE_JOBS, 'jobs');
      await runStatement(conn, CREATE_AI_ANALYSIS, 'ai_analysis');
      await runStatement(conn, CREATE_USER_PROFILE, 'user_profile');
      await conn.commit();
      logger.info('init-db: schema initialization complete');
    } finally {
      await conn.close();
    }
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string };
    const msg = e.message ?? '';
    const isConnErr =
      msg.includes('wallet') ||
      msg.includes('TNS') ||
      msg.includes('ORA-12') ||
      msg.includes('NJS-') ||
      msg.includes('connectString') ||
      msg.includes('credentials') ||
      e.code === 'ERR_ORACLEDB_NO_CREDENTIALS';
    if (isConnErr) {
      logger.warn('init-db: cannot connect to Oracle DB — wallet may be missing or credentials unset. Set DB_USER, DB_PASSWORD, DB_CONNECTION_STRING, TNS_ADMIN in .env');
    } else {
      logger.error({ err }, 'init-db: unexpected error');
      process.exit(1);
    }
  } finally {
    await closePool();
  }
}

main();
