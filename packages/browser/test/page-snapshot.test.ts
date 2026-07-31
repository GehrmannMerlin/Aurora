import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureBrowserHost } from '../src/capabilities.js';
import { createDiagnosticStore } from '../src/diagnostics.js';
import { PageVisibilityState, readPageSnapshot } from '../src/page-snapshot.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installHost(input: {
  readonly href?: unknown;
  readonly userAgent?: unknown;
  readonly visibilityState?: unknown;
  readonly performanceNow?: () => unknown;
}): void {
  vi.stubGlobal('window', { location: { href: input.href } });
  vi.stubGlobal('document', { visibilityState: input.visibilityState });
  vi.stubGlobal('navigator', { userAgent: input.userAgent });
  vi.stubGlobal('performance', { now: input.performanceNow });
}

describe('page snapshot', () => {
  it('strips credentials, query, and fragment while reading all normal values', () => {
    installHost({
      href: 'https://user:secret@example.test:8443/orders/42?token=private#detail',
      userAgent: 'synthetic-agent',
      visibilityState: 'visible',
      performanceNow: () => 12.5,
    });
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const diagnostics = createDiagnosticStore();
    const snapshot = readPageSnapshot(captureBrowserHost(diagnostics), diagnostics);
    expect(snapshot).toEqual({
      pageUrl: 'https://example.test:8443/orders/42',
      userAgent: 'synthetic-agent',
      visibilityState: PageVisibilityState.Visible,
      clock: { unixMilliseconds: 1_800_000_000_000, monotonicMilliseconds: 12.5 },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.clock)).toBe(true);
    expect(JSON.stringify(diagnostics.getDiagnostics())).not.toContain('private');
  });

  it.each([
    ['hidden', PageVisibilityState.Hidden],
    ['prerender', PageVisibilityState.Unknown],
    [undefined, PageVisibilityState.Unknown],
  ] as const)('maps visibility %s to %s', (value, expected) => {
    installHost({ href: 'https://example.test/', userAgent: '', visibilityState: value });
    const diagnostics = createDiagnosticStore();
    expect(readPageSnapshot(captureBrowserHost(diagnostics), diagnostics).visibilityState).toBe(
      expected,
    );
  });

  it.each(['mailto:user@example.test', 'not a url', '', undefined])(
    'returns null for unsupported or invalid URL %s',
    (href) => {
      installHost({ href, userAgent: undefined, visibilityState: undefined });
      const diagnostics = createDiagnosticStore();
      const snapshot = readPageSnapshot(captureBrowserHost(diagnostics), diagnostics);
      expect(snapshot.pageUrl).toBeNull();
      expect(snapshot.userAgent).toBeNull();
    },
  );

  it('isolates independent wall-clock and performance failures', () => {
    installHost({
      href: 'https://example.test/',
      userAgent: 'agent',
      visibilityState: 'hidden',
      performanceNow: (): never => {
        throw new Error('performance-secret');
      },
    });
    vi.spyOn(Date, 'now').mockImplementation((): never => {
      throw new Error('date-secret');
    });
    const diagnostics = createDiagnosticStore();
    const snapshot = readPageSnapshot(captureBrowserHost(diagnostics), diagnostics);
    expect(snapshot.clock).toEqual({ unixMilliseconds: null, monotonicMilliseconds: null });
    expect(
      diagnostics.getDiagnostics().filter(({ code }) => code === 'clock_read_failed'),
    ).toHaveLength(2);
    expect(JSON.stringify(diagnostics.getDiagnostics())).not.toContain('secret');
  });

  it('contains throwing page getters', () => {
    const throwingLocation = {
      get href(): never {
        throw new Error('query=secret');
      },
    };
    vi.stubGlobal('window', { location: throwingLocation });
    vi.stubGlobal('document', {
      get visibilityState(): never {
        throw new Error('form-value');
      },
    });
    vi.stubGlobal('navigator', {
      get userAgent(): never {
        throw new Error('agent-secret');
      },
    });
    vi.stubGlobal('performance', undefined);
    const diagnostics = createDiagnosticStore();
    const snapshot = readPageSnapshot(captureBrowserHost(diagnostics), diagnostics);
    expect(snapshot).toMatchObject({ pageUrl: null, userAgent: null, visibilityState: 'unknown' });
    expect(JSON.stringify(diagnostics.getDiagnostics())).not.toMatch(/secret|form-value/);
  });

  it.each([
    {
      unix: Number.NaN,
      monotonic: 1,
      expected: { unixMilliseconds: null, monotonicMilliseconds: 1 },
    },
    {
      unix: Number.MAX_VALUE,
      monotonic: 1,
      expected: { unixMilliseconds: null, monotonicMilliseconds: 1 },
    },
    {
      unix: 1_800_000_000_000,
      monotonic: -1,
      expected: { unixMilliseconds: 1_800_000_000_000, monotonicMilliseconds: null },
    },
    {
      unix: 1_800_000_000_000,
      monotonic: Infinity,
      expected: { unixMilliseconds: 1_800_000_000_000, monotonicMilliseconds: null },
    },
  ])('rejects invalid clock values %#', ({ unix, monotonic, expected }) => {
    installHost({
      href: 'https://example.test/',
      userAgent: 'agent',
      visibilityState: 'visible',
      performanceNow: () => monotonic,
    });
    vi.spyOn(Date, 'now').mockReturnValue(unix);
    const diagnostics = createDiagnosticStore();
    expect(readPageSnapshot(captureBrowserHost(diagnostics), diagnostics).clock).toEqual(expected);
    expect(
      diagnostics.getDiagnostics().filter(({ code }) => code === 'clock_read_failed'),
    ).toHaveLength(1);
  });
});
