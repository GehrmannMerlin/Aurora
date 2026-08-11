---
title: Ingestion Error Rate Elevated
alert-ids: ops-ingestion-error-rate
owner: cloud/operations
---

## 症状

`Aurora/Ingestion/ErrorCount`（ingestion-api 日志组 `"level":"error"` 的 Logs metric filter）在 5 分钟内超过阈值。

## 首要诊断

1. 查 ingestion-api 日志：`aws logs filter-log-events --log-group-name aurora-<env>-logs-ingestion-api --filter-pattern '"level":"error"'`。
2. 区分 4xx（客户端错误，不计可用性分母）与 5xx/服务端错误。
3. 检查请求授权/准入是否出现异常（`verifyIngestionCredential`、admission policy）。

## 恢复

1. 若 5xx 来自 DB/依赖：按 PostgreSQL/worker Runbook 处理。
2. 若来自代码缺陷：回滚到上一 digest（OPS-05 `plan-rollback`），保留日志证据。
3. 若为攻击/扫描：检查 WAF/速率限制（边缘资源随域名落位），必要时临时限流。

## 验证

错误率回落；`Ingestion.Availability` 未跌破 SLO；无 4xx 被误计为服务错误。
