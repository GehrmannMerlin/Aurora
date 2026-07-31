import type { CoreLifecycleState } from './lifecycle.js';

export interface CoreConfigInput {
  readonly maxDiagnosticEntries?: number;
}

export interface CoreConfigSnapshot {
  readonly maxDiagnosticEntries: number;
}

export type CoreConfigUpdateFailureCode =
  'invalid_configuration' | 'configuration_locked' | 'not_initialized' | 'destroyed';

export interface CoreConfigUpdateSuccess {
  readonly ok: true;
  readonly code: 'configuration_updated';
  readonly state: 'initialized' | 'stopped';
  readonly config: CoreConfigSnapshot;
  readonly diagnosticsAdded: 0;
}

export interface CoreConfigUpdateFailure {
  readonly ok: false;
  readonly code: CoreConfigUpdateFailureCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export type CoreConfigUpdateResult = CoreConfigUpdateSuccess | CoreConfigUpdateFailure;

export interface ConfigurationParseSuccess {
  readonly ok: true;
  readonly config: CoreConfigSnapshot;
}

export interface ConfigurationParseFailure {
  readonly ok: false;
}

export type ConfigurationParseResult = ConfigurationParseSuccess | ConfigurationParseFailure;

const defaultMaxDiagnosticEntries = 100;
const maximumDiagnosticEntries = 1000;
const allowedKey = 'maxDiagnosticEntries';

function isPlainObject(input: unknown): input is object {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function createSnapshot(maxDiagnosticEntries: number): CoreConfigSnapshot {
  return Object.freeze({ maxDiagnosticEntries });
}

function parseObject(input: unknown, isUpdate: boolean): ConfigurationParseResult {
  try {
    if (!isPlainObject(input)) return { ok: false };
    const keys = Reflect.ownKeys(input);
    if (keys.some((key) => key !== allowedKey)) return { ok: false };
    if (isUpdate && keys.length !== 1) return { ok: false };
    if (!isUpdate && keys.length === 0) {
      return { ok: true, config: createSnapshot(defaultMaxDiagnosticEntries) };
    }
    if (keys.length !== 1 || keys[0] !== allowedKey) return { ok: false };
    const value: unknown = Reflect.get(input, allowedKey);
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > maximumDiagnosticEntries
    ) {
      return { ok: false };
    }
    return { ok: true, config: createSnapshot(value) };
  } catch {
    return { ok: false };
  }
}

export function parseInitialConfiguration(input: unknown): ConfigurationParseResult {
  if (input === undefined) {
    return { ok: true, config: createSnapshot(defaultMaxDiagnosticEntries) };
  }
  return parseObject(input, false);
}

export function parseConfigurationUpdate(input: unknown): ConfigurationParseResult {
  return parseObject(input, true);
}

export function areConfigurationsEqual(
  left: CoreConfigSnapshot,
  right: CoreConfigSnapshot,
): boolean {
  return left.maxDiagnosticEntries === right.maxDiagnosticEntries;
}
