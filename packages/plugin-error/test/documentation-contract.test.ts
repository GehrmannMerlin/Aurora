import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserErrorSourceListener } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { createErrorCapturePlugin } from '../src/index.js';

describe('error plugin documentation contract', () => {
  it('documents the exact public assembly and exclusions', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    for (const text of [
      "import { createBrowserEnvironment } from '@aurora/browser';",
      "import { createCore } from '@aurora/core';",
      "import { createErrorCapturePlugin } from '@aurora/plugin-error';",
      'core.registerPlugin(errorPlugin);',
      'await core.initialize();',
      'await core.start();',
      'await core.stop();',
      'await core.destroy();',
      '不生成事件 ID、时间或协议版本',
      '不实现采样、队列、传输、重试或持久化',
    ]) {
      expect(readme).toContain(text);
    }
  });

  it('executes the documented public lifecycle through Core', async () => {
    const listeners: BrowserErrorSourceListener[] = [];
    const browser = {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeRequests: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribePerformance: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribeErrorSources(listener: BrowserErrorSourceListener) {
        listeners.push(listener);
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe: () => ({
              ok: true as const,
              code: 'unsubscribed' as const,
              diagnosticsAdded: 0,
            }),
          }),
        };
      },
      destroy: vi.fn(),
      getDiagnostics: vi.fn(() => []),
    };
    const core = createCore({
      eventIdProvider: { createEventId: () => 'readme-event-1' },
      eventTimeProvider: { now: () => 1_800_000_000_001 },
    });
    const errorPlugin = createErrorCapturePlugin(browser);
    expect(core.registerPlugin(errorPlugin)).toMatchObject({ ok: true });
    await core.initialize();
    await core.start();
    listeners[0]?.({
      type: 'javascript_error',
      message: 'Synthetic README error',
      sourceUrl: null,
      error: new Error('Synthetic README error'),
    });
    expect(errorPlugin.getDiagnostics()).toEqual([]);
    await core.stop();
    await core.destroy();
    expect(browser.destroy).not.toHaveBeenCalled();
  });
});
