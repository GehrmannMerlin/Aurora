# 实施计划：数据接入 Worker 重试退避调度策略第一增量

## 文件头

- 日期：2026-08-02
- 模块：`apps/ingestion-worker`（`@aurora/ingestion-worker`）退避能力扩展
- 正式规格：`docs/architecture/ingestion-worker-retry-backoff-schedule.md`（approved）
- ADR：`docs/adr/ADR-016-ingestion-worker-retry-backoff-schedule.md`（accepted）
- 计划状态：ready-for-implementation
- 目标读者：零上下文工程师
- 权威来源：ACLAUDE.md/AGENTS.md/AURORA_RULES.md 快照、approved 规格、accepted ADR-004/008/012/015/016、approved Worker 运行时/retry budget 规格

## Goal

在 `apps/ingestion-worker` 内实现显式调用的重试退避时间计算能力：capped exponential backoff + equal jitter、可注入 entropy provider、Node crypto entropy adapter、可选 `notBefore` 下限、稳定失败结果与输入不变约束。**不**修改 ADR-015 结论、processor 契约、retry budget、Worker 主循环语义，也不固定生产参数。

## Architecture

```
apps/ingestion-worker/src/
  retry-backoff-types.ts    # 配置、entropy、结果联合类型
  retry-backoff-policy.ts   # capped exponential + equal jitter 纯计算
  retry-backoff-entropy.ts  # entropy provider 接口 + crypto adapter
apps/ingestion-worker/test/
  retry-backoff-policy.test.ts
  retry-backoff-entropy.test.ts
apps/ingestion-worker/test/integration/
  worker-backoff-retry.test.ts
```

依赖方向：`retry-backoff-policy.ts` 依赖 `retry-backoff-types.ts` 与 `retry-backoff-entropy.ts`；`retry-backoff-entropy.ts` 依赖 `retry-backoff-types.ts`；均不依赖 Worker 运行时或 processor。包根 `index.ts` 导出最小公共 API。

## Tech Stack

- TypeScript 6.0.3（strict，NodeNext，ES2024，verbatimModuleSyntax）
- `node:crypto`（crypto adapter；`randomBytes` → `[0,1)` 数值）
- vitest 4.1.10（测试）；真实 PostgreSQL 17（集成测试）

## Global Constraints

- 不使用 `Math.random`；不使用全局可变随机状态；
- 不创建 timer/sleeper/后台任务；不访问数据库（策略函数）；
- 不修改 `IngestionWorkerConfig`、`IngestionEventProcessor`、`ProcessIngestionEventResult`、`decideRetryDisposition`、`RetryDisposition`、`maxProcessingAttempts`；
- 不修改 Inbox 状态集合、租约、fencing、`scheduleRetry`/`markDeadLettered` 签名；
- 不修改 event-schema、HTTP 或 OpenAPI；
- 输入不变、结果只读/冻结；稳定失败结果不通过正常控制流抛异常；
- 指数计算饱和处理，不允许 `Infinity`/不安全整数；
- 不固定生产退避参数；不激活具体 processor；Worker 主循环不隐式调用退避；
- 不 `git add`/`commit`/`push`；不创建 worktree；不切换分支。

## 文件树（完整）

```
apps/ingestion-worker/src/retry-backoff-types.ts
apps/ingestion-worker/src/retry-backoff-policy.ts
apps/ingestion-worker/src/retry-backoff-entropy.ts
apps/ingestion-worker/src/index.ts   # 追加导出（编辑）
apps/ingestion-worker/test/retry-backoff-policy.test.ts
apps/ingestion-worker/test/retry-backoff-entropy.test.ts
apps/ingestion-worker/test/security-negative.test.ts   # 追加 Math.random/timer 负例（编辑）
apps/ingestion-worker/test/integration/worker-backoff-retry.test.ts
apps/ingestion-worker/README.md   # 追加退避职责与接口
docs/adr/ADR-016-ingestion-worker-retry-backoff-schedule.md   # 追加实施证据
docs/architecture/ingestion-worker-retry-backoff-schedule.md  # implementation-status → implemented
docs/architecture/formalization-readiness.md   # 状态更新
docs/adr/README.md   # ADR-016 行
AGENTS.md / AURORA_RULES.md   # 状态同步
```

## 每个文件单一职责

- `retry-backoff-types.ts`：`RetryBackoffConfig`、`RetryBackoffEntropyProvider`、`RetryBackoffResult`（联合类型）定义；不包含逻辑。
- `retry-backoff-policy.ts`：`computeRetryBackoffDelay`/`calculateRetryBackoffSchedule` 纯函数；饱和指数、equal jitter、notBefore、稳定失败。
- `retry-backoff-entropy.ts`：entropy provider 工厂 + `createNodeCryptoEntropyProvider`。
- `index.ts`：追加导出上述类型与函数。

## 关键设计决策

1. **API 形态**：一个纯函数 `calculateRetryBackoffSchedule(input)` 接受 `{ config, attemptCount, now, entropy?, notBefore? }`，返回 `RetryBackoffResult`。entropy 默认用 crypto adapter（或要求显式传入？）：规格允许 `entropy?: number` 直接传入（可注入确定性测试）或 `entropyProvider?: RetryBackoffEntropyProvider`。为保持纯函数可测，`entropy` 作为可选的 `number`（调用方从 provider 获取）比传 provider 更简单；同时提供 `entropyProvider` 工厂。决定：`calculateRetryBackoffSchedule` 接受显式 `entropy: number`（调用方负责从 provider 获取），`entropyProvider` 独立工厂供调用方取熵；这样纯函数完全不依赖随机源，符合"可注入 entropy"与"纯计算"。
2. **饱和幂**：不使用 `2 ** (attempt-1)` 的浮点幂。实现安全整数幂：`exponentialDelay = initialDelayMs * pow2(attempt - 1)`，其中 `pow2` 在结果超过 `Number.MAX_SAFE_INTEGER` 或超过 `maxDelayMs` 时直接封顶到 `maxDelayMs`（预先已知上限，只需迭代倍增并检测 `> maxDelayMs` 即截断）。
3. **时间加法**：`now.getTime() + delayMs`；若结果 `> 8.64e15`（Date 上限）或 `Number.isSafeInteger` 不成立，返回 `date_out_of_range`。
4. **notBefore**：`notBefore` 为合法 Date 时 `availableAt = new Date(Math.max(calcTime, notBefore.getTime()))`。
5. **entropy 校验**：`entropy < 0 || entropy >= 1 || !Number.isFinite(entropy)` → `invalid_entropy`。

## 完整 TypeScript 签名

```ts
// retry-backoff-types.ts
export interface RetryBackoffConfig {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
}

export interface RetryBackoffEntropyProvider {
  next(): number;
}

export type RetryBackoffResult =
  | {
      readonly status: 'success';
      readonly delayMs: number;
      readonly availableAt: Date;
      readonly cappedDelayMs: number;
    }
  | { readonly status: 'invalid_config' }
  | { readonly status: 'invalid_attempt_count' }
  | { readonly status: 'invalid_now' }
  | { readonly status: 'invalid_not_before' }
  | { readonly status: 'invalid_entropy' }
  | { readonly status: 'date_out_of_range' };

// retry-backoff-entropy.ts
export function createNodeCryptoEntropyProvider(): RetryBackoffEntropyProvider;

// retry-backoff-policy.ts
export interface CalculateRetryBackoffScheduleInput {
  readonly config: RetryBackoffConfig;
  readonly attemptCount: number;
  readonly now: Date;
  readonly entropy: number;
  readonly notBefore?: Date;
}
export function calculateRetryBackoffSchedule(
  input: CalculateRetryBackoffScheduleInput,
): RetryBackoffResult;
```

## 每个 Task 精确路径与 TDD 闭环

### Task 1：ADR-016 状态、规格与结果契约类型

**Consumes**：ADR-016（accepted）、正式规格（approved）。
**Produces**：`retry-backoff-types.ts`；ADR-016 追加记录更新为 `accepted / not-started`（已有）；规格 `implementation-status: not-started`（已有）。

1. 失败测试：`test/retry-backoff-policy.test.ts` 引入 `import { calculateRetryBackoffSchedule } from '../src/retry-backoff-policy.js'` 与类型断言（此时文件不存在，import 失败）。
2. 预期失败：`ERR_MODULE_NOT_FOUND` / TS2307。
3. 最小实现：创建 `retry-backoff-types.ts`（类型定义）；创建空的 `retry-backoff-policy.ts`（仅导出函数签名但抛"not implemented"占位？——规格禁止占位。改为 Task 1 只建 `types.ts`，policy 测试在 Task 2 才出现）。
   - 修正：Task 1 只创建 `retry-backoff-types.ts`；`test/retry-backoff-types.test.ts` 断言类型可通过编译。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker typecheck`。
5. 回归：`pnpm --filter @aurora/ingestion-worker test`（无变化）。
6. 提交边界：types.ts + 类型测试。

### Task 2：capped exponential 纯计算与边界校验

**Consumes**：`retry-backoff-types.ts`。
**Produces**：`retry-backoff-policy.ts`（`calculateRetryBackoffSchedule` + 私有 `computeExponentialDelay`）。

1. 失败测试：`test/retry-backoff-policy.test.ts`：
   - attempt=1 时 `cappedDelayMs === initialDelayMs`（当 `maxDelayMs >= initialDelayMs`）；
   - attempt=2 时 `cappedDelayMs === initialDelayMs * 2`（若 `< maxDelayMs`）；
   - 大 attemptCount 饱和：`cappedDelayMs === maxDelayMs`；
   - `initialDelayMs === maxDelayMs` 时所有 attempt 的 `cappedDelayMs === maxDelayMs`；
   - 无效配置（0、负数、非安全整数、`maxDelayMs < initialDelayMs`）→ `invalid_config`；
   - 无效 attemptCount（0、负数、非安全整数）→ `invalid_attempt_count`；
   - 无效 now（非 Date、NaN）→ `invalid_now`。
2. 预期失败：import 不存在 / 断言不通过。
3. 最小实现：在 `retry-backoff-policy.ts` 实现饱和指数与校验；`entropy` 部分先用确定性占位（`delayMs = cappedDelayMs` 且记录该决策，Task 3 换成 jitter）。
   - 实际做法：Task 2 完整实现校验 + 饱和指数 + `cappedDelayMs` 返回；`delayMs` 先等于 `lowerBound`（即 entropy=0 情形），Task 3 加 jitter。
4. 确认通过：`test`。
5. 回归：`retry-policy.test.ts`（预算策略不受影响）。
6. 提交边界：policy.ts 校验/饱和指数部分。

### Task 3：equal jitter 与 crypto entropy adapter

**Consumes**：`retry-backoff-types.ts`、`retry-backoff-policy.ts`。
**Produces**：`retry-backoff-entropy.ts`；完善 `retry-backoff-policy.ts` 的 jitter。

1. 失败测试（追加到 `retry-backoff-policy.test.ts` + 新建 `retry-backoff-entropy.test.ts`）：
   - entropy=0：`delayMs === lowerBound`；
   - entropy 接近 1：`delayMs <= cappedDelayMs` 且 `>= lowerBound`；
   - `cappedDelayMs` 奇数/偶数均合法；
   - `cappedDelayMs` 极小值 1/2 返回非零合法值；
   - 非法 entropy（<0、>=1、NaN、Infinity）→ `invalid_entropy`；
   - notBefore 早于计算：`availableAt === now + delayMs`；
   - notBefore 晚于计算：`availableAt === notBefore`；
   - 无效 notBefore → `invalid_not_before`；
   - Date 越界 → `date_out_of_range`；
   - crypto adapter：多次 `next()` 都 `>=0 && <1` 且为有限值；
   - 输入不变、结果只读/冻结；
   - 不使用 `Math.random`（security-negative 追加）。
2. 预期失败：未实现 / 断言不通过。
3. 最小实现：`retry-backoff-entropy.ts`（crypto adapter：`randomBytes(8)` → BigInt → `[0,1)`，确保 `>=0 && <1`）；`retry-backoff-policy.ts` 完成 jitter 公式与 notBefore/date_out_of_range。
4. 确认通过：`test`。
5. 回归：`test:integration` 相关 Worker 回归（Task 5 前可先跑既有集成确认无破坏）。
6. 提交边界：entropy.ts + policy.ts jitter/notBefore 部分。

### Task 4：package entry、架构边界与安全负例

**Consumes**：前 3 Task。
**Produces**：`index.ts` 追加导出；`security-negative.test.ts` 追加负例；Workspace Policy 核验。

1. 失败测试：`package-entry.test.ts` 断言 `calculateRetryBackoffSchedule`/`createNodeCryptoEntropyProvider`/`RetryBackoffResult` 从包根导出（此时未导出 → 失败）；`security-negative.test.ts` 断言 src 不含 `Math.random`/`setTimeout`/`setInterval`（退避文件不应含）。
2. 预期失败：导出缺失 / 负例命中。
3. 最小实现：`index.ts` 追加导出；确认退避文件无上述禁止模式。
4. 确认通过：`test`、`check:boundaries`。
5. 回归：`@aurora/ingestion-worker` 全部既有测试。
6. 提交边界：index.ts + 负例。

### Task 5：真实 PostgreSQL 退避 retry 场景

**Consumes**：`retry-backoff-policy.ts`、`retry-backoff-entropy.ts`、既有 `worker-e2e` 模式。
**Produces**：`test/integration/worker-backoff-retry.test.ts`。

1. 失败测试：
   - 插入事件；synthetic processor 显式调用 `calculateRetryBackoffSchedule`（确定性 entropy=0）返回 retry；
   - 断言事件进入 `retry_waiting`，`available_at` 落在 `[now + ceil(capped/2), now + capped]`；
   - 到期前（短可用窗口内）第二 Worker 不可 claim；
   - 到期后（等待窗口）可 claim 并最终 processed；
   - budget exhausted（maxProcessingAttempts=1，processor 返回 retry）→ `dead_lettered` + `retry_budget_exhausted`（ADR-015 语义不变）；
   - 无残留 leased/retry_waiting；Schema/Pool 清理。
2. 预期失败：新测试无实现 → 失败。
3. 最小实现：写集成测试（复用 `helpers.ts` 的 `createTestPool`/`migrateUp`/`clearEventInbox`/`queryRow` 模式）。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker test:integration`。
5. 回归：既有 `worker-retry-budget.test.ts`（预算语义不回归）。
6. 提交边界：集成测试文件。

### Task 6：README、文档、覆盖率、ADR 证据与完整门禁

**Consumes**：全部实现。
**Produces**：README 更新、规格 `implementation-status: implemented`、ADR-016 追加实施证据、formalization-readiness/ADR-README/AGENTS/AURORA_RULES 状态同步。

1. 失败测试：无新代码测试；执行完整门禁。
2. 最小实现：文档与状态同步。
3. 确认通过：`pnpm --filter @aurora/ingestion-worker test:coverage`（85/80/85/85）、全仓门禁。
4. 回归：全仓。
5. 提交边界：README + 文档 + 状态同步。

## CLI / 命令

```text
cd D:/Develop/SDK/Aurora
pnpm --filter @aurora/ingestion-worker typecheck
pnpm --filter @aurora/ingestion-worker test
pnpm --filter @aurora/ingestion-worker test:integration
pnpm --filter @aurora/ingestion-worker test:coverage
pnpm --filter @aurora/ingestion-worker build
pnpm check:boundaries
pnpm lint
pnpm benchmark:ingestion:smoke
# 定向退避韧性场景：由集成测试 test:integration 覆盖；benchmark 的 retry 场景由既有 e2e-retry-budget 保持
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:ci
git diff --check
```

## 预期结果

- Worker 单元测试全绿（含退避）；
- Worker 真实 PostgreSQL 集成测试全绿（含退避 retry 场景）；
- benchmark smoke exit 0；
- 覆盖率 85/80/85/85；
- 全仓门禁 exit 0。

## 建议提交边界

- Commit 1：Task 1-4（types/policy/entropy/index/负例）。
- Commit 2：Task 5（PostgreSQL 集成测试）。
- Commit 3：Task 6（README/文档/状态同步）。

## 禁止

- TODO/TBD/伪代码/模糊占位/未定义类型/生产参数/生产 SLO/实现退避以外模块/规划下一模块/修改 ADR-015 或 processor 契约/git commit 授权。
