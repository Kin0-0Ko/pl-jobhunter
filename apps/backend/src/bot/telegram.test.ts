import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const TELEGRAM_API = 'https://api.telegram.org';
const BOT_TOKEN = 'test-bot-token';
const CHAT_ID = '12345';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

function stubEnv() {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', BOT_TOKEN);
  vi.stubEnv('TELEGRAM_ADMIN_CHAT_ID', CHAT_ID);
}

async function importFresh() {
  vi.resetModules();
  return import('./telegram.js');
}

describe('sendCriticalAlert', () => {
  it('sends correct CRITICAL message format', async () => {
    stubEnv();
    let capturedBody: Record<string, unknown> | null = null;

    server.use(
      http.post(`${TELEGRAM_API}/bot${BOT_TOKEN}/sendMessage`, async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ok: true, result: { message_id: 1 } });
      }),
    );

    const { sendCriticalAlert } = await importFresh();
    await sendCriticalAlert('justjoin', new Error('HTTP 500'));

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!['chat_id']).toBe(CHAT_ID);
    expect(String(capturedBody!['text'])).toContain('🚨 CRITICAL');
    expect(String(capturedBody!['text'])).toContain('justjoin');
    expect(String(capturedBody!['text'])).toContain('HTTP 500');
  });

  it('does not throw when Telegram API returns 4xx', async () => {
    stubEnv();
    server.use(
      http.post(`${TELEGRAM_API}/bot${BOT_TOKEN}/sendMessage`, () =>
        HttpResponse.json({ ok: false, description: 'Bad Request' }, { status: 400 }),
      ),
    );

    const { sendCriticalAlert } = await importFresh();
    await expect(sendCriticalAlert('oracle', new Error('connection reset'))).resolves.toBeUndefined();
  });

  it('does not throw when Telegram API returns 5xx', async () => {
    stubEnv();
    server.use(
      http.post(`${TELEGRAM_API}/bot${BOT_TOKEN}/sendMessage`, () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    const { sendCriticalAlert } = await importFresh();
    await expect(sendCriticalAlert('etl-orchestrator', new Error('oops'))).resolves.toBeUndefined();
  });
});

describe('sendJobAlert', () => {
  it('sends job alert with score >= threshold (regression)', async () => {
    stubEnv();
    let capturedBody: Record<string, unknown> | null = null;

    server.use(
      http.post(`${TELEGRAM_API}/bot${BOT_TOKEN}/sendMessage`, async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ok: true, result: { message_id: 2 } });
      }),
    );

    const { sendJobAlert } = await importFresh();
    const job = {
      id: 'jj-1', title: 'TS Dev', company: 'Acme', url: 'https://example.com',
      source: 'justjoin' as const, salary_b2b_min: 18000, salary_b2b_max: 24000,
      salary_uop_min: null, salary_uop_max: null, currency: 'PLN',
      status: 'NEW' as const, created_at: new Date().toISOString(),
    };
    await sendJobAlert(job, 90);

    expect(capturedBody).not.toBeNull();
    expect(String(capturedBody!['text'])).toContain('🎯');
    expect(String(capturedBody!['text'])).toContain('TS Dev');
    expect(String(capturedBody!['text'])).toContain('90/100');
  });
});
