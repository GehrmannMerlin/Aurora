import {
  createCore,
  type AuroraCore,
  type CoreEventDraftResult,
  type CoreLifecycleResult,
  type CorePlugin,
  type CorePluginContext,
} from '@aurora/core';
import {
  createSafeDefaultSdkConfig,
  createSdkControlPlane,
  isSdkEventDraft,
  parseSdkConfig,
  type SdkConfigSnapshot,
  type SdkControlPlane,
} from '@aurora/sdk';
import { createBrowserEnvironment, type BrowserEnvironment } from './browser-environment.js';

export interface CreateAuroraSdkInput {
  readonly config: unknown;
  readonly environment?: BrowserEnvironment;
  readonly plugins?: readonly CorePlugin[];
  readonly pageOrigin?: string;
}

export interface AuroraSdkHandle {
  readonly config: SdkConfigSnapshot;
  readonly core: AuroraCore;
  readonly control: SdkControlPlane;
  readonly start: () => Promise<CoreLifecycleResult>;
  readonly stop: () => Promise<CoreLifecycleResult>;
  readonly destroy: () => Promise<CoreLifecycleResult>;
}

function rejectedDraftResult(): CoreEventDraftResult {
  return Object.freeze({ ok: false, code: 'invalid_event', state: 'started', issues: [], diagnosticsAdded: 1 });
}

function acceptedDraftResult(): CoreEventDraftResult {
  return Object.freeze({ ok: true, code: 'accepted', state: 'started', diagnosticsAdded: 0 });
}

function wrapPlugin(
  plugin: CorePlugin,
  core: AuroraCore,
  control: SdkControlPlane,
  config: SdkConfigSnapshot,
): CorePlugin {
  const controlContext: CorePluginContext & { readonly getConfig: () => SdkConfigSnapshot } = {
    submitEvent: (input: unknown): CoreEventDraftResult => {
      if (!isSdkEventDraft(input)) return rejectedDraftResult();
      const processed = control.processEvent(input);
      if (!processed.ok) return rejectedDraftResult();
      if (processed.sampledOut) return acceptedDraftResult();
      return core.submitEventDraft(processed.event);
    },
    getConfig: (): SdkConfigSnapshot => config,
  };
  return Object.freeze({
    name: plugin.name,
    initialize: (): void | Promise<void> => plugin.initialize(controlContext),
    start: (): void | Promise<void> => plugin.start(),
    stop: (): void | Promise<void> => plugin.stop(),
    destroy: (): void | Promise<void> => plugin.destroy(),
  });
}

export function createAuroraSdk(input: CreateAuroraSdkInput): AuroraSdkHandle {
  const parsed = parseSdkConfig(input.config);
  const config = parsed.ok ? parsed.config : createSafeDefaultSdkConfig();
  const environment = input.environment ?? createBrowserEnvironment();
  const core = createCore();
  const control =
    input.pageOrigin === undefined
      ? createSdkControlPlane(config)
      : createSdkControlPlane(config, { pageOrigin: input.pageOrigin });
  for (const plugin of input.plugins ?? []) {
    core.registerPlugin(wrapPlugin(plugin, core, control, config));
  }
  void environment;
  return Object.freeze({
    config,
    core,
    control,
    start: async (): Promise<CoreLifecycleResult> => {
      const initialized = await core.initialize();
      if (!initialized.ok) return initialized;
      return core.start();
    },
    stop: (): Promise<CoreLifecycleResult> => core.stop(),
    destroy: (): Promise<CoreLifecycleResult> => {
      control.destroy();
      return core.destroy();
    },
  });
}
