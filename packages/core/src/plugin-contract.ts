import type { CoreEventDraftResult } from './event-entry.js';
import type { CoreLifecycleState } from './lifecycle.js';

export interface CorePluginContext {
  readonly submitEvent: (input: unknown) => CoreEventDraftResult;
}

export interface CorePlugin {
  readonly name: string;
  initialize(context: CorePluginContext): void | Promise<void>;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  destroy(): void | Promise<void>;
}

export interface CorePluginRegistrationSuccess {
  readonly ok: true;
  readonly code: 'registered';
  readonly pluginName: string;
  readonly state: 'created';
  readonly diagnosticsAdded: 0;
}

export type CorePluginRegistrationFailureCode =
  'invalid_plugin' | 'duplicate_plugin' | 'registration_closed' | 'destroyed';

export interface CorePluginRegistrationFailure {
  readonly ok: false;
  readonly code: CorePluginRegistrationFailureCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export type CorePluginRegistrationResult =
  CorePluginRegistrationSuccess | CorePluginRegistrationFailure;

type UnknownCallable = (...args: readonly unknown[]) => unknown;

export interface RegisteredPlugin {
  readonly name: string;
  readonly initialize: (context: CorePluginContext) => Promise<void>;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly destroy: () => Promise<void>;
}

export type PluginSnapshotResult =
  { readonly ok: true; readonly plugin: RegisteredPlugin } | { readonly ok: false };

const pluginNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function isCallable(input: unknown): input is UnknownCallable {
  return typeof input === 'function';
}

export function snapshotPlugin(input: unknown): PluginSnapshotResult {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false };
    const name: unknown = Reflect.get(input, 'name');
    const initialize: unknown = Reflect.get(input, 'initialize');
    const start: unknown = Reflect.get(input, 'start');
    const stop: unknown = Reflect.get(input, 'stop');
    const destroy: unknown = Reflect.get(input, 'destroy');
    if (
      typeof name !== 'string' ||
      name.length > 64 ||
      !pluginNamePattern.test(name) ||
      !isCallable(initialize) ||
      !isCallable(start) ||
      !isCallable(stop) ||
      !isCallable(destroy)
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      plugin: Object.freeze({
        name,
        initialize: async (context: CorePluginContext): Promise<void> => {
          await Reflect.apply(initialize, input, [context]);
        },
        start: async (): Promise<void> => {
          await Reflect.apply(start, input, []);
        },
        stop: async (): Promise<void> => {
          await Reflect.apply(stop, input, []);
        },
        destroy: async (): Promise<void> => {
          await Reflect.apply(destroy, input, []);
        },
      }),
    };
  } catch {
    return { ok: false };
  }
}
