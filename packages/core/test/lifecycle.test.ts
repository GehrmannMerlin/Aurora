import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';

describe('AuroraCore lifecycle', () => {
  it('creates independent state and initializes once', async () => {
    const core = createCore();
    expect(core.getState()).toBe('created');
    expect(core.getConfig()).toBeNull();

    await expect(core.initialize()).resolves.toEqual({
      ok: true,
      code: 'initialized',
      state: 'initialized',
      diagnosticsAdded: 0,
    });
    expect(core.getState()).toBe('initialized');
    expect(core.getConfig()).toEqual({ maxDiagnosticEntries: 100 });
    expect(Object.isFrozen(core.getConfig())).toBe(true);
  });

  it('keeps created after invalid initialization and permits a valid retry', async () => {
    const core = createCore();
    await expect(core.initialize({ maxDiagnosticEntries: 0 })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_configuration',
      state: 'created',
      diagnosticsAdded: 1,
    });
    expect(core.getState()).toBe('created');
    await expect(core.initialize({ maxDiagnosticEntries: 8 })).resolves.toMatchObject({
      ok: true,
      code: 'initialized',
      state: 'initialized',
    });
  });

  it('distinguishes idempotent initialization from a locked configuration change', async () => {
    const core = createCore();
    await core.initialize({ maxDiagnosticEntries: 8 });
    await expect(core.initialize()).resolves.toMatchObject({
      ok: true,
      code: 'already_initialized',
    });
    await expect(core.initialize({ maxDiagnosticEntries: 8 })).resolves.toMatchObject({
      ok: true,
      code: 'already_initialized',
    });
    await expect(core.initialize({ maxDiagnosticEntries: 9 })).resolves.toMatchObject({
      ok: false,
      code: 'configuration_locked',
      diagnosticsAdded: 1,
    });
    expect(core.getConfig()).toEqual({ maxDiagnosticEntries: 8 });
  });

  it('starts, stops, restarts, and treats repeats as idempotent', async () => {
    const core = createCore();
    await expect(core.start()).resolves.toMatchObject({ ok: false, code: 'not_initialized' });
    await expect(core.stop()).resolves.toMatchObject({ ok: false, code: 'not_initialized' });
    await core.initialize();
    await expect(core.start()).resolves.toMatchObject({ ok: true, code: 'started' });
    await expect(core.initialize()).resolves.toMatchObject({
      ok: true,
      code: 'already_initialized',
    });
    await expect(core.start()).resolves.toMatchObject({ ok: true, code: 'already_started' });
    await expect(core.stop()).resolves.toMatchObject({ ok: true, code: 'stopped' });
    await expect(core.stop()).resolves.toMatchObject({ ok: true, code: 'already_stopped' });
    await expect(core.start()).resolves.toMatchObject({ ok: true, code: 'started' });
    expect(core.getState()).toBe('started');
  });

  it('destroys from every live state and never revives', async () => {
    for (const prepare of [
      () => Promise.resolve(createCore()),
      async () => {
        const core = createCore();
        await core.initialize();
        return core;
      },
      async () => {
        const core = createCore();
        await core.initialize();
        await core.start();
        return core;
      },
      async () => {
        const core = createCore();
        await core.initialize();
        await core.start();
        await core.stop();
        return core;
      },
    ]) {
      const core = await prepare();
      await expect(core.destroy()).resolves.toMatchObject({ ok: true, code: 'destroyed' });
      await expect(core.destroy()).resolves.toMatchObject({ ok: true, code: 'already_destroyed' });
      await expect(core.initialize()).resolves.toMatchObject({ ok: false, code: 'destroyed' });
      await expect(core.start()).resolves.toMatchObject({ ok: false, code: 'destroyed' });
      await expect(core.stop()).resolves.toMatchObject({ ok: false, code: 'destroyed' });
      expect(core.getState()).toBe('destroyed');
    }
  });

  it('serializes concurrent lifecycle calls in invocation order', async () => {
    const core = createCore();
    const results = await Promise.all([
      core.initialize(),
      core.start(),
      core.start(),
      core.stop(),
      core.destroy(),
      core.start(),
    ]);
    expect(results.map(({ code }) => code)).toEqual([
      'initialized',
      'started',
      'already_started',
      'stopped',
      'destroyed',
      'destroyed',
    ]);
  });
});
