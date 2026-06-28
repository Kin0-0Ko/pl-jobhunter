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
    company_name: 'Acme Corp',
    offer_url: 'https://justjoin.it/offers/abc-123',
    employment_types: [
      { type: 'b2b', salary: { from: 15000, to: 22000, currency: 'PLN' } },
      { type: 'permanent', salary: { from: 12000, to: 18000, currency: 'PLN' } },
    ],
  },
  {
    id: 'def-456',
    title: 'Node.js Engineer',
    company_name: 'Beta Ltd',
    offer_url: 'https://justjoin.it/offers/def-456',
    employment_types: [
      { type: 'b2b', salary: { from: 10000, to: 16000, currency: 'PLN' } },
    ],
  },
  {
    // malformed — no title
    id: 'bad-789',
    company_name: 'Bad Corp',
    employment_types: [],
  },
];

describe('fetchJustJoin()', () => {
  it('normalizes b2b + uop salary fields correctly', async () => {
    server.use(
      http.get('https://justjoin.it/api/offers', () =>
        HttpResponse.json(mockOffers)
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
      http.get('https://justjoin.it/api/offers', () =>
        HttpResponse.json([mockOffers[1]])
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
      http.get('https://justjoin.it/api/offers', () =>
        HttpResponse.json(mockOffers)
      )
    );

    const jobs = await fetchJustJoin();
    const ids = jobs.map((j) => j.id);
    expect(ids).not.toContain('jj-bad-789');
  });

  it('throws on non-200 response', async () => {
    server.use(
      http.get('https://justjoin.it/api/offers', () =>
        HttpResponse.json({ error: 'server error' }, { status: 500 })
      )
    );

    await expect(fetchJustJoin()).rejects.toThrow('JustJoin API error: 500');
  });
});
