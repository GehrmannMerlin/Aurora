import { describe, expect, it } from 'vitest';
import type { BrowserHostContext } from '../src/capabilities.js';
import { createDiagnosticStore } from '../src/diagnostics.js';
import { createErrorSourceEvent } from '../src/error-source.js';

const windowTarget = Object.freeze({ name: 'window' });
const host: BrowserHostContext = Object.freeze({
  windowTarget,
  documentTarget: undefined,
  navigatorTarget: undefined,
  performanceTarget: undefined,
});

describe('Browser error source views', () => {
  it('projects JavaScript facts and strips URL secrets', () => {
    const nativeError = new Error('synthetic');
    const nativeEvent = {
      target: windowTarget,
      message: 'Synthetic failure',
      filename: 'https://user:pass@example.test/app.js?token=secret#frame',
      error: nativeError,
    };
    const event = createErrorSourceEvent('error', nativeEvent, host, createDiagnosticStore());
    expect(event).toEqual({
      type: 'javascript_error',
      message: 'Synthetic failure',
      sourceUrl: 'https://example.test/app.js',
      error: nativeError,
    });
    expect(event).not.toHaveProperty('target');
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('passes a rejection reason without walking or copying it', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const event = createErrorSourceEvent(
      'unhandledrejection',
      { reason: cyclic },
      host,
      createDiagnosticStore(),
    );
    expect(event).toEqual({ type: 'unhandled_rejection', reason: cyclic });
    expect(event).not.toHaveProperty('promise');
  });

  it.each([
    new Error('Synthetic rejection'),
    'Synthetic rejection',
    { code: 7, tags: ['synthetic'] },
  ])('preserves the exact rejection reason identity %#', (reason) => {
    const event = createErrorSourceEvent(
      'unhandledrejection',
      { reason },
      host,
      createDiagnosticStore(),
    );
    expect(event).toMatchObject({ type: 'unhandled_rejection' });
    if (event.type !== 'unhandled_rejection') throw new Error('unexpected source type');
    expect(event.reason).toBe(reason);
  });

  it('does not invent a missing JavaScript Error object', () => {
    expect(
      createErrorSourceEvent(
        'error',
        { target: windowTarget, message: 'Script error.', filename: '' },
        host,
        createDiagnosticStore(),
      ),
    ).toEqual({
      type: 'javascript_error',
      message: 'Script error.',
      sourceUrl: null,
      error: undefined,
    });
  });

  it('copies resource facts without retaining the DOM-like target', () => {
    const target = {
      tagName: 'LINK',
      currentSrc: '',
      src: '',
      href: 'https://static.example.test/app.css?key=secret#x',
      rel: 'STYLESHEET',
      as: '',
    };
    const event = createErrorSourceEvent('error', { target }, host, createDiagnosticStore());
    expect(event).toEqual({
      type: 'resource_error',
      tagName: 'link',
      sourceUrl: 'https://static.example.test/app.css',
      rel: 'stylesheet',
      as: null,
    });
    expect(Object.values(event)).not.toContain(target);
  });

  it('keeps an unknown resource tag as a raw Browser fact', () => {
    const event = createErrorSourceEvent(
      'error',
      {
        target: {
          tagName: 'VIDEO',
          currentSrc: 'https://static.example.test/movie.mp4?token=secret#track',
        },
      },
      host,
      createDiagnosticStore(),
    );
    expect(event).toEqual({
      type: 'resource_error',
      tagName: 'video',
      sourceUrl: 'https://static.example.test/movie.mp4',
      rel: null,
      as: null,
    });
  });

  it('contains throwing getters and does not leak their text', () => {
    const nativeEvent = Object.defineProperty({ target: windowTarget }, 'message', {
      get(): never {
        throw new Error('authorization=secret');
      },
    });
    const diagnostics = createDiagnosticStore();
    expect(() => createErrorSourceEvent('error', nativeEvent, host, diagnostics)).not.toThrow();
    expect(createErrorSourceEvent('error', nativeEvent, host, diagnostics)).toMatchObject({
      type: 'javascript_error',
      message: null,
    });
    expect(JSON.stringify(diagnostics.getDiagnostics())).not.toContain('secret');
  });
});
