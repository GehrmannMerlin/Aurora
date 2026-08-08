---
title: Aurora 数据接入端到端容量与韧性基准工具第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/quality
created: 2026-08-02
last-reviewed: 2026-08-02
applies-to: tooling/ingestion-benchmark（@aurora/ingestion-benchmark，私有 Workspace 测试工具）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../architecture/formalization-readiness.md
  - ../architecture/ingestion-http-service.md
  - ../architecture/ingestion-inbox-data-model.md
  - ../architecture/ingestion-inbox-processing-repository.md
  - ../architecture/ingestion-worker-runtime.md
  - ../architecture/ingestion-worker-retry-budget-policy.md
  - ../security/ingestion-client-credential-storage-and-verification.md
  - ../security/ingestion-client-credential-lifecycle.md
  - ../protocol/ingestion-batch-and-receipt-contract.md
  - ../api/ingestion-openapi.md
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../adr/ADR-011-ingestion-http-service-runtime.md
  - ../adr/ADR-012-ingestion-worker-runtime.md
  - ../adr/ADR-013-ingestion-client-credential-storage-and-verification.md
  - ../adr/ADR-014-ingestion-client-credential-lifecycle.md
  - ../adr/ADR-015-ingestion-worker-retry-budget-policy.md
supersedes: none
review-cycle: ingestion-benchmark-method-or-boundary-change
---

# Aurora 数据接入端到端容量与韧性基准工具第一增量

## 1. 定位、效力与当前状态

本文冻结数据接入端到端容量与韧性基准工具第一增量，实施为私有 Workspace 测试工具 `tooling/ingestion-benchmark`（包名 `@aurora/ingestion-benchmark`，`"private": true`）。它承载 ADR-008 后续依赖链第 6 项"容量、故障与成本 benchmark"中**本地、真实 PostgreSQL、完整接入链路**的基准工具部分与第一份本地基线证据。它是测试/开发工具，不是生产运行时包。

**批准状态**：本文于 2026-08-02 由用户预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-02 更新为 `implemented`：`tooling/ingestion-benchmark` 已实施（smoke 与 local-baseline profile、正确性门禁、机器可读 JSON 报告、隔离 Schema 与清理）并通过真实 PostgreSQL 17.10 的 smoke 与 local-baseline 运行及全仓质量门禁。本文由 accepted ADR-004/008/009/010/011/012/013/014/015 与 approved HTTP 服务、Inbox 数据模型、处理侧 Repository、Worker 运行时、retry budget、凭证存储/验证/生命周期规格无歧义派生；自动审批依据见规格自检节。

**声明边界**：本文产生的测量值只代表**当前本机、当前 PostgreSQL、当前配置**。不得将结果描述为生产容量、AWS RDS 容量、生产 SLO 达标、生产成本、跨区域恢复能力或最终推荐配置。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/quality
- **适用范围**：`tooling/ingestion-benchmark` 的 CLI、profile 定义、场景运行器、隔离 Schema 设置/清理、真实凭证创建/撤销、API/Worker 生命周期、synthetic processor、事件负载生成、有界样本采集、百分位计算、正确性断言、JSON 报告写入、脱敏证据 Markdown。
- **明确非职责**：
  - 退避算法、人工重放、具体事件处理器（错误/请求/性能业务 processor）；
  - 数据处理与查询存储、聚合、分组、索引；
  - 凭证管理 HTTP API、管理平台 UI、管理员授权、完整审计；
  - CI 工作流、RDS、IaC、云资源、系统级监控代理；
  - 生产容量/SLO/成本结论与推荐配置；
  - 通用负载测试框架、第三方 histogram 依赖、外部 SaaS/APM。

## 3. 模块选择依据

- ADR-008 后续依赖链第 6 项为"容量、故障与成本 benchmark"，标记 `requires-benchmark`；
- 当前真实链路已闭合：PostgreSQL 17、credentials（存储/验证/生命周期）、ingestion-api（Fastify 5.10.0）、event-schema（信封 + 错误/请求/性能事件契约 + 批次/接收结果协议）、ingestion-inbox（`persistBatch` + 处理侧 Repository）、ingestion-worker（`buildIngestionWorker` + `decideRetryDisposition`）；
- `claimBatchSize`、Worker 并发、`leaseDurationMs`、`leaseRenewIntervalMs`、HTTP 并发、批次大小与 PostgreSQL Pool 参数仍为 `requires-benchmark`，无可重复运行的端到端基准工具、无机器可读基准报告、无本地单机基线证据；
- 仓库核验：不存在 ingestion benchmark 工具、HTTP→Worker 端到端负载生成器、延迟百分位统计、机器可读 benchmark report、隔离 Schema 自动清理、基准配置 profile 或本地基线证据；
- 若上述能力已完整存在并有新鲜证据，则停止报告，不重复实现，也不自动跳到下一个模块。

## 4. 工具包和依赖边界

- 目录：`tooling/ingestion-benchmark`；
- 包名：`@aurora/ingestion-benchmark`；
- `"private": true`；
- 属于测试/开发工具，不是生产运行时包；
- Workspace Policy：新增 `tooling` 层（`allowedLocalDependencyLayers` 增加 `['tooling', new Set(['service', 'data', 'protocol'])`]`）并把 `tooling` 加入 `service` 的允许目标集合（`['protocol', 'data', 'tooling']`）。

允许依赖（均为 devDependencies 或工具运行时依赖）：

- `@aurora/ingestion-api`（包根：`buildIngestionApi`/`startIngestionApi`）；
- `@aurora/ingestion-worker`（包根：`buildIngestionWorker`/`startIngestionWorker`/`IngestionEventProcessor`）；
- `@aurora/ingestion-credentials`（包根：`createIngestionClientCredential`/`revokeIngestionClientCredential`/`generateClientKeyPair`/`verifyIngestionCredential`）；
- `@aurora/ingestion-inbox`（包根：`persistBatch`/`claimAvailable`/`markDeadLettered` 等 + `runMigrations` 等价迁移执行）；
- `@aurora/event-schema`（包根 + `./contract-testkit` 公开子路径）；
- `pg`（8.22.0）；
- 已批准的 Migration 工具（`node-pg-migrate` 9.0.0）。

禁止：

- protocol/data/service/SDK 包依赖 benchmark；
- benchmark 进入生产依赖（`@aurora/ingestion-benchmark` 不被任何 production `dependencies` 引用）；
- benchmark 从私有路径深导入（只从包根/公开子路径导入）；
- benchmark 访问 Browser、Core 或具体 SDK 插件；
- benchmark 创建通用负载测试框架；
- benchmark 依赖云服务。

## 5. 测试环境

- 只使用现有专用 PostgreSQL 17 测试数据库（`AURORA_TEST_DATABASE_URL`，数据库名 `aurora_inbox_test`，角色 `aurora_test` 非 superuser）；
- 必须确认连接目标是测试数据库（数据库名以 `aurora_inbox_test` 开头），否则拒绝启动；
- 不创建 CI、RDS 或 IaC；
- 本机 PostgreSQL 主版本必须为 17.x（`server_version_num` 起始 `170000`），否则退出码 2；
- PostgreSQL 客户端版本在报告中记录（`pg` 包版本）；
- 禁止使用生产数据库、删除测试数据库、输出数据库密码或完整数据库 URL。

## 6. Schema 隔离

每次运行生成唯一隔离 Schema：

- 每次运行生成唯一 `runId`（随机 UUID，不允许 `Math.random`）；
- Schema 名基于 runId 派生（`aurora_bench_<runId 无连字符>`，长度受 PostgreSQL 标识符上限约束）；
- 在测试数据库创建唯一隔离 Schema；
- 在该 Schema 应用全部必要 Migration（Inbox `event_inbox` 初始 + `lease_id` 增量 + credentials `ingestion_client_credentials`/`origins`/`environments`）；
- Migration 通过 `node-pg-migrate` 程序化 runner 执行，`migrationsTable` 使用 `pgmigrations`，运行在隔离 Schema 内（通过 `search_path` 注入）；
- API、credentials、Inbox 和 Worker 的 PostgreSQL Pool 全部通过 `options: '-c search_path=<schema>,public'` 指向同一隔离 Schema（复用 `apps/ingestion-api` 集成测试已验证的 `Pool options` 机制）；
- 基准完成后：停止 API → 停止 Worker → 等待所有任务结束 → 关闭全部 Pool → 删除隔离 Schema → 验证无残留连接与对象；
- 运行失败或中断时也必须执行 finally 清理；
- 不操作其他 Schema，不依赖测试执行顺序。

## 7. 真实凭证

- 使用 `@aurora/ingestion-credentials` 包根的 `createIngestionClientCredential` 生命周期 API 创建临时凭证（真实 PostgreSQL 持久化）；
- 输入：唯一 `projectId`（UUID）、唯一 Origin、唯一 environment、`allowNonBrowser: true`（避免 Origin 依赖）、`expiresAt: null`；
- 完整 `clientKey` 只保存在内存中；
- 不输出 clientKey/secret/digest 到终端、JSON、Markdown 或诊断；
- 基准结束后撤销凭证（`revokeIngestionClientCredential`）或随隔离 Schema 一起清理；
- 不使用 fake authorizer、mock PostgreSQL 或直接调用 route handler 代替真实 HTTP。

## 8. API 与 Worker 生命周期

- API 监听 `127.0.0.1`，端口 `0`（随机分配，不占用固定端口）；
- API 和 Worker 使用**独立** PostgreSQL Pool，模拟独立进程所有权；
- API 通过 `startIngestionApi` 启动（composition root 拥有其 Pool）；`authorizer` 显式注入真实凭证-backed authorizer 或等价（使用 `@aurora/ingestion-credentials` 的 `verifyIngestionCredential` 包装），`admissionPolicy` 使用 `allowAllIngestionAdmissionPolicy`；
- Worker 通过 `buildIngestionWorker` 构造（注入组合的 `IngestionInboxProcessingRepository` 与 synthetic processor），由工具生命周期启动/停止；
- 基准结束后：停止 API（`close()`）、停止 Worker（`stop()`）、关闭全部 Pool；
- 所有 Pool 最终关闭；Schema 完整删除。

## 9. synthetic processor

- synthetic processor 只返回 `processed`（对指定重试场景事件返回 `retry`）；
- 仅存在于 benchmark 工具内部，不从包根导出；
- 不修改生产 Worker processor 契约（`IngestionEventProcessor` 端口不变）；
- processor artificial delay 由 profile 指定（单位毫秒），用于模拟处理耗时；0 表示无人工延迟。

## 10. 事件负载

- 使用 `@aurora/event-schema` 公共入口生成合法事件；
- 优先使用已公开的 `./contract-testkit` 子路径样本作为合法值参考；否则在 benchmark 工具内部创建确定性的合法事件 factory；
- 不使用 event-schema 私有路径；
- 第一增量使用确定性的混合事件：`error`、`request`、`performance`，默认比例各 1/3；
- 正文使用固定、脱敏、最小合法值（参考 contract-testkit 有效样本：error `category: javascript` + 固定 message；request `method`/脱敏 URL/固定 `startedAt`/`durationMs`/`outcome`/`statusCode`；performance `metricCategory`/`metricName`/固定 `value`/`unit`/`startedAt`）；
- `eventId` 由 `runId + 单调序号` 确定；
- `timestamp`（`occurredAt`/`receivedAt`）使用 benchmark 运行时生成（`performance.now()` 派生或确定性递增）；
- 不包含用户输入、Cookie、Authorization 或真实 URL 查询参数；
- 不使用 `Math.random`；同一配置和 seed 产生相同事件类别序列。

## 11. benchmark profile

### 11.1 smoke

用途：工具正确性、本地快速验证、计划实施门禁；**不作为性能结论**。

固定配置：

| 配置项 | 值 |
| --- | --- |
| `warmupEvents` | 100 |
| `measuredEvents` | 500 |
| `batchSize` | 10 |
| `httpConcurrency` | 2 |
| `workerConcurrency` | 2 |
| `claimBatchSize` | 10 |
| API Pool max | 4 |
| Worker Pool max | 4 |
| processor artificial delay | 0 |
| `maxRunDurationMs` | 120000 |

### 11.2 local-baseline

用途：生成第一份本机基线，比较未来代码变更；**不作为生产门禁**。包含三个场景：

**场景 A：低并发单事件**

| 配置项 | 值 |
| --- | --- |
| `warmupEvents` | 200 |
| `measuredEvents` | 2000 |
| `batchSize` | 1 |
| `httpConcurrency` | 1 |
| `workerConcurrency` | 2 |
| `claimBatchSize` | 10 |

**场景 B：常规批次**

| 配置项 | 值 |
| --- | --- |
| `warmupEvents` | 500 |
| `measuredEvents` | 5000 |
| `batchSize` | 10 |
| `httpConcurrency` | 4 |
| `workerConcurrency` | 4 |
| `claimBatchSize` | 20 |

**场景 C：最大批准批次**

| 配置项 | 值 |
| --- | --- |
| `warmupEvents` | 500 |
| `measuredEvents` | 5000 |
| `batchSize` | 50 |
| `httpConcurrency` | 8 |
| `workerConcurrency` | 8 |
| `claimBatchSize` | 50 |

每个场景：

- 最多运行 `300000ms`；超时必须失败并清理；
- 不自动扩大并发；
- 不根据前一个场景结果动态调参；
- 各场景 API/Worker Pool `max` 配置为 `httpConcurrency`/`workerConcurrency` 的明确倍数（场景 A/B/C 分别使用 4/4、8/8、16/16，作为基准场景输入，不是生产默认值）。

## 12. 额外正确性场景

在性能场景之外运行：

- **duplicate 场景**：发送一组已接收 eventId；再次发送同一 projectId/eventId；验证 `duplicate_accepted`；验证 Inbox 记录数没有增加；
- **Worker restart 场景**：领取事件；停止第一个 Worker；等待短测试 lease 到期；启动第二个 Worker；验证事件最终被处理一次；验证旧 lease 不能写回；
- **retry budget 场景**：使用 benchmark 私有 processor，对指定事件在预算耗尽前返回 `retry`；最终验证 `dead_lettered`，`last_error_code` 为 `retry_budget_exhausted`；不对全部性能负载启用 retry。

这些是正确性/韧性证据，不计入主吞吐量结果。不得在本轮模拟真实业务退避算法。

## 13. 计时与统计

- 使用 `performance.now()` 测量进程内耗时；
- PostgreSQL `received_at`/`processed_at` 测量数据库时间线；
- 不使用 `Date.now()` 计算高精度请求延迟；
- 不使用外部 SaaS/APM；
- 第一增量不新增第三方 histogram 依赖；
- 使用有界精确样本：每个 metric 最多保留 `20000` 个样本；超出后必须停止场景或使用规格明确的确定性采样；不允许无界数组。

计算：`count`、`min`、`max`、`mean`、`p50`、`p90`、`p95`、`p99`。

## 14. 百分位算法（冻结）

- 样本升序排序；
- `nearest-rank`：`p(q)` = 排序后第 `ceil((q/100) * n)` 个样本（1-indexed）；
- 空样本显式失败（抛错，不静默返回 NaN）；
- 单样本：所有百分位等于该样本；
- 所有时间统一输出毫秒。

## 15. 吞吐量计算（冻结）

- `requestThroughput = requests / measuredWindowSeconds`（每秒请求数）；
- `eventThroughput = events / measuredWindowSeconds`（每秒事件数）；
- `measuredWindowSeconds` 从第一个 measured 请求开始到最后一个 measured 请求完成（进程内时间）；
- 不把 warmup 计入吞吐量。

## 16. 基准目标（测量项）

1. HTTP 接收吞吐量（每秒请求数）；
2. 每秒接收事件数；
3. HTTP 响应延迟（`performance.now()`）；
4. accepted/duplicate/rejected 数量（来自 HTTP receipt）；
5. 从 HTTP 提交到 Inbox COMMIT 的外部可观察延迟（HTTP 响应时间 + 服务端处理，进程内测量）；
6. 从 `received_at` 到 `processed_at` 的处理延迟（PostgreSQL 时间线）；
7. Worker 完整 drain 时间（从最后一个 HTTP 提交成功到 Inbox 全部 `processed`）；
8. claim、renew、lease lost、retry budget exhausted 数量（来自 Worker 诊断/Inbox 状态）；
9. PostgreSQL Pool：`totalCount`、`idleCount`、`waitingCount`（采样）；
10. benchmark 进程：RSS、heapUsed、CPU user/system time。

这些数据只代表当前本机、当前 PostgreSQL 和当前配置。

## 17. 正确性门禁

每个场景必须验证：

- 请求总数符合预期；
- 事件总数符合预期；
- HTTP 响应都有 `X-Aurora-Request-Id`；
- 无未预期 4xx/5xx；
- `accepted + duplicate + rejected` 数量守恒（等于发送事件数）；
- Inbox 行数正确；
- processed 数量正确；
- 除专门场景外无 `dead_lettered`；
- 无残留 `leased`；
- 无残留 `retry_waiting`；
- 无 lease lost（除专门韧性场景）；
- Worker in-flight 最终为 0；
- API 和 Worker Pool 最终关闭；
- Schema 完整删除。

任一正确性门禁失败：

- 基准运行失败；
- CLI 返回非 0；
- 不生成"成功"基线；
- 不把容量追踪标记为完成。

性能数值低不等于工具失败；只有正确性、超时或资源清理失败才使运行失败。

## 18. 机器可读报告

定义版本化 JSON 报告：

```ts
interface IngestionBenchmarkReport {
  readonly schemaVersion: 1;
  readonly run: BenchmarkRunMetadata;
  readonly environment: BenchmarkEnvironmentMetadata;
  readonly scenarios: readonly BenchmarkScenarioReport[];
  readonly correctness: BenchmarkCorrectnessSummary;
}
```

`BenchmarkRunMetadata` 至少包含：`runId`、`startedAt`、`completedAt`、`profile`、`success`、`gitCommit`（`git rev-parse HEAD` 或 null）、`gitDirty`。

`BenchmarkEnvironmentMetadata` 至少包含：Node.js 版本、pnpm 版本、OS/platform/arch、CPU model 和逻辑核心数、总内存、PostgreSQL `server_version_num`、PostgreSQL client 版本（`pg` 包版本）、API/Worker Pool 配置（max）。

`BenchmarkScenarioReport` 至少包含：`scenario` 输入配置、请求数、事件数、accepted、duplicate、rejected、request throughput、event throughput、HTTP latency percentiles、processing latency percentiles、drain duration、CPU、memory、Pool peak、Worker 诊断计数、correctness checks。

禁止写入：clientKey、secret、digest、数据库 URL、数据库用户名或密码、EventEnvelope body、SQL、HTTP Header、Origin 以外的 URL 数据、原始错误堆栈。

## 19. 输出位置

- 原始 JSON 输出到 `.artifacts/benchmarks/ingestion/`；
- 该目录加入 `.gitignore`；
- 文件名包含 UTC 时间和 profile（如 `ingestion-smoke-20260802T010203Z.json`）；
- 使用临时文件 + 原子 rename 写入；
- 不覆盖已有报告；
- 输出路径可通过 CLI 参数覆盖；自定义输出路径必须进行安全验证（校验 resolve 后仍在允许根目录内，除非用户显式传入绝对路径）；
- 不允许写出项目根目录之外（除非用户显式传入绝对路径）。

生成一份脱敏摘要证据：`docs/testing/evidence/2026-08-02-ingestion-local-baseline.md`。

摘要只包含：环境、profile、各场景配置、测量结果、正确性结果、局限性；不得解释为生产容量的声明；不得把原始 JSON 全量复制进 Markdown。

## 20. CLI

提供确定性 CLI：

```text
pnpm benchmark:ingestion:smoke
pnpm benchmark:ingestion:baseline
```

CLI 必须：

- 检查 `AURORA_TEST_DATABASE_URL`（缺失 → 退出码 1）；
- 检查 PostgreSQL 17（主版本不符 → 退出码 2）；
- 拒绝明显非测试数据库（数据库名不以 `aurora_inbox_test` 开头 → 退出码 2）；
- 显示脱敏后的配置摘要（不显示连接串）；
- 支持 graceful Ctrl+C（SIGINT）；
- 中断后清理；
- 退出码：0 = 完成且正确性通过；1 = 配置或正确性失败；2 = 环境门禁失败。

不自动执行 baseline 作为普通 `pnpm test` 的一部分；不将 baseline 加入 root `check:ci`；smoke 可以由独立验证命令执行，但不得使普通开发测试长期变慢。

## 21. 清理与中断

- 使用 `try/finally` 与进程信号处理保证清理；
- 中断（SIGINT/Ctrl+C）时：停止 Worker → 停止 API → 关闭全部 Pool → 删除隔离 Schema → 验证零残留；
- 清理失败显式报错并返回非 0；
- 不创建 CI/RDS/IaC。

## 22. 安全与隐私

- 凭证（clientKey/secret/digest）不进入任何输出、日志或报告；
- 数据库 URL/用户名/密码不进入报告；
- 事件正文不进入报告；
- 样本有界（每 metric ≤ 20000）；
- 超时有界（每个场景 ≤ 300000ms，smoke ≤ 120000ms）；
- 中断可清理；Schema 隔离；所有 Pool 和进程可释放；
- 不安装系统级监控代理。

## 23. 测试要求

### 23.1 单元测试

至少覆盖：profile 验证；数值上限；百分位（空样本、单样本、有序和无序样本）；throughput 计算；JSON Schema（schemaVersion=1 结构）；原子报告写入；输出路径验证；脱敏（不含凭证/URL/正文）；中断清理；输入不变；不使用 `Math.random`；样本有界。

### 23.2 集成测试

使用真实 PostgreSQL 17：Schema 创建和清理；Migration；凭证创建和授权；HTTP loopback；Inbox COMMIT；Worker processed；duplicate；restart/lease recovery；retry budget；API Pool 和 Worker Pool 关闭；中断后的清理。

### 23.3 smoke

实际执行 `pnpm benchmark:ingestion:smoke`，要求：exit 0；生成合法 JSON；正确性全部通过；无残留 Schema；无密钥泄露。

### 23.4 local-baseline

实际执行 `pnpm benchmark:ingestion:baseline`，要求：三个场景全部完成；正确性全部通过；生成机器可读 JSON；生成脱敏 Markdown 摘要；记录真实数值；不根据结果自动修改生产配置；不将结果描述为最终容量结论。

## 24. 文档证据

- `docs/testing/ingestion-capacity-and-resilience-benchmark.md`（本文）；
- `docs/testing/evidence/2026-08-02-ingestion-local-baseline.md`（脱敏摘要证据）；
- `tooling/ingestion-benchmark/README.md`（模块 README：职责/非职责、CLI、profile、依赖、清理、局限、权威链接）；
- `docs/architecture/formalization-readiness.md`（状态更新）；
- 根 `README.md` 与 `docs/README.md`（如需要链接命令入口）；
- `AGENTS.md`/`AURORA_RULES.md` 当前状态与决策队列同步。

## 25. 局限性

- 结果只代表当前本机、当前 PostgreSQL、当前配置；
- 不表示生产容量、AWS/RDS 性能、生产 SLO 达标、生产成本、跨区域恢复能力或最终推荐配置；
- synthetic processor 不模拟真实业务处理器（真实业务逻辑、Source Map、聚合、告警）；
- 不模拟真实网络拓扑、真实浏览器 SDK、限流、退避、采样；
- 第一增量不测云、多 AZ、故障转移或容量/成本。

## 26. 后续生产/RDS benchmark

- 生产/RDS benchmark、云成本 benchmark、容量/成本模型：`not-started` 或 `blocked`；
- 退避算法：`not-started`；
- 人工重放：`not-started`；
- 具体事件 processor（错误/请求/性能业务处理）：`not-started`；
- 数据处理存储：`not-started`；
- CI、RDS、IaC：`not-started`。

## 27. 排除范围

- 生产容量/SLO/成本结论、推荐配置、生产/RDS/云 benchmark；
- 退避算法、人工重放、具体业务事件 processor；
- 数据处理与查询存储、聚合、分组、索引；
- 凭证管理 HTTP API、管理平台 UI、管理员授权、完整审计；
- CI 工作流、RDS、IaC、云资源、系统级监控代理；
- 通用负载测试框架、第三方 histogram、外部 SaaS/APM；
- 修改 HTTP/OpenAPI、event-schema、receipt、Inbox 或 Worker 公共语义；
- 规划下一模块。

## 28. 规格自检

- **权威一致性**：不修改 HTTP/OpenAPI/event-schema；不修改 Inbox/Worker/credentials 公共语义；不固定生产参数；不宣称生产 SLO；不创建云资源；所有测试使用真实 PostgreSQL 17；
- **兼容性**：ingestion-api 原有测试通过；ingestion-worker 原有测试通过；credentials、Inbox 和 event-schema 回归通过；benchmark 只通过包根依赖；无循环依赖；production package 不依赖 benchmark；
- **计划质量**：每项规格映射到 Task；profile、指标和报告字段全文一致；每个 Task 有 TDD 闭环；无占位；无生产阈值或云成本内容；实施者可只凭计划执行；
- **安全和可靠性**：凭证不进入输出；数据库 URL 不进入报告；事件正文不进入报告；样本有界；超时有界；中断可清理；Schema 隔离；所有 Pool 和进程可释放。

自动审批依据：本文全部语义由 accepted ADR-004/008/009/010/011/012/013/014/015 与 approved HTTP 服务、Inbox 数据模型、处理侧 Repository、Worker 运行时、retry budget、凭证存储/验证/生命周期规格无歧义派生；无新增产品/架构/安全/隐私决策；不修改任何公共契约或固定生产参数；用户已预先批准本消息中的精确基准设计；自检全部通过。本模块不创建 ADR（ADR 规范未要求为测试工具方法或工具边界建立 ADR；不改变系统边界、公共 API、长期基础设施或安全/隐私默认）。
