# 实施计划：数据接入 Worker 死信人工重放核心第一增量

## 文件头

- 日期：2026-08-02
- 模块：`packages/ingestion-inbox`（`@aurora/ingestion-inbox`）人工重放能力扩展
- 正式规格：`docs/architecture/ingestion-dead-letter-manual-replay.md`（approved）
- ADR：`docs/adr/ADR-017-ingestion-dead-letter-manual-replay.md`（accepted）
- 计划状态：ready-for-implementation
- 目标读者：零上下文工程师
- 权威来源：ACLAUDE.md/AGENTS.md/AURORA_RULES.md 快照、approved 规格、accepted ADR-004/008/010/012/015/016/017、approved Inbox 数据模型/处理侧 Repository/Worker 规格

## Goal

在 `packages/ingestion-inbox` 内实现死信人工重放核心能力：单事件 `dead_lettered → pending` 状态恢复、`replay_generation` 新处理代次、`attemptCount` 重置、`operationId` 幂等、事务 + 行锁、项目隔离、最小操作记录表。**不**修改 ADR-008/012/015/016 结论、EventEnvelope、现有 Inbox 处理 API 或 Worker 主循环；不提供 HTTP/UI/权限/审计/批量。

## Architecture

```
packages/ingestion-inbox/src/
  replay-types.ts          # ReplayDeadLetteredEventInput / ReplayDeadLetteredEventResult / IngestionInboxReplayRepository
  replay.ts                # replayDeadLettered 事务实现（FOR UPDATE、幂等重查、状态校验、操作记录、状态更新）
  migrations/1722500000002_event-inbox-replay.ts   # replay_generation 列 + 操作记录表
  index.ts                 # 追加导出（编辑）
packages/ingestion-inbox/test/
  replay.unit.test.ts      # 纯校验/类型/输入不变/结果冻结单元测试
  integration/replay.test.ts   # 真实 PostgreSQL 集成测试
  security-negative.test.ts    # 追加敏感扫描（编辑）
  package-entry.test.ts        # 追加导出断言（编辑）
```

依赖方向：`replay.ts` 依赖 `replay-types.ts` 与 `errors.ts`；`index.ts` 导出 `replayDeadLettered` 与类型。均为 `data` 层，不新增依赖。

## Tech Stack

- TypeScript 6.0.3（strict，NodeNext，ES2024，verbatimModuleSyntax）
- `pg` 8.22.0（Pool/PoolClient 事务）
- `node-pg-migrate` 9.0.0（Migration）
- vitest 4.1.10（测试）；真实 PostgreSQL 17（集成测试）

## Global Constraints

- 不修改 `persistBatch`/`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered` 签名与语义；
- 不新增 Inbox 状态枚举；不修改 EventEnvelope；
- 不提供 HTTP/CLI/UI/权限/审计/批量；
- 参数化 SQL；不暴露 SQLSTATE/约束名/SQL；
- 稳定结果；不通过正常控制流抛异常（数据库错误映射 `IngestionInboxError`）；
- 输入不变、结果只读；
- 不记录 EventEnvelope、密钥、数据库 URL、自由文本原因；
- Migration 追加式、可 up/down、不自动执行；
- 不 `git add`/`commit`/`push`；不创建 worktree；不切换分支。

## 文件树（完整）

```
packages/ingestion-inbox/src/replay-types.ts         # 新建
packages/ingestion-inbox/src/replay.ts               # 新建
packages/ingestion-inbox/migrations/1722500000002_event-inbox-replay.ts  # 新建
packages/ingestion-inbox/src/index.ts                # 编辑（追加导出）
packages/ingestion-inbox/test/replay.unit.test.ts    # 新建
packages/ingestion-inbox/test/integration/replay.test.ts  # 新建
packages/ingestion-inbox/test/security-negative.test.ts   # 编辑
packages/ingestion-inbox/test/package-entry.test.ts       # 编辑
packages/ingestion-inbox/README.md                   # 编辑
docs/architecture/ingestion-dead-letter-manual-replay.md  # implementation-status → implemented
docs/adr/ADR-017-ingestion-dead-letter-manual-replay.md   # 追加实施证据
docs/architecture/formalization-readiness.md         # 编辑
docs/adr/README.md                                   # 编辑（ADR-017 行）
docs/README.md                                       # 编辑（规格行）
AGENTS.md / AURORA_RULES.md                          # 编辑（状态同步）
```

## 每个文件单一职责

- `replay-types.ts`：`ReplayDeadLetteredEventInput`、`ReplayDeadLetteredEventResult`、`IngestionInboxReplayRepository` 类型定义。
- `replay.ts`：`replayDeadLettered(pool, input)` 事务实现；输入校验、`SELECT ... FOR UPDATE`、幂等重查、状态校验、operation 插入（唯一冲突重读）、状态更新。
- Migration：`replay_generation` 列（not null default 0 + 非负 CHECK）+ `event_inbox_replay_operations` 表 + up/down。
- `index.ts`：追加导出 `replayDeadLettered` 与类型。
- 测试：单元 + 集成 + 负例 + 包入口。

## 关键设计决策

1. **函数签名**：`replayDeadLettered(pool: Pool, input: ReplayDeadLetteredEventInput): Promise<ReplayDeadLetteredEventResult>`，与现有 `persistBatch(pool, input)` 风格一致。`inboxId` 为 `number`（bigserial）。
2. **事务**：`pool.connect()` → `BEGIN` → `SELECT ... FOR UPDATE`（限定 projectId+inboxId）→ 加锁后重查幂等 → 状态校验 → 插入 operation → 更新 event_inbox → `COMMIT`；catch → `ROLLBACK` → 稳定错误；finally → release。
3. **幂等竞态（独立审查中等问题）**：
   - 加锁前先查一次 operation（快速路径：已存在则按目标判定 `already_replayed`/`operation_conflict`）；
   - `SELECT ... FOR UPDATE` 锁定行后**再查一次** operation（避免 TOCTOU）；
   - operation INSERT 命中唯一冲突（`23505`）时：捕获后重读 operation，判定目标 → `already_replayed`/`operation_conflict`；不用约束文本。
   - 具体实现：插入用 `ON CONFLICT (operation_id) DO NOTHING RETURNING ...`，无返回行则重读判定。
4. **状态校验**：锁定行后读取 `state`；非 `dead_lettered` → `invalid_state` + currentState；行不存在 → `not_found`。
5. **字段更新**：`state='pending'`、`available_at=$requestedAt`、`attempt_count=0`、`replay_generation=replay_generation+1`、`lease_owner=NULL`、`lease_id=NULL`、`lease_expires_at=NULL`、`processed_at=NULL`、`dead_lettered_at=NULL`、`last_error_code=NULL`；RETURNING `replay_generation`。
6. **操作记录**：`operation_id`、`project_id`、`inbox_id`、`event_id`、`replay_generation`（新代次）、`previous_attempt_count`、`previous_error_code`、`requested_at`、`created_at`（`now()`）。`event_id`/`previous_error_code` 从锁定行读取。
7. **错误映射**：数据库错误 → `IngestionInboxError`（复用 `toStableError` 模式）；输入非法 → 抛 `IngestionInboxError('invalid_input')`（与 persistBatch 一致——现有仓库对非法输入抛错，对数据库失败返回稳定错误）。

## 完整 TypeScript 签名

```ts
// replay-types.ts
export interface ReplayDeadLetteredEventInput {
  readonly projectId: string;
  readonly inboxId: number;
  readonly operationId: string;
  readonly requestedAt: Date;
}

export type ReplayDeadLetteredEventResult =
  | { readonly status: 'replayed'; readonly replayGeneration: number; readonly availableAt: Date }
  | { readonly status: 'already_replayed'; readonly replayGeneration: number; readonly availableAt: Date }
  | { readonly status: 'not_found' }
  | { readonly status: 'invalid_state'; readonly currentState: string }
  | { readonly status: 'operation_conflict' };

export interface IngestionInboxReplayRepository {
  replayDeadLettered(input: ReplayDeadLetteredEventInput): Promise<ReplayDeadLetteredEventResult>;
}

// replay.ts
export async function replayDeadLettered(
  pool: Pool,
  input: ReplayDeadLetteredEventInput,
): Promise<ReplayDeadLetteredEventResult>;
```

## 每个 Task 精确路径与 TDD 闭环

### Task 1：ADR-017 状态、规格与结果契约类型

**Consumes**：ADR-017（accepted）、规格（approved）。
**Produces**：`replay-types.ts`；`replay.unit.test.ts` 的类型编译断言。

1. 失败测试：`test/replay.unit.test.ts` 引入 `import { replayDeadLettered } from '../src/replay.js'` 与类型断言（文件不存在 → 失败）。
2. 预期失败：`ERR_MODULE_NOT_FOUND` / TS2307。
3. 最小实现：创建 `replay-types.ts`；`replay.ts` 暂不创建（Task 2）。
   - 实际：Task 1 只建 `replay-types.ts`，类型测试断言编译通过。
4. 确认通过：`pnpm --filter @aurora/ingestion-inbox typecheck`。
5. 回归：`pnpm --filter @aurora/ingestion-inbox test`（无变化）。
6. 提交边界：replay-types.ts + 类型测试。

### Task 2：Migration

**Consumes**：无（新 Migration）。
**Produces**：`migrations/1722500000002_event-inbox-replay.ts`。

1. 失败测试：`test/integration/replay.test.ts` 断言 Migration 后 `event_inbox` 有 `replay_generation` 列、`event_inbox_replay_operations` 表存在（当前无 → 失败）。
2. 预期失败：列/表不存在。
3. 最小实现：Migration up（addColumn + addConstraint + createTable）+ down。
4. 确认通过：`test:integration`（schema 断言）。
5. 回归：`migrations.test.ts`（up/down/up 对称）。
6. 提交边界：Migration。

### Task 3：Repository 基础事务、项目隔离和状态校验

**Consumes**：`replay-types.ts`、Migration。
**Produces**：`replay.ts`（事务骨架：FOR UPDATE、项目隔离、状态校验、not_found/invalid_state）。

1. 失败测试（`replay.unit.test.ts` + `integration/replay.test.ts`）：
   - 单元：非法输入（空 projectId、非安全整数 inboxId、空 operationId、非法 Date）抛 `IngestionInboxError('invalid_input')`；
   - 集成：dead_lettered 行重放成功；pending/leased/retry_waiting/processed 拒绝（`invalid_state`）；不存在行/跨 project → `not_found`；事务中途失败回滚（构造 statement 失败）。
2. 预期失败：未实现 → 失败。
3. 最小实现：`replay.ts` 事务实现（Task 3 先做 FOR UPDATE + 状态校验 + 更新 + 无 operationId 幂等，Task 4 加幂等）。
   - 实际：Task 3 完整实现但 operation 插入前不查幂等（幂等留给 Task 4）；状态更新与操作记录写入一起做。
4. 确认通过：`test` + `test:integration`。
5. 回归：`processing-transitions.test.ts`（现有处理语义不回归）。
6. 提交边界：replay.ts 事务骨架 + 测试。

### Task 4：operationId 幂等、冲突和并发重放

**Consumes**：`replay.ts` 事务骨架。
**Produces**：`replay.ts` 幂等逻辑 + `operation_conflict`/`already_replayed` + `ON CONFLICT DO NOTHING` 重读。

1. 失败测试（追加）：
   - 相同 operationId + 相同目标第二次 → `already_replayed`（不修改状态/计数）；
   - 相同 operationId + 不同 inboxId → `operation_conflict`；
   - 两个并发相同 operationId+目标（Promise.all 两个 pool 连接）→ 只有一个 `replayed`，另一个 `already_replayed`；
   - 两个并发不同 operationId 重放同一行 → 一个 `replayed`，另一个 `invalid_state`；
   - 数据库错误不泄露 SQLSTATE/约束（用错误 SQL 触发，断言结果不含 SQLSTATE 文本）。
2. 预期失败：未实现幂等 → 失败。
3. 最小实现：`replay.ts` 加锁前查 + 加锁后重查 + `ON CONFLICT (operation_id) DO NOTHING RETURNING` + 无返回行时重读判定。
4. 确认通过：`test` + `test:integration`。
5. 回归：并发/事务测试。
6. 提交边界：幂等逻辑 + 并发测试。

### Task 5：attemptCount 重置、Worker 普通 claim 和 retry budget 回归

**Consumes**：`replay.ts`。
**Produces**：集成测试追加 Worker 回归场景。

1. 失败测试（追加 `integration/replay.test.ts`）：
   - replay 后 `attempt_count=0`、`replay_generation` 增加、lease 清空、`last_error_code` 保存到 operation 后清空、EventEnvelope/字段不变；
   - replay 后 Worker `claimAvailable` 能领取，claim 后 `attempt_count=1`；
   - replay 后 processor `processed`；
   - replay 后再次 retry → `retry_waiting`（ADR-015/016 行为）；
   - budget 耗尽再次 `dead_lettered` + `retry_budget_exhausted`；
   - Worker runtime 不自动调用人工重放（无重放相关调用）。
2. 预期失败：未实现 → 失败。
3. 最小实现：测试追加（复用 worker-e2e 模式）。
4. 确认通过：`test:integration`。
5. 回归：`apps/ingestion-worker` 回归（`pnpm --filter @aurora/ingestion-worker test` + `test:integration`）。
6. 提交边界：Worker 回归测试。

### Task 6：包入口、私有路径、Workspace Policy、安全与敏感信息负例

**Consumes**：全部实现。
**Produces**：`index.ts` 追加导出；`package-entry.test.ts` 追加断言；`security-negative.test.ts` 追加。

1. 失败测试：包入口断言 `replayDeadLettered`/类型导出（未导出 → 失败）；负例断言 src 不含 EventEnvelope/密钥/SQLSTATE/数据库 URL 模式（未覆盖 → 失败）。
2. 预期失败：导出缺失 / 负例命中。
3. 最小实现：`index.ts` 导出；确认负例通过。
4. 确认通过：`test`、`check:boundaries`。
5. 回归：`@aurora/ingestion-inbox` 全部既有测试。
6. 提交边界：index + 负例。

### Task 7：README、正式文档、ADR 实施证据、真实 PostgreSQL 集成和完整质量门禁

**Consumes**：全部实现。
**Produces**：README 更新、规格 `implementation-status: implemented`、ADR-017 追加实施证据、formalization-readiness/ADR-README/docs-README/AGENTS/AURORA_RULES 状态同步。

1. 失败测试：无新代码测试；执行完整门禁。
2. 最小实现：文档与状态同步。
3. 确认通过：`pnpm --filter @aurora/ingestion-inbox test:coverage`（85/80/85/85）、全仓门禁。
4. 回归：全仓。
5. 提交边界：README + 文档 + 状态同步。

## CLI / 命令

```text
cd D:/Develop/SDK/Aurora
pnpm --filter @aurora/ingestion-inbox typecheck
pnpm --filter @aurora/ingestion-inbox test
pnpm --filter @aurora/ingestion-inbox test:integration
pnpm --filter @aurora/ingestion-inbox test:coverage
pnpm --filter @aurora/ingestion-inbox build
pnpm --filter @aurora/ingestion-worker test
pnpm --filter @aurora/ingestion-worker test:integration
pnpm check:boundaries
pnpm lint
pnpm benchmark:ingestion:smoke
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:ci
git diff --check
```

## 预期结果

- inbox 单元测试全绿（含重放）；
- inbox 真实 PostgreSQL 集成测试全绿（含并发重放、Worker 回归、Migration up/down/up）；
- Worker 回归全绿（retry budget/backoff 不变）；
- benchmark smoke exit 0；
- 覆盖率 85/80/85/85；
- 全仓门禁 exit 0。

## 建议提交边界

- Commit 1：Task 1-2（types + Migration）。
- Commit 2：Task 3-4（replay.ts 事务 + 幂等 + 并发测试）。
- Commit 3：Task 5（Worker 回归测试）。
- Commit 4：Task 6-7（index/负例/README/文档/状态同步）。

## 禁止

- TODO/TBD/伪代码/模糊占位/未定义类型/批量重放/HTTP/UI/权限/审计/生产参数/修改 ADR-008/012/015/016 或现有 Inbox API/实现下一模块/git commit 授权。
