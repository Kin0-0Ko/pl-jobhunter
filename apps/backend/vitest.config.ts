import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      // Keep retry backoff near-zero in tests; real defaults would add seconds per failing case.
      AI_BACKOFF_BASE_MS: '1',
      NVIDIA_MIN_INTERVAL_MS: '0',
    },
  },
});
