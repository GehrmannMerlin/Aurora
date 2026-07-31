---
title: Aurora 正式文档索引与权威来源映射
status: approved
owner: documentation/architecture
last-reviewed: 2026-07-30
applies-to: Aurora 第一版正式文档导航、权威来源和设计历史追踪
related:
  - ../README.md
  - ../AGENTS.md
  - ../AURORA_RULES.md
  - ../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - architecture/formalization-readiness.md
  - adr/README.md
supersedes: none
review-cycle: milestone-or-release
---

# Aurora 正式文档索引与权威来源映射

## 1. 使用规则

正式规则与当前可维护设计进入本索引列出的长期文档；`docs/superpowers/specs/` 保留批准依据和设计历史，不再作为同一内容的平行维护副本。完整前端 UX/UI 设计是例外：A1—D2、`NAV-A`、`AUDIT-A`、页面状态和 GAP-01—GAP-20 的详细页面设计仍以该文档为来源，正式业务域文档只提供稳定分域、权威链接和实施阻塞。

不存在的 OpenAPI、具体事件正文、已实现 Schema、数据模型、模块 README、CI、IaC 和 Runbook 不得用空壳冒充就绪。`event-schema` 协议基础第一增量已实施为真实私有包 `@aurora/event-schema`，只建立公共信封、版本、运行时边界校验和共享契约样本；具体事件正文、批次/接收协议、接入/处理机器契约、CI 和发布仍不存在，并在[正式化与实施就绪追踪](architecture/formalization-readiness.md)中与已实施基础分开标记。

## 2. 当前正式权威来源

| 内容                                    | 唯一长期维护位置                                                            | 批准输入/历史                                                                   | 当前边界                                                                                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 第一版产品范围                          | [核心业务 PRD](../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)            | 六专题设计均不得修改范围                                                        | approved                                                                                                                                                                                                    |
| Agent 与当前上下文                      | [AGENTS.md](../AGENTS.md)、[AURORA_RULES.md](../AURORA_RULES.md)            | Git 历史                                                                        | approved operational snapshot                                                                                                                                                                               |
| 长期工程治理                            | 根目录六份长期规范                                                          | 初始治理设计                                                                    | approved、append-only                                                                                                                                                                                       |
| 系统边界与数据流                        | [系统架构与模块边界](architecture/system-overview.md)                       | 架构规范、基础专题批准基线                                                      | approved；实现需 ADR                                                                                                                                                                                        |
| Monorepo 根工作区与基础工具             | [Monorepo 与基础工程工具](architecture/monorepo-and-build.md)               | ADR-001、ADR-006、ADR-007、测试规范                                             | implemented；真实内部工具 `@aurora/workspace-policy` 及命令已存在                                                                                                                                           |
| 内部工具 Workspace Policy               | [tooling/workspace-policy/README.md](../tooling/workspace-policy/README.md) | Monorepo 规格、ADR-001/006/007                                                  | 唯一模块级权威来源                                                                                                                                                                                          |
| event-schema 协议基础第一增量           | [event-schema 协议基础规格](protocol/event-schema-foundation.md)            | PRD、架构规范、ADR-005/006/007                                                  | approved planning spec；[模块计划](superpowers/plans/2026-07-30-event-schema-foundation.md)已执行，信封/版本/运行时边界/共享样本已实施为真实包                                                              |
| event-schema 模块契约                   | [packages/event-schema/README.md](../packages/event-schema/README.md)       | 协议基础规格、ADR-005/006/007                                                   | 唯一模块级权威来源；私有、零运行时依赖、`aurora.layer: protocol`                                                                                                                                            |
| 事件信封协议版本 1                      | [事件信封协议版本 1](protocol/event-envelope-v1.md)                         | 协议基础规格、真实实现                                                          | approved；信封字段、限制、禁止字段、合法/非法示例与兼容规则                                                                                                                                                 |
| SDK 分层与公共行为                      | [SDK 架构](architecture/sdk-architecture.md)                                | 架构规范、基础专题与测试设计                                                    | approved；公共 API absent                                                                                                                                                                                   |
| SDK Core 生命周期与插件编排基础第一增量 | [SDK Core 基础规格](sdk/sdk-core-foundation.md)                             | PRD、架构/代码/测试规范、ADR-003/005/006/007                                    | approved planning spec；[单一模块计划](superpowers/plans/2026-07-30-sdk-core-foundation.md)已执行，`packages/core` 实施文件已落盘并随包级 README 存在；Browser、具体插件、采样、队列、传输和持久化仍 absent |
| 管理平台页面业务域                      | [管理平台产品业务域](prd/platform-product-domains.md)                       | [完整 UX/UI 设计](superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md) | approved；页面细节仍回读完整设计                                                                                                                                                                            |
| 管理平台前端工程与视觉边界              | [管理平台前端架构](architecture/platform-frontend.md)                       | approved 前端技术栈、控制台视觉语言与总体契约设计                               | approved design；纯色琥珀橙侧栏与禁止渐变已冻结；机器 OpenAPI、主题、Client 与实现 absent；实现需 ADR/API                                                                                                    |
| 管理平台后端领域边界                    | [管理平台后端架构](architecture/platform-backend.md)                        | approved 后端与总体契约设计                                                     | approved design；机器 OpenAPI/模型/实现 absent                                                                                                                                                              |
| 测试分层与质量门禁                      | [测试策略](testing/test-strategy.md)                                        | 测试规范、approved 测试/部署/发布设计                                           | approved policy；可执行工程 absent                                                                                                                                                                          |
| AWS 部署设计                            | [部署架构](architecture/deployment.md)                                      | approved 测试/部署/发布设计                                                     | approved design；区域/IaC deferred                                                                                                                                                                          |
| 发布、迁移与回滚                        | [发布、迁移与回滚](releases/release-migration-and-rollback.md)              | approved 测试/部署/发布设计                                                     | approved policy；流水线 absent                                                                                                                                                                              |
| 备份与恢复                              | [备份与恢复](operations/backup-and-recovery.md)                             | approved 测试/部署/发布设计、A5                                                 | approved design；资源/演练 absent                                                                                                                                                                           |
| A5 账号注销与数据生命周期               | [账号注销与数据生命周期](security/account-deletion-and-data-lifecycle.md)   | approved A5 专项设计                                                            | approved；机器契约/ADR absent                                                                                                                                                                               |
| ADR 决策状态和候选队列                  | [ADR 索引](adr/README.md)                                                   | ADR 规范、正式化追踪                                                            | ADR-001/003/005/006 in-progress，ADR-007 implemented，ADR-002、ADR-004 not-started；其他候选不预占编号                                                                                                      |
| 缺口、机器契约和实施顺序                | [正式化与实施就绪追踪](architecture/formalization-readiness.md)             | 六专题总结                                                                      | draft 工作矩阵，不是第二份 PRD                                                                                                                                                                              |

## 3. 设计历史与正式文档关系

| 设计历史                                                                                         | 正式承载                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| [前四专题批准基线](superpowers/specs/2026-07-28-aurora-foundation-topic-approval-baseline.md)    | 系统架构、SDK 架构及未来接入/处理契约            |
| [完整前端 UX/UI](superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md)                   | 管理平台产品业务域；页面细节仍由设计历史详细承载 |
| [前端技术栈设计](superpowers/specs/2026-07-28-aurora-frontend-technology-stack-design.md)        | 管理平台前端架构                                 |
| [控制台视觉语言设计](superpowers/specs/2026-07-30-aurora-console-visual-language-design.md)     | 完整前端 UX/UI 与管理平台前端架构                |
| [平台后端设计](superpowers/specs/2026-07-28-aurora-platform-backend-design.md)                   | 管理平台后端架构                                 |
| [总体 OpenAPI 与实现约束设计](superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md) | 管理平台产品业务域、前端架构、后端架构与正式化追踪；机器 OpenAPI 仍待生成 |
| [测试、部署与发布设计](superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md) | 测试策略、部署、发布/迁移/回滚、备份恢复         |
| [A5 专项设计](superpowers/specs/2026-07-29-aurora-account-deletion-data-lifecycle-design.md)     | 账号注销与数据生命周期                           |
| [六专题总结](superpowers/specs/2026-07-29-aurora-topic-discussion-summary.md)                    | 仅作跨专题索引和追踪输入，不承载详细规则         |

## 4. 尚不创建的文档

具体事件正文协议、Browser 层、具体采集插件、框架适配、SDK 安装/配置/公共 API、接入与处理 OpenAPI、机器 Platform OpenAPI、平台/处理数据模型、管理平台主题/组件实现、兼容实测矩阵、性能基准、CI 配置、IaC、事故/死信/删除 Runbook 和尚不存在模块的 README 均缺少机器来源、真实模块、accepted ADR 或运行证据。平台总体 OpenAPI 与实现约束、控制台视觉语言均已经批准，但不等于 `platform-contract`、生成 Client、服务端适配、机器 YAML、设计令牌代码或 PrimeVue/Aurora UI 主题已存在。`@aurora/event-schema` 的公共信封、版本识别、运行时边界校验和共享契约样本，以及 `@aurora/core` 的生命周期、配置、插件编排、事件入口与诊断基础已实施；具体事件正文、批次/接收协议、Browser、采集插件和接入/处理机器契约仍不存在。其余内容分别标记为 `deferred`、`requires-accepted-adr` 或 `requires-benchmark`，不得用空壳文件制造已就绪错觉。
