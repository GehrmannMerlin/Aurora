export type CoreLifecycleState = 'created' | 'initialized' | 'started' | 'stopped' | 'destroyed';

export type CoreLifecycleSuccessCode =
  | 'initialized'
  | 'already_initialized'
  | 'started'
  | 'already_started'
  | 'stopped'
  | 'already_stopped'
  | 'destroyed'
  | 'already_destroyed';

export type CoreLifecycleFailureCode =
  | 'invalid_configuration'
  | 'configuration_locked'
  | 'not_initialized'
  | 'destroyed'
  | 'internal_error';

export interface CoreLifecycleSuccess {
  readonly ok: true;
  readonly code: CoreLifecycleSuccessCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export interface CoreLifecycleFailure {
  readonly ok: false;
  readonly code: CoreLifecycleFailureCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export type CoreLifecycleResult = CoreLifecycleSuccess | CoreLifecycleFailure;

export function lifecycleSuccess(
  code: CoreLifecycleSuccessCode,
  state: CoreLifecycleState,
  diagnosticsAdded = 0,
): CoreLifecycleSuccess {
  return Object.freeze({ ok: true, code, state, diagnosticsAdded });
}

export function lifecycleFailure(
  code: CoreLifecycleFailureCode,
  state: CoreLifecycleState,
  diagnosticsAdded: number,
): CoreLifecycleFailure {
  return Object.freeze({ ok: false, code, state, diagnosticsAdded });
}
