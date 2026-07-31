import { describe, expect, it } from 'vitest';
import { parseConfigurationUpdate, parseInitialConfiguration } from '../src/configuration.js';
import { DiagnosticStore } from '../src/diagnostics.js';
import { createCore } from '../src/index.js';

describe('Core configuration', () => {
  it('uses the immutable default when configuration is absent', () => {
    const result = parseInitialConfiguration(undefined);
    expect(result).toEqual({ ok: true, config: { maxDiagnosticEntries: 100 } });
    if (!result.ok) throw new Error('expected valid configuration');
    expect(Object.isFrozen(result.config)).toBe(true);
  });

  it('treats an empty initial object as having no required fields', () => {
    expect(parseInitialConfiguration({})).toEqual({
      ok: true,
      config: { maxDiagnosticEntries: 100 },
    });
  });

  it('copies and freezes a valid caller configuration', () => {
    const input = { maxDiagnosticEntries: 7 };
    const result = parseInitialConfiguration(input);
    input.maxDiagnosticEntries = 9;
    expect(result).toEqual({ ok: true, config: { maxDiagnosticEntries: 7 } });
    if (!result.ok) throw new Error('expected valid configuration');
    expect(Reflect.set(result.config, 'maxDiagnosticEntries', 11)).toBe(false);
  });

  it.each([
    null,
    [],
    () => undefined,
    { maxDiagnosticEntries: 0 },
    { maxDiagnosticEntries: 1001 },
    { maxDiagnosticEntries: 1.5 },
    { maxDiagnosticEntries: Number.NaN },
    { maxDiagnosticEntries: 5, endpoint: 'not-approved' },
    { [Symbol('unexpected')]: true },
  ])('rejects invalid or expanded initial input %#', (input) => {
    expect(parseInitialConfiguration(input)).toEqual({ ok: false });
  });

  it('rejects hostile property access without throwing', () => {
    const input = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('secret value');
        },
      },
    );
    expect(() => parseInitialConfiguration(input)).not.toThrow();
    expect(parseInitialConfiguration(input)).toEqual({ ok: false });
  });

  it('requires the one approved field for updates', () => {
    expect(parseConfigurationUpdate({})).toEqual({ ok: false });
    expect(parseConfigurationUpdate({ maxDiagnosticEntries: 25 })).toEqual({
      ok: true,
      config: { maxDiagnosticEntries: 25 },
    });
  });
});

describe('Core diagnostics', () => {
  it('keeps the newest entries with an instance-local monotonic sequence', () => {
    const store = new DiagnosticStore(2);
    store.add({ code: 'invalid_event', operation: 'submit_event' });
    store.add({ code: 'plugin_start_failed', operation: 'start', pluginName: 'first-plugin' });
    store.add({ code: 'event_rejected', operation: 'submit_event' });
    expect(store.snapshot()).toEqual([
      { sequence: 2, code: 'plugin_start_failed', operation: 'start', pluginName: 'first-plugin' },
      { sequence: 3, code: 'event_rejected', operation: 'submit_event' },
    ]);
  });

  it('returns frozen copies and trims immediately when capacity shrinks', () => {
    const store = new DiagnosticStore(3);
    store.add({ code: 'invalid_event', operation: 'submit_event' });
    store.add({ code: 'event_rejected', operation: 'submit_event' });
    store.add({ code: 'invalid_plugin', operation: 'register_plugin' });
    store.setCapacity(1);
    const snapshot = store.snapshot();
    expect(snapshot).toEqual([
      { sequence: 3, code: 'invalid_plugin', operation: 'register_plugin' },
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
  });
});

describe('AuroraCore public configuration boundary', () => {
  it('allows updates only while initialized or stopped', async () => {
    const core = createCore();
    expect(core.updateConfig({ maxDiagnosticEntries: 2 })).toMatchObject({
      ok: false,
      code: 'not_initialized',
    });
    await core.initialize();
    expect(core.updateConfig({ maxDiagnosticEntries: 2 })).toMatchObject({
      ok: true,
      code: 'configuration_updated',
      config: { maxDiagnosticEntries: 2 },
    });
    expect(core.updateConfig({ maxDiagnosticEntries: 2 })).toMatchObject({
      ok: true,
      code: 'configuration_updated',
      diagnosticsAdded: 0,
    });
    await core.start();
    expect(core.updateConfig({ maxDiagnosticEntries: 3 })).toMatchObject({
      ok: false,
      code: 'configuration_locked',
    });
    await core.stop();
    expect(core.updateConfig({ maxDiagnosticEntries: 3 })).toMatchObject({ ok: true });
    await core.destroy();
    expect(core.updateConfig({ maxDiagnosticEntries: 4 })).toMatchObject({
      ok: false,
      code: 'destroyed',
    });
  });

  it('does not retain update input and leaves configuration unchanged on failure', async () => {
    const core = createCore();
    await core.initialize({ maxDiagnosticEntries: 4 });
    const input = { maxDiagnosticEntries: 6 };
    const result = core.updateConfig(input);
    input.maxDiagnosticEntries = 9;
    expect(result).toMatchObject({ ok: true, config: { maxDiagnosticEntries: 6 } });
    expect(core.getConfig()).toEqual({ maxDiagnosticEntries: 6 });
    expect(core.updateConfig({ maxDiagnosticEntries: 0 })).toMatchObject({
      ok: false,
      code: 'invalid_configuration',
    });
    expect(core.getConfig()).toEqual({ maxDiagnosticEntries: 6 });
  });

  it('contains hostile public configuration input', async () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('configuration secret');
        },
      },
    );
    const core = createCore();
    await expect(core.initialize(hostile)).resolves.toMatchObject({
      ok: false,
      code: 'invalid_configuration',
    });
    await core.initialize();
    expect(() => core.updateConfig(hostile)).not.toThrow();
    expect(core.updateConfig(hostile)).toMatchObject({
      ok: false,
      code: 'invalid_configuration',
    });
    expect(JSON.stringify(core.getDiagnostics())).not.toContain('configuration secret');
  });
});
