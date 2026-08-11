---
title: Aurora 可观测性、SLO、运行告警与 Runbook（OPS-06）
status: approved
implementation-status: implemented-in-feature-branch
approval-status: approved
owner: cloud/operations
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to: Aurora 平台运行可观测性——指标/日志契约、SLO/SLI、运行告警、CloudWatch 仪表盘、运维 Runbook；产品告警（DAT-19）明确排除
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - './deployment.md'
  - '../superpowers/specs/2026-07-28-aurora-platform-backend-design.md'
  - '../testing/test-strategy.md'
  - '../operations/runbooks/README.md'
  - './immutable-artifact-deployment-pipeline.md'
  - '../adr/README.md'
supersedes: none
review-cycle: observability-or-alert-policy-change
---

# Aurora 可观测性、SLO、运行告警与 Runbook（OPS-06）

## 1. 定位、效力与当前状态

本文正式承载 OPS-06 叶子模块（observability / SLO / operational alerts / runbooks）。它把已 approved 的[测试/部署/发布设计](../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md) §9（SLO/错误预算）、§12（信号/告警）、[deployment.md](deployment.md) §6 与[后端设计](../superpowers/specs/2026-07-28-aurora-platform-backend-design.md) §14 落为可执行契约与 IaC 接线。

**当前状态**：`status: approved`、`implementation-status: implemented-in-feature-branch`、`approval-status: approved`。契约模块与 ObservabilityStack 已实现并通过本地验证（`tooling/aws-infra` 55 个单测、`cdk synth` 10 模板）。**未执行任何真实 AWS provisioning / CloudWatch 触发**：`PROVISIONING_EVIDENCE_PENDING`；custom metric（`Aurora/Operational`）为 `requires-app-emitter`。阿里云 Preview 保持 `temporary-operational-snapshot`，本模块不修改 `deploy/preview/`。

## 2. 产品告警 ≠ 平台运行告警（强制分离）

- **产品告警**（PRD §11，DAT-19）：用户配置的 Issue/性能告警，属管理平台业务能力，**不在本模块**。
- **平台运行告警**（本模块）：Aurora 平台自身健康——ingestion availability、error rate、processing lag、dead-letter、PostgreSQL、Worker、deployment。
- 运行告警契约每条 `productAlert: false`，`validateOperationalAlertRules` 拒绝任何 `productAlert: true` 规则（`product-alert-forbidden` 违规），从数据层保证两者绝不混入同一业务模型。

## 3. 指标/日志契约

- 命名空间 `Aurora/Operational`（custom metric，`requires-app-emitter`）：`Ingestion.Availability`、`Processing.LagSeconds`、`Processing.DeadLettered`、`Worker.FailureCount`、`Deployment.Failed`。
- `Aurora/Ingestion/ErrorCount`：ingestion-api 日志组 `"level":"error"` 的 Logs metric filter（CDK MetricFilter 无维度）。
- RDS/ECS 原生：`DB.CPUUtilization`/`FreeStorageBytes`/`Connections`（AWS/RDS）、`ECS.RunningTaskCount`（AWS/ECS）。
- 日志字段契约：required `timestamp/level/requestId/operation`；**禁止** password/authorization/cookie/token/email/requestBody/responseBody/sourceMap/fullUrl（测试/部署设计 §12.1；后端设计 §14）。secret-negative 审计在 IaC/契约层强制。

## 4. SLO / SLI / 错误预算

approved 目标（`requires-benchmark`，非已验证保证，test-strategy §6；生产容量证据由 ING-13 补齐）：

| SLO                        | 目标                               |
| -------------------------- | ---------------------------------- |
| 数据接入公开入口月度可用性 | 99.9%                              |
| platform-api 月度可用性    | 99.9%（platform-api 未真实实现）   |
| 已接收事件 60 秒内可查询   | 95%                                |
| 已接收事件 5 分钟内可查询  | 99%                                |
| PostgreSQL 单区域多 AZ     | RPO ≤ 5min / RTO ≤ 60min（OPS-07） |

99.9% ≈ 43.8 错误预算分钟/月；消耗 ≥50% 限高险发布、耗尽暂停非关键发布（测试/部署设计 §9.4）。`calculateErrorBudgetMs`/`errorBudgetConsumedPercent` 为可测纯函数。

## 5. 运行告警规则与接线

`OPERATIONAL_ALERT_RULES`（10 条）经 ObservabilityStack 接线到 CloudWatch：

- **P0**：`ops-deployment-failure`（ECS 部署熔断，数据/用户影响）。
- **P1**：ingestion availability、ingestion error rate、processing lag、processing dead-letter、worker restart、worker down。
- **P2**：PostgreSQL CPU/storage/connections 饱和度。

接线诚实：RDS/ECS 原生接线到真实资源；`Aurora/Ingestion/ErrorCount` 来自 Logs metric filter；`Aurora/Operational` custom metric 告警用 `treatMissingData=NOT_BREACHING`（未发射不误报）。全部告警 `alarmActions` 指向 `aurora-<env>-sns-ops-alerts`（routing）。仪表盘 `aurora-<env>-dashboard-ops` 含 ECS/RDS/processing 组件与 SLO 说明。

## 6. Runbook

`docs/operations/runbooks/` 索引 + 5 份主题 Runbook（ingestion availability、error rate、processing lag/dead-letter、PostgreSQL 饱和度、worker/deployment failure），每份含 frontmatter（title/alert-ids/owner）、症状、首要诊断、恢复、验证。`runbook-contract.test.ts` 强制：每个运行告警规则引用存在的 Runbook，且 frontmatter 字段齐全。

## 7. 未决 / 后续

- `PROVISIONING_EVIDENCE_PENDING`：真实 CloudWatch/SNS/仪表盘 provisioning 需 AWS 凭据（OPS-05 provisioning 后）。
- `requires-app-emitter`：`Aurora/Operational` custom metric（Processing._/Worker._/Deployment.*/Ingestion.Availability）由应用侧 emitter 发射后，对应告警才有真实数据；在此之前 `treatMissingData=NOT_BREACHING` 保证不误报。
- 精确阈值 `requires-benchmark`（ING-13 生产容量证据后锁定）；正式值班渠道/状态页属运营组织缺口，不宣称 24×7。
- 部署后验证（公开 API、队列/Outbox、水位、审计、告警）作为 OPS-05 部署门禁的一部分，随 provisioning 后运行。

## 8. 非职责

本文不实现：产品告警（DAT-19）、备份/恢复/DR/删除重放（OPS-07）、生产容量基准（ING-13/ING-12）、CI workflow（G14）、告警/通知业务 UI。
