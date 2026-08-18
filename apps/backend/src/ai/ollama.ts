import type { Job } from '@pl-jobhunter/shared';
import oracledb from 'oracledb';
import pino from 'pino';
import pLimit from 'p-limit';
import OpenAI from 'openai';
import { repairAndParse, repairAndParseLoose } from './json-repair.js';
import { getPool } from '../config/database.js';

// Hard cap: 1 concurrent Ollama request to protect 1 GB RAM constraint on Oracle Always Free
const ollamaLimit = pLimit(1);
// Cloud NVIDIA path has no local RAM constraint, but the endpoint rate-limits aggressively.
// Concurrency alone does not pace requests — see nvidiaThrottle below for the min-interval gate.
const nvidiaLimit = pLimit(Number(process.env.NVIDIA_CONCURRENCY ?? 2));

// Minimum gap between two NVIDIA calls. Concurrency caps in-flight requests; this caps *rate*,
// which is what a 429 is actually complaining about.
const NVIDIA_MIN_INTERVAL_MS = 1100;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Serialises the *start* of NVIDIA calls so they are spaced at least NVIDIA_MIN_INTERVAL_MS apart. */
let nvidiaNextSlot = 0;
async function nvidiaThrottle(): Promise<void> {
  if (NVIDIA_MIN_INTERVAL_MS <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, nvidiaNextSlot);
  nvidiaNextSlot = slot + NVIDIA_MIN_INTERVAL_MS;
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

interface HttpErrorShape {
  status?: number;
  headers?: Record<string, string> | undefined;
}

/** True for errors where waiting actually helps: rate limits and transient server faults. */
export function isRetryableAIError(err: unknown): boolean {
  const status = (err as HttpErrorShape)?.status;
  if (status === undefined) return true; // network/abort errors — worth one more go
  return status === 429 || status === 408 || status >= 500;
}

/** Honours a numeric `Retry-After` (seconds) when the provider sends one. */
export function retryAfterMs(err: unknown): number | null {
  const raw = (err as HttpErrorShape)?.headers?.['retry-after'];
  if (raw === undefined) return null;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : null;
}

const AI_MAX_ATTEMPTS = 4;
const AI_BACKOFF_BASE_MS = 500;

/**
 * Calls the AI provider with exponential backoff + jitter on retryable failures.
 * Replaces the previous retry-immediately-once pattern, which re-hit 429s within ~1.5s
 * and burned whole ETL runs into -1 fallbacks.
 */
async function callAIWithRetry(prompt: string, numPredict: number, label: string, jobId?: string): Promise<string> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS; attempt++) {
    try {
      return await callAIRaw(prompt, numPredict);
    } catch (err) {
      lastErr = err;
      const status = (err as HttpErrorShape)?.status;

      if (!isRetryableAIError(err) || attempt === AI_MAX_ATTEMPTS) {
        logger.error({ err, job_id: jobId, attempt, status }, `[ETL] ${label}: giving up`);
        throw err;
      }

      // Exponential backoff with full jitter, unless the provider told us how long to wait.
      const backoff = AI_BACKOFF_BASE_MS * 2 ** (attempt - 1);
      const delay = retryAfterMs(err) ?? Math.round(backoff * (0.5 + Math.random() * 0.5));
      logger.warn({ err, job_id: jobId, attempt, status, delay }, `[ETL] ${label}: retryable AI error, backing off`);
      await sleep(delay);
    }
  }

  throw lastErr;
}

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

    if (!res.ok) {
      // Attach the status so isRetryableAIError can tell a 429/5xx from an unfixable 4xx.
      // The OpenAI SDK does this for the NVIDIA path; plain fetch does not.
      const err = new Error(`Ollama error: ${res.status}`) as Error & { status: number; headers: Record<string, string> };
      err.status = res.status;
      err.headers = Object.fromEntries(res.headers);
      throw err;
    }
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
  if (provider === 'nvidia') {
    return nvidiaLimit(async () => {
      await nvidiaThrottle();
      return callNvidiaRaw(prompt, numPredict);
    });
  }
  return ollamaLimit(() => callOllamaRaw(prompt, numPredict));
}

async function callPass1(job: Job): Promise<Pass1Result | null> {
  const prompt = buildPass1Prompt(job);
  let raw: string;
  try {
    raw = await callAIWithRetry(prompt, 250, 'pass1', job.id);
  } catch {
    return null;
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
    raw = await callAIWithRetry(prompt, 50, 'pass2', jobId);
  } catch {
    return -1;
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

const AI_BATCH_SIZE = 8;
const LOW_RELEVANCE_SCORE = 5;

interface BatchPrescreenEntry {
  i: number;
  summary?: string;
  tech_stack?: string[];
  relevant?: string;
}

function buildBatchPrescreenPrompt(jobs: Job[]): string {
  const entries = jobs
    .map((job, i) => {
      const desc = job.description ? job.description.slice(0, SCORING_DESC_MAX_CHARS) : '';
      return `[${i}] Title: ${job.title}\nCompany: ${job.company}${desc ? `\nPosting:\n${desc}` : ''}`;
    })
    .join('\n\n');

  return `For each job below, extract metadata and judge whether it could plausibly interest the candidate profile (be generous — only mark "no" for jobs clearly unrelated to software development). Output ONLY a valid JSON array, no markdown.

${entries}

Return exactly one entry per job, in this shape: [{"i":<index>,"summary":"<one sentence: what the company builds or needs>","tech_stack":[<only technologies explicitly named in posting, empty array if none>],"relevant":"yes"|"maybe"|"no"}]`;
}

function buildBatchScorePrompt(entries: Array<{ i: number; summary: string; tech_stack: string[] }>, userProfile: string): string {
  const list = entries
    .map(e => `[${e.i}] Role: ${e.summary}\nTechnologies required: ${e.tech_stack.length > 0 ? e.tech_stack.join(', ') : 'not specified'}`)
    .join('\n\n');

  return `Score candidate fit for each job below against the candidate profile. Output ONLY a valid JSON array, no markdown.

Candidate skills: ${userProfile}

${list}

Scoring guide: 90-100=almost every required technology matches; 70-89=most match; 50-69=partial match; 30-49=few match; 0-29=almost nothing matches.
Be strict. Only score high if required technologies explicitly match candidate skills.

Return exactly one entry per job, in this shape: [{"i":<index>,"match_score":<integer 0-100>}]`;
}

function parseJsonArrayLoose(raw: string): Record<string, unknown>[] | null {
  const stripped = raw
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const v = JSON.parse(stripped.slice(start, end + 1)) as unknown;
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

async function callBatchPrescreen(jobs: Job[]): Promise<Map<number, BatchPrescreenEntry> | null> {
  const prompt = buildBatchPrescreenPrompt(jobs);
  const numPredict = 200 * jobs.length + 200;
  let raw: string;
  try {
    raw = await callAIWithRetry(prompt, numPredict, 'batch prescreen');
  } catch {
    return null;
  }

  const arr = parseJsonArrayLoose(raw);
  if (!arr) {
    logger.warn('[ETL] batch prescreen: JSON parse failed');
    return null;
  }

  const map = new Map<number, BatchPrescreenEntry>();
  for (const entry of arr) {
    const i = typeof entry['i'] === 'number' ? entry['i'] : NaN;
    if (!Number.isFinite(i)) continue;
    map.set(i, {
      i,
      summary: typeof entry['summary'] === 'string' ? entry['summary'] : undefined,
      tech_stack: Array.isArray(entry['tech_stack']) ? (entry['tech_stack'] as string[]) : undefined,
      relevant: typeof entry['relevant'] === 'string' ? entry['relevant'] : undefined,
    });
  }
  return map;
}

async function callBatchScore(entries: Array<{ i: number; summary: string; tech_stack: string[] }>, userProfile: string): Promise<Map<number, number> | null> {
  const prompt = buildBatchScorePrompt(entries, userProfile);
  const numPredict = 30 * entries.length + 100;
  let raw: string;
  try {
    raw = await callAIWithRetry(prompt, numPredict, 'batch score');
  } catch {
    return null;
  }

  const arr = parseJsonArrayLoose(raw);
  if (!arr) {
    logger.warn('[ETL] batch score: JSON parse failed');
    return null;
  }

  const map = new Map<number, number>();
  for (const entry of arr) {
    const i = typeof entry['i'] === 'number' ? entry['i'] : NaN;
    if (!Number.isFinite(i)) continue;
    const score = entry['match_score'];
    if (typeof score !== 'number' && typeof score !== 'string') continue;
    map.set(i, normalizeScore(score));
  }
  return map;
}

// Batched prescreen + score: replaces per-job keyword/negative filters with model judgment.
// Every job reaches the model; "no" verdicts get a low deterministic score instead of being dropped,
// so nothing is silently lost — it just ranks at the bottom. Falls back to per-job scoreJob on
// malformed batch JSON so a single bad model response can't sink a whole chunk.
export async function scoreJobsBatch(jobs: Job[], profile?: string): Promise<Map<string, OllamaScoreResult>> {
  const results = new Map<string, OllamaScoreResult>();
  if (jobs.length === 0) return results;

  let userProfile: string;
  if (profile !== undefined) {
    userProfile = profile;
  } else {
    const dbProfile = await getProfileFromDb();
    userProfile = dbProfile ?? (process.env.OLLAMA_USER_PROFILE ?? 'TypeScript/Node.js developer, remote, B2B');
  }

  for (let start = 0; start < jobs.length; start += AI_BATCH_SIZE) {
    const batch = jobs.slice(start, start + AI_BATCH_SIZE);
    const prescreen = await callBatchPrescreen(batch);

    if (!prescreen) {
      // Fall back to the reliable per-job path for this batch
      logger.warn({ batchSize: batch.length }, '[ETL] batch prescreen failed — falling back to per-job scoring');
      await Promise.all(
        batch.map(async job => {
          results.set(job.id, await scoreJob(job, userProfile));
        }),
      );
      continue;
    }

    const survivors: Array<{ job: Job; i: number; summary: string; tech_stack: string[] }> = [];
    batch.forEach((job, i) => {
      const entry = prescreen.get(i);
      if (!entry || !entry.summary) {
        // Missing from model output — fallback, will be retried next run
        results.set(job.id, buildFallbackRecord());
        return;
      }

      const summaryOk = !entry.summary.includes('<') && entry.summary.trim().length >= 20;
      const summary = summaryOk ? entry.summary : job.title;
      let techStack = entry.tech_stack ?? [];
      if (techStack.length === 1 && (techStack[0] ?? '').includes(',')) {
        techStack = (techStack[0] ?? '').split(',').map(s => s.trim()).filter(Boolean);
      }

      if (entry.relevant === 'no') {
        results.set(job.id, {
          match_score: summaryOk ? LOW_RELEVANCE_SCORE : -1,
          summary,
          tech_stack: techStack,
          why_good: null,
        });
        return;
      }

      if (!summaryOk) {
        results.set(job.id, { match_score: -1, summary, tech_stack: techStack, why_good: null });
        return;
      }

      survivors.push({ job, i, summary, tech_stack: techStack });
    });

    if (survivors.length === 0) continue;

    const scoreMap = await callBatchScore(survivors.map(s => ({ i: s.i, summary: s.summary, tech_stack: s.tech_stack })), userProfile);

    if (!scoreMap) {
      logger.warn({ batchSize: survivors.length }, '[ETL] batch score failed — falling back to per-job scoring');
      await Promise.all(
        survivors.map(async s => {
          results.set(s.job.id, await scoreJob(s.job, userProfile));
        }),
      );
      continue;
    }

    for (const s of survivors) {
      const score = scoreMap.get(s.i);
      results.set(s.job.id, {
        match_score: score ?? -1,
        summary: s.summary,
        tech_stack: s.tech_stack,
        why_good: null,
      });
    }
  }

  return results;
}
