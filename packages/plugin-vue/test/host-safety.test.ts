import { createApp, type App } from 'vue';
import { describe, expect, it } from 'vitest';
import { createVueAuroraPlugin } from '../src/index.js';

function createRecordingTransport() {
  const sends: unknown[] = [];
  return {
    sends,
    transport: {
      send: async (request: unknown) => {
        sends.push(request);
        return {
          kind: 'success',
          status: 202,
          receipt: { batchState: 'accepted', retryable: false, perEventResults: [] },
        } as const;
      },
    },
  };
}

const waitTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

function makeApp(): App {
  return createApp({});
}

describe('Vue adapter host safety', () => {
  it('calls the original handler first with the same arguments', () => {
    const app = makeApp();
    const seen: unknown[] = [];
    const original: NonNullable<App['config']['errorHandler']> = (err, instance, info) => {
      seen.push(err, instance, info);
    };
    app.config.errorHandler = original;
    const plugin = createVueAuroraPlugin({ config: { clientKey: 'test-key' } });
    plugin.install(app);
    const wrapped = app.config.errorHandler;
    expect(wrapped).toBeTypeOf('function');
    const err = new Error('boom');
    const info = 'render function';
    wrapped?.(err, null, info);
    expect(seen).toEqual([err, null, info]);
    plugin.uninstall(app);
  });

  it('does not clobber a handler the host sets after install', () => {
    const app = makeApp();
    const plugin = createVueAuroraPlugin({ config: { clientKey: 'test-key' } });
    plugin.install(app);
    const hostNew = (): void => {};
    app.config.errorHandler = hostNew;
    plugin.uninstall(app);
    expect(app.config.errorHandler).toBe(hostNew);
  });

  it('isolates internal submission failures and still delivers later events', async () => {
    const app = makeApp();
    const { transport, sends } = createRecordingTransport();
    const plugin = createVueAuroraPlugin({ config: { clientKey: 'test-key' }, transport });
    plugin.install(app);
    await waitTick();
    const wrapped = app.config.errorHandler;
    // 一个必然被协议拒绝的草稿（超长 message）不得抛出。
    expect(() => wrapped?.({ message: 'x'.repeat(5000) }, null, 'render function')).not.toThrow();
    await waitTick();
    expect(sends.length).toBe(0);
    // 随后的合法事件仍然被提交。
    wrapped?.(new Error('boom'), null, 'render function');
    await waitTick();
    expect(sends.length).toBe(1);
    plugin.uninstall(app);
  });

  it('buffers a framework error raised before start and delivers it after start', async () => {
    const app = makeApp();
    const { transport, sends } = createRecordingTransport();
    const plugin = createVueAuroraPlugin({ config: { clientKey: 'test-key' }, transport });
    plugin.install(app);
    // 同步触发（mount 渲染错误的真实时序），此时 core 尚未 started。
    app.config.errorHandler?.(new Error('early-boom'), null, 'render function');
    expect(sends.length).toBe(0);
    await waitTick();
    expect(sends.length).toBe(1);
    const request = sends[0] as { events: readonly { readonly body?: { readonly category?: string } }[] };
    expect(request.events[0]?.body?.category).toBe('javascript');
    plugin.uninstall(app);
  });

  it('does not retain the native Error object in the submitted body', async () => {
    const app = makeApp();
    const { transport, sends } = createRecordingTransport();
    const plugin = createVueAuroraPlugin({ config: { clientKey: 'test-key' }, transport });
    plugin.install(app);
    await waitTick();
    const original = new Error('boom');
    app.config.errorHandler?.(original, null, 'render function');
    await waitTick();
    expect(sends.length).toBe(1);
    const request = sends[0] as {
      events: readonly { readonly body: { readonly error?: unknown; readonly category?: string } }[];
    };
    const body = request.events[0]?.body;
    expect(body?.category).toBe('javascript');
    expect((body?.error as { message?: string }).message).toBe('boom');
    expect(body?.error).not.toBe(original);
    plugin.uninstall(app);
  });
});
