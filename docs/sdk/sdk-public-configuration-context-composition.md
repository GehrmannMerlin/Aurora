---
title: SDK 公共配置、上下文与完整 composition（SDK-10 第一增量）
status: approved
owner: sdk
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: 新包 @aurora/sdk 的公共配置模型与控制面工厂；@aurora/browser 的浏览器 composition 入口
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora ADR 规范.md'
  - ../architecture/sdk-architecture.md
  - ../architecture/aurora-v1-remaining-module-batches.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../protocol/event-schema-foundation.md
  - sdk-core-foundation.md
  - core-event-creation.md
  - ../protocol/request-event-contract.md
  - sdk-sampling-policy.md
  - unified-privacy-filtering-and-beforesend.md
  - request-allowlist-path-normalization-classification.md
  - safe-activity-trail-and-bounded-buffer.md
supersedes: none
review-cycle: sdk-public-api-or-lifecycle-change
---

# SDK 公共配置、上下文与完整 composition（SDK-10 第一增量）

## 1. 定位与批准来源

本文把 G05 叶子 SDK-10「SDK 公共配置、上下文和完整 composition」正式化为第一增量。该增量在 approved [sdk-core-foundation.md](sdk-core-foundation.md) 的最小 Core 之上，建立环境无关的公共配置模型、控制面工厂和浏览器 composition 入口。配置语义以 approved PRD §5.2 为准；默认值与隐私边界以 PRD §5.1.3、§15.2 与各协议契约为准。

批准来源：G05_APPROVAL_PACKAGE 缺口 2，用户 2026-08-10 批准全部推荐方案。批准范围仅限 SDK-10 增量。

## 2. 方案与包边界

### 2.1 采用方案

- 新增私有包 **`@aurora/sdk`**（`aurora.layer: sdk-core`，唯一运行时依赖 `@aurora/event-schema`），承载环境无关的公共配置模型与 `createSdkControlPlane` 控制面工厂；
- 在 **`@aurora/browser`**（`aurora.layer: sdk-browser`）新增浏览器 composition 入口 `createAuroraSdk`，把 Core、控制面、注入插件与浏览器环境组装为完整 SDK 句柄；
- 控制面在插件与 Core 事件入口之间拦截，实现统一处理顺序（隐私过滤 → beforeSend → 采样 → 请求分类 → 提交 Core）。

### 2.2 不采用的方案

- 不扩展 `@aurora/core` 的配置模型（core 的 approved 规格明确排除项目配置、采样率等字段）；
- 不创建新的依赖层；`@aurora/sdk` 属 `sdk-core`，`@aurora/browser` 属 `sdk-browser`（→ `sdk-core | protocol`），现有层矩阵无需修改；
- 不把插件静态依赖进 `@aurora/sdk`（composition 以参数注入插件实例，保持包边界与按需组合）。

## 3. 模块职责与非职责

### 3.1 `@aurora/sdk` 职责

- 定义 SDK 公共配置输入、规范化快照、完整默认值表和校验规则；
- 定义 `createSdkControlPlane(config, options)` 工厂，返回控制面实例（统一处理管道、配置读取、轨迹读写、销毁）；
- 定义 `SdkEventDraft`（`{ eventType, body }`）与处理结果类型；
- 定义 `SdkPluginContext` 控制上下文类型（提交、读配置、记录轨迹）。

### 3.2 `@aurora/browser` composition 职责

- `createAuroraSdk(input)`：解析配置 → 创建浏览器环境（或接受注入）→ 创建 Core → 创建控制面 → 用控制面上下文包装注入插件 → 注册到 Core → 返回 SDK 句柄；
- 句柄暴露生命周期（start/stop/destroy）、配置快照、控制面与轨迹读取；
- 插件以参数注入（`CorePlugin` 实例），composition 不静态依赖任何插件包。

### 3.3 明确非职责

- 不实现队列、批处理、去重、传输、重试、持久化（G06）；
- 不实现 Vue/React 适配（G07）；
- 不实现用户上下文、自定义指纹的 wire 行为（`customFingerprint` 归 DAT-12，`customUserId` 归用户上下文模块，本增量只把 `clientKey/environment/release` 作为标识配置校验并保存）；
- 不实现 `safeQueryParamNames` 保留（wire 请求契约已移除全部查询参数，该特性需要协议变更，deferred）；
- 不改变 Core 的公共 API 或 approved 规格。

## 4. 公共 TypeScript 契约（`@aurora/sdk`）

### 4.1 配置输入与快照

```ts
export interface SdkSampleRatesInput {
  readonly errors?: number;
  readonly slowRequests?: number;
  readonly performance?: number;
}

export interface SdkRequestPathRuleInput {
  readonly pattern: string;
  readonly name: string;
}

export interface SdkConfigInput {
  readonly clientKey?: unknown;                 // 必填：非空字符串，长度 1..256
  readonly environment?: unknown;               // 可选：非空字符串，长度 1..128
  readonly release?: unknown;                   // 可选：非空字符串，长度 1..128
  readonly sampleRates?: unknown;               // SdkSampleRatesInput 或可解析普通对象
  readonly slowRequestThreshold?: unknown;      // 可选：正整数，默认 3000
  readonly allowedRequestOrigins?: unknown;     // 可选：完整来源或受限通配符数组
  readonly requestPathRules?: unknown;          // 可选：SdkRequestPathRuleInput[]
  readonly extraErrorStatusCodes?: unknown;     // 可选：100..599 整数数组
  readonly ignoredRequestUrls?: unknown;        // 可选：URL 子串/来源数组
  readonly excludeSameOriginRequests?: unknown; // 可选：boolean，默认 false
  readonly interactionTrailEnabled?: unknown;   // 可选：boolean，默认 true
  readonly maxActivityTrailEntries?: unknown;   // 可选：1..1000 整数，默认 30
  readonly beforeSend?: unknown;                // 可选：见统一隐私过滤与 beforeSend 规格
}

export interface SdkSampleRatesSnapshot {
  readonly errors: number;
  readonly slowRequests: number;
  readonly performance: number;
}

export interface SdkConfigSnapshot {
  readonly clientKey: string;
  readonly environment: string | null;
  readonly release: string | null;
  readonly sampleRates: SdkSampleRatesSnapshot;
  readonly slowRequestThreshold: number;
  readonly allowedRequestOrigins: readonly string[];
  readonly requestPathRules: readonly { readonly pattern: string; readonly name: string }[];
  readonly extraErrorStatusCodes: readonly number[];
  readonly ignoredRequestUrls: readonly string[];
  readonly excludeSameOriginRequests: boolean;
  readonly interactionTrailEnabled: boolean;
  readonly maxActivityTrailEntries: number;
  readonly beforeSend: SdkBeforeSend | null;
}
```

快照为冻结对象，任何字段不可变。输入对象不被保留；成功时生成新的冻结快照。

### 4.2 配置解析与安全回退

```ts
export type SdkConfigFix = { readonly field: string; readonly reason: string };

export interface SdkConfigParseFailure {
  readonly ok: false;
  readonly issues: readonly SdkConfigFix[];   // 不可修复的配置错误（如 clientKey 缺失/非法）
}

export interface SdkConfigParseSuccess {
  readonly ok: true;
  readonly config: SdkConfigSnapshot;
  readonly fixes: readonly SdkConfigFix[];    // 非法/缺失字段回退安全默认值的记录
}

export type SdkConfigParseResult = SdkConfigParseFailure | SdkConfigParseSuccess;

export function parseSdkConfig(input: unknown): SdkConfigParseResult;
```

- 校验规则：
  - `clientKey` 必填：缺失、非字符串、空串、超长（>256）→ 整体 `{ ok:false }`；
  - `environment`/`release`：提供但非法（非字符串/空/超长）→ 丢弃并用 `null` + 记录 fix；
  - `sampleRates`：每个值必须为 0..1 的有限数字，非法单项回退默认（errors=1、slowRequests=0.2、performance=0.1）；
  - `slowRequestThreshold`：非正整数 → 回退 3000；
  - `allowedRequestOrigins`：非法条目（非 http(s) 来源、含路径、不允许的通配符）→ 丢弃该条目 + fix；全部非法 → 空数组；
  - `requestPathRules`：`pattern` 非字符串/`name` 非法 → 丢弃该条 + fix；
  - `extraErrorStatusCodes`：非 100..599 整数 → 丢弃 + fix；
  - `excludeSameOriginRequests`/`interactionTrailEnabled`：非法 → 回退 false/true；
  - `maxActivityTrailEntries`：非 1..1000 整数 → 回退 30；
  - `beforeSend`：非法（非函数或对象形状）→ 回退 null；
- `parseSdkConfig` 不抛出；任何输入都以稳定结果返回。

### 4.3 事件草稿与处理结果

```ts
export interface SdkEventDraft {
  readonly eventType: EventType;
  readonly body: unknown;
}

export interface SdkProcessedEvent {
  readonly ok: true;
  readonly event: SdkEventDraft;              // 可能已被请求分类改写（路径归一化 URL）
  readonly sampledOut: boolean;               // true 表示通过但被采样丢弃（不提交）
}

export type SdkDropCode =
  | 'invalid_draft'
  | 'dropped_by_before_send'
  | 'disallowed_request'
  | 'sampled_out';

export interface SdkDroppedEvent {
  readonly ok: false;
  readonly code: SdkDropCode;
}

export type SdkProcessEventResult = SdkProcessedEvent | SdkDroppedEvent;
```

### 4.4 控制面工厂与插件上下文

```ts
export interface SdkControlPlaneOptions {
  readonly pageOrigin?: string;                // 当前页面 origin（如 https://shop.example.com），用于同源判断
}

export interface SdkSubmitDraft {
  (draft: SdkEventDraft): SdkSubmitResult;
}

export interface SdkSubmitResult {
  readonly ok: boolean;
  readonly code: string;
  readonly state?: string;
  readonly diagnosticsAdded?: number;
}

export interface SdkControlPlane {
  readonly getConfig: () => SdkConfigSnapshot;
  readonly processEvent: (draft: SdkEventDraft) => SdkProcessEventResult;
  readonly submit: (draft: SdkEventDraft, submitToCore: SdkSubmitDraft) => SdkSubmitResult;
  readonly recordActivity: (entry: SafeActivityEntry) => SdkRecordActivityResult;
  readonly getActivityTrail: () => readonly SafeActivityEntry[];
  readonly destroy: () => void;
}

export function createSdkControlPlane(
  config: SdkConfigSnapshot,
  options?: SdkControlPlaneOptions,
): SdkControlPlane;
```

`SdkPluginContext`（composition 提供给注入插件的控制上下文）：

```ts
export interface SdkPluginContext {
  readonly submitEvent: (draft: SdkEventDraft) => SdkSubmitResult;
  readonly getConfig: () => SdkConfigSnapshot;
  readonly recordActivity: (entry: SafeActivityEntry) => SdkRecordActivityResult;
}
```

`processEvent` 处理顺序（与 PRD §5.1.14 一致）：

```text
捕获草稿 → 统一隐私过滤 → beforeSend → 采样判定 → 请求分类（仅 request）→ 轨迹记录
```

采样判定使用 `@aurora/sdk` 的采样策略（见 [sdk-sampling-policy.md](sdk-sampling-policy.md)），请求分类使用请求 allowlist/路径归一化策略（见 [request-allowlist-path-normalization-classification.md](request-allowlist-path-normalization-classification.md)），隐私过滤与 beforeSend 见 [unified-privacy-filtering-and-beforesend.md](unified-privacy-filtering-and-beforesend.md)，轨迹见 [safe-activity-trail-and-bounded-buffer.md](safe-activity-trail-and-bounded-buffer.md)。

## 5. composition（`@aurora/browser`）

```ts
export interface CreateAuroraSdkInput {
  readonly config: unknown;                    // SdkConfigInput
  readonly environment?: BrowserEnvironment;   // 默认 createBrowserEnvironment()
  readonly plugins?: readonly CorePlugin[];    // 注入插件实例（可为空）
  readonly pageOrigin?: string;                // 可选覆盖同源判断基准
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

export function createAuroraSdk(input: CreateAuroraSdkInput): AuroraSdkHandle;
```

- `createAuroraSdk` 解析配置（`parseSdkConfig`）；解析失败则按 PRD §5.2 使用安全默认快照并保留 fixes（绝不抛错、绝不影响宿主页面启动）；
- 创建 Core（`createCore()`），创建控制面（`createSdkControlPlane(config, { pageOrigin })`）；
- 对每个注入插件，注册一个**包装插件**：其 `initialize(context)` 把控制上下文 `{ submitEvent: (draft) => control.submit(draft, core.submitEventDraft), getConfig, recordActivity }` 交给真实插件，start/stop/destroy 原样转发；
- 返回句柄；`start()` 依次执行 `core.initialize()`、`core.start()`；`stop()`/`destroy()` 委托 Core（控制面轨迹随之清理）；
- 不注册任何插件时，句柄仍可用（配置/控制面/轨迹能力独立存在）。

## 6. 测试与门禁

### 6.1 `@aurora/sdk`（单元，Node 无 DOM）

- 配置：默认值表、合法输入、每类非法输入回退 + fixes、`clientKey` 缺失/非法 → 整体失败、快照冻结、输入不被保留；
- 控制面：处理顺序、beforeSend 丢弃/异常隔离、采样丢弃、请求分类/路径归一化、轨迹记录/上限/读取、多实例隔离、`destroy` 清理；
- 包入口：根出口只导出批准符号；`src`/`internal` 私有路径拒绝；
- 无 DOM 编译：`tsconfig.no-dom.json` 消费者成功编译；
- 覆盖率：行 ≥85%、分支 ≥80%、函数 ≥85%、语句 ≥85%。

### 6.2 `@aurora/browser` composition

- 单元：`createAuroraSdk` 解析/包装/注册/句柄生命周期、非法配置安全回退、空插件、控制上下文注入；
- 不修改既有 Browser 源/生命周期测试行为（全量回归由包既有门禁承担）；
- composition 不引入 Chromium 新测试（纯组装逻辑，Node 可测；浏览器真实行为由既有 `test:browser` 门禁覆盖）。

## 7. 文档与 ADR 同步

- `packages/sdk/README.md`、`packages/browser/README.md`：记录公共入口、配置表、默认值、职责/非职责；
- `docs/README.md`：索引本规格与新增包；
- `docs/architecture/sdk-architecture.md`：区分已实现控制面与仍不存在的队列/传输/框架适配；
- ADR-003：追加 SDK-10 第一增量实施证据，实施状态保持 `in-progress`；
- `AGENTS.md`/`AURORA_RULES.md`：同步 G05 状态与决策队列（SDK-10 关闭后计数）。

## 8. 相邻边界

- 不触碰 `@aurora/core` 公共 API；
- 采样、隐私、请求分类、轨迹分别以各自 approved 规格为准；
- G06（队列/传输）与 G07（框架适配）不提前实现。
