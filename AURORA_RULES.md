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
- `event-schema` 协议基础第一增量已由 approved 正式规格实施为真实私有包 `@aurora/event-schema`（第二个真实内部包）；该增量只覆盖包入口、版本、公共信封、受限运行时校验、稳定错误和共享契约样本，并通过新鲜验证。
- SDK Core 生命周期与插件编排基础第一增量已有[approved 正式规格](docs/sdk/sdk-core-foundation.md)和[单一模块实施计划](docs/superpowers/plans/2026-07-30-sdk-core-foundation.md)；计划已执行，`@aurora/core` 基础增量（环境无关 Core、显式生命周期、最小配置、插件注册与顺序编排、异常隔离、事件入口和多实例隔离）已实施并通过新鲜验证，ADR-003 进入 `accepted / in-progress`。
- `@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量已有[approved 正式规格](docs/sdk/browser-environment-foundation.md)和[单一模块实施计划](docs/superpowers/plans/2026-07-30-browser-environment-foundation.md)；计划已执行，`@aurora/browser` 基础增量（安全环境与能力探测、脱敏页面快照、`visibilitychange`/`pagehide`/`pageshow` 生命周期订阅、幂等释放、异常隔离和多实例隔离）已实施并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/006 保持 `accepted / in-progress`。

当前没有：

- 管理平台前端或正式服务端实现；
- 管理平台设计令牌代码、PrimeVue/Aurora UI 主题、真实视觉组件、截图与浏览器证据；
- 机器可读公开 API 制品、`platform-contract`、生成 Platform Client/Fastify 适配、具体事件正文、批次/接收协议、可执行服务端数据模型或具体事件 Schema 机器运行时；
- 已通过必要 accepted ADR、可以授权实施的管理平台后端技术栈；
- 前四个基础专题的独立完整实施规格，以及其未决工具、公共契约和基础设施选择；
- ADR-002/004 对应实现、Issue、PR、测试或性能证据；ADR-002/004 实施状态仍是 `not-started`，ADR-003/005/006 为 `in-progress`。

因此，accepted ADR 可以约束后续工作，但不得把候选框架、能力名称、`not-started` ADR 或 approved 设计当作代码已实现。当前真实内部包为 `@aurora/workspace-policy`、`@aurora/event-schema` 协议基础增量、`@aurora/core` 基础增量与 `@aurora/browser` 基础增量；具体事件正文、具体采集插件、平台机器契约和下游模块仍不授权自动实施。

## 4. 正式化与详细设计入口

[正式文档索引](docs/README.md)维护 approved 设计到长期权威文档的唯一映射；[正式化与实施就绪追踪](docs/architecture/formalization-readiness.md)维护 ADR、机器契约和真实阻塞，不成为第二份 PRD。

管理平台 A1—D2、`NAV-A`、`AUDIT-A`、权限、Query/Command 需求、页面状态、数据口径、排除项和 GAP-01—GAP-20 的详细来源始终是[完整前端 UX/UI 设计](docs/superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md)；稳定分域见[管理平台产品业务域](docs/prd/platform-product-domains.md)；视觉令牌和直接收口边界见[控制台视觉语言设计](docs/superpowers/specs/2026-07-30-aurora-console-visual-language-design.md)；机器导航、统一公开契约和实现门禁见已批准的[总体 OpenAPI 与实现约束设计](docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)。六专题总结只作跨专题索引，不得弱化完整设计。

前端技术、后端领域/技术栈、总体机器契约结构和测试/部署/发布设计均已批准并分别进入正式架构、测试、发布与运维文档；精确版本、命令和配置是 `implementation-detail`，机器契约制品与精确领域 Schema 是 `deferred`/absent，容量/兼容/性能证据是 `requires-benchmark`，长期技术选择是 `requires-accepted-adr`。

A5-001—A5-011 已批准，长期规则见[账号注销与数据生命周期](docs/security/account-deletion-and-data-lifecycle.md)。D2 平台管理员身份/平台级审计、邮件/运营责任和 A5 之外的保留规则仍留在统一阻塞清单；按用户指令本轮不展开新的专题讨论。

有限决策清单的全部单项一旦获得用户明确批准，即按整体批准同步，不再重复请求完整方案批准；只有权威冲突或不可逆安全、隐私、数据丢失风险可以重新阻断。

仓库已有根文档入口与四个真实内部包（`@aurora/workspace-policy`、`@aurora/event-schema` 协议基础增量、`@aurora/core` 基础增量、`@aurora/browser` 基础增量），但仍没有具体事件正文、服务端/平台业务代码、机器平台 API/模型、CI、IaC、云资源或部署结果。`writing-plans` 采用逐模块门禁：Monorepo、event-schema 协议基础、SDK Core 基础与 Browser 环境基础第一增量已实施；其他模块继续 blocked。

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
| [ADR-003 SDK 分层插件架构](docs/adr/ADR-003-sdk-plugin-architecture.md) | accepted | in-progress | 正式 SDK 分层决策；Core 基础与 Browser 环境基础第一增量已实施，具体插件与传输仍未实现 |
| [ADR-004 可靠接收与异步处理](docs/adr/ADR-004-asynchronous-event-processing.md) | accepted | not-started | 正式接收/处理语义；物理缓冲未决定 |
| [ADR-005 event-schema 单一来源](docs/adr/ADR-005-event-schema-source-of-truth.md) | accepted | in-progress | 正式协议权威决策；信封基础已实施，机器 Schema 与具体事件正文不存在 |
| [ADR-006 单向依赖与自动约束](docs/adr/ADR-006-one-way-dependencies.md) | accepted | in-progress | 正式依赖原则；通用检查已存在，领域层级规则待真实模块 |
| [ADR-007 pnpm Workspace 与原生任务入口](docs/adr/ADR-007-workspace-package-and-task-tooling.md) | accepted | implemented | 首个工程模块工具决策；全部门禁通过 |

## 9. 待决策队列

决策按当前阻塞和恢复顺序推进：

1. “私有 Monorepo 根 Workspace 与最小本地工程工具”的[模块实施计划](docs/superpowers/plans/2026-07-29-monorepo-foundation.md)已执行并经新鲜验证核验；`@aurora/workspace-policy` 是首个真实内部包；
2. `event-schema` 协议基础第一增量的[正式规格](docs/protocol/event-schema-foundation.md)与[实施计划](docs/superpowers/plans/2026-07-30-event-schema-foundation.md)已执行完毕并通过新鲜验证；`@aurora/event-schema` 是第二个真实内部包，仅信封基础存在，ADR-005 为 `in-progress`；
3. SDK Core 生命周期与插件编排基础第一增量已实施为 `@aurora/core` 并通过新鲜验证，ADR-003 进入 `accepted / in-progress`；`@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量已实施为 `@aurora/browser` 并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/006 保持 `accepted / in-progress`；具体事件正文 Schema、具体采集插件、框架适配、其余 SDK、服务端、平台、CI、发布与 AWS/IaC 按各自直接前置逐模块审查，不自动开始；
4. 管理平台总体 OpenAPI 与实现约束设计已批准；机器 Platform OpenAPI、`platform-contract`、生成 Client/适配、平台模型和前后端实现仍 blocked，不自动进入 planning 或实现；
5. 按[无编号候选队列](docs/architecture/formalization-readiness.md#7-新-adr-候选队列)只为直接阻塞模块的长期决定建立独立提案，不进入 D2 或其他新 brainstorming。

每项未决内容都必须保持明确状态和恢复入口。优先决定当前专题下一项和即将形成实施阻塞的事项；不能把“尽快决策”解释为跳过业务推导、评审或 ADR 门禁。

## 10. 状态同步与长度约束

当 approved 规则、accepted ADR、已批准产品决定或已确认设计决定改变项目阶段、实施门禁或决策顺序时，必须在同一变更中同步本文件和 `AGENTS.md` 的当前状态与待决策队列。

本文件最多 260 行且不超过 36 KiB。超限或出现 PRD/规范正文重复时，必须把细节留在权威文档，只保留链接、状态和可执行门禁。入口重写历史由 Git 保存；六份长期规范仍按 append-only 方式维护。
