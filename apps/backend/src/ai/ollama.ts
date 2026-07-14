import type { Job } from '@pl-jobhunter/shared';
import oracledb from 'oracledb';
import pino from 'pino';
import pLimit from 'p-limit';
import OpenAI from 'openai';
import { repairAndParse, repairAndParseLoose } from './json-repair.js';
import { getPool } from '../config/database.js';

// Hard cap: 1 concurrent Ollama request to protect 1 GB RAM constraint on Oracle Always Free
const ollamaLimit = pLimit(1);
// Cloud NVIDIA path has no local RAM constraint — allow higher concurrency, bounded to avoid rate-limit storms
const nvidiaLimit = pLimit(Number(process.env.NVIDIA_CONCURRENCY ?? 5));

// Shared description cap: used by both the JustJoin detail fetch and the Pass-1 prompt slice.
// Keeping them in sync prevents the scored text from being shorter than the fetched text.
export const SCORING_DESC_MAX_CHARS = Number(process.env.SCORING_DESC_MAX_CHARS ?? 2000);

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export interface OllamaScoreResult {
  match_score: number;
  summary: string;
  tech_stack: string[];
  why_good: string | null;
}

const FIRST_PERSON_RE =
  /\b(I am|I'm|I have|I've|I can|I will|I would|my (?:background|experience|skills)|User (?:is|seeks|requires|wants)|Candidate (?:is|has|seeks))\b/i;

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
    why_good: null,
  };
}

const PROFILE_KEYWORDS = [
  // Core stack — must match at least one for the job to be relevant
  'typescript', 'javascript', 'node.js', 'nodejs', 'nestjs', 'nest.js',
  'express', 'react', 'next.js', 'nextjs', 'redux', 'vue', 'angular',
  'postgresql', 'postgres', 'mongodb', 'mongo', 'redis', 'typeorm',
  'rabbitmq', 'graphql', 'rest api', 'restful',
  'docker', 'github actions',
  'fullstack', 'full-stack', 'full stack',
  'software engineer', 'software developer',
  'web developer', 'web engineer', 'frontend developer', 'frontend engineer',
  'backend developer', 'backend engineer',
  'node developer', 'node engineer', 'js developer', 'ts developer',
];

const SENIOR_TITLE_KEYWORDS = ['senior', 'lead', 'principal', 'staff', 'architect', 'expert', 'manager', 'head of', 'director'];
const JUNIOR_MID_SENIORITY = new Set(['junior', 'mid', 'trainee', 'intern']);

const CROSS_TRAINING_PHRASES = [
  'no previous', 'no prior', 'willing to cross-train', 'cross-train',
  'we can teach', 'open to retraining', 'we will train', 'can teach you',
];

const EXPERIENCE_RE = /(\d+)\+?\s*(?:years?|lata?|lat)\s*(?:of\s+)?(?:experience|doświadczenia)?/gi;

// H2: negative keywords matched via word-boundary regex on title only to avoid false positives
// (e.g. ' go ' in "let's go build", 'sap ' in "we sap resources").
// Each entry is a regex fragment; patterns are compiled once at module load.
const NEGATIVE_PATTERNS: RegExp[] = [
  /\bjava\b(?!script)/i,         // java but not javascript
  /\.net\b/i, /\bdotnet\b/i, /\bc#\b/i,
  /\bpython\b/i, /\bdjango\b/i, /\bflask\b/i,
  /\bphp\b/i, /\blaravel\b/i, /\bsymfony\b/i,
  /\bruby\b/i, /\brails\b/i,
  /\bscala\b/i, /\bkotlin\b/i, /\bgolang\b/i, /\bgo\s+developer\b/i, /\bgo\s+engineer\b/i,
  /\brust\s+developer\b/i, /\brust\s+engineer\b/i,
  /\bios\s+developer\b/i, /\bios\s+engineer\b/i, /\bswift\s+developer\b/i,
  /\bandroid\s+developer\b/i, /\bandroid\s+engineer\b/i,
  /\breact\s+native\b/i,
  /\bflutter\b/i, /\bxamarin\b/i,
  /\bdata\s+engineer\b/i, /\bdata\s+scientist\b/i, /\bml\s+engineer\b/i,
  /\bmachine\s+learning\b/i, /\bdata\s+analyst\b/i,
  /\bembedded\b/i, /\bfirmware\b/i, /\bfpga\b/i,
  /\bsap\s+\w/i, /\bsalesforce\b/i, /\bdynamics\b/i, /\bservicenow\b/i,
  /\bpowerbi\b/i, /\bpower\s+bi\b/i, /\btableau\b/i,
  /\bdevops\s+engineer\b/i, /\bdevops\s+specialist\b/i,
  /\bplatform\s+engineer\b/i, /\bsite\s+reliability\b/i, /\bsre\b/i,
  /\bcloud\s+engineer\b/i, /\binfrastructure\s+engineer\b/i,
  /\bpostgresql\s+expert\b/i, /\bdatabase\s+administrator\b/i, /\bdba\b/i,
  /\bqa\s+engineer\b/i, /\bqa\s+tester\b/i, /\btest\s+engineer\b/i,
  /\btester\b/i, /\bautomation\s+engineer\b/i,
  /\bpracownik\b/i, /\bprodukcji\b/i, /\bmagazyn\b/i, /\bkierowca\b/i, /\bspawacz\b/i,
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

// H2: match against title only to avoid incidental substring false-positives in description
export function isNegativeJob(job: Job): boolean {
  const title = job.title;
  return NEGATIVE_PATTERNS.some(re => re.test(title));
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
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        fetchInfo: { SEARCH_PREFERENCES: { type: oracledb.STRING } },
      },
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

export async function getProfileFromDb(): Promise<string | null> {
  try {
    const pool = await getPool();
    const conn = await pool.getConnection();
    try {
      const result = await conn.execute<Record<string, unknown>>(
        `SELECT skills, resume_text, preferred_contract, search_preferences
         FROM user_profile WHERE id = 1`,
        [],
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: {
            SKILLS: { type: oracledb.STRING },
            RESUME_TEXT: { type: oracledb.STRING },
            SEARCH_PREFERENCES: { type: oracledb.STRING },
          },
        },
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

interface Pass1Result {
  summary: string;
  tech_stack: string[];
}

export function buildPass1Prompt(job: Job): string {
  // H4: use shared cap so scored text matches what was fetched
  const desc = job.description ? job.description.slice(0, SCORING_DESC_MAX_CHARS) : '';
  const descSection = desc ? `\n\nPosting:\n${desc}` : '';
  return `Extract metadata from this job posting. Output ONLY valid JSON, no markdown.

Title: ${job.title}
Company: ${job.company}${descSection}

Return exactly: {"summary":"<one sentence: what the company builds or needs>","tech_stack":[<only technologies explicitly named in posting, empty array if none>]}`;
}

function buildPass2Prompt(pass1: Pass1Result, userProfile: string): string {
  const tech = pass1.tech_stack.length > 0 ? pass1.tech_stack.join(', ') : 'not specified';
  return `Score candidate fit. Output ONLY valid JSON, no markdown.

Role: ${pass1.summary}
Technologies required: ${tech}
Candidate skills: ${userProfile}

Scoring guide: 90-100=almost every required technology matches; 70-89=most match; 50-69=partial match; 30-49=few match; 0-29=almost nothing matches.
Be strict. Only score high if required technologies explicitly match candidate skills.

Return exactly: {"match_score":<integer 0-100>}`;
}

async function callOllamaRaw(prompt: string, numPredict: number): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:0.5b';
  // M4: bound each call so a hung model can't stall the whole ETL run
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 60000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, format: 'json', stream: false, options: { num_predict: numPredict, temperature: 0, seed: 42, top_p: 1 } }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = (await res.json()) as { response: string };
    return data.response;
  } finally {
    clearTimeout(timer);
  }
}

let nvidiaClient: OpenAI | null = null;
function getNvidiaClient(): OpenAI {
  if (!nvidiaClient) {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) throw new Error('NVIDIA_API_KEY not set (required when AI_PROVIDER=nvidia)');
    nvidiaClient = new OpenAI({
      apiKey,
      baseURL: process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
    });
  }
  return nvidiaClient;
}

async function callNvidiaRaw(prompt: string, numPredict: number): Promise<string> {
  const model = process.env.NVIDIA_MODEL ?? 'z-ai/glm-5.2';
  const timeoutMs = Number(process.env.NVIDIA_TIMEOUT_MS ?? 60000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const completion = await getNvidiaClient().chat.completions.create(
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        top_p: 1,
        max_tokens: numPredict,
        seed: 42,
        response_format: { type: 'json_object' },
        stream: false,
      },
      { signal: controller.signal },
    );

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('NVIDIA API returned empty content');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

// AI_PROVIDER toggle: 'ollama' (default, local — RAM-bounded via ollamaLimit) or 'nvidia' (cloud, higher concurrency)
function callAIRaw(prompt: string, numPredict: number): Promise<string> {
  const provider = process.env.AI_PROVIDER ?? 'ollama';
  if (provider === 'nvidia') return nvidiaLimit(() => callNvidiaRaw(prompt, numPredict));
  return ollamaLimit(() => callOllamaRaw(prompt, numPredict));
}

async function callPass1(job: Job): Promise<Pass1Result | null> {
  const prompt = buildPass1Prompt(job);
  let raw: string;
  try {
    raw = await callAIRaw(prompt, 250);
  } catch (err) {
    logger.warn({ err, job_id: job.id }, '[ETL] pass1: Ollama HTTP error, retrying');
    try {
      raw = await callAIRaw(prompt, 250);
    } catch (retryErr) {
      logger.error({ err: retryErr, job_id: job.id }, '[ETL] pass1: retry failed');
      return null;
    }
  }

  const result = repairAndParseLoose(raw);
  if (!result.ok) {
    logger.warn({ reason: result.reason, job_id: job.id }, '[ETL] pass1: JSON repair failed');
    return null;
  }

  const v = result.value;
  const rawSummary = typeof v['summary'] === 'string' ? v['summary'].trim() : '';

  if (isFirstPersonInverted(rawSummary)) {
    logger.warn({ job_id: job.id }, '[ETL] pass1: first-person inversion detected');
    return null;
  }

  return {
    summary: rawSummary || `${job.title} at ${job.company}`,
    tech_stack: Array.isArray(v['tech_stack']) ? (v['tech_stack'] as string[]) : [],
  };
}

async function callPass2(pass1: Pass1Result, userProfile: string, jobId: string): Promise<number> {
  const prompt = buildPass2Prompt(pass1, userProfile);
  let raw: string;
  try {
    raw = await callAIRaw(prompt, 50);
  } catch (err) {
    logger.warn({ err, job_id: jobId }, '[ETL] pass2: Ollama HTTP error, retrying');
    try {
      raw = await callAIRaw(prompt, 50);
    } catch (retryErr) {
      logger.error({ err: retryErr, job_id: jobId }, '[ETL] pass2: retry failed');
      return -1;
    }
  }

  const result = repairAndParseLoose(raw);
  if (!result.ok) {
    logger.warn({ reason: result.reason, raw, job_id: jobId }, '[ETL] pass2: JSON repair failed');
    return -1;
  }

  const score = result.value['match_score'];
  if (typeof score !== 'number' && typeof score !== 'string') return -1;
  return normalizeScore(score);
}

// M2: accept pre-resolved profile from runEtl to avoid one DB read per job.
// When profile is omitted (e.g. tests, direct callers), falls back to DB/env as before.
export async function scoreJob(job: Job, profile?: string): Promise<OllamaScoreResult> {
  let userProfile: string;
  if (profile !== undefined) {
    userProfile = profile;
    logger.debug({ source: 'caller' }, 'ollama profile source');
  } else {
    const dbProfile = await getProfileFromDb();
    userProfile = dbProfile ?? (process.env.OLLAMA_USER_PROFILE ?? 'TypeScript/Node.js developer, remote, B2B');
    logger.debug({ source: dbProfile ? 'db' : 'env' }, 'ollama profile source');
  }

  const pass1 = await callPass1(job);
  if (!pass1) {
    logger.warn({ job_id: job.id }, '[ETL] pass1 failed — returning fallback');
    return buildFallbackRecord();
  }

  // Quality guard: reject prompt-echo and too-short summaries
  const summaryOk = !pass1.summary.includes('<') && pass1.summary.trim().length >= 20;
  if (!summaryOk) {
    logger.warn({ job_id: job.id, summary: pass1.summary }, '[ETL] pass1: bad summary — using job.title fallback');
    pass1.summary = job.title;
  }

  // Normalise tech_stack: handle comma-string from model instead of array
  if (pass1.tech_stack.length === 1 && (pass1.tech_stack[0] ?? '').includes(',')) {
    pass1.tech_stack = (pass1.tech_stack[0] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  logger.debug({ job_id: job.id, summary: pass1.summary, tech_stack: pass1.tech_stack }, '[ETL] pass1 complete');

  const matchScore = await callPass2(pass1, userProfile, job.id);
  const finalScore = summaryOk ? matchScore : -1;

  return {
    match_score: finalScore,
    summary: pass1.summary,
    tech_stack: pass1.tech_stack,
    why_good: null,
  };
}
