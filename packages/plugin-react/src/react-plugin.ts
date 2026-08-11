import {
  createAuroraSdk,
  type AuroraSdkHandle,
  type CreateAuroraSdkInput,
} from '@aurora/browser';
import { EventType, type ErrorEventBody } from '@aurora/event-schema';
import { Component, type ComponentType, type ReactNode } from 'react';
import { buildReactErrorDraft } from './react-error-bridge.js';

export interface AuroraErrorBoundaryProps {
  readonly children?: ReactNode;
  readonly fallback?: ReactNode;
}

export interface ReactAuroraPlugin {
  readonly name: 'aurora-react';
  readonly AuroraErrorBoundary: ComponentType<AuroraErrorBoundaryProps>;
  readonly sdk: AuroraSdkHandle;
  destroy(): Promise<void>;
}

const PLUGIN_NAME = 'aurora-react' as const;

interface BoundaryState {
  readonly hasError: boolean;
}

export function createReactAuroraPlugin(input: CreateAuroraSdkInput): ReactAuroraPlugin {
  const sdk = createAuroraSdk(input);
  let destroyed = false;
  let coreStarted = false;
  let startRequested = false;
  // 有界 pre-start 闩锁：React 在 commit 阶段（componentDidMount 之前）触发
  // componentDidCatch，早于 sdk.start() 完成；此时 core 尚未 started。缓冲只在上限
  // 内暂存草稿，start 成功后排空到同一统一管道，不是第二条上报链。
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
    if (destroyed) return;
    const draft = buildReactErrorDraft(err);
    if (!draft.ok) return;
    if (!coreStarted) {
      bufferBody(draft.body);
      return;
    }
    submitBody(draft.body);
  }

  function ensureStarted(): void {
    if (startRequested || destroyed) return;
    startRequested = true;
    void sdk.start().then((result) => {
      if (result.ok) {
        coreStarted = true;
        drainPending();
      }
    });
  }

  // class Error Boundary：StrictMode 开发期会双调用 constructor/render/生命周期。
  // componentDidMount 经 ensureStarted 幂等守卫（只启动一次 SDK）；componentWillUnmount
  // 无任何宿主全局可恢复（本包不注册全局监听，window 错误由 plugin-error 覆盖），
  // 因此双挂载/卸载天然无重复注册、无残留。
  class AuroraErrorBoundary extends Component<AuroraErrorBoundaryProps, BoundaryState> {
    override state: BoundaryState = { hasError: false };

    static getDerivedStateFromError(): BoundaryState {
      return { hasError: true };
    }

    override componentDidCatch(error: unknown): void {
      submitFrameworkError(error);
    }

    override componentDidMount(): void {
      ensureStarted();
    }

    override componentWillUnmount(): void {
      // 无副作用；不销毁共享 SDK（同一插件实例可被多个边界共享，卸载不应破坏其他子树）。
    }

    override render(): ReactNode {
      return this.state.hasError ? (this.props.fallback ?? null) : this.props.children;
    }
  }

  return Object.freeze({
    name: PLUGIN_NAME,
    AuroraErrorBoundary,
    sdk,
    async destroy(): Promise<void> {
      destroyed = true;
      pendingBodies = [];
      coreStarted = false;
      await sdk.destroy();
    },
  });
}
