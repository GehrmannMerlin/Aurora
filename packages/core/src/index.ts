export { createCore, type AuroraCore } from './core.js';
export type {
  CoreEventAccepted,
  CoreEventCreationFailure,
  CoreEventDraftResult,
  CoreEventInternalFailure,
  CoreEventResult,
  CoreDestroyedEvent,
  CoreInactiveEvent,
  CoreInvalidEvent,
  CoreInvalidEventDraft,
} from './event-entry.js';
export type { CoreEventDraft } from './event-draft.js';
export type {
  CoreEventIdProvider,
  CoreEventProviders,
  CoreEventTimeProvider,
} from './event-providers.js';
export type {
  CorePlugin,
  CorePluginContext,
  CorePluginRegistrationFailure,
  CorePluginRegistrationFailureCode,
  CorePluginRegistrationResult,
  CorePluginRegistrationSuccess,
} from './plugin-contract.js';
export type { EventSchemaIssue } from '@aurora/event-schema';
export type {
  CoreConfigInput,
  CoreConfigSnapshot,
  CoreConfigUpdateFailure,
  CoreConfigUpdateFailureCode,
  CoreConfigUpdateResult,
  CoreConfigUpdateSuccess,
} from './configuration.js';
export type { CoreDiagnostic, CoreDiagnosticCode, CoreDiagnosticOperation } from './diagnostics.js';
export type {
  CoreLifecycleFailure,
  CoreLifecycleFailureCode,
  CoreLifecycleResult,
  CoreLifecycleState,
  CoreLifecycleSuccess,
  CoreLifecycleSuccessCode,
} from './lifecycle.js';
