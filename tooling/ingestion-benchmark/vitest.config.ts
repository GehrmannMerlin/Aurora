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
        find: /^@aurora\/ingestion-credentials$/,
        replacement: fileURLToPath(
          new URL('../../packages/ingestion-credentials/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/ingestion-api$/,
        replacement: fileURLToPath(
          new URL('../../apps/ingestion-api/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/ingestion-worker$/,
        replacement: fileURLToPath(
          new URL('../../apps/ingestion-worker/src/index.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/cli.ts', 'src/harness.ts'],
    },
  },
});
