import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BrowserErrorSourceEventType,
  type BrowserErrorSourceEvent,
  type BrowserErrorSourceListener,
} from '../src/index.js';

describe('Browser error source public contract', () => {
  it('exposes exactly three source event types', () => {
    expect(BrowserErrorSourceEventType).toEqual({
      JavaScript: 'javascript_error',
      UnhandledRejection: 'unhandled_rejection',
      Resource: 'resource_error',
    });
    expect(Object.isFrozen(BrowserErrorSourceEventType)).toBe(true);
  });

  it('exposes one exact discriminated listener input', () => {
    expectTypeOf<BrowserErrorSourceListener>()
      .parameter(0)
      .toEqualTypeOf<BrowserErrorSourceEvent>();
  });
});
