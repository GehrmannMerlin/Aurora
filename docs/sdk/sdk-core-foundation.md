---
title: Aurora SDK Core 生命周期与插件编排基础第一增量
status: approved
owner: sdk
created: 2026-07-30
last-reviewed: 2026-07-30
applies-to: packages/core 的包边界、生命周期、最小配置、插件编排、事件入口、多实例隔离与内部诊断
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../architecture/system-overview.md
  - ../architecture/sdk-architecture.md
  - ../architecture/monorepo-and-build.md
  - ../architecture/formalization-readiness.md
  - ../protocol/event-schema-foundation.md
  - ../protocol/event-envelope-v1.md
  - ../testing/test-strategy.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../adr/ADR-007-workspace-package-and-task-tooling.md
supersedes: none
review-cycle: sdk-public-api-or-lifecycle-change
---

# Aurora SDK Core 生命周期与插件编排基础第一增量

## 1. 定位、效力与实施状态

本文冻结 `packages/core` 首个可独立实现、测试和评审的增量。该增量建立环境无关的 SDK Core、实例生命周期、最小安全配置、插件生命周期编排、标准事件入口、多实例隔离和受控诊断；它不建立 Browser 层、采集、队列、采样、传输或持久化能力。

本文没有新增产品能力。其范围和行为由 approved PRD、approved 长期规范、approved SDK 架构文档，以及 accepted ADR-003、ADR-005、ADR-006、ADR-007 无歧义推导；用户已授权在这些边界内冻结最小、保守、类型安全的普通接口细节，因此本文状态为 `approved`。该状态允许生成实施计划，不表示 `packages/core` 已存在或 ADR-003 已进入实施状态。

截至本文日期，实施状态为 `not-started`。编写本文和实施计划不得修改任何 ADR 的实施状态。

## 2. 方案边界

### 2.1 采用方案

采用“无全局状态的 Core 工厂 + 显式生命周期状态机 + 最小插件钩子 + 同步标准事件入口”方案：

- 每次 `createCore()` 创建独立状态、配置快照、插件注册表和诊断缓冲；
- 生命周期写操作在单实例内按调用顺序串行化；
- 插件按注册顺序初始化和启动，按逆序停止和销毁；
- 插件异常被隔离、记录并使该插件进入隔离状态，其他插件继续；
- 标准事件入口只做生命周期门禁和 `@aurora/event-schema` 公共解析，不存储、不转发事件；
- Core 源码在没有 DOM 类型库和浏览器全局对象的 TypeScript 环境中编译。

### 2.2 不采用的方案

- 不采用类级或模块级可变单例，因为它会破坏多实例隔离；
- 不采用通用事件总线，因为当前没有已批准的 Core 内部广播需求；
- 不采用空队列、空发送器、空存储器或可插拔传输抽象，因为这些属于后续模块；
- 不把 Browser 能力抽象成 Core 的可选依赖，因为 Core 的环境无关边界必须由依赖关系和编译配置证明；
- 不让插件获得 Core 实例或私有状态，只给出冻结的最小事件提交能力；
- 不引入配置端点、项目标识、网络参数、采样率、重试或批次字段，因为这些字段尚不属于本增量。

## 3. 模块职责与明确非职责

### 3.1 职责

- 建立私有 Workspace 包 `@aurora/core`、唯一根公开入口和模块 README；
- 定义 SDK Core 的公开类型、工厂函数和稳定结果联合；
- 实现 `created`、`initialized`、`started`、`stopped`、`destroyed` 生命周期；
- 实现最小配置解析、冻结快照和有限更新规则；
- 实现插件注册、初始化、启动、停止、销毁、顺序和异常隔离；
- 提供标准事件进入 Core 的唯一公开入口，并复用 `@aurora/event-schema` 根公开出口；
- 用每实例有界诊断记录表达受控失败，且不记录敏感内容；
- 保证多个 Core 实例的配置、插件、事件和诊断互不污染；
- 用单元测试、包入口测试、无 DOM 编译、ESLint 和 Workspace policy 自动验证架构边界；
- 同步 SDK 架构、正式化追踪、ADR 实施证据和入口状态文档。

### 3.2 明确非职责

- Browser 环境探测、浏览器对象访问或 Browser 包；
- 错误、请求、性能、资源等具体采集插件；
- React、Vue 或其他框架适配；
- 采样算法、事件队列、批量发送、网络传输、重试、退避或熔断；
- 浏览器持久化、离线恢复、跨标签页协调或 Service Worker；
- 具体事件正文、协议版本扩展、批次或接收协议；
- 数据接入、处理、存储、服务端、管理平台或公共 API；
- CI、发布、容器、IaC、云资源或 npm 发布；
- 通用日志器、事件总线、依赖注入容器、`utils`、`helpers`、`common` 或 `misc` 杂物模块；
- 为尚未批准的能力建立扩展点。

## 4. Consumes 与 Produces

### 4.1 Consumes

- 已实施的 pnpm Workspace、严格 TypeScript、ESLint、Prettier、Vitest 和 `@aurora/workspace-policy`；
- `@aurora/event-schema` 根公开出口的 `EventEnvelope`、`EventSchemaIssue` 和 `parseEventEnvelope(input: unknown)`；
- accepted ADR-003 的 Core/Browser/插件分层、生命周期与插件隔离原则；
- accepted ADR-005 的协议单一来源和运行时校验原则；
- accepted ADR-006 的单向依赖、无私有深导入和自动约束原则；
- accepted ADR-007 的 Workspace 和任务命令约束。

### 4.2 Produces

- 私有包 `@aurora/core` 和唯一根公开入口；
- 环境无关的 Core 实例工厂及公开类型；
- 可判别、非抛出的生命周期、配置、插件注册和事件提交结果；
- 每实例有界、无敏感内容的诊断快照；
- Core 层依赖、无 DOM、禁用浏览器全局、无模块级可变状态的自动化证据；
- ADR-003/005/006 的第一增量实施证据。只有实际代码和完整门禁通过后才能写入这些证据。

## 5. 包、依赖与环境边界

### 5.1 包形态与公开出口

包名固定为 `@aurora/core`，版本保持私有 Workspace 初始值 `0.0.0`，使用 ESM，并声明 `sideEffects: false`。包只允许根公开出口：

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

`src/index.ts` 是唯一公开源码出口。不得导出内部状态容器、插件注册表、诊断存储或配置解析函数；不得提供 `./internal`、`./src/*` 或其他子路径出口。

### 5.2 允许依赖

Core 的唯一运行时 Workspace 依赖是：

```json
{
  "@aurora/event-schema": "workspace:*"
}
```

Core 只从 `@aurora/event-schema` 根入口导入协议类型和解析函数。测试与构建可以使用根 Workspace 已批准的 TypeScript、Vitest、覆盖率、ESLint、Prettier 和 Node 类型依赖。

### 5.3 禁止依赖

- Browser、插件、框架适配、接入、处理、平台、服务端或工具层业务包；
- `@aurora/event-schema/src/*`、`@aurora/event-schema/internal/*` 或任意跨包私有路径；
- DOM 类型库、浏览器 polyfill、网络、存储、队列或日志运行时依赖；
- 形成 Core → Browser、Core → 具体插件、Core → 框架或任何循环依赖的边。

Workspace policy 必须把 `sdk-core` 固定为只能依赖 `protocol` 层，并提供允许和拒绝的临时负例夹具。

### 5.4 浏览器与全局状态禁区

Core 源码不得引用：

- `window`、`document`、`navigator`、`location`；
- `fetch`、`XMLHttpRequest`；
- `localStorage`、`sessionStorage` 或 `Storage`；
- `Window`、`Document`、`Navigator`、`Location`、`HTMLElement`、`Element`、`Node`、`EventTarget` 或 DOM `Event` 类型。

Core 的 TypeScript 配置必须只使用 ECMAScript 库，不加载 DOM 库；独立 `tsconfig.no-dom.json` 必须从包根公开入口消费 API 并成功编译。

Core 源码不得声明模块顶层 `let`、`var` 或模块顶层可变容器实例。只允许模块顶层不可变常量、类型声明和纯函数。每个 `createCore()` 调用拥有自己的所有可变状态。

## 6. 公开 TypeScript 契约

以下签名是本增量的完整公共 API。所有公共函数显式声明参数和返回类型；所有调用方输入首先视为 `unknown`。

### 6.1 生命周期与配置

```ts
export type CoreLifecycleState = 'created' | 'initialized' | 'started' | 'stopped' | 'destroyed';

export interface CoreConfigInput {
  readonly maxDiagnosticEntries?: number;
}

export interface CoreConfigSnapshot {
  readonly maxDiagnosticEntries: number;
}

export type CoreLifecycleSuccessCode =
  | 'initialized'
  | 'already_initialized'
  | 'started'
  | 'already_started'
  | 'stopped'
  | 'already_stopped'
  | 'destroyed'
  | 'already_destroyed';

export type CoreLifecycleFailureCode =
  | 'invalid_configuration'
  | 'configuration_locked'
  | 'not_initialized'
  | 'destroyed'
  | 'internal_error';

export interface CoreLifecycleSuccess {
  readonly ok: true;
  readonly code: CoreLifecycleSuccessCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export interface CoreLifecycleFailure {
  readonly ok: false;
  readonly code: CoreLifecycleFailureCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export type CoreLifecycleResult = CoreLifecycleSuccess | CoreLifecycleFailure;

export type CoreConfigUpdateFailureCode =
  'invalid_configuration' | 'configuration_locked' | 'not_initialized' | 'destroyed';

export interface CoreConfigUpdateSuccess {
  readonly ok: true;
  readonly code: 'configuration_updated';
  readonly state: 'initialized' | 'stopped';
  readonly config: CoreConfigSnapshot;
  readonly diagnosticsAdded: 0;
}

export interface CoreConfigUpdateFailure {
  readonly ok: false;
  readonly code: CoreConfigUpdateFailureCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export type CoreConfigUpdateResult = CoreConfigUpdateSuccess | CoreConfigUpdateFailure;
```

### 6.2 插件契约与注册结果

```ts
export interface CorePluginContext {
  readonly submitEvent: (input: unknown) => CoreEventResult;
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
```

插件名称必须是 1—64 个字符的 kebab-case 字符串，匹配 `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`。Core 在注册时验证名称和四个钩子，并捕获调用所需的方法引用；调用方在注册后替换对象属性不得改变已注册行为。每个 Core 实例应注册独立插件实例；如果调用方主动把同一个有状态插件对象注册到多个 Core，调用方拥有的对象状态不属于 Core 的隔离保证。

### 6.3 事件结果

```ts
export interface CoreEventAccepted {
  readonly ok: true;
  readonly code: 'accepted';
  readonly state: 'started';
  readonly diagnosticsAdded: 0;
}

export interface CoreInvalidEvent {
  readonly ok: false;
  readonly code: 'invalid_event';
  readonly state: 'started';
  readonly issues: readonly EventSchemaIssue[];
  readonly diagnosticsAdded: 1;
}

export interface CoreInactiveEvent {
  readonly ok: false;
  readonly code: 'not_started';
  readonly state: 'created' | 'initialized' | 'stopped';
  readonly diagnosticsAdded: 1;
}

export interface CoreDestroyedEvent {
  readonly ok: false;
  readonly code: 'destroyed';
  readonly state: 'destroyed';
  readonly diagnosticsAdded: 1;
}

export interface CoreEventInternalFailure {
  readonly ok: false;
  readonly code: 'internal_error';
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: 1;
}

export type CoreEventResult =
  | CoreEventAccepted
  | CoreInvalidEvent
  | CoreInactiveEvent
  | CoreDestroyedEvent
  | CoreEventInternalFailure;
```

`EventSchemaIssue` 必须从 `@aurora/event-schema` 根公开出口导入并从 `@aurora/core` 根入口重新导出为事件结果的一部分；Core 不复制该类型，不解释或扩展具体事件正文。

### 6.4 诊断契约

```ts
export type CoreDiagnosticCode =
  | 'invalid_configuration'
  | 'configuration_locked'
  | 'invalid_lifecycle_call'
  | 'invalid_plugin'
  | 'duplicate_plugin'
  | 'plugin_initialize_failed'
  | 'plugin_start_failed'
  | 'plugin_stop_failed'
  | 'plugin_destroy_failed'
  | 'invalid_event'
  | 'event_rejected'
  | 'internal_error';

export type CoreDiagnosticOperation =
  | 'initialize'
  | 'update_config'
  | 'register_plugin'
  | 'start'
  | 'stop'
  | 'destroy'
  | 'submit_event';

export interface CoreDiagnostic {
  readonly sequence: number;
  readonly code: CoreDiagnosticCode;
  readonly operation: CoreDiagnosticOperation;
  readonly pluginName?: string;
}
```

诊断不得包含时间戳、异常对象、异常消息、堆栈、配置值、事件字段、事件正文、凭据、URL、IP 或用户内容。`sequence` 从每个实例的 `1` 独立递增；达到容量时只保留最新记录。`getDiagnostics()` 返回冻结的新数组和冻结的条目，调用方不能修改内部记录。

### 6.5 Core 实例

```ts
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

export function createCore(): AuroraCore;
```

`createCore()` 为同步工厂。生命周期方法为异步，因为插件钩子允许返回 Promise；同一实例的生命周期调用按调用顺序串行化。注册、配置更新、事件提交和只读查询保持同步，不建立任务队列或事件队列。

## 7. 配置模型

### 7.1 默认值与合法输入

本增量没有必填配置。唯一配置是诊断容量：

```ts
const defaultCoreConfig: CoreConfigSnapshot = Object.freeze({
  maxDiagnosticEntries: 100,
});
```

`maxDiagnosticEntries` 必须是 `1` 到 `1000` 的安全整数。省略配置或传入空普通对象使用默认值。存在未知自有属性、符号属性、访问时抛错的属性、数组、函数、`null` 或其他非普通对象均返回 `invalid_configuration`。输入对象不被保留；成功时生成冻结的新快照。

### 7.2 初始化与重复调用

- 首次 `initialize()` 或 `initialize({})` 成功后状态为 `initialized`；
- 首次非法配置返回 `invalid_configuration`，状态保持 `created`，调用方可重新提交合法配置；
- 已初始化后调用无参数 `initialize()` 返回 `already_initialized`；
- 已初始化后传入与现有规范化快照相同的配置返回 `already_initialized`；
- 已初始化后传入不同的合法配置返回 `configuration_locked`；
- 已销毁后调用返回 `destroyed`；
- 重复成功和相同配置不增加诊断；非法配置或锁定冲突增加受控诊断。

### 7.3 配置更新

`updateConfig(input)` 只允许在 `initialized` 和 `stopped` 状态更新 `maxDiagnosticEntries`：

- 输入必须是只包含 `maxDiagnosticEntries` 的非空普通对象；
- `created` 返回 `not_initialized`；
- `started` 返回 `configuration_locked`；
- `destroyed` 返回 `destroyed`；
- 非法输入返回 `invalid_configuration`；
- 失败不修改当前快照；成功返回新的冻结快照；
- 容量减小时立即移除最旧诊断，只保留最新 N 条；
- 调用方随后修改原输入对象不得影响 Core。

## 8. 生命周期状态机

```text
created --initialize(success)--> initialized --start--> started
                                            ^           |
                                            |           v
                                            +--start-- stopped

created | initialized | started | stopped --destroy--> destroyed
```

### 8.1 `initialize`

- 只允许首次从 `created` 进入 `initialized`；
- 在调用插件初始化钩子前先提交状态，以便插件重入时观察到稳定状态；
- 按注册顺序初始化插件；某插件同步抛错或异步拒绝时记录诊断、隔离该插件并继续其他插件；
- 插件失败不会使 Core 初始化回滚，结果仍为 `initialized`，`diagnosticsAdded` 表示本次新增诊断数；
- 同一插件的初始化钩子最多执行一次。

### 8.2 `start`

- `created` 返回 `not_initialized`；
- `initialized` 或 `stopped` 先进入 `started`，再按注册顺序启动已成功初始化且未隔离的插件；
- 某插件启动失败时记录诊断、隔离该插件并继续；Core 保持 `started`；
- `started` 重复调用返回 `already_started`，不重复启动插件；
- `destroyed` 返回 `destroyed`；
- 从 `stopped` 再启动时只启动仍未隔离的插件。

### 8.3 `stop`

- `started` 先进入 `stopped`，再按本轮成功启动顺序的逆序停止插件；
- 某插件停止失败时记录诊断、隔离该插件并继续；Core 保持 `stopped`；
- `initialized` 或 `stopped` 返回 `already_stopped`，不调用插件；`initialized` 保持原状态；
- `created` 返回 `not_initialized`；
- `destroyed` 返回 `destroyed`。

### 8.4 `destroy`

- 从 `started` 销毁时，先转为 `stopped` 并按逆启动顺序停止已启动插件；
- 随后进入 `destroyed`，按逆注册顺序对所有已注册插件执行一次销毁钩子，包括未初始化、初始化失败、启动失败或停止失败的插件；
- 每个销毁失败形成诊断，其他插件继续；
- 从 `created`、`initialized` 或 `stopped` 销毁时不补做初始化或启动；
- 重复销毁返回 `already_destroyed`，不重复调用任何插件；
- 销毁完成后，注册、初始化、启动、配置更新和事件提交均被拒绝。

### 8.5 并发与重入

每个实例维护独立的生命周期 Promise 尾链。并发调用 `initialize()`、`start()`、`stop()` 或 `destroy()` 时按调用顺序执行并返回各自结果，禁止同一钩子并发或重复执行。该尾链只串行化生命周期控制操作，不承载事件，不暴露给插件。

## 9. 插件编排与异常隔离

### 9.1 注册规则

- 只允许在 `created` 状态注册；
- 相同规范名称在同一实例中只能注册一次；
- 输入必须在运行时验证为具有合法 `name` 和四个可调用钩子的对象；
- 注册成功后保存冻结的内部钩子记录，不把 Core 私有状态交给插件；
- 初始化开始后返回 `registration_closed`；销毁后返回 `destroyed`；
- 非法或重复注册不抛出，返回失败结果并形成诊断；
- 不支持注销、替换、优先级或依赖排序，因为当前没有批准依据。

### 9.2 插件上下文

Core 为每个插件提供冻结的 `CorePluginContext`，且只有：

```ts
Object.freeze({
  submitEvent: (input: unknown): CoreEventResult => core.submitEvent(input),
});
```

上下文不包含 Core 实例、配置、插件注册表、诊断写入口、生命周期控制或其他插件。插件事件只能通过该公开事件入口进入 Core。

### 9.3 隔离规则

- 插件 `initialize`、`start`、`stop` 的同步异常和 Promise 拒绝均不得冒泡给宿主；
- 失败插件被永久隔离，不再执行初始化、启动或停止钩子，但仍执行一次 `destroy`；
- 一个插件失败不改变其他插件的执行顺序或资格；
- `destroy` 失败不阻止其他插件销毁；
- 不记录异常消息或堆栈，只记录稳定诊断码、操作和合法插件名；
- Core 自身仍以生命周期成功结果表达已完成的状态转换，并通过 `diagnosticsAdded` 与诊断快照暴露局部插件失败。

## 10. 标准事件入口

`submitEvent(input: unknown)` 是本增量唯一事件入口：

- 仅 `started` 状态接受输入；其他活动前状态返回 `not_started`，销毁后返回 `destroyed`；
- 在生命周期门禁通过后调用 `parseEventEnvelope(input)`；
- 合法信封返回 `accepted`；这只表示 Core 已启动且信封通过当前公共协议校验；
- 非法或不支持的信封返回 `invalid_event`，原样携带冻结的 `EventSchemaIssue` 结果，并记录不含事件内容的诊断；
- 若恶意输入访问器等导致协议解析器意外抛出，Core 返回 `internal_error` 并记录稳定诊断；
- Core 不修改输入或解析后的 `EventEnvelope`，不保存、复制到实例外、广播、采样、排队、批处理、发送或持久化事件；
- 本增量没有事件消费者回调，因此多实例不会混用事件。

## 11. 诊断与宿主安全

- 所有调用方输入错误、非法生命周期调用和插件异常通过明确结果和诊断表达；
- 预期的幂等重复调用不记为错误诊断；
- 诊断容量默认 100，上限 1000，避免无界资源增长；
- 诊断写入失败或恶意输入导致的意外错误不得使宿主崩溃；公开边界返回 `internal_error`；
- Core 不调用 `console`、全局日志器或网络，不把错误发送到宿主环境；
- 插件失败不会阻断其他插件或另一个 Core 实例；
- Core 不捕获宿主未交给它的错误，也不改变宿主全局异常处理；
- Core 不以静默忽略代替结果：每个被拒绝的公开操作都有稳定失败码，插件局部失败由成功生命周期结果的 `diagnosticsAdded` 和诊断记录共同表达。

## 12. 多实例隔离

每次 `createCore()` 必须独立拥有：

- 生命周期状态和生命周期尾链；
- 配置快照；
- 插件注册记录、插件资格和启动顺序；
- 诊断序列和有界存储；
- 插件上下文及其事件入口绑定。

测试必须证明两个实例的配置、插件钩子、失败、诊断和事件结果互不污染。Core 不创建全局注册表、默认实例、静态实例缓存或模块级可变计数器。

## 13. 代码与文件约束

计划中的最终源码树固定为：

```text
packages/core/
├── README.md
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.no-dom.json
├── vitest.config.ts
├── src/
│   ├── configuration.ts
│   ├── core.ts
│   ├── diagnostics.ts
│   ├── event-entry.ts
│   ├── index.ts
│   ├── lifecycle.ts
│   ├── plugin-contract.ts
│   └── plugin-registry.ts
└── test/
    ├── configuration.test.ts
    ├── documentation-contract.test.ts
    ├── event-entry.test.ts
    ├── host-safety.test.ts
    ├── lifecycle.test.ts
    ├── multi-instance.test.ts
    ├── no-dom-consumer.ts
    ├── package-entry.test.ts
    ├── plugin-lifecycle.test.ts
    └── plugin-registration.test.ts
```

所有文件使用 kebab-case；类型和接口使用 PascalCase；函数和变量使用 camelCase；布尔变量使用 `is`、`has`、`can` 或 `should` 前缀。不得使用未说明的 `any`、`Function`、`Object`、`Record<string, any>`、非空断言或宽泛断言。必要的窄化辅助函数必须位于其负责的领域文件，不能建立杂物目录。

TypeScript 保持 `strict`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 和显式公共返回类型。外部值保持 `unknown` 直到运行时验证完成。类型断言只允许在 TypeScript 无法表达但已被相邻运行时检查证明的局部位置，并必须有解释性注释；本增量不需要非空断言。

## 14. 自动架构约束

实施计划必须建立以下可执行证据：

1. `tsc -p packages/core/tsconfig.no-dom.json --noEmit` 在不含 DOM 库的消费者夹具上通过；
2. ESLint 对 Core 源码禁止浏览器全局标识符；
3. Workspace policy 允许 `sdk-core → protocol`，拒绝 `sdk-core → browser/plugin/framework/tooling`；
4. Workspace policy 继续拒绝跨包 `src`、`internal` 和其他私有子路径；
5. Workspace policy 的循环依赖检查覆盖新增 Core 包；
6. Workspace policy 对 Core 源码拒绝模块顶层 `let`、`var` 和模块顶层可变容器；
7. 包入口测试只从 `@aurora/core` 根入口加载公开 API，并证明私有路径不可达；
8. 多实例行为测试证明状态不依赖全局可变单例。

## 15. 测试与覆盖率

### 15.1 必测行为

测试必须通过根公开 API 断言对外行为，而不是只断言内部函数被调用：

- 生命周期：创建、首次/重复初始化、非法初始化、初始化后状态、首次/重复启动、首次/重复停止、首次/重复销毁、销毁后所有非法调用、并发生命周期顺序、停止和销毁的资源释放顺序；
- 配置：默认值、输入合并、非法值、未知字段、必填字段为空集合、可选字段、输入和输出不可反向修改、更新允许/禁止状态、容量收缩；
- 插件：合法/非法/重复注册、注册顺序、注册关闭、初始化/启动顺序、停止/销毁逆序、各阶段单插件失败、失败隔离、其他插件继续、上下文最小化、已注册方法快照、销毁后不可启动；
- 事件：合法 `EventEnvelope`、非法与不支持输入、非启动状态、销毁状态、插件上下文入口、输入不被修改、无事件存储或广播、多实例不混用；
- 宿主安全：同步抛错、异步拒绝、恶意 Proxy 输入不冒泡，诊断不泄露异常消息或事件内容；
- 环境与实例：无 DOM 编译、无浏览器全局、两个实例的配置/插件/失败/诊断隔离、无全局遗留状态；
- 包与文档：根入口可导入、私有子路径不可导入、README 示例通过类型检查和行为测试。

### 15.2 覆盖率门禁

`packages/core/vitest.config.ts` 必须固定以下阈值：

```ts
thresholds: {
  lines: 85,
  branches: 80,
  functions: 85,
  statements: 85,
}
```

根 `test:coverage` 和 `check:ci` 必须包含 Core 覆盖率。覆盖率不得通过排除关键源码、空断言或只测内部实现获得。

### 15.3 本增量不适用的验证

- 不运行真实浏览器、Playwright 或 DOM 测试，因为本模块明确禁止 Browser 能力；无 DOM 编译和禁用浏览器全局是对应门禁；
- 不运行网络、队列、重试、持久化或端到端接入测试，因为不存在这些接口或实现；
- 不声明压缩包体积或运行时性能结果，因为当前批准的 Workspace 只产出 TypeScript 库构建目录，没有已批准的 SDK 打包器或基准方法；相关预算不得用不可比数据伪装为已验证。

## 16. 文档与 ADR 同步

实际实施且完整质量门禁通过后，必须在同一变更中：

- 新增 `packages/core/README.md`，记录职责、公开 API、状态机、插件顺序、事件 `accepted` 的有限含义、诊断隐私和排除范围；
- 更新 `docs/README.md`、根 `README.md`、`docs/architecture/sdk-architecture.md` 和 `docs/architecture/formalization-readiness.md`，区分已实现 Core 基础与仍不存在的 Browser、采集、队列、采样和传输；
- 更新 ADR-003 的实施状态为 `in-progress` 并追加 Core 第一增量证据，不得标为 `implemented`；
- 为 ADR-005 追加 Core 只消费 `@aurora/event-schema` 根公开出口的真实消费者证据，保持 `in-progress`；
- 为 ADR-006 追加 `sdk-core → protocol`、无私有深导入、无 DOM 和无模块级可变状态证据，保持 `in-progress`；
- 保持 ADR-007 为 `implemented`，除非真实实施发现其既有事实错误；
- 同步 `docs/adr/README.md`、`AGENTS.md` 和 `AURORA_RULES.md` 的当前状态与决策队列。

仅编写本文或实施计划时不得执行上述状态变化。

## 17. 后续模块衔接边界

- Browser 层只能依赖 Core 根公开契约，把环境能力以具体 Browser 实现提供；Core 不为其预留 DOM 或网络接口；
- 具体插件只能实现 `CorePlugin` 并通过 `CorePluginContext.submitEvent` 提交公共协议输入；插件不得访问 Core 私有状态或建立独立上报通道；
- 未来采样、队列和传输必须在各自 approved 规格及必要 ADR 门禁满足后接到新的明确接口；本增量的 `accepted` 结果不承诺事件被保留或发送；
- 未来若需要事件消费者或处理管线，必须以新规格评估背压、资源上限、顺序、失败、隐私和生命周期，不得把当前同步入口解释为隐含事件总线；
- 具体事件正文仍由 `@aurora/event-schema` 的独立 approved 规格定义，Core 不拥有协议字段。

## 18. 验收条件

本增量只有在计划中的全部 Task、文档同步和完整质量门禁通过后才可声明完成：

- 包根 API 与第 6 节完全一致；
- 生命周期、配置、插件、事件、诊断和多实例测试覆盖第 15 节场景；
- Core 覆盖率达到行 85%、分支 80%、函数 85%、语句 85%；
- 无 DOM 编译、ESLint、Workspace 边界、私有入口、循环依赖和模块级可变状态负例均通过；
- 根格式、Lint、类型检查、单元测试、覆盖率、边界检查、构建、包入口和 `check:ci` 全部通过；
- 文档和 ADR 只记录实际存在且有新鲜验证支持的证据；
- 没有 Browser、具体插件、框架、采样、队列、传输、持久化、服务端、CI、发布或基础设施实现。
