---
title: ADR-006：采用单向依赖与自动架构约束
status: accepted
implementation-status: in-progress
owner: architecture
date: 2026-07-27
last-reviewed: 2026-07-30
applies-to: Aurora Monorepo 全部应用和包
related:
  - ../../AURORA_RULES.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - ../architecture/system-overview.md
  - ../architecture/sdk-architecture.md
  - ../architecture/platform-frontend.md
  - ../architecture/platform-backend.md
  - ../testing/test-strategy.md
supersedes: none
superseded-by: none
---

# ADR-006：采用单向依赖与自动架构约束

## 元数据

- 状态：accepted
- 日期：2026-07-27
- Owner：architecture
- 适用范围：Aurora 全部包依赖、公开导出和跨系统调用
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联技术方案：[Aurora 架构规范](<../../Aurora 架构规范.md>)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none
- 实施状态：in-progress
- 评审状态：非作者及所需领域评审已通过

## 背景

Monorepo 使跨包访问很方便，也容易让 Core 依赖 Browser、插件访问私有文件、管理平台引用服务端模型或 shared 成为杂物包。只在文档中声明依赖方向，随着功能和 Agent 对话增加，很难长期依赖人工记忆保持边界。

## 决策驱动因素

- Core 必须环境无关；
- 插件和框架适配只能使用公开接口；
- 公共协议必须位于依赖底层；
- 管理平台不能访问数据库内部结构；
- 循环和私有引用必须在合并前发现；
- 临时例外需要可追踪和有结束条件。

## 候选方案

### 方案 A：单向依赖并由工具自动阻止违规

定义允许依赖矩阵，通过包 exports、TypeScript、Lint、依赖图和 CI 检查执行。

优点：

- 违规在开发和 CI 阶段快速发现；
- 规则结果一致，不依赖评审者记忆；
- 模块可以独立测试和演进；
- 私有目录和环境 API 能被技术手段保护；
- 依赖图可以持续审计。

缺点：

- 需要维护工具配置和例外；
- 初期配置成本较高；
- 误报可能阻塞开发；
- 部分运行时依赖仍需集成测试发现。

### 方案 B：只依靠文档和代码评审

文档描述边界，由作者和评审者人工检查。

优点：

- 无额外工具；
- 对特殊情况灵活；
- 初期开始速度快。

缺点：

- 规则执行不一致；
- Agent 和新成员容易遗漏；
- 循环和深层私有引用可能很晚发现；
- 临时绕过容易成为永久架构；
- 大规模重构时审查成本高。

### 方案 C：系统间完全使用远程服务或事件通信

所有系统物理隔离，禁止代码级依赖。

优点：

- 物理边界最强；
- 独立部署和扩缩容；
- 私有代码天然隔离。

缺点：

- 第一版网络、部署和可观测性复杂度过高；
- 公共协议和开发环境仍需共享；
- 增加延迟、故障和数据一致性问题；
- 不能替代 SDK 包内部的分层约束。

## 最终决策

决定选择方案 A：明确单向依赖，并通过自动工具阻止循环、反向和私有引用。

工具必须服务于已经批准的边界，不得通过随意增加忽略规则消除失败。具体工具与配置另行选择，接受本决策不表示自动检查已经存在。

## 结果与影响

### 正面影响

- 架构边界持续可执行；
- Core 环境无关和协议底层地位可验证；
- 私有实现不会意外成为公共 API；
- 重构影响和依赖图更清晰；
- Agent 修改更容易获得即时反馈。

### 负面影响与代价

- 需要选择和维护依赖检查工具；
- 包入口和路径别名必须规范；
- 错误配置可能产生误报或漏报；
- 临时迁移需要受控例外流程。

### 未解决问题

- 具体依赖图和 Lint 工具；
- 受影响检查和缓存方式；
- 类型依赖与运行时依赖是否使用不同规则；
- 测试代码的有限跨模块访问策略。

## 实施约束

- event-schema 不依赖业务模块；
- Core 不依赖 Browser、插件或框架；
- Browser 只依赖 Core 和 event-schema；
- 插件只依赖公开 Core、Browser 和协议接口；
- 框架适配只依赖公开 Core、Browser 和协议接口，不得访问 SDK 私有实现；
- 服务端不依赖 SDK 内部代码；
- 管理平台不依赖数据库模型和服务端私有模块；
- 跨包禁止引用 src、internal 或未导出路径；
- package.json 依赖必须声明；
- CI 检查循环、反向、私有和未声明依赖；
- 临时例外记录原因、范围、Owner、风险、到期日、清理任务和结束条件；
- 禁止长期忽略失败或把代码移入 shared 绕过边界。

## 迁移方案

ADR accepted 后先建立允许依赖矩阵和包公开出口，再选择工具实现本地和 CI 检查。对既有违规逐项记录并修复；临时例外必须有期限，不能建立无限期白名单。

## 回滚方案

如果工具误报或性能不可接受，可按临时例外规则在明确范围和到期日内停用具体实现，但必须保留依赖矩阵和恢复任务，并选择替代工具。不得把自动检查故障解释为取消单向依赖原则。若要改变依赖方向，必须创建新 ADR。

## 验证方式

- 依赖图不存在循环；
- Core 构建环境不含 DOM 且无法导入 Browser；
- 跨包私有路径示例在本地和 CI 中失败；
- 未声明依赖导致检查失败；
- 管理平台无法导入服务端数据库模型；
- 临时例外可以被查询且包含到期条件；
- 架构检查失败阻止合并。

## 重新评估条件

- 工具长期无法支持所用语言或构建系统；
- 误报严重影响正常开发；
- 系统物理拆分改变依赖形态；
- 包数量和依赖图规模显著增长；
- 新运行环境需要调整层次方向。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-07-29：正式化复审输入

- 状态保持 `proposed / not-started`；当前没有源码依赖图、规则配置或 CI 结果；
- 背景输入补充：[系统架构与模块边界](../architecture/system-overview.md)、[SDK 架构](../architecture/sdk-architecture.md)、[平台前端架构](../architecture/platform-frontend.md)和[平台后端架构](../architecture/platform-backend.md)已明确多组长期单向依赖与公开能力边界；
- 候选方案复审：方案 A 继续作为提案；方案 B 仅靠文档无法持续防止私有导入，方案 C 将所有边界远程化会在第一版引入无证据的运行复杂度。具体 lint、依赖图和任务编排工具属于独立候选 ADR 或 `implementation-detail`；
- 实施约束补充：逻辑同进程不能绕过公开模块入口，前端不得直连数据库/队列，插件不得访问 Core 私有状态，公共协议不得依赖消费者，禁止循环和反向依赖；
- 验证输入补充：正式审批应使用代表性允许/禁止依赖表、构建入口、测试替身和部署内模块调用逐项验证规则可执行性；工具性能和大型仓库扫描成本标记为 `requires-benchmark`；
- 进入 `accepted` 前仍需非作者、架构、工程工具、SDK、前端和后端领域评审，并确认允许/禁止依赖矩阵可以被自动工具表达。实际本地与 CI 负例阻断结果属于实施验证，在 `implementation-status` 进入 `implemented` 前必须提供；当前不存在该证据，不能把 ADR 接受描述为工具已实现。

### 2026-07-29：独立评审修正接受门禁

- 隔离审查上下文 `adr_004_006_review` 指出原文本把本地/CI 负例结果错误设为接受前门禁，而仓库尚无源码、规则配置或 CI，无法在不虚构证据的情况下满足；
- 文档已明确：接受阶段确认依赖矩阵和自动约束原则可表达，真实负例阻断结果属于 `implemented` 前验证；
- 同次修正补齐框架适配公开依赖和临时例外的风险、到期与恢复约束，不改变方案 A 的方向。

### 2026-07-29：接受决策

- 决策状态更新为 `accepted`，实施状态保持 `not-started`；
- `adr_004_006_review` 在修正后完成独立复审并确认无剩余阻断，覆盖 architecture、tooling、SDK、frontend、backend 和 framework integration 视角；
- 评审确认自动约束、人工评审和全远程边界三项候选真实，迁移、回滚、验证和重新评估条件完整；
- 当前没有依赖图、规则配置、CI、负例执行、Issue 或实现 PR，本次接受不得解释为架构检查已实现。

### 2026-07-29：首模块实施证据

- 实施状态更新为 `in-progress`；通用清单、导入和循环检查已存在，但领域专属层级规则尚无真实模块可供验证；
- 实施 Commit：none（未提交）
- 验证命令与结果：
  - `pnpm check:boundaries`: 通过（exit 0，真实仓库无违规）
  - Workspace policy 测试夹具证明以下负例被拒绝：undeclared-dependency、dependency-cycle、private-path-import（`/src/`、`/internal/`、未导出子路径）
  - `pnpm test`: 10 个测试全部通过（root-contract 3、manifest-policy 3、dependency-policy 3、cli 4 减去重复计数）
- 证据路径：`tooling/workspace-policy/src/graph.ts`、`tooling/workspace-policy/src/imports.ts`、`tooling/workspace-policy/test/dependency-policy.test.ts`
- Issue/PR：none
- 性能结果：不存在
- 本 ADR 的 `implemented` 状态需待 Core、Browser、插件、框架适配等真实模块加入并通过对应层级规则验证后方可更改

### 2026-07-30：协议层依赖边界实施证据

- 实施状态保持 `in-progress`；本轮为 `@aurora/event-schema`（`aurora.layer: protocol`）补齐协议层零本地依赖规则与公共/私有入口证据，Core、Browser、插件、框架适配、服务端和管理平台层级规则仍待真实模块验证；
- 新增违规码 `forbidden-layer-dependency`：`tooling/workspace-policy/src/types.ts` 扩展 `WorkspaceViolationCode`，`tooling/workspace-policy/src/graph.ts` 新增 `packageLayer` 与 `protocolLayerViolations`，任何 `aurora.layer: protocol` 包声明的全部本地依赖都被拒绝；
- 负例证据：`tooling/workspace-policy/test/dependency-policy.test.ts` 证明协议包声明 `@aurora/consumer` 本地依赖时返回 `forbidden-layer-dependency`；同一测试证明包公开自引用（`@aurora/event-schema` 与 `@aurora/event-schema/contract-testkit`）不构成依赖边，而私有自路径 `@aurora/event-schema/internal/parser` 仍被 `private-path-import` 拒绝；
- 真实仓库结果：`@aurora/event-schema` 无 `dependencies`、无 `workspace:` 范围、无本地依赖；`pnpm check:boundaries` 通过（exit 0，无违规）；
- 公共/私有入口证据：`packages/event-schema/test/package-entry.test.ts` 证明 Node 可加载 `@aurora/event-schema` 与 `@aurora/event-schema/contract-testkit` 两个已声明入口，并以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝 `@aurora/event-schema/src/index.js`、`@aurora/event-schema/internal/parser.js`、`@aurora/event-schema/value-boundaries`；
- 验证命令与结果：`pnpm check:boundaries` 通过（exit 0）、`pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/event-schema-package-contract.test.ts` 通过（exit 0）、`pnpm --filter @aurora/event-schema test:package` 通过（exit 0，3 个测试）、`pnpm check:ci` 通过（exit 0）；
- 实施 Commit：none（未提交）
- Issue/PR：none
- 剩余工作：SDK Core 不依赖 Browser/插件/框架、Browser 只依赖 Core 与 event-schema、插件/框架只依赖公开接口、服务端不依赖 SDK 内部、管理平台不依赖数据库模型/服务端私有模块等层级规则仍需各自真实模块加入后验证。

### 2026-07-30：sdk-core 层级与环境边界实施证据

- 实施状态保持 `in-progress`；本轮为 `@aurora/core`（`aurora.layer: sdk-core`）补齐 `sdk-core → protocol` 层级规则、Core 源码浏览器全局与模块级可变状态禁用以及无 DOM 编译证据，其他系统层级规则仍待真实模块验证。
- 新增违规码 `forbidden-runtime-global` 与 `mutable-module-state`：`tooling/workspace-policy/src/types.ts` 扩展 `WorkspaceViolationCode`，`tooling/workspace-policy/src/environment.ts` 扫描 `sdk-core` 源码；`tooling/workspace-policy/src/graph.ts` 将原 `protocolLayerViolations` 泛化为 `layerDependencyViolations`，允许矩阵为 `protocol → ∅`、`sdk-core → {protocol}`。
- 层级负例证据：`tooling/workspace-policy/test/dependency-policy.test.ts` 证明 `sdk-core` 依赖 `protocol` 通过，依赖 `sdk-browser`、`sdk-plugin`、`framework`、`tooling` 均返回 `forbidden-layer-dependency`；`protocol` 层任意本地依赖继续被拒绝。
- 环境负例证据：`tooling/workspace-policy/test/environment.test.ts` 证明 `window`、`document`、`navigator`、`location`、`fetch`、`XMLHttpRequest`、`localStorage`、`sessionStorage`、`Document`、`Storage`、`EventTarget`、`HTMLElement` 与 `globalThis['window']` 计算访问均返回 `forbidden-runtime-global`；顶层 `let`/`var`、`new Map()`、数组字面量、对象字面量均返回 `mutable-module-state`，而不可变常量与工厂内可变状态通过。
- 无 DOM 编译证据：`packages/core/tsconfig.no-dom.json` 仅使用 `ES2024` 库（继承 `tsconfig.base.json`，不含 DOM），消费 `src/**/*.ts` 与 `test/no-dom-consumer.ts` 通过 `tsc -p tsconfig.no-dom.json --noEmit`；`eslint.config.mjs` 对 `packages/core/src/**/*.ts` 禁用 `window`/`document`/`navigator`/`location`/`fetch`/`XMLHttpRequest`/`localStorage`/`sessionStorage` 全局。
- 真实仓库结果：`@aurora/core` 仅声明 `@aurora/event-schema: workspace:*` 运行时依赖，无私有深导入、无循环、无浏览器全局、无模块级可变状态；`pnpm check:boundaries` 通过（exit 0，无违规）。
- 验证命令与结果：`pnpm check:boundaries` 通过（exit 0）、`pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/environment.test.ts test/core-package-contract.test.ts` 通过（exit 0，31 个测试）、`pnpm --filter @aurora/core typecheck` 通过（exit 0，含 no-DOM）、`pnpm check:ci` 通过（exit 0）。
- 实施 Commit：none（未提交）
- Issue/PR：none
- 剩余工作：Browser 只依赖 Core 与 event-schema、插件/框架只依赖公开接口、服务端不依赖 SDK 内部、管理平台不依赖数据库模型/服务端私有模块等层级规则仍需各自真实模块加入后验证。

### 2026-07-30：sdk-browser 层级与宿主边界实施证据

- 实施状态保持 `in-progress`；本轮为 `@aurora/browser`（`aurora.layer: sdk-browser`）补齐 `sdk-browser → sdk-core | protocol` 层级规则、Browser 源码模块级可变状态与宿主修改禁用以及 strict DOM 编译证据，其他系统层级规则仍待真实模块验证。
- Workspace Policy 已加入 `sdk-browser -> sdk-core | protocol` 允许矩阵及反向、插件/框架、私有路径、循环、模块可变状态和宿主修改负例；`@aurora/browser` 本增量实际保持零 Aurora 本地运行时依赖。
- 新增违规码 `forbidden-host-mutation`：`tooling/workspace-policy/src/types.ts` 扩展 `WorkspaceViolationCode`，`tooling/workspace-policy/src/environment.ts` 在 `layer === 'sdk-browser'` 时扫描对 `window`/`document`/`navigator`/`performance`/`globalThis`/`fetch`/`XMLHttpRequest`/`history` 的赋值/更新、`prototype` 修改以及 `Object.assign`/`Object.defineProperty`/`Reflect.set` 修改器；`tooling/workspace-policy/src/graph.ts` 允许矩阵增加 `sdk-browser → {sdk-core, protocol}`，模块级可变状态扫描同时覆盖 `sdk-core` 与 `sdk-browser`，`forbidden-runtime-global` 仍仅约束 `sdk-core`。
- 层级负例证据：`tooling/workspace-policy/test/dependency-policy.test.ts` 证明 `sdk-browser` 依赖 `sdk-core`/`protocol` 通过、依赖 `sdk-browser`/`sdk-plugin`/`framework`/`tooling` 返回 `forbidden-layer-dependency`，且 `sdk-browser` 从 `@aurora/core/src/...` 私有深导入返回 `private-path-import`；`tooling/workspace-policy/test/browser-package-contract.test.ts` 证明 `@aurora/browser` 私有、根出口、`sdk-browser` 层且无运行时依赖。
- 环境负例证据：`tooling/workspace-policy/test/environment.test.ts` 证明 `sdk-browser` 顶层 `let`/`Set`/数组字面量返回 `mutable-module-state`，七种宿主修改（`window.onerror=`、`window.onunhandledrejection=`、`globalThis.fetch=`、`XMLHttpRequest.prototype.open=`、`history.pushState=`、`Object.defineProperty(window,...)`、`Reflect.set(globalThis,...)`）返回 `forbidden-host-mutation`。
- ESLint 证据：`eslint.config.mjs` 对 `packages/browser/src/**/*.ts` 禁止对宿主全局赋值、修改原生 `prototype` 以及通过 `Object.assign`/`Object.defineProperty`/`Reflect.set` 修改宿主；Workspace Policy 仍是计算属性与修改器调用的 AST 兜底。
- 真实仓库结果：`@aurora/browser` 声明零运行时依赖，无私有深导入、无循环、无模块级可变状态、无宿主修改；`pnpm check:boundaries` 通过（exit 0，无违规）。
- 验证命令与结果：`pnpm check:boundaries` 通过（exit 0）、`pnpm --filter @aurora/workspace-policy test` 通过（exit 0，65 个测试）、`pnpm --filter @aurora/browser typecheck` 通过（exit 0，含 DOM）、`pnpm check:ci` 通过（exit 0）。
- 实施 Commit：none（未提交）
- Issue/PR：none
- 剩余工作：插件/框架只依赖公开接口、服务端不依赖 SDK 内部、管理平台不依赖数据库模型/服务端私有模块等层级规则仍需各自真实模块加入后验证。

### 2026-07-31：协议层 DOM/Node 运行时边界与错误契约入口证据

- 实施状态保持 `in-progress`；本轮为 `@aurora/event-schema`（`aurora.layer: protocol`）补齐协议源码 DOM/Node 运行时禁用扫描、错误契约公共/私有入口与 ES-only 构建证据，Core、Browser、插件、框架适配、服务端和管理平台层级规则仍待真实模块验证。
- 环境扫描扩展：`tooling/workspace-policy/src/environment.ts` 的 `inspectSource` 层级参数从 `'sdk-core' | 'sdk-browser'` 扩展为 `'protocol' | 'sdk-core' | 'sdk-browser'`；新增 `forbiddenProtocolRuntimeNames`（`window`、`document`、`navigator`、`location`、`fetch`、`XMLHttpRequest`、`localStorage`、`sessionStorage`、`process`、`Buffer`、`require`、`module`、`__dirname`、`__filename`）与 `isNodeRuntimeImport`（`node:` 前缀导入/导出）；`findEnvironmentViolations` 早期门控加入 `protocol`；协议层只检查 `forbidden-runtime-global`，不对 `as const` 冻结的对象/数组常量强制 `mutable-module-state`（该规则仍只约束 `sdk-core`/`sdk-browser`）。
- 协议环境负例证据：`tooling/workspace-policy/test/environment.test.ts` 新增 `protocol source policy` 用例，证明 `window`/`document`/`navigator`/`fetch`/`process`/`Buffer` 与 `node:fs/promises` 导入均返回 `forbidden-runtime-global`（`packageName: '@aurora/event-schema'`），而纯协议常量与纯函数通过；既有 Core/Browser 用例保持绿色。
- 协议零本地依赖证据：`@aurora/event-schema` 无 `dependencies`、无 `workspace:` 范围；`pnpm check:boundaries` 通过（exit 0，无违规）；`packages/event-schema/test/architecture-boundary.test.ts` 证明 manifest 无 `dependencies`、仅两个公共入口、`tsconfig.build.json` 为 `types: []` 的 ES-only 构建，源码不含 `@aurora/core`/`@aurora/browser`/`@aurora/plugin-`/`node:`/`window.`/`document.`/`navigator.`/`process.`/`Buffer.`/`console.`/`/src/`/`/internal/`。
- 公共/私有入口证据：`packages/event-schema/test/package-entry.test.ts` 证明 Node 可加载 `@aurora/event-schema`（含 `ErrorCategory`、`ErrorResourceType`、`PromiseRejectionReasonKind`、`ERROR_EVENT_LIMITS`、`parseErrorEventBody`、`parseErrorEventEnvelope`）与 `@aurora/event-schema/contract-testkit`（含 `validErrorEventSamples`、`invalidErrorEventSamples`、`boundaryErrorEventSamples`），并以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝 `@aurora/event-schema/error-event-body`、`@aurora/event-schema/error-event-envelope`、`@aurora/event-schema/resource-error-event` 等私有路径。
- 验证命令与结果：`pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts test/dependency-policy.test.ts test/event-schema-package-contract.test.ts` 通过（exit 0，57 个测试）、`pnpm --filter @aurora/event-schema test:package` 通过（exit 0，3 个测试）、`pnpm --filter @aurora/event-schema exec vitest run test/architecture-boundary.test.ts` 通过（exit 0，3 个测试）、`pnpm check:boundaries` 通过（exit 0）、`pnpm check:ci` 通过（exit 0）。
- 实施 Commit：none（未提交）
- Issue/PR：none
- 剩余工作：SDK Core 不依赖 Browser/插件/框架、Browser 只依赖 Core 与 event-schema、插件/框架只依赖公开接口、服务端不依赖 SDK 内部、管理平台不依赖数据库模型/服务端私有模块等层级规则仍需各自真实模块加入后验证。

### 2026-07-31：Browser 错误源宿主事件控制门禁与 sdk-browser 层级证据

- 实施状态保持 `in-progress`；本轮为 `@aurora/browser` 的 `sdk-browser` 层补齐 `forbidden-host-event-control` 自动门禁——拒绝 Browser 生产源码中调用 `preventDefault()`、`stopPropagation()`、`stopImmediatePropagation()`，以及 Browser 错误源订阅能力的零本地运行时依赖、公共/私有入口证据与 Chromium 真实浏览器证据。
- `WorkspaceViolationCode` 新增 `forbidden-host-event-control`：`tooling/workspace-policy/src/types.ts` 扩展违规码，`tooling/workspace-policy/src/environment.ts` 新增 `forbiddenEventControlMethods` 集合与 `isHostEventControl` AST 谓词；`tooling/workspace-policy/test/environment.test.ts` 证明三类事件控制调用均返回新违规码。
- 层级依赖证据：`@aurora/browser` 保持零 Aurora 本地运行时依赖、`sideEffects: false`、单一根出口、`aurora.layer: sdk-browser`；`pnpm check:boundaries` 通过（exit 0）；`packages/browser/test/package-entry.test.ts` 证明根入口含 `BrowserErrorSourceEventType`，`@aurora/browser/error-source` 私有路径拒绝；`packages/browser/test/import-safety.test.ts` 证明零副作用导入。
- 宿主安全证据：Browser 源码无 `preventDefault`/`stopPropagation`/`stopImmediatePropagation`/`window.onerror=/`/`window.onunhandledrejection=/`/`fetch=/`/`XMLHttpRequest=/`/`history.`/`@aurora/core`/`@aurora/event-schema`/`document.cookie`/`localStorage`/`sessionStorage`/`console.` 匹配，无 `/src/`/`/internal/` 跨包私导。
- 验证命令与结果：`pnpm check:boundaries` 通过（exit 0）、`pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts test/dependency-policy.test.ts` 通过（exit 0，60 个测试）、`pnpm --filter @aurora/browser test:browser` 通过（exit 0，8 个 Chromium 测试）、`pnpm check:ci` 通过（exit 0）。
- 实施 Commit：none（未提交）
- Issue/PR：none
- 剩余工作：插件/框架只依赖公开接口、服务端不依赖 SDK 内部、管理平台不依赖数据库模型/服务端私有模块等层级规则仍需各自真实模块加入后验证。

### 2026-07-31：sdk-plugin 单向依赖与环境边界实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- Workspace Policy 增加 `sdk-plugin -> sdk-core | sdk-browser | protocol`；反向依赖、插件间依赖、framework/tooling 依赖、循环、未声明依赖和跨包私有路径负例均被拒绝。
- sdk-plugin 生产源码的 DOM/宿主全局、Node 运行时、模块级可变状态、宿主修改和事件控制负例均生效；`tsconfig.no-dom.json`、ESLint、包根入口和私有子路径拒绝均通过。
- `@aurora/plugin-error` 实际只声明三个批准的 Workspace 根依赖，三个上游包均无反向依赖。
- 验证命令：Workspace Policy 定向测试、`pnpm check:boundaries`、plugin typecheck/package/Chromium 与根 `pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-07-31：Browser 请求观测 sdk-browser 边界实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- `@aurora/browser` 请求观测能力继续由 `sdk-browser` 层承载，包保持零 Aurora 本地运行时依赖、`sideEffects: false`、单一根出口；新增请求源类型/常量/能力与 `subscribeRequests`，不增加第二子路径。
- 请求观测生产源码不导入 `@aurora/event-schema` 或 `@aurora/core`，不访问 DOM/Cookie/Storage，不读取请求/响应正文或敏感 Headers，不修改 `XMLHttpRequest.prototype`；按 ADR-003 有意赋值 `window.fetch`/`window.XMLHttpRequest` 的窄范围放行已加入 Workspace Policy/ESLint 门禁（仅 `request-observer.ts`，其余宿主修改与原型修改仍全禁）。
- 验证命令：`pnpm --filter @aurora/browser typecheck/test/test:package/test:browser`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-07-31：请求事件契约协议层边界实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- 请求事件正文继续由 `@aurora/event-schema`（`aurora.layer: protocol`）唯一承载；包保持零运行时依赖、零本地 Workspace 依赖、`sideEffects: false`、恰好两个公共入口。
- 请求解析器、请求样本和共享字段/URL 助手均不进入根出口之外的新子路径；`request-event-body`、`request-event-envelope`、`request-event-types`、`field-validation`、`safe-url` 全部以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝。
- 生产源码不含 DOM/宿主全局、Node 运行时、Core/Browser/插件依赖或 console 输出；`pnpm check:boundaries` 通过。
- 验证命令：`pnpm --filter @aurora/event-schema typecheck/test/test:package`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-07-31：请求插件 sdk-plugin 依赖边界实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- `@aurora/plugin-request`（`aurora.layer: sdk-plugin`）声明 `@aurora/core`、`@aurora/browser`、`@aurora/event-schema` 三个 `workspace:*` 依赖，反向、插件间、framework/tooling、循环、未声明依赖和跨包私有路径负例均被拒绝。
- 插件生产源码的 DOM/宿主全局、Node 运行时、模块级可变状态、宿主修改和事件控制负例均生效；`tsconfig.no-dom.json`、ESLint、包根入口和私有子路径拒绝均通过。
- 验证命令：`pnpm check:boundaries`、plugin typecheck/package 与根 `pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-07-31：性能事件契约协议层边界实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- 性能事件正文继续由 `@aurora/event-schema`（`aurora.layer: protocol`）唯一承载；包保持零运行时依赖、零本地 Workspace 依赖、`sideEffects: false`、恰好两个公共入口。
- 性能解析器、性能样本和共享字段/数值助手均不进入根出口之外的新子路径；`performance-event-body`、`performance-event-envelope`、`performance-event-types` 全部以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝。
- 生产源码不含 DOM/宿主全局、`PerformanceObserver`、`performance.*`、Node 运行时、Core/Browser/插件依赖或 console 输出；`pnpm check:boundaries` 通过。
- 验证命令：`pnpm --filter @aurora/event-schema typecheck/test/test:package`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-08-01：Browser 性能观测 sdk-browser 边界实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- `@aurora/browser` 性能事实观测能力继续由 `sdk-browser` 层承载，包保持零 Aurora 本地运行时依赖、`sideEffects: false`、单一根出口；新增性能事实类型/常量/能力与 `subscribePerformance`，不增加第二子路径。
- 性能观测生产源码不导入 `@aurora/event-schema` 或 `@aurora/core`，不访问 DOM/Cookie/Storage，不读取 `PerformanceEntry` 的 `element`/`url`/`sources`/`target`，不修改 `PerformanceObserver`/`performance`/原生 prototype；`performance-source.ts` 与 `performance-source-types.ts` 均以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝。
- 验证命令：`pnpm --filter @aurora/browser typecheck/test/test:package/test:browser`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-08-01：性能插件 sdk-plugin 依赖边界实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- `@aurora/plugin-performance`（`aurora.layer: sdk-plugin`）声明 `@aurora/core`、`@aurora/browser`、`@aurora/event-schema` 三个 `workspace:*` 依赖，不依赖 plugin-error/plugin-request；反向、插件间、framework/tooling、循环、未声明依赖和跨包私有路径负例均被拒绝。
- 插件生产源码的 DOM/宿主全局、Node 运行时、模块级可变状态、宿主修改和事件控制负例均生效；`tsconfig.no-dom.json`、ESLint、包根入口和私有子路径拒绝均通过。
- 验证命令：`pnpm check:boundaries`、plugin typecheck/package 与根 `pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
