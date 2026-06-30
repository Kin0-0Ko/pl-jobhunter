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
  it('sends correct HTML alert format', async () => {
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
    expect(String(capturedBody!['text'])).toContain('ETL Run Failed');
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

describe('sendRunDigest', () => {
  it('sends HTML digest with run stats and top jobs', async () => {
    stubEnv();
    let capturedBody: Record<string, unknown> | null = null;

    server.use(
      http.post(`${TELEGRAM_API}/bot${BOT_TOKEN}/sendMessage`, async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ok: true, result: { message_id: 2 } });
      }),
    );

    const { sendRunDigest } = await importFresh();
    await sendRunDigest({
      completedAt: new Date('2026-06-30T14:00:00Z'),
      rawTotal: 1532,
      filtered: 1452,
      inserted: 48,
      scored: 48,
      fallback: 0,
      topJobs: [{ id: 'jj-abc123', title: 'TS Dev', company: 'Acme', url: 'https://justjoin.it/offers/acme-ts-dev', salaryDisplay: '18k–24k PLN (B2B)', score: 95, stack: ['TypeScript', 'Node.js'] }],
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!['parse_mode']).toBe('HTML');
    const text = String(capturedBody!['text']);
    expect(text).toContain('ETL Run Complete');
    expect(text).toContain('Fetched: 1532');
    expect(text).toContain('TS Dev');
    expect(text).toContain('18k–24k PLN (B2B)');
    expect(text).toContain('TypeScript');
    const keyboard = capturedBody!['reply_markup'] as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    expect(keyboard.inline_keyboard[0]?.[0]?.callback_data).toBe('job:0');
    expect(keyboard.inline_keyboard[0]?.[0]?.text).toContain('TS Dev');
  });

  it('sends "no new jobs" when inserted = 0', async () => {
    stubEnv();
    let capturedBody: Record<string, unknown> | null = null;

    server.use(
      http.post(`${TELEGRAM_API}/bot${BOT_TOKEN}/sendMessage`, async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ok: true, result: { message_id: 3 } });
      }),
    );

    const { sendRunDigest } = await importFresh();
    await sendRunDigest({
      completedAt: new Date('2026-06-30T14:00:00Z'),
      rawTotal: 200,
      filtered: 190,
      inserted: 0,
      scored: 0,
      fallback: 0,
      topJobs: [],
    });

    expect(String(capturedBody!['text'])).toContain('No new jobs this run');
  });

});
