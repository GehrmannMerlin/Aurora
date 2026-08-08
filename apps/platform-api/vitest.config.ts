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
      thresholds: {
        branches: 75,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
