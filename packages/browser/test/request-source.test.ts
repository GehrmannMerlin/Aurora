import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  BrowserRequestMechanism,
  BrowserRequestOutcome,
  BrowserRequestSourceEventType,
  createBrowserEnvironment,
  type BrowserRequestSourceEvent,
  type BrowserRequestSourceListener,
} from '../src/index.js';

afterEach(() => vi.unstubAllGlobals());

describe('request source public contract', () => {
  it('exports the exact stable runtime constants', () => {
    expect(BrowserRequestMechanism).toEqual({ Fetch: 'fetch', XmlHttpRequest: 'xhr' });
    expect(BrowserRequestOutcome).toEqual({
      Success: 'success',
      HttpError: 'http_error',
      NetworkError: 'network_error',
      Timeout: 'timeout',
      Canceled: 'canceled',
    });
    expect(BrowserRequestSourceEventType).toEqual({ Fetch: 'fetch', Xhr: 'xhr' });
    expect(Object.isFrozen(BrowserRequestMechanism)).toBe(true);
    expect(Object.isFrozen(BrowserRequestOutcome)).toBe(true);
    expect(Object.isFrozen(BrowserRequestSourceEventType)).toBe(true);
  });

  it('narrows the request source event and listener types', () => {
    expectTypeOf<BrowserRequestSourceEvent['mechanism']>().toEqualTypeOf<'fetch' | 'xhr'>();
    expectTypeOf<BrowserRequestSourceEvent['outcome']>().toEqualTypeOf<
      'success' | 'http_error' | 'network_error' | 'timeout' | 'canceled'
    >();
    expectTypeOf<BrowserRequestSourceEvent['statusCode']>().toEqualTypeOf<number | null>();
    expectTypeOf<BrowserRequestSourceListener>()
      .parameter(0)
      .toEqualTypeOf<BrowserRequestSourceEvent>();
  });
});

function stubHost(): {
  readonly windowTarget: object;
} {
  const windowTarget = {
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
  };
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('document', {});
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('performance', { now: (): number => 10 });
  return { windowTarget };
}

describe('request source lifecycle through BrowserEnvironment', () => {
  it('subscribes and reports invalid listener and destroyed', () => {
    const { windowTarget } = stubHost();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    const NativeXhr = class {
      open(): void {
        return undefined;
      }
      send(): void {
        return undefined;
      }
      abort(): void {
        return undefined;
      }
      addEventListener(): void {
        return undefined;
      }
      removeEventListener(): void {
        return undefined;
      }
    };
    Reflect.set(windowTarget, 'fetch', originalFetch);
    Reflect.set(windowTarget, 'XMLHttpRequest', NativeXhr);
    const browser = createBrowserEnvironment();
    expect(
      browser.subscribeRequests('not-a-function' as unknown as BrowserRequestSourceListener).ok,
    ).toBe(false);
    const listener = (): void => undefined;
    const subscription = browser.subscribeRequests(listener);
    expect(subscription.ok).toBe(true);
    if (subscription.ok) {
      expect(subscription.subscription.unsubscribe().code).toBe('unsubscribed');
      expect(subscription.subscription.unsubscribe().code).toBe('already_unsubscribed');
    }
    browser.destroy();
    expect(browser.subscribeRequests(listener).ok).toBe(false);
  });

  it('projects a fetch success fact with a sanitized URL', async () => {
    const { windowTarget } = stubHost();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    Reflect.set(windowTarget, 'fetch', originalFetch);
    const NativeXhr = class {
      open(): void {
        return undefined;
      }
      send(): void {
        return undefined;
      }
      abort(): void {
        return undefined;
      }
      addEventListener(): void {
        return undefined;
      }
      removeEventListener(): void {
        return undefined;
      }
    };
    Reflect.set(windowTarget, 'XMLHttpRequest', NativeXhr);
    const browser = createBrowserEnvironment();
    const events: BrowserRequestSourceEvent[] = [];
    browser.subscribeRequests((event) => events.push(event));
    const wrapped = Reflect.get(windowTarget, 'fetch') as (input: string) => Promise<unknown>;
    await wrapped('https://example.test/a?token=private#fragment');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(1);
    const event = events[0];
    if (event?.mechanism !== BrowserRequestMechanism.Fetch) throw new Error('fetch event expected');
    expect(event.url).toBe('https://example.test/a');
    expect(event.method).toBe('GET');
    expect(event.outcome).toBe(BrowserRequestOutcome.Success);
    expect(event.statusCode).toBe(200);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('restores the original fetch and XHR references after destroy', () => {
    const { windowTarget } = stubHost();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    const NativeXhr = class {
      open(): void {
        return undefined;
      }
      send(): void {
        return undefined;
      }
      abort(): void {
        return undefined;
      }
      addEventListener(): void {
        return undefined;
      }
      removeEventListener(): void {
        return undefined;
      }
    };
    Reflect.set(windowTarget, 'fetch', originalFetch);
    Reflect.set(windowTarget, 'XMLHttpRequest', NativeXhr);
    const browser = createBrowserEnvironment();
    browser.subscribeRequests(() => undefined);
    expect(Reflect.get(windowTarget, 'fetch')).not.toBe(originalFetch);
    expect(Reflect.get(windowTarget, 'XMLHttpRequest')).not.toBe(NativeXhr);
    browser.destroy();
    expect(Reflect.get(windowTarget, 'fetch')).toBe(originalFetch);
    expect(Reflect.get(windowTarget, 'XMLHttpRequest')).toBe(NativeXhr);
  });
});
