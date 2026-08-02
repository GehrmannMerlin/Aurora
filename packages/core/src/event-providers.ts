export interface CoreEventIdProvider {
  createEventId(): string;
}

export interface CoreEventTimeProvider {
  now(): number;
}

export interface CoreEventProviders {
  readonly eventIdProvider?: CoreEventIdProvider;
  readonly eventTimeProvider?: CoreEventTimeProvider;
}

export interface CoreEventProviderSnapshot {
  readonly createEventId: () => unknown;
  readonly now: () => unknown;
}

type UnknownCallable = (...args: readonly unknown[]) => unknown;

function isObjectLike(input: unknown): input is object {
  return (typeof input === 'object' && input !== null) || typeof input === 'function';
}

function defaultCreateEventId(): unknown {
  const cryptoValue: unknown = Reflect.get(globalThis, 'crypto');
  if (!isObjectLike(cryptoValue)) throw new TypeError('event ID capability unavailable');
  const randomUUID: unknown = Reflect.get(cryptoValue, 'randomUUID');
  if (typeof randomUUID !== 'function') throw new TypeError('event ID capability unavailable');
  return Reflect.apply(randomUUID as UnknownCallable, cryptoValue, []);
}

function defaultNow(): unknown {
  return Date.now();
}

function snapshotMethod(
  owner: unknown,
  key: 'createEventId' | 'now',
  fallback: () => unknown,
): () => unknown {
  if (owner === undefined) return fallback;
  try {
    if (!isObjectLike(owner)) {
      return (): never => {
        throw new TypeError('invalid provider');
      };
    }
    const method: unknown = Reflect.get(owner, key);
    if (typeof method !== 'function') {
      return (): never => {
        throw new TypeError('invalid provider');
      };
    }
    return (): unknown => Reflect.apply(method as UnknownCallable, owner, []);
  } catch {
    return (): never => {
      throw new TypeError('invalid provider');
    };
  }
}

export function snapshotEventProviders(input?: unknown): CoreEventProviderSnapshot {
  let eventIdProvider: unknown;
  let eventTimeProvider: unknown;
  try {
    if (input === undefined) {
      eventIdProvider = undefined;
      eventTimeProvider = undefined;
    } else {
      if (!isObjectLike(input)) {
        return Object.freeze({
          createEventId: (): never => {
            throw new TypeError('invalid providers');
          },
          now: (): never => {
            throw new TypeError('invalid providers');
          },
        });
      }
      eventIdProvider = Reflect.get(input, 'eventIdProvider');
      eventTimeProvider = Reflect.get(input, 'eventTimeProvider');
    }
  } catch {
    return Object.freeze({
      createEventId: (): never => {
        throw new TypeError('invalid providers');
      },
      now: (): never => {
        throw new TypeError('invalid providers');
      },
    });
  }
  return Object.freeze({
    createEventId: snapshotMethod(eventIdProvider, 'createEventId', defaultCreateEventId),
    now: snapshotMethod(eventTimeProvider, 'now', defaultNow),
  });
}
