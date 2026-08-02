# Core Event Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `@aurora/core` 建立所有 SDK 插件共用的最小事件草稿、实例级 ID/时间 Provider、标准 `EventEnvelope` 创建与统一提交边界。

**Architecture:** Core 在每个 `createCore()` 实例内快照同步 Provider，精确解析 `eventType + body` 草稿，填入 `CURRENT_PROTOCOL_VERSION`、事件 ID 和 Unix 毫秒时间，再只通过 `@aurora/event-schema` 根出口的 `parseEventEnvelope` 校验。插件上下文保留唯一 `submitEvent` 键但收紧为草稿语义；既有 `AuroraCore.submitEvent` 完整信封入口保持兼容，新增 `submitEventDraft` 供公开黑盒验证和宿主适配器复用。

**Tech Stack:** Node.js `24.18.0`、pnpm `11.17.0`、TypeScript `6.0.3` strict/ESM、Vitest `4.1.10`、`@vitest/coverage-v8` `4.1.10`、ESLint `10.8.0`、`@aurora/event-schema` 公共根入口、`@aurora/workspace-policy`。

## Global Constraints

- 只实施 `packages/core` 的标准事件创建与提交边界第一增量；不创建 `packages/plugin-error`。
- `event-schema` 继续是协议版本、事件类型、信封和运行时解析的唯一来源；Core 不复制校验规则。
- Core 不依赖 Browser、具体插件、框架、服务端或 Node 专属运行时模块；生产构建保持无 DOM。
- 插件草稿只能有 `eventType` 和 `body`；`eventId`、`occurredAt`、`protocolVersion` 及其他额外键必须失败。
- 默认 ID 只在调用时安全使用 `globalThis.crypto.randomUUID`；能力缺失时稳定失败，不用 `Math.random`、时间拼接或全局计数器降级。
- Provider 同步、可注入、按实例隔离；Provider 抛错和非法返回值不得影响宿主或其他实例。
- 所有公开函数显式标注参数和返回类型；不使用无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言或非空断言。
- 文件名用 `kebab-case`，类型用 `PascalCase`，函数/变量用 `camelCase`，布尔值用 `is`、`has`、`can`、`should` 前缀。
- 不创建 `utils`、`helpers`、`common`、`misc`、通用事件总线、队列、批处理、采样、传输、重试或持久化抽象。
- 诊断有界且不含异常文本、堆栈、Provider 返回值、草稿、正文、URL、凭据或用户数据；不使用 `console`。
- Core 覆盖率保持 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%。
- ADR-003/005/006 保持 `accepted / in-progress`，ADR-007 保持 `accepted / implemented`；仅在完整实施门禁通过后追加有限证据。
- 执行前复查完整 `git status`、暂存区、tracked 与 untracked 修改；不得覆盖用户已有工作，不得在未授权时提交或推送。

---

## Authoritative Inputs

执行 Task 1 前完整读取 `CLAUDE.md`、`AGENTS.md`、`AURORA_RULES.md`、核心业务 PRD、六份 Aurora 长期规范、本文规格 `docs/sdk/core-event-creation.md`、本计划列出的架构/SDK/协议/测试文档、ADR-003/005/006/007、当前全部实施计划，以及当前 `packages/core`、`packages/event-schema`、`packages/browser`、`tooling/workspace-policy`。只把 approved 文档、accepted ADR 和已实现公共接口当作正式依据。

## Frozen Public API

实施完成后的新增或调整签名固定为：

```ts
import type { EventType } from '@aurora/event-schema';

export interface CoreEventDraft {
  readonly eventType: EventType;
  readonly body: unknown;
}

export interface CoreEventIdProvider {
  createEventId(): string;
}

export interface CoreEventTimeProvider {
  now(): number;
}

export interface CoreEventProviders {
  readonly eventIdProvider?: CoreEventIdProvider;
  readonly eventTimeProvider?: CoreEventTimeProvider;
}

export interface CoreInvalidEventDraft {
  readonly ok: false;
  readonly code: 'invalid_event_draft';
  readonly state: 'started';
  readonly diagnosticsAdded: 1;
}

export interface CoreEventCreationFailure {
  readonly ok: false;
  readonly code: 'event_creation_failed';
  readonly state: 'started';
  readonly diagnosticsAdded: 1;
}

export type CoreEventDraftResult =
  | CoreEventResult
  | CoreInvalidEventDraft
  | CoreEventCreationFailure;

export interface CorePluginContext {
  readonly submitEvent: (input: unknown) => CoreEventDraftResult;
}

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
  submitEventDraft(input: unknown): CoreEventDraftResult;
}

export function createCore(providers?: CoreEventProviders): AuroraCore;
```

`submitEventDraft` 和插件上下文 `submitEvent` 都是同步、可重复调用的方法；只有 `started` 调用 Provider。重复或并发调用各表示一个新事件；生命周期限制和错误结构以规格第 9—12 节为准。

## Complete File Tree and Responsibilities

```text
packages/core/
├── src/
│   ├── core.ts                       # Core 实例、Provider snapshot 所有权、两个提交入口
│   ├── diagnostics.ts                # 新增三种稳定诊断代码
│   ├── event-creation.ts             # 组合草稿、Provider、协议版本和最终 parser
│   ├── event-draft.ts                # 精确草稿类型与 unknown 运行时解析
│   ├── event-entry.ts                # 既有完整信封入口、草稿结果映射与 issue 冻结
│   ├── event-providers.ts            # Provider 公共类型、默认实现和实例级安全快照
│   ├── index.ts                      # 唯一包根出口
│   └── plugin-contract.ts            # 插件上下文改为草稿结果
├── test/
│   ├── event-creation.test.ts        # 字段构造、最终解析、不可变与非法值
│   ├── event-providers.test.ts       # 默认/注入 Provider、能力缺失和抛错
│   ├── event-entry.test.ts           # 既有完整信封兼容及公开草稿入口
│   ├── plugin-lifecycle.test.ts      # 插件上下文草稿语义和失败隔离
│   ├── multi-instance.test.ts        # Provider/提交/诊断实例隔离
│   ├── host-safety.test.ts           # 失败后恢复和脱敏诊断
│   ├── no-dom-consumer.ts            # 无 DOM 公共 API 编译夹具
│   ├── architecture-boundary.test.ts # 无 Node/Browser/私有路径契约
│   ├── package-entry.test.ts         # 唯一运行时根出口和私有路径拒绝
│   └── documentation-contract.test.ts# README/规格/ADR 状态契约
├── README.md                          # 草稿、Provider、兼容、生命周期与排除范围
└── package.json                       # 保持一个根出口与既有命令
tooling/workspace-policy/
├── src/environment.ts                 # sdk-core 的 Node 运行时负例
└── test/environment.test.ts           # node: 导入和 Node 全局负例
docs/sdk/
├── core-event-creation.md             # 本增量正式规格与实施状态
└── sdk-core-foundation.md              # 指向新增已实施边界
docs/architecture/sdk-architecture.md  # Core/插件/Browser/event-schema 边界证据
docs/architecture/formalization-readiness.md # 当前实施库存与顺序
docs/testing/test-strategy.md           # Provider、草稿和边界门禁
docs/adr/ADR-003-sdk-plugin-architecture.md  # 有限实现证据，状态不升级
docs/adr/ADR-005-event-schema-source-of-truth.md # 单一协议来源证据
docs/adr/ADR-006-one-way-dependencies.md # 环境与依赖证据
docs/README.md                          # 正式规格索引
README.md                               # 当前真实包能力
AGENTS.md                               # 当前状态和决策队列
AURORA_RULES.md                         # 当前状态和决策队列
package.json                            # 根格式/lint/check 文件清单
```

---

### Task 1: Freeze Draft, Provider, and Result Contracts

**Files:**
- Create: `packages/core/src/event-draft.ts`
- Create: `packages/core/src/event-providers.ts`
- Create: `packages/core/test/event-creation.test.ts`
- Modify: `packages/core/src/event-entry.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/no-dom-consumer.ts`

**Interfaces:**
- Consumes: `EventType` and `isEventType(input: unknown): input is EventType` from `@aurora/event-schema` root; existing `CoreEventResult`.
- Produces: all Frozen Public API draft/provider/result types; internal `parseCoreEventDraft(input: unknown): CoreEventDraftParseResult`.

- [ ] **Step 1: Write the failing contract and hostile-input tests**

Create `packages/core/test/event-creation.test.ts` with the first block:

```ts
import { EventType } from '@aurora/event-schema';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createCore,
  type CoreEventDraft,
  type CoreEventDraftResult,
  type CoreEventIdProvider,
  type CoreEventProviders,
  type CoreEventTimeProvider,
} from '../src/index.js';
import { parseCoreEventDraft } from '../src/event-draft.js';

describe('Core event draft contract', () => {
  it('publishes exact draft and Provider types', () => {
    expectTypeOf<CoreEventDraft>().toEqualTypeOf<{
      readonly eventType: 'error' | 'request' | 'performance' | 'resource';
      readonly body: unknown;
    }>();
    expectTypeOf<CoreEventIdProvider['createEventId']>().returns.toEqualTypeOf<string>();
    expectTypeOf<CoreEventTimeProvider['now']>().returns.toEqualTypeOf<number>();
    expectTypeOf<CoreEventProviders>().toMatchTypeOf<{
      readonly eventIdProvider?: CoreEventIdProvider;
      readonly eventTimeProvider?: CoreEventTimeProvider;
    }>();
    expectTypeOf<ReturnType<ReturnType<typeof createCore>['submitEventDraft']>>()
      .toEqualTypeOf<CoreEventDraftResult>();
  });

  it('accepts exactly eventType and body without retaining the wrapper', () => {
    const body = { message: 'safe' };
    const input = { eventType: EventType.Error, body };
    const parsed = parseCoreEventDraft(input);
    expect(parsed).toEqual({ ok: true, draft: { eventType: EventType.Error, body } });
    expect(parsed.ok && parsed.draft).not.toBe(input);
  });

  it.each([
    null,
    [],
    {},
    { eventType: EventType.Error },
    { body: {} },
    { eventType: 'ERROR', body: {} },
    { eventType: EventType.Error, body: {}, eventId: 'forged' },
    { eventType: EventType.Error, body: {}, occurredAt: 1 },
    { eventType: EventType.Error, body: {}, protocolVersion: 1 },
    { eventType: EventType.Error, body: {}, [Symbol('extra')]: true },
  ])('rejects expanded or invalid runtime draft %#', (input) => {
    expect(parseCoreEventDraft(input)).toEqual({ ok: false });
  });

  it('contains hostile reflection without reading its exception text', () => {
    const input = new Proxy({}, { ownKeys: (): never => { throw new Error('token=hidden'); } });
    expect(() => parseCoreEventDraft(input)).not.toThrow();
    expect(parseCoreEventDraft(input)).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run red and verify the missing-module reason**

Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/event-creation.test.ts
```

Expected: exit `1`; resolution fails for `../src/event-draft.js` and root type exports. A syntax or fixture failure is not an acceptable red result.

- [ ] **Step 3: Implement the exact draft parser and public value types**

Create `packages/core/src/event-draft.ts`:

```ts
import { isEventType, type EventType } from '@aurora/event-schema';

export interface CoreEventDraft {
  readonly eventType: EventType;
  readonly body: unknown;
}

export type CoreEventDraftParseResult =
  | { readonly ok: true; readonly draft: CoreEventDraft }
  | { readonly ok: false };

const eventTypeKey = 'eventType';
const bodyKey = 'body';

function isPlainObject(input: unknown): input is object {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

export function parseCoreEventDraft(input: unknown): CoreEventDraftParseResult {
  try {
    if (!isPlainObject(input)) return { ok: false };
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== 2 ||
      !keys.includes(eventTypeKey) ||
      !keys.includes(bodyKey) ||
      keys.some((key) => typeof key !== 'string')
    ) return { ok: false };
    const eventType: unknown = Reflect.get(input, eventTypeKey);
    if (!isEventType(eventType)) return { ok: false };
    const body: unknown = Reflect.get(input, bodyKey);
    return { ok: true, draft: Object.freeze({ eventType, body }) };
  } catch {
    return { ok: false };
  }
}
```

Create the public declarations at the top of `packages/core/src/event-providers.ts`:

```ts
export interface CoreEventIdProvider { createEventId(): string; }
export interface CoreEventTimeProvider { now(): number; }
export interface CoreEventProviders {
  readonly eventIdProvider?: CoreEventIdProvider;
  readonly eventTimeProvider?: CoreEventTimeProvider;
}
```

Add to `packages/core/src/event-entry.ts` after `CoreEventResult`:

```ts
export interface CoreInvalidEventDraft {
  readonly ok: false;
  readonly code: 'invalid_event_draft';
  readonly state: 'started';
  readonly diagnosticsAdded: 1;
}

export interface CoreEventCreationFailure {
  readonly ok: false;
  readonly code: 'event_creation_failed';
  readonly state: 'started';
  readonly diagnosticsAdded: 1;
}

export type CoreEventDraftResult =
  | CoreEventResult
  | CoreInvalidEventDraft
  | CoreEventCreationFailure;
```

Export the new public types from `packages/core/src/index.ts`; keep `createCore` as the only runtime value export:

```ts
export type { CoreEventDraft } from './event-draft.js';
export type {
  CoreEventIdProvider,
  CoreEventProviders,
  CoreEventTimeProvider,
} from './event-providers.js';
export type {
  CoreEventCreationFailure,
  CoreEventDraftResult,
  CoreInvalidEventDraft,
} from './event-entry.js';
```

Add compile-only type use to `packages/core/test/no-dom-consumer.ts`:

```ts
import type { CoreEventDraft, CoreEventProviders } from '../src/index.js';
const providers: CoreEventProviders = {
  eventIdProvider: { createEventId: (): string => 'compile-event' },
  eventTimeProvider: { now: (): number => 1 },
};
const draft: CoreEventDraft = { eventType: 'error', body: null };
void [providers, draft];
```

- [ ] **Step 4: Run green and task regression**

Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/event-creation.test.ts
pnpm --filter @aurora/core typecheck
pnpm exec eslint packages/core/src packages/core/test packages/core/vitest.config.ts
```

Expected: all exit `0`; draft tests pass, strict/no-DOM compilers emit no diagnostics, ESLint reports no `any`, non-null assertion, naming or type-import violation.

- [ ] **Step 5: Inspect and record the suggested commit boundary**

Run `git diff -- packages/core/src/event-draft.ts packages/core/src/event-providers.ts packages/core/src/event-entry.ts packages/core/src/index.ts packages/core/test/event-creation.test.ts packages/core/test/no-dom-consumer.ts` and `git status --short --untracked-files=all`.

Expected: only Task 1 files plus preserved pre-existing work. Suggested commit: `feat(core): define event draft and provider contracts`.

---

### Task 2: Implement Default and Injected Providers

**Files:**
- Modify: `packages/core/src/event-providers.ts`
- Create: `packages/core/test/event-providers.test.ts`
- Modify: `packages/core/src/core.ts`

**Interfaces:**
- Consumes: Task 1 `CoreEventProviders`.
- Produces: internal `CoreEventProviderSnapshot`, `snapshotEventProviders(input?: CoreEventProviders): CoreEventProviderSnapshot`, and `createCore(providers?: CoreEventProviders): AuroraCore` ownership.

- [ ] **Step 1: Write failing Provider behavior tests**

Create `packages/core/test/event-providers.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshotEventProviders } from '../src/event-providers.js';

afterEach(() => vi.unstubAllGlobals());

describe('Core event providers', () => {
  it('uses Date.now and crypto.randomUUID only when called', () => {
    const randomUUID = vi.fn(() => 'default-event-id');
    vi.stubGlobal('crypto', { randomUUID });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const providers = snapshotEventProviders();
    expect(randomUUID).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(providers.createEventId()).toBe('default-event-id');
    expect(providers.now()).toBe(1_800_000_000_000);
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(now).toHaveBeenCalledOnce();
    now.mockRestore();
  });

  it('captures deterministic methods and preserves each receiver', () => {
    const eventIdProvider = {
      prefix: 'first',
      createEventId(): string { return `${this.prefix}-event`; },
    };
    const eventTimeProvider = {
      value: 42,
      now(): number { return this.value; },
    };
    const providers = snapshotEventProviders({ eventIdProvider, eventTimeProvider });
    eventIdProvider.createEventId = (): string => 'replacement';
    eventTimeProvider.now = (): number => 99;
    expect(providers.createEventId()).toBe('first-event');
    expect(providers.now()).toBe(42);
  });

  it('represents missing, non-callable, getter, and invocation failures as throws', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => snapshotEventProviders().createEventId()).toThrow();
    const hostile = Object.create(null, {
      eventIdProvider: { get: (): never => { throw new Error('credential'); } },
    });
    expect(() => snapshotEventProviders(hostile).createEventId()).toThrow();
    expect(() => snapshotEventProviders({
      eventIdProvider: { createEventId: (): never => { throw new Error('secret'); } },
    }).createEventId()).toThrow();
  });
});
```

The hostile argument deliberately crosses the JavaScript runtime boundary; `snapshotEventProviders` implementation accepts `CoreEventProviders | undefined` publicly through `createCore` but narrows every reflected value from `unknown` internally.

- [ ] **Step 2: Run red**

Run `pnpm --filter @aurora/core exec vitest run test/event-providers.test.ts`.

Expected: exit `1` because `snapshotEventProviders` is absent.

- [ ] **Step 3: Implement environment-neutral Provider snapshots**

Complete `packages/core/src/event-providers.ts`:

```ts
export interface CoreEventIdProvider { createEventId(): string; }
export interface CoreEventTimeProvider { now(): number; }
export interface CoreEventProviders {
  readonly eventIdProvider?: CoreEventIdProvider;
  readonly eventTimeProvider?: CoreEventTimeProvider;
}

export interface CoreEventProviderSnapshot {
  readonly createEventId: () => unknown;
  readonly now: () => unknown;
}

type UnknownCallable = (...args: readonly unknown[]) => unknown;

function isObjectLike(input: unknown): input is object {
  return (typeof input === 'object' && input !== null) || typeof input === 'function';
}

function defaultCreateEventId(): unknown {
  const cryptoValue: unknown = Reflect.get(globalThis, 'crypto');
  if (!isObjectLike(cryptoValue)) throw new TypeError('event ID capability unavailable');
  const randomUUID: unknown = Reflect.get(cryptoValue, 'randomUUID');
  if (typeof randomUUID !== 'function') throw new TypeError('event ID capability unavailable');
  return Reflect.apply(randomUUID as UnknownCallable, cryptoValue, []);
}

function defaultNow(): unknown { return Date.now(); }

function snapshotMethod(
  owner: unknown,
  key: 'createEventId' | 'now',
  fallback: () => unknown,
): () => unknown {
  if (owner === undefined) return fallback;
  try {
    if (!isObjectLike(owner)) return (): never => { throw new TypeError('invalid provider'); };
    const method: unknown = Reflect.get(owner, key);
    if (typeof method !== 'function') return (): never => { throw new TypeError('invalid provider'); };
    return (): unknown => Reflect.apply(method as UnknownCallable, owner, []);
  } catch {
    return (): never => { throw new TypeError('invalid provider'); };
  }
}

export function snapshotEventProviders(input?: unknown): CoreEventProviderSnapshot {
  let eventIdProvider: unknown;
  let eventTimeProvider: unknown;
  try {
    eventIdProvider = input === undefined ? undefined : Reflect.get(input, 'eventIdProvider');
    eventTimeProvider = input === undefined ? undefined : Reflect.get(input, 'eventTimeProvider');
  } catch {
    return Object.freeze({
      createEventId: (): never => { throw new TypeError('invalid providers'); },
      now: (): never => { throw new TypeError('invalid providers'); },
    });
  }
  return Object.freeze({
    createEventId: snapshotMethod(eventIdProvider, 'createEventId', defaultCreateEventId),
    now: snapshotMethod(eventTimeProvider, 'now', defaultNow),
  });
}
```

The two narrow `as UnknownCallable` assertions follow an immediate `typeof method === 'function'` proof; no double assertion exists. Error messages never leave the function and are not recorded.

Modify `createCore` only enough to own the snapshot:

```ts
import {
  snapshotEventProviders,
  type CoreEventProviderSnapshot,
  type CoreEventProviders,
} from './event-providers.js';

export function createCore(providers?: CoreEventProviders): AuroraCore {
  const eventProviders: CoreEventProviderSnapshot = snapshotEventProviders(providers);
  // keep every existing per-instance declaration and method
  void eventProviders;
}
```

Remove `void eventProviders` in Task 4 when the public draft entry consumes it.

- [ ] **Step 4: Run green and environment checks**

Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/event-providers.test.ts test/lifecycle.test.ts
pnpm --filter @aurora/core typecheck
pnpm check:boundaries
```

Expected: all exit `0`; Provider tests pass, no-DOM compilation accepts `globalThis`/`Date`, and Workspace Policy reports no Browser global, module-level mutable state or forbidden layer dependency.

- [ ] **Step 5: Review and record the suggested commit boundary**

Confirm no `node:` import, DOM type, `Math.random`, module-level counter or provider cache exists. Suggested commit: `feat(core): add instance-local event providers`.

---

### Task 3: Create and Validate EventEnvelope

**Files:**
- Create: `packages/core/src/event-creation.ts`
- Modify: `packages/core/test/event-creation.test.ts`
- Modify: `packages/core/src/event-entry.ts`

**Interfaces:**
- Consumes: `CURRENT_PROTOCOL_VERSION`, `parseEventEnvelope`, `EventEnvelope`, `EventSchemaIssue` from `@aurora/event-schema` root; Task 1 parser; Task 2 snapshot.
- Produces: `createCoreEventEnvelope(input, providers): CoreEventCreationResult` with exact successful `EventEnvelope` or stable internal failure.

- [ ] **Step 1: Add failing construction, final-parser, and immutability tests**

Append to `packages/core/test/event-creation.test.ts`:

```ts
import { CURRENT_PROTOCOL_VERSION } from '@aurora/event-schema';
import { createCoreEventEnvelope } from '../src/event-creation.js';

describe('Core EventEnvelope creation', () => {
  it('fills the one protocol version, ID, time, event type, and body', () => {
    const body = Object.freeze({ message: 'safe' });
    const result = createCoreEventEnvelope(
      { eventType: EventType.Error, body },
      { createEventId: () => 'event-0001', now: () => 1_800_000_000_000 },
    );
    expect(result).toEqual({
      ok: true,
      event: {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        eventId: 'event-0001',
        eventType: EventType.Error,
        occurredAt: 1_800_000_000_000,
        body,
      },
    });
  });

  it.each([
    [{ eventType: EventType.Error }, 'invalid_event_draft'],
    [{ eventType: EventType.Error, body: {}, eventId: 'forged' }, 'invalid_event_draft'],
  ] as const)('rejects invalid draft %#', (input, code) => {
    expect(createCoreEventEnvelope(input, {
      createEventId: () => 'unused', now: () => 1,
    })).toEqual({ ok: false, code });
  });

  it('does not call time after the ID Provider throws', () => {
    let timeCalls = 0;
    expect(createCoreEventEnvelope(
      { eventType: EventType.Error, body: {} },
      {
        createEventId: (): never => { throw new Error('secret'); },
        now: (): number => { timeCalls += 1; return 1; },
      },
    )).toEqual({ ok: false, code: 'event_id_provider_failed' });
    expect(timeCalls).toBe(0);
  });

  it('returns distinct time-provider failure', () => {
    expect(createCoreEventEnvelope(
      { eventType: EventType.Error, body: {} },
      {
        createEventId: () => 'event-0002',
        now: (): never => { throw new Error('private'); },
      },
    )).toEqual({ ok: false, code: 'event_time_provider_failed' });
  });

  it.each([
    ['', 1, 'eventId'],
    ['x'.repeat(129), 1, 'eventId'],
    ['event-0003', 0, 'occurredAt'],
    ['event-0003', Number.NaN, 'occurredAt'],
  ] as const)('returns event-schema issues for invalid generated values', (eventId, time, path) => {
    const result = createCoreEventEnvelope(
      { eventType: EventType.Error, body: {} },
      { createEventId: () => eventId, now: () => time },
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid_event' });
    if (result.ok || result.code !== 'invalid_event') throw new Error('expected invalid_event');
    expect(result.issues.some((issue) => issue.path[0] === path)).toBe(true);
  });

  it('leaves the draft and body byte-for-byte unchanged', () => {
    const input = { eventType: EventType.Error, body: { nested: ['value'] } };
    const before = JSON.stringify(input);
    createCoreEventEnvelope(input, { createEventId: () => 'event-0004', now: () => 2 });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('contains parser-time hostile body access', () => {
    const body = new Proxy({}, { ownKeys: (): never => { throw new Error('body-secret'); } });
    expect(createCoreEventEnvelope(
      { eventType: EventType.Error, body },
      { createEventId: () => 'event-0005', now: () => 3 },
    )).toEqual({ ok: false, code: 'internal_error' });
  });
});
```

- [ ] **Step 2: Run red**

Run `pnpm --filter @aurora/core exec vitest run test/event-creation.test.ts`.

Expected: exit `1` because `event-creation.js` does not exist.

- [ ] **Step 3: Implement the one constructor and final parser call**

Create `packages/core/src/event-creation.ts`:

```ts
import {
  CURRENT_PROTOCOL_VERSION,
  parseEventEnvelope,
  type EventEnvelope,
  type EventSchemaIssue,
} from '@aurora/event-schema';
import { parseCoreEventDraft } from './event-draft.js';
import type { CoreEventProviderSnapshot } from './event-providers.js';

export type CoreEventCreationResult =
  | { readonly ok: true; readonly event: EventEnvelope }
  | { readonly ok: false; readonly code: 'invalid_event_draft' }
  | {
      readonly ok: false;
      readonly code: 'event_id_provider_failed' | 'event_time_provider_failed';
    }
  | {
      readonly ok: false;
      readonly code: 'invalid_event';
      readonly issues: readonly EventSchemaIssue[];
    }
  | { readonly ok: false; readonly code: 'internal_error' };

export function createCoreEventEnvelope(
  input: unknown,
  providers: CoreEventProviderSnapshot,
): CoreEventCreationResult {
  const parsedDraft = parseCoreEventDraft(input);
  if (!parsedDraft.ok) return { ok: false, code: 'invalid_event_draft' };
  let eventId: unknown;
  try { eventId = providers.createEventId(); }
  catch { return { ok: false, code: 'event_id_provider_failed' }; }
  let occurredAt: unknown;
  try { occurredAt = providers.now(); }
  catch { return { ok: false, code: 'event_time_provider_failed' }; }
  try {
    const parsed = parseEventEnvelope({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      eventId,
      eventType: parsedDraft.draft.eventType,
      occurredAt,
      body: parsedDraft.draft.body,
    });
    return parsed.success
      ? { ok: true, event: parsed.data }
      : { ok: false, code: 'invalid_event', issues: parsed.issues };
  } catch {
    return { ok: false, code: 'internal_error' };
  }
}
```

Change `freezeIssues` in `event-entry.ts` to `export function freezeEventIssues(...)` and update its existing call. This is an internal named export only; do not add it to `src/index.ts`.

- [ ] **Step 4: Run green and regression**

Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/event-creation.test.ts test/event-entry.test.ts
pnpm --filter @aurora/event-schema exec vitest run test/event-envelope.test.ts
pnpm --filter @aurora/core typecheck
```

Expected: all exit `0`; construction tests prove exact fields and parser issues, existing full-envelope entry stays green, event-schema envelope tests remain green.

- [ ] **Step 5: Review and record the suggested commit boundary**

Search `packages/core/src/event-creation.ts` for `protocolVersion`; expected one assignment to imported `CURRENT_PROTOCOL_VERSION`. Confirm no local validation for ID length, timestamp range or body boundaries. Suggested commit: `feat(core): create validated event envelopes`.

---

### Task 4: Wire the Standard Draft Submission Boundary

**Files:**
- Modify: `packages/core/src/diagnostics.ts`
- Modify: `packages/core/src/event-entry.ts`
- Modify: `packages/core/src/core.ts`
- Modify: `packages/core/src/plugin-contract.ts`
- Modify: `packages/core/test/event-entry.test.ts`
- Modify: `packages/core/test/plugin-lifecycle.test.ts`
- Modify: `packages/core/test/no-dom-consumer.ts`

**Interfaces:**
- Consumes: Tasks 1—3 contracts, Provider snapshot, constructor, existing `submitCoreEvent`.
- Produces: public synchronous `submitEventDraft`, plugin-context draft semantics, stable result/diagnostic mapping, preserved low-level `submitEvent`.

- [ ] **Step 1: Write failing public and plugin-context tests**

Append to `packages/core/test/event-entry.test.ts`:

```ts
import { EventType } from '@aurora/event-schema';

it('creates and submits a draft while preserving the low-level envelope entry', async () => {
  const core = createCore({
    eventIdProvider: { createEventId: () => 'public-event' },
    eventTimeProvider: { now: () => 1_800_000_000_000 },
  });
  await core.initialize();
  await core.start();
  expect(core.submitEventDraft({ eventType: EventType.Error, body: {} })).toEqual({
    ok: true, code: 'accepted', state: 'started', diagnosticsAdded: 0,
  });
  expect(core.submitEvent(validEventEnvelopeSamples[0])).toMatchObject({ code: 'accepted' });
});

it.each([
  { eventType: EventType.Error },
  { eventType: EventType.Error, body: {}, eventId: 'forged' },
  { eventType: EventType.Error, body: {}, occurredAt: 1 },
  { eventType: EventType.Error, body: {}, protocolVersion: 1 },
])('rejects invalid or system-field draft %#', async (input) => {
  const core = createCore({
    eventIdProvider: { createEventId: () => 'unused' },
    eventTimeProvider: { now: () => 1 },
  });
  await core.initialize(); await core.start();
  expect(core.submitEventDraft(input)).toEqual({
    ok: false, code: 'invalid_event_draft', state: 'started', diagnosticsAdded: 1,
  });
});

it('maps Provider throws without leaking or blocking the next submit', async () => {
  let calls = 0;
  const core = createCore({
    eventIdProvider: {
      createEventId: (): string => {
        calls += 1;
        if (calls === 1) throw new Error('authorization=secret');
        return 'recovered-event';
      },
    },
    eventTimeProvider: { now: () => 1 },
  });
  await core.initialize(); await core.start();
  expect(core.submitEventDraft({ eventType: EventType.Error, body: {} })).toMatchObject({
    ok: false, code: 'event_creation_failed',
  });
  expect(core.submitEventDraft({ eventType: EventType.Error, body: {} })).toMatchObject({
    ok: true, code: 'accepted',
  });
  expect(JSON.stringify(core.getDiagnostics())).not.toContain('secret');
});
```

Replace the final plugin-context test body in `plugin-lifecycle.test.ts` so the saved context submits `{ eventType: EventType.Error, body: {} }`, declares `CoreEventDraftResult`, and asserts a full envelope with `eventId` is `invalid_event_draft`. Keep `Object.keys(context)` equal to `['submitEvent']`.

- [ ] **Step 2: Run red**

Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/event-entry.test.ts test/plugin-lifecycle.test.ts
```

Expected: exit `1`; `submitEventDraft` is absent and plugin context still uses complete-envelope semantics.

- [ ] **Step 3: Add stable diagnostics and draft submission mapping**

Extend `CoreDiagnosticCode` in `diagnostics.ts`:

```ts
  | 'invalid_event_draft'
  | 'event_id_provider_failed'
  | 'event_time_provider_failed'
```

Add to `event-entry.ts`:

```ts
import { createCoreEventEnvelope } from './event-creation.js';
import type { CoreEventProviderSnapshot } from './event-providers.js';

export function submitCoreEventDraft(
  state: CoreLifecycleState,
  input: unknown,
  providers: CoreEventProviderSnapshot,
  diagnostics: DiagnosticStore,
): CoreEventDraftResult {
  const created = createCoreEventEnvelope(input, providers);
  if (created.ok) return submitCoreEvent(state, created.event, diagnostics);
  if (created.code === 'invalid_event') {
    diagnostics.add({ code: 'invalid_event', operation: 'submit_event' });
    return Object.freeze({
      ok: false,
      code: 'invalid_event',
      state: 'started',
      issues: freezeEventIssues(created.issues),
      diagnosticsAdded: 1,
    });
  }
  if (created.code === 'invalid_event_draft') {
    diagnostics.add({ code: 'invalid_event_draft', operation: 'submit_event' });
    return Object.freeze({
      ok: false, code: 'invalid_event_draft', state: 'started', diagnosticsAdded: 1,
    });
  }
  if (created.code === 'event_id_provider_failed' || created.code === 'event_time_provider_failed') {
    diagnostics.add({ code: created.code, operation: 'submit_event' });
    return Object.freeze({
      ok: false, code: 'event_creation_failed', state: 'started', diagnosticsAdded: 1,
    });
  }
  diagnostics.add({ code: 'internal_error', operation: 'submit_event' });
  return Object.freeze({
    ok: false, code: 'internal_error', state: 'started', diagnosticsAdded: 1,
  });
}
```

- [ ] **Step 4: Wire Core and the one-key plugin context**

In `core.ts`, import `submitCoreEventDraft`, `CoreEventDraftResult`, and the Provider types. Add `submitEventDraft(input: unknown): CoreEventDraftResult` to `AuroraCore`. Inside `createCore(providers?)` implement:

```ts
const eventProviders = snapshotEventProviders(providers);

function submitEventDraft(input: unknown): CoreEventDraftResult {
  return submitCoreEventDraft(state, input, eventProviders, diagnostics);
}

const pluginContext: CorePluginContext = Object.freeze({
  submitEvent: (input: unknown): CoreEventDraftResult => submitEventDraft(input),
});
```

Expose `submitEventDraft` on the frozen Core object while retaining `submitEvent`. In `plugin-contract.ts`, replace only the return type:

```ts
import type { CoreEventDraftResult } from './event-entry.js';
export interface CorePluginContext {
  readonly submitEvent: (input: unknown) => CoreEventDraftResult;
}
```

Add `void core.submitEventDraft(draft);` to the no-DOM consumer. Update the public-object key assertion to include `submitEventDraft` and keep every existing key.

- [ ] **Step 5: Run green and task regression**

Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/event-entry.test.ts test/plugin-lifecycle.test.ts test/event-creation.test.ts test/event-providers.test.ts
pnpm --filter @aurora/core test
pnpm --filter @aurora/core typecheck
pnpm check:boundaries
```

Expected: all exit `0`; public draft, legacy envelope and plugin-context tests pass and the existing Core suite remains green. Task 5 deliberately adds the stricter state-priority/Provider-call assertion before that behavior is implemented.

- [ ] **Step 6: Review and record the suggested commit boundary**

Confirm `CorePluginContext` has exactly one key, no plugin can successfully supply system fields, `AuroraCore.submitEvent` signature is unchanged, and accepted still does not imply delivery. Suggested commit: `feat(core): add standard draft submission boundary`.

---

### Task 5: Prove Lifecycle, Failure Isolation, Immutability, and Multi-Instance Safety

**Files:**
- Modify: `packages/core/test/event-entry.test.ts`
- Modify: `packages/core/test/multi-instance.test.ts`
- Modify: `packages/core/test/host-safety.test.ts`
- Modify: `packages/core/test/plugin-lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 4 final public API.
- Produces: black-box evidence for every lifecycle state, repeat/concurrent calls, Provider isolation, immutable input and failure recovery.

- [ ] **Step 1: Write the complete failing lifecycle and isolation matrix**

Add these black-box cases:

```ts
it('never calls Providers outside started and rejects after destroy', async () => {
  let idCalls = 0; let timeCalls = 0;
  const core = createCore({
    eventIdProvider: { createEventId: () => { idCalls += 1; return `event-${idCalls}`; } },
    eventTimeProvider: { now: () => { timeCalls += 1; return timeCalls; } },
  });
  const draft = { eventType: EventType.Error, body: {} };
  expect(core.submitEventDraft(draft).code).toBe('not_started');
  await core.initialize();
  expect(core.submitEventDraft(draft).code).toBe('not_started');
  await core.start();
  expect(core.submitEventDraft(draft).code).toBe('accepted');
  await core.stop();
  expect(core.submitEventDraft(draft).code).toBe('not_started');
  await core.destroy();
  expect(core.submitEventDraft(draft).code).toBe('destroyed');
  expect({ idCalls, timeCalls }).toEqual({ idCalls: 1, timeCalls: 1 });
});

it('treats repeat and concurrent calls as distinct events', async () => {
  let next = 0;
  const core = createCore({
    eventIdProvider: { createEventId: () => `event-${++next}` },
    eventTimeProvider: { now: () => next },
  });
  await core.initialize(); await core.start();
  const draft = { eventType: EventType.Error, body: {} };
  const results = await Promise.all([
    Promise.resolve(core.submitEventDraft(draft)),
    Promise.resolve(core.submitEventDraft(draft)),
    Promise.resolve(core.submitEventDraft(draft)),
  ]);
  expect(results.every(({ code }) => code === 'accepted')).toBe(true);
  expect(next).toBe(3);
});
```

Add to `multi-instance.test.ts`:

```ts
it('isolates different Providers and one Provider failure', async () => {
  const failed = createCore({
    eventIdProvider: { createEventId: (): never => { throw new Error('first-secret'); } },
    eventTimeProvider: { now: () => 1 },
  });
  const healthy = createCore({
    eventIdProvider: { createEventId: () => 'second-event' },
    eventTimeProvider: { now: () => 2 },
  });
  await Promise.all([failed.initialize(), healthy.initialize()]);
  await Promise.all([failed.start(), healthy.start()]);
  const draft = { eventType: EventType.Error, body: {} };
  expect(failed.submitEventDraft(draft).code).toBe('event_creation_failed');
  expect(healthy.submitEventDraft(draft).code).toBe('accepted');
  expect(failed.getDiagnostics()).toHaveLength(1);
  expect(healthy.getDiagnostics()).toEqual([]);
});
```

Add body values `undefined`, a function, `NaN`, cyclic object and forbidden field to public draft tests; each must return `invalid_event` with event-schema issues. Add a frozen/non-frozen nested body test that compares its own keys and JSON before and after submission.

- [ ] **Step 2: Run the expanded tests and observe any missing behavior**

Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/event-entry.test.ts test/multi-instance.test.ts test/host-safety.test.ts test/plugin-lifecycle.test.ts
```

Expected: exit `1`; `never calls Providers outside started and rejects after destroy` observes Provider calls before the existing low-level lifecycle rejection. Other new cases may already pass and remain regression coverage.

- [ ] **Step 3: Apply only minimal corrections within Tasks 1—4 files**

Permitted production edits are `event-draft.ts`, `event-providers.ts`, `event-creation.ts`, `event-entry.ts`, `core.ts`, `plugin-contract.ts`, and `diagnostics.ts`. Corrections must preserve Frozen Public API. A representative correction for hostile Provider output is to leave it as `unknown` until `parseEventEnvelope`; do not coerce it:

```ts
const parsed = parseEventEnvelope({
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId,
  eventType: parsedDraft.draft.eventType,
  occurredAt,
  body: parsedDraft.draft.body,
});
```

Add these exact guards at the start of `submitCoreEventDraft`, before `createCoreEventEnvelope`:

```ts
if (state === 'destroyed') {
  diagnostics.add({ code: 'event_rejected', operation: 'submit_event' });
  return Object.freeze({ ok: false, code: 'destroyed', state, diagnosticsAdded: 1 });
}
if (state !== 'started') {
  diagnostics.add({ code: 'event_rejected', operation: 'submit_event' });
  return Object.freeze({ ok: false, code: 'not_started', state, diagnosticsAdded: 1 });
}
```

- [ ] **Step 4: Run full Core tests and coverage**

Run:

```powershell
pnpm --filter @aurora/core test
pnpm --filter @aurora/core test:coverage
pnpm --filter @aurora/core typecheck
```

Expected: all exit `0`; coverage summary is lines ≥ 85%, branches ≥ 80%, functions ≥ 85%, statements ≥ 85%. If a threshold is short, add a public behavior case for the reported uncovered declared branch; do not lower thresholds or exclude files.

- [ ] **Step 5: Review and record the suggested commit boundary**

Confirm no input mutation, Provider sharing, global mutable state, swallowed diagnostic, rejected Promise or failure lockout. Suggested commit: `test(core): verify event creation isolation and lifecycle`.

---

### Task 6: Enforce Environment, Dependency, and Package Boundaries

**Files:**
- Modify: `tooling/workspace-policy/src/environment.ts`
- Modify: `tooling/workspace-policy/test/environment.test.ts`
- Modify: `packages/core/test/architecture-boundary.test.ts`
- Modify: `packages/core/test/package-entry.test.ts`
- Modify: `packages/core/test/no-dom-consumer.ts`
- Modify: `eslint.config.mjs`

**Interfaces:**
- Consumes: final Core source and existing layer/private-path/cycle checks.
- Produces: automated Node-runtime negatives, no-DOM public compile, root-only built export, no Browser/concrete-plugin dependency and no global counter evidence.

- [ ] **Step 1: Write failing Workspace Policy negatives**

In `environment.test.ts`, add an sdk-core fixture helper if absent and these cases:

```ts
it.each([
  "import { randomUUID } from 'node:crypto'; export const id = randomUUID();",
  "import process from 'node:process'; export const id = process.pid;",
  "export const id = Buffer.from('x').toString();",
  "export const id = process.hrtime.bigint();",
])('rejects sdk-core Node runtime API: %s', async (source) => {
  fixture = await createCoreSource(source);
  const result = await checkWorkspace(fixture.rootDir);
  expect(result.violations).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'forbidden-runtime-global', packageName: '@aurora/core' }),
  ]));
});
```

Add architecture assertions that Core dependencies equal only `@aurora/event-schema`, `exports` has only `.`, and source has no `@aurora/browser`, `@aurora/plugin-*`, `/src/`, `/internal/`, `node:` or module-level ID counter.

- [ ] **Step 2: Run red**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts
pnpm --filter @aurora/core exec vitest run test/architecture-boundary.test.ts
```

Expected: Workspace Policy exits `1` because sdk-core currently bans Browser identifiers but does not reject Node imports/globals. The Core architecture test may already pass and remains a regression gate.

- [ ] **Step 3: Extend the sdk-core runtime scanner without weakening existing rules**

Add a Core-specific set and reuse existing `isNodeRuntimeImport`:

```ts
const forbiddenCoreRuntimeNames: ReadonlySet<string> = new Set([
  'Buffer', 'process', 'require', 'module', '__dirname', '__filename',
]);
```

Inside the `layer === 'sdk-core'` branch, after the existing Browser-name check:

```ts
const isForbiddenCoreRuntime =
  (ts.isIdentifier(node) &&
    forbiddenCoreRuntimeNames.has(node.text) &&
    !ts.isImportSpecifier(node.parent) &&
    !ts.isImportClause(node.parent)) ||
  isNodeRuntimeImport(node);
if (isForbiddenCoreRuntime) {
  violations.push({
    code: 'forbidden-runtime-global',
    packageName: workspacePackage.name,
    file: relative(workspacePackage.directory, file).replaceAll('\\', '/'),
    message: 'sdk-core source must remain independent of Node runtime APIs',
  });
}
```

Preserve protocol, Browser host-mutation, event-control, mutable-module-state, graph, cycle and private-import checks. Add `globalThis.crypto` neither to the Browser-global ban nor the Node ban.

Add `process`, `Buffer`, `require`, `module`, `__dirname`, `__filename` to the Core `no-restricted-globals` ESLint block; Node import rejection remains Workspace Policy's AST responsibility.

- [ ] **Step 4: Lock built root and private paths**

Keep expected runtime root output exactly `createCore`. Add `@aurora/core/event-creation`, `@aurora/core/event-providers`, and `@aurora/core/src/event-creation.js` to private-path rejection cases. Extend no-DOM consumer with the final providers, `createCore(providers)` and `submitEventDraft` calls.

- [ ] **Step 5: Run all boundary gates**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts test/dependency-policy.test.ts test/core-package-contract.test.ts
pnpm --filter @aurora/workspace-policy typecheck
pnpm --filter @aurora/core typecheck
pnpm --filter @aurora/core build
pnpm --filter @aurora/core test:package
pnpm exec eslint tooling/workspace-policy/src tooling/workspace-policy/test packages/core/src packages/core/test packages/core/vitest.config.ts
pnpm check:boundaries
```

Expected: all exit `0`; built runtime root is `createCore`; every private path reports `ERR_PACKAGE_PATH_NOT_EXPORTED`; no-DOM compiler emits no diagnostics; real workspace has no forbidden layer, private import, cycle, Browser/Node runtime or mutable-module-state violation.

- [ ] **Step 6: Review and record the suggested commit boundary**

Inspect built declarations and source imports. Confirm event-schema does not depend on Core, Browser does not depend on Core implementation details, Core does not depend on Browser or plugins, and production imports use only `@aurora/event-schema`. Suggested commit: `test(core): enforce event creation boundaries`.

---

### Task 7: Synchronize Documentation, Coverage, and ADR Evidence

**Files:**
- Modify: `packages/core/README.md`
- Modify: `packages/core/test/documentation-contract.test.ts`
- Modify: `docs/sdk/core-event-creation.md`
- Modify: `docs/sdk/sdk-core-foundation.md`
- Modify: `docs/architecture/sdk-architecture.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/testing/test-strategy.md`
- Modify: `docs/README.md`
- Modify: `README.md`
- Modify: `docs/adr/ADR-003-sdk-plugin-architecture.md`
- Modify: `docs/adr/ADR-005-event-schema-source-of-truth.md`
- Modify: `docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `AGENTS.md`
- Modify: `AURORA_RULES.md`
- Modify: `tooling/workspace-policy/README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 1—6 verified implementation and fresh outputs.
- Produces: executable documentation, truthful implementation inventory, unchanged ADR decisions, exact evidence and root quality gates.

- [ ] **Step 1: Write the failing documentation contract**

Extend `documentation-contract.test.ts`:

```ts
it('documents the standard draft boundary and exact exclusions', async () => {
  const readme = await repositoryFile('packages/core/README.md');
  for (const phrase of [
    'CoreEventDraft', 'CoreEventIdProvider', 'CoreEventTimeProvider',
    'submitEventDraft', 'CURRENT_PROTOCOL_VERSION', 'parseEventEnvelope',
    'event_creation_failed', 'globalThis.crypto.randomUUID',
  ]) expect(readme).toContain(phrase);
  expect(readme).toContain('不表示采样、排队、发送或持久化');
  expect(readme).not.toContain('plugin-error 已实现');
});

it('keeps the specification approved and ADR decisions unchanged', async () => {
  const specification = await repositoryFile('docs/sdk/core-event-creation.md');
  expect(specification).toContain('status: approved');
  expect(specification).toContain('implementation-status: implemented');
  expect(await repositoryFile('docs/adr/ADR-003-sdk-plugin-architecture.md'))
    .toContain('implementation-status: in-progress');
  expect(await repositoryFile('docs/adr/ADR-005-event-schema-source-of-truth.md'))
    .toContain('implementation-status: in-progress');
  expect(await repositoryFile('docs/adr/ADR-006-one-way-dependencies.md'))
    .toContain('implementation-status: in-progress');
});
```

- [ ] **Step 2: Run red**

Run `pnpm --filter @aurora/core exec vitest run test/documentation-contract.test.ts`.

Expected: exit `1` because the README lacks the new API and the approved specification still truthfully says `not-started`.

- [ ] **Step 3: Update module and formal documentation without overstating scope**

Update `packages/core/README.md` with the exact public draft/provider signatures, default ID/time behavior, plugin-context adjustment, legacy `AuroraCore.submitEvent` compatibility, synchronous lifecycle semantics, Provider failure mapping, no-delivery meaning and exclusions. Update the formal/architecture/testing/index/current-state files to say exactly:

```text
`@aurora/core` 的标准事件创建与提交边界第一增量已实现：插件提交 `eventType + body` 草稿，Core 以实例级 Provider 生成 ID 和时间、填入 `CURRENT_PROTOCOL_VERSION`，并通过 `@aurora/event-schema` 根出口最终校验。具体插件、采样、队列、批处理、传输、重试和持久化仍不存在。
```

After every implementation and complete gate succeeds, change only `docs/sdk/core-event-creation.md` metadata to:

```yaml
status: approved
implementation-status: implemented
last-reviewed: 2026-07-31
```

Do not change any ADR decision or implementation status. Append bounded evidence to ADR-003/005/006 with exact scope, public root, evidence paths, actual command results, actual coverage numbers, `Commit: none` and `Issue/PR: none` when still true, and remaining absent capabilities. Update `AGENTS.md` and `AURORA_RULES.md` in the same change because the current implementation inventory and next ordered decision change. Keep each entry within its file-size and append-only rules.

- [ ] **Step 4: Update executable documentation and root command lists**

Add `docs/sdk/core-event-creation.md` and the new plan/source/test files to the existing root `format:check` path list; retain every pre-existing path. Root `lint`, recursive typecheck/test/build, coverage, package entry, Browser Chromium and `check:ci` commands keep their behavior. Update `tooling/workspace-policy/README.md` to state that sdk-core rejects DOM identifiers, Node runtime imports/globals and module-level mutable state.

- [ ] **Step 5: Run focused docs, package, and coverage gates**

Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/documentation-contract.test.ts
pnpm --filter @aurora/core test:coverage
pnpm --filter @aurora/core test:package
pnpm exec prettier --check packages/core/README.md docs/sdk/core-event-creation.md docs/sdk/sdk-core-foundation.md docs/architecture/sdk-architecture.md docs/architecture/formalization-readiness.md docs/testing/test-strategy.md docs/README.md README.md docs/adr/ADR-003-sdk-plugin-architecture.md docs/adr/ADR-005-event-schema-source-of-truth.md docs/adr/ADR-006-one-way-dependencies.md AGENTS.md AURORA_RULES.md tooling/workspace-policy/README.md
```

Expected: all exit `0`; documentation contract passes; Core coverage meets 85/80/85/85; package root stays `createCore`; Prettier reports every named file formatted.

- [ ] **Step 6: Run the complete fresh root quality gate before recording final evidence**

Run separately and read complete output:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm build
pnpm --filter @aurora/event-schema test:package
pnpm --filter @aurora/core test:package
pnpm --filter @aurora/browser test:package
pnpm --filter @aurora/browser test:browser
pnpm check:ci
```

Expected: every command exits `0`; actual test and coverage counts are copied into evidence. If any command fails, leave specification implementation status and current-state evidence at the pre-gate wording until the delivered tree passes; do not weaken rules.

- [ ] **Step 7: Validate the final evidence-bearing tree**

After status/evidence edits, rerun:

```powershell
pnpm --filter @aurora/core exec vitest run test/documentation-contract.test.ts
pnpm check:ci
git diff --check
```

Expected: all exit `0`; the final tree, rather than an earlier intermediate tree, is verified.

- [ ] **Step 8: Perform the final scope and Git audit**

Run read-only searches with PowerShell `Select-String` when `rg` is unavailable:

```powershell
Get-ChildItem packages/core/src -Filter *.ts | Select-String -Pattern '@aurora/browser|@aurora/plugin|node:|Math\.random|window|document|navigator|fetch|XMLHttpRequest|localStorage|sessionStorage'
Get-ChildItem packages/core/src -Filter *.ts | Select-String -Pattern 'queue|batch|transport|retry|backoff|storage|endpoint|projectId|session|source.?map'
Get-ChildItem packages/core/src -Filter *.ts | Select-String -Pattern '@aurora/.+/(src|internal)/'
git diff -- docs/sdk/core-event-creation.md docs/superpowers/plans/2026-07-31-core-event-creation.md packages/core tooling/workspace-policy package.json README.md docs AGENTS.md AURORA_RULES.md
git status --short --branch --untracked-files=all
git diff --cached --stat
```

Expected: the first three searches have no forbidden match; `globalThis.crypto` is the sole approved runtime capability and does not match the forbidden list. Diff contains only this increment plus preserved pre-existing work; staging remains consistent with user authorization. No plugin, queue, sender, server, CI, release, container, IaC or cloud artifact exists.

- [ ] **Step 9: Record the suggested documentation boundary**

Suggested commit: `docs(core): record event creation evidence`. Execute no Git staging, commit or push without separate user authorization.

---

## Requirement-to-Task Traceability

| Requirement | Implementation Task | Verification |
|---|---|---|
| 最小草稿与系统字段不可覆盖 | 1、3、4 | 草稿 hostile/extra-field 与公开入口测试 |
| ID/时间 Provider 与默认能力 | 2 | 默认、注入、receiver、缺失与抛错测试 |
| 当前协议版本与最终解析 | 3 | 精确字段、非法值、event-schema 回归 |
| 插件统一入口与旧入口兼容 | 4 | Core/插件黑盒与对象键测试 |
| 同步、生命周期、重复与并发 | 4、5 | 全状态与三并发提交测试 |
| 输入不可变、失败恢复和脱敏诊断 | 3—5 | JSON/own-key 对比、恢复、诊断序列化 |
| 多实例 Provider 隔离 | 5 | 一实例失败、另一实例成功 |
| 无 DOM/Browser/Node/循环/私有路径 | 6 | TypeScript、ESLint、Workspace Policy、包入口 |
| 85/80/85/85 | 5、7 | Core coverage 与根质量门禁 |
| 文档、ADR 与当前状态证据 | 7 | 文档契约、完整门禁后状态同步 |
| plugin-error 消费边界和排除范围 | 7 | README/规格契约与最终搜索 |

## Final Acceptance Checklist

- [ ] `plugin-error` 已具备可消费的 Core 草稿入口，但本计划没有创建该包或转换逻辑。
- [ ] `CURRENT_PROTOCOL_VERSION`、`EventType`、`EventEnvelope` 和解析器只来自 `@aurora/event-schema` 根出口。
- [ ] Core 生产代码无 DOM 类型、Browser 依赖、Node 专属模块或全局可变 ID 状态。
- [ ] 插件不能成功提交 ID、时间、协议版本或额外字段。
- [ ] 默认/确定性 Provider、非法值、抛错、失败恢复和多实例隔离全部有公开行为证据。
- [ ] 草稿和正文没有被修改或保留。
- [ ] 旧 `AuroraCore.submitEvent(input: unknown): CoreEventResult` 保持兼容。
- [ ] `CorePluginContext` 只有一个冻结的 `submitEvent` 键且使用草稿语义。
- [ ] 包只有 `.` 根出口，运行时值只有 `createCore`，私有路径被拒绝。
- [ ] TypeScript strict、ESLint、Workspace Policy、Core tests/coverage/build/package 和根完整质量门禁全部通过。
- [ ] Core 覆盖率至少为 lines 85%、branches 80%、functions 85%、statements 85%。
- [ ] 没有 `any`、宽泛对象类型、无说明断言、占位语句或重复协议校验。
- [ ] 没有具体插件、队列、批处理、传输、重试、持久化、Session、服务端或基础设施实现。
- [ ] ADR-003/005/006 与 ADR-007 状态保持原值；只记录真实、有限证据。
- [ ] 用户已有修改完整保留；未获授权时没有 stage、commit、push、PR、merge、release 或 deployment。
