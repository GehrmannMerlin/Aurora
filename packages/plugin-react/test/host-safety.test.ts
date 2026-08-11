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

describe('React adapter host safety', () => {
  it('does not leak componentStack or component internals into the event', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const { transport, sends } = createRecordingTransport();
    const plugin = createReactAuroraPlugin({ config: { clientKey: 'test-key' }, transport });
    const root = renderTree(
      React.createElement(plugin.AuroraErrorBoundary, null, React.createElement(Boom)),
      container,
    );
    await waitTick();
    const serialized = JSON.stringify(sends);
    expect(serialized).not.toContain('componentStack');
    expect(serialized).not.toContain('secret');
    act(() => root.unmount());
    container.remove();
  });

  it('isolates internal schema-rejected submissions without breaking the page', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const { transport, sends } = createRecordingTransport();
    const plugin = createReactAuroraPlugin({ config: { clientKey: 'test-key' }, transport });
    function HugeBoom(): React.ReactElement {
      throw new Error('x'.repeat(5000));
    }
    // schema-rejected 的错误：componentDidCatch 不得抛出，页面继续。
    const root = renderTree(
      React.createElement(plugin.AuroraErrorBoundary, null, React.createElement(HugeBoom)),
      container,
    );
    await waitTick();
    expect(sends.length).toBe(0);
    expect(container.textContent ?? '').toBe('');
    act(() => root.unmount());
    // 随后合法错误仍被提交。
    const root2 = renderTree(
      React.createElement(plugin.AuroraErrorBoundary, null, React.createElement(Boom)),
      container,
    );
    await waitTick();
    expect(sends.length).toBe(1);
    act(() => root2.unmount());
    container.remove();
  });

  it('buffers an error raised before start and delivers it after start', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const { transport, sends } = createRecordingTransport();
    const plugin = createReactAuroraPlugin({ config: { clientKey: 'test-key' }, transport });
    const root = renderTree(
      React.createElement(plugin.AuroraErrorBoundary, null, React.createElement(Boom)),
      container,
    );
    // componentDidCatch 在 commit 中早于 componentDidMount/start 完成 → 缓冲。
    expect(sends.length).toBe(0);
    await waitTick();
    expect(sends.length).toBe(1);
    act(() => root.unmount());
    container.remove();
  });
});
