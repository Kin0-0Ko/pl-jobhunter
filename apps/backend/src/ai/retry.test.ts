import { describe, it, expect } from 'vitest';
import { isRetryableAIError, retryAfterMs } from './ollama.js';

describe('isRetryableAIError', () => {
  it('retries on 429 — the rate limit that broke prod runs', () => {
    expect(isRetryableAIError({ status: 429 })).toBe(true);
  });

  it('retries on timeouts and 5xx', () => {
    expect(isRetryableAIError({ status: 408 })).toBe(true);
    expect(isRetryableAIError({ status: 500 })).toBe(true);
    expect(isRetryableAIError({ status: 503 })).toBe(true);
  });

  it('does not retry client errors that a retry cannot fix', () => {
    expect(isRetryableAIError({ status: 400 })).toBe(false);
    expect(isRetryableAIError({ status: 401 })).toBe(false);
    expect(isRetryableAIError({ status: 404 })).toBe(false);
  });

  it('retries errors with no status (network/abort)', () => {
    expect(isRetryableAIError(new Error('socket hang up'))).toBe(true);
    expect(isRetryableAIError({})).toBe(true);
  });
});

describe('retryAfterMs', () => {
  it('converts a numeric Retry-After header to ms', () => {
    expect(retryAfterMs({ status: 429, headers: { 'retry-after': '2' } })).toBe(2000);
    expect(retryAfterMs({ status: 429, headers: { 'retry-after': '0' } })).toBe(0);
  });

  it('returns null when the header is absent or unparseable', () => {
    expect(retryAfterMs({ status: 429, headers: {} })).toBeNull();
    expect(retryAfterMs({ status: 429 })).toBeNull();
    expect(retryAfterMs({ status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } })).toBeNull();
    expect(retryAfterMs(new Error('boom'))).toBeNull();
  });

  it('rejects negative values', () => {
    expect(retryAfterMs({ status: 429, headers: { 'retry-after': '-5' } })).toBeNull();
  });
});
