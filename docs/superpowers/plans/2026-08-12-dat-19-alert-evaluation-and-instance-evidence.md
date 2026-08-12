# DAT-19 Alert Evaluation and Instance Evidence Implementation Plan

> **执行方式（用户指令 G04 FINAL CLOSE §8）：** writing-plan 自检后由当前 Claude 直接实施。不派 Agent、不派 Reviewer、不调用其他 Superpowers skill。测试预算严格遵守 §15/§16。

**Goal:** 实现 PRD §11 产品告警后端主链——Alert Rule → evaluator → evaluation window → Alert Instance → evidence → cooldown → recovery/resolved——并冻结 `@aurora/platform-contract` 告警契约、`@aurora/processing-store` 告警数据/评估、`apps/platform-api` 5 个 handler、`apps/platform-worker` 评估轮询接线。

**Architecture:** 告警规则、实例、证据、轨迹全部落 `@aurora/processing-store`（与 issues-and-alerts 同域先例一致：issues/issue_activities/issue_notes 均在 processing-store）。纯函数评估引擎 `evaluateAlertRule` 用可注入时钟，确定性推进 normal→pending_trigger→triggered→pending_recovery→recovered 状态机，数据缺失→`evaluation_paused`（绝不误判恢复）。评估轮询 `runAlertEvaluationRound` 由 processing-store 导出（组合本包仓库，data 层内部编排允许），由 platform-worker 轮询循环调用。platform-api 只经公开契约读写，规则 create/update 使用项目管理员授权 + CSRF + 幂等 + 审计。

**Tech Stack:** TypeScript、PostgreSQL 17 + `pg` + `node-pg-migrate`（沿用 ADR-010/ADR-029 工具链）、Fastify 5（platform-api）、`@aurora/platform-contract`（Zod/OpenAPI 注册表 + 漂移门禁）、vitest。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --------- | ------------ | -------- | ------------------------ | ------------------------------------------- |
| DAT-19 | BASE-PRD / BASE-ARCH / BASE-IMPL / PLAT-DOMAINS / PLAT-UX / PLAT-OAPI / OPS-QUALITY / FORM（已回读） | PRD §11（11.2.1—11.2.11、11.3、11.4）、§13（13.1—13.3）；UX/UI §7.25—7.27、§8.23—8.25、§10.17—10.19、§11.3；平台后端设计 §7/§11/§12；平台前端架构 §4 | 触发/恢复/冷却/数据缺失语义；项目管理员管理告警、成员查看；Product Alert 与 OPS-06 分离；不提前实现通知（G13） | 无新增 required ADR（PRD §11 已唯一确定语义，属 implementation-detail） |

## Global Constraints

- 不实现通知邮件/短信/站内通知页面/G13/D1；不实现 Console 告警 UI（属 G12）；不重做 OPS-06 operational alert。
- 不修改 wire protocol；不修改 DAT-21 / SEC-02 / G16 已实施代码。
- 第一版固定选项严格取 PRD §11.2.3/11.2.4/11.2.6：window ∈ {1,5,10,30,60} 分钟；trigger duration ∈ {立即,1,2,5,10} 分钟；cooldown ∈ {5,10,30,60} 分钟。
- 比例型指标必须配置最小样本数（PRD §11.2.7）；数量型指标不得强制最小样本。
- 缺失数据（无数据/归档/接收异常/额度缺失/处理延迟）→ `evaluation_paused` + 原因，绝不判定恢复（PRD §11.2.10）。
- 冷却只影响通知资格，不改变真实告警状态（PRD §11.2.6）；DAT-19 只记录通知资格决策与 `last_notified_at`，不发送。
- 过滤器：PRD §11.2.8 要求"当前筛选条件存在有效数据范围"才可创建；当前 error 事件无 environment/release/severity/page 数据源 → 声明任一过滤器的规则在 create/update 校验时以 `field_validation` 拒绝（诚实，不伪造过滤后的观测）。
- `lcp_ratio`/`inp_ratio`/`cls_ratio` 需要逐事件超标计数，而 performance 桶只有 count/sum/max（ADR-021 deferred 原材料）→ 评估 `evaluation_paused`，原因如实记录，不伪造比例。
- 规则当前评估状态、实例生命周期状态、实例规则快照三者分离；`recovered` 是实例终态，规则再触发创建新实例。
- 时间一律 UTC 存储；窗口为滚动真实时间，不受组织时区影响；评估用可注入 `now`（fake clock，禁 sleep）。
- 审计：规则 create/update 写组织安全审计（`insertAuditEvent`，platform-api 层），不保存 token/Secret/堆栈。
- 错误经 RFC 9457 + 稳定错误码；不泄露堆栈、SQL、对象键或账号存在性。

## File Structure

**packages/platform-contract**
- `src/issues-and-alerts/alerts.ts`（新增）— 告警契约：指标/窗口/持续时间/冷却固定枚举、规则输入与摘要、实例摘要与详情、capability 契约、5 个操作 Schema。
- `src/registry/operations.ts`（修改）— 注册 5 个稳定操作；从 `BLOCKED_OPERATIONS` 移除 `alertsListRulesAndInstances`/`alertsCreateRule`/`alertsGetInstanceDetail`。
- `src/index.ts`（修改）— `export * from './issues-and-alerts/alerts.js';`

**packages/processing-store**
- `migrations/1722500000010_alert-rules-and-instances.ts`（新增）— `alert_rules`/`alert_instances`/`alert_instance_evidence`/`alert_instance_transitions`。
- `src/alert-evaluator.ts`（新增）— 纯函数状态机（`evaluateAlertRule`/`decideAlertNotification`/`classifyAlertObservation`）。
- `src/alert-evaluator-types.ts`（新增）— 评估输入/输出/观测/实例活动类型 + 固定选项常量。
- `src/alert-observation-query.ts`（新增）— `computeAlertObservation`：按规则指标查询真实观测（错误计数/新问题/再次出现/请求失败率/慢请求；性能比例→诚实 paused）。
- `src/alert-rule-repository.ts`（新增）— `createAlertRule`/`updateAlertRule`/`listAlertRules`/`getAlertRule`。
- `src/alert-instance-repository.ts`（新增）— `persistAlertEvaluation`/`queryAlertInstances`/`queryAlertInstanceDetail`/`getActiveAlertInstance`。
- `src/alert-evaluation-round.ts`（新增）— `runAlertEvaluationRound` 编排器。
- `src/alert-types.ts`（新增）— 持久化模型/输入/结果类型。
- `src/index.ts`（修改）— 导出以上。

**apps/platform-api**
- `src/routes/alerts.ts`（新增）— 5 个 handler（授权/CSRF/幂等/审计/错误映射）。
- `src/route-deps.ts`、`src/operations.ts`（修改）— 注册路由 + 操作。

**apps/platform-worker**
- `src/alerts/alert-worker.ts`（新增）— `runAlertEvaluationRound` 封装（可选 worker 段）。
- `src/worker.ts`、`src/config.ts`、`src/index.ts`、`src/start.ts`（修改）— 轮询循环接线 + 配置。

**docs**
- `docs/architecture/alert-evaluation-and-instance-evidence.md`（新增，approved+implemented 正式规格）。

---

## Task 1: Alert rule / instance contract（platform-contract + OpenAPI 再生）

**Files:**
- Create: `packages/platform-contract/src/issues-and-alerts/alerts.ts`
- Modify: `packages/platform-contract/src/index.ts`（追加 export）
- Modify: `packages/platform-contract/src/registry/operations.ts`（注册 + 解锁 BLOCKED）
- Test: `docs/api/platform-openapi-v1.yaml`（再生）+ `pnpm platform-contract-drift test`

**Interfaces:**
- Consumes: `common/schema.ts`（`obj`/`str`/`num`/`optional`/`enum_`/`arr`/`union`/`nullable`）、`common/query.ts` `queryResponse`、`common/command.ts` `commandResponse`、`common/identifiers.ts`（`ProjectId`/`AlertRuleId`/`AlertInstanceId`/`AccountId`）、`common/time.ts` `utcTimestamp`。
- Produces: 常量 `ALERT_METRIC`/`ALERT_WINDOWS_MINUTES`/`ALERT_TRIGGER_DURATIONS_MINUTES`/`ALERT_COOLDOWN_MINUTES`/`ALERT_RATIO_METRICS`/`ALERT_RULE_EVALUATION_STATES`/`ALERT_INSTANCE_STATES`；操作 ID `OPERATION_ID_ALERTS_GET_CAPABILITY`/`OPERATION_ID_ALERTS_LIST`/`OPERATION_ID_ALERTS_CREATE_RULE`/`OPERATION_ID_ALERTS_UPDATE_RULE`/`OPERATION_ID_ALERTS_GET_INSTANCE`；Schema `alertsGetCapabilityResponse`/`alertsListRulesAndInstancesQuery`/`alertsListRulesAndInstancesResponse`/`alertsCreateRuleBody`/`alertsCreateRuleResponse`/`alertsUpdateRulePathParams`/`alertsUpdateRuleBody`/`alertsUpdateRuleResponse`/`alertsGetInstanceDetailPathParams`/`alertsGetInstanceDetailResponse`。

**契约字段（本任务冻结，后续 Task 复用同一类型名）：**

- `AlertMetric` ∈ error_count | new_issue_count | issue_reappearance_count | request_failure_rate | slow_request_count | lcp_ratio | inp_ratio | cls_ratio。
- `AlertRuleEvaluationState` ∈ normal | pending_trigger | triggered | pending_recovery | evaluation_paused。
- `AlertInstanceState` ∈ pending_trigger? 否——实例在完整触发条件满足时创建（PRD §11.2.9 + C10 §7.25"是否已有实例及其关联由正式契约返回"）：实例状态 ∈ triggered | pending_recovery | recovered | evaluation_paused。
- `AlertRuleInput`：`name?`(1..120)、`metric`、`filters`(四维均须为空数组)、`windowMinutes`、`triggerThreshold`(num)、`triggerDurationMinutes`、`recoveryThreshold`、`recoveryDurationMinutes?`(默认=trigger)、`minSampleCount?`、`cooldownMinutes`、`recipientAccountIds`(1..50)。
- `AlertRuleSummary`：`ruleId`、`name?`、`metric`、`windowMinutes`、`triggerThreshold`、`recoveryThreshold`、`recipientAccountIds`、`evaluation`{`state`,`observedValue?`,`sinceAt?`,`lastEvaluatedAt?`,`pauseReason?`}、`version`。
- `AlertInstanceSummary`：`instanceId`、`ruleId`、`ruleName?`、`metric`、`state`、`triggeredAt`、`recoveredAt?`、`pauseReason?`。
- `AlertInstanceDetail`：`instanceId`、`ruleId`、`ruleName?`、`metric`、`state`、`directReason`、`triggeredAt`、`recoveredAt?`、`pauseReason?`、`ruleSnapshot`(安全投影，与当前规则分离)、`evidence`{`evaluatedAt`,`windowStartAt`,`windowEndAt`,`observedValue?`,`numerator?`,`denominator?`,`sampleCount?`,`minSampleRequirement?`,`watermarkAt?`,`completeness`,`pauseReason?`,`appliedFilters`}、`transitions`[]({`from`,`to`,`reason`,`occurredAt`})。
- `AlertCapability`：`metrics`[]({`metric`,`unit`,`direction`,`isRatio`,`minSamplesRequired`,`filterDimensions`[]})、`windowsMinutes`[]、`triggerDurationsMinutes`[]、`cooldownsMinutes`[]、`filterDimensions`[]({`id`,`available`,`reason?`})、`recipients`[]({`accountId`,`maskedEmail`})。

**Operations（5 个稳定操作，注册到 `PLATFORM_OPERATIONS`）：**

| operationId | method | path | authLevel | csrf | idempotency | page | domain |
|---|---|---|---|---|---|---|---|
| `alertsGetCapability` | GET | `/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/capability` | session | — | — | `project.alerts` | issues-and-alerts |
| `alertsListRulesAndInstances` | GET | `/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts` | session | — | — | `project.alerts` | issues-and-alerts |
| `alertsCreateRule` | POST | `/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/rules` | session | true | true | `project.alerts` | issues-and-alerts |
| `alertsUpdateRule` | POST | `/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/rules/:ruleId` | session | true | true | `project.alerts` | issues-and-alerts |
| `alertsGetInstanceDetail` | GET | `/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/instances/:instanceId` | session | — | — | `project.alert-instance-detail` | issues-and-alerts |

- [ ] **Step 1** — 新建 `packages/platform-contract/src/issues-and-alerts/alerts.ts`：定义上述常量、输入/输出类型与 5 组 Schema（参考 `usage.ts`/`request-metrics.ts`/`issue-queries.ts` 的 `obj`/`enum_`/`arr`/`optional`/`queryResponse`/`commandResponse` 用法；`filters` 用 `obj({environment: arr(str(1,256)), release: arr(str(1,256)), pageOrEndpoint: arr(str(1,256)), errorSeverity: arr(str(1,32))})`）。
- [ ] **Step 2** — `registry/operations.ts`：import 5 组 Schema + 操作 ID；追加 5 条稳定操作；从 `BLOCKED_OPERATIONS` 删除 3 条 alerts 项（`alertsListRulesAndInstances`/`alertsCreateRule`/`alertsGetInstanceDetail`）。
- [ ] **Step 3** — `src/index.ts` 追加 `export * from './issues-and-alerts/alerts.js';`。
- [ ] **Step 4** — 再生并验证机器契约：
  Run: `pnpm platform-contract:generate && pnpm platform-contract:drift`
  Expected: OpenAPI 重新生成、`docs/api/platform-openapi-v1.manifest.json` 更新、漂移门禁（含 schema 兼容差异门禁）PASS。
- [ ] **Step 5** — Commit `feat(contract): DAT-19 alert rule/instance contract (5 ops)`。

## Task 2: Evaluation engine（processing-store 纯函数）

**Files:**
- Create: `packages/processing-store/src/alert-evaluator-types.ts`
- Create: `packages/processing-store/src/alert-evaluator.ts`
- Test: `packages/processing-store/test/alert-evaluator.test.ts`

**Interfaces:**
- Consumes: 本包内部类型（Task 3 使用）。
- Produces（Task 3/4 复用）：
  - `type AlertObservation = { kind:'data'; value:number; numerator?:number; denominator?:number; sampleCount?:number; windowStart:number; windowEnd:number; watermark:number } | { kind:'missing'; pauseReason:string; windowStart:number; windowEnd:number }`
  - `interface EvaluateAlertRuleInput { rule: { metric; triggerThreshold; triggerDurationMs; recoveryThreshold; recoveryDurationMs; minSampleCount:number|null; cooldownMs; isRatio:boolean }; observation: AlertObservation; ruleEval: RuleEvaluationState | null; instance: ActiveAlertInstance | null; now: number }`
  - `interface ActiveAlertInstance { state:'triggered'|'pending_recovery'|'evaluation_paused'; triggeredAt:number; recoverySince:number|null; pausedFrom:'triggered'|'pending_recovery'|null; lastNotifiedAt:number|null }`
  - `interface EvaluateAlertRuleResult { ruleEvalNext: RuleEvaluationState | null; since:number|null; transition: { from:string; to:string; reason:string } | null; instanceAction: { action:'none' } | { action:'create' } | { action:'update'; state:'triggered'|'pending_recovery'|'evaluation_paused'; pauseReason?:string; pausedFrom?:string; recoverySince?:number|null } | { action:'recover'; recoveredAt:number }; evidence: AlertEvidenceRecord; notification: 'first_trigger'|'retrigger'|'recovered'|'suppressed'|'none' }`

**状态机（本任务实现，PRD §11.2.4—11.2.10 语义）：**

- `classifyAlertObservation(rule, observation)` → `'breached' | 'recovery_zone' | 'between' | 'insufficient_samples' | 'missing'`。higher-worse：`breached = value > triggerThreshold`；`recovery_zone = value < recoveryThreshold`；`between` 为其余（持续异常）；比例型且 `denominator < minSampleCount` → `insufficient_samples`；missing → `missing`。
- 状态转移（`evaluateAlertRule`）：
  - missing → 规则评估 `evaluation_paused`（`since=null`，暂停原因）；有活动实例 → `instanceAction.update` state=`evaluation_paused`、`pausedFrom`=原实例状态；无实例 → `update` 无（规则级 paused）。
  - insufficient_samples → 同上 `evaluation_paused`（`pauseReason='insufficient_samples'`）。
  - breached：normal/evaluation_paused → `pending_trigger`（`since=now`）；pending_trigger 且 `now-since ≥ triggerDurationMs` → `triggered`（无实例则 `create`，有活动实例则 `update` triggered）；triggered/pending_recovery → `triggered`（持续异常，`recoverySince=null`）。
  - between：pending_trigger → `normal`（取消等待，`since=null`）；triggered → `triggered`（持续异常）；pending_recovery → `triggered`（恢复条件不再满足）。
  - recovery_zone：triggered → `pending_recovery`（`recoverySince=now`）；pending_recovery 且 `now-recoverySince ≥ recoveryDurationMs` → 实例 `recover`（`recoveredAt=now`）、规则评估 `normal`；pending_recovery 未满 → 保持；normal/pending_trigger/无实例 + recovery_zone → `normal`；evaluation_paused（从 paused 恢复）→ 按上次业务状态继续（有活动实例则进入对应分支）。
- `decideAlertNotification(prevEval, nextEval, instance, now, cooldownMs)`：首次 triggered → `first_trigger`；recover → `recovered`；冷却内再触发 → `suppressed`；冷却外再触发 → `retrigger`；持续异常 → `none`。`last_notified_at` 仅在 first_trigger/retrigger/recovered 时更新（由 orchestrator 落库，DAT-19 不发送）。

**证据记录 `AlertEvidenceRecord`：** `{ evaluatedAt; windowStart; windowEnd; observedValue:number|null; numerator?:number; denominator?:number; sampleCount:number|null; minSampleRequirement:number|null; watermark:number|null; completeness:'complete'|'insufficient'|'missing'; pauseReason:string|null; appliedFilters:Readonly<Record<string, readonly string[]>> }`。

- [ ] **Step 1** — 写失败测试 `packages/processing-store/test/alert-evaluator.test.ts`（fake clock `now` 常量推进，禁 sleep）覆盖：threshold 未达→normal；越阈值未满持续时间→pending_trigger；满持续时间→triggered（create）；持续异常保持 triggered；数据缺失→evaluation_paused 且不恢复；恢复区满恢复持续时间→recovered；between 取消 pending_trigger；比例不足→insufficient_samples paused；冷却抑制重触发通知；恢复后通知。
- [ ] **Step 2** — Run: `pnpm --filter @aurora/processing-store test -- alert-evaluator`（Expected: FAIL，模块不存在）。
- [ ] **Step 3** — 实现 `alert-evaluator-types.ts` + `alert-evaluator.ts`（确定性纯函数，无 I/O）。
- [ ] **Step 4** — 重跑（Expected: PASS）。
- [ ] **Step 5** — Commit `feat(processing-store): DAT-19 deterministic alert evaluation engine`。

## Task 3: Evidence / cooldown / recovery state（Migration + Repository + 评估轮询）

**Files:**
- Create: `packages/processing-store/migrations/1722500000010_alert-rules-and-instances.ts`
- Create: `packages/processing-store/src/alert-types.ts`
- Create: `packages/processing-store/src/alert-rule-repository.ts`
- Create: `packages/processing-store/src/alert-instance-repository.ts`
- Create: `packages/processing-store/src/alert-observation-query.ts`
- Create: `packages/processing-store/src/alert-evaluation-round.ts`
- Modify: `packages/processing-store/src/index.ts`

**Interfaces:**
- Consumes: Task 2 的 `evaluateAlertRule`/`decideAlertNotification`/`classifyAlertObservation`。
- Produces（Task 4/worker 复用）：`createAlertRule(pool, input)` / `updateAlertRule(pool, input)` / `listAlertRules(pool, {projectId})` / `getAlertRule(pool, {projectId, ruleId})` / `persistAlertEvaluation(pool, {ruleId, projectId, result})` / `queryAlertInstances(pool, {projectId})` / `queryAlertInstanceDetail(pool, {projectId, instanceId})` / `computeAlertObservation(pool, {rule, now})` / `runAlertEvaluationRound({ pool, now, maxRules? })`。

**Migration 表（本任务冻结）：**

- `alert_rules`：`id` bigserial PK、`project_id` uuid NOT NULL、`name` varchar(120)、`metric` varchar(32) NOT NULL、`filters` jsonb NOT NULL、`window_minutes` int NOT NULL、`trigger_threshold` numeric NOT NULL、`trigger_duration_minutes` int NOT NULL、`recovery_threshold` numeric NOT NULL、`recovery_duration_minutes` int NOT NULL、`min_sample_count` int、`cooldown_minutes` int NOT NULL、`recipient_account_ids` jsonb NOT NULL、`version` int NOT NULL DEFAULT 1、`evaluation_state` varchar(32) NOT NULL DEFAULT 'normal'、`evaluation_since` timestamptz、`last_evaluated_at` timestamptz、`evaluation_pause_reason` varchar(64)、`created_at`/`updated_at` timestamptz NOT NULL DEFAULT now()。约束：metric CHECK（8 值）、window CHECK（1/5/10/30/60）、trigger_duration CHECK（0/1/2/5/10）、cooldown CHECK（5/10/30/60）、recovery_duration ≥ 0、`min_sample_count IS NULL OR min_sample_count > 0`、`jsonb_typeof(filters)='object'`、`jsonb_typeof(recipient_account_ids)='array'`、比例指标必须有 min_sample_count（CHECK）、`evaluation_state` CHECK（normal/pending_trigger/triggered/pending_recovery/evaluation_paused）。索引 `(project_id, updated_at)`。
- `alert_instances`：`id` bigserial PK、`rule_id` bigint NOT NULL REFERENCES alert_rules、`project_id` uuid NOT NULL、`state` varchar(32) NOT NULL、`triggered_at` timestamptz NOT NULL、`recovery_since` timestamptz、`recovered_at` timestamptz、`paused_from` varchar(32)、`pause_reason` varchar(64)、`rule_snapshot` jsonb NOT NULL、`last_notified_at` timestamptz、`version` int NOT NULL DEFAULT 1、`created_at`/`updated_at`。约束：state CHECK（triggered/pending_recovery/recovered/evaluation_paused）、paused_from CHECK（triggered/pending_recovery）、`jsonb_typeof(rule_snapshot)='object'`。索引 `(project_id, state, triggered_at)`、`(rule_id, id)`。
- `alert_instance_evidence`：`id` bigserial PK、`instance_id` bigint NOT NULL UNIQUE REFERENCES alert_instances（1:1 当前证据，状态变化时替换）、`evaluated_at`/`window_start_at`/`window_end_at` timestamptz NOT NULL、`state_after` varchar(32) NOT NULL、`observed_value` numeric、`numerator` numeric、`denominator` numeric、`sample_count` int、`min_sample_requirement` int、`watermark_at` timestamptz、`completeness` varchar(16) NOT NULL CHECK（complete/insufficient/missing）、`pause_reason` varchar(64)、`applied_filters` jsonb NOT NULL DEFAULT '{}'。
- `alert_instance_transitions`：`id` bigserial PK、`instance_id` bigint NOT NULL REFERENCES alert_instances、`from_state` varchar(32) NOT NULL、`to_state` varchar(32) NOT NULL、`reason` varchar(64) NOT NULL、`occurred_at` timestamptz NOT NULL。索引 `(instance_id, occurred_at)`。

**Repository 要点：**
- `createAlertRule`：校验 metric/窗口/持续/冷却固定选项 + 过滤维度全部为空（否则返回 `field_validation`）+ 比例指标必须 min_sample_count + recipient 至少 1；同事务 INSERT + `insertAuditEvent` 由 platform-api 层完成（data 层不跨包写审计）。返回 `{ status:'inserted', ruleId } | { status:'duplicate'|'invalid_input'|'temporarily_unavailable' }`。
- `updateAlertRule`：乐观 `version`（`version_conflict`）；同 create 校验；返回 `{ status:'updated', ruleId, version }`。
- `persistAlertEvaluation`：单事务——更新 `alert_rules` 评估投影（state/since/last_evaluated_at/pause_reason）；按 `instanceAction` create/update/recover 实例；recover 时写终态并保留 rule_snapshot；upsert 当前 evidence；追加 transition；更新 `last_notified_at`（当通知决策为 first_trigger/retrigger/recovered）。
- `computeAlertObservation`：按 metric 查询窗口 `[now-windowMs, now]` 真实数据——
  - error_count：`SELECT count(*) FROM error_event_occurrences WHERE project_id=$1 AND occurred_at >= $2 AND occurred_at <= $3`
  - new_issue_count：`SELECT count(*) FROM issues WHERE project_id=$1 AND first_seen_at >= $2 AND first_seen_at <= $3`
  - issue_reappearance_count：`SELECT count(*) FROM issue_activities WHERE project_id=$1 AND activity_type='reappeared' AND created_at >= $2 AND created_at <= $3`
  - request_failure_rate：`SELECT coalesce(sum(failure_count),0) n, coalesce(sum(observed_count),0) d FROM request_metric_buckets WHERE project_id=$1 AND bucket_start >= $2 AND bucket_start <= $3` → `{ value:n/d*100, numerator:n, denominator:d, sampleCount:d }`；`d < minSampleCount` → orchestrator 以 `insufficient_samples` 观测处理
  - slow_request_count：`sum(slow_count)`
  - lcp/inp/cls_ratio → `{ kind:'missing', pauseReason:'performance_ratio_metric_requires_event_samples' }`（诚实 unavailable）
  - 窗口内无任何相关数据 → `{ kind:'missing', pauseReason:'no_data_in_window' }`
- `runAlertEvaluationRound({ pool, now, maxRules })`：`SELECT ... FROM alert_rules ORDER BY id LIMIT maxRules` → 逐条 `computeAlertObservation` → `evaluateAlertRule` → `persistAlertEvaluation`；单条失败不影响其余（有界错误记录，不抛穿）；返回 `{ evaluatedRules, createdInstances, recoveredInstances, pausedInstances, failedRules }` 计数。

**Integration 覆盖说明**：不单独建 processing-store round 集成测试，避免超出测试预算。`runAlertEvaluationRound` 的端到端真实 PostgreSQL 验证由 Task 4 的唯一 integration 命令（`apps/platform-api/test/integration/alerts-flow.test.ts`）承载：API create rule → seed 数据 → `runAlertEvaluationRound` → API 查询实例/证据。

- [ ] **Step 1** — 实现 Migration `1722500000010_alert-rules-and-instances.ts`（表/约束/索引见上）。
- [ ] **Step 2** — 实现 `alert-types.ts` + `alert-rule-repository.ts` + `alert-instance-repository.ts` + `alert-observation-query.ts` + `alert-evaluation-round.ts`，并在 `src/index.ts` 导出。
- [ ] **Step 3** — 本地验证（真实 PostgreSQL 17 容器）：
  Run: `pnpm --filter @aurora/processing-store typecheck && pnpm --filter @aurora/processing-store test -- alert-evaluator`
  Expected: typecheck PASS；evaluator 单元回归 PASS。
- [ ] **Step 4** — Commit `feat(processing-store): DAT-19 alert rules/instances/evidence storage + evaluation round`（round 的真实 PG 集成由 Task 4 B 承载）。

## Task 4: Query/Command/API integration + focused verification

**Files:**
- Create: `apps/platform-api/src/routes/alerts.ts`
- Modify: `apps/platform-api/src/operations.ts`、`apps/platform-api/src/route-deps.ts`
- Create: `apps/platform-api/test/integration/alerts-flow.test.ts`
- Modify: `apps/platform-worker/src/config.ts`、`apps/platform-worker/src/worker.ts`、`apps/platform-worker/src/index.ts`、`apps/platform-worker/src/start.ts`
- Create: `apps/platform-worker/src/alerts/alert-evaluation-round-worker.ts`（薄封装，调 processing-store `runAlertEvaluationRound`）
- Create: `docs/architecture/alert-evaluation-and-instance-evidence.md`

**Interfaces:**
- Consumes: Task 1 契约 Schema/操作 ID；Task 2/3 processing-store 导出。
- Produces: platform-api 5 handler；worker 轮询段；正式规格。

**Handler 要点（`routes/alerts.ts`，参照 `issues-query.ts`/`issues.ts` 模式）：**
- 共用 `authorizeProjectView`（`requireSession` + `effectivePermissions` + `requireProjectAccess`）与 `authorizeProjectManage`（额外 `getProjectAccessRole` 必须为 org manager 或 `project_admin`）。
- `alertsGetCapability`：返回静态能力契约 + 真实项目成员接收候选（`maskedEmail`，复用 `email-mask.ts`）；filterDimensions 全部 `available:false` + reason（无数据源）。
- `alertsListRulesAndInstances`：`rules` 分区 + `instances` 分区（诚实 `empty`/`available`；实例列表 keyset 分页可省略为 `{status:'available',items,count}`——精确分页契约由实例数上界 `MAX_ALERT_INSTANCES=200` 有界返回 + `totalCountStatus`）。
- `alertsCreateRule` / `alertsUpdateRule`：项目管理员 + CSRF + 幂等（`runIdempotentCommand`）+ 并发 `version` + `insertAuditEvent`（action：`alert_rule_created`/`alert_rule_updated`）。
- `alertsGetInstanceDetail`：项目成员查看；`queryAlertInstanceDetail` 组装 instance + ruleSnapshot + evidence + transitions；跨项目/不存在 → 404 不泄露存在性。
- 错误映射：`ProcessingStoreError`→400/503 稳定映射（复用 `sendMappedError`）。

**Worker 接线：**
- `worker.ts`：`BuildPlatformWorkerInput` 增可选 `alerts?: { maxRules: number }`；`pollOnce` 中调用 `runAlertEvaluationRound({ pool: input.pool, now: new Date(), maxRules: input.alerts.maxRules })`。
- `config.ts`：`alertMaxRules`（`ALERT_MAX_RULES` 默认 100）+ `alertsEnabled`（`ALERTS_EVALUATION_ENABLED` 默认 true）。
- `start.ts`/`index.ts`：组合 root 传入 `alerts`。

**正式规格** `docs/architecture/alert-evaluation-and-instance-evidence.md`：approved+implemented；记录 v1 边界（过滤器无数据源拒绝、性能比例指标 paused、无通知、OPS-06 分离、SDK 事件无 release 不影响本叶）。

**验证（测试预算 §10）：**
- [ ] **Step 1** — `pnpm --filter @aurora/platform-api typecheck` && `pnpm --filter @aurora/processing-store typecheck` && `pnpm --filter @aurora/platform-contract typecheck` && `pnpm --filter @aurora/platform-worker typecheck`（Expected: PASS）。
- [ ] **Step 2** — A（unit，已通过则复用）：`pnpm --filter @aurora/processing-store test -- alert-evaluator`。
- [ ] **Step 3** — B（唯一 integration）：`pnpm --filter @aurora/platform-api test:integration -- alerts-flow`（真实 PostgreSQL + Redis；API create rule → seed 数据 → 调 `runAlertEvaluationRound({ pool, now })` → API 查询实例/详情；断言：非项目管理员 403、过滤器规则 field_validation、实例 triggered → evidence/transitions、审计落库）。
- [ ] **Step 4** — D（contract）：`pnpm platform-contract:generate && pnpm platform-contract:drift`（若 Task 1 已执行且未再改契约，复用结果）。
- [ ] **Step 5** — E：`git diff --check`。
- [ ] **Step 6** — Commit `feat(alerts): DAT-19 platform-api handlers + worker evaluation wiring + spec`。

## 明确的 deferred / out-of-scope

- 通知（D1/G13）、邮件/短信/Webhook、站内通知页、冷却实际发送。
- Console 告警 UI（G12 C10—C12 页面）、图表、规则效果统计。
- OPS-06 operational alert（平台自身可观测性/SLO/Runbook）。
- 动态基线、异常检测、多条件嵌套、告警依赖/升级、值班排班、周期性重复提醒（PRD §11.2.11）。
- 过滤器（environment/release/page_or_endpoint/error_severity）真实数据源（当前事件无对应字段）。
- 性能比例指标真实计算（需逐事件样本，ADR-021 原材料 deferred）。
- 规则启停/删除/复制/批量（PRD/C11 未授权）。
