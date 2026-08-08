# @aurora/ingestion-benchmark

Aurora 数据接入端到端容量与韧性基准工具第一增量。测试/开发工具，**不是生产运行时包**。

## 职责 / 非职责

**职责**

- 在本地真实 PostgreSQL 17 上跑通完整接入链路：真实客户端凭证 → loopback HTTP → `ingestion-api` → `event-schema` → PostgreSQL Inbox COMMIT → `ingestion-worker` claim → synthetic processor → processed；
- 运行 `smoke` 与 `local-baseline` 两个 profile，产出机器可读 JSON 报告与脱敏 Markdown 摘要；
- 每次运行使用唯一隔离 Schema，结束或失败时完整清理；
- 测量 HTTP 吞吐、事件吞吐、HTTP/处理延迟百分位、drain 耗时、Pool 峰值与 Worker 诊断计数。

**非职责**

- 不固定生产参数，不宣称生产容量/SLO/成本/最终推荐配置；
- 不实现退避算法、人工重放、具体业务事件处理器；
- 不创建 CI/RDS/IaC/云资源，不安装系统级监控代理；
- 不修改 HTTP/OpenAPI/event-schema/receipt/Inbox/Worker/credentials 公共语义。

## 运行

前置：`AURORA_TEST_DATABASE_URL` 指向专用测试数据库（数据库名 `aurora_inbox_test`），PostgreSQL 17。

```bash
pnpm benchmark:ingestion:smoke       # 工具正确性 + 本地快速验证
pnpm benchmark:ingestion:baseline    # 三场景本地基线
```

等价命令（可从任意工作目录运行）：

```bash
tsx tooling/ingestion-benchmark/src/entry.ts --profile smoke
tsx tooling/ingestion-benchmark/src/entry.ts --profile local-baseline
```

退出码：`0` 完成且正确性通过；`1` 配置或正确性失败；`2` 环境门禁失败（无测试库 URL / 非 PostgreSQL 17 / 非测试数据库）。

## Profile

- `smoke`：warmup 100、measured 500、batch 10、http 并发 2、worker 并发 2、claimBatch 10，最长 120000ms。
- `local-baseline`：三个场景（A 低并发单事件 / B 常规批次 / C 最大批准批次），每场景最长 300000ms。

具体值见 `src/profiles.ts` 与[正式规格](../../docs/testing/ingestion-capacity-and-resilience-benchmark.md)。

## 输出

- JSON 报告：`.artifacts/benchmarks/ingestion/ingestion-<profile>-<UTC>.json`（`.gitignore` 忽略），临时文件 + 原子 rename，不覆盖已有报告；
- 脱敏摘要：`docs/testing/evidence/2026-08-02-ingestion-local-baseline.md`。

报告**从不包含** clientKey/secret/digest、数据库 URL/用户名/密码、EventEnvelope body、SQL、HTTP Header、原始错误堆栈。

## 隔离

- 每次运行创建唯一 `aurora_bench_<runId>` Schema，应用 Inbox + credentials 全部 Migration；
- API 与 Worker 使用独立 PostgreSQL Pool（`search_path` 指向隔离 Schema）；
- 每场景使用独立 projectId 与临时凭证（`createIngestionClientCredential`，clientKey 仅内存），结束后撤销；
- 运行结束或失败都执行 finally 清理：停止 Worker → 停止 API → 关闭 Pool → 删除 Schema → 校验零残留。

## 测试

```bash
pnpm --filter @aurora/ingestion-benchmark test            # 单元测试（不依赖数据库）
pnpm --filter @aurora/ingestion-benchmark test:integration # 真实 PostgreSQL 17 集成测试
pnpm --filter @aurora/ingestion-benchmark typecheck
pnpm --filter @aurora/ingestion-benchmark build
```

集成测试覆盖：Schema 创建/迁移/删除、完整链路 smoke、duplicate 语义、Worker restart/lease recovery、retry budget dead-letter。

## 依赖

- 运行时：`pg`、`@aurora/ingestion-api`、`@aurora/ingestion-worker`、`@aurora/ingestion-credentials`、`@aurora/ingestion-inbox`、`@aurora/event-schema`；
- 开发：`node-pg-migrate`、`fastify`（类型）、`tsx`、`vitest` 等；
- 只通过各包根/公开子路径导入；不创建通用负载框架；不依赖云服务。

## 局限

结果只代表当前本机、当前 PostgreSQL、当前配置；不构成生产容量、AWS/RDS 性能、生产 SLO、成本或最终推荐配置的证据。synthetic processor 不模拟真实业务处理器。

## 权威链接

- [正式规格](../../docs/testing/ingestion-capacity-and-resilience-benchmark.md)（approved / implemented）
- [实施计划](../../docs/superpowers/plans/2026-08-02-ingestion-capacity-and-resilience-benchmark.md)
- [正式化追踪](../../docs/architecture/formalization-readiness.md)
