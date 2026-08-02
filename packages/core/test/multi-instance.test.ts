import { validEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';
import { EventType } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { createCore, type CorePlugin } from '../src/index.js';

function countedPlugin(name: string, counts: { starts: number; destroys: number }): CorePlugin {
  return {
    name,
    initialize: (): void => undefined,
    start: (): void => {
      counts.starts += 1;
    },
    stop: (): void => undefined,
    destroy: (): void => {
      counts.destroys += 1;
    },
  };
}

describe('AuroraCore multi-instance isolation', () => {
  it('isolates configuration, plugins, lifecycle, diagnostics, and events', async () => {
    const firstCounts = { starts: 0, destroys: 0 };
    const secondCounts = { starts: 0, destroys: 0 };
    const first = createCore();
    const second = createCore();
    expect(first.registerPlugin(countedPlugin('instance-plugin', firstCounts))).toMatchObject({
      ok: true,
    });
    expect(second.registerPlugin(countedPlugin('instance-plugin', secondCounts))).toMatchObject({
      ok: true,
    });
    await first.initialize({ maxDiagnosticEntries: 2 });
    await second.initialize({ maxDiagnosticEntries: 5 });
    await first.start();
    await second.start();

    expect(first.getConfig()).toEqual({ maxDiagnosticEntries: 2 });
    expect(second.getConfig()).toEqual({ maxDiagnosticEntries: 5 });
    expect(firstCounts).toEqual({ starts: 1, destroys: 0 });
    expect(secondCounts).toEqual({ starts: 1, destroys: 0 });
    expect(first.submitEvent({ protocolVersion: 99 })).toMatchObject({ code: 'invalid_event' });
    expect(second.submitEvent(validEventEnvelopeSamples[0])).toMatchObject({ code: 'accepted' });
    expect(first.getDiagnostics()).toHaveLength(1);
    expect(second.getDiagnostics()).toHaveLength(0);

    await first.destroy();
    expect(firstCounts.destroys).toBe(1);
    expect(secondCounts.destroys).toBe(0);
    expect(second.getState()).toBe('started');
    await second.destroy();
    const third = createCore();
    expect(third.getState()).toBe('created');
    expect(third.getConfig()).toBeNull();
    expect(third.getDiagnostics()).toEqual([]);
  });

  it('contains one instance plugin failure without changing another instance', async () => {
    const failed = createCore();
    const healthy = createCore();
    failed.registerPlugin({
      name: 'failed-plugin',
      initialize: (): never => {
        throw new Error('instance-local failure');
      },
      start: (): void => undefined,
      stop: (): void => undefined,
      destroy: (): void => undefined,
    });
    await failed.initialize();
    await healthy.initialize();
    expect(failed.getDiagnostics()[0]).toMatchObject({ sequence: 1, pluginName: 'failed-plugin' });
    expect(healthy.getDiagnostics()).toEqual([]);
    expect(healthy.getState()).toBe('initialized');
  });

  it('isolates different Providers and one Provider failure', async () => {
    const failed = createCore({
      eventIdProvider: {
        createEventId: (): never => {
          throw new Error('first-secret');
        },
      },
      eventTimeProvider: { now: () => 1 },
    });
    const healthy = createCore({
      eventIdProvider: { createEventId: () => 'second-event' },
      eventTimeProvider: { now: () => 2 },
    });
    await Promise.all([failed.initialize(), healthy.initialize()]);
    await Promise.all([failed.start(), healthy.start()]);
    const draft = { eventType: EventType.Error, body: {} };
    expect(failed.submitEventDraft(draft).code).toBe('event_creation_failed');
    expect(healthy.submitEventDraft(draft).code).toBe('accepted');
    expect(failed.getDiagnostics()).toHaveLength(1);
    expect(healthy.getDiagnostics()).toEqual([]);
  });
});
