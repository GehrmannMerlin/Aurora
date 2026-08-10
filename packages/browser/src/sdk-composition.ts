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
  parseOrigin,
  parseSdkConfig,
  type SafeActivityEntry,
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
  readonly getActivityTrail: () => readonly SafeActivityEntry[];
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
  const controlContext: CorePluginContext & {
    readonly getConfig: () => SdkConfigSnapshot;
    readonly recordActivity: (entry: unknown) => ReturnType<SdkControlPlane['recordActivity']>;
  } = {
    submitEvent: (input: unknown): CoreEventDraftResult => {
      if (!isSdkEventDraft(input)) return rejectedDraftResult();
      const processed = control.processEvent(input);
      if (!processed.ok) return rejectedDraftResult();
      if (processed.sampledOut) return acceptedDraftResult();
      return core.submitEventDraft(processed.event);
    },
    getConfig: (): SdkConfigSnapshot => config,
    recordActivity: (entry: unknown) => control.recordActivity(entry),
  };
  return Object.freeze({
    name: plugin.name,
    initialize: (): void | Promise<void> => plugin.initialize(controlContext),
    start: (): void | Promise<void> => plugin.start(),
    stop: (): void | Promise<void> => plugin.stop(),
    destroy: (): void | Promise<void> => plugin.destroy(),
  });
}

function recordPageEnter(environment: BrowserEnvironment, control: SdkControlPlane): void {
  const snapshot = environment.readPageSnapshot();
  if (snapshot.pageUrl === null) return;
  const parsed = parseOrigin(snapshot.pageUrl);
  if (parsed === null) return;
  const pathname = snapshot.pageUrl.startsWith(parsed.origin)
    ? snapshot.pageUrl.slice(parsed.origin.length)
    : snapshot.pageUrl;
  void control.recordActivity({
    kind: 'page_enter',
    occurredAt: Date.now(),
    origin: parsed.origin,
    pathname: pathname.length === 0 ? '/' : pathname,
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
  return Object.freeze({
    config,
    core,
    control,
    getActivityTrail: (): readonly SafeActivityEntry[] => control.getActivityTrail(),
    start: async (): Promise<CoreLifecycleResult> => {
      const initialized = await core.initialize();
      if (!initialized.ok) return initialized;
      const started = await core.start();
      if (started.ok) recordPageEnter(environment, control);
      return started;
    },
    stop: (): Promise<CoreLifecycleResult> => core.stop(),
    destroy: (): Promise<CoreLifecycleResult> => {
      control.destroy();
      return core.destroy();
    },
  });
}
