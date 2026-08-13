---
title: Aurora 用量、额度与降级投影（DAT-21）
status: approved
implementation-status: implemented-in-feature-branch
approval-status: approved
owner: data/platform
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to: Aurora 第一版组织周期资源用量聚合、额度状态、降级投影与 usageGetSummary 查询
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../prd/platform-product-domains.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - './request-metric-query-projection.md'
  - '../adr/README.md'
supersedes: none
review-cycle: release-or-quota-policy-change
---

# Aurora 用量、额度与降级投影（DAT-21）

## 1. 定位、效力与当前状态

本文正式承载 DAT-21 叶子模块（usage / quota / degradation aggregate and projection）。它把核心 PRD §15（采样、限流与资源额度）的**周期资源额度**语义落为真实用量聚合与 `usageGetSummary` 查询。

**当前状态**：`status: approved`、`implementation-status: implemented-in-feature-branch`。用量/额度/降级模型（纯）、`usageGetSummary` 操作从 `BLOCKED_OPERATIONS` 移入稳定操作、Platform OpenAPI 重新生成、platform-api handler 与授权已实现并测试。

## 2. 权威语义（不重开）

- **不做收费项目**：第一版额度仅用于防止单项目异常流量拖垮平台、控制存储/计算资源、避免 SDK 配置错误产生无限数据、资源不足时优先保留高价值监控信息（PRD §15.1）。
- **不包含**：套餐价格、在线支付、账单、欠费、超额计费、自动续费、发票、商业套餐切换（PRD §15.1）。控制台使用"资源用量/数据用量"，不使用收费术语。
- 额度至少统计：已接收事件数量、已保存完整事件数量、性能和慢请求样本数量、当前周期开始和结束时间、当前使用比例（PRD §15.4）。
- 额度周期按组织业务时区计算；第一版按月或固定周期重置（PRD §15.4）。
- 固定降级顺序（PRD §15.5）：接近上限（80% 建议阈值）→ 依次降低性能/慢请求采样 → 进入降级（优先保留新问题、严重错误、再次出现、新版本/新环境首条、接入测试事件）→ 达到硬上限（停止保存普通完整事件、SDK 收到"资源额度已达上限"不重试、控制台持续显示降级）。
- **禁止采样外推、收费逻辑**；只统计真实处理数据。

## 3. 用量聚合（真实）

`usageGetSummary` 在查询时对组织全部项目汇总**真实处理数据**（无采样外推、无 mock）：

- 每个项目：`queryProjectQueryableEvidence`（processing-store，DAT-20）返回 `accepted`（已接收）与 `processed`（已处理/可查询）计数；
- 组织聚合：`acceptedEvents = Σ accepted`、`processedEvents = Σ processed`；
- 组织项目清单来自 `platform-project-governance` `listProjects`；
- 周期按组织时区（`organization.timezone`）从查询时间回推固定周期窗口。

性能/慢请求样本数量：第一增量只在对应样本查询投影真实存在后纳入（当前标注 `unavailable`，不伪造 0）。

## 4. 额度状态与降级投影

- `OrganizationQuota`：默认免费额度（`DEFAULT_ORGANIZATION_QUOTA`，按事件数），由平台管理员配置（D2，G13 blocked）后续替换；
- `degradeForUsageRatio(ratio, thresholds)`（纯函数）：`ratio < warningThreshold(80%)` → `normal`；`< hardLimitThreshold(100%)` → `degraded`（含 near-limit 预警档）；`≥ hardLimit` → `hard-limit`；
- `UsageStage = 'normal' | 'near-limit' | 'degraded' | 'hard-limit'`；
- 响应 `UsageSummary`：`organizationId / periodStart / periodEnd / acceptedEvents / processedEvents / quotaAcceptedEvents / ratio / stage`，均说明口径。

## 5. 公开契约

- `usageGetSummary`：`GET /api/platform/v1/organizations/:organizationId/usage`，session 认证 + org manager 授权（复用平台项目/组织访问授权），从 `BLOCKED_OPERATIONS` 移入稳定操作；
- Platform OpenAPI v1 重新生成，漂移门禁通过。

## 6. 未决 / 后续

- 性能/慢请求样本数量纳入用量（依赖对应样本查询投影，`unavailable` 不伪造）；
- 平台管理员配置额度（D2，G13）、周期重置调度、接入测试事件标识；
- 采样影响与降级影响展示（页面，G12 属 G11/G12 范围）。

## 7. 非职责

本文不实现：收费/账单/套餐、采样外推、限流行为（ING-12）、告警求值（DAT-19）、Source Map（DAT-18）、管理平台 UI。
