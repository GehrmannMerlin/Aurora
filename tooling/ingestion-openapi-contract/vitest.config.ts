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
        find: /^@aurora\/event-schema\/contract-testkit$/,
        replacement: fileURLToPath(
          new URL('../../packages/event-schema/src/contract-testkit/index.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
