import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@aurora\/event-schema$/,
        replacement: fileURLToPath(
          new URL('../../packages/event-schema/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/ingestion-inbox$/,
        replacement: fileURLToPath(
          new URL('../../packages/ingestion-inbox/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/processing-store$/,
        replacement: fileURLToPath(
          new URL('../../packages/processing-store/src/index.ts', import.meta.url),
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
      exclude: ['src/index.ts'],
      thresholds: {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});
