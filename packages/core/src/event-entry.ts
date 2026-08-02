import { parseEventEnvelope } from '@aurora/event-schema';
import type { EventSchemaIssue } from '@aurora/event-schema';
import type { CoreLifecycleState } from './lifecycle.js';
import type { DiagnosticStore } from './diagnostics.js';
import { createCoreEventEnvelope } from './event-creation.js';
import type { CoreEventProviderSnapshot } from './event-providers.js';

export interface CoreEventAccepted {
  readonly ok: true;
  readonly code: 'accepted';
  readonly state: 'started';
  readonly diagnosticsAdded: 0;
}

export interface CoreInvalidEvent {
  readonly ok: false;
  readonly code: 'invalid_event';
  readonly state: 'started';
  readonly issues: readonly EventSchemaIssue[];
  readonly diagnosticsAdded: 1;
}

export interface CoreInactiveEvent {
  readonly ok: false;
  readonly code: 'not_started';
  readonly state: 'created' | 'initialized' | 'stopped';
  readonly diagnosticsAdded: 1;
}

export interface CoreDestroyedEvent {
  readonly ok: false;
  readonly code: 'destroyed';
  readonly state: 'destroyed';
  readonly diagnosticsAdded: 1;
}

export interface CoreEventInternalFailure {
  readonly ok: false;
  readonly code: 'internal_error';
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: 1;
}

export type CoreEventResult =
  | CoreEventAccepted
  | CoreInvalidEvent
  | CoreInactiveEvent
  | CoreDestroyedEvent
  | CoreEventInternalFailure;

export interface CoreInvalidEventDraft {
  readonly ok: false;
  readonly code: 'invalid_event_draft';
  readonly state: 'started';
  readonly diagnosticsAdded: 1;
}

export interface CoreEventCreationFailure {
  readonly ok: false;
  readonly code: 'event_creation_failed';
  readonly state: 'started';
  readonly diagnosticsAdded: 1;
}

export type CoreEventDraftResult =
  CoreEventResult | CoreInvalidEventDraft | CoreEventCreationFailure;

export function freezeEventIssues(
  issues: readonly EventSchemaIssue[],
): readonly EventSchemaIssue[] {
  return Object.freeze(
    issues.map((issue) =>
      Object.freeze({
        code: issue.code,
        path: Object.freeze([...issue.path]),
        message: issue.message,
      }),
    ),
  );
}

export function submitCoreEvent(
  state: CoreLifecycleState,
  input: unknown,
  diagnostics: DiagnosticStore,
): CoreEventResult {
  if (state === 'destroyed') {
    diagnostics.add({ code: 'event_rejected', operation: 'submit_event' });
    return Object.freeze({
      ok: false,
      code: 'destroyed',
      state,
      diagnosticsAdded: 1,
    });
  }
  if (state !== 'started') {
    diagnostics.add({ code: 'event_rejected', operation: 'submit_event' });
    return Object.freeze({
      ok: false,
      code: 'not_started',
      state,
      diagnosticsAdded: 1,
    });
  }
  try {
    const parsed = parseEventEnvelope(input);
    if (!parsed.success) {
      diagnostics.add({ code: 'invalid_event', operation: 'submit_event' });
      return Object.freeze({
        ok: false,
        code: 'invalid_event',
        state: 'started',
        issues: freezeEventIssues(parsed.issues),
        diagnosticsAdded: 1,
      });
    }
    return Object.freeze({
      ok: true,
      code: 'accepted',
      state: 'started',
      diagnosticsAdded: 0,
    });
  } catch {
    diagnostics.add({ code: 'internal_error', operation: 'submit_event' });
    return Object.freeze({
      ok: false,
      code: 'internal_error',
      state,
      diagnosticsAdded: 1,
    });
  }
}

export function submitCoreEventDraft(
  state: CoreLifecycleState,
  input: unknown,
  providers: CoreEventProviderSnapshot,
  diagnostics: DiagnosticStore,
): CoreEventDraftResult {
  if (state === 'destroyed') {
    diagnostics.add({ code: 'event_rejected', operation: 'submit_event' });
    return Object.freeze({ ok: false, code: 'destroyed', state, diagnosticsAdded: 1 });
  }
  if (state !== 'started') {
    diagnostics.add({ code: 'event_rejected', operation: 'submit_event' });
    return Object.freeze({ ok: false, code: 'not_started', state, diagnosticsAdded: 1 });
  }
  const created = createCoreEventEnvelope(input, providers);
  if (created.ok) return submitCoreEvent(state, created.event, diagnostics);
  if (created.code === 'invalid_event') {
    diagnostics.add({ code: 'invalid_event', operation: 'submit_event' });
    return Object.freeze({
      ok: false,
      code: 'invalid_event',
      state: 'started',
      issues: freezeEventIssues(created.issues),
      diagnosticsAdded: 1,
    });
  }
  if (created.code === 'invalid_event_draft') {
    diagnostics.add({ code: 'invalid_event_draft', operation: 'submit_event' });
    return Object.freeze({
      ok: false,
      code: 'invalid_event_draft',
      state: 'started',
      diagnosticsAdded: 1,
    });
  }
  if (
    created.code === 'event_id_provider_failed' ||
    created.code === 'event_time_provider_failed'
  ) {
    diagnostics.add({ code: created.code, operation: 'submit_event' });
    return Object.freeze({
      ok: false,
      code: 'event_creation_failed',
      state: 'started',
      diagnosticsAdded: 1,
    });
  }
  diagnostics.add({ code: 'internal_error', operation: 'submit_event' });
  return Object.freeze({
    ok: false,
    code: 'internal_error',
    state: 'started',
    diagnosticsAdded: 1,
  });
}
