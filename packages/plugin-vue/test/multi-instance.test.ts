import { createApp, type App } from 'vue';
import { describe, expect, it } from 'vitest';
import { createVueAuroraPlugin } from '../src/index.js';

function makeApp(): App {
  return createApp({});
}

describe('Vue adapter multi-instance isolation', () => {
  it('keeps each plugin instance independent and does not leak state', () => {
    const appA = makeApp();
    const appB = makeApp();
    const originalA: NonNullable<App['config']['errorHandler']> = (): void => {};
    const originalB: NonNullable<App['config']['errorHandler']> = (): void => {};
    appA.config.errorHandler = originalA;
    appB.config.errorHandler = originalB;

    const pluginA = createVueAuroraPlugin({ config: { clientKey: 'key-a' } });
    const pluginB = createVueAuroraPlugin({ config: { clientKey: 'key-b' } });
    expect(pluginA.sdk).not.toBe(pluginB.sdk);

    pluginA.install(appA);
    pluginB.install(appB);
    const wrappedA = appA.config.errorHandler;
    const wrappedB = appB.config.errorHandler;
    expect(wrappedA).not.toBe(wrappedB);

    // 卸载 A 只恢复 A 的 app，不影响 B。
    pluginA.uninstall(appA);
    expect(appA.config.errorHandler).toBe(originalA);
    expect(appB.config.errorHandler).toBe(wrappedB);
    expect(pluginB.sdk.getActivityTrail()).toEqual([]);
  });

  it('destroying one instance does not affect another', async () => {
    const appA = makeApp();
    const appB = makeApp();
    const pluginA = createVueAuroraPlugin({ config: { clientKey: 'key-a' } });
    const pluginB = createVueAuroraPlugin({ config: { clientKey: 'key-b' } });
    pluginA.install(appA);
    pluginB.install(appB);
    const wrappedB = appB.config.errorHandler;

    await pluginA.destroy();
    expect(appA.config.errorHandler).toBeUndefined();
    expect(appB.config.errorHandler).toBe(wrappedB);
  });
});
