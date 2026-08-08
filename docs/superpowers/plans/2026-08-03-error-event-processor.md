# 实施计划：具体错误事件 Processor 核心能力第一增量

## 文件头

- 日期：2026-08-03
- 模块：`apps/ingestion-worker`（`@aurora/ingestion-worker`）具体错误事件 Processor 核心能力
- 正式规格：`docs/architecture/error-event-processor.md`（approved）
- ADR：ADR-012（accepted / in-progress）、ADR-018（accepted / implemented）；本模块不创建新 ADR
- 计划状态：ready-for-implementation
- 目标读者：零上下文工程师
- 权威来源：CLAUDE.md/AGENTS.md/AURORA_RULES.md 快照、approved 规格、accepted ADR-004/005/006/008/010/012/015/016/018、approved 错误事件协议契约/Worker 运行时/错误 occurrence 处理存储规格

## Goal

在 `apps/ingestion-worker` 内实现 `createErrorEventProcessor` 工厂：接收 `ProcessIngestionEventInput`，只处理 `EventType.Error`，通过 `@aurora/processing-store` 包根调用 `persistErrorEventOccurrence`，把稳定结果映射到既有 Worker 结果（`processed`/`retry`/`dead-letter`），并用既有 `calculateRetryBackoffSchedule` 计算暂时失败的 `availableAt`。**不**接入生产 composition root，**不**创建生产 bin/start，**不**实现总事件路由器，**不**为 request/performance 决定最终处理策略。

## Architecture

```
apps/ingestion-worker/src/
  error-event-processor.ts       # 新增：createErrorEventProcessor 工厂 + 类型 + 结果映射
apps/ingestion-worker/test/
  error-event-processor.test.ts  # 新增：处理器单元测试（fake store/backoff/clock）
  security-negative.test.ts      # 追加：诊断不泄露正文/凭据、无 event.body 匹配
  integration/
    helpers.ts                   # 修改：migrateUp 同时跑 inbox + processing-store migrations
    error-event-processor.test.ts # 新增：真实 PostgreSQL 17.10 集成测试
apps/ingestion-worker/
  vitest.config.ts               # 修改：新增 @aurora/processing-store alias
  package.json                   # 修改：新增 @aurora/processing-store 依赖
  src/index.ts                   # 修改：导出 createErrorEventProcessor 及类型
  README.md                      # 修改：错误处理器职责与接口
```

依赖方向：`error-event-processor.ts` → `@aurora/processing-store` 包根、`@aurora/event-schema` 包根、`./processor.ts`（端口类型）、`./retry-backoff-policy.ts`、`./retry-backoff-types.ts`、`./retry-backoff-entropy.ts`。`apps/ingestion-worker` 为 `service` 层，允许 `service → data | protocol`（workspace-policy 已支持）。

## Tech Stack

- TypeScript 6.0.3（strict，NodeNext，ES2024，verbatimModuleSyntax）
- `@aurora/processing-store`（包根 `persistErrorEventOccurrence`）、`@aurora/event-schema`（包根 `EventType`/`EventEnvelope`）
- 内部复用 `calculateRetryBackoffSchedule`/`createNodeCryptoEntropyProvider`/`RetryBackoffConfig`
- vitest 4.1.10；真实 PostgreSQL 17（集成测试，`AURORA_TEST_DATABASE_URL`）

## Global Constraints

- 只实现错误事件处理器核心能力；不接入生产 `startIngestionWorker`；不创建生产 bin/start；不实现总事件路由器；
- 只为 `EventType.Error` 决定处理策略；对非 Error 输入只做局部前置校验（返回 `dead-letter{invalid_event_type}`），**不得**被解释为非错误事件最终处理策略；
- 不复制 retry budget（`maxProcessingAttempts`/`decideRetryDisposition`）、backoff 算法、lease fencing、processing-store SQL/INSERT 逻辑；
- 只通过 `@aurora/processing-store` 与 `@aurora/event-schema` 包根依赖；不访问私有路径；
- 不写日志；不访问 `process.env`；不创建/关闭 Pool；不修改输入对象；
- 诊断不包含完整事件正文、Token、Cookie、Authorization、数据库 URL、SQL、SQLSTATE；
- `apps/ingestion-worker` 的 `package.json` 新增 `@aurora/processing-store` 依赖（可注入，供测试与未来接线；不在生产 composition root 自动激活）；
- 不 `git add`/`commit`/`push`/`stash`/`reset`/`rebase`/`clean`；不创建 worktree；不切换分支。

## 文件树（完整）

```
apps/ingestion-worker/src/error-event-processor.ts
apps/ingestion-worker/src/index.ts                    # 追加导出（编辑）
apps/ingestion-worker/test/error-event-processor.test.ts
apps/ingestion-worker/test/security-negative.test.ts  # 追加负例（编辑）
apps/ingestion-worker/test/integration/helpers.ts     # 追加 processing-store migration 目录（编辑）
apps/ingestion-worker/test/integration/error-event-processor.test.ts
apps/ingestion-worker/vitest.config.ts                # 追加 processing-store alias（编辑）
apps/ingestion-worker/package.json                    # 追加 @aurora/processing-store 依赖（编辑）
apps/ingestion-worker/README.md                       # 追加错误处理器职责与接口（编辑）
docs/architecture/error-event-processor.md            # implementation-status → implemented
docs/architecture/formalization-readiness.md          # 状态同步
docs/README.md                                        # 状态同步
docs/adr/README.md                                    # ADR-012 行状态说明（编辑）
docs/adr/ADR-012-ingestion-worker-runtime.md          # 追加实施证据
docs/adr/ADR-018-error-event-occurrence-processing-storage.md  # 追加 processor 核心能力衔接证据
AGENTS.md / AURORA_RULES.md                           # 状态同步
```

## 每个文件单一职责

- `error-event-processor.ts`：`CreateErrorEventProcessorInput`、`ErrorEventProcessorDiagnostics`、`createErrorEventProcessor` 工厂、`persistToWorkerResult` 纯映射、backoff 调用。
- `index.ts`：追加导出工厂与类型。
- `error-event-processor.test.ts`：直接调用工厂返回的处理器，fake store/backoff/clock，覆盖映射矩阵与边界。
- `security-negative.test.ts`：追加诊断不泄露正文/凭据负例。
- `helpers.ts`：`migrateUp` 同时应用 inbox 与 processing-store migration 目录。
- `error-event-processor.test.ts`（integration）：真实 PostgreSQL 17.10 闭环。
- `vitest.config.ts`：追加 `@aurora/processing-store` alias 到其 `src/index.ts`。
- `package.json`：新增 `@aurora/processing-store: workspace:*` 依赖。

## 关键设计决策

1. **工厂形态**：`createErrorEventProcessor(input)` 返回 `IngestionEventProcessor`。输入注入 `persist`（processing-store 包根函数或其兼容替身）、`backoff` 配置、可注入 `calculateBackoff`/`entropyProvider`/`now`/`diagnostics`。默认 `calculateBackoff = calculateRetryBackoffSchedule`、`entropyProvider = createNodeCryptoEntropyProvider()`、`now = () => new Date()`。
2. **结果映射**：`inserted`/`duplicate` → `processed`；`invalid_input` → `dead-letter{invalid_event_type}`；`temporarily_unavailable` → `retry{service_temporarily_unavailable}`。纯函数 `mapPersistResultToWorkerResult` 可独立测试。
3. **backoff**：`temporarily_unavailable` 时调用 `calculateRetryBackoffSchedule({ config, attemptCount, now: now(), entropy: entropyProvider.next() })`；`success` → `availableAt`；非 `success`（如 `invalid_config`）表示**调用方配置的程序缺陷**，处理器抛出一个稳定的 `Error`（信息不含配置值/正文），由 Worker runtime 按 ADR-015 处理器异常规则处理（不 markProcessed、不自动 retry/dead-letter、有界诊断、lease 自然过期）。**不**把无效配置静默降级为业务 retry。
4. **未知异常**：`persist` 抛出的未知异常（非稳定结果）**不捕获**，传播给 Worker runtime（ADR-015 既有规则）。
5. **前置校验**：`input.event.eventType !== EventType.Error` → `dead-letter{invalid_event_type}`（局部前置条件）。
6. **诊断**：可选 `ErrorEventProcessorDiagnostics` 接收 `{ code, inboxId?, eventType?, attemptCount? }`；不携带正文/敏感字段。

## 完整 TypeScript 签名

```ts
// error-event-processor.ts
import type { EventEnvelope, IngestionErrorCode } from '@aurora/event-schema';
import type { PersistErrorEventOccurrenceResult } from '@aurora/processing-store';
import type { IngestionEventProcessor, ProcessIngestionEventInput, ProcessIngestionEventResult } from './processor.js';
import { calculateRetryBackoffSchedule, type CalculateRetryBackoffScheduleInput } from './retry-backoff-policy.js';
import { createNodeCryptoEntropyProvider, type RetryBackoffEntropyProvider } from './retry-backoff-entropy.js';
import type { RetryBackoffConfig } from './retry-backoff-types.js';

export interface ErrorEventProcessorDiagnostic {
  readonly code: string;
  readonly inboxId?: number;
  readonly eventType?: string;
  readonly attemptCount?: number;
}

export interface ErrorEventProcessorDiagnostics {
  record(diagnostic: ErrorEventProcessorDiagnostic): void;
}

export type PersistErrorEventOccurrenceFn = (
  input: { readonly projectId: string; readonly eventEnvelope: unknown },
) => Promise<PersistErrorEventOccurrenceResult>;

export interface CreateErrorEventProcessorInput {
  readonly persist: PersistErrorEventOccurrenceFn;
  readonly backoff: RetryBackoffConfig;
  readonly calculateBackoff?: typeof calculateRetryBackoffSchedule;
  readonly entropyProvider?: RetryBackoffEntropyProvider;
  readonly now?: () => Date;
  readonly diagnostics?: ErrorEventProcessorDiagnostics;
}

export function createErrorEventProcessor(
  input: CreateErrorEventProcessorInput,
): IngestionEventProcessor;

export function mapPersistResultToWorkerResult(
  result: PersistErrorEventOccurrenceResult,
): Extract<ProcessIngestionEventResult, { readonly outcome: 'processed' | 'dead-letter' }>;
```

## 每个 Task 精确路径与 TDD 闭环

### Task 1：结果映射纯函数与工厂类型（失败测试 → 类型壳）

**Consumes**：`processor.ts` 端口、`@aurora/processing-store` 结果类型、`retry-backoff-types.ts`。
**Produces**：`src/error-event-processor.ts`（类型 + `mapPersistResultToWorkerResult` 纯函数 + 工厂占位）。

1. 失败测试：`test/error-event-processor.test.ts` 引入 `import { mapPersistResultToWorkerResult } from '../src/error-event-processor.js'` 与断言（此时文件不存在 → TS2307）。
   - `mapPersistResultToWorkerResult({ status: 'inserted', occurrenceId: '7' })` → `{ outcome: 'processed' }`；
   - `mapPersistResultToWorkerResult({ status: 'duplicate' })` → `{ outcome: 'processed' }`；
   - `mapPersistResultToWorkerResult({ status: 'invalid_input', code: 'invalid_envelope' })` → `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }`。
2. 预期失败：`ERR_MODULE_NOT_FOUND` / TS2307。
3. 最小实现：创建 `error-event-processor.ts`，导出 `PersistErrorEventOccurrenceFn`、`CreateErrorEventProcessorInput`、`ErrorEventProcessorDiagnostics`、`mapPersistResultToWorkerResult`；`createErrorEventProcessor` 先抛出"not implemented"——但规格禁止占位。**修正**：Task 1 只实现 `mapPersistResultToWorkerResult` 与类型；`createErrorEventProcessor` 留到 Task 2。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker test`（仅 mapping 测试）。
5. 回归：`pnpm --filter @aurora/ingestion-worker test`（既有测试全绿）。
6. 提交边界：mapping 函数 + 类型。

### Task 2：createErrorEventProcessor 工厂（前置校验 + 结果映射 + backoff）

**Consumes**：Task 1 类型与 mapping、`processor.ts` 端口、`retry-backoff-policy.ts`/`retry-backoff-entropy.ts`。
**Produces**：`error-event-processor.ts` 完整工厂。

1. 失败测试（追加到 `error-event-processor.test.ts`）：
   - 合法 error 信封 + store 返回 inserted → `processed`；
   - store 返回 duplicate → `processed`；
   - store 返回 invalid_input → `dead-letter{invalid_event_type}`；
   - store 返回 temporarily_unavailable + backoff success → `retry{service_temporarily_unavailable}` 且 `availableAt` = `now + delayMs`（注入确定性 entropy=0 与固定 now）；
   - store 返回 temporarily_unavailable + backoff 返回 invalid_config → 处理器抛出稳定 Error（程序缺陷，不被处理器捕获）；
   - 非 Error 输入（eventType `request`）→ `dead-letter{invalid_event_type}`（局部前置）；
   - store 抛出未知异常 → promise reject（不被处理器捕获）；
   - 诊断：store 返回 inserted → 记录 `occurrence_persisted`；duplicate → `occurrence_duplicate`；invalid → `permanently_rejected_invalid_input`；temp → `temporarily_unavailable`；
   - 输入对象不被修改。
2. 预期失败：`createErrorEventProcessor` 未实现 → TS2307 / 断言失败。
3. 最小实现：实现 `createErrorEventProcessor`（前置校验 → `persist` → 映射/backoff → 返回结果；诊断调用）。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker test`。
5. 回归：`pnpm --filter @aurora/ingestion-worker test`（既有全绿）。
6. 提交边界：工厂完整实现 + 单测。

### Task 3：包根导出、vitest alias、依赖与 Workspace Policy

**Consumes**：Task 2 实现。
**Produces**：`src/index.ts` 追加导出、`vitest.config.ts` 追加 alias、`package.json` 追加依赖、`pnpm install`。

1. 失败测试：`test/package-entry.test.ts` 断言 `createErrorEventProcessor`/`mapPersistResultToWorkerResult`/`ErrorEventProcessorDiagnostics` 从包根导出（未导出 → 失败）。
2. 预期失败：导出缺失。
3. 最小实现：`index.ts` 追加导出；`vitest.config.ts` 加 `@aurora/processing-store` alias；`package.json` 加依赖；`pnpm install`（更新 lockfile）。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker typecheck`、`test`、`pnpm check:boundaries`。
5. 回归：`pnpm --filter @aurora/event-schema test`、`pnpm --filter @aurora/processing-store test`、`pnpm --filter @aurora/ingestion-inbox test`。
6. 提交边界：index/vitest/package.json/lockfile。

### Task 4：真实 PostgreSQL 集成测试基建（migrateUp 双目录）

**Consumes**：`test/integration/helpers.ts`。
**Produces**：`helpers.ts` 修改。

1. 失败测试：`test/integration/error-event-processor.test.ts` 使用 `migrateUp()` 后查询 `error_event_occurrences` 表（此时 migrateUp 只跑 inbox 目录，表不存在 → 失败）。
2. 预期失败：`relation "error_event_occurrences" does not exist`。
3. 最小实现：`helpers.ts` 的 `migrateUp` 依次对 inbox 目录与 processing-store 目录跑 `runner`（共享 `pgmigrations` 表）。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker test:integration`（新增测试通过）。
5. 回归：既有 worker 集成测试（`worker-e2e` 等）仍绿。
6. 提交边界：helpers.ts。

### Task 5：真实 PostgreSQL 错误处理器闭环

**Consumes**：工厂 + helpers。
**Produces**：`test/integration/error-event-processor.test.ts`。

1. 失败测试：
   - 空库 migrateUp → inbox + occurrence 表存在；
   - 插入合法错误事件到 `event_inbox` → 用真实 `persistErrorEventOccurrence` 构造处理器 → 调用 `process(input)` → 返回 `processed`（inserted）→ `error_event_occurrences` 有一行；
   - 同一 project/eventId 再次处理 → `processed`（duplicate）→ occurrence 仍一行；
   - 非 error 事件调用处理器 → `dead-letter{invalid_event_type}`（局部前置，不接生产）；
   - store 用失败连接（注入返回 temporarily_unavailable 的 fake）→ `retry{service_temporarily_unavailable}`；
   - 并发：两个 `process` 同时调用同一事件 → 一个 inserted、一个 duplicate，都返回 `processed`；
   - 无残留 leased；Schema/Pool 清理。
2. 预期失败：新测试无实现 → 失败。
3. 最小实现：写集成测试（复用 helpers）。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker test:integration`。
5. 回归：既有 worker/processing-store 集成测试。
6. 提交边界：集成测试文件。

### Task 6：安全负例、README、文档、覆盖率与状态同步

**Consumes**：全部实现。
**Produces**：`security-negative.test.ts` 追加、`README.md`、规格/ADR/入口状态同步。

1. 失败测试：`security-negative.test.ts` 追加断言 `error-event-processor.ts` 不匹配 `event.body`/`EventEnvelope\.body`、不包含 `token`/`Authorization`/`databaseUrl`/`SQLSTATE`、不含 `console\.`；诊断代码不包含正文。
2. 预期失败：负例命中（若实现泄露）。
3. 最小实现：确认处理器源码符合；README/规格/ADR/入口同步。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker test`、`test:integration`、`test:coverage`（85/80/85/85）、全仓门禁。
5. 回归：全仓。
6. 提交边界：README + 文档 + 状态同步。

## CLI / 命令

```text
cd D:/Develop/SDK/Aurora
pnpm install --frozen-lockfile
pnpm --filter @aurora/ingestion-worker typecheck
pnpm --filter @aurora/ingestion-worker test
pnpm --filter @aurora/ingestion-worker test:integration
pnpm --filter @aurora/ingestion-worker test:coverage
pnpm check:boundaries
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm check:ci
pnpm openapi:check
pnpm benchmark:ingestion:smoke
git diff --check
```

## 预期结果

- `@aurora/ingestion-worker` 单元测试全绿（含错误处理器）；
- 真实 PostgreSQL 17.10 集成测试全绿（处理器闭环、duplicate、并发）；
- 覆盖率 85/80/85/85；
- 全仓门禁 exit 0；benchmark smoke exit 0；OpenAPI 无变化；
- 回归：event-schema/ingestion-inbox/processing-store/ingestion-api 全绿。

## 建议提交边界

- Commit 1：Task 1-2（mapping + 工厂 + 单测）。
- Commit 2：Task 3（导出/alias/依赖）。
- Commit 3：Task 4-5（集成基建 + 真实 PG 闭环）。
- Commit 4：Task 6（README/文档/状态同步）。

（本轮不实际执行 Git 提交；以上仅为逻辑边界。）

## 禁止

- TODO/TBD/伪代码/模糊占位/未定义类型/接入生产 composition root/创建生产 bin/start/总事件路由器/为 request/performance 决定最终策略/修改 POST /v1/batches/修改 request/performance 协议/复制 retry-budget 或 backoff 或 lease 或 processing-store 逻辑/git add/commit/push/stash/reset/rebase/clean。
