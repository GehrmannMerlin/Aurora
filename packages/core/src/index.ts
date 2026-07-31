export { createCore, type AuroraCore } from './core.js';
export type {
  CoreEventAccepted,
  CoreEventInternalFailure,
  CoreEventResult,
  CoreDestroyedEvent,
  CoreInactiveEvent,
  CoreInvalidEvent,
} from './event-entry.js';
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
