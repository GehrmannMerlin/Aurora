---
title: ADR-005：将 event-schema 作为公共协议单一来源
status: accepted
implementation-status: in-progress
owner: protocol
date: 2026-07-27
last-reviewed: 2026-07-30
applies-to: Aurora SDK、数据接入、数据处理、查询和管理平台
related:
  - ../../AURORA_RULES.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 测试规范.md'
  - ../architecture/system-overview.md
  - ../architecture/sdk-architecture.md
  - ../testing/test-strategy.md
supersedes: none
superseded-by: none
---

# ADR-005：将 event-schema 作为公共协议单一来源

## 元数据

- 状态：accepted
- 日期：2026-07-27
- Owner：protocol
- 适用范围：事件结构、上报批次、枚举、协议版本、运行时校验和兼容转换
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联技术方案：[Aurora 架构规范](<../../Aurora 架构规范.md>)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none
- 实施状态：in-progress
- 评审状态：非作者及所需领域评审已通过

## 背景

SDK 生成事件，接入层校验事件，处理层消费事件，管理平台展示查询结果。如果各端独立维护 TypeScript 类型、校验逻辑和枚举，协议含义会漂移，非法数据可能进入系统，升级时也难以判断兼容性。

## 决策驱动因素

- 浏览器输入必须视为不可信；
- SDK、接入和处理需要相同事件含义；
- TypeScript 类型不能提供运行时校验；
- 协议版本和兼容策略需要单一来源；
- 契约样本必须复用；
- 协议包不能包含采集、网络、数据库或页面业务。

## 候选方案

### 方案 A：独立 event-schema 包作为单一来源

在 packages/event-schema 中集中 TypeScript 类型、运行时 Schema、枚举、版本、限制、兼容转换和契约样本。

优点：

- 编译期和运行时规则一致；
- SDK、接入和处理复用同一来源；
- 协议变更可以原子测试；
- 字段限制和版本拒绝行为明确；
- 可从 Schema 生成部分协议文档。

缺点：

- 包发布和版本兼容需要治理；
- Schema 库可能增加 SDK 体积；
- 业务含义和隐私说明仍需人工文档；
- 不当设计会把业务逻辑塞入协议包。

### 方案 B：各端独立定义类型和校验

SDK、服务端和平台分别维护最适合自身的模型，通过文档约定一致。

优点：

- 每端实现自由；
- 不共享运行时依赖；
- 局部修改速度快。

缺点：

- 类型和校验容易漂移；
- 文档难以证明与实现一致；
- 契约样本重复；
- 兼容性问题往往在生产发现；
- 服务端可能错误信任 TypeScript 类型。

### 方案 C：服务端协议为唯一来源，生成 SDK 类型

服务端维护 Schema，通过代码生成向 SDK 和平台发布类型。

优点：

- 服务端校验权威；
- SDK 可以只携带生成后的轻量类型；
- 生成流程可避免手工复制。

缺点：

- SDK 生成和服务端发布强耦合；
- 运行时 Schema 仍可能无法在 SDK 复用；
- 多语言和构建工具链更复杂；
- Monorepo 中引入额外生成顺序而收益有限。

## 最终决策

决定选择方案 A：独立 event-schema 包作为事件协议唯一来源。

协议包必须保持纯粹，只包含协议和无业务副作用的兼容能力。本决策不定义机器字段、运行时 Schema 库、版本窗口或包体实现。

## 结果与影响

### 正面影响

- 事件结构、版本和限制一致；
- 外部输入有统一运行时校验；
- 共享契约测试可以覆盖生产者和消费者；
- 兼容变更更容易判断；
- 协议文档可部分自动生成。

### 负面影响与代价

- 需要控制 SDK 引入的运行时体积；
- Schema 变更会影响多个系统；
- 包版本和旧协议支持需要长期维护；
- 仍需人工解释业务语义、隐私和失败行为。

### 未解决问题

- 具体运行时 Schema 库；
- SDK 使用完整 Schema 还是轻量校验器；
- 协议版本编号和支持期限；
- 文档生成工具。

## 实施约束

- event-schema 不依赖任何业务模块；
- 包内不得包含采集、发送、数据库或页面逻辑；
- SDK 事件类型和枚举从该包导入；
- 接入层对所有外部数据执行运行时校验；
- 处理层只消费通过支持版本校验的数据；
- 字符串、数组、对象深度、时间戳和禁止字段有明确限制；
- SDK、接入和处理共享合法与非法样本；
- 未知事件和不支持版本明确拒绝；
- 协议文档与 Schema 不一致时立即修复，不能长期双轨。
- 数据库模型、查询 DTO 和内部消息不得反向成为事件协议权威来源。

## 迁移方案

ADR accepted 后先定义基础事件、协议版本和批次结构，再建立合法、非法和边界样本。SDK、接入和处理逐个改用公共包，删除重复类型前先通过契约测试证明行为一致。

## 回滚方案

公共协议发布前可以撤回提案并选择生成方案。发布后若替换协议来源，必须保留旧版本解析、提供兼容转换和迁移计划，不能直接删除旧字段或版本。

## 验证方式

- 包依赖图证明 event-schema 无业务依赖；
- SDK 生成事件通过同一运行时 Schema；
- 接入使用同一 Schema 拒绝非法输入；
- 处理层正确读取所有合法样本；
- 契约测试覆盖缺字段、错类型、非法枚举、超限、非法时间和版本；
- 文档字段表与 Schema 自动对比；
- SDK 包体积检查证明引入成本可接受。

## 重新评估条件

- Schema 运行时体积超过 SDK 预算；
- 需要支持非 TypeScript 生产者或消费者；
- 协议生成工具成熟并显著降低成本；
- 多版本兼容无法在单包中维护；
- 协议变更频率导致发布耦合不可接受。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-07-29：正式化复审输入

- 状态保持 `proposed / not-started`；当前不存在机器可读事件 Schema、公共事件包或契约测试样本；
- 背景输入补充：[系统架构与模块边界](../architecture/system-overview.md)将公共协议定义为独立系统，[SDK 架构](../architecture/sdk-architecture.md)要求所有插件输出进入同一标准事件管道，[测试策略](../testing/test-strategy.md)要求 SDK、接入与消费者使用相同契约样本；
- 候选方案复审：方案 A 继续作为提案；方案 B 保留重复权威来源，方案 C 会让 SDK 公共能力被服务端私有模型支配。运行时校验库、JSON Schema 生成方式和文档生成器属于 `implementation-detail` 或独立工程选择，不由本 ADR决定；
- 实施约束补充：公共事件类型、枚举、运行时校验和兼容规则必须从同一机器来源产生；外部输入按不可信数据校验；数据库模型、查询 DTO 和内部消息不得反向成为事件协议；
- 验证输入补充：正式审批应核对 SDK→接入→消费者共享样本、未知字段/枚举、版本兼容、批量与压缩边界、敏感字段拒绝和旧消费者兼容；字段清单与精确上限必须在协议正式化时给出，当前不得编造；
- 进入 `accepted` 前仍需非作者、SDK、接入、处理、安全/隐私和兼容性领域评审；ADR 接受后仍须单独创建并评审机器 `event-schema`。

### 2026-07-29：接受决策

- 决策状态更新为 `accepted`，实施状态保持 `not-started`；
- 独立非作者评审由隔离审查上下文 `adr_004_006_review` 完成，覆盖 protocol、SDK、ingestion、processing、security/privacy 和 compatibility 视角；
- 评审确认独立单一来源、各端重复定义和服务端生成三项候选真实，与 ADR-003、ADR-004 和 ADR-006 无冲突；
- 数据库模型、查询 DTO 和内部消息不得反向成为事件协议权威；
- 当前没有机器 Schema、公共包、契约样本、Issue、实现 PR 或包体测试结果，本次接受不得解释为 `event-schema` 已创建。

### 2026-07-30：协议基础第一增量实施证据

- 实施状态更新为 `in-progress`；本记录只覆盖[协议基础第一增量](../protocol/event-schema-foundation.md)，不覆盖完整事件类型、批次、兼容转换或真实消费者；
- 决策状态保持 `accepted`，最终决策不变；完整 `event-schema` 进入 `implemented` 仍需具体事件正文、批次/接收协议、兼容转换和 SDK/接入/处理真实消费者。
- 实施 Commit：none（未提交）
- 实施范围：`packages/event-schema` 为唯一新增模块，私有、零运行时依赖、`aurora.layer: protocol`；公共根入口 `@aurora/event-schema` 与契约测试入口 `@aurora/event-schema/contract-testkit`。
- 公共出口：`CURRENT_PROTOCOL_VERSION`（字面量 `1`）、`SUPPORTED_PROTOCOL_VERSIONS`、`ProtocolVersion`、`isSupportedProtocolVersion`、`EVENT_SCHEMA_LIMITS`、`EventType` 值/类型对、`isEventType`、`parseEventEnvelope`、`EventEnvelope`、`EventEnvelopeParseResult`、`EventEnvelopeParseSuccess`、`EventSchemaIssue`、`EventSchemaIssueCode`、`EventEnvelopeParseFailure`；`body` 保持 `unknown`，未引入任何具体事件正文字段。
- 验证命令与结果（新鲜运行，环境 Node.js v24.18.0、pnpm 11.17.0、TypeScript 6.0.3、Vitest 4.1.10）：
  - `pnpm install --frozen-lockfile`: 通过（exit 0，锁文件未改变）
  - `pnpm format:check`: 通过（exit 0）
  - `pnpm lint`: 通过（exit 0）
  - `pnpm typecheck`: 通过（exit 0，`@aurora/workspace-policy` 与 `@aurora/event-schema` 均 Done）
  - `pnpm test`: 通过（exit 0；`@aurora/event-schema` 41 个测试 / 7 个文件，`@aurora/workspace-policy` 21 个测试 / 6 个文件）
  - `pnpm test:coverage`: 通过（exit 0；语句 96.5% 138/143、分支 93.1% 81/87、函数 100% 20/20、行 99.23% 130/131；门槛 85/80/85/85 全部满足）
  - `pnpm check:boundaries`: 通过（exit 0，真实仓库无违规）
  - `pnpm build`: 通过（exit 0，仅产出 `packages/event-schema/dist/` 与 `tooling/workspace-policy/dist/`）
  - `pnpm --filter @aurora/event-schema test:package`: 通过（exit 0，3 个测试；根入口与 `contract-testkit` 入口加载，`src`、`internal`、未导出子路径均以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝）
  - `pnpm check:ci`: 通过（exit 0）
  - `git diff --check`: 通过（exit 0）
- 契约证据：合法样本 6 条、非法样本 15 条、边界/兼容样本 9 条由 `@aurora/event-schema/contract-testkit` 唯一导出；SDK/接入/处理三组消费者测试共用同一公开样本源；README 与协议文档中的 4 个 JSON 示例由 `documentation-contract.test.ts` 提取并通过 `parseEventEnvelope` 验证。
- 证据路径：`packages/event-schema/`（src/、test/、README.md、package.json、tsconfig.json、tsconfig.build.json、vitest.config.ts）、`docs/protocol/event-envelope-v1.md`、`tooling/workspace-policy/src/graph.ts`、`tooling/workspace-policy/src/types.ts`、`tooling/workspace-policy/test/dependency-policy.test.ts`、`tooling/workspace-policy/test/event-schema-package-contract.test.ts`
- Issue/PR：none
- 性能结果：不存在（包体与运行时性能基准属于后续 SDK/接入模块）
- 剩余工作：具体错误/请求/性能/资源事件正文、上报批次与接收协议、历史版本兼容转换、SDK/接入/处理真实消费者及包体基准均不存在，继续阻塞各自下游模块。

### 2026-07-30：首个真实 SDK 消费者证据

- 实施状态保持 `in-progress`；`@aurora/core` 成为首个真实 SDK 消费者，只通过 `@aurora/event-schema` 根公开出口调用 `parseEventEnvelope(input: unknown)` 并复用公共 `EventSchemaIssue` 类型；Core 未复制协议字段或定义具体事件正文。
- 消费方式：`packages/core/src/event-entry.ts` 从 `@aurora/event-schema` 根入口导入值 `parseEventEnvelope` 与类型 `EventSchemaIssue`；`submitEvent(input: unknown)` 在 `started` 状态调用解析器，成功返回 `accepted`，失败返回冻结的 `invalid_event` 并携带冻结 issue 副本，解析器意外抛出返回 `internal_error`；Core 不修改、保存、广播、采样、排队、批处理、发送或持久化事件。
- 测试证据：`packages/core/test/event-entry.test.ts` 通过 `@aurora/event-schema/contract-testkit` 共享合法样本断言 `accepted`，并断言 `{ protocolVersion: 2 }` 返回 `invalid_event` 且 issue 包含 `unsupported_protocol_version`；合法样本与非法样本与协议包同一公开来源。
- 验证命令与结果：`pnpm --filter @aurora/core test` 通过（exit 0，58 个测试）、`pnpm --filter @aurora/core test:coverage` 通过（exit 0，语句 97.5%、分支 96.63%、函数 98.03%、行 98.64%）、`pnpm check:boundaries` 通过（exit 0，`sdk-core → protocol` 允许，无私有深导入）、`pnpm check:ci` 通过（exit 0）。
- 实施 Commit：none（未提交）
- Issue/PR：none
- 剩余工作：具体事件正文 Schema、批次/接收协议、兼容转换和接入/处理真实消费者仍不存在，ADR 保持 `in-progress`。

### 2026-07-31：错误事件协议契约第一增量实施证据

- 实施状态保持 `in-progress`；本记录覆盖[错误事件协议契约第一增量](../protocol/error-event-contract.md)，在协议基础第一增量之上增加 JavaScript 运行时错误、未处理 Promise 拒绝和资源加载错误的精确正文、错误信封解析器与错误契约样本；决策状态保持 `accepted`，最终决策不变。
- 实施 Commit：none（未提交）
- 实施范围：仅扩展 `packages/event-schema`，私有、零运行时依赖、`aurora.layer: protocol`；公共根入口与 `contract-testkit` 入口保持不变，未创建第二套信封或协议版本来源。
- 新增源文件：`src/error-event-types.ts`（常量、限制、正文/原因/资源/信封/结果类型）、`src/error-event-validation.ts`（字段读取、允许列表、有界字符串、issue 辅助）、`src/error-descriptor.ts`、`src/javascript-error-event.ts`、`src/promise-rejection-error-event.ts`（含 `copySafeErrorValue` 有界深复制）、`src/resource-error-event.ts`（URL 查询/片段移除与安全 authority 校验）、`src/error-event-body.ts`（`parseErrorEventBody` 类别分发）、`src/error-event-envelope.ts`（`parseErrorEventEnvelope` 复用 `parseEventEnvelope`）、`src/contract-testkit/{valid,invalid,boundary}-error-event-samples.ts`。
- 公共根出口新增：`ErrorCategory`、`PromiseRejectionReasonKind`、`ErrorResourceType`、`ERROR_EVENT_LIMITS`、`parseErrorEventBody`、`parseErrorEventEnvelope` 及全部错误正文/原因/资源/信封/结果类型；`EventSchemaIssueCode` 追加 `string_empty`、`invalid_url`、`event_type_mismatch`；`parseEventEnvelope` 签名与 `EventEnvelope.body: unknown` 未变。
- `contract-testkit` 新增：`validErrorEventSamples`（6 条）、`invalidErrorEventSamples`（11 条）、`boundaryErrorEventSamples`（11 条）及对应样本类型；既有信封样本保持不变。
- 隐私与边界：资源 URL 移除全部查询参数与片段；Promise 非标准值复用 `EVENT_SCHEMA_LIMITS`（字符串 4096、数组 100、对象键 100、根深度 0/最大深度 8、issue 50）并递归复制，循环/超深/超大/非 JSON/禁止字段（含 `token`/`accessToken`/`refreshToken` 归一化）均返回稳定 issue；issue 不回显输入值；解析器不修改输入，成功结果全部新建。
- 验证命令与结果（新鲜运行，环境 Node.js v24.18.0、pnpm 11.17.0、TypeScript 6.0.3、Vitest 4.1.10）：
  - `pnpm --filter @aurora/event-schema test`: 通过（exit 0；16 个测试文件 / 102 个测试）
  - `pnpm --filter @aurora/event-schema test:coverage`: 通过（exit 0；语句 93.09% 364/391、分支 88.75% 221/249、函数 100% 51/51、行 95.77% 340/355；门槛 85/80/85/85 全部满足）
  - `pnpm --filter @aurora/event-schema typecheck`: 通过（exit 0）
  - `pnpm --filter @aurora/event-schema test:package`: 通过（exit 0，3 个测试；根入口与 `contract-testkit` 入口加载，`error-event-body`、`error-event-envelope`、`resource-error-event` 等私有路径以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝）
  - `pnpm --filter @aurora/event-schema exec vitest run test/architecture-boundary.test.ts`: 通过（exit 0，3 个测试；零运行时依赖、仅两个公共入口、ES-only 构建、源码无 DOM/Node/console/消费者/私有跨包引用）
  - `pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts test/dependency-policy.test.ts test/event-schema-package-contract.test.ts`: 通过（exit 0，57 个测试；协议源码 DOM/Node 运行时负例与纯协议正例均生效）
  - `pnpm check:boundaries`: 通过（exit 0，真实仓库无违规）
- 消费者契约证据：SDK、接入、处理三类消费者测试共用同一公开样本源；README 与 `docs/protocol/error-event-contract.md` 中的 4 个错误 JSON 示例由 `documentation-contract.test.ts` 提取并通过 `parseErrorEventEnvelope` 验证（合法 2 条成功，非法 2 条返回 `invalid_url`）。
- Issue/PR：none
- 性能结果：不存在（包体与运行时性能基准属于后续 SDK/接入模块）
- 剩余工作：请求、性能、通用资源、行为事件正文、上报批次与接收协议、历史版本兼容转换、SDK/接入/处理真实消费者及包体基准均不存在，继续阻塞各自下游模块；`packages/plugin-error` 不在本增量内。

### 2026-07-31：错误插件真实协议消费者证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- `@aurora/plugin-error` 只从 `@aurora/event-schema` 根入口导入错误常量、限制、类型、`EventType` 与 `parseErrorEventBody`；没有复制错误正文、URL 校验、Promise 有界复制、协议版本或 EventEnvelope。
- 三类 Browser 事实全部在提交 Core 草稿前通过公共错误正文解析器；schema 拒绝不提交且不泄露 issue 输入。
- 包入口、私有路径、契约单测、覆盖率和 Chromium 公共解析证据全部通过；精确命令与结果记录于错误插件正式规格的实施证据。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-07-31：请求事件协议契约第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录覆盖[请求事件协议契约第一增量](../protocol/request-event-contract.md)。
- `@aurora/event-schema` 根入口新增 `RequestMethod`、`RequestOutcome`、`REQUEST_EVENT_LIMITS`、`parseRequestEventBody`、`parseRequestEventEnvelope` 与请求正文/信封类型；`contract-testkit` 新增 `valid/invalid/boundaryRequestEventSamples`。
- 请求正文为精确六字段允许列表（`method`、`url`、`startedAt`、`durationMs`、`outcome`、可选 `statusCode`）；URL 移除全部查询参数与片段；允许来源、同源、跨域、路径归一化判断没有进入协议层。
- 中立 `field-validation.ts` 与 `safe-url.ts` 被错误契约与请求契约共享；错误契约全部既有测试保持通过，`error-event-validation.ts` 与 `resource-error-event.ts` 只改为复用助手。
- 验证命令：`pnpm --filter @aurora/event-schema typecheck/test/test:coverage/test:package`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-07-31：请求插件真实协议消费者证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- `@aurora/plugin-request` 只从 `@aurora/event-schema` 根入口导入请求常量、限制、类型、`EventType` 与 `parseRequestEventBody`；没有复制请求正文、URL 校验、协议版本或 EventEnvelope。
- 全部 Browser 请求事实在提交 Core 草稿前通过公共请求正文解析器；schema 拒绝不提交且不泄露 issue 输入。
- 包入口、私有路径、契约单测、覆盖率和 Chromium 公共解析证据全部通过。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-07-31：性能事件协议契约第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录覆盖[性能事件协议契约第一增量](../protocol/performance-event-contract.md)。
- `@aurora/event-schema` 根入口新增 `PerformanceMetricCategory`、`PerformanceMetricName`、`PerformanceMetricUnit`、`PERFORMANCE_EVENT_LIMITS`、`parsePerformanceEventBody`、`parsePerformanceEventEnvelope` 与性能正文/信封类型；`contract-testkit` 新增 `valid/invalid/boundaryPerformanceEventSamples`。
- 性能正文为精确六字段允许列表（`metricCategory`、`metricName`、`value`、`unit`、`startedAt`、可选 `durationMs`）；指标范围严格限定为 PRD 5.1.9 批准的 LCP、INP、CLS、页面加载耗时；`PerformanceObserver`/`performance.*`/采样不进入协议层。
- 中立 `field-validation.ts` 与 `value-boundaries.ts` 继续被错误/请求/性能契约共享；错误与请求契约全部既有测试保持通过。
- 验证命令：`pnpm --filter @aurora/event-schema typecheck/test/test:coverage/test:package`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-08-01：性能插件真实协议消费者证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- `@aurora/plugin-performance` 只从 `@aurora/event-schema` 根入口导入性能常量、限制、类型、`EventType` 与 `parsePerformanceEventBody`；没有复制性能正文、指标枚举、协议版本或 EventEnvelope。
- 全部 Browser 性能事实在提交 Core 草稿前通过公共性能正文解析器；schema 拒绝不提交且不泄露 issue 输入。
- 包入口、私有路径、契约单测、覆盖率和 Chromium 公共解析证据全部通过。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-08-01：数据接入批次与接收结果协议第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录覆盖[数据接入批次与接收结果协议第一增量](../protocol/ingestion-batch-and-receipt-contract.md)。
- `@aurora/event-schema` 根入口新增 `BATCH_EVENT_LIMITS`、`IngestionReceiptState`、`IngestionErrorCode`、`parseIngestionBatchRequest`、`parseIngestionRequestReceipt`、`parseIngestionEventReceipt` 与批次/接收结果类型；`contract-testkit` 新增 `valid/invalid/boundaryIngestionBatchRequestSamples` 与 `valid/invalid/boundaryIngestionRequestReceiptSamples`。
- 批次请求正文为精确三字段允许列表（`protocolVersion`、`events`、可选 `receivedAt`）；接收结果状态为 `accepted`/`duplicate_accepted`/`permanently_rejected`/`temporarily_failed`；稳定错误码覆盖协议版本、Schema、字段超限、禁止字段、事件类型、项目/来源永久不允许、服务暂时不可用、限流和容量保护。
- "已可靠接收"严格对应 accepted ADR-008 的 `event_inbox` 事务提交成功；本协议层不实现 Inbox 写入、数据库、OpenAPI、采样、限流、队列或 Worker。
- 中立 `field-validation.ts` 与 `parseEventEnvelope` 被继续复用；错误/请求/性能契约全部既有测试保持通过。
- 验证命令：`pnpm --filter @aurora/event-schema typecheck/test/test:coverage/test:package`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none

### 2026-08-01：数据接入 OpenAPI 映射 event-schema 真实证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录覆盖[数据接入 OpenAPI 机器契约第一增量](../api/ingestion-openapi.md)作为 `@aurora/event-schema` 批次/接收结果协议的 HTTP 传输投影。
- `docs/api/ingestion.openapi.yaml`（OpenAPI 3.1.0）的 `components.schemas` 全部映射 event-schema：`IngestionBatchRequest`（`const: 1`、`events.maxItems: 50`）、`EventEnvelope`（`eventId.maxLength: 128`）、`IngestionReceiptState`（四值枚举）、`IngestionErrorCode`（十三值枚举）、`IngestionRequestReceipt`/`IngestionEventReceipt`（`retryAfterMs.maximum: 86400000`）。
- OpenAPI 不建立第二套状态/错误码/限制；"已可靠接收"仍严格对应 ADR-008 Inbox 事务提交成功；OpenAPI 层不实现 Inbox 写入、数据库、采样、限流、队列或 Worker。
- 漂移门禁 `tooling/ingestion-openapi-contract` 从 `@aurora/event-schema` 根与 `contract-testkit` 消费常量、枚举、类型与样本，40 个漂移测试自动比对枚举/required/限制/合法/非法/边界样本/`retryable`/`retryAfterMs`/安全；`@aurora/event-schema` 公共 API 未被修改。
- 验证命令：`pnpm openapi:lint`、`pnpm --filter @aurora/ingestion-openapi-contract test/typecheck/build`、`pnpm check:boundaries`、`pnpm lint`，全部 exit 0。
- 实施 Commit：none（未提交）
- Issue/PR：none
