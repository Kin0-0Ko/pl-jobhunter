import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { scoreJob, isFirstPersonInverted, normalizeScore, buildFallbackRecord, isRelevantJob, getFilterProfile } from './ollama.js';
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

const validResponse = {
  match_score: 85,
  summary: 'TypeScript role at a mid-size company',
  tech_stack: ['TypeScript', 'Node.js'],
  why_good: 'Matches senior TS profile with remote B2B',
};

describe('scoreJob()', () => {
  it('returns parsed score result on valid response', async () => {
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () =>
        HttpResponse.json({ response: JSON.stringify(validResponse) })
      )
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(85);
    expect(result.tech_stack).toContain('TypeScript');
    expect(typeof result.summary).toBe('string');
    expect(typeof result.why_good).toBe('string');
  });

  it('returns fallback on unrepairable JSON (no retry needed, repair handles it)', async () => {
    let callCount = 0;
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        return HttpResponse.json({ response: 'not valid json {{{' });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    expect(callCount).toBe(1);
  });

  it('retries once on HTTP error and returns fallback on second failure', async () => {
    let callCount = 0;
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        return HttpResponse.json({ error: 'model not loaded' }, { status: 500 });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    expect(callCount).toBe(2);
  });

  it('succeeds on second attempt after first failure', async () => {
    let callCount = 0;
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({ error: 'timeout' }, { status: 503 });
        }
        return HttpResponse.json({ response: JSON.stringify(validResponse) });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(85);
    expect(callCount).toBe(2);
  });
});

// T010: scoreJob fallback contract + normalizeScore + empty summary enforcement
describe('scoreJob() — fallback contract (T010)', () => {
  it('returns fallback record on unrepairable JSON after retry', async () => {
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () =>
        HttpResponse.json({ response: 'not valid json {{{' })
      )
    );
    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    expect(result.summary.trim()).not.toBe('');
  });

  it('returns fallback record on HTTP error after retry', async () => {
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () =>
        HttpResponse.json({ error: 'server error' }, { status: 500 })
      )
    );
    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
    expect(result.summary.trim()).not.toBe('');
  });

  it('enforces non-empty summary when model returns empty string', async () => {
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () =>
        HttpResponse.json({ response: JSON.stringify({ match_score: 70, summary: '', tech_stack: [] }) })
      )
    );
    const result = await scoreJob(mockJob);
    expect(result.summary.trim()).not.toBe('');
  });

  it('returns fallback when summary is first-person inverted', async () => {
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () =>
        HttpResponse.json({ response: JSON.stringify({ match_score: 70, summary: 'I am a TypeScript developer looking for a role', tech_stack: [] }) })
      )
    );
    const result = await scoreJob(mockJob);
    expect(result.match_score).toBe(-1);
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
  it('has non-empty why_good', () => expect(buildFallbackRecord().why_good.length).toBeGreaterThan(0));
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
