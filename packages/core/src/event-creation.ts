import {
  CURRENT_PROTOCOL_VERSION,
  parseEventEnvelope,
  type EventEnvelope,
  type EventSchemaIssue,
} from '@aurora/event-schema';
import { parseCoreEventDraft } from './event-draft.js';
import type { CoreEventProviderSnapshot } from './event-providers.js';

export type CoreEventCreationResult =
  | { readonly ok: true; readonly event: EventEnvelope }
  | { readonly ok: false; readonly code: 'invalid_event_draft' }
  | {
      readonly ok: false;
      readonly code: 'event_id_provider_failed' | 'event_time_provider_failed';
    }
  | {
      readonly ok: false;
      readonly code: 'invalid_event';
      readonly issues: readonly EventSchemaIssue[];
    }
  | { readonly ok: false; readonly code: 'internal_error' };

export function createCoreEventEnvelope(
  input: unknown,
  providers: CoreEventProviderSnapshot,
): CoreEventCreationResult {
  const parsedDraft = parseCoreEventDraft(input);
  if (!parsedDraft.ok) return { ok: false, code: 'invalid_event_draft' };
  let eventId: unknown;
  try {
    eventId = providers.createEventId();
  } catch {
    return { ok: false, code: 'event_id_provider_failed' };
  }
  let occurredAt: unknown;
  try {
    occurredAt = providers.now();
  } catch {
    return { ok: false, code: 'event_time_provider_failed' };
  }
  try {
    const parsed = parseEventEnvelope({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      eventId,
      eventType: parsedDraft.draft.eventType,
      occurredAt,
      body: parsedDraft.draft.body,
    });
    return parsed.success
      ? { ok: true, event: parsed.data }
      : { ok: false, code: 'invalid_event', issues: parsed.issues };
  } catch {
    return { ok: false, code: 'internal_error' };
  }
}
