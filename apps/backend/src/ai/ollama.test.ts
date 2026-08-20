import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// Retry/backoff tests run multiple AI_MAX_ATTEMPTS with full exponential backoff (up to
// 500+1000+2000ms per pass, x2 for two-pass) — bump past vitest's 5000ms default for this file.
vi.setConfig({ testTimeout: 15000 });
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { scoreJob, scoreJobsBatch, isFirstPersonInverted, normalizeScore, buildFallbackRecord, SCORING_DESC_MAX_CHARS, buildPass1Prompt } from './ollama.js';
import type { Job } from '@pl-jobhunter/shared';

const server = setupServer();

beforeAll(() => {
  vi.stubEnv('NVIDIA_API_KEY', 'test-key');
  // Tests hit msw mocks, not the real rate-limited endpoint — no need to pace requests.
  vi.stubEnv('NVIDIA_MIN_INTERVAL_MS', '0');
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

const mockJob: Job = {
  id: 'jj-test-1',
  title: 'TypeScript Engineer',
  company: 'Test Corp',
  url: 'https://example.com/job/1',
  source: 'justjoin',
  salary_b2b_min: 15000,
  salary_b2b_max: 22000,
  salary_uop_min: null,
  salary_uop_max: null,
  currency: 'PLN',
  status: 'NEW',
  created_at: new Date().toISOString(),
};

// Two-pass responses: pass1 = {summary, tech_stack}, pass2 = {match_score}
const pass1Response = {
  summary: 'The company builds TypeScript microservices for fintech clients.',
  tech_stack: ['TypeScript', 'Node.js'],
};
const pass2Response = { match_score: 85 };

describe('scoreJob() — two-pass', () => {
  it('returns merged result on both passes succeeding', async () => {
    let callCount = 0;
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({ choices: [{ message: { content: JSON.stringify(pass1Response) } }] });
        return HttpResponse.json({ choices: [{ message: { content: JSON.stringify(pass2Response) } }] });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(85);
    expect(result.summary).toBe(pass1Response.summary);
    expect(result.tech_stack).toContain('TypeScript');
    expect(result.why_good).toBeNull();
    expect(callCount).toBe(2);
  });

  it('returns fallback when pass1 JSON is unrepairable (no pass2 call)', async () => {
    let callCount = 0;
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => {
        callCount++;
        return HttpResponse.json({ choices: [{ message: { content: 'not valid json {{{' } }] });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    expect(callCount).toBe(1); // pass1 fails immediately, no retry (repair handles it), no pass2
  });

  it('retries pass1 with backoff, returns fallback after exhausting attempts', async () => {
    let callCount = 0;
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => {
        callCount++;
        return HttpResponse.json({ error: 'model not loaded' }, { status: 500 });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    // 500 is retryable: AI_MAX_ATTEMPTS attempts on pass1, all fail → fallback, no pass2.
    expect(callCount).toBe(4);
  });

  it('does not retry a non-retryable 400 — retrying cannot fix it', async () => {
    let callCount = 0;
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => {
        callCount++;
        return HttpResponse.json({ error: 'bad request' }, { status: 400 });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    expect(callCount).toBe(1);
  });

  it('pass1 succeeds on retry, then pass2 runs', async () => {
    let callCount = 0;
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({ error: 'timeout' }, { status: 503 });
        if (callCount === 2) return HttpResponse.json({ choices: [{ message: { content: JSON.stringify(pass1Response) } }] });
        return HttpResponse.json({ choices: [{ message: { content: JSON.stringify(pass2Response) } }] });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(85);
    expect(result.summary).toBe(pass1Response.summary);
    expect(callCount).toBe(3); // pass1 fail + pass1 retry OK + pass2
  });

  it('returns pass1 summary with match_score -1 when pass2 fails', async () => {
    let callCount = 0;
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({ choices: [{ message: { content: JSON.stringify(pass1Response) } }] });
        return HttpResponse.json({ error: 'overload' }, { status: 503 });
      })
    );

    const result = await scoreJob(mockJob);
    // pass1 succeeded so we have the real summary, but match_score is -1 from failed pass2
    expect(result.match_score).toBe(-1);
    expect(result.summary).toBe(pass1Response.summary);
    expect(callCount).toBe(5); // 1 successful pass1 + AI_MAX_ATTEMPTS failed pass2 attempts
  });

  it('returns fallback when pass1 summary is first-person inverted', async () => {
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () =>
        HttpResponse.json({ choices: [{ message: { content: JSON.stringify({ summary: 'I am a TypeScript developer seeking remote work.', tech_stack: [] }) } }] })
      )
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
  });
});

// T010: scoreJob fallback contract + normalizeScore + empty summary enforcement
describe('scoreJob() — fallback contract (T010)', () => {
  it('returns fallback record (match_score -1, non-empty summary) when pass1 JSON unrepairable', async () => {
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () =>
        HttpResponse.json({ choices: [{ message: { content: 'not valid json {{{' } }] })
      )
    );
    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    expect(result.summary.trim()).not.toBe('');
  });

  it('returns fallback record when pass1 HTTP errors on both attempts', async () => {
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () =>
        HttpResponse.json({ error: 'server error' }, { status: 500 })
      )
    );
    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    expect(result.summary.trim()).not.toBe('');
  });

  it('uses job title as summary fallback when pass1 returns empty summary string', async () => {
    let callCount = 0;
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({ choices: [{ message: { content: JSON.stringify({ summary: '', tech_stack: [] }) } }] });
        return HttpResponse.json({ choices: [{ message: { content: JSON.stringify({ match_score: 70 }) } }] });
      })
    );
    const result = await scoreJob(mockJob);
    // empty summary → fallback to "title at company"
    expect(result.summary.trim()).not.toBe('');
    expect(result.summary).toContain(mockJob.title);
  });
});

describe('normalizeScore() (T010)', () => {
  it('clamps 150 to 100', () => expect(normalizeScore(150)).toBe(100));
  it('clamps -5 to 0', () => expect(normalizeScore(-5)).toBe(0));
  it('passes 73 through', () => expect(normalizeScore(73)).toBe(73));
  it('coerces numeric string "80"', () => expect(normalizeScore('80')).toBe(80));
  it('returns 0 for NaN', () => expect(normalizeScore(NaN)).toBe(0));
  it('returns 0 for non-numeric', () => expect(normalizeScore('abc')).toBe(0));
  it('sentinel -1 is NOT producible via normalizeScore (returns 0)', () => expect(normalizeScore(-1)).toBe(0));
});

describe('buildFallbackRecord() (T010)', () => {
  it('has match_score -1', () => expect(buildFallbackRecord().match_score).toBe(-1));
  it('has non-empty summary', () => expect(buildFallbackRecord().summary.trim()).not.toBe(''));
  it('has null why_good', () => expect(buildFallbackRecord().why_good).toBeNull());
  it('has empty tech_stack array', () => expect(buildFallbackRecord().tech_stack).toEqual([]));
});

// T018: isFirstPersonInverted (US3)
describe('isFirstPersonInverted() (T018)', () => {
  it('detects "I am"', () => expect(isFirstPersonInverted('I am a TypeScript developer looking for a role')).toBe(true));
  it('detects "I\'m"', () => expect(isFirstPersonInverted("I'm experienced in React")).toBe(true));
  it('detects "I have"', () => expect(isFirstPersonInverted('I have 5 years of Node.js experience')).toBe(true));
  it('detects "I can"', () => expect(isFirstPersonInverted('I can work remotely')).toBe(true));
  it('detects "my background"', () => expect(isFirstPersonInverted('My background includes TypeScript')).toBe(true));
  it('detects "my experience"', () => expect(isFirstPersonInverted('My experience spans 3 years')).toBe(true));
  it('does not flag third-person company summary', () => expect(isFirstPersonInverted('The company seeks a TypeScript developer')).toBe(false));
  it('does not flag "I/O" false positive', () => expect(isFirstPersonInverted('The role involves I/O bound tasks')).toBe(false));
  it('does not flag "I18n" false positive', () => expect(isFirstPersonInverted('Experience with I18n required')).toBe(false));
  it('does not flag empty string', () => expect(isFirstPersonInverted('')).toBe(false));
  it('detects "User seeks"', () => expect(isFirstPersonInverted('User seeks a full-stack developer')).toBe(true));
  it('detects "User is"', () => expect(isFirstPersonInverted('User is a TypeScript developer')).toBe(true));
  it('detects "Candidate is"', () => expect(isFirstPersonInverted('Candidate is a full stack developer with expertise')).toBe(true));
  it('detects "Candidate has"', () => expect(isFirstPersonInverted('Candidate has 5 years of experience')).toBe(true));
  it('does not flag "The company seeks"', () => expect(isFirstPersonInverted('The company seeks a developer')).toBe(false));
  it('does not flag "The role requires"', () => expect(isFirstPersonInverted('The role requires TypeScript experience')).toBe(false));
});

// ─── T017: US5 — H4 Pass-1 prompt uses SCORING_DESC_MAX_CHARS ────────────────

describe('buildPass1Prompt() — H4: uses SCORING_DESC_MAX_CHARS', () => {
  it('includes description text beyond the old 800-char limit up to SCORING_DESC_MAX_CHARS', () => {
    const longDesc = 'A'.repeat(900) + 'UNIQUE_TECH_TOKEN' + 'B'.repeat(100);
    const job: Job = {
      id: 'test', title: 'TS Dev', company: 'Corp', url: 'https://example.com',
      source: 'justjoin', description: longDesc,
      salary_b2b_min: null, salary_b2b_max: null,
      salary_uop_min: null, salary_uop_max: null,
      currency: 'PLN', status: 'NEW', created_at: new Date().toISOString(),
    };
    const prompt = buildPass1Prompt(job);
    expect(prompt).toContain('UNIQUE_TECH_TOKEN');
  });

  it('SCORING_DESC_MAX_CHARS is at least 900 (old 800 cap is superseded)', () => {
    expect(SCORING_DESC_MAX_CHARS).toBeGreaterThanOrEqual(900);
  });
});

// ─── T020: US6 — M4 AbortController timeout ──────────────────────────────────

describe('scoreJob() — M4: AbortController timeout', () => {
  it('rejects within NVIDIA_TIMEOUT_MS when model never responds', async () => {
    vi.stubEnv('NVIDIA_TIMEOUT_MS', '200');

    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', async () => {
        // Never respond — simulate hung model
        await new Promise(() => {});
        return HttpResponse.json({ choices: [{ message: { content: '{}' } }] });
      }),
    );

    const start = Date.now();
    const result = await scoreJob(mockJob);
    const elapsed = Date.now() - start;

    // Call aborted → fallback path → match_score -1
    expect(result.match_score).toBe(-1);
    // Aborts are retryable, so this is 4 × 200ms timeout plus jittered backoff
    // (max 500+1000+2000ms). The point is that it terminates rather than hanging.
    expect(elapsed).toBeLessThan(10000);

    // Un-stub only this test's override — vi.unstubAllEnvs() would also clear the
    // NVIDIA_MIN_INTERVAL_MS='0' stub set in beforeAll, reintroducing real throttling
    // (4000ms default) into every test that runs after this one in the same file.
    vi.stubEnv('NVIDIA_TIMEOUT_MS', '60000');
  });
});

// ─── T021: US6 — M2 scoreJob with explicit profile skips DB read ─────────────

describe('scoreJob() — M2: explicit profile skips DB read', () => {
  it('uses provided profile and does not call getProfileFromDb', async () => {
    const pass1Response = { summary: 'Company builds TypeScript microservices.', tech_stack: ['TypeScript'] };
    const pass2Response = { match_score: 88 };
    let callCount = 0;

    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({ choices: [{ message: { content: JSON.stringify(pass1Response) } }] });
        return HttpResponse.json({ choices: [{ message: { content: JSON.stringify(pass2Response) } }] });
      }),
    );

    // Pass explicit profile — DB should not be hit
    const result = await scoreJob(mockJob, 'TypeScript/Node.js developer, B2B');
    expect(result.match_score).toBe(88);
    // If getProfileFromDb were called it would fail (no DB in test) — passing here proves it wasn't
  });
});

// ─── scoreJobsBatch(): model-first batched prescreen + score ─────────────────

function makeBatchJob(id: string, title = 'TypeScript Engineer'): Job {
  return {
    id, title, company: 'Corp', url: `https://example.com/${id}`,
    source: 'justjoin', description: 'We build TypeScript microservices.',
    salary_b2b_min: null, salary_b2b_max: null,
    salary_uop_min: null, salary_uop_max: null,
    currency: 'PLN', status: 'NEW', created_at: new Date().toISOString(),
  };
}

describe('scoreJobsBatch()', () => {
  it('returns empty map for empty input without calling the model', async () => {
    const result = await scoreJobsBatch([], 'TypeScript developer');
    expect(result.size).toBe(0);
  });

  it('scores multiple jobs from one prescreen + one score call', async () => {
    const jobs = [makeBatchJob('a'), makeBatchJob('b')];
    let callCount = 0;
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            choices: [{ message: { content: JSON.stringify([
              { i: 0, summary: 'Company builds TypeScript backend services.', tech_stack: ['TypeScript'], relevant: 'yes' },
              { i: 1, summary: 'Company builds TypeScript backend services.', tech_stack: ['TypeScript'], relevant: 'yes' },
            ]) } }],
          });
        }
        return HttpResponse.json({ choices: [{ message: { content: JSON.stringify([{ i: 0, match_score: 90 }, { i: 1, match_score: 60 }]) } }] });
      }),
    );

    const result = await scoreJobsBatch(jobs, 'TypeScript/Node.js developer');
    expect(result.get('a')?.match_score).toBe(90);
    expect(result.get('b')?.match_score).toBe(60);
    expect(callCount).toBe(2);
  });

  it('scores jobs when model returns the index-keyed object shape (NVIDIA json_object mode)', async () => {
    const jobs = [makeBatchJob('a'), makeBatchJob('b')];
    let callCount = 0;
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            choices: [{ message: { content: JSON.stringify({
              '0': { summary: 'Company builds TypeScript backend services.', tech_stack: ['TypeScript'], relevant: 'yes' },
              '1': { summary: 'Company builds TypeScript backend services.', tech_stack: ['TypeScript'], relevant: 'yes' },
            }) } }],
          });
        }
        // Batch score prompt now asks for {"<i>":<score>} — bare numbers, not {i, match_score}.
        return HttpResponse.json({ choices: [{ message: { content: JSON.stringify({ '0': 90, '1': 60 }) } }] });
      }),
    );

    const result = await scoreJobsBatch(jobs, 'TypeScript/Node.js developer');
    expect(result.get('a')?.match_score).toBe(90);
    expect(result.get('b')?.match_score).toBe(60);
    expect(callCount).toBe(2);
  });

  it('falls back to per-job scoring when batch score response is a validator-rejection echo, not JSON', async () => {
    const jobs = [makeBatchJob('a'), makeBatchJob('b')];
    let callCount = 0;
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', async ({ request }) => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            choices: [{ message: { content: JSON.stringify({
              '0': { summary: 'Company builds TypeScript backend services.', tech_stack: ['TypeScript'], relevant: 'yes' },
              '1': { summary: 'Company builds TypeScript backend services.', tech_stack: ['TypeScript'], relevant: 'yes' },
            }) } }],
          });
        }
        if (callCount === 2) {
          // Observed in prod: NVIDIA's server-side json_object validator rejects an
          // array-shaped completion and the model echoes the rejection text as content.
          return HttpResponse.json({
            choices: [{ message: { content: '{"0: 0, 1: 0} is not valid JSON. The correct format is an array of objects with "' } }],
          });
        }
        // Per-job scoreJob fallback runs both jobs' pass1 concurrently (nvidiaLimit only
        // serialises call *start*), so pass1/pass2 calls interleave across jobs — branch on
        // prompt content, not call parity, to know which pass each request is.
        const body = (await request.clone().json()) as { messages: Array<{ content: string }> };
        const prompt = body.messages[0]?.content ?? '';
        if (prompt.includes('Score candidate fit')) {
          return HttpResponse.json({ choices: [{ message: { content: JSON.stringify({ match_score: 70 }) } }] });
        }
        return HttpResponse.json({ choices: [{ message: { content: JSON.stringify({ summary: 'Company builds TypeScript backend services.', tech_stack: ['TypeScript'] }) } }] });
      }),
    );

    const result = await scoreJobsBatch(jobs, 'TypeScript/Node.js developer');
    expect(result.get('a')?.match_score).toBe(70);
    expect(result.get('b')?.match_score).toBe(70);
  });

  it('jobs marked relevant:"no" get a low deterministic score and skip the score call', async () => {
    const jobs = [makeBatchJob('a'), makeBatchJob('b', 'Kierowca kat. C')];
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () =>
        HttpResponse.json({
          choices: [{ message: { content: JSON.stringify([
            { i: 0, summary: 'Company builds TypeScript backend services.', tech_stack: ['TypeScript'], relevant: 'yes' },
            { i: 1, summary: 'Warehouse driving role, unrelated to software.', tech_stack: [], relevant: 'no' },
          ]) } }],
        }),
      ),
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => HttpResponse.json({ choices: [{ message: { content: JSON.stringify([{ i: 0, match_score: 75 }]) } }] })),
    );

    const result = await scoreJobsBatch(jobs, 'TypeScript/Node.js developer');
    expect(result.get('b')?.match_score).toBe(5);
    expect(result.get('a')?.match_score).toBeDefined();
  });

  it('falls back to per-job scoreJob when prescreen JSON is unparseable', async () => {
    const jobs = [makeBatchJob('a'), makeBatchJob('b')];
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => HttpResponse.json({ choices: [{ message: { content: 'not json at all {{{' } }] })),
    );

    const result = await scoreJobsBatch(jobs, 'TypeScript/Node.js developer');
    // per-job scoreJob fallback also fails to parse → fallback record, but every job still gets a result
    expect(result.get('a')?.match_score).toBe(-1);
    expect(result.get('b')?.match_score).toBe(-1);
  });

  it('assigns fallback record to a job missing from the model output array', async () => {
    const jobs = [makeBatchJob('a'), makeBatchJob('b')];
    let callCount = 0;
    server.use(
      http.post('https://integrate.api.nvidia.com/v1/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          // only job index 0 returned — job 1 missing
          return HttpResponse.json({
            choices: [{ message: { content: JSON.stringify([{ i: 0, summary: 'Company builds TypeScript backend services.', tech_stack: ['TypeScript'], relevant: 'yes' }]) } }],
          });
        }
        return HttpResponse.json({ choices: [{ message: { content: JSON.stringify([{ i: 0, match_score: 90 }]) } }] });
      }),
    );

    const result = await scoreJobsBatch(jobs, 'TypeScript/Node.js developer');
    expect(result.get('a')?.match_score).toBe(90);
    expect(result.get('b')?.match_score).toBe(-1);
  });
});
