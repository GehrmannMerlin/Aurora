// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { createReactAuroraPlugin } from '../src/index.js';

const waitTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

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

function Boom(): React.ReactElement {
  throw new Error('boom');
}

describe('React adapter multi-instance isolation', () => {
  it('keeps each plugin instance independent', async () => {
    const containerA = document.createElement('div');
    const containerB = document.createElement('div');
    document.body.append(containerA, containerB);
    const { transport: transportA, sends: sendsA } = createRecordingTransport();
    const { transport: transportB, sends: sendsB } = createRecordingTransport();
    const pluginA = createReactAuroraPlugin({ config: { clientKey: 'key-a' }, transport: transportA });
    const pluginB = createReactAuroraPlugin({ config: { clientKey: 'key-b' }, transport: transportB });
    expect(pluginA.sdk).not.toBe(pluginB.sdk);
    expect(pluginA.AuroraErrorBoundary).not.toBe(pluginB.AuroraErrorBoundary);

    act(() => {
      createRoot(containerA).render(
        React.createElement(pluginA.AuroraErrorBoundary, null, React.createElement(Boom)),
      );
    });
    await waitTick();
    expect(sendsA.length).toBe(1);
    expect(sendsB.length).toBe(0);
    containerA.remove();
    containerB.remove();
  });

  it('destroying one instance does not affect another', async () => {
    const containerA = document.createElement('div');
    const containerB = document.createElement('div');
    document.body.append(containerA, containerB);
    const { transport: transportA, sends: sendsA } = createRecordingTransport();
    const { transport: transportB, sends: sendsB } = createRecordingTransport();
    const pluginA = createReactAuroraPlugin({ config: { clientKey: 'key-a' }, transport: transportA });
    const pluginB = createReactAuroraPlugin({ config: { clientKey: 'key-b' }, transport: transportB });

    await pluginA.destroy();
    act(() => {
      createRoot(containerA).render(
        React.createElement(pluginA.AuroraErrorBoundary, null, React.createElement(Boom)),
      );
    });
    act(() => {
      createRoot(containerB).render(
        React.createElement(pluginB.AuroraErrorBoundary, null, React.createElement(Boom)),
      );
    });
    await waitTick();
    expect(sendsA.length).toBe(0);
    expect(sendsB.length).toBe(1);
    containerA.remove();
    containerB.remove();
  });
});
