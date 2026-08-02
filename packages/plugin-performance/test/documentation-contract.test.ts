import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserPerformanceSourceListener } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { createPerformanceCapturePlugin } from '../src/index.js';

describe('performance plugin documentation contract', () => {
  it('documents the exact public assembly and exclusions', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    for (const text of [
      "import { createBrowserEnvironment } from '@aurora/browser';",
      "import { createCore } from '@aurora/core';",
      "import { createPerformanceCapturePlugin } from '@aurora/plugin-performance';",
      'core.registerPlugin(performancePlugin);',
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
    const listeners: BrowserPerformanceSourceListener[] = [];
    const browser = {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribeRequests: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribePerformance(listener: BrowserPerformanceSourceListener) {
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
      eventIdProvider: { createEventId: () => 'readme-perf-event-1' },
      eventTimeProvider: { now: () => 1_800_000_000_001 },
    });
    const performancePlugin = createPerformanceCapturePlugin(browser);
    expect(core.registerPlugin(performancePlugin)).toMatchObject({ ok: true });
    await core.initialize();
    await core.start();
    listeners[0]?.({
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1800000005000,
    });
    expect(performancePlugin.getDiagnostics()).toEqual([]);
    await core.stop();
    await core.destroy();
    expect(browser.destroy).not.toHaveBeenCalled();
  });
});
