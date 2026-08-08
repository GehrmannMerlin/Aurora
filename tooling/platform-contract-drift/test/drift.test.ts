import { describe, expect, it } from 'vitest';
import { assertPlatformDrift } from '../src/index.js';

describe('platform-contract drift gate', () => {
  it('passes against the committed artifact', async () => {
    await expect(assertPlatformDrift()).resolves.toBeUndefined();
  });

  it('catches an unregistered operation', async () => {
    // test-only: monkeypatch impossible in a pure module; a drifted YAML is NOT
    // written here — drift mutation is covered in Task 12's integration step.
    // This test instead exercises the helper that detects extra ops directly.
    const { detectUnregisteredOperations } = await import('../src/index.js');
    const { PLATFORM_OPERATIONS } = await import('@aurora/platform-contract');
    const fake = [...PLATFORM_OPERATIONS, { operationId: 'fakeOp' }];
    expect(detectUnregisteredOperations(fake as never)).toContain('fakeOp');
  });
});
