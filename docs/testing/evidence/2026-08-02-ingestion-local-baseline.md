# Aurora 数据接入本地基准证据（2026-08-02）

> 本摘要只记录当前本机、当前 PostgreSQL、当前配置的测量结果，**不构成生产容量、生产成本、生产 SLO 达标或最终推荐配置的证据**。

## 环境

- runId: `00e2a3ea-1aca-4a4a-b456-b124c885589e`
- profile: `local-baseline`
- success: `true`
- Node.js: `v24.18.0`
- pnpm: `11.17.0`
- OS: `win32 x64`
- CPU: `12th Gen Intel(R) Core(TM) i7-12650H`（16 逻辑核心）
- 总内存: 13.0 GiB
- PostgreSQL server_version_num: `170010`
- PostgreSQL client: `8.22.0`
- API Pool max: 4
- Worker Pool max: 4

## 各场景配置

| 场景 | warmup | measured | batch | http并发 | worker并发 | claimBatch |
| --- | --- | --- | --- | --- | --- | --- |
| A-low-concurrency-single-event | 200 | 2000 | 1 | 1 | 2 | 10 |
| B-regular-batch | 500 | 5000 | 10 | 4 | 4 | 20 |
| C-max-approved-batch | 500 | 5000 | 50 | 8 | 8 | 50 |

## 测量结果

| 场景 | 请求数 | 事件数 | accepted | duplicate | rejected | 请求/秒 | 事件/秒 | HTTP p50 (ms) | HTTP p95 (ms) | HTTP p99 (ms) | 处理 p50 (ms) | 处理 p95 (ms) | 处理 p99 (ms) | drain (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-low-concurrency-single-event | 2200 | 2200 | 2200 | 0 | 0 | 80.0 | 80.0 | 10.6 | 22.3 | 25.0 | 28.5 | 45.4 | 67.0 | 27489.0 |
| B-regular-batch | 550 | 5500 | 5500 | 0 | 0 | 34.8 | 348.0 | 23.8 | 33.3 | 45.4 | 7094.3 | 11804.3 | 12021.0 | 15805.4 |
| C-max-approved-batch | 110 | 5500 | 5500 | 0 | 0 | 11.7 | 583.6 | 145.8 | 226.4 | 416.7 | 3844.9 | 7019.2 | 7199.6 | 9424.1 |

## 正确性结果

- **A-low-concurrency-single-event**: 全部通过
- **B-regular-batch**: 全部通过
- **C-max-approved-batch**: 全部通过

## 局限性

- 只代表当前本机、当前 PostgreSQL、当前配置；
- 不表示生产容量、AWS/RDS 性能、生产 SLO 达标、生产成本或最终推荐配置；
- synthetic processor 不模拟真实业务处理器（Source Map、聚合、告警等）。
