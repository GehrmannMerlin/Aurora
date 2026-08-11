import { createApp, type App } from 'vue';
import { describe, expect, it } from 'vitest';
import { createVueAuroraPlugin } from '../src/index.js';
import type { VueAuroraPlugin, VueRouterLike } from '../src/index.js';

function createFakeTransport() {
  return {
    send: async () =>
      ({
        kind: 'success',
        status: 202,
        receipt: { batchState: 'accepted', retryable: false, perEventResults: [] },
      }) as const,
  };
}

function makeApp(): App {
  return createApp({});
}

function fakeRouter(): { router: VueRouterLike; emit: (to: { path: string; fullPath: string }) => void } {
  let hook: ((to: { path: string; fullPath: string }) => void) | undefined;
  return {
    router: {
      afterEach(handler: (to: { path: string; fullPath: string }) => void): { (): void } {
        hook = handler;
        return (): void => {
          hook = undefined;
        };
      },
    },
    emit(to: { path: string; fullPath: string }): void {
      hook?.(to);
    },
  };
}

const waitTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('Vue adapter lifecycle', () => {
  it('install wraps app.config.errorHandler and preserves the original', () => {
    const app = makeApp();
    const original = (): void => {};
    app.config.errorHandler = original;
    const plugin = createVueAuroraPlugin({
      config: { clientKey: 'test-key' },
      transport: createFakeTransport(),
    });
    plugin.install(app);
    expect(typeof app.config.errorHandler).toBe('function');
    expect(app.config.errorHandler).not.toBe(original);
    plugin.uninstall(app);
  });

  it('duplicate install on the same app is idempotent', () => {
    const app = makeApp();
    const plugin = createVueAuroraPlugin({
      config: { clientKey: 'test-key' },
      transport: createFakeTransport(),
    });
    plugin.install(app);
    const wrapped = app.config.errorHandler;
    plugin.install(app);
    expect(app.config.errorHandler).toBe(wrapped);
    plugin.uninstall(app);
  });

  it('uninstall restores the original errorHandler by identity', () => {
    const app = makeApp();
    const original = (): void => {};
    app.config.errorHandler = original;
    const plugin = createVueAuroraPlugin({
      config: { clientKey: 'test-key' },
      transport: createFakeTransport(),
    });
    plugin.install(app);
    plugin.uninstall(app);
    expect(app.config.errorHandler).toBe(original);
  });

  it('uninstall on an app the plugin never installed on is a safe no-op', () => {
    const app = makeApp();
    const plugin = createVueAuroraPlugin({
      config: { clientKey: 'test-key' },
      transport: createFakeTransport(),
    });
    expect(() => plugin.uninstall(app)).not.toThrow();
  });

  it('destroy makes a subsequent install a no-op', async () => {
    const app = makeApp();
    const plugin = createVueAuroraPlugin({
      config: { clientKey: 'test-key' },
      transport: createFakeTransport(),
    });
    await plugin.destroy();
    plugin.install(app);
    expect(app.config.errorHandler).toBeUndefined();
  });

  it('records route_change when a router is provided and removes the hook on uninstall', async () => {
    const app = makeApp();
    const { router, emit } = fakeRouter();
    const plugin: VueAuroraPlugin = createVueAuroraPlugin({
      config: { clientKey: 'test-key' },
      transport: createFakeTransport(),
    });
    plugin.install(app, { router });
    await waitTick();
    emit({ path: '/dashboard', fullPath: '/dashboard' });
    await waitTick();
    const trail = plugin.sdk.getActivityTrail();
    expect(trail.some((entry) => entry.kind === 'route_change' && entry.pathname === '/dashboard')).toBe(
      true,
    );
    plugin.uninstall(app);
    const countAfterUninstall = plugin.sdk.getActivityTrail().filter((e) => e.kind === 'route_change')
      .length;
    emit({ path: '/other', fullPath: '/other' });
    await waitTick();
    expect(plugin.sdk.getActivityTrail().filter((e) => e.kind === 'route_change').length).toBe(
      countAfterUninstall,
    );
  });
});
