import {
  areConfigurationsEqual,
  parseConfigurationUpdate,
  parseInitialConfiguration,
  type CoreConfigSnapshot,
  type CoreConfigUpdateResult,
} from './configuration.js';
import { DiagnosticStore, type CoreDiagnostic } from './diagnostics.js';
import { submitCoreEvent, type CoreEventResult } from './event-entry.js';
import {
  lifecycleFailure,
  lifecycleSuccess,
  type CoreLifecycleResult,
  type CoreLifecycleState,
} from './lifecycle.js';
import type {
  CorePluginContext,
  CorePluginRegistrationFailure,
  CorePluginRegistrationResult,
} from './plugin-contract.js';
import { PluginRegistry } from './plugin-registry.js';

export interface AuroraCore {
  getState(): CoreLifecycleState;
  getConfig(): CoreConfigSnapshot | null;
  getDiagnostics(): readonly CoreDiagnostic[];
  registerPlugin(input: unknown): CorePluginRegistrationResult;
  initialize(input?: unknown): Promise<CoreLifecycleResult>;
  updateConfig(input: unknown): CoreConfigUpdateResult;
  start(): Promise<CoreLifecycleResult>;
  stop(): Promise<CoreLifecycleResult>;
  destroy(): Promise<CoreLifecycleResult>;
  submitEvent(input: unknown): CoreEventResult;
}

type LifecycleOperation = 'initialize' | 'start' | 'stop' | 'destroy';

export function createCore(): AuroraCore {
  let state: CoreLifecycleState = 'created';
  let config: CoreConfigSnapshot | null = null;
  let lifecycleTail: Promise<void> = Promise.resolve();
  const diagnostics = new DiagnosticStore(100);
  const plugins = new PluginRegistry();
  let isRegistrationClosed = false;

  function addInvalidLifecycle(operation: LifecycleOperation): void {
    diagnostics.add({ code: 'invalid_lifecycle_call', operation });
  }

  function registrationFailure(
    code: CorePluginRegistrationFailure['code'],
  ): CorePluginRegistrationFailure {
    const diagnosticCode =
      code === 'invalid_plugin'
        ? 'invalid_plugin'
        : code === 'duplicate_plugin'
          ? 'duplicate_plugin'
          : 'invalid_lifecycle_call';
    diagnostics.add({ code: diagnosticCode, operation: 'register_plugin' });
    return Object.freeze({ ok: false, code, state, diagnosticsAdded: 1 });
  }

  function registerPlugin(input: unknown): CorePluginRegistrationResult {
    if (state === 'destroyed') return registrationFailure('destroyed');
    if (state !== 'created' || isRegistrationClosed) {
      return registrationFailure('registration_closed');
    }
    const result = plugins.register(input);
    if (!result.ok) return registrationFailure(result.code);
    return Object.freeze({
      ok: true,
      code: 'registered',
      pluginName: result.pluginName,
      state: 'created',
      diagnosticsAdded: 0,
    });
  }

  function serialize(
    operation: LifecycleOperation,
    executeOperation: () => CoreLifecycleResult | Promise<CoreLifecycleResult>,
  ): Promise<CoreLifecycleResult> {
    const executeSafely = async (): Promise<CoreLifecycleResult> => {
      try {
        return await executeOperation();
      } catch {
        diagnostics.add({ code: 'internal_error', operation });
        return lifecycleFailure('internal_error', state, 1);
      }
    };
    const result = lifecycleTail.then(executeSafely, executeSafely);
    lifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function getConfig(): CoreConfigSnapshot | null {
    return config === null ? null : Object.freeze({ ...config });
  }

  function initialize(input?: unknown): Promise<CoreLifecycleResult> {
    isRegistrationClosed = true;
    const parsed = parseInitialConfiguration(input);
    return serialize('initialize', async () => {
      if (state === 'destroyed') {
        addInvalidLifecycle('initialize');
        return lifecycleFailure('destroyed', state, 1);
      }
      if (!parsed.ok) {
        diagnostics.add({ code: 'invalid_configuration', operation: 'initialize' });
        return lifecycleFailure('invalid_configuration', state, 1);
      }
      if (state !== 'created') {
        if (
          input === undefined ||
          (config !== null && areConfigurationsEqual(config, parsed.config))
        ) {
          return lifecycleSuccess('already_initialized', state);
        }
        diagnostics.add({ code: 'configuration_locked', operation: 'initialize' });
        return lifecycleFailure('configuration_locked', state, 1);
      }
      config = parsed.config;
      diagnostics.setCapacity(config.maxDiagnosticEntries);
      state = 'initialized';
      const diagnosticsAdded = await plugins.initializeAll(pluginContext, diagnostics);
      return lifecycleSuccess('initialized', state, diagnosticsAdded);
    });
  }

  function updateConfig(input: unknown): CoreConfigUpdateResult {
    if (state === 'destroyed') {
      diagnostics.add({ code: 'invalid_lifecycle_call', operation: 'update_config' });
      return Object.freeze({ ok: false, code: 'destroyed', state, diagnosticsAdded: 1 });
    }
    if (state === 'created') {
      diagnostics.add({ code: 'invalid_lifecycle_call', operation: 'update_config' });
      return Object.freeze({ ok: false, code: 'not_initialized', state, diagnosticsAdded: 1 });
    }
    if (state === 'started') {
      diagnostics.add({ code: 'configuration_locked', operation: 'update_config' });
      return Object.freeze({ ok: false, code: 'configuration_locked', state, diagnosticsAdded: 1 });
    }
    const parsed = parseConfigurationUpdate(input);
    if (!parsed.ok) {
      diagnostics.add({ code: 'invalid_configuration', operation: 'update_config' });
      return Object.freeze({
        ok: false,
        code: 'invalid_configuration',
        state,
        diagnosticsAdded: 1,
      });
    }
    config = parsed.config;
    diagnostics.setCapacity(config.maxDiagnosticEntries);
    return Object.freeze({
      ok: true,
      code: 'configuration_updated',
      state,
      config: Object.freeze({ ...config }),
      diagnosticsAdded: 0,
    });
  }

  function start(): Promise<CoreLifecycleResult> {
    return serialize('start', async () => {
      if (state === 'destroyed') {
        addInvalidLifecycle('start');
        return lifecycleFailure('destroyed', state, 1);
      }
      if (state === 'created') {
        addInvalidLifecycle('start');
        return lifecycleFailure('not_initialized', state, 1);
      }
      if (state === 'started') return lifecycleSuccess('already_started', state);
      state = 'started';
      const diagnosticsAdded = await plugins.startAll(diagnostics);
      return lifecycleSuccess('started', state, diagnosticsAdded);
    });
  }

  function stop(): Promise<CoreLifecycleResult> {
    return serialize('stop', async () => {
      if (state === 'destroyed') {
        addInvalidLifecycle('stop');
        return lifecycleFailure('destroyed', state, 1);
      }
      if (state === 'created') {
        addInvalidLifecycle('stop');
        return lifecycleFailure('not_initialized', state, 1);
      }
      if (state !== 'started') return lifecycleSuccess('already_stopped', state);
      state = 'stopped';
      const diagnosticsAdded = await plugins.stopAll(diagnostics);
      return lifecycleSuccess('stopped', state, diagnosticsAdded);
    });
  }

  function destroy(): Promise<CoreLifecycleResult> {
    isRegistrationClosed = true;
    return serialize('destroy', async () => {
      if (state === 'destroyed') return lifecycleSuccess('already_destroyed', state);
      let diagnosticsAdded = 0;
      if (state === 'started') {
        state = 'stopped';
        diagnosticsAdded += await plugins.stopAll(diagnostics);
      }
      state = 'destroyed';
      diagnosticsAdded += await plugins.destroyAll(diagnostics);
      return lifecycleSuccess('destroyed', state, diagnosticsAdded);
    });
  }

  function submitEvent(input: unknown): CoreEventResult {
    return submitCoreEvent(state, input, diagnostics);
  }

  const pluginContext: CorePluginContext = Object.freeze({
    submitEvent: (input: unknown): CoreEventResult => submitEvent(input),
  });

  return Object.freeze({
    getState: (): CoreLifecycleState => state,
    getConfig,
    getDiagnostics: (): readonly CoreDiagnostic[] => diagnostics.snapshot(),
    registerPlugin,
    initialize,
    updateConfig,
    start,
    stop,
    destroy,
    submitEvent,
  });
}
