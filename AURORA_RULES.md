---
title: Aurora 项目规则与当前上下文
status: approved
owner: architecture
last-reviewed: 2026-07-30
applies-to: Aurora 仓库全部 Agent、代码、测试、文档与技术决策
related:
  - AGENTS.md
  - Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - "Aurora 架构规范.md"
  - "Aurora 代码规范.md"
  - "Aurora 测试规范.md"
  - "Aurora 文档规范.md"
  - "Aurora ADR 规范.md"
  - docs/adr/README.md
  - docs/superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - docs/superpowers/specs/2026-07-28-aurora-frontend-technology-stack-design.md
  - docs/superpowers/specs/2026-07-30-aurora-console-visual-language-design.md
  - docs/superpowers/specs/2026-07-28-aurora-foundation-topic-approval-baseline.md
  - docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md
  - docs/superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
  - docs/superpowers/specs/2026-07-29-aurora-topic-discussion-summary.md
  - docs/superpowers/specs/2026-07-29-aurora-account-deletion-data-lifecycle-design.md
  - docs/README.md
  - docs/architecture/system-overview.md
  - docs/prd/platform-product-domains.md
  - docs/security/account-deletion-and-data-lifecycle.md
  - docs/architecture/formalization-readiness.md
supersedes: none
maintenance: operational-snapshot
---

# Aurora 项目规则与当前上下文

## 1. 文件定位

本文件是 Aurora 的当前项目快照和权威文档索引，与 [AGENTS.md](AGENTS.md) 一起作为每个新会话的固定必读入口。它不取代 PRD、六份长期规范或 accepted ADR，也不重复搬运它们的正文。

读取与执行规则：

- 每次新会话完整阅读 `AGENTS.md` 和本文件；
- 再按 `AGENTS.md` 的任务触发矩阵完整阅读相关权威文档；
- approved 长期规范是正式规则，accepted ADR 是正式技术决策；
- 会话设计确认不等于 ADR accepted，也不等于实施完成；
- 发现冲突或来源不明时，停止受影响工作并回到权威文档核对。

## 2. 权威来源

| 领域 | 权威文档 | 何时读取 |
|---|---|---|
| 第一版范围与业务逻辑 | [核心业务 PRD](Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) | 产品、UX/UI、流程、权限、数据生命周期或公共行为 |
| 系统边界与依赖 | [架构规范](<Aurora 架构规范.md>) | 架构、模块、依赖、公共边界、基础设施、部署 |
| 实现与代码质量 | [代码规范](<Aurora 代码规范.md>) | 编码、重构、评审、Bug 修复、调试 |
| 测试与质量门禁 | [测试规范](<Aurora 测试规范.md>) | 测试、CI、回归、发布验证 |
| 文档治理 | [文档规范](<Aurora 文档规范.md>) | 正式文档、规则、README、API 文档、示例 |
| 技术决策治理 | [ADR 规范](<Aurora ADR 规范.md>) | ADR 判断、创建、评审、状态与长期技术选型 |
| ADR 状态 | [ADR 索引](docs/adr/README.md) | 任务涉及任何 ADR 或其影响范围 |

六份长期规范保持固定路径和 append-only 历史保护。`AGENTS.md` 与本文件是可重写的运行快照；重复细节必须留在权威来源中。

## 3. 当前项目阶段

截至 2026-07-30，Aurora 处于“第一版核心业务规则冻结、六专题设计输入均已批准或确认、正在逐模块正式化与实施就绪审查”阶段。

已具备：

- approved 核心业务 PRD；
- approved 架构、代码、测试、文档和 ADR 治理基线；
- 五大系统边界、SDK 分层、同步可靠接收与异步处理、`event-schema` 单一来源和单向依赖的 approved 架构规则；
- 已批准的管理平台前端 UX/UI、前端技术栈设计及逐项决策记录；
- 已批准的控制台视觉语言：浅色内容区、深石墨顶栏、纯色琥珀橙侧栏、深色前景、中高信息密度且禁止渐变；同方向低风险视觉细节由 Agent 直接收口并同步，业务、导航层级、权限、安全、数据和公共契约不在该授权内；
- 已批准的管理平台总体 OpenAPI 与实现约束设计：统一公开契约、内部领域模块化、生成单一 Platform OpenAPI，31 个页面设计映射 36 个稳定 Route Target，并强制壳层与真实 UI 可达性先行；
- 用户已批准前四个基础专题中可追溯的既有设计基线，批准边界和未决内容由独立正式文档记录。
- 已批准的测试/部署/发布完整设计，包括 `TD-001=A`、`TD-002=A`、`TD-003=A` 和 `TDR-DERIVED-001`；
- 已批准作为后续 ADR、正式文档、机器契约、缺口管理和实施就绪审查输入的六专题总结；它不作为实现授权。
- 已批准 A5-001—A5-011 账号注销与数据生命周期设计，并已形成长期正式安全规则；
- 已从 approved 设计形成根入口、正式文档索引以及系统、SDK、管理平台前后端、测试、部署、发布/回滚、恢复和 A5 安全的最小充分正式文档；ADR-001—007 已完成独立非作者与所需领域评审；ADR-001/003/005/006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-002、ADR-004 为 `accepted / not-started`；
- 首个私有 Monorepo 根 Workspace 与最小本地工程工具已实施；`@aurora/workspace-policy` 是首个真实内部包，`README.md` 已包含可验证的根命令入口。
- `event-schema` 协议基础第一增量已由 approved 正式规格实施为真实私有包 `@aurora/event-schema`（第二个真实内部包）；该增量覆盖包入口、版本、公共信封、受限运行时校验、稳定错误和共享契约样本；错误事件协议契约第一增量已在信封基础上增加 JavaScript 运行时错误、未处理 Promise 拒绝和资源加载错误正文、错误信封解析器与错误契约样本；请求事件协议契约第一增量已增加请求方法/结果常量、安全请求正文、请求信封解析器与请求契约样本；三者均通过新鲜验证。
- SDK Core 生命周期与插件编排基础第一增量已有[approved 正式规格](docs/sdk/sdk-core-foundation.md)和[单一模块实施计划](docs/superpowers/plans/2026-07-30-sdk-core-foundation.md)；计划已执行，`@aurora/core` 基础增量（环境无关 Core、显式生命周期、最小配置、插件注册与顺序编排、异常隔离、事件入口和多实例隔离）已实施并通过新鲜验证，ADR-003 进入 `accepted / in-progress`。
- `@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量已有[approved 正式规格](docs/sdk/browser-environment-foundation.md)和[单一模块实施计划](docs/superpowers/plans/2026-07-30-browser-environment-foundation.md)；计划已执行，`@aurora/browser` 基础增量（安全环境与能力探测、脱敏页面快照、`visibilitychange`/`pagehide`/`pageshow` 生命周期订阅、幂等释放、异常隔离和多实例隔离）已实施并通过新鲜验证（含本地 Chromium 真实浏览器门禁）；浏览器错误源订阅能力第一增量、请求观测能力第一增量与性能事实观测能力第一增量已实施并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/006 保持 `accepted / in-progress`。
- `@aurora/plugin-error` 浏览器错误采集插件第一增量已有[approved 正式规格](docs/sdk/error-capture-plugin.md)和[单一模块实施计划](docs/superpowers/plans/2026-07-31-error-capture-plugin.md)；计划已执行，`@aurora/plugin-error` 错误插件第一增量（通过公开错误源订阅 JavaScript、未处理 Promise 拒绝和资源加载错误，经 `parseErrorEventBody` 校验后以最小草稿提交 Core，同步生命周期、重入门禁、有界诊断、宿主安全与多实例隔离）已实施并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/005/006 保持 `accepted / in-progress`。
- `@aurora/plugin-request` 浏览器请求采集插件第一增量已有[approved 正式规格](docs/sdk/request-capture-plugin.md)和[单一模块实施计划](docs/superpowers/plans/2026-07-31-request-capture-plugin.md)；计划已执行，`@aurora/plugin-request` 请求插件第一增量（通过公开请求源订阅 fetch 与 XMLHttpRequest 请求事实，经 `parseRequestEventBody` 校验后以最小草稿提交 Core，同步生命周期、重入门禁、有界诊断、宿主安全与多实例隔离）已实施并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/005/006 保持 `accepted / in-progress`。

当前没有：

- 管理平台前端或正式服务端实现；
- 管理平台设计令牌代码、PrimeVue/Aurora UI 主题、真实视觉组件、截图与浏览器证据；
- 机器可读公开 API 制品、`platform-contract`、生成 Platform Client/Fastify 适配、通用资源事件正文（product scope deferred）、行为事件正文、采样算法、接入/处理机器契约（数据接入 OpenAPI、Inbox 模型已实施，处理存储仍 absent）、可执行服务端数据模型或具体事件 Schema 机器运行时；
- 已通过必要 accepted ADR、可以授权实施的管理平台后端技术栈；
- 前四个基础专题的独立完整实施规格，以及其未决工具、公共契约和基础设施选择；
- ADR-002/004 对应实现、Issue、PR、测试或性能证据；ADR-002/004 实施状态仍是 `not-started`，ADR-003/005/006 为 `in-progress`。

因此，accepted ADR 可以约束后续工作，但不得把候选框架、能力名称、`not-started` ADR 或 approved 设计当作代码已实现。当前真实内部包为 `@aurora/workspace-policy`、`@aurora/event-schema`（协议基础加错误、请求与性能事件契约第一增量）、`@aurora/core` 基础增量、`@aurora/browser`（浏览器环境、生命周期、错误源、请求观测与性能观测基础增量）、`@aurora/plugin-error` 错误插件第一增量、`@aurora/plugin-request` 请求插件第一增量、`@aurora/plugin-performance` 性能插件第一增量、`@aurora/ingestion-inbox`（写侧 + 处理侧 Repository）与 `@aurora/ingestion-credentials`（客户端凭证存储、验证与生命周期服务）；真实应用为 `apps/ingestion-api`（接入 HTTP 服务 + 真实 authorizer）、`apps/ingestion-worker`（Worker 运行时与处理器编排第一增量）；通用资源事件正文已产品决策 deferred，行为事件正文、采样算法、行为插件、其他具体采集插件、具体事件处理器、Worker retry/dead-letter policy、凭证管理 HTTP API、管理平台 UI、管理员授权、完整审计、人工重放、平台机器契约和下游模块仍不授权自动实施。

## 4. 正式化与详细设计入口

[正式文档索引](docs/README.md)维护 approved 设计到长期权威文档的唯一映射；[正式化与实施就绪追踪](docs/architecture/formalization-readiness.md)维护 ADR、机器契约和真实阻塞，不成为第二份 PRD。

管理平台 A1—D2、`NAV-A`、`AUDIT-A`、权限、Query/Command 需求、页面状态、数据口径、排除项和 GAP-01—GAP-20 的详细来源始终是[完整前端 UX/UI 设计](docs/superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md)；稳定分域见[管理平台产品业务域](docs/prd/platform-product-domains.md)；视觉令牌和直接收口边界见[控制台视觉语言设计](docs/superpowers/specs/2026-07-30-aurora-console-visual-language-design.md)；机器导航、统一公开契约和实现门禁见已批准的[总体 OpenAPI 与实现约束设计](docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)。六专题总结只作跨专题索引，不得弱化完整设计。

前端技术、后端领域/技术栈、总体机器契约结构和测试/部署/发布设计均已批准并分别进入正式架构、测试、发布与运维文档；精确版本、命令和配置是 `implementation-detail`，机器契约制品与精确领域 Schema 是 `deferred`/absent，容量/兼容/性能证据是 `requires-benchmark`，长期技术选择是 `requires-accepted-adr`。

A5-001—A5-011 已批准，长期规则见[账号注销与数据生命周期](docs/security/account-deletion-and-data-lifecycle.md)。D2 平台管理员身份/平台级审计、邮件/运营责任和 A5 之外的保留规则仍留在统一阻塞清单；按用户指令本轮不展开新的专题讨论。

有限决策清单的全部单项一旦获得用户明确批准，即按整体批准同步，不再重复请求完整方案批准；只有权威冲突或不可逆安全、隐私、数据丢失风险可以重新阻断。

仓库已有根文档入口与七个真实内部包（`@aurora/workspace-policy`、`@aurora/event-schema` 协议基础加错误、请求与性能事件契约第一增量、`@aurora/core` 基础增量、`@aurora/browser` 浏览器环境/生命周期/错误源/请求观测/性能观测基础增量、`@aurora/plugin-error` 错误采集插件第一增量、`@aurora/plugin-request` 请求采集插件第一增量、`@aurora/plugin-performance` 性能采集插件第一增量），但仍没有通用资源事件正文（product scope deferred）、行为事件正文、采样算法、服务端/平台业务代码、机器平台 API/模型、CI、IaC、云资源或部署结果。`writing-plans` 采用逐模块门禁：Monorepo、event-schema 协议基础、错误事件契约、请求事件契约、性能事件契约、SDK Core 基础、Browser 环境基础、错误源订阅、请求观测能力第一增量、性能事实观测能力第一增量、错误采集插件第一增量、请求采集插件第一增量与性能采集插件第一增量已实施；采样算法、行为等其他具体插件、框架适配、队列、传输和持久化继续 blocked。

## 5. 第一版边界摘要

第一版只聚焦：账号/组织/项目、SDK 安全接入、可靠接收与异步处理、问题定位与处理、发布/部署/Source Map、基础告警与站内通知、权限/隐私/额度/保留/删除。

第一版不包含：完整工单审批、即时通讯、Session Replay、完整行为分析、复杂责任小组与自动分配、大规模后台批处理、高级查询/动态基线/异常检测、外部通知和值班升级/SLA、收费账单、企业治理、AI 根因分析。

任何新增能力必须先在 PRD 中确认属于第一版；否则从设计和实现中移除。

## 6. 跨领域强制边界

- 系统边界为 SDK、数据接入、数据处理与存储、管理平台、公共协议；详细职责和依赖以架构规范为准。
- 管理平台只能通过公开 API 使用服务端能力，禁止直连数据库、内部消息队列或私有实现。
- `event-schema` 是公共事件类型、枚举与运行时 Schema 的唯一来源；所有外部输入视为不可信并运行时校验。
- Core 环境无关且不得依赖 Browser；Browser 可依赖 Core；插件和框架适配只能依赖公开接口。
- SDK 必须优先保护宿主页面：隔离异常、防重复初始化、限制资源、完整释放和恢复代理、保持多实例隔离。
- 默认不得采集请求/响应体、Cookie、Authorization、表单内容、密码/验证码、完整 DOM/页面文本、完整行为轨迹、控制台正文、完整 IP 或设备/浏览器指纹。
- 管理平台 UI 中每个元素必须映射明确业务规则、权限和公开 API/Command；缺少后端支撑的第一版能力登记为阻塞，非第一版能力删除。
- 统计与图表必须提供数据来源、计算口径、更新时间/水位、采样与降级影响、空值和部分结果含义。

## 7. 实施与完成门禁

开始修改前必须检查分支、`git status`、用户已有改动和更深层 `AGENTS.md`，不得覆盖或清理无关修改。

需要 ADR 的重大变化只能先形成 `proposed`；至少经过规定评审并成为 `accepted` 后才能实施。ADR 决策状态与实施状态分别记录：`accepted` 不等于 implemented，`not-started` 不等于状态冲突。

实现、测试、文档、Git 和完成声明的详细要求分别以任务触发的长期规范及 `AGENTS.md` 为准。任何完成声明必须基于新鲜验证输出和完整差异检查。

## 8. 当前 ADR 双状态

| ADR | 决策状态 | 实施状态 | 当前效力 |
|---|---|---|---|
| [ADR-001 使用统一 Monorepo](docs/adr/ADR-001-use-monorepo.md) | accepted | in-progress | 正式仓库形态决策 |
| [ADR-002 五大系统边界](docs/adr/ADR-002-five-system-boundaries.md) | accepted | not-started | 正式逻辑边界决策 |
| [ADR-003 SDK 分层插件架构](docs/adr/ADR-003-sdk-plugin-architecture.md) | accepted | in-progress | 正式 SDK 分层决策；Core 基础、Browser 环境基础、错误源订阅、请求观测能力与错误采集插件第一增量已实施，其他具体插件与传输仍未实现 |
| [ADR-004 可靠接收与异步处理](docs/adr/ADR-004-asynchronous-event-processing.md) | accepted | not-started | 正式接收/处理语义；物理缓冲未决定 |
| [ADR-005 event-schema 单一来源](docs/adr/ADR-005-event-schema-source-of-truth.md) | accepted | in-progress | 正式协议权威决策；信封基础、错误事件契约、请求事件契约与性能事件契约第一增量已实施，通用资源事件正文 deferred，机器 Schema 与行为事件正文不存在 |
| [ADR-006 单向依赖与自动约束](docs/adr/ADR-006-one-way-dependencies.md) | accepted | in-progress | 正式依赖原则；通用检查已存在，领域层级规则待真实模块 |
| [ADR-007 pnpm Workspace 与原生任务入口](docs/adr/ADR-007-workspace-package-and-task-tooling.md) | accepted | implemented | 首个工程模块工具决策；全部门禁通过 |
| [ADR-008 数据接入可靠缓冲与异步处理的物理技术](docs/adr/ADR-008-ingestion-durable-buffering.md) | accepted | in-progress | PostgreSQL 事务性 Inbox；批次/接收结果协议、数据接入 OpenAPI、Inbox 数据模型、接入 HTTP 服务、Worker 运行时与客户端凭证存储/验证已实施，具体事件处理器/Worker policy/凭证生命周期管理/容量基准未实现 |
| [ADR-009 数据接入公开传输与客户端上报密钥安全语义](docs/adr/ADR-009-ingestion-transport-and-client-credential.md) | accepted | in-progress | 数据接入 OpenAPI 前置已批准并实施：`POST /v1/batches`、`X-Aurora-Client-Key`/`X-Aurora-Environment`、Origin 匹配、CORS、HTTP 状态映射、`Retry-After`、`X-Aurora-Request-Id`、OpenAPI 3.1；机器文件与漂移门禁已实施，凭证/服务/CORS 中间件未实现 |
| [ADR-010 数据接入数据库访问与 Migration 工具链](docs/adr/ADR-010-postgresql-access-and-migration-tooling.md) | accepted | implemented | Inbox 数据模型前置已批准并实施：PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first；`@aurora/ingestion-inbox`（`event_inbox` Migration + `persistBatch`）已实施并通过真实 PostgreSQL 17.10 验证，接入服务/Worker/CI/RDS 未实现 |
| [ADR-011 数据接入同步 HTTP 服务的运行时与应用边界](docs/adr/ADR-011-ingestion-http-service-runtime.md) | accepted | in-progress | 接入 HTTP 服务已批准并实施：Fastify 5.10.0、`apps/ingestion-api`、显式 CORS adapter、`service` 层、两阶段配置、build/start Pool 所有权；`POST /v1/batches` 已通过真实 PostgreSQL 17.10 集成测试；凭证模块/Worker/CI/RDS/IaC 未实现 |
| [ADR-012 数据接入 Worker 应用的运行时与应用边界](docs/adr/ADR-012-ingestion-worker-runtime.md) | accepted | in-progress | Worker 运行时已批准并实施：Node.js 24 原生异步、`apps/ingestion-worker`、两阶段配置、build/start Pool 所有权；`buildIngestionWorker`/`startIngestionWorker` 已通过真实 PostgreSQL 17.10 并发/续租/关闭/双 Worker 集成测试；具体事件处理器/人工重放/CI/RDS/IaC 未实现 |
| [ADR-013 客户端上报凭证存储与验证](docs/adr/ADR-013-ingestion-client-credential-storage-and-verification.md) | accepted | implemented | 凭证存储与验证已批准并实施：PostgreSQL 17、SQL-first、`@aurora/ingestion-credentials`（16-byte keyId、32-byte secret、SHA-256 digest、timing-safe comparison、active/disabled/revoked、expires_at 动态失效、Origin/environment 策略快照）、`apps/ingestion-api` 真实 authorizer adapter；已通过真实 PostgreSQL 17.10 凭证与 HTTP 401/403/503 集成验证；凭证管理 HTTP API 未实现 |
| [ADR-014 客户端上报凭证生命周期服务](docs/adr/ADR-014-ingestion-client-credential-lifecycle.md) | accepted | implemented | 凭证生命周期已批准并实施：扩展 `@aurora/ingestion-credentials`（`generateClientKeyPair`/`createIngestionClientCredential`/`rotateIngestionClientCredential`/`disableIngestionClientCredential`/`enableIngestionClientCredential`/`revokeIngestionClientCredential`、`SELECT ... FOR UPDATE` 行锁、keyId 碰撞有界重试、一次性 clientKey 返回、稳定结果）；已通过真实 PostgreSQL 17.10 创建/轮换/状态/并发 rotate 集成验证；管理 HTTP API、平台 UI、管理员授权与完整审计未实现 |
| [ADR-015 Worker 重试预算与自动死信策略](docs/adr/ADR-015-ingestion-worker-retry-budget-policy.md) | accepted | implemented | Worker retry budget 已批准并实施：`apps/ingestion-worker` policy（`decideRetryDisposition` 纯函数、`maxProcessingAttempts` typed config、预算未耗尽 `scheduleRetry`/耗尽自动 `markDeadLettered{retry_budget_exhausted}`/非法 retry 不写回/processor 异常保持 leased/lease lost 不二次写回）；已通过真实 PostgreSQL 17.10 budget exhausted/dead-letter 集成验证；人工重放与退避算法未实现 |

## 9. 待决策队列

决策按当前阻塞和恢复顺序推进：

1. “私有 Monorepo 根 Workspace 与最小本地工程工具”的[模块实施计划](docs/superpowers/plans/2026-07-29-monorepo-foundation.md)已执行并经新鲜验证核验；`@aurora/workspace-policy` 是首个真实内部包；
2. `event-schema` 协议基础第一增量的[正式规格](docs/protocol/event-schema-foundation.md)与[实施计划](docs/superpowers/plans/2026-07-30-event-schema-foundation.md)已执行完毕并通过新鲜验证；`@aurora/event-schema` 是第二个真实内部包；错误事件协议契约第一增量的[正式规格](docs/protocol/error-event-contract.md)与[实施计划](docs/superpowers/plans/2026-07-30-error-event-contract.md)已执行完毕，JavaScript/Promise/资源加载错误正文与错误信封/样本存在；请求事件协议契约第一增量的[正式规格](docs/protocol/request-event-contract.md)与[实施计划](docs/superpowers/plans/2026-07-31-request-event-contract.md)已执行完毕，请求方法/结果常量、安全请求正文、请求信封解析器与请求契约样本存在；性能事件协议契约第一增量的[正式规格](docs/protocol/performance-event-contract.md)与[实施计划](docs/superpowers/plans/2026-07-31-performance-event-contract.md)已执行完毕，PRD 5.1.9 批准的 LCP/INP/CLS/页面加载耗时指标、性能正文解析器与性能契约样本存在；ADR-005 为 `in-progress`；
3. SDK Core 生命周期与插件编排基础第一增量已实施为 `@aurora/core` 并通过新鲜验证，ADR-003 进入 `accepted / in-progress`；`@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量已实施为 `@aurora/browser` 并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/006 保持 `accepted / in-progress`；`@aurora/plugin-error` 浏览器错误采集插件第一增量已实施为 `@aurora/plugin-error` 并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/005/006 保持 `accepted / in-progress`；`@aurora/browser` 请求观测能力第一增量已实施并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/005/006 保持 `accepted / in-progress`；`@aurora/plugin-request` 浏览器请求采集插件第一增量已实施为 `@aurora/plugin-request` 并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/005/006 保持 `accepted / in-progress`；`@aurora/browser` 性能事实观测能力第一增量已实施并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/005/006 保持 `accepted / in-progress`；`@aurora/plugin-performance` 性能采集插件第一增量已实施为 `@aurora/plugin-performance` 并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/005/006 保持 `accepted / in-progress`；采样算法、行为等其他具体事件正文 Schema 与采集插件、框架适配、其余 SDK、服务端、平台、CI、发布与 AWS/IaC 按各自直接前置逐模块审查，不自动开始；
4. 管理平台总体 OpenAPI 与实现约束设计已批准；机器 Platform OpenAPI、`platform-contract`、生成 Client/适配、平台模型和前后端实现仍 blocked，不自动进入 planning 或实现；
5. 数据接入批次与接收结果协议第一增量已实施；数据接入 OpenAPI 机器契约第一增量（ADR-008 后续依赖链第 2 项）已实施：其公开传输与客户端凭证语义已由 [ADR-009](docs/adr/ADR-009-ingestion-transport-and-client-credential.md)（accepted / in-progress）批准，机器文件 `docs/api/ingestion.openapi.yaml`（OpenAPI 3.1，`POST /v1/batches`、`apiKey` + `X-Aurora-Client-Key`、`X-Aurora-Environment`、Origin/CORS/状态码映射/`Retry-After`/`X-Aurora-Request-Id`）与 `tooling/ingestion-openapi-contract` 漂移门禁（40 测试）已实施；Inbox 数据模型（依赖链第 3 项）的数据库工具链已由 [ADR-010](docs/adr/ADR-010-postgresql-access-and-migration-tooling.md)（accepted / implemented）批准并实施：正式规格 [ingestion-inbox-data-model.md](docs/architecture/ingestion-inbox-data-model.md)（implemented）、`@aurora/ingestion-inbox`（`event_inbox` Migration + `persistBatch` Repository + 状态/租约 helper）已通过真实 PostgreSQL 17.10 集成测试（21 个）；接入服务（第 4 项）已由 [ADR-011](docs/adr/ADR-011-ingestion-http-service-runtime.md)（accepted / in-progress）批准并实施为 `apps/ingestion-api`（Fastify 5.10.0、`POST /v1/batches`、显式 CORS adapter），已通过真实 PostgreSQL 17.10 集成测试；Worker 运行时（第 5 项）已由 [ADR-012](docs/adr/ADR-012-ingestion-worker-runtime.md)（accepted / in-progress）批准并实施为 `apps/ingestion-worker`（Node.js 24 原生异步、`buildIngestionWorker`/`startIngestionWorker`、claim 循环/并发上限/lease 续期/graceful shutdown），已通过真实 PostgreSQL 17.10 并发/续租/关闭/双 Worker 集成测试；具体事件处理器、Worker retry/dead-letter policy、人工重放继续 blocked；容量基准（第 6 项）和凭证数据模型继续按 ADR-008 后续依赖链推进；
6. 按[无编号候选队列](docs/architecture/formalization-readiness.md#7-新-adr-候选队列)只为直接阻塞模块的长期决定建立独立提案，不进入 D2 或其他新 brainstorming。

每项未决内容都必须保持明确状态和恢复入口。优先决定当前专题下一项和即将形成实施阻塞的事项；不能把“尽快决策”解释为跳过业务推导、评审或 ADR 门禁。

## 10. 状态同步与长度约束

当 approved 规则、accepted ADR、已批准产品决定或已确认设计决定改变项目阶段、实施门禁或决策顺序时，必须在同一变更中同步本文件和 `AGENTS.md` 的当前状态与待决策队列。

本文件最多 260 行且不超过 36 KiB。超限或出现 PRD/规范正文重复时，必须把细节留在权威文档，只保留链接、状态和可执行门禁。入口重写历史由 Git 保存；六份长期规范仍按 append-only 方式维护。
