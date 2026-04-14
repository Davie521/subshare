import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**', '**/.next/**'],
    // Coverage (v8 instrumentation) roughly doubles pglite setup time.
    // Bump both the hook and test-body budgets so suites whose
    // setupTestDb() runs either in beforeEach or inline don't time out
    // under --coverage.
    hookTimeout: 30000,
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Thresholds are floors, set a few pts below current coverage so an
      // obvious regression trips CI but ordinary drift doesn't. Raise once
      // fx-cache.ts (network fetch) and the untouched schema/migrate helpers
      // gain unit coverage.
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 70,
        branches: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
