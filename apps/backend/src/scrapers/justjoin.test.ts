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
    id: 'abc-123',
    title: 'Senior TypeScript Developer',
    companyName: 'Acme Corp',
    offerUrl: 'https://justjoin.it/offers/abc-123',
    employmentTypes: [
      { type: 'b2b', salary: { from: 15000, to: 22000, currency: 'PLN' } },
      { type: 'permanent', salary: { from: 12000, to: 18000, currency: 'PLN' } },
    ],
  },
  {
    id: 'def-456',
    title: 'Node.js Engineer',
    companyName: 'Beta Ltd',
    offerUrl: 'https://justjoin.it/offers/def-456',
    employmentTypes: [
      { type: 'b2b', salary: { from: 10000, to: 16000, currency: 'PLN' } },
    ],
  },
  {
    // malformed — no title
    id: 'bad-789',
    companyName: 'Bad Corp',
    employmentTypes: [],
  },
];

describe('fetchJustJoin()', () => {
  it('normalizes b2b + uop salary fields correctly', async () => {
    server.use(
      http.post('https://justjoin.it/api/offers-with-filters', () =>
        HttpResponse.json({ data: mockOffers })
      )
    );

    const jobs = await fetchJustJoin();

    expect(jobs).toHaveLength(2);

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
      http.post('https://justjoin.it/api/offers-with-filters', () =>
        HttpResponse.json({ data: [mockOffers[1]] })
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
      http.post('https://justjoin.it/api/offers-with-filters', () =>
        HttpResponse.json({ data: mockOffers })
      )
    );

    const jobs = await fetchJustJoin();
    const ids = jobs.map((j) => j.id);
    expect(ids).not.toContain('jj-bad-789');
  });

  it('returns empty array on non-200 response (non-fatal)', async () => {
    server.use(
      http.post('https://justjoin.it/api/offers-with-filters', () =>
        HttpResponse.json({ error: 'server error' }, { status: 500 })
      )
    );

    const jobs = await fetchJustJoin();
    expect(jobs).toEqual([]);
  });
});
