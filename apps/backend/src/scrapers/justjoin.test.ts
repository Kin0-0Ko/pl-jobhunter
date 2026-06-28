import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { fetchJustJoin } from './justjoin.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const mockOffers = [
  {
    guid: 'abc-123',
    title: 'Senior TypeScript Developer',
    companyName: 'Acme Corp',
    slug: 'senior-typescript-developer-acme',
    employmentTypes: [
      { type: 'b2b', fromPln: 15000, toPln: 22000 },
      { type: 'permanent', fromPln: 12000, toPln: 18000 },
    ],
  },
  {
    guid: 'def-456',
    title: 'Node.js Engineer',
    companyName: 'Beta Ltd',
    slug: 'nodejs-engineer-beta',
    employmentTypes: [
      { type: 'b2b', fromPln: 10000, toPln: 16000 },
    ],
  },
  {
    // malformed — no title
    guid: 'bad-789',
    companyName: 'Bad Corp',
    slug: 'bad',
    employmentTypes: [],
  },
];

const mockResponse = {
  data: mockOffers,
  meta: { totalPages: 1, nextPage: null },
};

describe('fetchJustJoin()', () => {
  it('normalizes b2b + uop salary fields correctly', async () => {
    server.use(
      http.get('https://api.justjoin.it/v2/user-panel/offers', () =>
        HttpResponse.json({ data: [mockOffers[0]], meta: { totalPages: 1, nextPage: null } })
      )
    );

    const jobs = await fetchJustJoin();

    expect(jobs).toHaveLength(1);

    const first = jobs[0]!;
    expect(first.id).toBe('jj-abc-123');
    expect(first.source).toBe('justjoin');
    expect(first.salary_b2b_min).toBe(15000);
    expect(first.salary_b2b_max).toBe(22000);
    expect(first.salary_uop_min).toBe(12000);
    expect(first.salary_uop_max).toBe(18000);
    expect(first.currency).toBe('PLN');
    expect(first.status).toBe('NEW');
  });

  it('handles b2b-only offer (uop salary null)', async () => {
    server.use(
      http.get('https://api.justjoin.it/v2/user-panel/offers', () =>
        HttpResponse.json({ data: [mockOffers[1]], meta: { totalPages: 1, nextPage: null } })
      )
    );

    const jobs = await fetchJustJoin();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.salary_uop_min).toBeNull();
    expect(jobs[0]!.salary_uop_max).toBeNull();
    expect(jobs[0]!.salary_b2b_min).toBe(10000);
  });

  it('skips malformed records missing title', async () => {
    server.use(
      http.get('https://api.justjoin.it/v2/user-panel/offers', () =>
        HttpResponse.json(mockResponse)
      )
    );

    const jobs = await fetchJustJoin();
    const ids = jobs.map((j) => j.id);
    expect(ids).not.toContain('jj-bad-789');
  });

  it('returns empty array on non-200 response (non-fatal)', async () => {
    server.use(
      http.get('https://api.justjoin.it/v2/user-panel/offers', () =>
        HttpResponse.json({ error: 'server error' }, { status: 500 })
      )
    );

    const jobs = await fetchJustJoin();
    expect(jobs).toEqual([]);
  });
});
