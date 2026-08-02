# Worker 重试预算与自动死信策略第一增量 (retry budget + auto dead-letter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `apps/ingestion-worker` 冻结并实施 Worker 重试预算与自动死信策略第一增量：`maxProcessingAttempts` typed config（必填、正整数、`Number.isSafeInteger`）、`decideRetryDisposition` 纯函数决策（`schedule-retry`/`dead-letter{retry_budget_exhausted}`/`invalid{processor_retry_result_invalid}`）、runtime 集成（processor 返回 retry 时 `attemptCount < maxProcessingAttempts` → `scheduleRetry` 沿用 processor availableAt/errorCode；`attemptCount >= maxProcessingAttempts` → `markDeadLettered{retry_budget_exhausted}` 单次）、非法 retry 结果与 processor 异常的不写回语义、稳定诊断。不新建包；不修改 Inbox 状态集合、lease/fencing、attemptCount 语义或 processor 三种结果；不实现退避算法或人工重放。这是 ADR-015 的第一增量。

**Architecture:** 策略只在 `apps/ingestion-worker` 内部（`src/retry-policy.ts` 纯函数 + `configuration.ts` 新增 `maxProcessingAttempts` + `worker-runtime.ts` 集成）。`decideRetryDisposition` 为纯函数，不访问数据库/环境变量/系统时间，不修改输入，不抛正常分支异常。runtime 在处理结果编排中：retry 分支先调用 `decideRetryDisposition`，根据结果 `schedule-retry`（调用 `scheduleRetry`）/ `dead-letter`（调用 `markDeadLettered{retry_budget_exhausted}`）/ `invalid`（记录诊断、不写回、lease 自然过期）。explicit dead-letter/processed 不走 budget 决策。`scheduleRetry`/`markDeadLettered` 返回 `lease_lost`/`not_found` 不二次写回。

**Tech Stack:** Node.js ≥24.18.0、TypeScript 6.0.3、Vitest 4.1.10、pnpm 11.17.0、PostgreSQL 17 + `pg` 8.22.0（复用 ADR-010 工具链）、`@aurora/ingestion-inbox` 包根（`scheduleRetry`/`markDeadLettered`）。

**Plan status:** ready-for-implementation（本消息已预先批准无歧义派生的规格与计划；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 只修改 `apps/ingestion-worker`（新增 `src/retry-policy.ts`、`test/retry-policy.test.ts`；修改 `src/configuration.ts`、`src/worker-runtime.ts`、`src/index.ts`、`test/configuration.test.ts`、`test/worker-orchestration.test.ts`、`test/integration/worker-retry-budget.test.ts`、`README.md`）与相关索引文档（formalization-readiness、AGENTS.md、AURORA_RULES.md、docs/README.md、ADR 索引）。
- 不修改 Inbox 状态集合、lease/fencing、attemptCount 语义、processor 三种结果；不新增数据库列或状态；不修改 HTTP/OpenAPI。
- `maxProcessingAttempts` 必填、正整数、`Number.isSafeInteger`；无隐式生产默认值；测试显式提供；`MAX_PROCESSING_ATTEMPTS` env adapter；生产值 `requires-benchmark`。
- `decideRetryDisposition` 纯函数：不访问数据库/环境变量/系统时间；不修改输入；不抛正常分支异常。
- budget 未耗尽（`attemptCount < maxProcessingAttempts`）→ `scheduleRetry` 用 processor availableAt/errorCode；耗尽（`attemptCount >= maxProcessingAttempts`）→ `markDeadLettered{retry_budget_exhausted}` 单次，不调用 `scheduleRetry`。
- explicit dead-letter/processed 不受 budget 影响；processor exception 保持 leased（不自动 retry/dead-letter、不计额外 attempt）；invalid retry 不写回。
- `scheduleRetry`/`markDeadLettered` 返回 `lease_lost`/`not_found` 不二次写回、记录有界诊断、不报告成功。
- 诊断：`retry_budget_exhausted`/`processor_retry_result_invalid`/`retry_policy_evaluation_failed`；允许 operation/inboxId/eventType/attemptCount/maxProcessingAttempts/稳定 errorCode/disposition；禁止 EventEnvelope body/原始 Error/stack/SQL/SQLSTATE/constraint/数据库 URL/密钥/用户输入。
- 真实 PostgreSQL 集成测试使用 `AURORA_TEST_DATABASE_URL`；目标必须是测试库（`aurora_inbox_test` 前缀）；隔离与完整清理；禁止 SQLite/mock/PGlite。
- 覆盖率 lines ≥85 / branches ≥80 / functions ≥85 / statements ≥85。
- ADR 状态：ADR-015 `accepted / implemented`；ADR-008 `accepted / in-progress`；ADR-010 `accepted / implemented`；ADR-011 `accepted / in-progress`；ADR-013/014 `accepted / implemented` 不变。

---

## 文件树

```text
apps/ingestion-worker/
├── src/
│   ├── retry-policy.ts          # Create：decideRetryDisposition 纯函数 + RetryDisposition/DecideRetryDispositionInput
│   ├── configuration.ts         # Modify：新增 maxProcessingAttempts（MAX_PROCESSING_ATTEMPTS 读取与校验）
│   ├── worker-runtime.ts        # Modify：retry 分支集成 decideRetryDisposition
│   └── index.ts                 # Modify：导出 decideRetryDisposition/RetryDisposition/DecideRetryDispositionInput
├── test/
│   ├── retry-policy.test.ts     # Create [ENV-INDEPENDENT]：policy 纯函数
│   ├── configuration.test.ts    # Modify：maxProcessingAttempts 配置测试
│   ├── worker-orchestration.test.ts  # Modify：retry budget 分支单元（fake Repository）
│   ├── package-entry.test.ts    # Modify：retry-policy 出口 + 私有路径
│   ├── documentation-contract.test.ts # Modify：README/规格契约
│   └── integration/
│       └── worker-retry-budget.test.ts # Create [PG-GATED]：真实 PG retry budget 集成
```

每个文件单一职责；不创建 utils/helpers/common 或通用 policy framework；不实现退避算法/人工重放/具体 processor。

---

## Consumes / Produces 总览

- **Consumes**：`docs/architecture/ingestion-worker-retry-budget-policy.md`（approved 规格）、`docs/adr/ADR-015-ingestion-worker-retry-budget-policy.md`（accepted）、`apps/ingestion-worker` 现有 `configuration.ts`/`worker-runtime.ts`/`processor.ts`、`@aurora/ingestion-inbox` 包根 `scheduleRetry`/`markDeadLettered`、ADR-004/008/012 约束。
- **Produces**：`retry-policy.ts` 纯函数、`maxProcessingAttempts` 配置、runtime 集成、单元测试、真实 PostgreSQL 集成测试、README、ADR-015 证据、formalization-readiness 更新。

---

## Task 1: policy 纯函数 [ENV-INDEPENDENT]

**目标：** 实现 `decideRetryDisposition`：`attemptCount < maxProcessingAttempts` → `schedule-retry`（原样保留 availableAt/errorCode）；`attemptCount >= maxProcessingAttempts` → `dead-letter{retry_budget_exhausted}`；非法输入 → `invalid{processor_retry_result_invalid}`；不访问数据库/环境变量/系统时间；不修改输入；不抛正常分支异常。

- Consumes: 规格 §13。
- Produces: `src/retry-policy.ts`、`test/retry-policy.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/retry-policy.test.ts`：
    - attempt 1 / max 3 → `schedule-retry` 且 availableAt/errorCode 原样；
    - attempt 2 / max 3 → `schedule-retry`；
    - attempt 3 / max 3 → `dead-letter` 且 errorCode === `retry_budget_exhausted`；
    - attempt 4 / max 3 → `dead-letter`；
    - 输入不被修改；
    - 非法输入（`maxProcessingAttempts` 非正整数、`attemptCount` 非正整数、`availableAt` 非法 Date、`errorCode` 空字符串）→ `invalid{processor_retry_result_invalid}`；
    - 不抛出正常控制流异常（用非法输入调用不 throw）。

- [ ] **Step 2: 最小实现**
  - `src/retry-policy.ts`：
    ```ts
    export interface DecideRetryDispositionInput {
      readonly attemptCount: number;
      readonly maxProcessingAttempts: number;
      readonly availableAt: Date;
      readonly errorCode: string;
    }
    export type RetryDisposition =
      | { readonly status: 'schedule-retry'; readonly availableAt: Date; readonly errorCode: string }
      | { readonly status: 'dead-letter'; readonly errorCode: 'retry_budget_exhausted' }
      | { readonly status: 'invalid'; readonly diagnosticCode: 'processor_retry_result_invalid' };
    export function decideRetryDisposition(input: DecideRetryDispositionInput): RetryDisposition;
    ```
    - 校验：`attemptCount` 正整数、`maxProcessingAttempts` 正整数、`availableAt` 是有效 Date、`errorCode` 非空；任一非法 → `invalid`；
    - `attemptCount < maxProcessingAttempts` → `schedule-retry`；否则 → `dead-letter{retry_budget_exhausted}`；
    - 不修改输入；不访问外部状态。

- [ ] **Step 3: 确认通过**
  - `pnpm --filter @aurora/ingestion-worker typecheck` exit 0；`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`；`pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `src/retry-policy.ts`、`test/retry-policy.test.ts`。

---

## Task 2: maxProcessingAttempts 配置 [ENV-INDEPENDENT]

**目标：** `IngestionWorkerConfig` 新增 `maxProcessingAttempts`；`loadIngestionWorkerConfig` 从 `MAX_PROCESSING_ATTEMPTS` 读取并校验（必填、正整数、`Number.isSafeInteger`）；缺失/0/负数/小数/非安全整数抛错；返回冻结对象。

- Consumes: 规格 §6/§14。
- Produces: `src/configuration.ts` 修改、`test/configuration.test.ts` 修改。

- [ ] **Step 1: 失败测试**
  - `test/configuration.test.ts`：
    - 合法 `MAX_PROCESSING_ATTEMPTS: '3'` → config.maxProcessingAttempts === 3；
    - 缺失 → 抛错（`/MAX_PROCESSING_ATTEMPTS/`）；
    - `'0'` → 抛错；
    - `'-1'` → 抛错；
    - `'2.5'` → 抛错；
    - `'9007199254740992'`（非安全整数）→ 抛错；
    - `Object.isFrozen(config)` 仍为 true。

- [ ] **Step 2: 最小实现**
  - `configuration.ts`：接口加 `readonly maxProcessingAttempts: number`；`loadIngestionWorkerConfig` 用 `requiredPositiveInt(env, 'MAX_PROCESSING_ATTEMPTS')`（`requiredPositiveInt` 已校验正整数与 `Number.isSafeInteger`？确认——现有 `requiredPositiveInt` 用 `Number.isSafeInteger(parsed) && parsed > 0`，满足要求）。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/configuration.ts`、`test/configuration.test.ts`。

---

## Task 3: runtime 集成（retry budget 分支）[ENV-INDEPENDENT]

**目标：** `worker-runtime.ts` 的 retry 分支集成 `decideRetryDisposition`：`schedule-retry` → `scheduleRetry`（用 processor availableAt/errorCode）；`dead-letter` → `markDeadLettered{retry_budget_exhausted}`；`invalid` → 记录诊断 `processor_retry_result_invalid`、不写回、不 markProcessed；explicit dead-letter/processed 不走 budget 决策；`lease_lost`/`not_found` 不二次写回。

- Consumes: 规格 §8/§9/§10/§12、Task 1-2。
- Produces: `src/worker-runtime.ts` 修改、`test/worker-orchestration.test.ts` 修改。

- [ ] **Step 1: 失败测试**
  - `test/worker-orchestration.test.ts`（fake Repository）：
    - processor 返回 retry 且 attemptCount=1、max=3 → 调用 `scheduleRetry({availableAt, errorCode})`；
    - processor 返回 retry 且 attemptCount=3、max=3 → 调用 `markDeadLettered({errorCode: 'retry_budget_exhausted'})` 且**不**调用 `scheduleRetry`；
    - attemptCount=4、max=3 → `markDeadLettered{retry_budget_exhausted}`；
    - explicit dead-letter 不受 budget 影响（attempt 高仍 `markDeadLettered` 用 processor errorCode）；
    - processed 不受 budget 影响；
    - invalid retry（空 errorCode）→ 不调用 scheduleRetry/markDeadLettered，记录诊断 `processor_retry_result_invalid`；
    - `markDeadLettered` 返回 `lease_lost` → 不二次写回、记录诊断、不报告成功；
    - attemptCount 不因 Worker 决策二次增加（fake claim 返回 attemptCount=N，断言 write-back 参数不修改 attempt）。

- [ ] **Step 2: 最小实现**
  - `worker-runtime.ts` retry 分支：
    ```ts
    } else if (result.outcome === 'retry') {
      const disposition = decideRetryDisposition({
        attemptCount: event.attemptCount,
        maxProcessingAttempts: input.config.maxProcessingAttempts,
        availableAt: result.availableAt,
        errorCode: result.errorCode,
      });
      if (disposition.status === 'schedule-retry') {
        writeResult = await input.repository.scheduleRetry({
          id: event.id, leaseId: event.leaseId,
          availableAt: disposition.availableAt, errorCode: disposition.errorCode,
        });
      } else if (disposition.status === 'dead-letter') {
        writeResult = await input.repository.markDeadLettered({
          id: event.id, leaseId: event.leaseId, errorCode: disposition.errorCode,
        });
      } else {
        record({ operation: 'policy', code: 'processor_retry_result_invalid', ...facts });
        return; // do not write back; lease expires naturally
      }
    }
    ```
  - explicit dead-letter/processed 分支保持现状（不走 budget）；
  - `lease_lost`/`not_found` 写回后不二次转换（现有逻辑已满足）。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/worker-runtime.ts`、`test/worker-orchestration.test.ts`。

---

## Task 4: 包根出口、文档契约 [ENV-INDEPENDENT]

**目标：** `index.ts` 导出 `decideRetryDisposition`/`RetryDisposition`/`DecideRetryDispositionInput`；README 更新；文档契约与安全负例。

- Consumes: 规格 §13/§15。
- Produces: `src/index.ts` 修改、`test/package-entry.test.ts` 修改、`test/documentation-contract.test.ts` 修改、`README.md` 更新。

- [ ] **Step 1: 失败测试**
  - `package-entry.test.ts`：包根导出 `decideRetryDisposition`；`retry-policy.ts` 私有路径不可导入；
  - `documentation-contract.test.ts`：README 含 `maxProcessingAttempts`/`retry_budget_exhausted`/`decideRetryDisposition`，不宣称人工重放已实现；
  - `security-negative.test.ts`（若已有）：`retry-policy.ts` 无 console.log/secret/EventEnvelope 日志。

- [ ] **Step 2: 最小实现**
  - `index.ts` 导出；README 更新（retry budget 章节）；负例/文档契约测试完善。

- [ ] **Step 3: 确认通过**
  - `pnpm check:boundaries` exit 0；`pnpm lint` exit 0；负例与文档契约测试通过。

- [ ] **Step 4: 相关回归**
  - 全包 `typecheck`。

- [ ] **Step 5: 建议提交边界**
  - `src/index.ts`、`README.md`、`test/package-entry.test.ts`、`test/documentation-contract.test.ts`。

---

## Task 5: 真实 PostgreSQL retry budget 集成测试 [PG-GATED]

**目标：** 真实 PG 验证 budget 未耗尽→retry_waiting、耗尽→dead_lettered、exhausted 单次 markDeadLettered、attemptCount 不二次增加、explicit dead-letter/processed 不受影响、processor exception 保持 leased、invalid retry 不写回、lease lost 不二次写回、双 Worker 不重复。

- Consumes: 规格 §17、`apps/ingestion-worker` 集成 helpers、Task 1-3。
- Produces: `test/integration/worker-retry-budget.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/integration/worker-retry-budget.test.ts`（真实 PG）：
    - 插入事件；processor 返回 retry；`maxProcessingAttempts=3`、attemptCount=1 → `retry_waiting`（且 availableAt/errorCode 为 processor 值）；
    - 再领取（attemptCount=2）retry → `retry_waiting`；
    - attemptCount=3 retry → `dead_lettered` 且 `last_error_code='retry_budget_exhausted'`；
    - exhausted 不调用 scheduleRetry（数据库无 retry_waiting 残留）；
    - attemptCount 不被 Worker 二次增加（从 claim 返回的 attemptCount 直接用于决策，无二次 +1）；
    - explicit dead-letter（attempt 高）→ `dead_lettered` 用 processor errorCode（非 budget 码）；
    - processed（attempt 高）→ `processed`；
    - processor 抛出 → 保持 `leased`（或过期后可重领），无 processed/retry/dead-letter 写入；
    - invalid retry（空 errorCode）→ 不写入 retry/dead-letter，状态保持 leased；
    - lease lost：外部改 lease_id 后 scheduleRetry 返回 lease_lost → 不二次写回；
    - 双 Worker 并发不重复完成同一 lease（每条只一次 processed/dead-letter）。

- [ ] **Step 2: 最小实现**
  - 复用 `apps/ingestion-worker` 集成 helpers（`createProcessingRepository`/`insertEvent`/真实 Repository 组合）；`buildIngestionWorker` + fake processor + `maxProcessingAttempts` 短值（如 3）；用轮询/数据库断言，不用长 sleep。

- [ ] **Step 3: 确认通过**
  - 真实 PG retry budget 集成测试通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-worker test`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `test/integration/worker-retry-budget.test.ts`。

---

## Task 6: 覆盖率、根级门禁、文档与 ADR 证据 [ENV-INDEPENDENT / 结果门控]

**目标：** 覆盖率 ≥ lines 85 / branches 80 / functions 85 / statements 85；README、formalization-readiness、ADR-015 证据、ADR 索引同步；根级完整质量门禁。

- Consumes: 全部 Task 产物、规格、ADR-015。
- Produces: `README.md` 更新、`docs/architecture/formalization-readiness.md` 更新、ADR-015 追加记录、`docs/adr/README.md` 状态同步、`docs/README.md`、`AGENTS.md`/`AURORA_RULES.md` 同步。

- [ ] **Step 1: 失败测试（文档契约先行）**
  - `test/documentation-contract.test.ts`：README 含 retry budget 职责/非职责、不宣称人工重放已实现。

- [ ] **Step 2: 最小实现文档**
  - 更新 `README.md`；
  - 更新 `formalization-readiness.md`：Worker retry budget policy implemented、人工重放 blocked/not-started；
  - ADR-015 追加实施证据；ADR 索引同步 ADR-015 `implemented`；
  - `AGENTS.md`/`AURORA_RULES.md` 状态同步；`docs/README.md` 若需要登记新正式文档。

- [ ] **Step 3: 确认通过**
  - 文档契约测试通过；`pnpm format:check`、`git diff --check`。

- [ ] **Step 4: 相关回归**
  - 全仓：`pnpm install --frozen-lockfile`、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:coverage`、`pnpm check:boundaries`、`pnpm build`、`pnpm check:ci` 分段、`git diff --check`；真实 PG 可用时加 Worker `test:integration`；ingestion-api/credentials/event-schema/Browser 回归。

- [ ] **Step 5: 建议提交边界**
  - README、formalization-readiness、ADR-015 追加记录、ADR 索引、AGENTS/AURORA_RULES、docs/README。

---

## 完成报告要求

实施完成并全部门禁通过后，报告必须包含：当前 Worker policy 缺口核验；最终模块选择；新 ADR 路径/编号/状态；正式规格路径与状态；writing-plans 路径与状态；Task 数量与完成状态；maxProcessingAttempts 配置；policy API；budget 未耗尽行为；budget exhausted 行为；processor exception 行为；invalid retry 行为；lease lost；PostgreSQL 测试；覆盖率；敏感信息扫描；全部质量命令与退出码；与计划的偏差；ADR 状态（ADR-015 implemented、ADR-008 in-progress、ADR-010 implemented、ADR-011 in-progress、ADR-013/014 implemented）；Git 状态；更新后的剩余模块统计；建议提交边界；并明确说明：未提交或推送；未实现人工重放、具体 processor、管理 API、CI/RDS/IaC；未规划或实施下一模块。
