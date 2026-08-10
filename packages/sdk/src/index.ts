export {
  createSdkActivityTrail,
  type SafeActivityEntry,
  type SafeActivityEntryKind,
  type SafePageEnterEntry,
  type SafePriorErrorEntry,
  type SafeRequestSummaryEntry,
  type SafeResourceErrorEntry,
  type SafeRouteChangeEntry,
  type SafeSdkReportEntry,
  type SdkActivityTrail,
  type SdkActivityTrailOptions,
  type SdkRecordActivityCode,
  type SdkRecordActivityResult,
} from './activity-trail.js';
export { applySdkBeforeSend } from './before-send.js';
export type { SdkBeforeSend, SdkBeforeSendCode, SdkBeforeSendFunction, SdkBeforeSendResult } from './before-send.js';
export {
  createSafeDefaultSdkConfig,
  parseSdkConfig,
  type SdkConfigFix,
  type SdkConfigParseFailure,
  type SdkConfigParseResult,
  type SdkConfigParseSuccess,
  type SdkConfigSnapshot,
  type SdkRequestPathRuleSnapshot,
  type SdkSampleRatesSnapshot,
} from './configuration.js';
export {
  createSdkControlPlane,
  type SdkControlPlane,
  type SdkControlPlaneOptions,
  type SdkDroppedEvent,
  type SdkDropCode,
  type SdkPluginContext,
  type SdkProcessedEvent,
  type SdkProcessEventResult,
  type SdkSubmitDraft,
  type SdkSubmitResult,
} from './control-plane.js';
export { isSdkEventDraft, type SdkEventDraft } from './event-draft.js';
export { applySdkPrivacyFilter, type SdkPrivacyFilterCode, type SdkPrivacyFilterResult } from './privacy-filter.js';
export { normalizeAllowedOrigin, originMatchesAllowed, parseOrigin, type ParsedOrigin } from './origin.js';
export {
  classifyRequestEvent,
  isRequestAllowed,
  normalizeRequestPath,
  type SdkRequestClassificationContext,
  type SdkRequestClassificationResult,
  type SdkRequestClass,
  type SdkRequestDecision,
  type SdkRequestDisallowed,
  type SdkRequestDisallowReason,
} from './request-classification.js';
export {
  canonicalDraftKey,
  decideEventSample,
  decideSdkSample,
  eventClassOf,
  fnv1a64,
  type SdkEventClass,
  type SdkHashInput,
  type SdkSamplingContext,
  type SdkSamplingDecision,
} from './sampling.js';
