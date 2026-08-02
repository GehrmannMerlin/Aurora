import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { branches: 80, functions: 85, lines: 85, statements: 85 },
    },
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
