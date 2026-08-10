import { EventType, parseRequestEventBody } from '@aurora/event-schema';
import { createSdkActivityTrail, type SafeActivityEntry, type SdkRecordActivityResult } from './activity-trail.js';
import { applySdkBeforeSend } from './before-send.js';
import type { SdkConfigSnapshot } from './configuration.js';
import { isSdkEventDraft, type SdkEventDraft } from './event-draft.js';
import { applySdkPrivacyFilter } from './privacy-filter.js';
import {
  classifyRequestEvent,
  type SdkRequestClassificationContext,
} from './request-classification.js';
import { decideEventSample, eventClassOf, type SdkEventClass } from './sampling.js';

export type SdkDropCode =
  | 'invalid_draft'
  | 'dropped_by_before_send'
  | 'disallowed_request'
  | 'sampled_out';

export interface SdkProcessedEvent {
  readonly ok: true;
  readonly event: SdkEventDraft;
  readonly sampledOut: boolean;
}

export interface SdkDroppedEvent {
  readonly ok: false;
  readonly code: SdkDropCode;
}

export type SdkProcessEventResult = SdkProcessedEvent | SdkDroppedEvent;

export interface SdkSubmitResult {
  readonly ok: boolean;
  readonly code: string;
  readonly state?: string;
  readonly diagnosticsAdded?: number;
}

export type SdkSubmitDraft = (draft: SdkEventDraft) => SdkSubmitResult;

export interface SdkControlPlane {
  readonly getConfig: () => SdkConfigSnapshot;
  readonly processEvent: (draft: SdkEventDraft) => SdkProcessEventResult;
  readonly submit: (draft: SdkEventDraft, submitToCore: SdkSubmitDraft) => SdkSubmitResult;
  readonly recordActivity: (entry: unknown) => SdkRecordActivityResult;
  readonly getActivityTrail: () => readonly SafeActivityEntry[];
  readonly destroy: () => void;
}

export interface SdkPluginContext {
  readonly submitEvent: (draft: SdkEventDraft) => SdkSubmitResult;
  readonly getConfig: () => SdkConfigSnapshot;
  readonly recordActivity: (entry: unknown) => SdkRecordActivityResult;
}

export interface SdkControlPlaneOptions {
  readonly pageOrigin?: string;
}

function dropped(code: SdkDropCode): SdkDroppedEvent {
  return Object.freeze({ ok: false, code });
}

function recordWithOccurredAt(
  trail: ReturnType<typeof createSdkActivityTrail>,
  entry: Readonly<Record<string, unknown>>,
): SdkRecordActivityResult {
  return trail.record(Object.freeze({ ...entry, occurredAt: Date.now() }));
}

export function createSdkControlPlane(
  config: SdkConfigSnapshot,
  options: SdkControlPlaneOptions = {},
): SdkControlPlane {
  const requestContext: SdkRequestClassificationContext = {
    pageOrigin: options.pageOrigin ?? null,
    sdkReportUrls: [],
  };
  const trail = createSdkActivityTrail({
    capacity: config.maxActivityTrailEntries,
    enabled: config.interactionTrailEnabled,
  });

  function processEvent(draft: SdkEventDraft): SdkProcessEventResult {
    if (!isSdkEventDraft(draft)) return dropped('invalid_draft');
    const filtered = applySdkPrivacyFilter(draft);
    if (!filtered.ok) return dropped('invalid_draft');
    let current = filtered.event as SdkEventDraft;
    if (config.beforeSend !== null && config.beforeSend !== undefined) {
      const before = applySdkBeforeSend(current, config.beforeSend as never);
      if (before.code !== 'kept') return dropped('dropped_by_before_send');
      current = before.event as SdkEventDraft;
      const recheck = applySdkPrivacyFilter(current);
      if (!recheck.ok) return dropped('dropped_by_before_send');
      current = recheck.event as SdkEventDraft;
    }
    let eventClass: SdkEventClass;
    if (current.eventType === EventType.Request) {
      const bodyResult = parseRequestEventBody(current.body);
      if (!bodyResult.success) return dropped('invalid_draft');
      const classified = classifyRequestEvent(current, config, requestContext);
      if (!classified.ok) return dropped('disallowed_request');
      current = Object.freeze({
        eventType: EventType.Request,
        body: Object.freeze({ ...(current.body as object), url: classified.normalizedUrl }),
      });
      eventClass = eventClassOf(EventType.Request, classified.class);
      const summaryBody = current.body as Record<string, unknown>;
      void recordWithOccurredAt(trail, {
        kind: 'request_summary',
        method: String(summaryBody.method ?? ''),
        normalizedUrl: classified.normalizedUrl,
        outcome: String(summaryBody.outcome ?? ''),
        statusCode: typeof summaryBody.statusCode === 'number' ? summaryBody.statusCode : undefined,
        durationMs: typeof summaryBody.durationMs === 'number' ? summaryBody.durationMs : 0,
      });
    } else {
      eventClass = eventClassOf(current.eventType, null);
      if (current.eventType === EventType.Error) {
        const body = current.body as Record<string, unknown>;
        void recordWithOccurredAt(trail, {
          kind: 'prior_error',
          errorClass: String(body.category ?? 'unknown'),
        });
      }
    }
    const decision = decideEventSample(current, config, { class: eventClass });
    if (!decision.sampled) {
      void recordWithOccurredAt(trail, { kind: 'sdk_report', action: 'sample_dropped' });
      return dropped('sampled_out');
    }
    void recordWithOccurredAt(trail, { kind: 'sdk_report', action: 'event_submitted' });
    return Object.freeze({ ok: true, event: current, sampledOut: false });
  }

  return Object.freeze({
    getConfig: (): SdkConfigSnapshot => config,
    processEvent,
    submit: (draft: SdkEventDraft, submitToCore: SdkSubmitDraft): SdkSubmitResult => {
      const processed = processEvent(draft);
      if (!processed.ok) return { ok: false, code: processed.code };
      if (processed.sampledOut) return { ok: false, code: 'sampled_out' };
      return submitToCore(processed.event);
    },
    recordActivity: (entry: unknown): SdkRecordActivityResult => trail.record(entry),
    getActivityTrail: (): readonly SafeActivityEntry[] => trail.entries,
    destroy: (): void => {
      trail.destroy();
    },
  });
}
