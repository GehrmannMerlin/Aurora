---
title: Processing Lag / Dead-Letter
alert-ids: ops-processing-lag, ops-processing-dead-letter
owner: data/operations
---

## 症状

- `Processing.LagSeconds`（Aurora/Operational，`requires-app-emitter`）超过 300s：已可靠接收事件未在 60s（95%）/5min（99%）内可查询。
- `Processing.DeadLettered` > 0：事件进入死信（retry budget exhausted / 非法 retry）。

## 首要诊断

1. 查 ingestion-worker ECS：任务数、重启、CPU/内存。
2. 查 Inbox 状态分布（`event_inbox`）：pending/processing/dead_lettered 计数与最老年龄。
3. 查 worker 日志是否有 `retry_budget_exhausted` / processor 异常。

## 恢复

1. Worker 故障/重启循环：回滚到上一 digest（OPS-05 `plan-rollback`，drain-aware），续跑消费。
2. 死信：按 [ingestion-dead-letter-manual-replay](../architecture/ingestion-dead-letter-manual-replay.md) 人工重放（`replayDeadLettered`）；先确认根因，避免重放放大。
3. 积压但 worker 健康：评估并发上限/DB 水位（容量证据需 ING-13），不要仅以 CPU 判断积压。

## 验证

Lag 回落至 SLO；死信重放后事件可查询；不重复计数、不丢已可靠接收事实。
