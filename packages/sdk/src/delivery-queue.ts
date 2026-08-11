import {
  EVENT_SCHEMA_LIMITS,
  EventType,
  isEventType,
  type EventEnvelope,
} from '@aurora/event-schema';

export const DEFAULT_DELIVERY_QUEUE_CAPACITY = 256;
export const MAX_DELIVERY_QUEUE_CAPACITY = 1000;

export type SdkEnqueueCode =
  | 'enqueued'
  | 'duplicate'
  | 'queue_full'
  | 'invalid_envelope'
  | 'destroyed';

export interface SdkEnqueueResult {
  readonly ok: boolean;
  readonly code: SdkEnqueueCode;
  readonly evictedEventId?: string;
}

export interface SdkQueuedEvent {
  readonly envelope: EventEnvelope;
  readonly attemptCount: number;
  readonly enqueuedAt: number;
}

export interface SdkDeliveryQueue {
  readonly capacity: number;
  readonly size: number;
  readonly enqueue: (input: unknown, now: number) => SdkEnqueueResult;
  readonly reenqueue: (event: SdkQueuedEvent, now: number) => SdkEnqueueResult;
  readonly drain: (max: number) => readonly SdkQueuedEvent[];
  readonly clear: () => void;
  readonly destroy: () => void;
}

export interface SdkDeliveryQueueOptions {
  readonly capacity?: number;
}

function normalizeCapacity(capacity: unknown): number {
  if (typeof capacity !== 'number' || !Number.isSafeInteger(capacity) || capacity < 1) {
    return DEFAULT_DELIVERY_QUEUE_CAPACITY;
  }
  return Math.min(capacity, MAX_DELIVERY_QUEUE_CAPACITY);
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isEnvelopeInput(input: unknown): input is EventEnvelope {
  if (!isPlainObject(input)) return false;
  const eventId = Reflect.get(input, 'eventId');
  if (typeof eventId !== 'string' || eventId.length === 0 || eventId.length > EVENT_SCHEMA_LIMITS.maxEventIdLength) {
    return false;
  }
  return isEventType(Reflect.get(input, 'eventType'));
}

function isErrorEvent(envelope: EventEnvelope): boolean {
  return envelope.eventType === EventType.Error;
}

function enqueued(evictedEventId?: string): SdkEnqueueResult {
  return Object.freeze(
    evictedEventId === undefined
      ? { ok: true, code: 'enqueued' as const }
      : { ok: true, code: 'enqueued' as const, evictedEventId },
  );
}

export function createSdkDeliveryQueue(options: SdkDeliveryQueueOptions = {}): SdkDeliveryQueue {
  const capacity = normalizeCapacity(options.capacity);
  let errorBucket: SdkQueuedEvent[] = [];
  let otherBucket: SdkQueuedEvent[] = [];
  const seen = new Set<string>();
  let isDestroyed = false;

  function size(): number {
    return errorBucket.length + otherBucket.length;
  }

  function admit(event: SdkQueuedEvent): SdkEnqueueResult {
    const target = isErrorEvent(event.envelope) ? errorBucket : otherBucket;
    target.push(event);
    seen.add(event.envelope.eventId);
    return enqueued();
  }

  function evictOldestOther(): SdkQueuedEvent | null {
    if (otherBucket.length === 0) return null;
    const removed = otherBucket.shift();
    if (removed !== undefined) seen.delete(removed.envelope.eventId);
    return removed ?? null;
  }

  return Object.freeze({
    capacity,
    get size(): number {
      return size();
    },
    enqueue: (input: unknown, now: number): SdkEnqueueResult => {
      if (isDestroyed) return Object.freeze({ ok: false, code: 'destroyed' as const });
      if (!isEnvelopeInput(input)) return Object.freeze({ ok: false, code: 'invalid_envelope' as const });
      const envelope = input as EventEnvelope;
      if (seen.has(envelope.eventId)) return Object.freeze({ ok: false, code: 'duplicate' as const });
      const event: SdkQueuedEvent = { envelope, attemptCount: 0, enqueuedAt: now };
      if (size() < capacity) return admit(event);
      // Overflow: admit high-value errors by evicting the oldest lower-priority event; otherwise drop the incoming event.
      if (isErrorEvent(envelope)) {
        const evicted = evictOldestOther();
        if (evicted !== null) {
          admit(event);
          return enqueued(evicted.envelope.eventId);
        }
      }
      return Object.freeze({ ok: false, code: 'queue_full' as const });
    },
    reenqueue: (event: SdkQueuedEvent, now: number): SdkEnqueueResult => {
      if (isDestroyed) return Object.freeze({ ok: false, code: 'destroyed' as const });
      if (!isEnvelopeInput(event.envelope)) return Object.freeze({ ok: false, code: 'invalid_envelope' as const });
      if (seen.has(event.envelope.eventId)) return Object.freeze({ ok: false, code: 'duplicate' as const });
      if (size() >= capacity) return Object.freeze({ ok: false, code: 'queue_full' as const });
      const retryEvent: SdkQueuedEvent = { ...event, enqueuedAt: now };
      return admit(retryEvent);
    },
    drain: (max: number): readonly SdkQueuedEvent[] => {
      if (isDestroyed) return Object.freeze([]);
      const limit = Math.max(0, Math.floor(max));
      const result: SdkQueuedEvent[] = [];
      while (result.length < limit && errorBucket.length > 0) {
        const item = errorBucket.shift();
        if (item !== undefined) {
          seen.delete(item.envelope.eventId);
          result.push(item);
        }
      }
      while (result.length < limit && otherBucket.length > 0) {
        const item = otherBucket.shift();
        if (item !== undefined) {
          seen.delete(item.envelope.eventId);
          result.push(item);
        }
      }
      return Object.freeze(result);
    },
    clear: (): void => {
      errorBucket = [];
      otherBucket = [];
      seen.clear();
    },
    destroy: (): void => {
      isDestroyed = true;
      errorBucket = [];
      otherBucket = [];
      seen.clear();
    },
  });
}
