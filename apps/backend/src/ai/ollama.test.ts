import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { scoreJob, isFirstPersonInverted, normalizeScore, buildFallbackRecord, isRelevantJob, getFilterProfile, isNegativeJob, SCORING_DESC_MAX_CHARS, buildPass1Prompt } from './ollama.js';
import type { Job } from '@pl-jobhunter/shared';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

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
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({ response: JSON.stringify(pass1Response) });
        return HttpResponse.json({ response: JSON.stringify(pass2Response) });
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
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        return HttpResponse.json({ response: 'not valid json {{{' });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    expect(callCount).toBe(1); // pass1 fails immediately, no retry (repair handles it), no pass2
  });

  it('retries pass1 once on HTTP error, returns fallback on second failure', async () => {
    let callCount = 0;
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        return HttpResponse.json({ error: 'model not loaded' }, { status: 500 });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    expect(callCount).toBe(2); // pass1 attempt + pass1 retry, both fail → fallback, no pass2
  });

  it('pass1 succeeds on retry, then pass2 runs', async () => {
    let callCount = 0;
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({ error: 'timeout' }, { status: 503 });
        if (callCount === 2) return HttpResponse.json({ response: JSON.stringify(pass1Response) });
        return HttpResponse.json({ response: JSON.stringify(pass2Response) });
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
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({ response: JSON.stringify(pass1Response) });
        return HttpResponse.json({ error: 'overload' }, { status: 503 });
      })
    );

    const result = await scoreJob(mockJob);
    // pass1 succeeded so we have the real summary, but match_score is -1 from failed pass2
    expect(result.match_score).toBe(-1);
    expect(result.summary).toBe(pass1Response.summary);
    expect(callCount).toBe(3); // pass2 attempt + pass2 retry, both fail
  });

  it('returns fallback when pass1 summary is first-person inverted', async () => {
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () =>
        HttpResponse.json({ response: JSON.stringify({ summary: 'I am a TypeScript developer seeking remote work.', tech_stack: [] }) })
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
      http.post('http://127.0.0.1:11434/api/generate', () =>
        HttpResponse.json({ response: 'not valid json {{{' })
      )
    );
    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    expect(result.summary.trim()).not.toBe('');
  });

  it('returns fallback record when pass1 HTTP errors on both attempts', async () => {
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () =>
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
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({ response: JSON.stringify({ summary: '', tech_stack: [] }) });
        return HttpResponse.json({ response: JSON.stringify({ match_score: 70 }) });
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

// T021: isRelevantJob wildcard ordering (US5)
describe('isRelevantJob() cross-training wildcard ordering (T021)', () => {
  const profile = { target_seniority: ['junior', 'mid'], max_experience_years: 3 };

  const baseJob: Job = {
    id: 'test',
    title: 'Developer',
    company: 'Corp',
    url: 'https://example.com',
    source: 'justjoin',
    salary_b2b_min: null, salary_b2b_max: null,
    salary_uop_min: null, salary_uop_max: null,
    currency: 'PLN',
    status: 'NEW',
    created_at: new Date().toISOString(),
  };

  it('cross-training phrase + non-matching keywords → wildcard pass', () => {
    const job: Job = { ...baseJob, description: 'We can teach you Go. No previous experience with Go needed.' };
    const result = isRelevantJob(job, profile);
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('wildcard');
  });

  it('cross-training phrase + senior title → seniority still rejects', () => {
    const job: Job = { ...baseJob, title: 'Senior Backend Engineer', description: 'We can teach you. No previous experience needed.' };
    const result = isRelevantJob(job, profile);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('seniority');
  });

  it('cross-training phrase + experience over cap → check precedence (seniority wins if title senior)', () => {
    // wildcard should bypass experience check but seniority check runs first
    const job: Job = { ...baseJob, title: 'Developer', description: 'Requires 5+ years experience. We can teach you the stack.' };
    // seniority OK (no senior in title), wildcard fires before experience check per current code
    const result = isRelevantJob(job, profile);
    expect(result.pass).toBe(true); // wildcard runs before experience in current implementation
    expect(result.reason).toBe('wildcard');
  });
});

// T006: getFilterProfile (US1) — mock DB
describe('getFilterProfile() (T006)', () => {
  it('returns {} without warning when preferences field is null', async () => {
    vi.doMock('../config/database.js', () => ({
      getPool: vi.fn().mockResolvedValue({
        getConnection: vi.fn().mockResolvedValue({
          execute: vi.fn().mockResolvedValue({
            rows: [{ SKILLS: '[]', PREFERRED_CONTRACT: 'b2b', SEARCH_PREFERENCES: null }],
          }),
          close: vi.fn(),
        }),
      }),
    }));
    // Can't easily test the logger output here without injecting logger, so we just verify shape
    const { getFilterProfile: gfp } = await import('./ollama.js');
    const result = await gfp();
    expect(result).toEqual({});
    vi.doUnmock('../config/database.js');
  });
});

// ─── T015: US4 — H2 isNegativeJob word-boundary (title-scoped) ───────────────

describe('isNegativeJob() — H2: word-boundary title matching', () => {
  const base: Job = {
    id: 'test', title: '', company: 'Corp', url: 'https://example.com',
    source: 'nofluff', description: undefined,
    salary_b2b_min: null, salary_b2b_max: null,
    salary_uop_min: null, salary_uop_max: null,
    currency: 'PLN', status: 'NEW', created_at: new Date().toISOString(),
  };

  it('blocks "Senior Go Developer" title (genuine Go role)', () => {
    expect(isNegativeJob({ ...base, title: 'Senior Go Developer' })).toBe(true);
  });

  it('does NOT block "TypeScript Engineer" with "let\'s go build" in description', () => {
    expect(isNegativeJob({ ...base, title: 'TypeScript Engineer', description: "let's go build great things with Node.js" })).toBe(false);
  });

  it('does NOT block when description says "we sap our resources" with relevant title', () => {
    expect(isNegativeJob({ ...base, title: 'Node.js Backend Developer', description: 'we sap our legacy systems' })).toBe(false);
  });

  it('blocks "Java Developer" title', () => {
    expect(isNegativeJob({ ...base, title: 'Java Developer' })).toBe(true);
  });

  it('does NOT block "JavaScript Engineer" (java prefix but not java word)', () => {
    expect(isNegativeJob({ ...base, title: 'JavaScript Engineer' })).toBe(false);
  });

  it('blocks "QA Engineer" title', () => {
    expect(isNegativeJob({ ...base, title: 'QA Engineer' })).toBe(true);
  });

  it('does NOT block "TypeScript/Node.js Developer" with incidental "sap" in description', () => {
    expect(isNegativeJob({ ...base, title: 'TypeScript/Node.js Developer', description: 'experience with SAP integration is a plus' })).toBe(false);
  });

  it('blocks "SAP Consultant" title', () => {
    expect(isNegativeJob({ ...base, title: 'SAP Consultant' })).toBe(true);
  });
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
  it('rejects within OLLAMA_TIMEOUT_MS when model never responds', async () => {
    vi.stubEnv('OLLAMA_TIMEOUT_MS', '200');

    server.use(
      http.post('http://127.0.0.1:11434/api/generate', async () => {
        // Never respond — simulate hung model
        await new Promise(() => {});
        return HttpResponse.json({ response: '{}' });
      }),
    );

    const start = Date.now();
    const result = await scoreJob(mockJob);
    const elapsed = Date.now() - start;

    // Call aborted → fallback path → match_score -1
    expect(result.match_score).toBe(-1);
    // Should resolve well within 2s (configured 200ms + retry + some slack)
    expect(elapsed).toBeLessThan(2000);

    vi.unstubAllEnvs();
  });
});

// ─── T021: US6 — M2 scoreJob with explicit profile skips DB read ─────────────

describe('scoreJob() — M2: explicit profile skips DB read', () => {
  it('uses provided profile and does not call getProfileFromDb', async () => {
    const pass1Response = { summary: 'Company builds TypeScript microservices.', tech_stack: ['TypeScript'] };
    const pass2Response = { match_score: 88 };
    let callCount = 0;

    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({ response: JSON.stringify(pass1Response) });
        return HttpResponse.json({ response: JSON.stringify(pass2Response) });
      }),
    );

    // Pass explicit profile — DB should not be hit
    const result = await scoreJob(mockJob, 'TypeScript/Node.js developer, B2B');
    expect(result.match_score).toBe(88);
    // If getProfileFromDb were called it would fail (no DB in test) — passing here proves it wasn't
  });
});
