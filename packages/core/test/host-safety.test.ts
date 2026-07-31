import { describe, expect, it } from 'vitest';
import { createCore, type CorePlugin } from '../src/index.js';

describe('AuroraCore host safety', () => {
  it('never rejects lifecycle promises for plugin exceptions', async () => {
    const initializeFailure: CorePlugin = {
      name: 'initialize-failure',
      initialize: (): Promise<never> => Promise.reject(new Error('credential=hidden')),
      start: (): void => undefined,
      stop: (): void => undefined,
      destroy: (): void => undefined,
    };
    const startFailure: CorePlugin = {
      name: 'start-failure',
      initialize: (): void => undefined,
      start: (): never => {
        throw new Error('start hidden');
      },
      stop: (): void => undefined,
      destroy: (): void => undefined,
    };
    const stopFailure: CorePlugin = {
      name: 'stop-failure',
      initialize: (): void => undefined,
      start: (): void => undefined,
      stop: (): Promise<never> => Promise.reject(new Error('stop hidden')),
      destroy: (): void => undefined,
    };
    const destroyFailure: CorePlugin = {
      name: 'destroy-failure',
      initialize: (): void => undefined,
      start: (): void => undefined,
      stop: (): void => undefined,
      destroy: (): never => {
        throw new Error('destroy hidden');
      },
    };
    const core = createCore();
    for (const plugin of [initializeFailure, startFailure, stopFailure, destroyFailure]) {
      expect(() => core.registerPlugin(plugin)).not.toThrow();
    }
    await expect(core.initialize()).resolves.toMatchObject({ ok: true });
    await expect(core.start()).resolves.toMatchObject({ ok: true });
    await expect(core.stop()).resolves.toMatchObject({ ok: true });
    await expect(core.destroy()).resolves.toMatchObject({ ok: true });
    expect(core.getDiagnostics().map(({ code }) => code)).toEqual([
      'plugin_initialize_failed',
      'plugin_start_failed',
      'plugin_stop_failed',
      'plugin_destroy_failed',
    ]);
    const serialized = JSON.stringify(core.getDiagnostics());
    expect(serialized).not.toContain('credential');
    expect(serialized).not.toContain('hidden');
    expect(serialized).not.toContain('stack');
  });

  it('keeps diagnostics bounded under repeated rejected input', async () => {
    const core = createCore();
    await core.initialize({ maxDiagnosticEntries: 2 });
    core.submitEvent(null);
    core.submitEvent(null);
    core.submitEvent(null);
    expect(core.getDiagnostics().map(({ sequence }) => sequence)).toEqual([2, 3]);
  });

  it('trims the oldest diagnostics when an allowed update shrinks capacity', async () => {
    const core = createCore();
    await core.initialize({ maxDiagnosticEntries: 3 });
    core.submitEvent(null);
    core.submitEvent(null);
    core.submitEvent(null);
    expect(core.updateConfig({ maxDiagnosticEntries: 1 })).toMatchObject({ ok: true });
    expect(core.getDiagnostics().map(({ sequence }) => sequence)).toEqual([3]);
  });
});
