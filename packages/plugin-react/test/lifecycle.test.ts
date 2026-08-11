// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { createReactAuroraPlugin } from '../src/index.js';

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

function renderTree(tree: React.ReactElement, container: HTMLElement): Root {
  let root: Root | undefined;
  act(() => {
    root = createRoot(container);
    root.render(tree);
  });
  if (root === undefined) throw new Error('root not created');
  return root;
}

function Boom(): React.ReactElement {
  throw new Error('boom');
}

describe('React adapter lifecycle', () => {
  it('renders children normally through the boundary', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const plugin = createReactAuroraPlugin({ config: { clientKey: 'test-key' } });
    const root = renderTree(
      React.createElement(plugin.AuroraErrorBoundary, null, React.createElement('div', null, 'ok')),
      container,
    );
    expect(container.textContent).toContain('ok');
    act(() => root.unmount());
    container.remove();
  });

  it('captures a child render error into a standard error event', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const { transport, sends } = createRecordingTransport();
    const plugin = createReactAuroraPlugin({ config: { clientKey: 'test-key' }, transport });
    const root = renderTree(
      React.createElement(plugin.AuroraErrorBoundary, null, React.createElement(Boom)),
      container,
    );
    await waitTick();
    expect(sends.length).toBe(1);
    const request = sends[0] as { events: readonly { readonly body?: { readonly category?: string; readonly error?: { message?: string } } }[] };
    expect(request.events[0]?.body?.category).toBe('javascript');
    expect(request.events[0]?.body?.error?.message).toBe('boom');
    act(() => root.unmount());
    container.remove();
  });

  it('StrictMode double mount does not double-start the SDK', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const plugin = createReactAuroraPlugin({ config: { clientKey: 'test-key' } });
    const root = renderTree(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          plugin.AuroraErrorBoundary,
          null,
          React.createElement('div', null, 'strict-ok'),
        ),
      ),
      container,
    );
    await waitTick();
    // start() 只触发一次：activity trail 只有一条 page_enter。
    const pageEnters = plugin.sdk
      .getActivityTrail()
      .filter((entry) => entry.kind === 'page_enter').length;
    expect(pageEnters).toBe(1);
    expect(container.textContent).toContain('strict-ok');
    act(() => root.unmount());
    container.remove();
  });

  it('unmount leaves no residual resources (no further submissions)', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const { transport, sends } = createRecordingTransport();
    const plugin = createReactAuroraPlugin({ config: { clientKey: 'test-key' }, transport });
    const root = renderTree(
      React.createElement(plugin.AuroraErrorBoundary, null, React.createElement('div', null, 'ok')),
      container,
    );
    await waitTick();
    act(() => root.unmount());
    const count = sends.length;
    await waitTick();
    expect(sends.length).toBe(count);
    container.remove();
  });

  it('destroy makes subsequent boundary submissions no-ops', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const { transport, sends } = createRecordingTransport();
    const plugin = createReactAuroraPlugin({ config: { clientKey: 'test-key' }, transport });
    await plugin.destroy();
    renderTree(
      React.createElement(plugin.AuroraErrorBoundary, null, React.createElement(Boom)),
      container,
    );
    await waitTick();
    expect(sends.length).toBe(0);
    container.remove();
  });
});
