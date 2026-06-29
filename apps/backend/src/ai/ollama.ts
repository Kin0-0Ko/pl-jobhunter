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

const PROFILE_KEYWORDS = [
  'typescript', 'javascript', 'node.js', 'nodejs', 'nestjs', 'nest',
  'express', 'react', 'next.js', 'nextjs', 'redux',
  'postgresql', 'postgres', 'mongodb', 'mongo', 'redis',
  'rabbitmq', 'typeorm', 'aws', 'docker',
  'github actions', 'ci/cd', 'cicd',
  'fullstack', 'full-stack', 'full stack',
  'backend', 'frontend', 'devops',
  'software engineer', 'software developer', 'web developer', 'developer',
];

// Jobs matching these title keywords are deterministically scored 0 — no Ollama call
const NEGATIVE_KEYWORDS = [
  'java ', 'java,', 'java/', '(java)', ' java)',  // java but not javascript
  '.net', 'dotnet', 'c# ', 'c#,', 'c#/',
  'python', 'django', 'flask',
  'php', 'laravel', 'symfony',
  'ruby', 'rails',
  'scala', 'kotlin', 'golang', ' go ',
  'rust developer', 'rust engineer',
  'ios developer', 'ios engineer', 'swift developer',
  'android developer', 'android engineer',
  'data engineer', 'data scientist', 'ml engineer', 'machine learning',
  'embedded', 'firmware', 'fpga',
  'sap ', 'salesforce', 'dynamics',
  'qa engineer', 'qa tester', 'test engineer', 'tester',
  'pracownik', 'produkcji', 'magazyn', 'kierowca', 'spawacz',
];

export function isRelevantJob(job: Job): boolean {
  if (PROFILE_KEYWORDS.length === 0) {
    logger.warn('isRelevantJob: keyword list empty, passing all jobs');
    return true;
  }
  const haystack = [job.title, job.description ?? ''].join(' ').toLowerCase();
  return PROFILE_KEYWORDS.some(kw => haystack.includes(kw));
}

export function isNegativeJob(job: Job): boolean {
  const haystack = [job.title, job.description ?? ''].join(' ').toLowerCase();
  return NEGATIVE_KEYWORDS.some(kw => haystack.includes(kw));
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
  const descSection = job.description
    ? `\n\nJob description:\n${job.description.slice(0, 1500)}`
    : '';

  return `Score job-profile match. Return JSON only.

User skills: ${userProfile}

Job title: ${job.title}
Company: ${job.company}${descSection}

Rules:
- match_score: 0-100 integer. Base it on skill overlap between user skills and job title/description.
- If job needs Java, .NET, C#, Python, PHP, Ruby, Scala, Kotlin — score 0-15 max (user has none).
- If job needs TypeScript, JavaScript, Node.js, React — score 60-100 based on seniority fit.
- tech_stack: list only technologies explicitly named in the job title or description. Empty array if none visible.
- summary: one sentence, describe the role factually.

Return this exact JSON:
{"match_score": <integer>, "summary": "<string>", "tech_stack": [<strings>]}`;
}

async function callOllama(prompt: string): Promise<OllamaScoreResult | null> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL ?? 'qwen3:5b';

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, format: 'json', stream: false, options: { num_predict: 400 } }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

  const data = (await res.json()) as { response: string };
  const parsed = JSON.parse(data.response) as OllamaScoreResult;

  if (
    typeof parsed.match_score !== 'number' ||
    typeof parsed.summary !== 'string' ||
    !Array.isArray(parsed.tech_stack)
  ) {
    throw new Error('Ollama response missing required fields');
  }

  // Oracle CLOB treats '' as NULL — use single space as non-null placeholder
  parsed.why_good = parsed.why_good || ' ';

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
