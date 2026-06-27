import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { profileRoutes } from './profile.js';

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
  await app.register(profileRoutes);
  return app;
}

const profileRow = {
  SKILLS: '["TypeScript","React"]',
  RESUME_TEXT: '5yr Node.js',
  PREFERRED_CONTRACT: 'b2b',
  SEARCH_PREFERENCES: 'Remote only',
  UPDATED_AT: new Date('2026-06-28T00:00:00Z'),
};

describe('GET /api/profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without token', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with profile when row exists', async () => {
    const conn = makeConn([profileRow]);
    vi.mocked(getPool).mockResolvedValue(makePool(conn) as never);

    const app = await buildServer();
    const res = await app.inject({
      method: 'GET', url: '/api/profile',
      headers: { 'x-api-token': 'test-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['skills']).toEqual(['TypeScript', 'React']);
    expect(body['preferred_contract']).toBe('b2b');
    expect(body['updated_at']).toBe('2026-06-28T00:00:00.000Z');
  });

  it('returns 200 with null when no profile exists', async () => {
    const conn = makeConn([]);
    vi.mocked(getPool).mockResolvedValue(makePool(conn) as never);

    const app = await buildServer();
    const res = await app.inject({
      method: 'GET', url: '/api/profile',
      headers: { 'x-api-token': 'test-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });
});

describe('PUT /api/profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without token', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'PUT', url: '/api/profile',
      headers: { 'content-type': 'application/json' },
      payload: { skills: ['TypeScript'], preferred_contract: 'b2b' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 and upserts profile', async () => {
    const conn = makeConn([profileRow]);
    vi.mocked(getPool).mockResolvedValue(makePool(conn) as never);

    const app = await buildServer();
    const res = await app.inject({
      method: 'PUT', url: '/api/profile',
      headers: { 'x-api-token': 'test-token', 'content-type': 'application/json' },
      payload: { skills: ['TypeScript', 'React'], preferred_contract: 'b2b', resume_text: '5yr Node.js', search_preferences: 'Remote only' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['skills']).toEqual(['TypeScript', 'React']);
    expect(body['updated_at']).toBeDefined();
  });

  it('returns 400 when skills array is empty', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'PUT', url: '/api/profile',
      headers: { 'x-api-token': 'test-token', 'content-type': 'application/json' },
      payload: { skills: [], preferred_contract: 'b2b' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when skills contain only whitespace', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'PUT', url: '/api/profile',
      headers: { 'x-api-token': 'test-token', 'content-type': 'application/json' },
      payload: { skills: ['   ', '  '], preferred_contract: 'b2b' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('non-empty');
  });

  it('returns 400 on invalid preferred_contract', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'PUT', url: '/api/profile',
      headers: { 'x-api-token': 'test-token', 'content-type': 'application/json' },
      payload: { skills: ['TypeScript'], preferred_contract: 'freelance' },
    });
    expect(res.statusCode).toBe(400);
  });
});
