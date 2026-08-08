# 实施计划：数据接入端到端容量与韧性基准工具第一增量

## 文件头

- 日期：2026-08-02
- 模块：`tooling/ingestion-benchmark`（`@aurora/ingestion-benchmark`，private）
- 正式规格：`docs/testing/ingestion-capacity-and-resilience-benchmark.md`（approved）
- 计划状态：ready-for-implementation
- 目标读者：零上下文工程师
- 权威来源：ACLAUDE.md/AGENTS.md/AURORA_RULES.md 快照、approved 规格、accepted ADR-008/009/010/011/012/013/014/015、approved HTTP 服务/Inbox/处理侧 Repository/Worker 运行时/retry budget/凭证规格

## Goal

在本地真实 PostgreSQL 17 上，通过完整接入链路（真实客户端凭证 → loopback HTTP → ingestion-api → event-schema → PostgreSQL Inbox COMMIT → ingestion-worker claim → synthetic processor → processed）构建可重复运行的端到端容量与韧性基准工具，生成机器可读 JSON 报告与脱敏摘要证据，并产出第一份本地基线（smoke + local-baseline 三场景）。**不**固定生产参数、**不**宣称生产容量/SLO/成本。

## Architecture

```
tooling/ingestion-benchmark/src/
  cli.ts                  # 入口：解析 profile，运行 harness，映射退出码
  configuration.ts        # 冻结 BenchmarkConfig（profile 解析、校验、脱敏摘要）
  profiles.ts             # smoke / local-baseline A/B/C 场景定义
  types.ts                # 报告类型（IngestionBenchmarkReport 等）
  percentiles.ts          # nearest-rank 百分位（有界样本、空样本失败）
  bounded-sample.ts       # 有界样本采集器（≤20000）
  event-factory.ts        # 确定性合法事件（error/request/performance 1:1:1）
  run-id.ts               # 确定性 runId（crypto.randomUUID，非 Math.random）
  schema.ts               # 隔离 Schema 创建/迁移/删除 + search_path Pool 工厂
  credentials.ts          # 真实凭证创建/撤销（createIngestionClientCredential/revoke）
  harness.ts              # 编排：schema→credential→API/Worker→scenario→cleanup
  load-generator.ts       # HTTP 负载生成（fetch loopback、并发、事件批次）
  worker-harness.ts       # Worker 生命周期（buildIngestionWorker + 组合 repository + synthetic processor）
  correctness.ts          # 正确性门禁断言
  report-writer.ts        # 原子 JSON 写入（临时文件+rename、路径安全）
  evidence.ts             # 脱敏 Markdown 摘要
  synthetic-processor.ts  # 只返回 processed（或指定 retry）
  pool-stats.ts           # Pool totalCount/idleCount/waitingCount 采样
tooling/ingestion-benchmark/test/   # 单元测试
tooling/ingestion-benchmark/test/integration/  # 真实 PostgreSQL 集成测试
```

## Tech Stack

- TypeScript 6.0.3（strict，NodeNext，ES2024）、tsx（dev）、vitest 4.1.10（dev）
- 运行时依赖：`pg` 8.22.0、`@aurora/ingestion-api`、`@aurora/ingestion-worker`、`@aurora/ingestion-credentials`、`@aurora/ingestion-inbox`、`@aurora/event-schema`
- 开发依赖：`node-pg-migrate` 9.0.0、`@types/node`、`@types/pg`、`@vitest/coverage-v8`、`typescript`
- **无第三方 histogram、无负载测试框架、无云服务**

## Global Constraints

- 不创建 ADR（ADR 规范未要求；工具/工具边界属已批准架构内实现）。
- 不修改 HTTP/OpenAPI/event-schema/receipt/Inbox/Worker/credentials 公共语义。
- 不使用 `Math.random`；不用 `Date.now()` 测高精度延迟（用 `performance.now()`）。
- 每个 metric 样本 ≤ 20000；场景超时上限 300000ms（smoke 120000ms）。
- 凭证/secret/digest/数据库 URL/事件正文不进入任何输出。
- 所有真实 PostgreSQL 测试使用隔离 Schema；测试目标数据库必须为 `aurora_inbox_test`。
- 不 `git add`/`commit`/`push`；不创建 worktree；不切换分支。
- 结果不描述为生产容量/SLO/成本/最终配置。

## 文件树（完整）

```
tooling/ingestion-benchmark/
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts
  README.md
  src/
    index.ts
    cli.ts
    configuration.ts
    profiles.ts
    types.ts
    percentiles.ts
    bounded-sample.ts
    event-factory.ts
    run-id.ts
    schema.ts
    credentials.ts
    harness.ts
    load-generator.ts
    worker-harness.ts
    correctness.ts
    report-writer.ts
    evidence.ts
    synthetic-processor.ts
    pool-stats.ts
  test/
    percentiles.test.ts
    bounded-sample.test.ts
    event-factory.test.ts
    configuration.test.ts
    profiles.test.ts
    report-writer.test.ts
    evidence.test.ts
    correctness.test.ts
    run-id.test.ts
    security-negative.test.ts
    package-entry.test.ts
    integration/
      schema-isolation.test.ts
      e2e-smoke.test.ts
      e2e-duplicate.test.ts
      e2e-restart.test.ts
      e2e-retry-budget.test.ts
      helpers.ts
```

## 每个文件单一职责

- `src/index.ts`：包根导出（CLI 工厂与报告类型），不执行副作用。
- `src/cli.ts`：解析 `--profile`，运行 `runBenchmark`，按正确性/退出码规范映射退出码；SIGINT 清理。
- `src/configuration.ts`：冻结 `BenchmarkConfig`；校验 profile；生成脱敏摘要字符串。
- `src/profiles.ts`：`smoke`、`local-baseline` 三场景（A/B/C）纯数据定义。
- `src/types.ts`：`IngestionBenchmarkReport` 等全部报告类型（schemaVersion=1）。
- `src/percentiles.ts`：nearest-rank 百分位纯函数。
- `src/bounded-sample.ts`：有界样本采集器（push 后若超限抛错或确定性截断，规格 §13 明确"超出后停止或确定性采样"）。
- `src/event-factory.ts`：确定性合法事件（错误/请求/性能 1:1:1，固定脱敏正文）。
- `src/run-id.ts`：`crypto.randomUUID()` 生成 runId；不从时间派生。
- `src/schema.ts`：隔离 Schema 创建/迁移/删除；`search_path` Pool 工厂。
- `src/credentials.ts`：创建/撤销真实凭证；clientKey 仅内存。
- `src/harness.ts`：顶层编排（schema→credential→API/Worker→scenario→cleanup）。
- `src/load-generator.ts`：HTTP 负载（fetch 127.0.0.1 随机端口、并发、事件批次、记录延迟）。
- `src/worker-harness.ts`：Worker 启动/停止（buildIngestionWorker + 组合 repository + synthetic processor）。
- `src/correctness.ts`：正确性门禁断言。
- `src/report-writer.ts`：原子 JSON 写入 + 路径安全。
- `src/evidence.ts`：脱敏 Markdown 摘要。
- `src/synthetic-processor.ts`：只返回 `processed`（或指定事件返回 `retry`）。
- `src/pool-stats.ts`：Pool `totalCount`/`idleCount`/`waitingCount` 采样。

## 关键设计决策

1. **search_path 隔离**：所有 Inbox/处理/凭证 SQL 均为非限定表名。API 集成测试已证明 `new Pool({ connectionString, options: '-c search_path=<schema>,public' })` 可用。因此全部 Pool（admin、API、Worker）通过该机制指向隔离 Schema。
2. **不使用 `startIngestionApi`/`startIngestionWorker`**（它们硬编码 `new Pool({ connectionString })`，无法注入 search_path）。改用 `buildIngestionApi`（注入带 search_path 的 Pool + authorizer + admissionPolicy）与 `buildIngestionWorker`（注入组合 repository + synthetic processor），由 benchmark 工具自己启动监听/关闭。这完全复用包根公共 API，不触碰私有路径。
3. **HTTP 负载走真实 loopback**：`app.listen({ host: '127.0.0.1', port: 0 })` 后用 `fetch` 真实 HTTP；不直接用 `inject`（规格 §7 要求真实 HTTP）。
4. **凭证允许 Origin**：凭证 `allowNonBrowser: true`，origins 集合含唯一 Origin，environments 含唯一 environment；load-generator 发送 `Origin` header（与 allowlist 精确匹配），发送 `X-Aurora-Client-Key`/`X-Aurora-Environment`。
5. **drain 检测**：Worker 处理完所有 Inbox 记录后（`processed` 数 == inserted 数，且无 `pending`/`leased`/`retry_waiting`）视为 drain 完成；用数据库轮询 + 有界超时。
6. **处理延迟**：从 `event_inbox.received_at` 到 `processed_at`（PostgreSQL 时间线），用 SQL `avg/percentile` 或拉取列计算；第一增量用 SQL `percentile_cont` 计算分位（PostgreSQL 17 原生），或拉到进程内计算；选择拉到进程内用同一 `percentiles.ts` 计算（保证算法一致）。

## 每个 Task 精确路径

### Task 1：包骨架与 Workspace Policy

**Consumes**：无（新包）。
**Produces**：`tooling/ingestion-benchmark/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`；`tooling/workspace-policy/src/graph.ts` 的 tooling 层规则。

1. 失败测试：`tooling/workspace-policy/test/dependency-policy.test.ts` 新增测试断言 `tooling → service/data/protocol` 允许、`service → tooling` 允许（先写测试，确认失败：当前 `tooling` 不在 allowed 映射）。
2. 确认失败。
3. 最小实现：在 `graph.ts` 的 `allowedLocalDependencyLayers` 增加 `['tooling', new Set(['service', 'data', 'protocol'])]`；把 `service` 的允许集合从 `['protocol', 'data', 'tooling']`（已是 `['protocol','data','tooling']`，确认即可）。
4. 确认通过。
5. 回归：`pnpm --filter @aurora/workspace-policy test`、`pnpm check:boundaries`。
6. 提交边界：本 Task 只含 workspace-policy 变更。

### Task 2：包清单与依赖

**Produces**：`tooling/ingestion-benchmark/package.json`（private、exports、aurora.layer: tooling、scripts、dependencies/devDependencies）。

- `scripts`：`build`、`typecheck`、`test`、`test:integration`、`test:coverage`。
- `dependencies`：`pg`、`@aurora/ingestion-api`、`@aurora/ingestion-worker`、`@aurora/ingestion-credentials`、`@aurora/ingestion-inbox`、`@aurora/event-schema`。
- `devDependencies`：`@types/node`、`@types/pg`、`@vitest/coverage-v8`、`node-pg-migrate`、`typescript`、`vitest`、`tsx`。
- 必须 `workspace:*` 协议。
- vitest alias 把 `@aurora/*` 指到各包 src index。
- 失败测试：包入口测试断言 exports 存在；先失败。
- 最小实现：写 package.json；确认通过。

### Task 3：类型与报告 Schema

**Produces**：`src/types.ts`、`src/profiles.ts`、`src/run-id.ts`。

- 失败测试：`test/run-id.test.ts` 断言 runId 为 UUID、两次不同、非 `Math.random` 派生。
- 确认失败；实现；确认通过。

### Task 4：percentiles

**Produces**：`src/percentiles.ts`。

- 失败测试：`test/percentiles.test.ts`：空样本抛错；单样本所有分位等于它；有序/无序样本结果一致；nearest-rank 精确值。
- 确认失败；实现（升序 + `ceil(q/100*n)` 1-indexed）；确认通过。

### Task 5：bounded-sample

**Produces**：`src/bounded-sample.ts`。

- 失败测试：`test/bounded-sample.test.ts`：≤20000 正常；超限抛错或确定性截断（实现选择：抛错——场景超时先于超限，故抛错即场景失败）。
- 确认失败；实现；确认通过。

### Task 6：event-factory

**Produces**：`src/event-factory.ts`。

- 失败测试：`test/event-factory.test.ts`：事件可通过 `parseEventEnvelope`/`parseErrorEventBody`/`parseRequestEventBody`/`parsePerformanceEventBody`；事件类别序列确定性（同 seed 同序列）；不同 seed 序列不同；eventId 单调；不使用 `Math.random`；正文为最小脱敏合法值。
- 确认失败；实现；确认通过。

### Task 7：configuration + profiles

**Produces**：`src/configuration.ts`。

- 失败测试：`test/configuration.test.ts`：profile 缺失/未知/非法抛错；合法冻结；脱敏摘要不含连接串/凭证。
- 确认失败；实现；确认通过。

### Task 8：schema（隔离 + search_path Pool）

**Produces**：`src/schema.ts`。

- 失败测试（集成，真实 PG）：`test/integration/schema-isolation.test.ts`：创建 Schema → 在 Schema 内运行全部 Migration → 断言表存在 → 删除 Schema → 断言无残留。
- 确认失败；实现；确认通过。

### Task 9：credentials

**Produces**：`src/credentials.ts`。

- 失败测试（集成）：创建凭证 → `verifyIngestionCredential` 返回 authorized；撤销后验证返回 unauthenticated；clientKey 只返回一次。
- 确认失败；实现；确认通过。

### Task 10：synthetic-processor + worker-harness

**Produces**：`src/synthetic-processor.ts`、`src/worker-harness.ts`。

- 失败测试（集成）：注入 synthetic processor 的 Worker 处理 Inbox 事件 → `processed`；指定事件返回 retry → `retry_waiting`（budget 未耗尽）。
- 确认失败；实现；确认通过。

### Task 11：load-generator

**Produces**：`src/load-generator.ts`。

- 失败测试（集成）：loopback HTTP → receipt 200 → Inbox 有记录；duplicate 重发 → `duplicate_accepted` 且 Inbox 不增；所有响应有 `X-Aurora-Request-Id`；无未预期 4xx/5xx。
- 确认失败；实现；确认通过。

### Task 12：correctness

**Produces**：`src/correctness.ts`。

- 失败测试：`test/correctness.test.ts`（纯函数）：accepted+duplicate+rejected 守恒；Inbox/processed 计数断言；残留状态检测。
- 确认失败；实现；确认通过。

### Task 13：report-writer

**Produces**：`src/report-writer.ts`。

- 失败测试：`test/report-writer.test.ts`：原子写入（临时文件+rename）、不覆盖已有、路径安全（相对路径解析在根内）、JSON 符合 schemaVersion=1。
- 确认失败；实现；确认通过。

### Task 14：evidence

**Produces**：`src/evidence.ts`。

- 失败测试：`test/evidence.test.ts`：Markdown 只含环境/profile/配置/结果/局限性；不含凭证/URL/正文。
- 确认失败；实现；确认通过。

### Task 15：harness（编排 + 清理 + 中断）

**Produces**：`src/harness.ts`。

- 失败测试（集成）：完整运行一个最小场景 → 正确性通过 → Pool 关闭 → Schema 删除 → 无残留；SIGINT 后清理。
- 确认失败；实现；确认通过。

### Task 16：smoke + local-baseline 端到端

**Produces**：`src/cli.ts`。

- 失败测试：`cli --profile smoke` 退出 0、生成合法 JSON、正确性全通过、无残留。
- 确认失败；实现；确认通过。

### Task 17：包入口 + 私有路径 + 敏感扫描

**Produces**：`src/index.ts`、`test/package-entry.test.ts`、`test/security-negative.test.ts`。

- 失败测试：包入口只导出 CLI 工厂与类型；`@aurora/*` 深导入被拒绝（workspace-policy）；src/test 不含 `console.log` 原始 Error/事件正文/SQLSTATE/数据库 URL/凭证模式。
- 确认失败；实现；确认通过。

### Task 18：README 与正式文档

**Produces**：`tooling/ingestion-benchmark/README.md`、规格实现状态更新、`docs/architecture/formalization-readiness.md`、证据 Markdown。

### Task 19：全仓门禁

运行 §"质量门禁"全部命令。

## CLI 参数

```text
pnpm benchmark:ingestion:smoke       # 等价 node dist/cli.js --profile smoke
pnpm benchmark:ingestion:baseline    # 等价 node dist/cli.js --profile local-baseline
```

可选：`--output-dir <path>`（覆盖 JSON 输出目录；安全验证）；`--out <path>` 覆盖单文件（安全验证）。

## Profile 定义（精确）

见规格 §11。实现为 `profiles.ts` 冻结常量。

## Schema setup/cleanup

```ts
createIsolatedSchema(pool, runId): Promise<string>   // CREATE SCHEMA
applyMigrations(schemaPool, runId): Promise<void>     // node-pg-migrate runner({dbClient})
dropIsolatedSchema(pool, schema): Promise<void>       // DROP SCHEMA ... CASCADE + 残留断言
makeSchemaPool(url, schema): Pool                     // options: '-c search_path=<schema>,public'
```

## Credential setup

```ts
createBenchmarkCredential(pool, runId, projectId, origin, environment):
  Promise<{ clientKey: string; keyId: string }>   // createIngestionClientCredential，仅内存
revokeBenchmarkCredential(pool, keyId): Promise<void>
```

## API/Worker startup

API：`buildIngestionApi({ config, pool: apiPool, authorizer: createPostgresRequestAuthorizer(apiPool), admissionPolicy: allowAllIngestionAdmissionPolicy })` → `app.listen({ host: '127.0.0.1', port: 0 })` → 记录实际端口 → 结束 `app.close()`。

Worker：`buildIngestionWorker({ config, repository: createProcessingRepository(workerPool), processor })` → `start()` → `stop()`。

## Load generator

```ts
runLoad(params: {
  baseUrl; clientKey; environment; origin; projectId;
  warmupEvents; measuredEvents; batchSize; httpConcurrency;
}): Promise<LoadResult>
```

发送 `Origin` header；并发受控；记录每请求 `performance.now()` 延迟；解析 receipt；累计 accepted/duplicate/rejected/requestId。

## Bounded sample collector

```ts
class BoundedSample {
  constructor(limit = 20000);
  push(v: number): void;         // 超限抛错
  toPercentiles(): { count; min; max; mean; p50; p90; p95; p99 };
}
```

## Percentile implementation（冻结）

```ts
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new Error('empty sample');
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((q / 100) * sorted.length) - 1));
  return sorted[idx]!;
}
```

## Correctness assertions

```ts
function assertScenarioCorrect(expect, actual): CorrectnessChecks
// accepted + duplicate + rejected === sentEvents
// inboxCount === expected
// processedCount === expected（除专门场景）
// deadLettered === 0（除专门场景）
// residualLeased === 0; residualRetryWaiting === 0; leaseLost === 0（除专门场景）
// allResponsesHaveRequestId; noUnexpected4xx5xx; workerInFlight === 0
```

## JSON report writer

临时文件 `<dir>/.tmp-<uuid>.json` → `JSON.stringify(report, null, 2)` → `rename` 到 `<dir>/ingestion-<profile>-<UTC time>.json`。路径安全：resolve 后必须位于允许根内或为绝对路径。

## Evidence Markdown

`docs/testing/evidence/2026-08-02-ingestion-local-baseline.md`：环境表、profile、三场景配置、测量结果表、正确性表、局限性声明。不含原始 JSON。

## 实际失败测试 + 预期失败原因

每个 Task 先写失败测试，记录预期失败原因（新功能未实现/断言未满足），确认失败后再实现。

## 精确命令

```text
cd D:/Develop/SDK/Aurora
pnpm --filter @aurora/workspace-policy test
pnpm --filter @aurora/ingestion-benchmark typecheck
pnpm --filter @aurora/ingestion-benchmark test
pnpm --filter @aurora/ingestion-benchmark test:integration
pnpm --filter @aurora/ingestion-benchmark build
pnpm check:boundaries
pnpm benchmark:ingestion:smoke
pnpm benchmark:ingestion:baseline
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:coverage && pnpm check:boundaries && pnpm build && pnpm check:ci
git diff --check
```

## 预期结果

- smoke：exit 0，合法 JSON，正确性全通过，无残留。
- baseline：三场景完成，正确性全通过，生成 JSON + Markdown 摘要。
- 全仓门禁 exit 0。

## 建议提交边界

- Commit 1：workspace-policy tooling 层规则。
- Commit 2：benchmark 包（含测试、README、规格/证据/追踪更新）。

## 根级质量门禁

见 §"精确命令"。

## 禁止

- TODO/TBD/伪代码/模糊占位/未定义 profile/无界样本/生产阈值/生产 SLO 声明/云成本计算/实现退避算法/实现人工重放/修改生产公共契约/规划下一模块。
