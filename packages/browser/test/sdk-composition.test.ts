import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CorePlugin } from '@aurora/core';
import { createAuroraSdk, type AuroraSdkHandle } from '../src/index.js';

afterEach(() => vi.unstubAllGlobals());

interface Probe {
  readonly plugin: CorePlugin;
  readonly submit: (draft: unknown) => unknown;
  readonly recordActivity: (entry: unknown) => unknown;
}

interface ProbeContext {
  readonly submitEvent: (input: unknown) => unknown;
  recordActivity?: (entry: unknown) => unknown;
}

function createProbePlugin(): Probe {
  let capturedContext: ProbeContext | undefined;
  const plugin: CorePlugin = {
    name: 'probe-plugin',
    initialize(context): void {
      const contextWithTrail = context as { recordActivity?: (entry: unknown) => unknown };
      const captured: ProbeContext = {
        submitEvent: context.submitEvent,
      };
      if (contextWithTrail.recordActivity !== undefined) {
        captured.recordActivity = contextWithTrail.recordActivity;
      }
      capturedContext = captured;
    },
    start(): void {
      /* no-op */
    },
    stop(): void {
      /* no-op */
    },
    destroy(): void {
      /* no-op */
    },
  };
  return {
    plugin,
    submit: (draft: unknown): unknown => {
      if (capturedContext === undefined) throw new TypeError('plugin not initialized');
      return capturedContext.submitEvent(draft);
    },
    recordActivity: (entry: unknown): unknown => {
      if (capturedContext?.recordActivity === undefined)
        throw new TypeError('recordActivity not provided');
      return capturedContext.recordActivity(entry);
    },
  };
}

function errorDraft(body: unknown = { message: 'boom' }) {
  return { eventType: 'error', body };
}

function requestDraft(url: string) {
  return {
    eventType: 'request',
    body: {
      method: 'GET',
      url,
      startedAt: 1,
      durationMs: 100,
      outcome: 'success',
      statusCode: 200,
    },
  };
}

describe('createAuroraSdk', () => {
  it('parses config and returns the SDK handle with lifecycle', async () => {
    const handle: AuroraSdkHandle = createAuroraSdk({ config: { clientKey: 'k1' } });
    expect(handle.config.clientKey).toBe('k1');
    const started = await handle.start();
    expect(started.ok).toBe(true);
    const stopped = await handle.stop();
    expect(stopped.ok).toBe(true);
    const destroyed = await handle.destroy();
    expect(destroyed.ok).toBe(true);
  });

  it('falls back to safe defaults when the config is invalid', () => {
    const handle = createAuroraSdk({ config: {} });
    expect(handle.config.clientKey).toBe('');
    expect(handle.config.slowRequestThreshold).toBe(3000);
  });

  it('wraps injected plugin contexts so submits route through the control plane', async () => {
    const probe = createProbePlugin();
    const handle = createAuroraSdk({
      config: { clientKey: 'k' },
      pageOrigin: 'https://shop.example.com',
      plugins: [probe.plugin],
    });
    await handle.start();

    const kept = probe.submit(errorDraft()) as { ok: boolean; code: string };
    expect(kept.ok).toBe(true);

    const disallowed = probe.submit(requestDraft('https://analytics.example.net/collect')) as {
      ok: boolean;
      code: string;
    };
    expect(disallowed.ok).toBe(false);

    await handle.destroy();
  });

  it('works with no plugins', async () => {
    const handle = createAuroraSdk({ config: { clientKey: 'k' }, plugins: [] });
    const started = await handle.start();
    expect(started.ok).toBe(true);
    await handle.destroy();
  });

  it('isolates separate SDK instances', async () => {
    const handleA = createAuroraSdk({ config: { clientKey: 'a' } });
    const handleB = createAuroraSdk({ config: { clientKey: 'b' } });
    expect(handleA.config.clientKey).toBe('a');
    expect(handleB.config.clientKey).toBe('b');
    await handleA.start();
    expect(handleB.core.getState()).toBe('created');
    await handleA.destroy();
  });

  it('records a safe page_enter trail entry on start from the browser page snapshot', async () => {
    vi.stubGlobal('window', { location: { href: 'https://shop.example.com/orders?page=2' } });
    const handle = createAuroraSdk({ config: { clientKey: 'k' } });
    await handle.start();
    const trail = handle.getActivityTrail();
    const pageEnter = trail.find((entry) => entry.kind === 'page_enter');
    if (pageEnter?.kind === 'page_enter') {
      expect(pageEnter.origin).toBe('https://shop.example.com');
      expect(pageEnter.pathname).toBe('/orders');
    }
    await handle.destroy();
  });

  it('exposes plugin-context recordActivity through the control plane trail', async () => {
    const probe = createProbePlugin();
    const handle = createAuroraSdk({ config: { clientKey: 'k' }, plugins: [probe.plugin] });
    await handle.start();
    const result = probe.recordActivity({
      kind: 'sdk_report',
      occurredAt: Date.now(),
      action: 'from_plugin',
    });
    expect(result).toMatchObject({ ok: true, code: 'recorded' });
    expect(
      handle
        .getActivityTrail()
        .some((entry) => entry.kind === 'sdk_report' && entry.action === 'from_plugin'),
    ).toBe(true);
    await handle.destroy();
  });

  it('exposes a bounded trail via getActivityTrail', async () => {
    const handle = createAuroraSdk({ config: { clientKey: 'k', maxActivityTrailEntries: 3 } });
    await handle.start();
    expect(handle.getActivityTrail().length).toBeLessThanOrEqual(3);
    await handle.destroy();
  });

  it('wires accepted events into the delivery chain via an injected transport', async () => {
    const sent: string[][] = [];
    const transport = {
      send: (request: { events: readonly { eventId: string }[] }) => {
        sent.push(request.events.map((e) => e.eventId));
        return Promise.resolve({
          kind: 'success' as const,
          status: 200,
          receipt: {
            batchState: 'accepted' as const,
            retryable: false,
            perEventResults: request.events.map((e) => ({
              eventId: e.eventId,
              state: 'accepted' as const,
              retryable: false,
            })),
          },
        });
      },
    };
    const probe = createProbePlugin();
    const handle = createAuroraSdk({
      config: { clientKey: 'k' },
      transport,
      plugins: [probe.plugin],
    });
    await handle.start();
    const result = probe.submit(errorDraft({ message: 'boom' }));
    expect(result).toMatchObject({ ok: true, code: 'accepted' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0]?.length).toBe(1);
    await handle.destroy();
  });

  it('exposes delivery on the handle and destroys it with the handle', async () => {
    const handle = createAuroraSdk({
      config: { clientKey: 'k' },
      transport: {
        send: () =>
          Promise.resolve({
            kind: 'success' as const,
            status: 200,
            receipt: {
              batchState: 'accepted' as const,
              retryable: false,
              perEventResults: [],
            },
          }),
      },
    });
    expect(handle.delivery).toBeDefined();
    await handle.destroy();
    const envelope = {
      protocolVersion: 1,
      eventId: 'e1',
      eventType: 'error',
      occurredAt: 1,
      body: { message: 'x' },
    };
    expect(handle.delivery.enqueue(envelope).code).toBe('destroyed');
  });
});
