import {
  BATCH_EVENT_LIMITS,
  CURRENT_PROTOCOL_VERSION,
  type EventEnvelope,
  type IngestionBatchRequest,
} from '@aurora/event-schema';

export interface SdkBatchBuildFailure {
  readonly ok: false;
  readonly code: 'empty' | 'too_many_events';
}

export type SdkBatchBuildResult =
  | { readonly ok: true; readonly batch: IngestionBatchRequest }
  | SdkBatchBuildFailure;

export function buildDeliveryBatch(
  events: readonly EventEnvelope[],
  receivedAt: number,
): SdkBatchBuildResult {
  if (events.length === 0) return Object.freeze({ ok: false, code: 'empty' as const });
  if (events.length > BATCH_EVENT_LIMITS.maxEventsPerBatch) {
    return Object.freeze({ ok: false, code: 'too_many_events' as const });
  }
  const base = {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    events: Object.freeze([...events]),
  };
  const batch: IngestionBatchRequest =
    Number.isSafeInteger(receivedAt) && receivedAt > 0
      ? { ...base, receivedAt }
      : base;
  return Object.freeze({ ok: true, batch: Object.freeze(batch) });
}
