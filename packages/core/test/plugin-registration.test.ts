import { describe, expect, expectTypeOf, it } from 'vitest';
import { createCore, type CorePlugin, type CorePluginContext } from '../src/index.js';

function createPlugin(name: string): CorePlugin {
  return {
    name,
    initialize: (): void => undefined,
    start: (): void => undefined,
    stop: (): void => undefined,
    destroy: (): void => undefined,
  };
}

describe('AuroraCore plugin registration', () => {
  it('registers a valid plugin and rejects its duplicate name', () => {
    const core = createCore();
    expect(core.registerPlugin(createPlugin('request-plugin'))).toEqual({
      ok: true,
      code: 'registered',
      pluginName: 'request-plugin',
      state: 'created',
      diagnosticsAdded: 0,
    });
    expect(core.registerPlugin(createPlugin('request-plugin'))).toMatchObject({
      ok: false,
      code: 'duplicate_plugin',
      state: 'created',
      diagnosticsAdded: 1,
    });
  });

  it.each([
    null,
    {},
    { name: '' },
    {
      name: 'Upper-Case',
      initialize: (): void => undefined,
      start: (): void => undefined,
      stop: (): void => undefined,
      destroy: (): void => undefined,
    },
    {
      name: 'missing-start',
      initialize: (): void => undefined,
      stop: (): void => undefined,
      destroy: (): void => undefined,
    },
    {
      name: 'extra-long-' + 'a'.repeat(64),
      initialize: (): void => undefined,
      start: (): void => undefined,
      stop: (): void => undefined,
      destroy: (): void => undefined,
    },
  ])('rejects an invalid runtime plugin %#', (input) => {
    const core = createCore();
    expect(core.registerPlugin(input)).toMatchObject({
      ok: false,
      code: 'invalid_plugin',
      diagnosticsAdded: 1,
    });
  });

  it('contains hostile plugin property access', () => {
    const core = createCore();
    const input = new Proxy(
      {},
      {
        get(): never {
          throw new Error('credential-in-exception');
        },
      },
    );
    expect(() => core.registerPlugin(input)).not.toThrow();
    expect(core.registerPlugin(input)).toMatchObject({ ok: false, code: 'invalid_plugin' });
    expect(JSON.stringify(core.getDiagnostics())).not.toContain('credential-in-exception');
  });

  it('closes registration on the first initialize attempt and after destroy', async () => {
    const failedInitializeCore = createCore();
    await failedInitializeCore.initialize({ maxDiagnosticEntries: 0 });
    expect(failedInitializeCore.registerPlugin(createPlugin('late-plugin'))).toMatchObject({
      ok: false,
      code: 'registration_closed',
    });

    const destroyedCore = createCore();
    await destroyedCore.destroy();
    expect(destroyedCore.registerPlugin(createPlugin('late-plugin'))).toMatchObject({
      ok: false,
      code: 'destroyed',
    });
  });

  it('exposes only event submission to plugin initialization', () => {
    expectTypeOf<keyof CorePluginContext>().toEqualTypeOf<'submitEvent'>();
  });
});
