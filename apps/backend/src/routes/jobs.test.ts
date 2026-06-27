import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { jobsRoutes } from './jobs.js';

vi.mock('../config/database.js', () => ({
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

import { getPool } from '../config/database.js';

function makeConn(rows: Record<string, unknown>[], rowsAffected = 1) {
  return {
    execute: vi.fn().mockResolvedValue({ rows, rowsAffected }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makePool(conn: ReturnType<typeof makeConn>) {
  return { getConnection: vi.fn().mockResolvedValue(conn) };
}

async function buildServer() {
  const app = Fastify();
  app.addHook('preHandler', async (request, reply) => {
    const token = request.headers['x-api-token'];
    if (!token || token !== 'test-token') {
      await reply.code(401).send();
    }
  });
  await app.register(jobsRoutes);
  return app;
}

describe('GET /api/jobs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without token', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/jobs' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with sorted jobs array', async () => {
    const row = {
      ID: 'jj-1',
      TITLE: 'Dev',
      COMPANY: 'Acme',
      URL: 'https://example.com',
      SOURCE: 'justjoin',
      SALARY_B2B_MIN: 18000,
      SALARY_B2B_MAX: 24000,
      SALARY_UOP_MIN: null,
      SALARY_UOP_MAX: null,
      CURRENCY: 'PLN',
      STATUS: 'NEW',
      CREATED_AT: new Date('2026-06-27T00:00:00Z'),
      MATCH_SCORE: 90,
      SUMMARY: 'Great fit',
      TECH_STACK: '["TypeScript","Node.js"]',
      WHY_GOOD: 'Matches skills',
    };
    const conn = makeConn([row]);
    vi.mocked(getPool).mockResolvedValue(makePool(conn) as never);

    const app = await buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs',
      headers: { 'x-api-token': 'test-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(body).toHaveLength(1);
    expect((body[0] as Record<string, unknown>)['id']).toBe('jj-1');
    expect((body[0] as Record<string, unknown>)['tech_stack']).toEqual(['TypeScript', 'Node.js']);
    expect((body[0] as Record<string, unknown>)['match_score']).toBe(90);
  });

  it('returns jobs with null analysis when no ai_analysis row', async () => {
    const row = {
      ID: 'jj-2', TITLE: 'Dev', COMPANY: 'Corp', URL: 'https://x.com',
      SOURCE: 'nofluff', SALARY_B2B_MIN: null, SALARY_B2B_MAX: null,
      SALARY_UOP_MIN: null, SALARY_UOP_MAX: null, CURRENCY: 'PLN', STATUS: 'NEW',
      CREATED_AT: new Date('2026-06-27T00:00:00Z'),
      MATCH_SCORE: null, SUMMARY: null, TECH_STACK: null, WHY_GOOD: null,
    };
    const conn = makeConn([row]);
    vi.mocked(getPool).mockResolvedValue(makePool(conn) as never);

    const app = await buildServer();
    const res = await app.inject({
      method: 'GET', url: '/api/jobs',
      headers: { 'x-api-token': 'test-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect((body[0] as Record<string, unknown>)['match_score']).toBeNull();
    expect((body[0] as Record<string, unknown>)['tech_stack']).toBeNull();
  });
});

describe('PATCH /api/jobs/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without token', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'PATCH', url: '/api/jobs/jj-1',
      payload: { status: 'FAVORITE' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 on valid status update', async () => {
    const conn = makeConn([], 1);
    vi.mocked(getPool).mockResolvedValue(makePool(conn) as never);

    const app = await buildServer();
    const res = await app.inject({
      method: 'PATCH', url: '/api/jobs/jj-1',
      headers: { 'x-api-token': 'test-token', 'content-type': 'application/json' },
      payload: { status: 'FAVORITE' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'jj-1', status: 'FAVORITE' });
  });

  it('returns 400 on invalid status', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'PATCH', url: '/api/jobs/jj-1',
      headers: { 'x-api-token': 'test-token', 'content-type': 'application/json' },
      payload: { status: 'INVALID' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('Invalid status value');
  });

  it('returns 404 when job not found', async () => {
    const conn = makeConn([], 0);
    vi.mocked(getPool).mockResolvedValue(makePool(conn) as never);

    const app = await buildServer();
    const res = await app.inject({
      method: 'PATCH', url: '/api/jobs/nonexistent',
      headers: { 'x-api-token': 'test-token', 'content-type': 'application/json' },
      payload: { status: 'APPLIED' },
    });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('Job not found');
  });
});
