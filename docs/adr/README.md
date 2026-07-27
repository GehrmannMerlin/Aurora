---
title: Aurora ADR 索引
status: approved
owner: architecture
initial-reviewed: 2026-07-27
applies-to: Aurora 全部重大技术决策
related:
  - ../../AURORA_RULES.md
  - "../../Aurora 架构规范.md"
  - "../../Aurora ADR 规范.md"
supersedes: none
maintenance: append-only
---

# Aurora ADR 索引

## 状态说明

本目录保存 Aurora 的架构决策记录。

只有状态为 accepted 的 ADR 才是正式决策。proposed ADR 只用于讨论和评审，不得约束正式实现。决策状态与实施状态分开管理，accepted 不代表 implemented。

当前六份 ADR 是从已批准架构规范中的 ARCH-001—ARCH-006 提取出的独立评审提案。它们补充候选方案、代价、迁移、回滚和验证，不删除、不缩减也不替代 [Aurora 架构规范](<../../Aurora 架构规范.md>)。

## 当前 ADR

| 编号 | 标题 | 决策状态 | 实施状态 | 关联规则 |
|---|---|---|---|---|
| [ADR-001](ADR-001-use-monorepo.md) | 使用统一 Monorepo | proposed | not-started | ARCH-001 |
| [ADR-002](ADR-002-five-system-boundaries.md) | 划分五大系统边界 | proposed | not-started | ARCH-002 |
| [ADR-003](ADR-003-sdk-plugin-architecture.md) | SDK 分层插件架构 | proposed | not-started | ARCH-003 |
| [ADR-004](ADR-004-asynchronous-event-processing.md) | 可靠接收与异步处理 | proposed | not-started | ARCH-004 |
| [ADR-005](ADR-005-event-schema-source-of-truth.md) | event-schema 单一来源 | proposed | not-started | ARCH-005 |
| [ADR-006](ADR-006-one-way-dependencies.md) | 单向依赖与自动约束 | proposed | not-started | ARCH-006 |

## 评审门禁

ADR 从 proposed 变为 accepted 前必须：

- 至少一名非作者批准；
- 涉及领域的必要评审者完成评审；
- 候选方案真实可行；
- 正负影响、迁移、回滚、验证和重新评估条件完整；
- 与 PRD、架构规范和其他 ADR 不冲突；
- 实施任务、测试和文档影响已经明确。

状态变化通过 ADR 自身的追加记录维护，不删除历史状态。

## 关联文档

- [项目规则总入口](../../AURORA_RULES.md)
- [核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- [架构规范](<../../Aurora 架构规范.md>)
- [ADR 规范](<../../Aurora ADR 规范.md>)

## 维护记录

### ADR-INDEX-BASELINE-20260727：初始 ADR 索引

- 状态：approved
- 生效日期：2026-07-27
- Owner：architecture
- 维护方式：append-only
- 说明：创建 ARCH-001—ARCH-006 对应的六份 proposed、not-started ADR 提案。
- 历史保护：后续不得删除历史 ADR 条目；状态和替代关系必须追加记录。
