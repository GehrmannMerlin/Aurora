---
title: ADR-035：平台资源策略数据模型（最小分层策略）
status: accepted
implementation-status: not-started
approval-status: approved
owner: platform/data
date: 2026-08-12
last-reviewed: 2026-08-12
applies-to: D2 平台资源策略管理的数据模型（platform_resource_policies、organization_policy_overrides、project_policy_limits 三表 + 生效值/来源/传播查询）
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/architecture/platform-resource-policy-data-model.md
  - ../../docs/security/platform-admin-and-platform-audit.md
  - ../../docs/adr/ADR-034-platform-admin-and-platform-audit.md
  - ../../docs/adr/ADR-029-platform-database-access-and-migration.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
superseded-by: none
---

# ADR-035：平台资源策略数据模型（最小分层策略）

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：not-started
- 审批状态：approved
- 日期：2026-08-12
- Owner：platform/data
- 适用范围：D2 平台资源策略管理的数据模型（`platform_resource_policies`、`organization_policy_overrides`、`project_policy_limits` 三表 + 生效值/来源/传播查询）
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 15.8—15.10、16 节
- 关联策略规格：[平台资源策略数据模型](../../docs/architecture/platform-resource-policy-data-model.md)（approved）
- 关联身份/审计规格：[平台管理员与平台级审计](../../docs/security/platform-admin-and-platform-audit.md)（approved）
- 关联 ADR：ADR-034（平台管理员身份/审计）；ADR-029（数据库工具链）；ADR-019/020/021（处理存储，不修改）
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-12 创建为 `proposed`，2026-08-12 由用户对 `G13_PLT10_APPROVAL_PACKAGE` 六项推荐整体批准并直接批准本 ADR，转为 `accepted / not-started / approved`。`implementation-status` 保持 not-started，直到资源策略正式实施开始；accepted 只授权决策，不表示 Migration、代码、机器契约或实现证据已存在。

## 背景

Aurora 已接受 ADR-033（Issue 数据模型）并实现 DAT-21 用量/额度/降级投影（`usageGetSummary`）。PRD §15.8 定义平台管理员可配置的六项保护参数（默认组织周期额度、组织/项目资源上限、预警比例、硬上限、降级开关、高价值事件最低保留）；§15.9 定义 `policy_source`（系统默认/平台管理员配置）；UX/UI §8.31 已确认"最小分层策略"方案 A（平台默认 → 组织版本化完整覆盖 → 项目仅可选资源上限覆盖），并要求"配置值、来源、生效值"三者分离 + 传播状态。当前缺口：资源策略无物理存储模型，构成 D2 的数据模型阻塞。资源策略物理模型属于需要长期保留取舍依据的高迁移成本决策，故创建本独立 ADR。

## 决策驱动因素

1. **分层形态**：平台默认/组织覆盖/项目上限用三表独立版本，还是逐字段三级继承、每目标完整独立策略、单表？
2. **覆盖语义**：组织覆盖是"完整覆盖"还是"逐字段覆盖"？项目覆盖是否只含资源上限？
3. **版本与并发**：每目标版本化 + 乐观并发；版本冲突如何处理？
4. **来源/生效值分离**：配置值与生效值如何表示，避免把继承值伪装成目标自身保存值？
5. **传播状态**：Command 保存后如何呈现数据面传播状态？

## 候选方案

### 分层形态
- **A（推荐，已批准）**：三表独立版本（`platform_resource_policies` 单行、`organization_policy_overrides` 每组织一行完整覆盖、`project_policy_limits` 每项目一行仅资源上限）；组织/项目无覆盖 = 无行（继承）。
- B：逐字段三级继承（复杂度/漂移风险高，已确认方案 A 排除）。
- C：每目标完整独立策略（每目标全量复制，冗余且漂移，已确认方案 A 排除）。

### 覆盖语义
- **A（推荐，已批准）**：组织 = 六项完整覆盖（保存即整体替换，版本化）；项目 = 仅可选资源上限覆盖；"恢复平台默认/清除项目覆盖" = 删除行（独立确认 Command）。
- B：组织逐字段覆盖（引入逐字段继承，已排除）。

## 决策

1. 三表独立版本：`platform_resource_policies`（单行平台默认）、`organization_policy_overrides`（每组织一行六项完整覆盖）、`project_policy_limits`（每项目一行仅 `resource_limit`）。
2. 无覆盖 = 无行（继承上级）；组织覆盖保存即整体替换；项目覆盖只含资源上限，其余字段继承组织有效策略。
3. 每表 `version` int 乐观并发；版本冲突 → `version_conflict`，页面展示服务端当前值并要求重新确认（UX/UI §8.31 `stale`/`conflict`）。
4. 生效值由服务端只读 Query 计算（平台默认 → 组织覆盖 → 项目上限）；"配置值、来源、生效值"三者分离呈现，来源取 `system_default`/`platform_admin`/继承。
5. 传播状态由服务端权威返回（`propagating` + `propagatedAt`）；页面不因表单成功宣称数据面已生效。
6. 建议默认值（**产品确认点**）：默认组织周期额度 100 万事件/月、预警 80%、硬上限 100%、降级开关开启、高价值事件保留 90 天；批准后写入正式策略。

## 影响与后果

- **新增**：三张策略表 Migration（平台数据包）；`EffectivePolicy` 只读 Query；五个版本化 Command（SetDefault / SetOrganization / ResetOrganization / SetProjectLimit / ClearProjectLimit）。
- **不修改**：ADR-019/020/021 处理存储；DAT-21 用量投影（策略生效值成为用量/保护状态的新事实来源，由 D2 与 DAT-21 正式契约协同）。
- **兼容**：B5 用量摘要继续只读展示保护状态，不成为策略配置事实。
- **成本**：三张小表（平台默认 1 行、每覆盖组织 1 行、每覆盖项目 1 行）；生效查询为只读计算，无缓存漂移。
- **隐私**：策略表不含事件正文/密钥；审计按平台审计 1 年。

## 评审记录

- 2026-08-12：proposed 创建；用户对 `G13_PLT10_APPROVAL_PACKAGE` 整体批准并经用户直接批准本 ADR，转 `accepted / not-started / approved`（未另派 reviewer subagent）。

## 附录：与 G13_PLT10_APPROVAL_PACKAGE 的对应

- 决策 1—5 ← package 第 6 项（D2 机器契约边界）+ UX/UI §8.31 已确认方案 A
- 决策 6 ← package 第 5 项（资源策略范围与默认值）
