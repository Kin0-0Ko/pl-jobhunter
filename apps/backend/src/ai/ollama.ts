import type { Job } from '@pl-jobhunter/shared';
import oracledb from 'oracledb';
import pino from 'pino';
import pLimit from 'p-limit';
import { getPool } from '../config/database.js';

// Hard cap: 1 concurrent Ollama request to protect 1 GB RAM constraint on Oracle Always Free
const ollamaLimit = pLimit(1);

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export interface OllamaScoreResult {
  match_score: number;
  summary: string;
  tech_stack: string[];
  why_good: string;
}

async function getProfileFromDb(): Promise<string | null> {
  try {
    const pool = await getPool();
    const conn = await pool.getConnection();
    try {
      const result = await conn.execute<Record<string, unknown>>(
        `SELECT skills, resume_text, preferred_contract, search_preferences
         FROM user_profile WHERE id = 1`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0];
      if (!row) return null;

      const skills = JSON.parse(row['SKILLS'] as string) as string[];
      const parts = [`Skills: ${skills.join(', ')}`];
      if (row['PREFERRED_CONTRACT']) parts.push(`Preferred contract: ${row['PREFERRED_CONTRACT'] as string}`);
      if (row['RESUME_TEXT']) parts.push(`Background: ${row['RESUME_TEXT'] as string}`);
      if (row['SEARCH_PREFERENCES']) parts.push(`Preferences: ${row['SEARCH_PREFERENCES'] as string}`);
      return parts.join('. ');
    } finally {
      await conn.close();
    }
  } catch {
    return null;
  }
}

function buildPrompt(job: Job, userProfile: string): string {
  return `You are a job-match scorer. Given a user profile and a job posting, return a JSON object with these exact fields:
- match_score: integer 0-100
- summary: one sentence describing the role
- tech_stack: array of technology strings mentioned
- why_good: one sentence on why this matches the user

User profile: ${userProfile}

Job: ${job.title} at ${job.company}
URL: ${job.url}
Source: ${job.source}

Respond ONLY with valid JSON, no markdown.`;
}

async function callOllama(prompt: string): Promise<OllamaScoreResult | null> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL ?? 'qwen3:5b';

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, format: 'json', stream: false, options: { num_predict: 200 } }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

  const data = (await res.json()) as { response: string };
  const parsed = JSON.parse(data.response) as OllamaScoreResult;

  if (
    typeof parsed.match_score !== 'number' ||
    typeof parsed.summary !== 'string' ||
    !Array.isArray(parsed.tech_stack) ||
    typeof parsed.why_good !== 'string'
  ) {
    throw new Error('Ollama response missing required fields');
  }

  return parsed;
}

export async function scoreJob(job: Job): Promise<OllamaScoreResult | null> {
  const dbProfile = await getProfileFromDb();
  let userProfile: string;

  if (dbProfile) {
    logger.debug('ollama profile source: db');
    userProfile = dbProfile;
  } else {
    logger.debug('ollama profile source: env fallback');
    userProfile =
      process.env.OLLAMA_USER_PROFILE ??
      'Senior TypeScript developer interested in remote roles';
  }

  const prompt = buildPrompt(job, userProfile);

  try {
    return await ollamaLimit(() => callOllama(prompt));
  } catch (err) {
    logger.warn({ err }, 'ollama first attempt failed, retrying');
    try {
      return await ollamaLimit(() => callOllama(prompt));
    } catch (retryErr) {
      logger.error({ err: retryErr }, 'ollama retry failed');
      return null;
    }
  }
}
