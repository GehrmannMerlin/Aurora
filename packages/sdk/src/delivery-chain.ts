import {
  BATCH_EVENT_LIMITS,
  IngestionReceiptState,
  type IngestionRequestReceipt,
} from '@aurora/event-schema';
import { buildDeliveryBatch } from './batch-builder.js';
import {
  createSdkDeliveryQueue,
  type SdkDeliveryQueue,
  type SdkEnqueueResult,
  type SdkQueuedEvent,
} from './delivery-queue.js';
import {
  classifySdkHttpStatus,
  classifySdkReceiptState,
  classifySdkTransportReason,
  type SdkRetryDecision,
} from './retry-classification.js';
import { calculateSdkRetryDelay } from './retry-backoff.js';
import type {
  SdkBatchTransport,
  SdkTransportContext,
  SdkTransportResult,
} from './transport-types.js';

export const DEFAULT_SDK_MAX_RETRIES = 3;
export const DEFAULT_SDK_BASE_RETRY_DELAY_MS = 500;
export const DEFAULT_SDK_MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_DIAGNOSTICS_CAPACITY = 100;

export type SdkDeliveryDiagnosticCode =
  | 'batch_sent'
  | 'batch_dropped'
  | 'event_accepted'
  | 'event_dropped'
  | 'event_retry_scheduled'
  | 'event_retry_exhausted'
  | 'transport_failure'
  | 'destroyed';

export interface SdkDeliveryDiagnostic {
  readonly sequence: number;
  readonly code: SdkDeliveryDiagnosticCode;
  readonly eventId: string | undefined;
  readonly attemptCount: number | undefined;
  readonly status: number | undefined;
}

export interface SdkDeliveryChainOptions {
  readonly transport: SdkBatchTransport;
  /** Injected host scheduler (e.g. queueMicrotask/setTimeout in the browser composition) so sdk-core stays DOM-free. */
  readonly schedule: (fn: () => void, delayMs?: number) => void;
  readonly capacity?: number;
  readonly maxRetries?: number;
  readonly baseRetryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly now?: () => number;
  readonly entropy?: () => number;
  readonly diagnosticsCapacity?: number;
}

export interface SdkFlushResult {
  readonly ok: boolean;
  readonly sentBatches: number;
  readonly eventsSent: number;
  readonly eventsDropped: number;
  readonly eventsPending: number;
}

export interface SdkDeliveryChain {
  readonly size: number;
  readonly enqueue: (input: unknown) => SdkEnqueueResult;
  readonly flush: (options?: { readonly bestEffort?: boolean }) => Promise<SdkFlushResult>;
  readonly destroy: () => void;
  readonly getDiagnostics: () => readonly SdkDeliveryDiagnostic[];
}

interface FlushCounts {
  sentBatches: number;
  eventsSent: number;
  eventsDropped: number;
}

function normalizeMaxRetries(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) return DEFAULT_SDK_MAX_RETRIES;
  return Math.max(0, Math.min(10, input));
}

function normalizeDelay(input: unknown, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) return fallback;
  return Math.floor(input);
}

function normalizeDiagnosticsCapacity(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1) {
    return DEFAULT_DIAGNOSTICS_CAPACITY;
  }
  return Math.min(1000, input);
}

function defaultEntropy(): number {
  return Math.random();
}

export function createSdkDeliveryChain(
  identity: { readonly clientKey: string; readonly environment: string | null },
  options: SdkDeliveryChainOptions,
): SdkDeliveryChain {
  const transport = options.transport;
  const maxRetries = normalizeMaxRetries(options.maxRetries);
  const baseRetryDelayMs = normalizeDelay(options.baseRetryDelayMs, DEFAULT_SDK_BASE_RETRY_DELAY_MS);
  const maxRetryDelayMs = normalizeDelay(options.maxRetryDelayMs, DEFAULT_SDK_MAX_RETRY_DELAY_MS);
  const diagnosticsCapacity = normalizeDiagnosticsCapacity(options.diagnosticsCapacity);
  const queue: SdkDeliveryQueue =
    options.capacity === undefined
      ? createSdkDeliveryQueue()
      : createSdkDeliveryQueue({ capacity: options.capacity });
  const now = options.now ?? ((): number => Date.now());
  const schedule = options.schedule;
  const entropy = options.entropy ?? defaultEntropy;
  const transportHeaders: Readonly<Record<string, string>> = Object.freeze({
    'Content-Type': 'application/json',
    'X-Aurora-Client-Key': identity.clientKey,
    ...(identity.environment !== null ? { 'X-Aurora-Environment': identity.environment } : {}),
  });

  let isDestroyed = false;
  let drainActive = false;
  let drainQueued = false;
  let isSending = false;
  let diagnostics: SdkDeliveryDiagnostic[] = [];
  let sequence = 0;
  const backgroundCounts: FlushCounts = { sentBatches: 0, eventsSent: 0, eventsDropped: 0 };

  function addDiagnostic(
    code: SdkDeliveryDiagnosticCode,
    eventId: string | undefined = undefined,
    attemptCount: number | undefined = undefined,
    status: number | undefined = undefined,
  ): void {
    sequence += 1;
    const entry: SdkDeliveryDiagnostic = Object.freeze({ sequence, code, eventId, attemptCount, status });
    diagnostics = [...diagnostics, entry];
    if (diagnostics.length > diagnosticsCapacity) {
      diagnostics = diagnostics.slice(diagnostics.length - diagnosticsCapacity);
    }
  }

  function scheduleDrain(delayMs?: number): void {
    schedule(() => {
      drainQueued = true;
      void drainPass(false, backgroundCounts);
    }, delayMs);
  }

  function retryEvent(item: SdkQueuedEvent, decision: SdkRetryDecision, counts: FlushCounts): void {
    if (!decision.retryable || item.attemptCount >= maxRetries) {
      addDiagnostic('event_retry_exhausted', item.envelope.eventId, item.attemptCount);
      counts.eventsDropped += 1;
      return;
    }
    const next: SdkQueuedEvent = {
      envelope: item.envelope,
      attemptCount: item.attemptCount + 1,
      enqueuedAt: now(),
    };
    const result = queue.reenqueue(next, now());
    if (result.ok) {
      addDiagnostic('event_retry_scheduled', item.envelope.eventId, next.attemptCount);
      const delayMs = calculateSdkRetryDelay({
        attemptCount: item.attemptCount,
        baseDelayMs: baseRetryDelayMs,
        maxDelayMs: maxRetryDelayMs,
        entropy: entropy(),
        ...(decision.retryAfterMs !== undefined ? { serverRetryAfterMs: decision.retryAfterMs } : {}),
      });
      scheduleDrain(delayMs);
    } else {
      addDiagnostic('event_dropped', item.envelope.eventId, next.attemptCount);
      counts.eventsDropped += 1;
    }
  }

  function dropItems(items: readonly SdkQueuedEvent[], counts: FlushCounts): void {
    for (const item of items) {
      addDiagnostic('event_dropped', item.envelope.eventId, item.attemptCount);
      counts.eventsDropped += 1;
    }
  }

  function handleReceipt(
    items: readonly SdkQueuedEvent[],
    receipt: IngestionRequestReceipt,
    counts: FlushCounts,
    retryAllowed: boolean,
  ): void {
    if (receipt.perEventResults.length === 0) {
      for (const item of items) {
        addDiagnostic('event_accepted', item.envelope.eventId, item.attemptCount);
        counts.eventsSent += 1;
      }
      return;
    }
    for (const item of items) {
      const perEvent = receipt.perEventResults.find((r) => r.eventId === item.envelope.eventId);
      if (perEvent === undefined) {
        addDiagnostic('event_dropped', item.envelope.eventId, item.attemptCount);
        counts.eventsDropped += 1;
        continue;
      }
      const state = perEvent.state;
      if (state === IngestionReceiptState.Accepted || state === IngestionReceiptState.DuplicateAccepted) {
        addDiagnostic('event_accepted', item.envelope.eventId, item.attemptCount);
        counts.eventsSent += 1;
      } else if (state === IngestionReceiptState.PermanentlyRejected) {
        addDiagnostic('event_dropped', item.envelope.eventId, item.attemptCount);
        counts.eventsDropped += 1;
      } else if (state === IngestionReceiptState.TemporarilyFailed) {
        if (!retryAllowed) {
          addDiagnostic('event_dropped', item.envelope.eventId, item.attemptCount);
          counts.eventsDropped += 1;
          continue;
        }
        retryEvent(item, classifySdkReceiptState(state, perEvent.retryAfterMs), counts);
      } else {
        addDiagnostic('event_dropped', item.envelope.eventId, item.attemptCount);
        counts.eventsDropped += 1;
      }
    }
  }

  async function handleTransportResult(
    items: readonly SdkQueuedEvent[],
    result: SdkTransportResult,
    counts: FlushCounts,
    retryAllowed: boolean,
  ): Promise<void> {
    switch (result.kind) {
      case 'success':
        addDiagnostic('batch_sent', undefined, undefined, result.status);
        counts.sentBatches += 1;
        handleReceipt(items, result.receipt, counts, retryAllowed);
        return;
      case 'transport_failure':
        addDiagnostic('transport_failure');
        if (retryAllowed) {
          for (const item of items) retryEvent(item, classifySdkTransportReason(result.reason, result.retryAfterMs), counts);
        } else {
          dropItems(items, counts);
        }
        return;
      case 'http_error': {
        const decision = classifySdkHttpStatus(result.status, result.retryAfterMs);
        if (!decision.retryable) {
          addDiagnostic('batch_dropped', undefined, undefined, result.status);
          dropItems(items, counts);
          return;
        }
        if (result.receipt !== undefined && result.receipt.perEventResults.length > 0) {
          handleReceipt(items, result.receipt, counts, retryAllowed);
          return;
        }
        if (retryAllowed) {
          for (const item of items) retryEvent(item, decision, counts);
        } else {
          dropItems(items, counts);
        }
        return;
      }
    }
  }

  async function processBatch(
    items: readonly SdkQueuedEvent[],
    bestEffort: boolean,
    counts: FlushCounts,
  ): Promise<void> {
    const batch = buildDeliveryBatch(items.map((item) => item.envelope), now());
    if (!batch.ok) {
      dropItems(items, counts);
      return;
    }
    const context: SdkTransportContext = {
      mode: bestEffort ? 'best_effort' : 'normal',
      headers: transportHeaders,
    };
    let result: SdkTransportResult;
    try {
      result = await transport.send(batch.batch, context);
    } catch {
      result = { kind: 'transport_failure', reason: 'network' };
    }
    await handleTransportResult(items, result, counts, !bestEffort);
  }

  async function drainPass(bestEffort: boolean, counts: FlushCounts): Promise<void> {
    if (drainActive) {
      drainQueued = true;
      return;
    }
    drainActive = true;
    try {
      let rerun = true;
      while (rerun) {
        rerun = false;
        drainQueued = false;
        while (!isSending && queue.size > 0 && !isDestroyed) {
          const items = queue.drain(BATCH_EVENT_LIMITS.maxEventsPerBatch);
          if (items.length === 0) break;
          isSending = true;
          try {
            await processBatch(items, bestEffort, counts);
          } finally {
            isSending = false;
          }
        }
        rerun = drainQueued && !isDestroyed;
      }
    } finally {
      drainActive = false;
    }
  }

  return Object.freeze({
    get size(): number {
      return queue.size;
    },
    enqueue: (input: unknown): SdkEnqueueResult => {
      if (isDestroyed) return Object.freeze({ ok: false, code: 'destroyed' as const });
      return queue.enqueue(input, now());
    },
    flush: async (options?: { readonly bestEffort?: boolean }): Promise<SdkFlushResult> => {
      if (isDestroyed) {
        return Object.freeze({ ok: false, sentBatches: 0, eventsSent: 0, eventsDropped: 0, eventsPending: 0 });
      }
      const counts: FlushCounts = { sentBatches: 0, eventsSent: 0, eventsDropped: 0 };
      await drainPass(options?.bestEffort ?? false, counts);
      return Object.freeze({
        ok: true,
        sentBatches: counts.sentBatches,
        eventsSent: counts.eventsSent,
        eventsDropped: counts.eventsDropped,
        eventsPending: queue.size,
      });
    },
    destroy: (): void => {
      isDestroyed = true;
      queue.destroy();
      diagnostics = [];
      sequence = 0;
      addDiagnostic('destroyed');
    },
    getDiagnostics: (): readonly SdkDeliveryDiagnostic[] => Object.freeze([...diagnostics]),
  });
}
