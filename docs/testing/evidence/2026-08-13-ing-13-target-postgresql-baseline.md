---
title: Aurora ING-13 目标 PostgreSQL 容量/韧性基准证据
status: approved
owner: ingestion/quality
created: 2026-08-13
last-reviewed: 2026-08-13
applies-to: G08 ING-13——TARGET_POSTGRESQL_ENVIRONMENT（47.238.145.24 真实 PostgreSQL 17）有界容量/韧性测量与批准参数
related:
  - ../../testing/ingestion-capacity-and-resilience-benchmark.md
  - ../../architecture/aurora-v1-remaining-module-batches.md
  - ../../adr/ADR-036-provider-neutral-single-host-deployment.md
  - ../../operations/public-preview-single-host-deployment.md
  - ../../protocol/ingestion-batch-and-receipt-contract.md
supersedes: none
---

# Aurora ING-13 目标 PostgreSQL 容量/韧性基准证据

## 1. 目标环境（TARGET_POSTGRESQL_ENVIRONMENT）

| 项 | 值 |
|---|---|
| Host | 47.238.145.24（阿里云 Linux，provider-neutral 单主机） |
| CPU | 8 逻辑核，Intel(R) Xeon(R) Platinum |
| 内存 | 15.8 GiB（totalMemoryBytes=15801147392） |
| 磁盘 | 99G 总量，约 37G 可用（62% 已用） |
| Docker | 29.6.2 |
| PostgreSQL | 17.10（`server_version_num=170010`，Alpine musl） |
| PG 关键配置 | `max_connections=100`、`shared_buffers=128MB`、`work_mem=4MB`、`maintenance_work_mem=64MB`、`max_wal_size=1GB`、`effective_cache_size=4GB` |
| 当前 Aurora 容器 | postgres/redis/ingestion-api/platform-api 均 healthy，ingestion-worker/platform-worker/console Up |
| Inbox 基线 | `event_inbox` 仅 1 条 `processed`，无积压；连接数 8 |

测量在服务器上以容器方式运行（`aurora-bench`，`aurora-preview-private` 网络，连接 `postgres:5432` 隔离测试库 `aurora_inbox_test`），复用 `tooling/ingestion-benchmark` 既有 load shape / metric / nearest-rank percentile / 正确性门禁 / 隔离 Schema，**未重新发明 benchmark**。

## 2. benchmark 时间与数据规模

- 时间：2026-08-13（UTC ~02:55 smoke，~02:56 baseline）。
- 隔离：每次运行唯一 `aurora_bench_<runId>` Schema，结束后完整删除（残留 0）。
- 合成事件：error/request/performance 各 1/3，固定脱敏最小合法值，无真实用户/项目/错误事件。

## 3. 测量结果（local-baseline 三场景，42/42 正确性 PASS）

| 场景 | 事件数 | HTTP 请求 | batch | http 并发 | worker 并发 | 事件吞吐 | HTTP p50/p95 | 处理延迟 p50 | drain |
|---|---|---|---|---|---|---|---|---|---|
| A 低并发单事件 | 2200 | 2200 | 1 | 1 | 2 | 144.5 ev/s | 6.4 / 8.9 ms | 22.0 ms | 15.2 s |
| B 常规批次 | 5500 | 550 | 10 | 4 | 4 | 422.7 ev/s | 25.0 / 34.9 ms | 5.6 s | 13.0 s |
| C 最大批准批次 | 5500 | 110 | 50 | 8 | 8 | 685.1 ev/s | 152.0 / 184.7 ms | 3.5 s | 8.0 s |

- accepted/duplicate/rejected：三场景全部 `accepted=N, duplicate=0, rejected=0`，守恒。
- 正确性：requests/events/inbox 行数/processed 计数守恒、全部有 `X-Aurora-Request-Id`、无未预期 4xx/5xx、无 dead_lettered、无 residual leased/retry_waiting、无 lease lost、worker in-flight 0、Pool 关闭、Schema 删除。
- 处理延迟为 `received_at → processed_at` 数据库时间线（synthetic processor delay=0），反映 worker drain + PG 写路径，非真实业务处理。

## 4. 观察到的瓶颈与安全容量区间

- 场景 C（batch 50 / 并发 8）出现 API Pool `waitingCount=4` 峰值，说明并发 8 已逼近当前 Pool 上限；场景 B（batch 10 / 并发 4）无等待，为无争用运行点。
- 安全容量区间：**约 420 events/s（无争用）～ 685 events/s（有争用上限）**；单事件低并发下 HTTP p95 < 9ms。
- 环境限制：单主机 PostgreSQL `shared_buffers=128MB` 未调优、`max_connections=100`；处理延迟随批次/并发增大而上升，由 worker drain 速率主导。

## 5. 恢复行为

- 有界 load spike 后 worker 能完整 drain（三场景 backlog 均归零，无 residual leased/retry_waiting/dead_lettered）。
- retry/dead-letter/bounded queue 语义未被 benchmark 改坏（正确性门禁 42/42 PASS）。
- post-benchmark 健康：`aurora_preview` Inbox 仍 1 条 processed、连接数回到 8、7 个 Aurora 容器健康，测试库残留 schema 0。

## 6. APPROVED_INGESTION_PARAMETERS（来自本次真实测量）

| 参数 | 值 | 来源 |
|---|---|---|
| `maxEventsPerBatch` | 50 | 协议冻结（batch contract `maxEventsPerBatch=50`），场景 C 实测安全 |
| `approvedSustainableEventsPerSecond` | 400 | 保守取场景 B 无争用 422.7 ev/s 之下的安全地板（≈95%） |
| `approvedMaxHttpConcurrency` | 8 | 场景 C 实测；更高并发逼近 Pool 争用 |
| `approvedRequestBodyLimitBytes` | 1048576 | 既有传输配置（非 benchmark 派生，为协议/传输约束） |
| 目标环境规格 | 8 vCPU / 15.8 GiB / PG 17.10 | §1 快照 |

以上值仅代表当前单主机、当前 PostgreSQL、当前配置；**不得解释为生产 SLA 达标、多 AZ/跨区域能力或最终推荐配置**。ING-12 必须把这些值读入 typed production policy，禁止以无来源 magic number 直接写入阈值。

## 7. 环境限制与局限

- 单主机 `shared_buffers=128MB`、无 Multi-AZ、无跨区域；`OFF_HOST_BACKUP_RECOMMENDED` 为非本轮 blocker。
- synthetic processor 不模拟真实业务处理器（Source Map/聚合/告警）。
- 原始 JSON 报告：`.artifacts/benchmarks/ingestion/ingestion-local-baseline-2026-08-13T025612846Z.json`（gitignored，本机可复现）。
