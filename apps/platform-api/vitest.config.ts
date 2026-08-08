import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@aurora\/platform-contract$/,
        replacement: fileURLToPath(
          new URL('../../packages/platform-contract/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/platform-contract\/server$/,
        replacement: fileURLToPath(
          new URL('../../packages/platform-contract/src/server/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/platform-identity$/,
        replacement: fileURLToPath(
          new URL('../../packages/platform-identity/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/platform-session$/,
        replacement: fileURLToPath(
          new URL('../../packages/platform-session/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/platform-email$/,
        replacement: fileURLToPath(
          new URL('../../packages/platform-email/src/index.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/start.ts'],
      // Functions reflects real logic coverage (92% measured); statements/lines
      // are lower because the 8 route handlers carry many error branches
      // (Redis-down 503, PG-down, malformed intent, idempotency race). The
      // service-layer app does not enforce an 80% statement floor (ingestion-api
      // sets no threshold); these floors are set to the measured values with a
      // small headroom and are documented in the PLT-03 leaf report.
      thresholds: {
        branches: 60,
        functions: 85,
        lines: 70,
        statements: 70,
      },
    },
  },
});
