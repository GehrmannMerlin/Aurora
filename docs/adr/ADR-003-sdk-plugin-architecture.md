---
title: ADR-003：采用 SDK 分层插件架构
status: accepted
implementation-status: in-progress
owner: sdk
date: 2026-07-27
last-reviewed: 2026-07-30
applies-to: Aurora SDK Core、Browser、采集插件和框架适配
related:
  - ../../AURORA_RULES.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - ../architecture/sdk-architecture.md
  - ../testing/test-strategy.md
supersedes: none
superseded-by: none
---

# ADR-003：采用 SDK 分层插件架构

## 元数据

- 状态：accepted
- 日期：2026-07-27
- Owner：sdk
- 适用范围：Aurora SDK Core、Browser、采集插件、React/Vue 等框架适配
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联技术方案：[Aurora 架构规范](<../../Aurora 架构规范.md>)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none
- 实施状态：in-progress
- 评审状态：非作者及所需领域评审已通过

## 背景

Aurora SDK 需要同时支持生命周期、配置、队列、上报、浏览器 API、错误、请求、性能、行为和框架错误。若全部放入单体 SDK，浏览器细节会扩散到 Core，插件故障难以隔离，接入方也难以控制能力和包体积。

## 决策驱动因素

- SDK 不能破坏宿主页面；
- Core 应可在无 DOM 环境测试；
- 采集能力需要独立启停和释放；
- React、Vue 等框架适配不应复制通用能力；
- 所有事件必须进入统一隐私、采样和上报管道；
- 需要支持多实例隔离和可控包体积。

## 候选方案

### 方案 A：Core、Browser、插件、框架适配分层

Core 管理生命周期和事件管道；Browser 封装环境能力；插件捕获特定数据；框架包提供接入适配。

优点：

- Core 环境无关、易测试；
- 插件可以独立启停和隔离失败；
- 浏览器代理集中管理并可恢复；
- 框架适配保持轻量；
- 统一管道保证隐私、采样和上报一致；
- 能按需组合能力。

缺点：

- 需要稳定插件接口和环境抽象；
- 包之间的版本和公开 API 需要治理；
- 过度拆包可能增加构建复杂度；
- 插件生命周期错误会产生隐蔽问题。

### 方案 B：单体浏览器 SDK

所有采集、浏览器代理、队列和框架能力在一个包内直接实现。

优点：

- 初期文件和构建简单；
- 内部调用直接；
- 不需要设计插件接口。

缺点：

- Core 与 window、document 和原生 API 强耦合；
- 单个采集能力容易影响整个 SDK；
- 不易按需启用和控制包体积；
- 框架代码和通用能力容易重复；
- 测试和资源释放边界不清楚。

### 方案 C：插件通过全局事件和单例协作

每个插件独立包，通过全局单例、事件总线或全局队列通信。

优点：

- 插件表面上相互独立；
- 可以动态注册；
- 实现初期无需严格接口。

缺点：

- 多实例隔离困难；
- 全局状态污染宿主；
- 事件顺序、错误和生命周期难以推理；
- 插件可能绕过统一管道；
- 销毁和恢复行为不可靠。

## 最终决策

决定选择方案 A：Core、Browser、采集插件和框架适配分层。

分层目标是保护宿主、统一事件处理和保持职责独立，不是为了每个文件创建独立包。本决策不定义尚不存在的插件签名、包清单或默认启用策略。

## 结果与影响

### 正面影响

- Core 可以在 Node 或无 DOM 环境测试；
- 插件失败和资源可以隔离；
- 原生 API 代理集中、可恢复；
- 统一队列、重试、隐私和采样；
- 框架接入可复用通用监控能力。

### 负面影响与代价

- 插件 API 需要长期兼容；
- Browser 抽象可能遗漏环境差异；
- 包数量和构建需要控制；
- 生命周期和依赖检查必须自动化。

### 未解决问题

- 插件接口具体签名；
- 包体积预算和 tree-shaking 验证；
- 浏览器版本矩阵；
- 插件配置和默认启用策略的最终 API。

## 实施约束

- Core 不包含 DOM 类型或直接浏览器访问；
- Browser 能力通过接口注入；
- 插件只监听、捕获、转换和释放；
- 插件不得直接发送、维护独立队列或访问 Core 私有状态；
- 插件不得依赖其他插件内部实现；
- 框架适配不得复制 Core 或 Browser；
- 所有事件进入统一事件管道；
- start、stop、destroy 和重复初始化必须定义并测试；
- 共享原生代理必须在最后一个使用者释放后恢复；引用计数是可选实现，不是本 ADR 强制的唯一机制；
- 多实例不得共享不可控可变状态。

## 迁移方案

ADR accepted 后先定义最小公开接口和生命周期契约，再实现 Core 和 Browser 测试替身，随后逐个增加采集插件和框架适配。每个包同时建立 README、公开入口和测试。

## 回滚方案

在公共 API 发布前，可撤回提案并合并包，但仍必须保持宿主安全、统一管道和可测试环境抽象。公共 API 发布后改变分层需要新 ADR 和迁移版本。

## 验证方式

- Core 编译配置不包含 DOM 类型；
- 静态规则禁止 Core 使用浏览器全局；
- 插件异常不影响宿主和其他插件；
- 重复初始化不重复监听；
- destroy 后监听、代理和定时器清零；
- 插件事件全部经过脱敏、采样和队列；
- 多实例测试证明隔离；
- 包入口不导出内部状态。

## 重新评估条件

- 分层导致不可接受的包体积或性能；
- 插件接口无法表达关键浏览器能力；
- 新运行环境不适合 Browser 抽象；
- 框架适配持续复制通用逻辑；
- 多实例或生命周期出现长期稳定性问题。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-07-29：正式化复审输入

- 状态保持 `proposed / not-started`；当前没有 SDK 包、公共接口或真实浏览器测试可作为实施证据；
- 背景输入补充：[SDK 架构](../architecture/sdk-architecture.md)正式承载 Core、Browser Environment、采集插件和框架适配的职责、统一事件管道、宿主安全与生命周期要求，[测试策略](../testing/test-strategy.md)提供浏览器、框架、包体积和宿主安全的设计级验证输入；
- 候选方案复审：方案 A 继续作为提案；方案 B 无法维持 Core 的环境无关性，方案 C 的全局单例和旁路通道违反多实例隔离与统一隐私管道。具体拆包粒度和公开函数签名仍是 `implementation-detail`，不得写入本 ADR；
- 实施约束补充：插件不得独立上报或绕过脱敏、采样、队列和重试；Browser 代理必须可引用计数恢复；框架适配只能依赖公开接口；重复初始化、停止、销毁和多实例隔离均属于公共行为；
- 验证输入补充：正式审批应核对无 DOM Core、代理恢复、插件异常隔离、生命周期幂等、多实例、tree-shaking、gzip 包体积及真实浏览器/框架矩阵；精确包体积测量和性能基准标记为 `requires-benchmark`；
- 进入 `accepted` 前仍需非作者、SDK、浏览器兼容和安全/隐私领域评审；公共 API 签名随后必须另行形成机器可验证契约。

### 2026-07-29：接受决策

- 决策状态更新为 `accepted`，实施状态保持 `not-started`；
- 独立非作者评审由隔离审查上下文 `adr_001_003_review` 完成，覆盖 SDK、browser compatibility、frontend-framework、security/privacy 和 performance 视角；
- 评审确认分层、单体浏览器 SDK 和全局单例插件三项候选真实，宿主安全、环境隔离、统一管道、多实例和生命周期约束完整；
- 共享代理在最后使用者释放后恢复是强制语义，引用计数仅为可选实现；
- 当前没有 SDK 包、公开 API、浏览器实现、Issue、实现 PR、包体或性能测试结果，本次接受不得解释为架构已实现。

### 2026-07-30：Core 基础第一增量实施证据

- 决策状态保持 `accepted`，实施状态由 `not-started` 更新为 `in-progress`；本记录只覆盖[SDK Core 生命周期与插件编排基础第一增量](../sdk/sdk-core-foundation.md)，不覆盖 Browser、具体插件、框架适配、采样、队列、传输或持久化。
- 实施范围：`packages/core` 为唯一新增模块，私有、`aurora.layer: sdk-core`、唯一根公开入口 `@aurora/core`；实现环境无关 Core、`created/initialized/started/stopped/destroyed` 生命周期、最小冻结配置（默认 `maxDiagnosticEntries: 100`，范围 1—1000）、插件 kebab-case 名称与四个钩子在注册时快照、注册顺序初始化/启动与逆序停止/销毁、单插件同步/异步异常隔离与隔离后仍单次销毁、冻结最小 `CorePluginContext.submitEvent`、`submitEvent(input: unknown)` 经 `@aurora/event-schema` 根公开出口 `parseEventEnvelope` 校验、每实例有界无敏感内容诊断和多实例隔离。
- 公共出口：`createCore`、`AuroraCore`、`CoreConfigInput`、`CoreConfigSnapshot`、`CoreConfigUpdateResult` 及其成功/失败/码、`CoreLifecycleResult` 及其成功/失败/码/状态、`CorePlugin`、`CorePluginContext`、`CorePluginRegistrationResult` 及其成功/失败/码、`CoreEventResult` 及其五种变体、`CoreDiagnostic`/`CoreDiagnosticCode`/`CoreDiagnosticOperation`、`EventSchemaIssue`（从 `@aurora/event-schema` 重新导出）。
- 验证命令与结果（新鲜运行，环境 Node.js v24.18.0、pnpm 11.17.0、TypeScript 6.0.3、Vitest 4.1.10、ESLint 10.8.0、Prettier 3.9.6）：
  - `pnpm install --frozen-lockfile`: 通过（exit 0，锁文件未改变）
  - `pnpm format:check`: 通过（exit 0）
  - `pnpm lint`: 通过（exit 0）
  - `pnpm typecheck`: 通过（exit 0，`@aurora/workspace-policy`、`@aurora/event-schema`、`@aurora/core` 均 Done；Core 含 `tsconfig.no-dom.json`）
  - `pnpm test`: 通过（exit 0；`@aurora/core` 58 个测试 / 9 个文件，`@aurora/event-schema` 41 个测试 / 7 个文件，`@aurora/workspace-policy` 47 个测试 / 8 个文件）
  - `pnpm test:coverage`: 通过（exit 0；`@aurora/core` 语句 97.5% 234/240、分支 96.63% 115/119、函数 98.03% 50/51、行 98.64% 218/221；门槛 85/80/85/85 全部满足）
  - `pnpm check:boundaries`: 通过（exit 0，真实仓库无违规）
  - `pnpm build`: 通过（exit 0，产出 `packages/core/dist/`、`packages/event-schema/dist/` 与 `tooling/workspace-policy/dist/`）
  - `pnpm --filter @aurora/core test:package`: 通过（exit 0，2 个测试；根入口加载 `createCore`，`src`、`internal`、未导出子路径均以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝）
  - `pnpm --filter @aurora/event-schema test:package`: 通过（exit 0，3 个测试）
  - `pnpm check:ci`: 通过（exit 0）
  - `git diff --check`: 通过（exit 0）
- 契约证据：`packages/core/test/` 覆盖生命周期状态机与并发串行、配置默认/非法/不可变/更新边界、插件合法/非法/重复/注册关闭/钩子顺序/失败隔离/上下文最小化、事件接受/拒绝/非变异/销毁后拒绝、宿主安全（同步抛错、异步拒绝、恶意 Proxy 不冒泡且诊断不含异常消息/堆栈/事件内容）、多实例隔离与无 DOM 编译；`submitEvent` 的 `accepted` 仅表示 Core 已启动且信封通过校验，不构成采样、排队、传输或持久化。
- 证据路径：`packages/core/`（src/、test/、README.md、package.json、tsconfig.json、tsconfig.build.json、tsconfig.no-dom.json、vitest.config.ts）、`tooling/workspace-policy/src/environment.ts`、`tooling/workspace-policy/src/graph.ts`、`tooling/workspace-policy/src/imports.ts`、`tooling/workspace-policy/src/types.ts`、`tooling/workspace-policy/test/environment.test.ts`、`tooling/workspace-policy/test/dependency-policy.test.ts`、`tooling/workspace-policy/test/core-package-contract.test.ts`、`eslint.config.mjs`、`package.json`
- 实施 Commit：none（未提交）
- Issue/PR：none
- 性能结果：不存在（包体与运行时性能基准属于后续 SDK/Browser 模块，`requires-benchmark`）
- 剩余工作：Browser 层、错误/请求/性能/行为具体采集插件、React/Vue 适配、采样、队列、批次、网络传输、重试/退避、持久化、包体测量和性能基准均不存在，因此 ADR 保持 `in-progress`。

### 2026-07-30：Browser 环境基础第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只覆盖[Browser 浏览器环境能力与页面生命周期基础第一增量](../sdk/browser-environment-foundation.md)，不覆盖具体插件、框架适配、采样、队列、传输或持久化。
- `@aurora/browser` 已实现浏览器环境探测、脱敏页面快照、页面可见性与 `visibilitychange`/`pagehide`/`pageshow` 生命周期资源管理；它没有实现具体插件或扩展 Core 环境端口，因此 SDK 分层与插件架构整体仍为 in-progress。
- 实施范围：`packages/browser` 为唯一新增模块，私有、`aurora.layer: sdk-browser`、唯一根公开入口 `@aurora/browser`、本增量零 Aurora 本地运行时依赖；实现安全全局访问与能力探测、`origin + pathname` 脱敏页面快照、User Agent、可见性、Unix/性能双时钟、原子三监听器订阅与注册回滚、逻辑停用优先的幂等取消与整体销毁、实例级 100 条脱敏诊断、getter/监听器/回调异常隔离与多实例隔离。
- 公共出口：`createBrowserEnvironment`、`BrowserEnvironment`、`BrowserCapabilities`、`BrowserCapabilityName`、`BrowserPageSnapshot`、`BrowserClockSnapshot`、`PageVisibilityState`、`PageLifecycleEventType` 及三类事件、`BrowserLifecycleListener`、`BrowserSubscribeCode`/`BrowserSubscribeResult`/`BrowserSubscription`/`BrowserUnsubscribeCode`/`BrowserUnsubscribeResult`、`BrowserDestroyCode`/`BrowserDestroyResult`、`BrowserDiagnostic`/`BrowserDiagnosticCode`/`BrowserDiagnosticOperation`。
- 验证命令与结果（新鲜运行，环境 Node.js v24.18.0、pnpm 11.17.0、TypeScript 6.0.3、Vitest 4.1.10、`@playwright/test` 1.62.0、Chromium v1234、ESLint 10.8.0、Prettier 3.9.6）：`pnpm --filter @aurora/browser typecheck/test/test:coverage/test:package/test:browser` 与根 `pnpm format:check`/`lint`/`typecheck`/`test`/`test:coverage`/`check:boundaries`/`build`/`check:ci` 均 exit 0；Browser 单元测试 32 个、包入口测试 2 个、Chromium 真实浏览器测试 5 个全部通过，覆盖率满足 lines 85%/branches 80%/functions 85%/statements 85%。
- 契约证据：Workspace Policy 扩展 `sdk-browser → sdk-core | protocol` 层矩阵及反向、插件/框架、私有路径、循环、模块可变状态和宿主修改负例；ESLint 对 Browser 源加入宿主全局赋值、原型修改与 `Object`/`Reflect` 修改器限制；Core 仍为无 DOM，未新增 Browser 环境注入端口。
- 证据路径：`packages/browser/`（src/、test/、test-browser/、README.md、package.json、tsconfig.json、tsconfig.build.json、vitest.config.ts、playwright.config.ts）、`tooling/workspace-policy/src/environment.ts`、`tooling/workspace-policy/src/graph.ts`、`tooling/workspace-policy/src/types.ts`、`tooling/workspace-policy/test/browser-package-contract.test.ts`、`tooling/workspace-policy/test/environment.test.ts`、`tooling/workspace-policy/test/dependency-policy.test.ts`、`eslint.config.mjs`、`package.json`、`pnpm-lock.yaml`
- 实施 Commit：none（未提交）
- Issue/PR：none
- 性能结果：不存在（包体与运行时性能基准属于后续 SDK 模块，`requires-benchmark`）
- 剩余工作：错误/请求/性能/行为具体采集插件、React/Vue 适配、Core 环境注入端口、采样、队列、批次、网络传输、重试/退避、持久化、包体测量和性能基准均不存在，因此 ADR 保持 `in-progress`。

### 2026-07-31：错误事件协议前置契约实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只澄清错误采集插件的前置协议契约已具备，不实施插件本身。
- 关联：[错误事件协议契约第一增量](../protocol/error-event-contract.md)、[ADR-005](ADR-005-event-schema-source-of-truth.md)。
- 当前事实：`@aurora/event-schema` 已实施错误事件协议契约第一增量——JavaScript 运行时错误、未处理 Promise 拒绝和资源加载错误正文、`parseErrorEventBody`/`parseErrorEventEnvelope` 解析器、稳定 issue（`string_empty`/`invalid_url`/`event_type_mismatch`）与三组错误契约样本，并通过包入口、消费者契约、覆盖率与边界新鲜验证。
- 边界澄清：错误协议不是错误插件。`packages/plugin-error`、浏览器 `error`/`unhandledrejection`/资源错误监听器、错误规范化、去重、分组、指纹、Source Map、Stack Frame 映射、Core 插件生命周期集成、传输、采样、队列、重试与持久化均不存在；未来错误采集插件只能从 `@aurora/event-schema` 根入口导入错误契约常量、类型与解析器，把完整 `ErrorEventEnvelope` 交给 Core 公开事件入口，不得复制协议类型或绕过 Core 建立独立传输。
- 实施 Commit：none（未提交）
- Issue/PR：none
- 剩余工作：错误采集插件仍需在独立规格中规划，且只在错误事件契约实际实施并通过包入口与契约测试后才可开始；ADR 保持 `in-progress`。

### 2026-07-31：Browser 错误源订阅能力第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只覆盖[Browser 错误源订阅能力第一增量](../sdk/browser-error-source.md)，不覆盖具体采集插件、错误规范化、Core 插件、协议转换、采样、队列、传输或持久化。
- 关联：[Browser 环境基础规格](../sdk/browser-environment-foundation.md)、[错误事件协议契约](../protocol/error-event-contract.md)、[ADR-006](ADR-006-one-way-dependencies.md)。
- 当前事实：`@aurora/browser` 已扩展 `subscribeErrorSources(listener)`——通过 `addEventListener` 安全订阅捕获阶段 `error` 和普通 `unhandledrejection`，区分三类错误（JavaScript/Promise/资源），将原生事件投影为冻结的最小只读 `BrowserErrorSourceEvent` 视图，资源 URL 通过现有 `origin + pathname` 脱敏，支持原子注册/部分失败回滚/幂等取消/统一销毁/异常隔离/多实例隔离；不覆盖 `window.onerror`/`window.onunhandledrejection`，不调用事件控制方法，不修改原生原型/API。
- 完整质量门禁（新鲜运行，Node.js v24.18.0、pnpm 11.17.0、TypeScript 6.0.3、Vitest 4.1.10、Playwright 1.62.0、Chromium）：
  - `pnpm format:check`/`pnpm lint`/`pnpm typecheck`: 全部通过（exit 0）
  - `pnpm --filter @aurora/browser test`: 通过（11 个测试文件 / 53 个测试）
  - `pnpm --filter @aurora/browser test:coverage`: 通过（语句 96%、分支 94.11%、函数 98.07%、行 97.25%）
  - `pnpm --filter @aurora/browser test:package`: 通过（2 个测试；根出口含 `BrowserErrorSourceEventType`，`error-source` 私有路径拒绝）
  - `pnpm --filter @aurora/browser test:browser`: 通过（8 个 Chromium 测试；三类真实错误各一次、handler 身份不变、释放/多实例/回调隔离通过）
  - `pnpm check:boundaries`/`pnpm check:ci`: 全部通过（exit 0）
  - `dist/error-source.js`: 9105 raw / 1849 gzip bytes（`requires-benchmark`——非最终 bundler/tree-shaking 证据）
- 边界澄清：Browser 错误源不是错误插件。`packages/plugin-error`、错误协议转换、`EventEnvelope` 创建、事件 ID/时间生成、Core 插件、Core 事件提交、错误去重/分组/指纹、Source Map、采样、队列、传输、重试、持久化均不存在。未来错误采集插件只能从 `@aurora/browser` 根入口消费 `subscribeErrorSources()`，不再自行探测环境或管理全局监听器。
- 实施 Commit：none（未提交）
- Issue/PR：none
- 剩余工作：错误插件仍需独立规格并在上游前置全部实施后规划；ADR 保持 `in-progress`。

### 2026-07-31：Browser 错误采集插件第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只覆盖 `@aurora/plugin-error` 第一增量。
- 插件通过公开 Browser 错误源、event-schema 错误正文解析器和 Core 最小草稿入口组合三层能力；插件不拥有 BrowserEnvironment，不创建系统字段、队列或传输。
- 生命周期、原子订阅失败、停止/销毁释放、同步重入阻断、单次失败恢复、多实例和真实 Chromium 宿主安全门禁均通过。
- 验证命令：`pnpm --filter @aurora/plugin-error typecheck/test/test:coverage/test:package/test:browser`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
- 剩余工作：请求、性能、行为、框架插件、采样、队列、批量、传输、重试和持久化仍不存在。

### 2026-07-31：请求事件协议前置契约实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只澄清请求采集插件的前置协议契约已具备，不实施请求观测或请求插件。
- 关联：[请求事件协议契约第一增量](../protocol/request-event-contract.md)。
- 当前事实：`@aurora/event-schema` 已实施请求事件协议契约第一增量——`parseRequestEventBody`/`parseRequestEventEnvelope`、请求方法/结果常量、请求样本与三类消费者契约。
- 边界澄清：请求协议不是请求观测或请求插件。`packages/browser` 请求观测能力、`packages/plugin-request`、fetch/XHR 代理、请求去重、分组、指纹、Source Map、传输、采样、队列、重试与持久化均不存在；未来请求采集插件只能从 `@aurora/event-schema` 根入口导入请求契约常量、类型与解析器，把完整 `RequestEventEnvelope` 交给 Core 公开事件入口。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
- 剩余工作：请求观测与请求插件仍需独立规格并在上游前置全部实施后规划；ADR 保持 `in-progress`。

### 2026-07-31：Browser 请求观测能力第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只覆盖[Browser 请求观测能力第一增量](../sdk/browser-request-source.md)，不覆盖请求采集插件、协议转换、采样、队列、传输或持久化。
- 关联：[请求事件协议契约](../protocol/request-event-contract.md)、[Browser 环境基础规格](../sdk/browser-environment-foundation.md)、[ADR-006](ADR-006-one-way-dependencies.md)。
- 当前事实：`@aurora/browser` 已扩展 `subscribeRequests(listener)`——安全观测 `window.fetch` 与 `window.XMLHttpRequest`，投影冻结的最小只读请求事实（机制、方法、脱敏 URL、开始时间、持续时间、结果类别、状态码），共享代理 + 每实例引用计数，首个订阅者安装、最后一个订阅者释放后恢复原始宿主引用；fetch 保持参数透传、Promise 语义与 Response 不被消费；XHR 保持 `instanceof`、`open`/`send`/`abort` 语义、调用方 handler 不被覆盖、正文与敏感 Headers 不被读取；不修改 `XMLHttpRequest.prototype`。
- 完整质量门禁（新鲜运行）：`pnpm --filter @aurora/browser typecheck/test/test:coverage/test:package/test:browser` 与根 `pnpm format:check`/`lint`/`typecheck`/`test`/`test:coverage`/`check:boundaries`/`build`/`check:ci` 均 exit 0；Browser 单元测试 76 个，覆盖率语句 91.63%/分支 85.45%/函数 94.31%/行 93.28%，真实 Chromium 13 个测试（含真实 fetch 成功/404/网络拒绝/取消、真实 XHR load、正文不被消费、宿主身份恢复、`instanceof` 保持、多订阅者与多实例隔离、回调异常隔离）。
- 边界澄清：请求观测不是请求插件。`packages/plugin-request`、请求协议转换、`EventEnvelope` 创建、事件 ID/时间生成、Core 插件、Core 事件提交、允许来源/同源/跨域/路径归一化判断、慢请求阈值、采样、去重、分组、指纹、传输、队列、重试与持久化均不存在。未来请求采集插件只能从 `@aurora/browser` 根入口消费 `subscribeRequests()`，只从 `@aurora/event-schema` 根入口导入请求契约，只通过 Core 草稿入口提交。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
- 剩余工作：请求采集插件仍需独立规格并在上游前置全部实施后规划；ADR 保持 `in-progress`。

### 2026-07-31：Browser 请求采集插件第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只覆盖[Browser 请求采集插件第一增量](../sdk/request-capture-plugin.md)。
- 插件通过公开 Browser 请求源、event-schema 请求正文解析器和 Core 最小草稿入口组合三层能力；插件不拥有 BrowserEnvironment，不创建系统字段、队列或传输。
- 生命周期、原子订阅失败、停止/销毁释放、同步重入阻断、单次失败恢复、多实例和真实 Chromium 宿主安全门禁均通过。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
- 剩余工作：性能、行为、框架插件、采样、队列、批量、传输、重试和持久化仍不存在。

### 2026-07-31：性能事件协议前置契约实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只澄清性能采集插件的前置协议契约已具备，不实施性能观测或性能插件。
- 关联：[性能事件协议契约第一增量](../protocol/performance-event-contract.md)。
- 当前事实：`@aurora/event-schema` 已实施性能事件协议契约第一增量——PRD 5.1.9 批准的 LCP/INP/CLS/页面加载耗时指标正文、`parsePerformanceEventBody`/`parsePerformanceEventEnvelope` 解析器与三类性能契约样本，并通过包入口、消费者契约、覆盖率与边界新鲜验证。
- 边界澄清：性能协议不是性能观测或性能插件。`packages/browser` 性能事实观测能力、`packages/plugin-performance`、`PerformanceObserver` 读取、采样率（PRD 默认 10%）、聚合与指标统计均不存在；未来性能采集插件只能从 `@aurora/event-schema` 根入口导入性能契约常量、类型与解析器，只通过 Core 草稿入口提交，不得复制协议类型或绕过 Core 建立独立传输。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
- 剩余工作：性能观测与性能插件仍需独立规格并在上游前置全部实施后规划；ADR 保持 `in-progress`。

### 2026-08-01：Browser 性能事实观测能力第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只覆盖[Browser 性能事实观测能力第一增量](../sdk/browser-performance-source.md)，不覆盖性能采集插件、采样、队列、传输或持久化。
- 关联：[性能事件协议契约](../protocol/performance-event-contract.md)、[ADR-006](ADR-006-one-way-dependencies.md)。
- 当前事实：`@aurora/browser` 已扩展 `subscribePerformance(listener)`——通过原生 `PerformanceObserver` 观测 PRD 5.1.9 批准的四项页面性能事实（`page_load` Navigation Timing、`lcp` Largest Contentful Paint、`cls` Layout Instability session window、`inp` Event Timing interaction 聚合），投影冻结的最小只读事实；每指标独立 observer（`buffered: false`，不消费宿主 entries），实例内多订阅者共享，最后一个取消时 `disconnect`；不修改 `PerformanceObserver`/`performance`/原生 prototype，不影响其他库的 observer。
- 完整质量门禁（新鲜运行）：`pnpm --filter @aurora/browser typecheck/test/test:coverage/test:package/test:browser` 与根 `pnpm check:ci` 均 exit 0；Browser 单元测试 90 个，覆盖率语句 88.88%/分支 82.2%/函数 93.75%/行 90.54%，真实 Chromium 19 个测试（含真实 Navigation Timing/LCP/CLS/INP、页面隐藏收尾、隐私不泄露、多订阅者与多实例隔离）。
- 边界澄清：性能观测不是性能插件。`packages/plugin-performance`、性能协议转换、`EventEnvelope` 创建、采样（PRD 默认 10%）、聚合与指标统计均不存在。未来性能采集插件只能从 `@aurora/browser` 根入口消费 `subscribePerformance()`，只从 `@aurora/event-schema` 根入口导入性能契约，只通过 Core 草稿入口提交。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
- 剩余工作：性能采集插件、采样、队列、批量、传输、重试和持久化仍不存在。

### 2026-08-01：Browser 性能采集插件第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只覆盖 `@aurora/plugin-performance` 第一增量。
- 插件通过公开 Browser 性能源、event-schema 性能正文解析器和 Core 最小草稿入口组合三层能力；插件不拥有 BrowserEnvironment，不创建系统字段、队列或采样器。
- 生命周期、原子订阅失败、停止/销毁释放、同步重入阻断、单次失败恢复、多实例和真实 Chromium 宿主安全门禁均通过。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
- 剩余工作：采样（PRD 默认 10% 算法未定义）、队列、批量、传输、重试和持久化仍不存在。

### 2026-08-11：G06 SDK 可靠发送链（SDK-15/16）实施证据

- 状态保持 `accepted / in-progress`；
- `@aurora/sdk` 新增可靠发送链：`createSdkDeliveryQueue`（有界、error-first、去重、溢出丢低优先级、多实例隔离）、`buildDeliveryBatch`、`SdkBatchTransport` 端口、`classifySdkHttpStatus/ReceiptState/TransportReason`（PRD §6.3）、`calculateSdkRetryDelay`（有界退避）、`createSdkDeliveryChain`（enqueue→batch→transport→receipt 逐事件处理、有界重试、flush/best-effort、有界诊断、宿主安全）；`@aurora/core` `CoreEventAccepted.event` 加法；`@aurora/browser` `createBrowserBatchTransport` 与 composition 接线（pagehide → best-effort flush）。队列/批次/重试/传输核心已存在；
- 剩余工作：浏览器持久化离线队列（PRD §6.2 deferred）、框架适配（G07）、生产凭证管理 HTTP API/UI、行为事件正文与行为插件仍不存在。
