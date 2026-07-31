import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureBrowserHost, detectBrowserCapabilities } from '../src/capabilities.js';
import { BrowserDiagnosticCode, createDiagnosticStore } from '../src/diagnostics.js';

afterEach(() => vi.unstubAllGlobals());

function eventTargetLike(): object {
  return { addEventListener: (): void => undefined, removeEventListener: (): void => undefined };
}

describe('browser capability detection', () => {
  it('degrades each missing global independently', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('performance', undefined);
    const diagnostics = createDiagnosticStore();
    const capabilities = detectBrowserCapabilities(captureBrowserHost(diagnostics), diagnostics);
    expect(capabilities).toEqual({
      isBrowserEnvironment: false,
      hasWindow: false,
      hasDocument: false,
      hasNavigator: false,
      hasPerformance: false,
      canReadPageUrl: false,
      canReadUserAgent: false,
      canReadVisibility: false,
      canObservePageLifecycle: false,
    });
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(diagnostics.getDiagnostics()).toEqual([]);
  });

  it('reports usable capabilities without exposing host objects', () => {
    vi.stubGlobal('window', {
      ...eventTargetLike(),
      location: { href: 'https://example.test/a?x=1' },
    });
    vi.stubGlobal('document', { ...eventTargetLike(), visibilityState: 'visible' });
    vi.stubGlobal('navigator', { userAgent: 'synthetic-agent' });
    vi.stubGlobal('performance', { now: (): number => 12.5 });
    const diagnostics = createDiagnosticStore();
    expect(detectBrowserCapabilities(captureBrowserHost(diagnostics), diagnostics)).toEqual({
      isBrowserEnvironment: true,
      hasWindow: true,
      hasDocument: true,
      hasNavigator: true,
      hasPerformance: true,
      canReadPageUrl: true,
      canReadUserAgent: true,
      canReadVisibility: true,
      canObservePageLifecycle: true,
    });
  });

  it('contains a throwing global getter and stores no exception text', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      get(): never {
        throw new Error('token=must-not-leak');
      },
    });
    try {
      const diagnostics = createDiagnosticStore();
      const host = captureBrowserHost(diagnostics);
      expect(host.windowTarget).toBeUndefined();
      expect(diagnostics.getDiagnostics()).toMatchObject([
        {
          sequence: 1,
          code: BrowserDiagnosticCode.GlobalAccessFailed,
          operation: 'create',
          capability: 'window',
        },
      ]);
      expect(JSON.stringify(diagnostics.getDiagnostics())).not.toContain('must-not-leak');
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', descriptor);
    }
  });

  it('contains throwing listener method getters', () => {
    const throwingTarget = {
      get addEventListener(): never {
        throw new Error('listener-secret');
      },
      removeEventListener: (): void => undefined,
    };
    vi.stubGlobal('window', {
      location: { href: 'https://example.test/' },
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    });
    vi.stubGlobal('document', throwingTarget);
    const diagnostics = createDiagnosticStore();
    const capabilities = detectBrowserCapabilities(captureBrowserHost(diagnostics), diagnostics);
    expect(capabilities.canObservePageLifecycle).toBe(false);
    expect(diagnostics.getDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'property_read_failed',
          operation: 'read_capabilities',
          capability: 'page_lifecycle',
        }),
      ]),
    );
    expect(JSON.stringify(diagnostics.getDiagnostics())).not.toContain('listener-secret');
  });
});
