import {
  createAuroraSdk,
  type AuroraSdkHandle,
  type CreateAuroraSdkInput,
} from '@aurora/browser';
import { EventType, type ErrorEventBody } from '@aurora/event-schema';
import type { App } from 'vue';
import { buildVueErrorDraft } from './vue-error-bridge.js';

// 复用 Vue app.config.errorHandler 的非可选类型；V1 错误桥不读取 instance 内部状态。
type VueErrorHandler = NonNullable<App['config']['errorHandler']>;

export interface VueRouteLocationLike {
  readonly path?: unknown;
  readonly fullPath?: unknown;
}

export interface VueRouterLike {
  readonly afterEach: (hook: (to: VueRouteLocationLike) => void) => () => void;
}

export function isVueRouterLike(value: unknown): value is VueRouterLike {
  if (value === null || typeof value !== 'object') return false;
  return typeof (value as { readonly afterEach?: unknown }).afterEach === 'function';
}

export interface VueAuroraOptions {
  readonly router?: unknown;
}

export interface VueAuroraPlugin {
  readonly name: 'aurora-vue';
  install(app: App, options?: VueAuroraOptions): void;
  uninstall(app: App): void;
  readonly sdk: AuroraSdkHandle;
  destroy(): Promise<void>;
}

const PLUGIN_NAME = 'aurora-vue' as const;

export function createVueAuroraPlugin(input: CreateAuroraSdkInput): VueAuroraPlugin {
  const sdk = createAuroraSdk(input);
  let boundApp: App | undefined;
  let originalHandler: VueErrorHandler | undefined;
  let wrappedHandler: VueErrorHandler | undefined;
  let routeOff: (() => void) | undefined;
  let destroyed = false;
  let coreStarted = false;
  // 有界 pre-start 闩锁：Vue 的 errorHandler 在 mount 的同步渲染中触发，早于
  // sdk.start() 的微任务完成；此时 core 尚未 started，直接提交会返回 not_started。
  // 该缓冲只在上限内暂存草稿，start 完成后排空到同一统一管道，不是第二条上报链。
  const MAX_PENDING_BODIES = 32;
  let pendingBodies: ErrorEventBody[] = [];

  function submitBody(body: ErrorEventBody): void {
    let processed;
    try {
      processed = sdk.control.processEvent({ eventType: EventType.Error, body });
    } catch {
      return;
    }
    if (!processed.ok || processed.sampledOut) return;
    try {
      const result = sdk.core.submitEventDraft(processed.event);
      if (result.ok && result.event !== undefined) {
        const enqueued = sdk.delivery.enqueue(result.event);
        if (enqueued.ok) void sdk.delivery.flush();
      }
    } catch {
      // 内部失败静默丢弃，宿主安全。
    }
  }

  function bufferBody(body: ErrorEventBody): void {
    if (pendingBodies.length >= MAX_PENDING_BODIES) pendingBodies.shift();
    pendingBodies.push(body);
  }

  function drainPending(): void {
    if (!coreStarted) return;
    const toSubmit = pendingBodies;
    pendingBodies = [];
    for (const body of toSubmit) submitBody(body);
  }

  function submitFrameworkError(err: unknown): void {
    const draft = buildVueErrorDraft(err);
    if (!draft.ok) return;
    if (!coreStarted) {
      bufferBody(draft.body);
      return;
    }
    submitBody(draft.body);
  }

  function recordRouteChange(to: VueRouteLocationLike): void {
    const pathname =
      typeof to.fullPath === 'string'
        ? to.fullPath
        : typeof to.path === 'string'
          ? to.path
          : null;
    if (pathname === null || pathname === '') return;
    try {
      void sdk.control.recordActivity({
        kind: 'route_change',
        occurredAt: Date.now(),
        pathname,
      });
    } catch {
      // 内部失败静默丢弃。
    }
  }

  function releaseApp(app: App): void {
    if (app.config.errorHandler === wrappedHandler) {
      if (originalHandler === undefined) {
        delete app.config.errorHandler;
      } else {
        app.config.errorHandler = originalHandler;
      }
    }
    if (routeOff !== undefined) {
      routeOff();
      routeOff = undefined;
    }
    originalHandler = undefined;
    wrappedHandler = undefined;
    boundApp = undefined;
  }

  return Object.freeze({
    name: PLUGIN_NAME,
    install(app: App, options?: VueAuroraOptions): void {
      if (destroyed || boundApp !== undefined) return;
      const handler: VueErrorHandler = (err, instance, info): void => {
        if (originalHandler !== undefined) originalHandler(err, instance, info);
        submitFrameworkError(err);
      };
      originalHandler = app.config.errorHandler;
      wrappedHandler = handler;
      app.config.errorHandler = handler;
      boundApp = app;
      if (options?.router !== undefined && isVueRouterLike(options.router)) {
        routeOff = options.router.afterEach((to) => {
          recordRouteChange(to);
        });
      }
      void sdk.start().then((result) => {
        if (result.ok) {
          coreStarted = true;
          drainPending();
        }
      });
    },
    uninstall(app: App): void {
      if (boundApp !== app) return;
      releaseApp(app);
      void sdk.destroy();
    },
    sdk,
    async destroy(): Promise<void> {
      if (!destroyed) {
        destroyed = true;
        if (boundApp !== undefined) releaseApp(boundApp);
      }
      pendingBodies = [];
      coreStarted = false;
      await sdk.destroy();
    },
  });
}
