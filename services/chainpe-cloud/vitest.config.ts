import { defineConfig } from 'vitest/config'

// All test files share one real Postgres database, so they run one at a time.
export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
