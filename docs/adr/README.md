---
title: Aurora ADR 索引
status: approved
owner: architecture
last-reviewed: 2026-07-30
applies-to: Aurora 全部重大技术决策
related:
  - ../../AURORA_RULES.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora ADR 规范.md'
  - ../README.md
  - ../architecture/formalization-readiness.md
  - ../architecture/system-overview.md
supersedes: none
maintenance: append-only
---

# Aurora ADR 索引

## 状态说明

本目录保存 Aurora 的架构决策记录。

只有状态为 accepted 的 ADR 才是正式决策。proposed ADR 只用于讨论和评审，不得约束正式实现。决策状态与实施状态分开管理，accepted 不代表 implemented。

ADR-001—ADR-006 从已批准架构规范中的 ARCH-001—ARCH-006 提取，ADR-007 只决定首个私有 Workspace 的包管理与任务入口。2026-07-29 已完成独立非作者和所需领域评审，七份决策均为 `accepted / not-started`；接受只授权决策，不表示代码、工具、Schema、CI、基础设施或测试证据已经存在。

## 当前 ADR

| 编号                                                     | 标题                          | 决策状态 | 实施状态    | 关联规则       |
| -------------------------------------------------------- | ----------------------------- | -------- | ----------- | -------------- |
| [ADR-001](ADR-001-use-monorepo.md)                       | 使用统一 Monorepo             | accepted | in-progress | ARCH-001       |
| [ADR-002](ADR-002-five-system-boundaries.md)             | 划分五大系统边界              | accepted | not-started | ARCH-002       |
| [ADR-003](ADR-003-sdk-plugin-architecture.md)            | SDK 分层插件架构              | accepted | in-progress | ARCH-003       |
| [ADR-004](ADR-004-asynchronous-event-processing.md)      | 可靠接收与异步处理            | accepted | not-started | ARCH-004       |
| [ADR-005](ADR-005-event-schema-source-of-truth.md)       | event-schema 单一来源         | accepted | in-progress | ARCH-005       |
| [ADR-006](ADR-006-one-way-dependencies.md)               | 单向依赖与自动约束            | accepted | in-progress | ARCH-006       |
| [ADR-007](ADR-007-workspace-package-and-task-tooling.md) | pnpm Workspace 与原生任务入口 | accepted | implemented | 首模块工程工具 |

## 评审门禁

ADR 从 proposed 变为 accepted 前必须：

- 至少一名非作者批准；
- 涉及领域的必要评审者完成评审；
- 候选方案真实可行；
- 正负影响、迁移、回滚、验证和重新评估条件完整；
- 与 PRD、架构规范和其他 ADR 不冲突；
- 实施任务、测试和文档影响已经明确。

状态变化通过 ADR 自身的追加记录维护，不删除历史状态。

## 新 ADR 候选入口

未编号候选的唯一详细队列维护在[正式化与实施就绪追踪](../architecture/formalization-readiness.md#7-新-adr-候选队列)。Workspace、包管理器和首期任务策略已经由 ADR-007 收口；版本发布、前后端栈、数据库、任务/缓存/对象存储、Session、安全、接入缓冲、处理存储、AWS/IaC、制品晋级与公共兼容仍按直接模块依赖建立，不批量编号。

候选项在形成独立 ADR 文件前不分配 ADR 编号；不得把该队列当成已接受决定，也不得合并成大一统技术栈 ADR。

## 关联文档

- [项目规则总入口](../../AURORA_RULES.md)
- [核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- [架构规范](<../../Aurora 架构规范.md>)
- [ADR 规范](<../../Aurora ADR 规范.md>)
- [正式文档索引](../README.md)
- [系统架构与模块边界](../architecture/system-overview.md)
- [正式化与实施就绪追踪](../architecture/formalization-readiness.md)

## 维护记录

### ADR-INDEX-BASELINE-20260727：初始 ADR 索引

- 状态：approved
- 生效日期：2026-07-27
- Owner：architecture
- 维护方式：append-only
- 说明：创建 ARCH-001—ARCH-006 对应的六份 proposed、not-started ADR 提案。
- 历史保护：后续不得删除历史 ADR 条目；状态和替代关系必须追加记录。

### ADR-INDEX-RULE-20260727-001：决策与实施双状态

- 状态：approved
- 生效日期：2026-07-27
- Owner：architecture
- supersedes：none
- 新增规则：决策状态和实施状态分别记录。not-started 表示正式实施尚未开始，可与 proposed 或 accepted 组合。
- 当时解释（已由 `ADR-INDEX-ACCEPTANCE-20260729` 追加记录更新）：本索引中的 proposed / not-started 表示六项决策仍在评审，且没有开始正式实施。
- 验证方式：分别校验两列，不把 proposed / not-started 视为状态冲突。

### ADR-INDEX-FORMALIZATION-20260729：正式化追踪入口

- 状态：approved
- 生效日期：2026-07-29
- Owner：architecture
- 关联：[正式化与实施就绪追踪](../architecture/formalization-readiness.md)
- 当时解释（已由 `ADR-INDEX-ACCEPTANCE-20260729` 追加记录更新）：ADR-001—ADR-006 的决策状态保持 `proposed`，实施状态保持 `not-started`；本次只增加正式化与实施就绪追踪入口，不构成评审通过、接受或实施授权。

### ADR-INDEX-REVIEW-INPUT-20260729：六份提案复审输入完成

- 状态：approved
- 生效日期：2026-07-29
- Owner：architecture
- 关联：[正式化与实施就绪追踪](../architecture/formalization-readiness.md#6-adr-001adr-006-复审清单)
- 当时解释（已由 `ADR-INDEX-ACCEPTANCE-20260729` 追加记录更新）：ADR-001—ADR-006 已分别补充批准设计和正式文档证据、候选边界、实施约束、验证输入与所需评审角色；六份 ADR 仍全部为 `proposed / not-started`。
- 审批边界：下一步可以进入非作者和领域正式审批；在所需评审完成并按 ADR 规范记录前，不得把任何提案标为 `accepted`。
- 候选治理：新 ADR 候选只在正式化追踪中维护无编号队列，形成独立提案时再分配编号。

### ADR-INDEX-ACCEPTANCE-20260729：ADR-001—ADR-007 完成正式审批

- 状态：approved
- 生效日期：2026-07-29
- Owner：architecture
- 独立评审证据：`adr_001_003_review` 完成 ADR-001—003 与 ADR-007 的非作者/领域评审；`adr_004_006_review` 完成 ADR-004—006 的非作者/领域评审，并在 ADR-004、ADR-006 修正后复审；
- 当前解释：ADR-001—ADR-007 均为 `accepted / not-started`，各自追加记录列出评审角色、结论与不存在的实现证据；
- 修正记录：ADR-004 不再把平台 BullMQ 外推到接入/处理，ADR-006 把本地/CI 负例结果归入 `implemented` 门禁；
- 实施边界：当前没有 Workspace、事件 Schema、SDK、服务端、平台、CI、基础设施、Issue、实现 PR 或测试结果；任何 ADR 都不得标为 `implemented`。

### ADR-INDEX-EVENT-SCHEMA-20260730：ADR-005 进入 in-progress

- 状态：approved
- 生效日期：2026-07-30
- Owner：architecture
- 关联：[ADR-005](ADR-005-event-schema-source-of-truth.md)、[ADR-006](ADR-006-one-way-dependencies.md)、[协议基础第一增量规格](../protocol/event-schema-foundation.md)
- 当前解释：ADR-005 实施状态由 `not-started` 更新为 `in-progress`；`@aurora/event-schema` 协议基础第一增量（版本化公共信封、运行时边界校验、稳定错误和共享契约样本）已实施并通过新鲜验证，但具体事件正文、批次/接收协议、兼容转换和真实消费者仍不存在，ADR-005 未进入 `implemented`。ADR-006 保持 `in-progress`，补齐协议层零本地依赖与公共/私有入口证据。
- 实施边界：ADR-001/006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-002—005 中 ADR-005 现为 `in-progress`、ADR-002—004 仍为 `not-started`；`@aurora/event-schema` 是继 `@aurora/workspace-policy` 之后的第二个真实内部包。

### ADR-INDEX-CORE-FOUNDATION-20260730：ADR-003 进入 in-progress

- 状态：approved
- 生效日期：2026-07-30
- Owner：architecture
- 关联：[ADR-003](ADR-003-sdk-plugin-architecture.md)、[ADR-005](ADR-005-event-schema-source-of-truth.md)、[ADR-006](ADR-006-one-way-dependencies.md)、[SDK Core 基础规格](../sdk/sdk-core-foundation.md)
- 当前解释：ADR-003 实施状态由 `not-started` 更新为 `in-progress`；`@aurora/core` SDK Core 生命周期与插件编排基础第一增量（环境无关 Core、显式生命周期、最小配置、插件注册与顺序编排、异常隔离、事件入口和多实例隔离）已实施并通过新鲜验证。ADR-005 追加首个真实 SDK 消费者证据，保持 `in-progress`；ADR-006 修正过时元数据并追加 `sdk-core → protocol`、无 DOM、浏览器全局与模块级可变状态证据，保持 `in-progress`。Browser、具体采集插件、框架适配、采样、队列、传输、持久化、具体事件正文、CI 和发布仍不存在，ADR-003 未进入 `implemented`。
- 实施边界：ADR-001/006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-005/003 为 `in-progress`，ADR-002、ADR-004 仍为 `not-started`；`@aurora/core` 是继 `@aurora/workspace-policy`、`@aurora/event-schema` 之后的第三个真实内部包，仅 Core 基础增量存在。
