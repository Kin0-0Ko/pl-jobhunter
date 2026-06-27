import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { fetchNoFluff } from './nofluff.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const page1 = {
  totalPages: 2,
  postings: [
    {
      id: 'nf-001',
      title: 'React Developer',
      name: 'Gamma Inc',
      url: 'https://nofluffjobs.com/job/nf-001',
      salary: { type: 'b2b', from: 14000, to: 20000, currency: 'PLN' },
    },
  ],
};

const page2 = {
  totalPages: 2,
  postings: [
    {
      id: 'nf-002',
      title: 'Backend Engineer',
      name: 'Delta Co',
      url: 'https://nofluffjobs.com/job/nf-002',
      salary: { type: 'permanent', from: 11000, to: 15000, currency: 'PLN' },
    },
    {
      // malformed — no name
      id: 'bad-003',
      title: 'Mystery Role',
      url: 'https://nofluffjobs.com/job/bad-003',
      salary: null,
    },
  ],
};

describe('fetchNoFluff()', () => {
  it('paginates through all pages', async () => {
    let callCount = 0;
    server.use(
      http.post('https://nofluffjobs.com/api/search/posting', async ({ request }) => {
        const body = (await request.json()) as { page: number };
        callCount++;
        return HttpResponse.json(body.page === 1 ? page1 : page2);
      })
    );

    const jobs = await fetchNoFluff();
    expect(callCount).toBe(2);
    expect(jobs).toHaveLength(2);
  });

  it('maps b2b salary correctly', async () => {
    server.use(
      http.post('https://nofluffjobs.com/api/search/posting', () =>
        HttpResponse.json({ totalPages: 1, postings: [page1.postings[0]] })
      )
    );

    const jobs = await fetchNoFluff();
    expect(jobs[0].id).toBe('nf-nf-001');
    expect(jobs[0].salary_b2b_min).toBe(14000);
    expect(jobs[0].salary_b2b_max).toBe(20000);
    expect(jobs[0].salary_uop_min).toBeNull();
    expect(jobs[0].source).toBe('nofluff');
  });

  it('maps uop (permanent) salary correctly', async () => {
    server.use(
      http.post('https://nofluffjobs.com/api/search/posting', () =>
        HttpResponse.json({ totalPages: 1, postings: [page2.postings[0]] })
      )
    );

    const jobs = await fetchNoFluff();
    expect(jobs[0].salary_uop_min).toBe(11000);
    expect(jobs[0].salary_uop_max).toBe(15000);
    expect(jobs[0].salary_b2b_min).toBeNull();
  });

  it('skips malformed records missing company name', async () => {
    server.use(
      http.post('https://nofluffjobs.com/api/search/posting', () =>
        HttpResponse.json({ totalPages: 1, postings: page2.postings })
      )
    );

    const jobs = await fetchNoFluff();
    const ids = jobs.map((j) => j.id);
    expect(ids).not.toContain('nf-bad-003');
  });

  it('throws on non-200 response', async () => {
    server.use(
      http.post('https://nofluffjobs.com/api/search/posting', () =>
        HttpResponse.json({ error: 'rate limited' }, { status: 429 })
      )
    );

    await expect(fetchNoFluff()).rejects.toThrow('NoFluffJobs API error: 429');
  });
});
