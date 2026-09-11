import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Database tests share one local PostgreSQL; run files one at a time.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
