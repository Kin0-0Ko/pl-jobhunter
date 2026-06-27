import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { scoreJob } from './ollama.js';
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
    expect(result).not.toBeNull();
    expect(result!.match_score).toBe(85);
    expect(result!.tech_stack).toContain('TypeScript');
    expect(typeof result!.summary).toBe('string');
    expect(typeof result!.why_good).toBe('string');
  });

  it('retries once on malformed JSON and returns null on second failure', async () => {
    let callCount = 0;
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        return HttpResponse.json({ response: 'not valid json {{{' });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result).toBeNull();
    expect(callCount).toBe(2);
  });

  it('retries once on HTTP error and returns null on second failure', async () => {
    let callCount = 0;
    server.use(
      http.post('http://127.0.0.1:11434/api/generate', () => {
        callCount++;
        return HttpResponse.json({ error: 'model not loaded' }, { status: 500 });
      })
    );

    const result = await scoreJob(mockJob);
    expect(result).toBeNull();
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
    expect(result).not.toBeNull();
    expect(result!.match_score).toBe(85);
    expect(callCount).toBe(2);
  });
});
