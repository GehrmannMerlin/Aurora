---
title: Core 标准事件创建与提交边界第一增量
status: approved
implementation-status: implemented
owner: sdk
created: 2026-07-31
last-reviewed: 2026-07-31
applies-to:
  - packages/core
  - packages/event-schema
  - CorePluginContext
---

# Core 标准事件创建与提交边界第一增量

## 1. 状态、范围与权威来源

本文冻结 `@aurora/core` 的标准事件草稿、运行时 ID/时间 Provider、`EventEnvelope` 创建和插件提交边界。本文是已批准业务规则、已接受 ADR 与已实现公共接口的无歧义派生，因此状态为 `approved`；实施已完成，实施状态为 `implemented`。

权威来源：

- 核心业务 PRD 6.1：事件唯一 ID 由客户端生成，同一事件的传输重试复用原 ID；
- `docs/protocol/event-schema-foundation.md` 与 `docs/protocol/error-event-contract.md`：`event-schema` 是协议类型、版本、边界和运行时解析的唯一来源；
- `docs/sdk/sdk-core-foundation.md`：Core 是环境无关的生命周期、插件编排和统一事件入口；
- `docs/sdk/browser-environment-foundation.md` 与 `docs/sdk/browser-error-source.md`：Browser 只提供环境事实和错误源事实；
- ADR-003、ADR-005、ADR-006、ADR-007 的 accepted 决策及当前真实包根出口。

ADR-003、ADR-005、ADR-006 保持 `accepted / in-progress`，ADR-007 保持 `accepted / implemented`。本增量不需要新 ADR。

## 2. 当前问题与增量选择

当前 `CorePluginContext` 只有 `submitEvent(input: unknown): CoreEventResult`，其真实实现把输入直接交给 `parseEventEnvelope`。Core 没有事件草稿、事件 ID Provider、时间 Provider或标准信封创建能力。`event-schema` 已定义并校验 `EventEnvelope`，但按协议职责不能生成运行时 ID 或时间；Browser 已提供错误事实，却不能创建协议事件。

如果具体插件分别生成 `eventId`、`occurredAt` 和 `protocolVersion`，会形成重复实现、系统字段可伪造和多套版本语义。因此本轮选择 Core 前置增量，不选择 `packages/plugin-error`。

## 3. 职责与非职责

本增量负责：

- 接收只含 `eventType` 与 `body` 的最小事件草稿；
- 在每个 Core 实例内调用独立 ID Provider 和时间 Provider；
- 从 `@aurora/event-schema` 根出口读取 `CURRENT_PROTOCOL_VERSION`；
- 创建新的 `EventEnvelope` 候选并调用根出口 `parseEventEnvelope(input: unknown)`；
- 把通过校验的信封交给现有 `submitCoreEvent` 路径；
- 同步返回稳定、冻结且有界的提交结果；
- 对草稿、Provider、校验和意外失败写入脱敏诊断；
- 保持输入草稿及其 `body` 不变；
- 提供确定性 Provider 注入和多实例隔离。

本增量不负责插件实现、错误事实转换、采样、去重、队列、批处理、网络传输、重试、退避、持久化、用户上下文、Session、endpoint、projectId、密钥、Source Map、服务端、数据库、管理平台、CI、发布、容器、IaC 或云资源，也不建立通用事件总线。

## 4. 分层责任边界

| 层             | 负责                                                              | 不负责                                        |
| -------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| `event-schema` | 协议版本、`EventType`、`EventEnvelope`、运行时解析与 issue        | 运行时 ID、时间、Core 生命周期、Browser 事实  |
| Core           | Provider 所有权、系统字段生成、信封创建、最终解析、统一提交、诊断 | DOM、Browser 原生事件、具体事件正文转换、传输 |
| 插件           | 依据自身已批准规则创建 `eventType + body` 草稿并读取提交结果      | ID、时间、协议版本、第二套信封、独立上报通道  |
| Browser        | 提供只读、脱敏的环境和错误源事实                                  | 协议事件、Core 私有状态、信封创建             |

依赖方向保持 `plugin -> Core -> event-schema`，Browser 由具体浏览器插件作为公开事实来源消费；Core 不依赖 Browser 或具体插件，`event-schema` 不依赖 Core。

## 5. 冻结公共 TypeScript 契约

所有下列符号从 `@aurora/core` 包根导出。`EventType` 和 `EventSchemaIssue` 分别从 `@aurora/event-schema` 根出口导入或由 Core 根出口按既有方式重导出；Core 不复制二者定义。

```ts
import type { EventSchemaIssue, EventType } from '@aurora/event-schema';
import type { CoreLifecycleState } from './lifecycle.js';

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
  CoreEventResult | CoreInvalidEventDraft | CoreEventCreationFailure;

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

`CoreEventAccepted`、`CoreInactiveEvent`、`CoreDestroyedEvent`、`CoreEventInternalFailure`、`CoreInvalidEvent`、`CoreEventResult` 和其他现有类型保持原定义。草稿入口直接复用既有 `invalid_event` 结构；实现共享冻结 issue 的内部函数，不能复制 `event-schema` 的解析规则。

## 6. 最小事件草稿

运行时入口接收 `unknown`，仅以下普通对象有效：

```ts
interface CoreEventDraft {
  readonly eventType: EventType;
  readonly body: unknown;
}
```

精确规则：

- 必须是原型为 `Object.prototype` 或 `null` 的普通对象；
- 必须恰好拥有 `eventType` 和 `body` 两个自有键；
- Symbol 键、访问器抛错、缺字段和任何额外字段均返回 `invalid_event_draft`；
- `eventType` 必须通过 `@aurora/event-schema` 根出口的 `isEventType`；
- `body` 必须存在，其内容由最终 `parseEventEnvelope` 校验；
- `eventId`、`occurredAt`、`protocolVersion` 或任何同义系统字段都是额外字段，不能覆盖 Core 值；
- Core 不冻结、不克隆、不修改调用方的草稿或正文，只创建新的候选信封对象。

## 7. Provider 与默认运行时能力

Provider 是同步接口。每次草稿提交最多调用每个 Provider 一次；Provider 抛错不能冒泡。Core 在 `createCore` 时安全读取并快照 Provider 方法，同时只在该实例闭包内保留各方法的原 receiver；调用方随后替换方法不能改变该实例行为。Provider 不写入配置快照，也不共享到其他实例。

默认时间 Provider 在调用时使用 ECMAScript `Date.now()`，不在模块导入时读取环境。

默认 ID Provider 在调用时安全读取 `globalThis.crypto.randomUUID`，以原始 `crypto` 对象作为 receiver 调用。它不声明 DOM 类型、不导入 Node 模块、不在模块导入时读取全局，也不提供 `Math.random`、时间拼接或全局计数器降级。若能力缺失、属性访问抛错、调用抛错或返回值不是字符串，提交返回 `event_creation_failed` 并记录 `event_id_provider_failed`。最终 ID 仍必须通过 `parseEventEnvelope` 校验。

注入 Provider 用于确定性测试和受控运行时适配：

```ts
const core = createCore({
  eventIdProvider: { createEventId: (): string => 'event-0001' },
  eventTimeProvider: { now: (): number => 1_800_000_000_000 },
});
```

一个实例的 Provider、失败、调用次数和结果不能影响其他实例。Provider 返回 Promise 等非法值时不等待；它作为非法生成值进入稳定失败路径。

## 8. EventEnvelope 构造入口

内部标准构造入口固定为：

```ts
interface CoreEventProviderSnapshot {
  readonly createEventId: () => unknown;
  readonly now: () => unknown;
}

type CoreEventCreationResult =
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

function createCoreEventEnvelope(
  input: unknown,
  providers: CoreEventProviderSnapshot,
): CoreEventCreationResult;
```

成功候选必须按以下唯一映射建立：

```ts
const candidate = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId: providers.createEventId(),
  eventType: draft.eventType,
  occurredAt: providers.now(),
  body: draft.body,
};
```

随后只调用 `parseEventEnvelope(candidate)`。成功时使用 `parsed.data` 作为交给现有提交路径的信封；不得自行断言 candidate 为 `EventEnvelope`，不得复制协议版本或字段校验。

## 9. 创建与提交语义

`AuroraCore.submitEventDraft(input)` 与插件上下文的 `submitEvent(input)` 均为同步方法。只有 `started` 状态才读取草稿和调用 Provider；`created`、`initialized`、`stopped` 返回 `not_started`，`destroyed` 返回 `destroyed`，且这些状态不调用 Provider。

在 `started` 状态下，顺序固定为：精确解析草稿 → 调用 ID Provider → 调用时间 Provider → 使用当前协议版本创建候选 → `parseEventEnvelope` → 把 `parsed.data` 交给现有 `submitCoreEvent`。成功仍只表示 Core 已启动、事件已创建并通过统一入口校验，不表示采样、保留、排队、发送或持久化。

每次公开调用表示一次新事件创建，因此重复或并发调用各自调用 Provider 并产生各自结果。未来传输重试必须复用第一次创建的信封及 ID，但重试不属于本增量。

一次失败不能锁死入口或阻止下一次提交。方法不返回 Promise，不等待异步 Provider，不串行化到生命周期 Promise 尾部；JavaScript 调用次序决定 Provider 调用次序。

## 10. 与现有 `submitEvent(input: unknown)` 的关系

`AuroraCore.submitEvent(input: unknown): CoreEventResult` 保持名称、签名和完整信封校验行为，作为既有低层公开入口兼容保留。它仍只在 `started` 状态调用 `parseEventEnvelope`，不生成或覆盖系统字段。

`CorePluginContext` 的唯一键仍是 `submitEvent`，但其输入语义从完整信封收紧为最小草稿，返回类型调整为 `CoreEventDraftResult`。这是一项经本文批准的插件上下文兼容调整：仓库当前没有具体插件，若保留插件可提交完整信封的旧语义，将直接违反系统字段归 Core 所有的边界。`AuroraCore.submitEvent` 的现有调用方与测试保持兼容；现有 Core 基础测试插件改为提交草稿。

`submitEventDraft` 是 Core 实例上新增的公开入口，便于宿主适配器使用同一创建边界和进行黑盒测试。插件只能得到上下文的一个 `submitEvent` 键，不能得到低层完整信封入口。

## 11. 错误、结果与诊断

公开结果必须冻结，不携带异常对象、异常文本、堆栈、草稿、正文、URL、凭据、配置值或 Provider 返回值。诊断继续受现有每实例容量限制。

新增诊断代码：

```ts
type CoreDiagnosticCode =
  | ExistingCoreDiagnosticCode
  | 'invalid_event_draft'
  | 'event_id_provider_failed'
  | 'event_time_provider_failed';
```

不新增诊断 operation；全部归入既有 `submit_event`。映射固定如下：

| 条件                            | 公开结果                         | 诊断                         |
| ------------------------------- | -------------------------------- | ---------------------------- |
| 非 started / destroyed          | 既有 `not_started` / `destroyed` | 既有 `event_rejected`        |
| 草稿形状或 eventType 非法       | `invalid_event_draft`            | `invalid_event_draft`        |
| ID Provider 能力缺失或抛错      | `event_creation_failed`          | `event_id_provider_failed`   |
| 时间 Provider 抛错              | `event_creation_failed`          | `event_time_provider_failed` |
| Provider 值或正文使最终信封非法 | `invalid_event` + 冻结 issues    | `invalid_event`              |
| 未分类内部异常                  | `internal_error`                 | `internal_error`             |
| 成功                            | `accepted`                       | 不新增诊断                   |

Provider 的非法返回值不得被替换、纠正或静默降级，非法事件不得进入现有提交路径。

## 12. 输入不可变、多实例与生命周期

- 不向草稿或 `body` 写属性，不删除字段，不排序调用方数组，不深冻结调用方值；
- 候选信封和解析成功值只在同步调用栈内存在，Core 不保留它们；
- 每个 `createCore()` 调用拥有自己的 Provider snapshot、生命周期、插件、诊断和序号；
- Provider 不是模块级变量，不允许模块级 ID 计数器、缓存或可变容器；
- Core 未初始化、已初始化、已停止和已销毁时均不调用 Provider；
- 插件初始化期间调用上下文入口得到 `not_started`；启动后可提交；停止或销毁后拒绝；
- 一个提交失败不隔离插件本身；只有既有插件生命周期 hook 抛错才按既有规则隔离插件。

## 13. 环境、依赖与包出口

Core 构建继续使用 `ES2024` 且 `types: []` 的无 DOM 配置。生产源不得引用 DOM 类型或 Browser 包，不得导入 `node:` 模块、Node 全局或具体插件。默认 Provider 只使用 ECMAScript 能力与经 `Reflect` 安全访问的标准全局加密能力，且访问发生在提交时。

生产代码只从 `@aurora/event-schema` 根出口导入 `CURRENT_PROTOCOL_VERSION`、`isEventType`、`parseEventEnvelope` 及公共类型。禁止 `@aurora/event-schema/src/*`、`internal/*` 和未导出子路径。

包仍只有 `.` 一个运行时根出口。新增运行时值只有既有 `createCore`；草稿、Provider 与结果均为类型导出，不增加第二个运行时包入口。构建后的私有路径继续返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

## 14. 测试与覆盖率

Core 覆盖率保持 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%。测试必须覆盖公开行为，并可用内部构造单元测试补充精确字段映射，但不能只断言内部函数调用。

必测范围：

- 默认时间、确定性时间、默认 ID、确定性 ID、Provider 非法值、Provider 抛错；
- 两实例不同 Provider，以及一实例失败不影响另一实例；
- 合法草稿、非法 eventType、缺 body、body 非 JSON、额外系统字段、hostile Proxy；
- 正确版本、ID、时间、eventType、body 与最终 parser 成功/失败；
- 输入和正文不变；
- created、initialized、started、stopped、destroyed、销毁后、重复、并发和失败后恢复；
- 插件上下文只有一个提交键，不能接受完整信封覆盖系统字段，能读取明确结果；
- 无 DOM 编译、无 Browser/Core 反向依赖、无 Node 专属运行时、无循环、无私有跨包路径；
- 包根出口、私有路径拒绝、构建声明和文档示例。

自动门禁使用 TypeScript、ESLint、Workspace Policy、Vitest、覆盖率、包入口测试、环境负例、私有路径负例和多实例测试。本增量不需要真实浏览器测试；Browser 错误源的现有 Chromium 门禁只作为上游事实，不在本轮规划阶段重跑。

## 15. 代码与文件规范

实施必须使用 TypeScript strict；外部运行时输入保持 `unknown`；不得使用无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言或非空断言。公共函数显式标注参数和返回值。文件名使用 `kebab-case`，类型使用 `PascalCase`，函数和变量使用 `camelCase`，布尔值使用 `is`、`has`、`can`、`should` 前缀。

每个文件保持单一职责；不创建 `utils`、`helpers`、`common` 或 `misc`。错误不得静默吞掉，不使用 `console`，不复制 event-schema 校验逻辑，不建立队列、传输或通用事件总线。DOM 事件命名规则不适用于本增量，因为 Core 不声明 DOM 事件或监听器；Node 服务端结构规则不适用，因为本增量不是服务端模块。

## 16. 文档同步与实施证据

实施通过完整质量门禁后，同步：

- `packages/core/README.md` 的草稿、Provider、兼容与提交语义；
- `docs/sdk/sdk-core-foundation.md` 的已实施边界引用；
- `docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md`、`docs/testing/test-strategy.md`；
- `docs/README.md`、根 `README.md`、`AGENTS.md`、`AURORA_RULES.md`；
- ADR-003/005/006 的真实、有限实施证据。

只有实施和完整新鲜验证完成后，本文 `implementation-status` 才能改为 `implemented`。ADR 决策状态不变，也不得把整个 SDK、插件体系、队列或传输描述为已实现。

## 17. `plugin-error` 消费方式

`packages/plugin-error` 在其独立 approved 规格和计划下实现时：

1. 从 `@aurora/browser` 根出口订阅 `BrowserErrorSourceEvent`；
2. 依据 `docs/protocol/error-event-contract.md` 创建错误事件正文；
3. 仅调用 `CorePluginContext.submitEvent({ eventType: EventType.Error, body })`；
4. 不生成或缓存协议版本、事件 ID、时间戳或完整 `EventEnvelope`；
5. 不调用 `AuroraCore.submitEvent`，不建立独立队列或上报通道。

本节只冻结消费边界，不授权创建 `packages/plugin-error`。

## 18. 排除范围确认

本规格没有引入第二套协议版本、第二套 `EventEnvelope`、Browser 到 Core 的反向依赖、Node 专属运行时模块、全局 ID 状态、产品配置项或高迁移成本基础设施选择。未列入第 3 节职责的能力全部保持不存在且未获本增量实施授权。
