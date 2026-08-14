import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      {
        find: /^@aurora\/platform-contract$/,
        replacement: fileURLToPath(
          new URL('../../packages/platform-contract/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/platform-contract\/client$/,
        replacement: fileURLToPath(
          new URL('../../packages/platform-contract/src/client/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/platform-contract\/contract-testkit$/,
        replacement: fileURLToPath(
          new URL(
            '../../packages/platform-contract/src/contract-testkit/index.ts',
            import.meta.url,
          ),
        ),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // MSW handlers are test/dev fixtures, not production application code.
      // Their behavior is covered by unit/browser tests but must not dilute the
      // production TypeScript coverage denominator.
      exclude: ['src/main.ts', 'src/mocks/**'],
      reporter: ['text', 'json-summary'],
      thresholds: { branches: 75, functions: 80, lines: 80, statements: 80 },
    },
  },
});
