import type { Job } from '@pl-jobhunter/shared';
import oracledb from 'oracledb';
import pino from 'pino';
import pLimit from 'p-limit';
import { repairAndParse } from './json-repair.js';
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

const FIRST_PERSON_RE =
  /\b(I am|I'm|I have|I've|I can|I will|I would|my (?:background|experience|skills))\b/i;

export function isFirstPersonInverted(summary: string): boolean {
  return FIRST_PERSON_RE.test(summary);
}

export function normalizeScore(n: unknown): number {
  const num = typeof n === 'number' ? n : Number(n);
  if (!isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function buildFallbackRecord(): OllamaScoreResult {
  return {
    match_score: -1,
    summary: 'Analysis unavailable — pending manual review',
    tech_stack: [],
    why_good: ' ',
  };
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

const SENIOR_TITLE_KEYWORDS = ['senior', 'lead', 'principal', 'staff', 'architect'];
const JUNIOR_MID_SENIORITY = new Set(['junior', 'mid', 'trainee', 'intern']);

const CROSS_TRAINING_PHRASES = [
  'no previous', 'no prior', 'willing to cross-train', 'cross-train',
  'we can teach', 'open to retraining', 'we will train', 'can teach you',
];

const EXPERIENCE_RE = /(\d+)\+?\s*(?:years?|lata?|lat)\s*(?:of\s+)?(?:experience|doświadczenia)?/gi;

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

export function isRelevantJob(
  job: Job,
  profile?: { target_seniority?: string[]; max_experience_years?: number },
): { pass: boolean; reason?: string } {
  const titleLower = job.title.toLowerCase();
  const descLower = (job.description ?? '').toLowerCase();

  // 1. Seniority check on title
  const seniority = profile?.target_seniority ?? [];
  if (
    seniority.length > 0 &&
    seniority.every(s => JUNIOR_MID_SENIORITY.has(s.toLowerCase())) &&
    SENIOR_TITLE_KEYWORDS.some(kw => titleLower.includes(kw))
  ) {
    return { pass: false, reason: 'seniority' };
  }

  // 2. Cross-training wildcard (short-circuits experience + keyword checks)
  if (job.description && CROSS_TRAINING_PHRASES.some(p => descLower.includes(p))) {
    return { pass: true, reason: 'wildcard' };
  }

  // 3. Experience check on description
  const maxExp = profile?.max_experience_years;
  if (job.description && typeof maxExp === 'number') {
    const matches = [...job.description.matchAll(EXPERIENCE_RE)];
    if (matches.length > 0) {
      const maxFound = Math.max(...matches.map(m => parseInt(m[1] ?? '0', 10)));
      if (maxFound > maxExp) {
        return { pass: false, reason: 'experience' };
      }
    }
  }

  // 4. Keyword check (existing logic)
  if (PROFILE_KEYWORDS.length === 0) {
    logger.warn('isRelevantJob: keyword list empty, passing all jobs');
    return { pass: true };
  }
  const haystack = [job.title, job.description ?? ''].join(' ').toLowerCase();
  if (!PROFILE_KEYWORDS.some(kw => haystack.includes(kw))) {
    return { pass: false, reason: 'keyword' };
  }

  return { pass: true };
}

export function isNegativeJob(job: Job): boolean {
  const haystack = [job.title, job.description ?? ''].join(' ').toLowerCase();
  return NEGATIVE_KEYWORDS.some(kw => haystack.includes(kw));
}

export interface FilterProfile {
  target_seniority?: string[];
  max_experience_years?: number;
}

export async function getFilterProfile(): Promise<FilterProfile> {
  const pool = await getPool().catch((dbErr: unknown) => {
    logger.warn(
      { err: dbErr instanceof Error ? dbErr.message : String(dbErr) },
      '[ETL] getFilterProfile: DB pool error — applying safe default {}',
    );
    return null;
  });
  if (!pool) return {};

  const conn = await pool.getConnection();
  try {
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT skills, preferred_contract, search_preferences FROM user_profile WHERE id = 1`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    if (!row) return {};

    // Oracle OUT_FORMAT_OBJECT returns uppercase keys; tolerate both
    const raw = (row['SEARCH_PREFERENCES'] ?? row['search_preferences']) as string | null | undefined;
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const profile: FilterProfile = {};
      if (Array.isArray(parsed.target_seniority)) {
        profile.target_seniority = parsed.target_seniority as string[];
      }
      if (typeof parsed.max_experience_years === 'number') {
        profile.max_experience_years = parsed.max_experience_years;
      }
      return profile;
    } catch (parseErr) {
      logger.warn(
        { raw, err: parseErr instanceof Error ? parseErr.message : String(parseErr) },
        '[ETL] getFilterProfile: SEARCH_PREFERENCES is present but failed JSON.parse — applying safe default {}',
      );
      return {};
    }
  } catch (dbErr) {
    logger.warn(
      { err: dbErr instanceof Error ? dbErr.message : String(dbErr) },
      '[ETL] getFilterProfile: DB error — applying safe default {}',
    );
    return {};
  } finally {
    await conn.close().catch(() => undefined);
  }
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
    ? `\n\nJob posting:\n${job.description.slice(0, 1500)}`
    : '';

  return `You are a metadata extraction tool. Extract facts about what the company requires.
Do NOT write in first person. Never say "I am", "I have", or "I can".
Output ONLY valid JSON. No markdown, no <think> tags, no explanation text.

User skills: ${userProfile}
Job: ${job.title} at ${job.company}${descSection}

Extract these fields about the COMPANY's requirements:
- match_score: integer 0-100 (how well user skills match this posting)
- summary: one sentence describing what the company seeks, written in third person
- tech_stack: array of technology strings explicitly named in the posting (empty array if none)

Return exactly: {"match_score":<int>,"summary":"<string>","tech_stack":[<strings>]}`;
}

async function callOllama(prompt: string): Promise<OllamaScoreResult> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:0.5b';

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, format: 'json', stream: false, options: { num_predict: 400 } }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

  const data = (await res.json()) as { response: string };

  const repairResult = repairAndParse(data.response);
  if (!repairResult.ok) {
    logger.warn({ reason: repairResult.reason }, '[ETL] callOllama: JSON repair failed — returning fallback');
    return buildFallbackRecord();
  }

  const { value } = repairResult;

  const rawSummary = value.summary?.trim() ?? '';
  if (isFirstPersonInverted(rawSummary)) {
    logger.warn('[ETL] callOllama: first-person inversion detected — returning fallback');
    return buildFallbackRecord();
  }

  return {
    match_score: normalizeScore(value.match_score),
    summary: rawSummary || 'Metadata extraction failed - pending manual review',
    tech_stack: Array.isArray(value.tech_stack) ? value.tech_stack : [],
    why_good: ' ',
  };
}

export async function scoreJob(job: Job): Promise<OllamaScoreResult> {
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
      logger.error({ err: retryErr }, 'ollama retry failed — returning fallback');
      return buildFallbackRecord();
    }
  }
}
