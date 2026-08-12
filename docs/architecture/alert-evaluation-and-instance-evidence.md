---
title: DAT-19 告警规则求值、实例与证据（Product Alert）
status: approved
owner: processing/platform
last-reviewed: 2026-08-12
applies-to: PRD §11 产品告警后端主链——Alert Rule → evaluator → evaluation window → Alert Instance → evidence → cooldown → recovery/resolved
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../prd/platform-product-domains.md
  - ../architecture/platform-backend.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../superpowers/plans/2026-08-12-dat-19-alert-evaluation-and-instance-evidence.md
supersedes: none
review-cycle: product-or-api-change
---

# DAT-19 告警规则求值、实例与证据

## 1. 目标与边界

实现 PRD §11 第一版产品告警后端主链：告警规则配置、确定性求值引擎、滚动评估窗口、告警实例生命周期、评估证据、冷却资格与恢复/结束状态，并通过 `@aurora/platform-contract` 冻结机器契约、经 `apps/platform-api` 公开、由 `apps/platform-worker` 轮询求值。

本规格只产生**可信告警事实**。以下明确不实现：

- 通知（邮件/短信/站内通知页/D1/G13）、冷却的实际发送；
- Console 告警 UI（G12 C10—C12 页面）；
- OPS-06 operational alert（平台自身可观测性/SLO/Runbook）；
- 动态基线、异常检测、多条件嵌套、告警依赖/升级、值班排班、周期性重复提醒（PRD §11.2.11）；
- 过滤器（environment/release/page_or_endpoint/error_severity）的真实数据源（当前事件无对应字段）；
- 性能比例指标的真实计算（需逐事件样本，ADR-021 原材料 deferred）。

## 2. 权威来源

- 规则语义：PRD §11.2.1—11.2.11、§11.3、§11.4；
- 权限：PRD §13.1/§13.2（项目管理员管理告警，成员查看）、平台后端设计 §7/§11/§12；
- 页面口径：UX/UI §7.25—7.27、§8.23—8.25、§10.17—10.19（规则/实例分离、证据、轨迹、暂停原因）；
- 数据所有权：平台后端设计 §3（规则、实例、证据归属 issues-and-alerts 处理存储，与 issues 同域先例一致）。

## 3. 数据模型（`@aurora/processing-store`）

Migration `1722500000010_alert-rules-and-instances.ts`：

| 表 | 职责 |
|---|---|
| `alert_rules` | 项目内规则配置 + 当前评估投影（`evaluation_state`/`evaluation_since`/`last_evaluated_at`/`evaluation_pause_reason`/`last_observed_value`/`last_notified_at`）+ 乐观 `version` |
| `alert_instances` | 每次触发周期：`state`（triggered/pending_recovery/recovered/evaluation_paused）、关键时间、`paused_from`/`pause_reason`、`rule_snapshot`（实例创建时规则安全快照，与当前规则分离）；部分唯一索引保证每规则至多一个活动实例 |
| `alert_instance_evidence` | 当前判断证据（1:1，状态变化时替换）：观测值、比例分子/分母、样本与最小样本、水位、完整性、暂停原因、applied_filters |
| `alert_instance_transitions` | 有序业务状态轨迹：from/to/reason/occurred_at |

固定选项（PRD §11.2.3/§11.2.4/§11.2.6）以 DB CHECK 强制：window ∈ {1,5,10,30,60} 分钟；trigger duration ∈ {0,1,2,5,10} 分钟（0=立即）；cooldown ∈ {5,10,30,60} 分钟；比例指标必须有 `min_sample_count`；`recovery_threshold < trigger_threshold`。

## 4. 求值引擎（纯函数）

`evaluateAlertRule`（可注入时钟，确定性，禁 sleep）：

- 观测分类：`breached`（>触发阈值）/ `recovery_zone`（<恢复阈值）/ `between`（持续异常）/ `insufficient_samples`（比例指标分母 < 最小样本）/ `missing`（无数据）。
- 规则评估状态机：normal → pending_trigger → triggered → pending_recovery → normal（实例 recovered 后）；`evaluation_paused` 为非推进暂停。
- **实例在完整触发条件满足时创建**（PRD §11.2.9 + C10 §7.25 契约决定）；pending_trigger 是规则评估投影，不产生实例，`between` 时"取消等待"。
- 恢复：进入 recovery_zone 后 `pending_recovery`，连续满足恢复持续时间 → `recovered`（终态，规则再触发创建新实例）；`between` 期间恢复条件不再满足则回到 triggered（持续异常）。
- 数据缺失/样本不足/性能比例不可计算 → `evaluation_paused` + 原因，**绝不判定恢复**（PRD §11.2.10）。
- 冷却（PRD §11.2.6）只计算通知资格（`decideAlertNotification`：first_trigger/retrigger/recovered/suppressed/none），不改变告警状态；DAT-19 只记录 `last_notified_at`，不发送。

## 5. 观测计算

`computeAlertObservation` 从处理存储真实数据计算窗口观测（不采样外推、不伪造）：

- `error_count` / `new_issue_count` / `issue_reappearance_count` / `request_failure_rate` / `slow_request_count` 来自 `error_event_occurrences`/`issues`/`issue_activities('reappeared')`/`request_metric_buckets`；
- `lcp_ratio`/`inp_ratio`/`cls_ratio` → `evaluation_paused`（原因 `performance_ratio_metric_requires_event_samples`，诚实 unavailable）；
- 窗口内无最近处理证据（`no_data_in_window`）→ `missing`，不得解释为 0/正常。

## 6. 求值轮询与 API

- `runAlertEvaluationRound`（processing-store，data 层内部编排）：批量加载规则 → 逐条观测 → 求值 → 原子持久化（规则投影 + 实例 + 证据 + 轨迹 + 通知资格）；单条失败不阻断其余。
- `apps/platform-worker` 轮询循环调用；配置 `ALERTS_EVALUATION_ENABLED`（默认 true）、`ALERT_MAX_RULES`（默认 100）。
- `apps/platform-api` 5 个稳定操作：

| operationId | 说明 |
|---|---|
| `alertsGetCapability` | C11 能力契约 + 固定选项 + 过滤维度可用性 + 真实成员接收候选 |
| `alertsListRulesAndInstances` | C10 规则（含当前评估投影）+ 实例（有界 200） |
| `alertsCreateRule` | C11 创建（项目管理员 + CSRF + 幂等 + 审计） |
| `alertsUpdateRule` | C11 编辑（乐观 version + CSRF + 幂等 + 审计） |
| `alertsGetInstanceDetail` | C12 实例 + 规则快照 + 证据 + 轨迹（只读） |

- 创建/更新校验（PRD §11.2.8）：固定选项、恢复阈值方向、比例指标最小样本、至少一个接收成员、**过滤器因无有效数据范围被拒**（`field_validation`）。
- 权限：读取=项目查看；管理=org manager 或 `project_admin`（`requireProjectAlertManageAccess` + 事务内重读）。

## 7. 实施边界与记录

- `lcp_ratio`/`inp_ratio`/`cls_ratio` 规则可创建，但评估如实 `evaluation_paused`（无逐事件样本，ADR-021 原材料 deferred）。
- 归档项目/接收异常/额度缺失/处理延迟等跨系统数据水位信号不在本叶实现（观察层基于处理存储实际观测；缺失以 `no_data_in_window` 表达）。该边界记录为 v1 限制。
- 审计写入 `security_audit_events`（action `alert.rule_created`/`alert.rule_updated`），不保存 token/Secret/堆栈/完整邮箱。
- 时间一律 UTC；滚动窗口不受组织时区影响；求值时钟注入（fake clock 测试）。
- Product Alert 与 OPS-06 Operational Alert 严格分离。
