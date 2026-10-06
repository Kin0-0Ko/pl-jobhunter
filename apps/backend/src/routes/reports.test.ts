import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { reportsRoutes } from './reports.js';

vi.mock('../config/database.js', () => ({
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

import { getPool } from '../config/database.js';

function makeConn(rows: Record<string, unknown>[]) {
  return {
    execute: vi.fn().mockResolvedValue({ rows }),
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
  await app.register(reportsRoutes);
  return app;
}

describe('GET /api/reports/activity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without token', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/reports/activity' });
    expect(res.statusCode).toBe(401);
  });

  it('returns zeroed totals when no jobs in range', async () => {
    const conn = makeConn([]);
    vi.mocked(getPool).mockResolvedValue(makePool(conn) as never);

    const app = await buildServer();
    const res = await app.inject({
      method: 'GET', url: '/api/reports/activity',
      headers: { 'x-api-token': 'test-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { totals: { jobs_scraped: number }; ai: { avg_match_score: unknown; top_matches: unknown[] } };
    expect(body.totals.jobs_scraped).toBe(0);
    expect(body.ai.avg_match_score).toBeNull();
    expect(body.ai.top_matches).toEqual([]);
  });

  it('aggregates totals and top matches from rows', async () => {
    const rows = [
      { SOURCE: 'justjoin', STATUS: 'APPLIED', ID: 'a', TITLE: 'Dev A', COMPANY: 'Acme', MATCH_SCORE: 90 },
      { SOURCE: 'nofluff', STATUS: 'NEW', ID: 'b', TITLE: 'Dev B', COMPANY: 'Corp', MATCH_SCORE: 70 },
      { SOURCE: 'justjoin', STATUS: 'REJECTED', ID: 'c', TITLE: 'Dev C', COMPANY: 'Zet', MATCH_SCORE: null },
      { SOURCE: 'nofluff', STATUS: 'NEW', ID: 'd', TITLE: 'Dev D', COMPANY: 'Fallback Co', MATCH_SCORE: -1 },
    ];
    const conn = makeConn(rows);
    vi.mocked(getPool).mockResolvedValue(makePool(conn) as never);

    const app = await buildServer();
    const res = await app.inject({
      method: 'GET', url: '/api/reports/activity',
      headers: { 'x-api-token': 'test-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      totals: { jobs_scraped: number; jobs_by_source: Record<string, number>; applied: number; rejected: number };
      ai: { avg_match_score: number; top_matches: { id: string }[] };
    };
    expect(body.totals.jobs_scraped).toBe(4);
    expect(body.totals.jobs_by_source).toEqual({ justjoin: 2, nofluff: 2 });
    expect(body.totals.applied).toBe(1);
    expect(body.totals.rejected).toBe(1);
    // -1 is Ollama's fallback sentinel for failed scoring, not a real score — must be excluded
    expect(body.ai.avg_match_score).toBe(80);
    expect(body.ai.top_matches.map((m) => m.id)).not.toContain('d');
    expect(body.ai.top_matches[0]?.id).toBe('a');
  });

  it('sets Content-Disposition header when download=1', async () => {
    const conn = makeConn([]);
    vi.mocked(getPool).mockResolvedValue(makePool(conn) as never);

    const app = await buildServer();
    const res = await app.inject({
      method: 'GET', url: '/api/reports/activity?download=1',
      headers: { 'x-api-token': 'test-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="activity-report-\d{4}-\d{2}-\d{2}\.json"/);
  });
});
