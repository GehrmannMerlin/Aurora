import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshotEventProviders } from '../src/event-providers.js';

afterEach(() => vi.unstubAllGlobals());

describe('Core event providers', () => {
  it('uses Date.now and crypto.randomUUID only when called', () => {
    const randomUUID = vi.fn(() => 'default-event-id');
    vi.stubGlobal('crypto', { randomUUID });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const providers = snapshotEventProviders();
    expect(randomUUID).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(providers.createEventId()).toBe('default-event-id');
    expect(providers.now()).toBe(1_800_000_000_000);
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(now).toHaveBeenCalledOnce();
    now.mockRestore();
  });

  it('captures deterministic methods and preserves each receiver', () => {
    const eventIdProvider = {
      prefix: 'first',
      createEventId(): string {
        return `${this.prefix}-event`;
      },
    };
    const eventTimeProvider = {
      value: 42,
      now(): number {
        return this.value;
      },
    };
    const providers = snapshotEventProviders({ eventIdProvider, eventTimeProvider });
    eventIdProvider.createEventId = (): string => 'replacement';
    eventTimeProvider.now = (): number => 99;
    expect(providers.createEventId()).toBe('first-event');
    expect(providers.now()).toBe(42);
  });

  it('represents missing, non-callable, getter, and invocation failures as throws', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => snapshotEventProviders().createEventId()).toThrow();
    const hostile: unknown = Object.create(null, {
      eventIdProvider: {
        get: (): never => {
          throw new Error('credential');
        },
      },
    });
    expect(() => snapshotEventProviders(hostile).createEventId()).toThrow();
    expect(() =>
      snapshotEventProviders({
        eventIdProvider: {
          createEventId: (): never => {
            throw new Error('secret');
          },
        },
      }).createEventId(),
    ).toThrow();
  });
});
