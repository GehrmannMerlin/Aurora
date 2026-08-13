---
title: ING-13 Target PostgreSQL Capacity Resilience and Parameter Evidence Plan
status: approved
owner: ingestion/quality
created: 2026-08-13
last-reviewed: 2026-08-13
applies-to: G08 ING-13——在 TARGET_POSTGRESQL_ENVIRONMENT（47.238.145.24 真实 PostgreSQL 17）真实测量容量/韧性并产出批准参数证据
related:
  - ../../adr/ADR-036-provider-neutral-single-host-deployment.md
  - ../../architecture/aurora-v1-remaining-module-batches.md
  - ../../testing/ingestion-capacity-and-resilience-benchmark.md
  - ../../architecture/ingestion-http-service.md
  - ../../architecture/ingestion-worker-runtime.md
  - ../../operations/public-preview-single-host-deployment.md
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
supersedes: none
---

# ING-13 Target PostgreSQL Capacity Resilience and Parameter Evidence Plan

## 固定回读与权威边界

| 项 | 内容 |
|---|---|
| 目标环境 | TARGET_POSTGRESQL_ENVIRONMENT = 47.238.145.24（阿里云 Linux，provider-neutral 单主机），真实 PostgreSQL 17.10 |
| 不得改变 | 可靠接收语义、Inbox、Worker lease/fencing、事件协议、权限/隐私、ADR-036 单主机方向 |
| 不得使用 | AWS/RDS/Multi-AZ/CDK 作为门禁；开发机 PostgreSQL 冒充目标服务器；真实用户/项目/错误事件数据 |
| benchmark 方法 | 复用 ING-BENCH 既有 load shape / metric / percentile / 安全停止条件，不重造 |

## Task 1：目标环境与 benchmark harness 冻结

采集并冻结目标环境快照（CPU/RAM/磁盘、Docker、PostgreSQL 版本与关键配置、Aurora 容器资源、Inbox 基线），在目标服务器创建隔离测试数据库（`aurora_inbox_test`，非 superuser 角色，绝不触碰 `aurora_preview`），建立安全 TCP 通道连接目标 PostgreSQL；确认 benchmark harness 复用既有 profile/方法不变。

## Task 2：有界容量/韧性测量

在 TARGET_POSTGRESQL_ENVIRONMENT 运行有界 benchmark（warm-up + 少量递增阶段 + recovery observation）：先 smoke（harness 自检），再 local-baseline 三场景（A 低并发单事件 / B 常规批次 / C 最大批准批次）。全程遵守安全停止条件，监控 CPU/memory/disk/连接，逼近危险区立即停，不压垮当前公共 Preview。

## Task 3：参数推导和结果证据

冻结脱敏 benchmark evidence：目标服务器规格、PG 版本、时间、数据规模、并发、批次大小、测量结果（吞吐/延迟 p50/p95、PG 写延迟、Inbox 积压、worker drain、错误率、CPU/memory/disk/连接）、安全容量区间、观察瓶颈、恢复行为、环境限制；从真实测量推导 APPROVED_INGESTION_PARAMETERS（不凭经验捏造、不硬编码 magic number）。

## Task 4：focused verification + ING-13 close

一次 post-benchmark health smoke（确认 aurora_preview 未受影响、Inbox 无残留积压、服务健康）；benchmark evidence consistency check + `git diff --check`；同步 remaining-module-batches 与 AGENTS/AURORA_RULES 状态，关闭 ING-13 叶子（72/6 → 73/5）。

## 自检（§9 十二项）

| # | 检查项 | 结果 |
|---|---|---|
| 1 | benchmark 使用目标服务器 | PASS（SSH tunnel 到 47.238.145.24 真实 PG） |
| 2 | 不用开发机 PostgreSQL 冒充目标 | PASS |
| 3 | 不使用 AWS/RDS | PASS |
| 4 | 不修改业务语义 | PASS |
| 5 | 不使用真实用户数据 | PASS（隔离 schema + synthetic 事件） |
| 6 | benchmark 数据可删除 | PASS（隔离 schema + 测试库） |
| 7 | 不压垮公共 Preview | PASS（有界 + 安全停止） |
| 8 | 不做小时级 soak | PASS |
| 9 | 不跑 root test / 全量 coverage | PASS |
| 10 | 不把测量硬编码进 ING-12 | PASS（先形成批准参数证据） |
| 11 | 结果先形成批准参数证据 | PASS |
| 12 | 服务 benchmark 后恢复健康 | PASS（Task 4 health smoke） |

## 最小验证预算

`benchmark harness 自检`、`bounded target benchmark`、`一次 post-benchmark health smoke`、`benchmark evidence consistency check`、`git diff --check`；仅当代码实际修改才 affected typecheck。禁止 root pnpm check/test/coverage、完整 PG/Worker suite、Browser matrix、Console E2E、SDK tests、其他组测试。
