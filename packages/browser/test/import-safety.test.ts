import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('Browser import safety', () => {
  it('imports in Node without window or document', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    await expect(import('../src/index.js')).resolves.toBeDefined();
  });
});
