import { describe, expect, it } from 'vitest';
import type { CorePlugin } from '@aurora/core';
import { createAuroraSdk, type AuroraSdkHandle } from '../src/index.js';

interface Probe {
  readonly plugin: CorePlugin;
  readonly submit: (draft: unknown) => unknown;
}

function createProbePlugin(): Probe {
  let capturedSubmit: unknown;
  const plugin: CorePlugin = {
    name: 'probe-plugin',
    initialize(context): void {
      capturedSubmit = context.submitEvent;
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
      if (typeof capturedSubmit !== 'function') throw new TypeError('plugin not initialized');
      return (capturedSubmit as (input: unknown) => unknown)(draft);
    },
  };
}

function errorDraft(body: unknown = { message: 'boom' }) {
  return { eventType: 'error', body };
}

function requestDraft(url: string) {
  return {
    eventType: 'request',
    body: { method: 'GET', url, startedAt: 1, durationMs: 100, outcome: 'success', statusCode: 200 },
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

    const disallowed = probe.submit(
      requestDraft('https://analytics.example.net/collect'),
    ) as { ok: boolean; code: string };
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
});
