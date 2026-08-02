import { EventType } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import {
  createCore,
  type CorePlugin,
  type CorePluginContext,
  type CoreEventDraftResult,
} from '../src/index.js';

function loggingPlugin(name: string, log: string[]): CorePlugin {
  return {
    name,
    initialize: (): void => {
      log.push(`initialize:${name}`);
    },
    start: (): void => {
      log.push(`start:${name}`);
    },
    stop: (): void => {
      log.push(`stop:${name}`);
    },
    destroy: (): void => {
      log.push(`destroy:${name}`);
    },
  };
}

describe('AuroraCore plugin lifecycle', () => {
  it('initializes and starts in registration order, then stops and destroys in reverse order', async () => {
    const log: string[] = [];
    const core = createCore();
    core.registerPlugin(loggingPlugin('first-plugin', log));
    core.registerPlugin(loggingPlugin('second-plugin', log));
    await core.initialize();
    await core.initialize();
    await core.start();
    await core.start();
    await core.stop();
    await core.stop();
    await core.start();
    await core.destroy();
    expect(log).toEqual([
      'initialize:first-plugin',
      'initialize:second-plugin',
      'start:first-plugin',
      'start:second-plugin',
      'stop:second-plugin',
      'stop:first-plugin',
      'start:first-plugin',
      'start:second-plugin',
      'stop:second-plugin',
      'stop:first-plugin',
      'destroy:second-plugin',
      'destroy:first-plugin',
    ]);
    const finalLog = [...log];
    await core.start();
    expect(log).toEqual(finalLog);
  });

  it('captures hook methods at registration', async () => {
    const log: string[] = [];
    const plugin = loggingPlugin('snapshot-plugin', log);
    const core = createCore();
    core.registerPlugin(plugin);
    plugin.start = (): void => {
      log.push('start:replacement');
    };
    await core.initialize();
    await core.start();
    expect(log).toContain('start:snapshot-plugin');
    expect(log).not.toContain('start:replacement');
  });

  it('does not overlap a queued start with asynchronous initialization', async () => {
    const log: string[] = [];
    let releaseInitialize: (() => void) | undefined;
    const initializeGate = new Promise<void>((resolve) => {
      releaseInitialize = resolve;
    });
    const core = createCore();
    core.registerPlugin({
      name: 'serialized-plugin',
      initialize: async (): Promise<void> => {
        log.push('initialize:begin');
        await initializeGate;
        log.push('initialize:end');
      },
      start: (): void => {
        log.push('start');
      },
      stop: (): void => undefined,
      destroy: (): void => undefined,
    });
    const initializeResult = core.initialize();
    const startResult = core.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(['initialize:begin']);
    if (releaseInitialize === undefined) throw new Error('initialize hook did not start');
    releaseInitialize();
    await expect(initializeResult).resolves.toMatchObject({ code: 'initialized' });
    await expect(startResult).resolves.toMatchObject({ code: 'started' });
    expect(log).toEqual(['initialize:begin', 'initialize:end', 'start']);
  });

  it('quarantines an initialize failure and continues other plugins', async () => {
    const log: string[] = [];
    const failed: CorePlugin = {
      ...loggingPlugin('failed-plugin', log),
      initialize: (): never => {
        log.push('initialize:failed-plugin');
        throw new Error('private initialize failure');
      },
    };
    const core = createCore();
    core.registerPlugin(failed);
    core.registerPlugin(loggingPlugin('healthy-plugin', log));
    await expect(core.initialize()).resolves.toMatchObject({
      ok: true,
      code: 'initialized',
      diagnosticsAdded: 1,
    });
    await core.start();
    expect(log).toEqual([
      'initialize:failed-plugin',
      'initialize:healthy-plugin',
      'start:healthy-plugin',
    ]);
    expect(core.getDiagnostics()).toEqual([
      {
        sequence: 1,
        code: 'plugin_initialize_failed',
        operation: 'initialize',
        pluginName: 'failed-plugin',
      },
    ]);
    await core.destroy();
    expect(log.slice(-2)).toEqual(['destroy:healthy-plugin', 'destroy:failed-plugin']);
  });

  it('isolates start and stop failures while preserving order and cleanup', async () => {
    const log: string[] = [];
    const startFailure: CorePlugin = {
      ...loggingPlugin('start-failure', log),
      start: (): never => {
        log.push('start:start-failure');
        throw new Error('start secret');
      },
    };
    const stopFailure: CorePlugin = {
      ...loggingPlugin('stop-failure', log),
      stop: (): Promise<never> => {
        log.push('stop:stop-failure');
        return Promise.reject(new Error('stop secret'));
      },
    };
    const core = createCore();
    core.registerPlugin(startFailure);
    core.registerPlugin(stopFailure);
    core.registerPlugin(loggingPlugin('healthy-plugin', log));
    await core.initialize();
    await expect(core.start()).resolves.toMatchObject({ ok: true, diagnosticsAdded: 1 });
    await expect(core.stop()).resolves.toMatchObject({ ok: true, diagnosticsAdded: 1 });
    await core.start();
    await core.destroy();
    expect(log.filter((entry) => entry === 'start:start-failure')).toHaveLength(1);
    expect(log.filter((entry) => entry === 'stop:stop-failure')).toHaveLength(1);
    expect(log.filter((entry) => entry === 'start:stop-failure')).toHaveLength(1);
    expect(log).toContain('start:healthy-plugin');
    expect(log).toContain('stop:healthy-plugin');
    expect(log.slice(-3)).toEqual([
      'destroy:healthy-plugin',
      'destroy:stop-failure',
      'destroy:start-failure',
    ]);
  });

  it('destroys every registered plugin once even before initialization and contains destroy failure', async () => {
    const log: string[] = [];
    const failedDestroy: CorePlugin = {
      ...loggingPlugin('failed-destroy', log),
      destroy: (): never => {
        log.push('destroy:failed-destroy');
        throw new Error('destroy secret');
      },
    };
    const core = createCore();
    core.registerPlugin(loggingPlugin('first-plugin', log));
    core.registerPlugin(failedDestroy);
    await expect(core.destroy()).resolves.toMatchObject({
      ok: true,
      code: 'destroyed',
      diagnosticsAdded: 1,
    });
    await core.destroy();
    expect(log).toEqual(['destroy:failed-destroy', 'destroy:first-plugin']);
  });

  it('gives plugins only a frozen event entry bound to the same Core', async () => {
    let context: CorePluginContext | undefined;
    let duringInitialize: CoreEventDraftResult | undefined;
    const core = createCore();
    core.registerPlugin({
      name: 'context-plugin',
      initialize: (received: CorePluginContext): void => {
        context = received;
        duringInitialize = received.submitEvent({ eventType: EventType.Error, body: {} });
      },
      start: (): void => undefined,
      stop: (): void => undefined,
      destroy: (): void => undefined,
    });
    await core.initialize();
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.keys(context ?? {})).toEqual(['submitEvent']);
    expect(duringInitialize).toMatchObject({ ok: false, code: 'not_started' });
    await core.start();
    expect(context?.submitEvent({ eventType: EventType.Error, body: {} })).toMatchObject({
      ok: true,
      code: 'accepted',
    });
    await core.destroy();
    expect(context?.submitEvent({ eventType: EventType.Error, body: {} })).toMatchObject({
      ok: false,
      code: 'destroyed',
    });
  });

  it('rejects a full envelope passed through plugin context as invalid draft', async () => {
    const core = createCore();
    core.registerPlugin({
      name: 'envelope-blocker',
      initialize: (): void => undefined,
      start: (): void => undefined,
      stop: (): void => undefined,
      destroy: (): void => undefined,
    });
    await core.initialize();
    await core.start();
    const result = core.submitEventDraft({
      eventType: EventType.Error,
      body: {},
      eventId: 'forged',
    });
    expect(result).toEqual({
      ok: false,
      code: 'invalid_event_draft',
      state: 'started',
      diagnosticsAdded: 1,
    });
  });
});
