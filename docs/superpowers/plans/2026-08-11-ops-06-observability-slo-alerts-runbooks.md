# OPS-06 Observability / SLO / Operational Alerts / Runbooks Implementation Plan

> **For agentic workers:** This plan is executed INLINE by the main session (user override: no subagents, no executing-plans skill). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Aurora 平台**运行可观测性**——指标/日志契约、SLO/SLI、运行告警规则、CloudWatch 仪表盘接线与运维 Runbook，全部可本地验证（契约单测 + `cdk synth` + 文档契约检查），不创建真实 AWS 资源、不触碰阿里云 Preview、不实现产品告警。

**Architecture:** 在 `tooling/aws-infra` 新增 `src/observability/` 纯数据契约模块（`metrics-contract.ts` 指标/日志契约、`slo.ts` SLO 定义与错误预算、`alert-rules.ts` 运行告警规则）与 `src/stacks/observability-stack.ts`（CloudWatch Dashboard + Logs metric filter + 告警 + SNS 路由）。契约全部为可测纯函数；Stack 只接线到已存在的 ECS Service / RDS / Log Group。**产品告警（DAT-19 用户配置的 Issue/性能告警）明确不在本模块**——运行告警契约含 `productAlert: false` 守卫，禁止把产品告警混入同一业务模型。

**Tech Stack:** TypeScript（严格模式、NodeNext ESM）、aws-cdk-lib（`cloudwatch`/`logs`/`ecs`/`rds`/`sns`/`events`）、vitest。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --------- | ------------ | -------- | ------------------------ | -------- |
| OPS-06 | `BASE-PRD`（核心业务 PRD）、`BASE-ARCH`（架构规范）、`BASE-IMPL`（代码/测试/ADR/文档规范）、`ING-BENCH`（[ingestion-capacity-and-resilience-benchmark](../testing/ingestion-capacity-and-resilience-benchmark.md)）、`PLAT-OAPI`（[platform-openapi-and-implementation-design](../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)、[platform-backend-design](../superpowers/specs/2026-07-28-aurora-platform-backend-design.md) §14）、`OPS-QUALITY`（[test-strategy](../testing/test-strategy.md)、[测试/部署/发布设计](../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md)）、`OPS-DELIVERY`（[deployment](../architecture/deployment.md) §6）、`FORM`（[formalization-readiness](../architecture/formalization-readiness.md)、[ADR 索引](../adr/README.md)） | 测试/部署设计 §12.1（信号表）、§9（SLO/错误预算）、Backend Design §14（可观测性信号）；deployment.md §6 | 产品告警（DAT-19，PRD §11）与平台运行告警**绝不混入同一业务模型**；日志/指标标签不得含密码、Cookie、Token、完整邮箱、请求/响应体、Source Map、完整 URL 查询或高基数用户上下文 | 精确阈值/SLO 数值 `requires-benchmark`（ING-13 生产证据前不对外承诺）；真实 CloudWatch 触发/值班渠道需 provisioned 环境（`PROVISIONING_EVIDENCE_PENDING`）；custom metric 需应用侧 emitter（`requires-app-emitter`） |

## Global Constraints

- **产品告警 ≠ 平台运行告警**：产品告警（用户配置的 Issue/性能告警，PRD §11，DAT-19）不进入本模块；本模块只做 Aurora 平台自身运行告警（测试/部署设计 §12.2）。
- SLO 目标（approved，`requires-benchmark` 非已验证保证，test-strategy §6）：数据接入与 `platform-api` 各月度 99.9% 可用性；已接收事件 95% 在 60 秒内、99% 在 5 分钟内可查询；PostgreSQL 单区域多 AZ `RPO ≤ 5min / RTO ≤ 60min`（OPS-07）。99.9% ≈ 43.8 分钟/月错误预算；消耗 50% 限高险发布、耗尽暂停非关键发布（测试/部署设计 §9.4）。
- 指标命名空间 `Aurora/Operational`（平台运行 custom metric）；应用结构化日志与跨系统关联标识；请求标识/业务 Operation/幂等键摘要用途分离（Backend Design §14）。
- 日志、指标标签与 trace 不得保存密码、Cookie、Token、完整邮箱、原始请求/响应体、Source Map、完整 URL 查询或高基数用户上下文（测试/部署设计 §12.1）。
- P0/P1 告警必须对应用户影响或数据风险，含 Owner、仪表盘、首要诊断和 Runbook，不对每个低价值指标直接分页（测试/部署设计 §12.2）。
- **不创建真实 AWS 资源**：只写 IaC + 契约 + 测试；`cdk deploy` 需凭据（`PROVISIONING_EVIDENCE_PENDING`）。
- **不触碰** 阿里云 Preview（`deploy/preview/`）。
- 测试预算（用户限定）：observability config/schema targeted tests、metric/alert rule unit tests、IaC synth/static、Runbook 文档契约检查、受影响 typecheck、secret-negative、`git diff --check`。**禁止**完整应用测试、完整 benchmark、浏览器、PostgreSQL 全套、root coverage。
- 不越界 OPS-05/07；不实现 G08/G04；不实现 DAT-19 产品告警。

---

## File Structure

```
tooling/aws-infra/
  src/observability/
    metrics-contract.ts        # 指标命名空间/名称/维度/来源 + 日志字段契约（纯函数）
    slo.ts                     # SLO 定义 + 错误预算计算（纯函数）
    alert-rules.ts             # 运行告警规则（纯数据） + 校验（productAlert 守卫）
    index.ts                   # 导出
  src/stacks/observability-stack.ts   # CloudWatch Dashboard + Logs metric filter + 告警 + SNS 路由
  src/stacks/compute-stack.ts  # Modify: 导出 logGroups
  src/app.ts                   # Modify: 接线 ObservabilityStack
  test/
    observability/metrics-contract.test.ts
    observability/slo.test.ts
    observability/alert-rules.test.ts
    observability/runbook-contract.test.ts   # 每个告警规则都有对应 Runbook 文件
    observability/observability-stack.test.ts # synth 断言
docs/operations/
  runbooks/
    README.md                  # Runbook 索引
    ingestion-availability.md
    ingestion-error-rate.md
    processing-lag-dead-letter.md
    postgresql-saturation.md
    worker-and-deployment-failure.md
docs/architecture/
  observability-slo-alerts-runbooks.md   # OPS-06 正式规格
```

接口契约（跨任务复用）：

- `src/observability/metrics-contract.ts` 导出 `OPERATIONAL_NAMESPACE = 'Aurora/Operational'`、`type MetricSeverity = 'P0'|'P1'|'P2'`、`type MetricSource = 'app-emitter'|'logs-metric-filter'|'cloudwatch-native'`、`interface OperationalMetric { name; unit: 'Seconds'|'Count'|'Percent'; dimensions: readonly string[]; source; description }`、`OPERATIONAL_METRICS: readonly OperationalMetric[]`、`interface LogFieldContract { requiredFields; forbiddenFields }`、`LOG_FIELD_CONTRACT`、`function assertSafeLogField(field: string): void`、`function validateOperationalMetric(metric): void`。
- `src/observability/slo.ts` 导出 `interface SloDefinition { id; target; windowDays; denominatorMetric?; numeratorMetric?; note }`、`AURORA_SLOS: readonly SloDefinition[]`、`function calculateErrorBudgetMs(slo): number`、`function errorBudgetConsumedPercent(slo, consumedMs): number`。
- `src/observability/alert-rules.ts` 导出 `interface OperationalAlertRule { id; title; severity: MetricSeverity; metric; statistic; periodSeconds; evaluationPeriods; threshold; comparisonOperator; runbook; productAlert: false }`、`OPERATIONAL_ALERT_RULES: readonly OperationalAlertRule[]`、`function validateOperationalAlertRules(rules): readonly string[]`（空 = 通过；含 productAlert 守卫与 runbook 引用完整性）。
- `ObservabilityStack` 构造签名 `new ObservabilityStack(scope, id, { env, services, logGroups, database })`，导出 `dashboard`、`alarms: Readonly<Record<string, cloudwatch.Alarm>>`、`alarmTopic`。
- `ComputeStack` 新增导出 `logGroups: Readonly<Record<string, logs.ILogGroup>>`。

---

### Task 1: Runtime metrics/logging contract

**Files:**
- Create: `tooling/aws-infra/src/observability/metrics-contract.ts`, `tooling/aws-infra/src/observability/index.ts`, `tooling/aws-infra/test/observability/metrics-contract.test.ts`

**Interfaces:**
- Produces: `OPERATIONAL_NAMESPACE`、`OperationalMetric`、`OPERATIONAL_METRICS`、`LOG_FIELD_CONTRACT`、`assertSafeLogField`、`validateOperationalMetric`（签名见上）。

- [ ] **Step 1: 写失败测试** `metrics-contract.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  OPERATIONAL_METRICS,
  OPERATIONAL_NAMESPACE,
  assertSafeLogField,
  validateOperationalMetric,
} from '../../src/observability/metrics-contract.js';

describe('operational metrics contract', () => {
  it('defines the Aurora/Operational namespace with the platform-run metrics', () => {
    expect(OPERATIONAL_NAMESPACE).toBe('Aurora/Operational');
    const names = OPERATIONAL_METRICS.map((m) => m.name);
    expect(names).toContain('Ingestion.Availability');
    expect(names).toContain('Processing.LagSeconds');
    expect(names).toContain('Processing.DeadLettered');
    expect(names).toContain('Worker.FailureCount');
  });

  it('validates every metric definition', () => {
    for (const metric of OPERATIONAL_METRICS) {
      expect(() => validateOperationalMetric(metric)).not.toThrow();
    }
  });

  it('rejects a metric with a forbidden dimension or invalid unit', () => {
    expect(() =>
      validateOperationalMetric({
        name: 'Bad.Metric',
        unit: 'Bytes',
        dimensions: ['password'],
        source: 'app-emitter',
        description: 'x',
      }),
    ).toThrow();
  });

  it('rejects forbidden log fields (secrets / privacy)', () => {
    expect(() => assertSafeLogField('requestId')).not.toThrow();
    expect(() => assertSafeLogField('password')).toThrow('forbidden_log_field');
    expect(() => assertSafeLogField('authorization')).toThrow('forbidden_log_field');
    expect(() => assertSafeLogField('requestBody')).toThrow('forbidden_log_field');
  });
});
```

- [ ] **Step 2: 运行确认失败**：`pnpm --filter @aurora/aws-infra test` → 新契约测试失败（文件不存在）。

- [ ] **Step 3: 实现** `metrics-contract.ts`：`OPERATIONAL_NAMESPACE`；`OPERATIONAL_METRICS` 冻结数组（Ingestion.Availability(Percent, app-emitter)、Ingestion.ErrorCount(Count, logs-metric-filter)、Processing.LagSeconds(Seconds, app-emitter)、Processing.DeadLettered(Count, app-emitter)、Worker.FailureCount(Count, app-emitter)、Deployment.Failed(Count, events/cloudwatch-native)；全部 dimensions 含 `environment`）；`LOG_FIELD_CONTRACT`（required: timestamp/level/requestId/operation；forbidden: password/authorization/cookie/token/email/requestBody/responseBody/sourceMap/fullUrl）；`validateOperationalMetric`（unit∈枚举、dimensions 无 forbidden 字段、name 非空、source 枚举，非法抛 `ops_metric_*`）；`assertSafeLogField`（forbidden 命中抛 `ops_forbidden_log_field`）。`index.ts` 重导出。

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/aws-infra test` 全绿；typecheck 通过。

- [ ] **Step 5: Commit**：`feat(obs): OPS-06 runtime metrics + logging contract`.

---

### Task 2: SLO + operational alert rules

**Files:**
- Create: `tooling/aws-infra/src/observability/slo.ts`, `tooling/aws-infra/src/observability/alert-rules.ts`, `tooling/aws-infra/test/observability/slo.test.ts`, `tooling/aws-infra/test/observability/alert-rules.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `OperationalMetric`、`MetricSeverity`、`OPERATIONAL_METRICS`。
- Produces: `SloDefinition`、`AURORA_SLOS`、`calculateErrorBudgetMs`、`errorBudgetConsumedPercent`；`OperationalAlertRule`、`OPERATIONAL_ALERT_RULES`、`validateOperationalAlertRules`。

- [ ] **Step 1: 写失败测试**。

`slo.test.ts`：99.9% 月度错误预算 ≈ 43.8 分钟（`Math.round(calculateErrorBudgetMs(ingestionAvailabilitySlo) / 60000)` = 44 分钟窗口断言以毫秒精度）；消耗 50% 触发限门禁阈值；`AURORA_SLOS` 覆盖 ingestion 99.9%、platform-api 99.9%、freshness 95%/60s 与 99%/5min（freshness 标 `requires-benchmark`）。

`alert-rules.test.ts`：规则 id 唯一；每条规则 `productAlert === false`（产品告警守卫）；severity ∈ P0/P1/P2；threshold 为正；periodSeconds/evaluationPeriods 为正；comparisonOperator ∈ 已知枚举；`runbook` 以 `../operations/runbooks/` 开头；`validateOperationalAlertRules` 对插入 `productAlert: true` 的规则返回 `product-alert-forbidden` 违规。

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3a: 实现 `slo.ts`**：

```ts
export interface SloDefinition {
  readonly id: string;
  readonly target: number;          // 0.999 = 99.9%
  readonly windowDays: number;
  readonly numeratorMetric?: string; // availability = numerator / denominator
  readonly denominatorMetric?: string;
  readonly note: string;            // e.g. 'requires-benchmark'
}

export const AURORA_SLOS: readonly SloDefinition[] = Object.freeze([
  { id: 'ingestion-availability', target: 0.999, windowDays: 30, numeratorMetric: 'Ingestion.SuccessfulRequests', denominatorMetric: 'Ingestion.Requests', note: 'approved target; requires-benchmark' },
  { id: 'platform-api-availability', target: 0.999, windowDays: 30, numeratorMetric: 'PlatformApi.SuccessfulRequests', denominatorMetric: 'PlatformApi.Requests', note: 'approved target; platform-api not yet real' },
  { id: 'processing-freshness-95-60s', target: 0.95, windowDays: 30, note: 'events queryable within 60s; requires-benchmark' },
  { id: 'processing-freshness-99-5m', target: 0.99, windowDays: 30, note: 'events queryable within 5min; requires-benchmark' },
]);

export function calculateErrorBudgetMs(slo: SloDefinition): number {
  return Math.floor((1 - slo.target) * slo.windowDays * 24 * 60 * 60 * 1000);
}

export function errorBudgetConsumedPercent(slo: SloDefinition, consumedMs: number): number {
  const budget = calculateErrorBudgetMs(slo);
  if (budget <= 0) throw new Error('ops_slo_invalid_budget');
  return Math.min(100, (consumedMs / budget) * 100);
}
```

- [ ] **Step 3b: 实现 `alert-rules.ts`**（运行告警规则，10 条；每条 `productAlert: false` 与对应 Runbook 引用）：

```ts
import type { MetricSeverity } from './metrics-contract.js';

export interface OperationalAlertRule {
  readonly id: string;
  readonly title: string;
  readonly severity: MetricSeverity;
  readonly metric: string;                       // OPERATIONAL_NAMESPACE 下的 custom metric，或 cloudwatch 原生（RDS/ECS/Logs）
  readonly statistic: 'Sum' | 'Average' | 'Maximum';
  readonly periodSeconds: number;
  readonly evaluationPeriods: number;
  readonly threshold: number;
  readonly comparisonOperator:
    | 'GreaterThanThreshold'
    | 'GreaterThanOrEqualToThreshold'
    | 'LessThanThreshold'
    | 'LessThanOrEqualToThreshold';
  readonly runbook: string;                      // ../operations/runbooks/<name>.md
  readonly productAlert: false;                  // 产品告警（DAT-19）绝不进入运行告警模型
}

export const OPERATIONAL_ALERT_RULES: readonly OperationalAlertRule[] = Object.freeze([
  { id: 'ops-ingestion-error-rate', title: 'ingestion error rate elevated', severity: 'P1', metric: 'Aurora/Ingestion/ErrorCount', statistic: 'Sum', periodSeconds: 300, evaluationPeriods: 2, threshold: 10, comparisonOperator: 'GreaterThanThreshold', runbook: '../operations/runbooks/ingestion-error-rate.md', productAlert: false },
  { id: 'ops-ingestion-availability', title: 'ingestion availability below SLO', severity: 'P1', metric: 'Ingestion.Availability', statistic: 'Average', periodSeconds: 300, evaluationPeriods: 3, threshold: 0.999, comparisonOperator: 'LessThanThreshold', runbook: '../operations/runbooks/ingestion-availability.md', productAlert: false },
  { id: 'ops-processing-lag', title: 'processing lag exceeds freshness SLO', severity: 'P1', metric: 'Processing.LagSeconds', statistic: 'Maximum', periodSeconds: 300, evaluationPeriods: 3, threshold: 300, comparisonOperator: 'GreaterThanThreshold', runbook: '../operations/runbooks/processing-lag-dead-letter.md', productAlert: false },
  { id: 'ops-processing-dead-letter', title: 'dead-lettered events detected', severity: 'P1', metric: 'Processing.DeadLettered', statistic: 'Sum', periodSeconds: 300, evaluationPeriods: 1, threshold: 0, comparisonOperator: 'GreaterThanThreshold', runbook: '../operations/runbooks/processing-lag-dead-letter.md', productAlert: false },
  { id: 'ops-db-cpu', title: 'postgres cpu saturation', severity: 'P2', metric: 'DB.CPUUtilization', statistic: 'Average', periodSeconds: 300, evaluationPeriods: 3, threshold: 80, comparisonOperator: 'GreaterThanThreshold', runbook: '../operations/runbooks/postgresql-saturation.md', productAlert: false },
  { id: 'ops-db-storage', title: 'postgres free storage low', severity: 'P2', metric: 'DB.FreeStorageBytes', statistic: 'Average', periodSeconds: 300, evaluationPeriods: 3, threshold: 5368709120, comparisonOperator: 'LessThanThreshold', runbook: '../operations/runbooks/postgresql-saturation.md', productAlert: false },
  { id: 'ops-db-connections', title: 'postgres connection saturation', severity: 'P2', metric: 'DB.Connections', statistic: 'Maximum', periodSeconds: 300, evaluationPeriods: 3, threshold: 100, comparisonOperator: 'GreaterThanThreshold', runbook: '../operations/runbooks/postgresql-saturation.md', productAlert: false },
  { id: 'ops-worker-restarts', title: 'worker task down / restart loop', severity: 'P1', metric: 'Worker.FailureCount', statistic: 'Sum', periodSeconds: 300, evaluationPeriods: 3, threshold: 3, comparisonOperator: 'GreaterThanThreshold', runbook: '../operations/runbooks/worker-and-deployment-failure.md', productAlert: false },
  { id: 'ops-worker-down', title: 'worker healthy task count zero', severity: 'P1', metric: 'ECS.RunningTaskCount', statistic: 'Average', periodSeconds: 300, evaluationPeriods: 3, threshold: 0, comparisonOperator: 'LessThanOrEqualToThreshold', runbook: '../operations/runbooks/worker-and-deployment-failure.md', productAlert: false },
  { id: 'ops-deployment-failure', title: 'ecs deployment circuit breaker fired', severity: 'P0', metric: 'Deployment.Failed', statistic: 'Sum', periodSeconds: 300, evaluationPeriods: 1, threshold: 0, comparisonOperator: 'GreaterThanThreshold', runbook: '../operations/runbooks/worker-and-deployment-failure.md', productAlert: false },
]);

const OPERATORS = new Set(['GreaterThanThreshold', 'GreaterThanOrEqualToThreshold', 'LessThanThreshold', 'LessThanOrEqualToThreshold']);

export function validateOperationalAlertRules(rules: readonly OperationalAlertRule[]): readonly string[] {
  const violations: string[] = [];
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) violations.push(`duplicate-id:${rule.id}`);
    ids.add(rule.id);
    if (rule.productAlert !== false) violations.push(`product-alert-forbidden:${rule.id}`);
    if (rule.severity !== 'P0' && rule.severity !== 'P1' && rule.severity !== 'P2') violations.push(`invalid-severity:${rule.id}`);
    if (!Number.isFinite(rule.threshold)) violations.push(`invalid-threshold:${rule.id}`);
    if (rule.periodSeconds <= 0 || rule.evaluationPeriods <= 0) violations.push(`invalid-window:${rule.id}`);
    if (!OPERATORS.has(rule.comparisonOperator)) violations.push(`invalid-operator:${rule.id}`);
    if (!rule.runbook.startsWith('../operations/runbooks/')) violations.push(`invalid-runbook-ref:${rule.id}`);
  }
  return Object.freeze(violations);
}
```

> 说明：`metric` 字段值 `Aurora/Ingestion/ErrorCount` 为 Logs metric filter 命名空间下的派生指标名，`Ingestion.Availability`/`Processing.*`/`Worker.FailureCount`/`Deployment.Failed` 为 `Aurora/Operational` custom metric（`requires-app-emitter`）；`DB.*`/`ECS.RunningTaskCount` 由 ObservabilityStack 映射到 RDS/ECS 原生指标。真实阈值 `requires-benchmark`（ING-13）。

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/aws-infra test` 全绿；typecheck 通过。

- [ ] **Step 5: Commit**：`feat(obs): OPS-06 SLO definitions + operational alert rules`.

---

### Task 3: Dashboards / observability wiring（ObservabilityStack）

**Files:**
- Create: `tooling/aws-infra/src/stacks/observability-stack.ts`, `tooling/aws-infra/test/observability/observability-stack.test.ts`
- Modify: `tooling/aws-infra/src/stacks/compute-stack.ts`（导出 `logGroups`）、`tooling/aws-infra/src/app.ts`（接线）

**Interfaces:**
- Consumes: Task 1/2 的 `OPERATIONAL_ALERT_RULES`、`OPERATIONAL_METRICS`、`OPERATIONAL_NAMESPACE`；`ComputeStack.logGroups`。
- Produces: `ObservabilityStack`（`dashboard`、`alarms`、`alarmTopic`）。

- [ ] **Step 1: 写失败测试** `observability-stack.test.ts`：

```ts
// 组装 network/compute/data + observability；断言：
// - AWS::CloudWatch::Dashboard 存在且名字含 'aurora-<env>-dashboard-ops'
// - AWS::Logs::MetricFilter 存在（ingestion-api 日志组 error filter）
// - 告警数 >= 10（含 ops-deployment-failure P0）
// - 每个告警 AlarmActions 指向 SNS topic（routing）
// - 无 product-alert 命名空间资源、无 secret 明文文本
// - ECS/RDS 原生指标告警（DB.CPUUtilization / ECS.RunningTaskCount）接线到真实资源
```

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3a: ComputeStack 导出 logGroups**：在容器创建处把 `logGroup` 存入 `this.logGroups[spec.repoKey] = logGroup`，类型 `Readonly<Record<string, logs.ILogGroup>>`。

- [ ] **Step 3b: 实现 `observability-stack.ts`**：
  - `alarmTopic = new sns.Topic`（`resourceName(env,'sns','ops-alerts')`）；
  - Logs metric filter：`new logs.MetricFilter(this, 'IngestionErrorFilter', { logGroup: logGroups['ingestion-api'], metricNamespace: 'Aurora/Ingestion', metricName: 'ErrorCount', filterPattern: logs.FilterPattern.literal('"level":"error"'), metricValue: '1' })`；
  - 告警循环 `OPERATIONAL_ALERT_RULES`：按 `metric` 前缀映射到 `cloudwatch.Metric` 构造（`Aurora/` → `OPERATIONAL_NAMESPACE` custom metric + `environment` dimension；`DB.` → RDS 原生（`AWS/RDS`，DBInstanceIdentifier）；`ECS.RunningTaskCount` → ECS 服务维度；`Ingestion.Availability`/`Processing.*`/`Worker.FailureCount`/`Deployment.Failed` → `OPERATIONAL_NAMESPACE` custom metric），`metric.statistic/period` 来自规则，`threshold/comparisonOperator/evaluationPeriods` 来自规则，`alarmName = resourceName(env,'alarm',rule.id)`，`alarmDescription` 含 title + runbook 引用，`alarmActions: [alarmTopic]`，`treatMissingData: cloudwatch.TreatMissingData.notBreaching`（custom metric 未发射不误报）；存入 `this.alarms[rule.id]`；
  - Dashboard：`new cloudwatch.Dashboard(this, 'OpsDashboard', { dashboardName: resourceName(env,'dashboard','ops') })`，widgets：文本标题（含环境、SLO 摘要、`PROVISIONING_EVIDENCE_PENDING` 说明、无 secret）、ECS 服务 CPU/内存与 running task count（每服务 1 个 metric widget）、RDS CPU/storage/connections、ingestion error count（Logs 派生）、custom 处理链路指标（Processing.LagSeconds/DeadLettered）；每个 widget `period: 300`，并给 `ops-deployment-failure` 提示；
  - 全部资源经 `Tags.of(...).add(standardTags)`。

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/aws-infra test` 全绿；`pnpm --filter @aurora/aws-infra synth` 生成含 Observability 栈的 8 模板（4 栈 × 2 环境）。

- [ ] **Step 5: Commit**：`feat(obs): OPS-06 cloudwatch dashboard + alarms + sns routing`.

---

### Task 4: Runbooks + focused verification

**Files:**
- Create: `docs/operations/runbooks/README.md`、`ingestion-availability.md`、`ingestion-error-rate.md`、`processing-lag-dead-letter.md`、`postgresql-saturation.md`、`worker-and-deployment-failure.md`
- Create: `tooling/aws-infra/test/observability/runbook-contract.test.ts`
- Create: `docs/architecture/observability-slo-alerts-runbooks.md`

**Interfaces:**
- Consumes: Task 2 的 `OPERATIONAL_ALERT_RULES`（runbook 引用）。

- [ ] **Step 1: 写失败测试** `runbook-contract.test.ts`：遍历 `OPERATIONAL_ALERT_RULES`，断言 `runbook` 引用相对路径在 `docs/operations/runbooks/` 下存在文件；断言每个 Runbook 文件头含 YAML frontmatter（`title`/`severity`/`alert-ids`/`owner`）。

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3: 写 Runbook**（每份含 frontmatter + 症状 + 关联告警 id + 首要诊断 + 恢复步骤 + 验证 + Owner）：`README.md` 索引全部运行告警 id → Runbook 文件映射；五份主题 Runbook 覆盖 ingestion availability、error rate、processing lag/dead-letter、PostgreSQL 饱和度、worker/deployment failure。

- [ ] **Step 4: 运行确认通过**：`runbook-contract.test.ts` 全绿。

- [ ] **Step 5: 正式规格 + 文档同步**。创建 `docs/architecture/observability-slo-alerts-runbooks.md`（`status: approved`、`implementation-status: implemented-in-feature-branch`；覆盖指标/日志契约、SLO/SLI、运行告警、产品告警分离、仪表盘、Runbook、`requires-app-emitter`/`PROVISIONING_EVIDENCE_PENDING` 记录）。`AGENTS.md`/`AURORA_RULES.md` 的 G16/OPS-06 条目在最终收尾 Task 统一同步。

- [ ] **Step 6: 定向验证（用户限定）**：`pnpm --filter @aurora/aws-infra test`（含 observability 全套）、`typecheck`、`synth`（8 模板）、`secret-negative`（`grep -rnE 'AKIA|BEGIN .*PRIVATE KEY|aurora_ingest_|SecretAccessKey' tooling/aws-infra/src/observability tooling/aws-infra/src/stacks/observability-stack.ts docs/operations/runbooks docs/architecture/observability-slo-alerts-runbooks.md` → 0 命中）、`git diff --check` 干净、Runbook 文档契约测试。**禁止**完整应用测试/浏览器/PostgreSQL 全套/root coverage。本地 `pnpm check:boundaries` 因 `examples/sdk-reference` 本地目录缺失 package.json 而失败（`KNOWN_BASELINE_DEBT`，非本轮 diff，CI 无此目录）——记录并继续，不修复用户未跟踪目录。

- [ ] **Step 7: Commit**：`feat(obs): OPS-06 runbooks + observability spec`.

---

## Self-Review

**Spec coverage（OPS-06 要求）**：关键 health/metrics = Task 1（指标契约 + 日志契约）；SLO/SLI = Task 2（SLO 定义 + 错误预算）；ingestion availability = Task 3（Logs metric filter + custom metric 告警）；processing freshness/lag = Task 2/3（Processing.LagSeconds 告警，`requires-app-emitter`）；error rate = Task 3（Logs metric filter + 告警）；dead-letter = Task 2/3（Processing.DeadLettered）；PostgreSQL = Task 3（DB.* 原生告警）；Worker = Task 2/3（Worker.FailureCount + ECS running task count）；deployment = Task 2/3（Deployment.Failed P0 + EventBridge 接线说明）；operational Runbook = Task 4。**产品告警（DAT-19）与运行告警分离** = Task 2 `productAlert: false` 守卫 + Task 4 文档显式区分。**无敏感日志** = Task 1 forbidden 字段 + secret-negative 审计。

**Placeholder scan**：无 "TBD/TODO"。占位仅为**账号/域名/凭据**（approved 契约）与 custom metric **`requires-app-emitter`**（诚实标注，不伪造已发射）。

**Type consistency**：`OperationalMetric`/`OPERATIONAL_METRICS`/`LOG_FIELD_CONTRACT`/`assertSafeLogField`/`validateOperationalMetric`、`SloDefinition`/`AURORA_SLOS`/`calculateErrorBudgetMs`/`errorBudgetConsumedPercent`、`OperationalAlertRule`/`OPERATIONAL_ALERT_RULES`/`validateOperationalAlertRules`、`ObservabilityStack`（`dashboard`/`alarms`/`alarmTopic`）在 Task 1—4 间一致；`ComputeStack.logGroups` 由 Task 3 新增导出并被 ObservabilityStack 消费。

**本计划不创建真实 AWS 资源、不运行 `cdk deploy`、不修改 `deploy/preview/`、不实现 DAT-19 产品告警、不越界 OPS-05/07。**
