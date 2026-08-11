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
  createSdkDeliveryChain,
  isSdkEventDraft,
  parseOrigin,
  parseSdkConfig,
  type SafeActivityEntry,
  type SdkBatchTransport,
  type SdkConfigSnapshot,
  type SdkControlPlane,
  type SdkDeliveryChain,
} from '@aurora/sdk';
import { createBrowserEnvironment, type BrowserEnvironment } from './browser-environment.js';
import { createBrowserBatchTransport } from './delivery-transport.js';
import { PageLifecycleEventType, type BrowserSubscription } from './page-lifecycle.js';

export interface CreateAuroraSdkInput {
  readonly config: unknown;
  readonly environment?: BrowserEnvironment;
  readonly plugins?: readonly CorePlugin[];
  readonly pageOrigin?: string;
  readonly ingestEndpoint?: string;
  readonly transport?: SdkBatchTransport;
}

export interface AuroraSdkHandle {
  readonly config: SdkConfigSnapshot;
  readonly core: AuroraCore;
  readonly control: SdkControlPlane;
  readonly delivery: SdkDeliveryChain;
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
  delivery: SdkDeliveryChain,
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
      const result = core.submitEventDraft(processed.event);
      if (result.ok && result.event !== undefined) {
        const enqueued = delivery.enqueue(result.event);
        if (enqueued.ok) void delivery.flush();
      }
      return result;
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

function createHostScheduler(): (fn: () => void, delayMs?: number) => void {
  return (fn: () => void, delayMs?: number): void => {
    if (delayMs !== undefined && delayMs > 0) {
      setTimeout(fn, delayMs);
    } else {
      queueMicrotask(fn);
    }
  };
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
  const transport =
    input.transport ??
    createBrowserBatchTransport({ ingestEndpoint: input.ingestEndpoint ?? '' });
  const delivery = createSdkDeliveryChain(
    { clientKey: config.clientKey, environment: config.environment },
    { transport, schedule: createHostScheduler() },
  );
  for (const plugin of input.plugins ?? []) {
    core.registerPlugin(wrapPlugin(plugin, core, control, config, delivery));
  }
  let lifecycleSubscription: BrowserSubscription | undefined;
  return Object.freeze({
    config,
    core,
    control,
    delivery,
    getActivityTrail: (): readonly SafeActivityEntry[] => control.getActivityTrail(),
    start: async (): Promise<CoreLifecycleResult> => {
      const initialized = await core.initialize();
      if (!initialized.ok) return initialized;
      const started = await core.start();
      if (started.ok) {
        recordPageEnter(environment, control);
        const subscribed = environment.subscribePageLifecycle((event): void => {
          if (event.type === PageLifecycleEventType.PageHide) {
            void delivery.flush({ bestEffort: true });
          }
        });
        if (subscribed.ok) lifecycleSubscription = subscribed.subscription;
      }
      return started;
    },
    stop: (): Promise<CoreLifecycleResult> => core.stop(),
    destroy: (): Promise<CoreLifecycleResult> => {
      if (lifecycleSubscription !== undefined) {
        lifecycleSubscription.unsubscribe();
        lifecycleSubscription = undefined;
      }
      delivery.destroy();
      control.destroy();
      return core.destroy();
    },
  });
}
