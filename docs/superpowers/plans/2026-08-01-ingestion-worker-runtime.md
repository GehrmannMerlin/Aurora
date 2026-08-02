# Ingestion Worker 运行时与处理器编排第一增量 (Worker 运行时、claim 循环、lease 续期与 graceful shutdown 第一增量) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `apps/ingestion-worker`（包名 `@aurora/ingestion-worker`，`"private": true`）冻结并实施数据接入 Worker 运行时与处理器编排第一增量：typed 配置、Worker 生命周期（created/running/stopping/stopped）、claim 循环、显式并发上限、`IngestionEventProcessor` 处理器端口与编排、lease 自动续期、lease lost 处理、graceful shutdown、PostgreSQL Pool 与 Processing Repository 组合、有界诊断，以及真实 PostgreSQL 17 并发/续租/关闭/双 Worker 集成测试。这是 ADR-008 Worker 波次第 2 个独立增量，由 accepted ADR-012 授权 Node.js 24 原生异步运行时；**不**实现具体事件处理器、Worker retry/dead-letter policy、退避算法、人工重放或数据处理存储。

**Architecture:** `buildIngestionWorker` 构建运行时（不创建 Pool、不关闭调用方依赖）；`startIngestionWorker` 为 composition root（读环境变量、验证配置、创建 Pool 与 Processing Repository、启动、注册 SIGTERM/SIGINT、启动失败回滚、Pool 只关闭一次）。运行循环使用 Node 原生 async/Promise；一次 claim 循环结束再开始下一轮（不使用 `setInterval` 驱动重叠轮询）；并发由 `maxConcurrentHandlers` 显式控制；所有定时通过可注入 sleeper/timer 端口。每个 in-flight 任务独立 lease 续租控制（`renewLease`），lease lost 通过 `AbortSignal` 通知处理器并禁止最终写回。graceful shutdown 冻结顺序：停止新 claim → 继续续租 → 等待 in-flight（≤ shutdownGracePeriodMs）→ 宽限期后 Abort → 停止续租 → 清理 timer → 关闭 Worker → 最后关闭 Pool。

**Tech Stack:** Node.js ≥24.18.0（Node 24 原生异步）、TypeScript 6.0.3、Vitest 4.1.10、pnpm 11.17.0、`@aurora/ingestion-inbox`（包根：`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered`）、`@aurora/event-schema`（包根：`EventEnvelope`、`IngestionErrorCode`）。不引入 BullMQ、Redis、SQS、Kinesis、cron 或第三方调度框架。

**Plan status:** ready-for-implementation（本消息已预先批准无歧义派生的规格与计划；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 只修改 `apps/ingestion-worker`（新增 `src/*.ts`、`test/*.test.ts`、`test/integration/*.test.ts`、`README.md`、`package.json`、`tsconfig*.json`、`vitest.config.ts`）与相关索引文档（`docs/architecture/formalization-readiness.md`、`docs/adr/README.md`、ADR-012 追加记录、根 `package.json` 的 format/lint 清单、根 `pnpm-workspace.yaml` 若需要）。
- 完全复用 `@aurora/ingestion-inbox` 包根公共处理 API；**不修改** Inbox 状态集合、租约、fencing 语义、ACK/幂等/receipt、`event-schema`、`apps/ingestion-api`、OpenAPI。
- 状态集合不变：`pending`/`leased`/`retry_waiting`/`processed`/`dead_lettered`。
- 处理器端口最小且稳定；结果只允许 `processed`/`retry`/`dead-letter`；`retry`/`dead-letter` 必须显式提供稳定脱敏 `IngestionErrorCode`；运行时不自行决定重试/死信。
- 不固定任何 policy/benchmark 数值；配置项全部显式传入；`leaseRenewIntervalMs < leaseDurationMs`；`maxConcurrentHandlers <= claimBatchSize`。
- 生命周期：`created` → `running` → `stopping` → `stopped`；单实例停止后不可重启；重复 start 拒绝；重复 stop 幂等。
- 不使用真实长时间 `sleep` 作为测试同步；使用 fake clock/timer port、Promise barrier、明确 deferred、数据库状态断言。
- 真实 PostgreSQL 集成测试使用 `AURORA_TEST_DATABASE_URL`；确认目标是测试数据库（`aurora_inbox_test` 前缀）；独立 Schema/命名空间隔离；清理失败显式报错；禁止 SQLite/mock/PGlite 替代证据。
- 诊断禁止记录 EventEnvelope 正文、原始 Error 对象、SQL/SQLSTATE/constraint 名、完整数据库 URL、客户端密钥、HTTP Header、完整堆栈、用户输入；每实例有界。
- 不调用 `process.exit()`；不留下未处理 Promise；关闭后禁止重新 start 同一实例。
- 覆盖率 lines ≥85 / branches ≥80 / functions ≥85 / statements ≥85。
- 生产启动必须显式提供处理器 composition；不得提供永远成功、丢弃事件或空操作的生产默认处理器；测试注入 fake processor。
- ADR 状态：ADR-008 `accepted / in-progress`；ADR-010 `accepted / implemented`；ADR-011 `accepted / in-progress` 不变；ADR-012 由 `accepted / not-started` 更新为 `accepted / in-progress`（真实实施并验证后）。

---

## 文件树

```text
apps/ingestion-worker/
├── package.json                         # Create：@aurora/ingestion-worker，private，type module，Node 24，aurora.layer: service
├── tsconfig.json                        # Create：extends ../../tsconfig.base.json，noEmit，include src/test/vitest.config.ts
├── tsconfig.build.json                  # Create：emit dist，include src，exclude test
├── vitest.config.ts                     # Create：alias @aurora/event-schema / @aurora/ingestion-inbox → src，include test/**/*.test.ts
├── README.md                            # Create：模块职责/非职责/接口/配置/命令/文档契约
└── src/
    ├── index.ts                         # Create：包根公共出口
    ├── configuration.ts                 # Create：IngestionWorkerConfig + loadIngestionWorkerConfig（冻结 typed config）
    ├── processor.ts                     # Create：IngestionEventProcessor / ProcessIngestionEventInput / ProcessIngestionEventResult 端口
    ├── diagnostics.ts                   # Create：WorkerDiagnostic 稳定字段 + WorkerDiagnostics 有界环形缓冲
    ├── timers.ts                        # Create：TimerPort/SleeperPort 可注入端口 + defaultSleeper/delay
    ├── worker-runtime.ts                # Create：buildIngestionWorker 构建运行时 + WorkerRuntime 生命周期/claim/renew/shutdown 编排
    └── start.ts                         # Create：composition root startIngestionWorker（读 env、建 Pool、建 Repository、启动、信号、回滚）
└── test/
    ├── configuration.test.ts            # Create [ENV-INDEPENDENT]：config 校验与冻结
    ├── processor.test.ts                # Create [ENV-INDEPENDENT]：处理器端口类型与结果判别
    ├── diagnostics.test.ts              # Create [ENV-INDEPENDENT]：诊断有界与字段冻结
    ├── timers.test.ts                   # Create [ENV-INDEPENDENT]：timer/sleeper 端口
    ├── worker-lifecycle.test.ts         # Create [ENV-INDEPENDENT]：生命周期状态/重复 start/重复 stop/stopped 不可重启
    ├── worker-claim-loop.test.ts        # Create [ENV-INDEPENDENT]：claim 循环/容量/空队列/idle/停止后不再 claim
    ├── worker-renew.test.ts             # Create [ENV-INDEPENDENT]：续租调度/停止/lease lost Abort（fake clock）
    ├── worker-shutdown.test.ts          # Create [ENV-INDEPENDENT]：shutdown 顺序/grace 超时 Abort/不强制改状态
    ├── worker-orchestration.test.ts     # Create [ENV-INDEPENDENT]：处理器结果映射/异常不标记成功/继续其他事件
    ├── package-entry.test.ts            # Create [ENV-INDEPENDENT]：包根出口 + 私有路径负例 + manifest
    ├── documentation-contract.test.ts   # Create [ENV-INDEPENDENT]：README/规格契约
    ├── security-negative.test.ts        # Create [ENV-INDEPENDENT]：src/test 敏感信息扫描
    └── integration/
        ├── helpers.ts                   # Create [PG]：testDatabaseUrl/assertIsTestDatabase/createTestPool/migrationsUp/clean
        ├── worker-e2e.test.ts           # Create [PG-GATED]：claim→处理→processed/retry/dead-letter
        ├── worker-concurrency.test.ts   # Create [PG-GATED]：并发上限/claim 不超过容量/空队列等待/停止不再 claim
        ├── worker-renew.test.ts         # Create [PG-GATED]：长任务 renewLease/完成后停止 renew/lease lost 中止
        ├── worker-shutdown.test.ts      # Create [PG-GATED]：grace 内完成/超时 Abort/不强制改状态/Pool 释放/重复 stop
        └── worker-two-workers.test.ts   # Create [PG-GATED]：双 Worker 并发不重复处理同一 lease
```

每个文件单一职责；不创建具体事件处理器、重试算法、人工重放或 Worker policy。

---

## Consumes / Produces 总览

- **Consumes**：`docs/architecture/ingestion-worker-runtime.md`（approved 规格）、`docs/adr/ADR-012-ingestion-worker-runtime.md`（accepted）、`docs/architecture/ingestion-inbox-processing-repository.md`、`@aurora/ingestion-inbox` 包根处理 API、`@aurora/event-schema` 包根（`EventEnvelope`、`IngestionErrorCode`）、`apps/ingestion-api` 的 `build`/`start`/配置工程样式、ADR-004/008/010/011 约束。
- **Produces**：`@aurora/ingestion-worker` 应用（配置/生命周期/claim/renew/shutdown/诊断/处理器端口/start composition root）、单元测试、真实 PostgreSQL 集成测试、README、Workspace Policy `service` 层证据、ADR-012 实施证据、formalization-readiness 更新。

---

## Task 1: 应用脚手架与包边界 [ENV-INDEPENDENT]

**目标：** 创建 `apps/ingestion-worker` 应用目录、`package.json`、`tsconfig*.json`、`vitest.config.ts`、`src/index.ts` 最小入口；包名、layer、exports、engines 正确；不引入任何调度/队列依赖。

- Consumes: 规格 §5、ADR-012 应用边界、`apps/ingestion-api` 工程样式。
- Produces: `package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`src/index.ts`。

- [ ] **Step 1: 失败测试**
  - `test/package-entry.test.ts`：
    - manifest `name` 为 `@aurora/ingestion-worker`、`private: true`、`type: module`、`engines.node` 为 `>=24.18.0 <25`、`aurora.layer` 为 `service`；
    - exports 只含 `"."`（`types`/`import` 指向 `./dist/index.js`）；`files` 含 `dist`；
    - 不依赖 `bullmq`/`redis`/`ioredis`/`node-cron`/`bree`（断言 dependencies 不含这些）；
    - 依赖含 `@aurora/ingestion-inbox` 与 `@aurora/event-schema`。
  - 先不建 manifest，测试预期失败。

- [ ] **Step 2: 最小实现**
  - 创建 `apps/ingestion-worker/package.json`：
    ```json
    {
      "name": "@aurora/ingestion-worker",
      "version": "0.0.0",
      "private": true,
      "type": "module",
      "description": "Aurora data ingestion durable Inbox Worker runtime and processor orchestration",
      "engines": { "node": ">=24.18.0 <25" },
      "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
      "files": ["dist"],
      "scripts": {
        "build": "tsc -p tsconfig.build.json",
        "typecheck": "tsc -p tsconfig.json --noEmit",
        "test": "vitest run --exclude test/integration/**",
        "test:integration": "vitest run test/integration --no-file-parallelism",
        "test:coverage": "vitest run --exclude test/integration/** --coverage"
      },
      "dependencies": {
        "@aurora/event-schema": "workspace:*",
        "@aurora/ingestion-inbox": "workspace:*"
      },
      "devDependencies": {
        "@types/node": "24.13.3",
        "typescript": "6.0.3",
        "vitest": "4.1.10"
      },
      "aurora": { "layer": "service" }
    }
    ```
  - 创建 `tsconfig.json`（extends `../../tsconfig.base.json`，`noEmit: true`，`types: ["node", "vitest/globals"]`，include `src/**/*.ts`、`test/**/*.ts`、`vitest.config.ts`）；
  - 创建 `tsconfig.build.json`（extends `./tsconfig.json`，`noEmit: false`，`outDir: dist`，`declaration: true`，include 仅 `src/**/*.ts`）；
  - 创建 `vitest.config.ts`（alias `@aurora/event-schema`/`@aurora/ingestion-inbox` → 对应 `src/index.ts`，include `test/**/*.test.ts`，`testTimeout: 30_000`）；
  - 创建 `src/index.ts`（暂只导出 `loadIngestionWorkerConfig` 与 `type IngestionWorkerConfig`，其余随 Task 追加）。

- [ ] **Step 3: 确认通过**
  - `pnpm --filter @aurora/ingestion-worker typecheck` exit 0；`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`；`pnpm check:boundaries`（确认 `service` 层允许 worker → data/protocol）。

- [ ] **Step 5: 建议提交边界**
  - `apps/ingestion-worker/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`src/index.ts`、`test/package-entry.test.ts`；根 `package.json` 的 `format:check`/`lint` 清单追加本应用文件。

---

## Task 2: typed 配置 [ENV-INDEPENDENT]

**目标：** 实现 `IngestionWorkerConfig` 与 `loadIngestionWorkerConfig`：全部值显式配置；校验正整数与安全上限；`leaseRenewIntervalMs < leaseDurationMs`；`maxConcurrentHandlers <= claimBatchSize`；缺失/非法抛错；返回冻结对象。

- Consumes: 规格 §7、`apps/ingestion-api/src/configuration.ts` 样式。
- Produces: `src/configuration.ts`、`test/configuration.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/configuration.test.ts`：
    - 合法 env → 冻结 typed config（各字段值正确；`Object.isFrozen`）；
    - 缺少任一必填键 → 抛错（消息含键名）；
    - 非正整数（0/负数/非整数/`abc`）→ 抛错；
    - `leaseRenewIntervalMs >= leaseDurationMs` → 抛错；
    - `maxConcurrentHandlers > claimBatchSize` → 抛错；
    - `claimBatchSize > 100` → 抛错（MAX_CLAIM_LIMIT）；
    - `logEnabled` 缺省默认 false。

- [ ] **Step 2: 最小实现**
  - `src/configuration.ts`：
    - `export interface IngestionWorkerConfig`（全部 `readonly`）：`workerId`、`claimBatchSize`、`maxConcurrentHandlers`、`leaseDurationMs`、`leaseRenewIntervalMs`、`idlePollIntervalMs`、`infrastructureFailureDelayMs`、`shutdownGracePeriodMs`、`databaseUrl`、`logEnabled`；
    - `loadIngestionWorkerConfig(env: NodeJS.ProcessEnv): IngestionWorkerConfig`：`requiredString`/`requiredPositiveInt`/`optionalBoolean` helper（复用 ingestion-api 样式）；交叉校验 leaseRenew < leaseDuration、maxConcurrent <= claimBatch、claimBatch <= 100；
    - 返回 `Object.freeze(config)`。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/configuration.ts`、`test/configuration.test.ts`、`src/index.ts`（导出 config）。

---

## Task 3: 处理器端口 [ENV-INDEPENDENT]

**目标：** 冻结 `IngestionEventProcessor` 端口与 `ProcessIngestionEventInput`/`ProcessIngestionEventResult`；输入只含稳定数据；结果只允许 processed/retry/dead-letter。

- Consumes: 规格 §9、`@aurora/event-schema` 包根类型。
- Produces: `src/processor.ts`、`test/processor.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/processor.test.ts`：
    - `ProcessIngestionEventInput` 含 `inboxId`、`projectId`、`eventId`、`event: EventEnvelope`、`attemptCount`、`leaseId`、`leaseExpiresAt`；
    - 判别 `ProcessIngestionEventResult` 三态（processed / retry + availableAt + errorCode / dead-letter + errorCode）；
    - retry 的 `errorCode` 是 `IngestionErrorCode`（赋值编译期约束）；
    - 端口 `process(input, signal)` 返回 `Promise<ProcessIngestionEventResult>`。

- [ ] **Step 2: 最小实现**
  - `src/processor.ts`：接口与输入/结果类型；结果联合判别；不实现任何具体处理器。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/processor.ts`、`test/processor.test.ts`、`src/index.ts`（导出端口）。

---

## Task 4: 有界诊断 [ENV-INDEPENDENT]

**目标：** 实现 `WorkerDiagnostic`（冻结字段）与 `WorkerDiagnostics`（每实例有界环形缓冲）；禁止记录 EventEnvelope/原始 Error/SQL/SQLSTATE/数据库 URL/凭证/Header/完整堆栈/用户输入；处理器异常不能破坏主循环。

- Consumes: 规格 §16、代码规范日志章节。
- Produces: `src/diagnostics.ts`、`test/diagnostics.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/diagnostics.test.ts`：
    - 记录一条诊断 → 字段含 `code`/`operation`/`workerId`/`timestamp`（可选 `inboxId`/`eventType`/`attemptCount`/`leaseLost`）；
    - 超过容量（如 100）→ 最旧被丢弃（环形有界）；
    - 快照只读（`Object.freeze`）；
    - 单条 message 有上限（构造超长 message 被截断或拒绝）。

- [ ] **Step 2: 最小实现**
  - `src/diagnostics.ts`：
    - `export interface WorkerDiagnostic`（稳定字段，message 有界长度常量 `MAX_DIAGNOSTIC_MESSAGE_LENGTH`）；
    - `export class WorkerDiagnostics`：构造 `(workerId, limit)`；`record(input)` 追加；`snapshot(): readonly WorkerDiagnostic[]` 返回冻结副本；环形缓冲容量有界。
  - 不在诊断中记录受禁字段（类型只暴露允许字段）。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/diagnostics.ts`、`test/diagnostics.test.ts`、`src/index.ts`（导出诊断）。

---

## Task 5: timer/sleeper 端口 [ENV-INDEPENDENT]

**目标：** 实现可注入 `SleeperPort`（`sleep(ms): Promise<void>`，可用 `AbortSignal` 取消）与 `TimerPort`（`setTimeout`/`clearTimeout` 抽象）；测试使用 fake clock，不依赖真实时间。

- Consumes: 规格 §6/§17、测试规范"优先可控测试实现"。
- Produces: `src/timers.ts`、`test/timers.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/timers.test.ts`：
    - `defaultSleeper.sleep` 在 `delay(0)` 后 resolve；
    - 传入已 abort 的 signal → `sleep` reject（`AbortError`）；
    - fake `SleeperPort` 记录调用参数并返回受控 deferred；
    - fake `TimerPort` 记录注册/清理。

- [ ] **Step 2: 最小实现**
  - `src/timers.ts`：
    - `export interface SleeperPort { sleep(ms: number, signal?: AbortSignal): Promise<void>; }`
    - `export const defaultSleeper: SleeperPort`（基于 `setTimeout` + signal 监听；abort 时 resolve/reject 并清理）；
    - `export interface TimerPort { set(fn, ms): TimerHandle; clear(handle): void; }`（内部用 `setTimeout`/`clearTimeout`）；
    - `export interface WorkerTimerPorts { readonly sleeper: SleeperPort; readonly timer: TimerPort; }` 或等价组合。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/timers.ts`、`test/timers.test.ts`、`src/index.ts`（导出端口）。

---

## Task 6: Worker 运行时核心（生命周期 + claim 循环 + 容量控制）[ENV-INDEPENDENT]

**目标：** 实现 `buildIngestionWorker` 与 `WorkerRuntime`：生命周期状态机（created/running/stopping/stopped，单实例停止后不可重启，重复 start 拒绝，重复 stop 幂等）；claim 循环（一轮结束再开始下一轮）；剩余容量计算；claim 上限 = min(剩余容量, claimBatchSize)；空队列按 idlePollIntervalMs 等待；停止后不再 claim；in-flight 有界。

- Consumes: 规格 §11/§14、处理侧 `claimAvailable` 签名。
- Produces: `src/worker-runtime.ts`（生命周期与 claim 部分）、`test/worker-lifecycle.test.ts`、`test/worker-claim-loop.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/worker-lifecycle.test.ts`（fake Repository + fake timers）：
    - 初始状态 `created`；`start()` 后 `running`；
    - 重复 `start()` → reject（`already running`）；
    - `stop()` → `stopped`；重复 `stop()` → 幂等 resolve；
    - `stopped` 后 `start()` → reject（不可重启）；
    - 启动失败（构造抛错）→ 回滚到可安全释放状态、错误被抛出。
  - `test/worker-claim-loop.test.ts`（fake Repository 记录 `claimAvailable` 调用）：
    - `maxConcurrentHandlers=2`、`claimBatchSize=5`、初始空闲 → 首次 claim `limit=2`（剩余容量）；
    - 2 个 in-flight 时下一轮 claim `limit=0`（不调用或调用 limit 0 被跳过）；
    - 处理完成后容量释放 → 下一轮 claim `limit` 回升；
    - 空队列（`nothingToClaim`）→ 等待 `idlePollIntervalMs` 后再 claim；
    - 停止后 → 不再调用 `claimAvailable`；
    - 一轮 claim 结束才启动下一轮（不重叠）。

- [ ] **Step 2: 最小实现**
  - `src/worker-runtime.ts`：
    - `export interface WorkerRuntime { readonly status: WorkerRuntimeStatus; start(): Promise<void>; stop(): Promise<void>; readonly diagnostics: WorkerDiagnostics; }`
    - `export type WorkerRuntimeStatus = 'created' | 'running' | 'stopping' | 'stopped'`;
    - `buildIngestionWorker(input: BuildIngestionWorkerInput): WorkerRuntime`；`BuildIngestionWorkerInput` 含 `config`、`repository: IngestionInboxProcessingRepository`、`processor: IngestionEventProcessor`、`timers?: WorkerTimerPorts`、`diagnostics?: WorkerDiagnostics`、`nowProvider?`；
    - claim 循环：`async function runLoop()`；`while (status==='running') { 计算 remainingCapacity; if (remaining>0) claim(limit=min(remaining, claimBatchSize)); else await sleeper.sleep(0/短间隔); 处理 each claim → spawn in-flight 任务; if (nothingToClaim) await sleeper.sleep(idlePollIntervalMs); }`；
    - in-flight 任务收集到有界集合；任务结束立即释放容量。
  - 本 Task 只实现 claim 循环与容量控制骨架，in-flight 处理与续租在 Task 7 接入。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test`（lifecycle + claim-loop）通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/worker-runtime.ts`、`test/worker-lifecycle.test.ts`、`test/worker-claim-loop.test.ts`、`src/index.ts`。

---

## Task 7: in-flight 处理编排 + 处理器结果映射 [ENV-INDEPENDENT]

**目标：** 每个领取的 in-flight 任务调用 `processor.process(input, signal)`；正常返回按结果映射 `markProcessed`/`scheduleRetry`/`markDeadLettered`；处理器抛出/rejected → 未分类失败（不标记成功、不伪造成功、有界诊断、继续其他事件）；写回返回 `lease_lost` → 视为失去所有权不重试。

- Consumes: 规格 §9/§10/§12、处理侧 write-back 签名。
- Produces: `src/worker-runtime.ts`（in-flight 编排部分）、`test/worker-orchestration.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/worker-orchestration.test.ts`（fake Repository 记录 write-back 调用）：
    - 处理器返回 `processed` → 调用 `markProcessed({ id, leaseId })`；
    - 返回 `retry` → 调用 `scheduleRetry({ id, leaseId, availableAt, errorCode })`；
    - 返回 `dead-letter` → 调用 `markDeadLettered({ id, leaseId, errorCode })`；
    - 处理器 reject → 不调用任何 write-back；记录诊断（`processor_failed`）；该事件继续走完（不阻塞其他事件）；
    - `markProcessed` 返回 `lease_lost` → 不重试、记录诊断；
    - 输入不含 SQL/row/凭证（类型只暴露稳定字段）。

- [ ] **Step 2: 最小实现**
  - `worker-runtime.ts`：`async function runInFlight(event: ClaimedInboxEvent)`：
    1. 创建该任务 `AbortController`；加入 in-flight 集合；占用容量；
    2. 启动续租循环（Task 8 接入；本 Task 先留函数位）；
    3. `const result = await processor.process(input, controller.signal)`；
    4. 按 result 判别调用对应 Repository write-back；
    5. `finally`：停止续租、释放容量、移出 in-flight。
  - 处理器异常：catch 并记录诊断（不 throw 出循环）；不伪造成功。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/worker-runtime.ts`、`test/worker-orchestration.test.ts`。

---

## Task 8: lease 自动续期与 lease lost [ENV-INDEPENDENT]

**目标：** 每个 in-flight 独立续租循环：按 `leaseRenewIntervalMs` 用当前 `leaseId` 调用 `renewLease`；`renewLease` 返回 `success` 表示所有权仍有效（数据库 `lease_expires_at` 已由 Repository 内部延长；`renewLease` 公共接口**不返回**新 `leaseExpiresAt`，Worker 本地以领取时的 `leaseExpiresAt` 为已知信息，租约以数据库为权威）；`lease_lost` → Abort 处理器、标记失去所有权、不再写回、有界诊断、继续其他事件；暂时数据库故障 → 保守重试一次，无法确认所有权时停止写回；处理结束立即停止续租；多次停止幂等；续租与最终写回不并发竞态。

- Consumes: 规格 §12（`renewLease` 不返回新过期时间，见规格修正）、`renewLease` 签名、代码规范 AbortSignal。
- Produces: `src/worker-runtime.ts`（续租部分）、`test/worker-renew.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/worker-renew.test.ts`（fake Repository + fake clock）：
    - 长任务在 `leaseRenewIntervalMs` 后触发 `renewLease`（调用次数 ≥1）；
    - `renewLease` 成功（`success`）后处理器仍可继续（所有权有效，数据库已延长）；
    - 处理器完成后不再触发 `renewLease`；
    - `renewLease` 返回 `lease_lost` → 处理器收到 Abort（signal.aborted === true）→ 无最终写回；
    - 重复停止续租幂等；
    - 续租暂时失败（Repository 抛 `IngestionInboxError`）→ 保守重试一次 → 仍失败 → 停止写回（不把结果写成功）；
    - 竞态：续租停止先于最终写回发起（顺序断言）。

- [ ] **Step 2: 最小实现**
  - `worker-runtime.ts`：`async function renewLoop(event, controller, leaseState)`：
    - `while (!aborted && !leaseLost) { await sleeper.sleep(leaseRenewIntervalMs, signal); if (aborted) break; const res = await repository.renewLease({ id, leaseId, leaseDurationMs }); if (res.status === 'lease_lost') { leaseLost = true; controller.abort(); return; } if (res.status === 'success') leaseState.leaseExpiresAt = ...; else 保守处理 }`；
    - 暂时失败：单次保守重试（捕获 `IngestionInboxError` 后等待短间隔重试一次），仍失败则停止续租并标记"无法确认所有权"→ 最终写回被跳过；
    - `runInFlight` 中：写回前检查 `leaseLost || !ownershipConfirmed`，否则跳过并记录诊断；
    - 处理结束 `finally` 调 `abortController.abort()` 停止续租循环（幂等）。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/worker-runtime.ts`、`test/worker-renew.test.ts`。

---

## Task 9: graceful shutdown [ENV-INDEPENDENT]

**目标：** 冻结关闭顺序；grace 内任务可完成最终写回；宽限期后 Abort 未完成处理器；不强制改状态；停止续租；清理 timer；重复 stop 幂等；无未处理 Promise。

- Consumes: 规格 §13/§14。
- Produces: `src/worker-runtime.ts`（shutdown 部分）、`test/worker-shutdown.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/worker-shutdown.test.ts`（fake Repository + fake clock + barrier）：
    - `stop()` 后不再 claim；
    - in-flight 任务在 grace 内完成 → 允许最终写回；
    - 超过 grace 的任务 → 处理器被 Abort（signal.aborted）→ 不强制改状态（Repository 无 write-back 调用）→ 记录诊断；
    - 重复 `stop()` 幂等；
    - 停止后所有 timer 清理（fake TimerPort 记录 clear 全部）；
    - `stop()` 在 `start()` 进行中可调用（先置 stopping）。

- [ ] **Step 2: 最小实现**
  - `worker-runtime.ts`：`stop()` 逻辑：
    1. `status = 'stopping'`；停止 claim 循环（信号）；
    2. `await Promise.race([allSettled(inFlight), graceTimer])`；
    3. 对未完成任务调用其 AbortController.abort()；
    4. 等待其 settle；
    5. `status = 'stopped'`；清理 timer；
    - 用 `AbortSignal.timeout` 或 sleeper 实现 grace 计时；
    - 不强制把未完成项改为 retry/dead-letter。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/worker-runtime.ts`、`test/worker-shutdown.test.ts`。

---

## Task 10: composition root（startIngestionWorker）与信号处理 [ENV-INDEPENDENT]

**目标：** `startIngestionWorker` 从环境变量读取并验证配置、创建 Pool、组合 Processing Repository、创建 Worker、启动、注册 SIGTERM/SIGINT、启动失败回滚、Pool 只关闭一次；生产启动必须显式提供处理器 composition；普通模块不直接读 `process.env`。

- Consumes: 规格 §8、`apps/ingestion-api/src/start.ts` 样式。
- Produces: `src/start.ts`、`test/start.test.ts`（或并入 lifecycle）。

- [ ] **Step 1: 失败测试**
  - `test/worker-start.test.ts`（inject fake repository/fake timers）：
    - 合法输入 → 启动成功返回 `RunningIngestionWorker`（`stop(): Promise<void>`）；
    - 配置非法 → 启动失败并回滚（不泄漏资源）；
    - `stop()` 关闭 Pool 恰一次；
    - 生产路径未提供处理器 → 拒绝启动（显式处理器 composition 必填）；
    - 信号处理器注册/注销可注入测试。

- [ ] **Step 2: 最小实现**
  - `src/start.ts`：
    - `export interface StartIngestionWorkerOptions { readonly config: IngestionWorkerConfig; readonly processor: IngestionEventProcessor; }`；
    - `startIngestionWorker(options)`：`const pool = new Pool({ connectionString: config.databaseUrl })`；`const repository = createProcessingRepository(pool)`（组合 `@aurora/ingestion-inbox` 函数）；`const worker = buildIngestionWorker({ config, repository, processor })`；`await worker.start()`；注册 SIGTERM/SIGINT → `stop`；返回 `{ stop: async () => { unregisterSignals(); await worker.stop(); if (!closed) { closed = true; await pool.end(); } } }`；catch → `await pool.end().catch(...)` 回滚后 rethrow。
  - `createProcessingRepository(pool)` 私有函数：`claimAvailable: (i) => claimAvailable(pool, i)` 等（只通过包根）。
  - 生产启动要求显式 `processor`；测试注入 fake。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`；`pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `src/start.ts`、`test/worker-start.test.ts`、`src/index.ts`（导出 `startIngestionWorker`）。

---

## Task 11: 包出口、Workspace Policy、安全负例与文档契约 [ENV-INDEPENDENT]

**目标：** `src/index.ts` 导出全部公共 API；包入口与私有路径负例；`service` 层边界负例；敏感信息扫描；README 与规格文档契约。

- Consumes: 规格 §5/§16/§19、`apps/ingestion-api` 的 package-entry/documentation-contract/security-negative 样式。
- Produces: `src/index.ts` 完善、`test/package-entry.test.ts` 扩展、`test/security-negative.test.ts`、`test/documentation-contract.test.ts`、`README.md`。

- [ ] **Step 1: 失败测试**
  - `package-entry.test.ts` 扩展：包根导出 `buildIngestionWorker`、`startIngestionWorker`、`loadIngestionWorkerConfig`、`IngestionEventProcessor` 端口类型、`WorkerRuntime`/`WorkerRuntimeStatus`、`WorkerDiagnostics`；`src/worker-runtime.ts`/`src/processor.ts` 等私有路径不可导入；
  - `security-negative.test.ts`：`src/` 与 `test/` 不含 `console.log` 原始 Error/EventEnvelope/SQLSTATE/`databaseUrl` 完整值模式；
  - `documentation-contract.test.ts`：README 含模块职责/非职责、`AURORA_TEST_DATABASE_URL`、`@aurora/ingestion-inbox` 包根依赖、不宣称具体处理器/重试策略已实现；规格含 `implementation-status`。

- [ ] **Step 2: 最小实现**
  - `index.ts` 导出公共 API；完善 `README.md`（模块定位/职责/非职责/接口/配置/命令/集成测试说明/关联文档）；
  - 负例与安全测试完善。

- [ ] **Step 3: 确认通过**
  - `pnpm check:boundaries` exit 0；`pnpm lint` exit 0；全部负例与文档契约测试通过。

- [ ] **Step 4: 相关回归**
  - 全包 `typecheck`。

- [ ] **Step 5: 建议提交边界**
  - `src/index.ts`、`test/package-entry.test.ts`、`test/security-negative.test.ts`、`test/documentation-contract.test.ts`、`README.md`。

---

## Task 12: 真实 PostgreSQL 集成测试基础 [PG-GATED]

**目标：** 建立集成测试 helper（`testDatabaseUrl`/`assertIsTestDatabase`/`createTestPool`/Migration 执行/清理），复用 `@aurora/ingestion-inbox` 处理侧函数组合真实 Repository；每个测试独立 Schema/命名空间；清理失败显式报错。

- Consumes: 规格 §18、`packages/ingestion-inbox/test/integration/helpers.ts` 样式。
- Produces: `test/integration/helpers.ts`、空跑 gate 测试。

- [ ] **Step 1: 失败测试**
  - `test/integration/helpers.test.ts` 或首个集成测试的 `beforeAll`：`AURORA_TEST_DATABASE_URL` 未设置 → `describe.skipIf` 跳过；设置且目标非测试库 → 抛错；Migration up 成功；`DELETE FROM event_inbox` 清空；测试结束清理并关闭 Pool。

- [ ] **Step 2: 最小实现**
  - `test/integration/helpers.ts`：复制并适配 `ingestion-inbox` 的 `testDatabaseUrl`/`assertIsTestDatabase`（校验 `/aurora_inbox_test` 前缀）/`createTestPool`；`migrateUp(pool)` 用 `node-pg-migrate` runner；`clearEventInbox(pool)`。
  - 用 `process.env.AURORA_TEST_DATABASE_URL !== undefined` 决定 `describe` vs `describe.skip`（同既有 pattern）。

- [ ] **Step 3: 确认通过**
  - `AURORA_TEST_DATABASE_URL` 未设置时集成测试正确 skip；设置时通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-worker typecheck`。

- [ ] **Step 5: 建议提交边界**
  - `test/integration/helpers.ts`。

---

## Task 13: 真实 PostgreSQL 端到端（claim→处理→状态） [PG-GATED]

**目标：** 用真实 Repository 验证 claim 后调用处理器；`processed`→`processed`、`retry`→`retry_waiting`、`dead-letter`→`dead_lettered`；处理器异常不标记成功且不阻塞其他事件。

- Consumes: 规格 §18、helpers、真实 Repository。
- Produces: `test/integration/worker-e2e.test.ts`。

- [ ] **Step 1: 失败测试**
  - 插入 3 条 pending 事件；fake processor 分别返回 `processed`/`retry`/`dead-letter`；
  - 运行 Worker 一短段时间后 stop；
  - 断言数据库状态：第 1 条 `state='processed'`、第 2 条 `state='retry_waiting'`（且 `available_at` 为传入值）、第 3 条 `state='dead_lettered'`；
  - 处理器对某事件 reject → 该事件保持 `leased` 或到期可重领（不写 processed）；其他事件正常处理；
  - 清理。

- [ ] **Step 2: 最小实现**
  - 用真实 `claimAvailable`/`markProcessed`/`scheduleRetry`/`markDeadLettered` 组合 `createProcessingRepository(pool)`；`buildIngestionWorker` + fake processor + 短 `idlePollIntervalMs`；短租约（如 200ms）；`await worker.stop()` 后做数据库断言。
  - 用轮询断言 helper（短间隔 + 超时上限，不用长 sleep）。

- [ ] **Step 3: 确认通过**
  - 真实 PG 集成测试通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-worker typecheck`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `test/integration/worker-e2e.test.ts`。

---

## Task 14: 真实 PostgreSQL 并发与续租/lease lost [PG-GATED]

**目标：** 验证并发不超过配置值、claim 不超过剩余容量、空队列 idle 等待、停止后不再 claim；长任务触发 `renewLease`、完成后停止 renew、lease lost 中止处理器且不写回。

- Consumes: 规格 §11/§12/§18。
- Produces: `test/integration/worker-concurrency.test.ts`、`test/integration/worker-renew.test.ts`。

- [ ] **Step 1: 失败测试**
  - `worker-concurrency.test.ts`：
    - 插入 20 条；`maxConcurrentHandlers=3`、`claimBatchSize=10`；记录处理器并发峰值 ≤3；
    - claim 总量 ≤ 20，且任一时刻 claim 领取数 ≤ min(剩余容量, claimBatchSize)；
    - 空队列 → 记录两次 claim 间隔 ≥ `idlePollIntervalMs`（不 busy loop）；
    - stop 后无新 claim。
  - `worker-renew.test.ts`：
    - 处理器 hold 超过 `leaseRenewIntervalMs` → 记录 `renewLease` 调用 ≥1；数据库 `lease_expires_at` 被延长；
    - 处理器完成后不再 renew；
    - 模拟 lease lost：外部 UPDATE 把 `lease_id` 改掉 → 下一轮 renew 返回 `lease_lost` → 处理器 signal.aborted → 无最终写回（状态不变为 processed）；
    - 清理。

- [ ] **Step 2: 最小实现**
  - 复用 Task 13 的 composition；用真实短租约（如 `leaseDurationMs=300`、`leaseRenewIntervalMs=80`）与可控协调（deferred 记录处理器进入/离开）避免长 sleep；poll 数据库状态断言。

- [ ] **Step 3: 确认通过**
  - 真实 PG 并发/续租/lease lost 测试通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-worker typecheck`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `test/integration/worker-concurrency.test.ts`、`test/integration/worker-renew.test.ts`。

---

## Task 15: 真实 PostgreSQL shutdown 与双 Worker [PG-GATED]

**目标：** 验证 grace 内任务完成、宽限期后 Abort 不强制改状态、Pool 释放、重复 stop 幂等、timer/Promise 无泄漏；两个 Worker 并发运行不重复处理同一 lease。

- Consumes: 规格 §13/§14/§18。
- Produces: `test/integration/worker-shutdown.test.ts`、`test/integration/worker-two-workers.test.ts`。

- [ ] **Step 1: 失败测试**
  - `worker-shutdown.test.ts`：
    - in-flight 任务在 grace 内完成 → 最终写回成功；
    - 超长任务（处理器 hold 超过 grace）→ stop 后处理器被 Abort、状态保持 `leased`（不强制改状态）、诊断记录；
    - 重复 stop 幂等；
    - `stop()` 后 Pool 释放（`pool.totalCount`/`idleCount` 归零或连接关闭）；
    - 测试结束清理。
  - `worker-two-workers.test.ts`：
    - 插入 10 条；两个 Worker（不同 `workerId`）并发运行；
    - 每条记录只被处理一次（处理器调用按 `inboxId` 去重计数 =1）；
    - 数据库最终全部 `processed`（或按 fake 结果）；无重复处理同一 lease；
    - 清理。

- [ ] **Step 2: 最小实现**
  - 用真实 Repository、短租约、短 grace、deferred 协调；poll 数据库断言；两个 `buildIngestionWorker` 各用不同 `workerId` 并共享同一 Pool（或各自 Pool）并发 start。

- [ ] **Step 3: 确认通过**
  - 真实 PG shutdown/双 Worker 测试通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-worker typecheck`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `test/integration/worker-shutdown.test.ts`、`test/integration/worker-two-workers.test.ts`。

---

## Task 16: 覆盖率、根级门禁、文档与 ADR 证据 [ENV-INDEPENDENT / 结果门控]

**目标：** 覆盖率 ≥ lines 85 / branches 80 / functions 85 / statements 85；README、formalization-readiness、ADR-012 证据、ADR 索引同步；根级完整质量门禁。

- Consumes: 全部 Task 产物、规格、ADR-012。
- Produces: `apps/ingestion-worker/README.md` 更新、`docs/architecture/formalization-readiness.md` 更新、ADR-012 追加记录、`docs/adr/README.md` 状态同步、根 `package.json` format/lint 清单追加。

- [ ] **Step 1: 失败测试（文档契约先行）**
  - `test/documentation-contract.test.ts`：README 含 Worker 职责/非职责、`AURORA_TEST_DATABASE_URL`、不宣称具体处理器/重试策略/人工重放已实现。

- [ ] **Step 2: 最小实现文档**
  - 更新 `README.md`（已建，Task 11 完善）；
  - 更新 `formalization-readiness.md`：Worker 波次第 2 项 `apps/ingestion-worker` implemented；ADR-012 in-progress；Worker policy/benchmark 仍 blocked；
  - 真实实现并验证后，ADR-012 追加 Worker 运行时实施证据；ADR 索引同步 ADR-012 `in-progress`。

- [ ] **Step 3: 确认通过**
  - 文档契约测试通过；`pnpm format:check`、`git diff --check`。

- [ ] **Step 4: 相关回归**
  - 全仓：`pnpm install --frozen-lockfile`、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:coverage`、`pnpm check:boundaries`、`pnpm build`、`pnpm check:ci`、`git diff --check`；真实 PG 可用时加 `pnpm --filter @aurora/ingestion-worker test:integration` 与 `@aurora/ingestion-inbox`/`@aurora/ingestion-api` 回归。
  - 覆盖率：`pnpm --filter @aurora/ingestion-worker test:coverage` 达到 85/80/85/85。

- [ ] **Step 5: 建议提交边界**
  - README、formalization-readiness、ADR-012 追加记录、ADR 索引、根 `package.json` 清单。

---

## 完成报告要求

实施完成并全部门禁通过后，报告必须包含：当前 Worker 前置能力核验；最终模块选择；规格路径与状态；writing-plans 路径与状态；Task 数量与完成状态；应用目录与依赖；build/start 边界；配置；处理器端口与结果；claim 循环与并发；lease renew 与 lease lost；生命周期与 shutdown；PostgreSQL 与双 Worker 测试；覆盖率；敏感信息检查；全部质量命令与退出码；与计划的偏差；ADR 状态（ADR-012 由 not-started 更新为 in-progress，ADR-008 in-progress、ADR-010 implemented、ADR-011 in-progress）；Git 状态；更新后的剩余模块统计；建议提交边界；并明确说明：未实现具体事件处理器、重试策略、人工重放、凭证模块、CI/RDS/IaC，未提交或推送，未规划或实施下一模块。
