import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Job } from '@pl-jobhunter/shared';

// ─── shared mock job factory ──────────────────────────────────────────────────

function makeJob(id: string, source: 'justjoin' | 'nofluff' = 'nofluff'): Job {
  return {
    id,
    title: 'TypeScript Engineer',
    company: 'Test Corp',
    url: `https://example.com/job/${id}`,
    source,
    description: 'We build TypeScript microservices for fintech clients.',
    salary_b2b_min: 15000,
    salary_b2b_max: 22000,
    salary_uop_min: null,
    salary_uop_max: null,
    currency: 'PLN',
    status: 'NEW',
    created_at: new Date().toISOString(),
  };
}

// ─── US1: DB-fail isolation (C1) ─────────────────────────────────────────────

describe('runEtl() — US1: per-job DB error isolation (C1)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('processes remaining jobs when one mergeJob rejects', async () => {
    const jobs = [makeJob('job-1'), makeJob('job-2'), makeJob('job-3')];
    let mergeCallCount = 0;
    const persistedIds: string[] = [];

    vi.doMock('../config/database.js', () => ({
      getPool: vi.fn().mockResolvedValue({
        getConnection: vi.fn().mockResolvedValue({
          execute: vi.fn().mockImplementation((sql: string, params: Record<string, unknown>) => {
            if (sql.includes('raw_jobs')) return Promise.resolve({ rowsAffected: 1 });
            if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [[0, null]] });
            if (sql.includes('ai_analysis')) { persistedIds.push(params['job_id'] as string); return Promise.resolve({}); }
            if (sql.includes('MERGE INTO jobs')) {
              mergeCallCount++;
              if (mergeCallCount === 2) return Promise.reject(new Error('transient ORA-12541'));
              return Promise.resolve({ rowsAffected: 1 });
            }
            return Promise.resolve({});
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }));

    vi.doMock('../scrapers/justjoin.js', () => ({ fetchJustJoin: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/nofluff.js', () => ({ fetchNoFluff: vi.fn().mockResolvedValue(jobs) }));
    vi.doMock('../scrapers/theprotocol.js', () => ({ fetchTheProtocol: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/rocketjobs.js', () => ({ fetchRocketJobs: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../ai/ollama.js', () => ({
      scoreJob: vi.fn().mockResolvedValue({ match_score: 80, summary: 'test', tech_stack: ['TypeScript'], why_good: null }),
      isRelevantJob: vi.fn().mockReturnValue({ pass: true }),
      isNegativeJob: vi.fn().mockReturnValue(false),
      getFilterProfile: vi.fn().mockResolvedValue({}),
      getProfileFromDb: vi.fn().mockResolvedValue('TypeScript/Node.js developer'),
      SCORING_DESC_MAX_CHARS: 2000,
    }));
    vi.doMock('../bot/telegram.js', () => ({
      sendCriticalAlert: vi.fn().mockResolvedValue(undefined),
      sendOllamaWarning: vi.fn().mockResolvedValue(undefined),
      sendRunDigest: vi.fn().mockResolvedValue(undefined),
      sendNewJobAlert: vi.fn().mockResolvedValue(undefined),
    }));

    const { runEtl } = await import('./etl.js');
    await runEtl();

    // job-2's merge failed → only job-1 and job-3 get scored
    expect(persistedIds).toContain('job-1');
    expect(persistedIds).toContain('job-3');
    expect(persistedIds).not.toContain('job-2');
  });

  it('does NOT call sendCriticalAlert for failures below the threshold', async () => {
    vi.stubEnv('ETL_DB_FAILURE_ABORT_THRESHOLD', '10');
    const jobs = [makeJob('job-a'), makeJob('job-b'), makeJob('job-c')];
    let mergeCount = 0;

    vi.doMock('../config/database.js', () => ({
      getPool: vi.fn().mockResolvedValue({
        getConnection: vi.fn().mockResolvedValue({
          execute: vi.fn().mockImplementation((sql: string) => {
            if (sql.includes('raw_jobs')) return Promise.resolve({ rowsAffected: 1 });
            if (sql.includes('ai_analysis')) return Promise.resolve({});
            if (sql.includes('MERGE INTO jobs')) {
              mergeCount++;
              if (mergeCount <= 2) return Promise.reject(new Error('transient'));
              return Promise.resolve({ rowsAffected: 1 });
            }
            if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [[0, null]] });
            return Promise.resolve({});
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }));

    vi.doMock('../scrapers/justjoin.js', () => ({ fetchJustJoin: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/nofluff.js', () => ({ fetchNoFluff: vi.fn().mockResolvedValue(jobs) }));
    vi.doMock('../scrapers/theprotocol.js', () => ({ fetchTheProtocol: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/rocketjobs.js', () => ({ fetchRocketJobs: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../ai/ollama.js', () => ({
      scoreJob: vi.fn().mockResolvedValue({ match_score: 80, summary: 'test', tech_stack: ['TypeScript'], why_good: null }),
      isRelevantJob: vi.fn().mockReturnValue({ pass: true }),
      isNegativeJob: vi.fn().mockReturnValue(false),
      getFilterProfile: vi.fn().mockResolvedValue({}),
      getProfileFromDb: vi.fn().mockResolvedValue('TypeScript/Node.js developer'),
      SCORING_DESC_MAX_CHARS: 2000,
    }));
    const sendCriticalAlert = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../bot/telegram.js', () => ({
      sendCriticalAlert,
      sendOllamaWarning: vi.fn().mockResolvedValue(undefined),
      sendRunDigest: vi.fn().mockResolvedValue(undefined),
      sendNewJobAlert: vi.fn().mockResolvedValue(undefined),
    }));

    const { runEtl } = await import('./etl.js');
    await runEtl();

    expect(sendCriticalAlert).not.toHaveBeenCalledWith('oracle', expect.anything());
  });

  it('calls sendCriticalAlert and stops when consecutive failures exceed threshold', async () => {
    vi.stubEnv('ETL_DB_FAILURE_ABORT_THRESHOLD', '2');
    const jobs = Array.from({ length: 5 }, (_, i) => makeJob(`job-${i}`));
    const persistedIds: string[] = [];

    vi.doMock('../config/database.js', () => ({
      getPool: vi.fn().mockResolvedValue({
        getConnection: vi.fn().mockResolvedValue({
          execute: vi.fn().mockImplementation((sql: string, params: Record<string, unknown>) => {
            if (sql.includes('raw_jobs')) return Promise.resolve({ rowsAffected: 1 });
            if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [[0, null]] });
            if (sql.includes('ai_analysis')) { persistedIds.push(params['job_id'] as string); return Promise.resolve({}); }
            if (sql.includes('MERGE INTO jobs')) return Promise.reject(new Error('ORA-12541: TNS no listener'));
            return Promise.resolve({});
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }));

    vi.doMock('../scrapers/justjoin.js', () => ({ fetchJustJoin: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/nofluff.js', () => ({ fetchNoFluff: vi.fn().mockResolvedValue(jobs) }));
    vi.doMock('../scrapers/theprotocol.js', () => ({ fetchTheProtocol: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/rocketjobs.js', () => ({ fetchRocketJobs: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../ai/ollama.js', () => ({
      scoreJob: vi.fn().mockResolvedValue({ match_score: 80, summary: 'test', tech_stack: ['TypeScript'], why_good: null }),
      isRelevantJob: vi.fn().mockReturnValue({ pass: true }),
      isNegativeJob: vi.fn().mockReturnValue(false),
      getFilterProfile: vi.fn().mockResolvedValue({}),
      getProfileFromDb: vi.fn().mockResolvedValue('TypeScript/Node.js developer'),
      SCORING_DESC_MAX_CHARS: 2000,
    }));
    const sendCriticalAlert = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../bot/telegram.js', () => ({
      sendCriticalAlert,
      sendOllamaWarning: vi.fn().mockResolvedValue(undefined),
      sendRunDigest: vi.fn().mockResolvedValue(undefined),
      sendNewJobAlert: vi.fn().mockResolvedValue(undefined),
    }));

    const { runEtl } = await import('./etl.js');
    await runEtl();

    expect(sendCriticalAlert).toHaveBeenCalledWith('oracle', expect.any(Error));
    // Run stopped early — not all 5 jobs got scored
    expect(persistedIds.length).toBeLessThan(5);
  });
});

// ─── US2: dedup before detail fetch (C2) ──────────────────────────────────────

describe('runEtl() — US2: dedup before JustJoin detail fetch (C2)', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('does NOT call fetchJustJoinDetail for a job already stored with valid analysis', async () => {
    const jjJob = makeJob('jj-already-stored', 'justjoin');
    jjJob.description = '[category:javascript]';

    const fetchJustJoinDetail = vi.fn().mockResolvedValue('full description text');

    vi.doMock('../config/database.js', () => ({
      getPool: vi.fn().mockResolvedValue({
        getConnection: vi.fn().mockResolvedValue({
          execute: vi.fn().mockImplementation((sql: string) => {
            if (sql.includes('raw_jobs')) return Promise.resolve({ rowsAffected: 1 });
            if (sql.includes('MERGE INTO jobs')) return Promise.resolve({ rowsAffected: 0 }); // already exists
            if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [[1, '["TypeScript"]']] }); // valid analysis
            return Promise.resolve({});
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }));

    vi.doMock('../scrapers/justjoin.js', () => ({
      fetchJustJoin: vi.fn().mockResolvedValue([jjJob]),
      fetchJustJoinDetail,
    }));
    vi.doMock('../scrapers/nofluff.js', () => ({ fetchNoFluff: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/theprotocol.js', () => ({ fetchTheProtocol: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/rocketjobs.js', () => ({ fetchRocketJobs: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../ai/ollama.js', () => ({
      scoreJob: vi.fn().mockResolvedValue({ match_score: 80, summary: 'test', tech_stack: ['TypeScript'], why_good: null }),
      isRelevantJob: vi.fn().mockReturnValue({ pass: true }),
      isNegativeJob: vi.fn().mockReturnValue(false),
      getFilterProfile: vi.fn().mockResolvedValue({}),
      getProfileFromDb: vi.fn().mockResolvedValue('TypeScript/Node.js developer'),
      SCORING_DESC_MAX_CHARS: 2000,
    }));
    vi.doMock('../bot/telegram.js', () => ({
      sendCriticalAlert: vi.fn().mockResolvedValue(undefined),
      sendOllamaWarning: vi.fn().mockResolvedValue(undefined),
      sendRunDigest: vi.fn().mockResolvedValue(undefined),
      sendNewJobAlert: vi.fn().mockResolvedValue(undefined),
    }));

    const { runEtl } = await import('./etl.js');
    await runEtl();

    expect(fetchJustJoinDetail).not.toHaveBeenCalled();
  });

  it('DOES call fetchJustJoinDetail for a new JustJoin job with stub description', async () => {
    const jjJob = makeJob('jj-new-job', 'justjoin');
    jjJob.description = '[category:javascript]';

    const fetchJustJoinDetail = vi.fn().mockResolvedValue('real description with TypeScript and Node.js');

    vi.doMock('../config/database.js', () => ({
      getPool: vi.fn().mockResolvedValue({
        getConnection: vi.fn().mockResolvedValue({
          execute: vi.fn().mockImplementation((sql: string) => {
            if (sql.includes('raw_jobs')) return Promise.resolve({ rowsAffected: 1 });
            if (sql.includes('MERGE INTO jobs')) return Promise.resolve({ rowsAffected: 1 }); // newly inserted
            if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [[0, null]] }); // no analysis yet
            if (sql.includes('ai_analysis')) return Promise.resolve({});
            return Promise.resolve({});
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }));

    vi.doMock('../scrapers/justjoin.js', () => ({
      fetchJustJoin: vi.fn().mockResolvedValue([jjJob]),
      fetchJustJoinDetail,
    }));
    vi.doMock('../scrapers/nofluff.js', () => ({ fetchNoFluff: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/theprotocol.js', () => ({ fetchTheProtocol: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/rocketjobs.js', () => ({ fetchRocketJobs: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../ai/ollama.js', () => ({
      scoreJob: vi.fn().mockResolvedValue({ match_score: 80, summary: 'test', tech_stack: ['TypeScript'], why_good: null }),
      isRelevantJob: vi.fn().mockReturnValue({ pass: true }),
      isNegativeJob: vi.fn().mockReturnValue(false),
      getFilterProfile: vi.fn().mockResolvedValue({}),
      getProfileFromDb: vi.fn().mockResolvedValue('TypeScript/Node.js developer'),
      SCORING_DESC_MAX_CHARS: 2000,
    }));
    vi.doMock('../bot/telegram.js', () => ({
      sendCriticalAlert: vi.fn().mockResolvedValue(undefined),
      sendOllamaWarning: vi.fn().mockResolvedValue(undefined),
      sendRunDigest: vi.fn().mockResolvedValue(undefined),
      sendNewJobAlert: vi.fn().mockResolvedValue(undefined),
    }));

    const { runEtl } = await import('./etl.js');
    await runEtl();

    expect(fetchJustJoinDetail).toHaveBeenCalled();
  });
});

// ─── US3: mergeJob WHEN MATCHED update (C3/H1) ───────────────────────────────

describe('runEtl() — US3: mergeJob updates mutable fields on match (C3/H1)', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('re-scores existing job with stub description (mergeJob updates description)', async () => {
    const jjJob = makeJob('jj-stub-job', 'justjoin');
    jjJob.description = '[category:javascript]';
    const scoreJob = vi.fn().mockResolvedValue({ match_score: 80, summary: 'test', tech_stack: ['TypeScript'], why_good: null });
    let updateExecuted = false;

    vi.doMock('../config/database.js', () => ({
      getPool: vi.fn().mockResolvedValue({
        getConnection: vi.fn().mockResolvedValue({
          execute: vi.fn().mockImplementation((sql: string) => {
            if (sql.includes('raw_jobs')) return Promise.resolve({ rowsAffected: 1 });
            if (sql.includes('MERGE INTO jobs')) {
              if (sql.includes('WHEN MATCHED')) updateExecuted = true;
              return Promise.resolve({ rowsAffected: 0 }); // already existed
            }
            if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [[0, null]] }); // missing analysis → re-score
            if (sql.includes('ai_analysis')) return Promise.resolve({});
            return Promise.resolve({});
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }));

    vi.doMock('../scrapers/justjoin.js', () => ({
      fetchJustJoin: vi.fn().mockResolvedValue([jjJob]),
      fetchJustJoinDetail: vi.fn().mockResolvedValue('real full description with TypeScript and React'),
    }));
    vi.doMock('../scrapers/nofluff.js', () => ({ fetchNoFluff: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/theprotocol.js', () => ({ fetchTheProtocol: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/rocketjobs.js', () => ({ fetchRocketJobs: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../ai/ollama.js', () => ({
      scoreJob,
      isRelevantJob: vi.fn().mockReturnValue({ pass: true }),
      isNegativeJob: vi.fn().mockReturnValue(false),
      getFilterProfile: vi.fn().mockResolvedValue({}),
      getProfileFromDb: vi.fn().mockResolvedValue('TypeScript/Node.js developer'),
      SCORING_DESC_MAX_CHARS: 2000,
    }));
    vi.doMock('../bot/telegram.js', () => ({
      sendCriticalAlert: vi.fn().mockResolvedValue(undefined),
      sendOllamaWarning: vi.fn().mockResolvedValue(undefined),
      sendRunDigest: vi.fn().mockResolvedValue(undefined),
      sendNewJobAlert: vi.fn().mockResolvedValue(undefined),
    }));

    const { runEtl } = await import('./etl.js');
    await runEtl();

    expect(updateExecuted).toBe(true);
    expect(scoreJob).toHaveBeenCalled();
  });
});

// ─── US6: parallel scrapers (M1) ─────────────────────────────────────────────

describe('runEtl() — US6: parallel scrapers via Promise.allSettled (M1)', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('uses results from passing scrapers when one scraper rejects', async () => {
    const nofluffJobs = [makeJob('nf-ok-1'), makeJob('nf-ok-2')];
    const scoreJob = vi.fn().mockResolvedValue({ match_score: 75, summary: 'test', tech_stack: ['TypeScript'], why_good: null });
    const persistedIds: string[] = [];

    vi.doMock('../config/database.js', () => ({
      getPool: vi.fn().mockResolvedValue({
        getConnection: vi.fn().mockResolvedValue({
          execute: vi.fn().mockImplementation((sql: string, params: Record<string, unknown>) => {
            if (sql.includes('raw_jobs')) return Promise.resolve({ rowsAffected: 1 });
            if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [[0, null]] });
            if (sql.includes('MERGE INTO jobs')) return Promise.resolve({ rowsAffected: 1 });
            if (sql.includes('ai_analysis')) { persistedIds.push(params['job_id'] as string); return Promise.resolve({}); }
            return Promise.resolve({});
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }));

    vi.doMock('../scrapers/justjoin.js', () => ({
      fetchJustJoin: vi.fn().mockRejectedValue(new Error('JJ down')),
      fetchJustJoinDetail: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock('../scrapers/nofluff.js', () => ({ fetchNoFluff: vi.fn().mockResolvedValue(nofluffJobs) }));
    vi.doMock('../scrapers/theprotocol.js', () => ({ fetchTheProtocol: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../scrapers/rocketjobs.js', () => ({ fetchRocketJobs: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../ai/ollama.js', () => ({
      scoreJob,
      isRelevantJob: vi.fn().mockReturnValue({ pass: true }),
      isNegativeJob: vi.fn().mockReturnValue(false),
      getFilterProfile: vi.fn().mockResolvedValue({}),
      getProfileFromDb: vi.fn().mockResolvedValue('TypeScript/Node.js developer'),
      SCORING_DESC_MAX_CHARS: 2000,
    }));
    vi.doMock('../bot/telegram.js', () => ({
      sendCriticalAlert: vi.fn().mockResolvedValue(undefined),
      sendOllamaWarning: vi.fn().mockResolvedValue(undefined),
      sendRunDigest: vi.fn().mockResolvedValue(undefined),
      sendNewJobAlert: vi.fn().mockResolvedValue(undefined),
    }));

    const { runEtl } = await import('./etl.js');
    await runEtl();

    expect(persistedIds).toContain('nf-ok-1');
    expect(persistedIds).toContain('nf-ok-2');
  });
});
