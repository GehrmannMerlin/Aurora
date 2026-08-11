---
title: Worker Down / Deployment Failure
alert-ids: ops-worker-restarts, ops-worker-down, ops-deployment-failure
owner: cloud/operations
---

## 症状

- `Worker.FailureCount`（Aurora/Operational，`requires-app-emitter`）> 3；
- `ECS.RunningTaskCount`（AWS/ECS，ingestion-worker）≤ 0；
- `Deployment.Failed`（Aurora/Operational，`requires-app-emitter`）> 0：ECS 部署熔断触发。

## 首要诊断

1. `aws ecs describe-services`（worker/api service）：部署状态、failure reason、circuit breaker 是否回滚。
2. 查任务日志与退出码；查 `aws ecs describe-task-definition` 的 digest（应 pin 到 CI 构建 digest，非 bootstrap-placeholder）。
3. 若为部署失败：确认健康阈值/min healthy/circuit breaker 已配置（OPS-05），立即回滚到上一 digest。

## 恢复

1. 部署失败（P0）：按 OPS-05 `plan-rollback` 回退 worker/api digest + SPA 入口；**不自动运行破坏性 DB down**；部署窗口保持关闭直至健康。
2. Worker 重启循环：查日志/内存/DB 连接；回滚版本后续跑消费，已可靠接收事实经租约/幂等续跑不丢弃。
3. Worker 完全 down：恢复服务后验证积压水位与 freshness SLO。

## 验证

服务健康（running task count ≥ 1）；部署成功（无熔断）；`POST /v1/batches` 与处理链正常；审计/水位无异常。
