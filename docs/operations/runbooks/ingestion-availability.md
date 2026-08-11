---
title: Ingestion Availability Below SLO
alert-ids: ops-ingestion-availability
owner: cloud/operations
---

## 症状

`Ingestion.Availability`（Aurora/Operational，`requires-app-emitter`）低于 0.999（月度 SLO 99.9%）。无合法请求被可靠确认接收的比例升高。

## 首要诊断

1. 查看 ingestion-api ECS 服务健康：任务数、重启、CPU/内存（`aurora-<env>-dashboard-ops`）。
2. 查看 ingestion error rate（`ops-ingestion-error-rate`）是否同时触发。
3. 查看 PostgreSQL 连接/CPU/存储（`ops-db-*`）——接收入口依赖 Inbox 事务。

## 恢复

1. 若 ECS 任务不健康：`aws ecs describe-services --services aurora-<env>-service-ingestion-api`，检查部署/运行失败，回滚到上一 digest（OPS-05 `plan-rollback`）。
2. 若 DB 饱和：按 [postgresql-saturation.md](./postgresql-saturation.md) 处理。
3. 若为部署失败：按 [worker-and-deployment-failure.md](./worker-and-deployment-failure.md) 处理。

## 验证

`POST /v1/batches` 冒烟返回确认；`Ingestion.Availability` 回到 0.999 以上；错误预算消耗未超过 50%。
