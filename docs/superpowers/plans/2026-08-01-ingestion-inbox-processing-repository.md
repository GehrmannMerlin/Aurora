# Ingestion Inbox Processing Repository (Inbox 处理侧 Repository、租约与状态转换第一增量) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@aurora/ingestion-inbox` 中冻结并实施处理侧能力第一增量：`lease_id` fencing 增量 Migration、原子领取 `claimAvailable`（`FOR UPDATE SKIP LOCKED`）、`renewLease`、`markProcessed`、`scheduleRetry`、`markDeadLettered`，以及真实 PostgreSQL 17 并发/租约 fencing/状态转换集成测试。这是 ADR-008 Worker 波次的第一个独立增量；**不**实现 Worker 运行循环、业务处理器、退避算法、最大重试次数或固定策略数值。

**Architecture:** 在现有 `event_inbox` 表上增加增量 Migration（`lease_id` UUID 可空 + lease 字段一致性 check constraint）。处理侧 SQL 用 `FOR UPDATE SKIP LOCKED` 原子领取（同一事务更新为 `leased` 并设置 `lease_id`/`lease_owner`/`lease_expires_at`），数据库 `now()` 为权威时间。所有写回（renew/processed/retry/dead-letter）通过 `id + state='leased' + lease_id + lease_expires_at > now()` 条件匹配，失败返回稳定 `lease_lost`/`not_found`。新类型与函数只通过包根导出。

**Tech Stack:** PostgreSQL 17、`pg` 8.22.0（生产依赖）、`node-pg-migrate` 9.0.0（devDependency）、`@aurora/event-schema` 包根、TypeScript 6.0.3、Vitest 4.1.10、pnpm 11.17.0、Node.js ≥24.18.0。

**Plan status:** ready-for-implementation（本消息已预先批准无歧义派生的规格与计划；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 只修改 `packages/ingestion-inbox`（新增 `src/processing-*.ts`、增量 Migration、`test/integration/processing-*.test.ts`）与相关索引文档。不修改 `event-schema`、`apps/ingestion-api` 公共语义。
- 状态集合不变：`pending`/`leased`/`retry_waiting`/`processed`/`dead_lettered`；不新增同义状态。
- 幂等范围 `(project_id, event_id)`、ACK 事务边界不变。
- 数据库时间 `now()` 权威；不暴露客户端时间/任意 now 参数。
- 所有操作参数化；所有结果稳定可判别；不泄露 SQL/SQLSTATE/约束名/EventEnvelope。
- 新 API 只通过 `@aurora/ingestion-inbox` 包根导出；`aurora.layer: data` 不变。
- `leaseDurationMs`、`limit`、`availableAt` 由调用方显式传入并做有界校验；不硬编码产品默认值。
- `attempt_count` 只在成功获得新处理租约时递增；续租不递增。
- 租约时长、批量大小、重试次数、退避数值均 `requires-benchmark`，不由本模块固定。
- 增量 Migration 不编辑已有初始 Migration；不破坏性删除现有列。
- 文件 kebab-case，类型/接口 PascalCase，函数/变量 camelCase，布尔 `is`/`has`/`can`/`should` 前缀。禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore`、静默 catch。
- 真实 PostgreSQL 集成测试使用 `AURORA_TEST_DATABASE_URL`；确认目标是测试数据库；独立 Schema/命名空间隔离；清理失败显式报错；禁止 SQLite/mock/PGlite 替代证据。
- 不使用 `sleep` 作为主要同步方式；优先并发事务、barrier、Promise 协调、数据库状态断言。
- 覆盖率 lines ≥85 / branches ≥80 / functions ≥85 / statements ≥85。
- ADR 状态：ADR-008 `accepted / in-progress`；ADR-010 `accepted / implemented`；ADR-011 `accepted / in-progress` 不变。

---

## 文件树

```text
packages/ingestion-inbox/
├── migrations/
│   └── <timestamp>_event-inbox-processing.ts   # Create：增量 Migration（lease_id + check 约束）
├── src/
│   ├── index.ts                                # Modify：新增处理侧导出
│   ├── processing-types.ts                     # Create：claim/renew/processed/retry/dead-letter 输入与结果类型
│   ├── processing-claim.ts                     # Create：claimAvailable（FOR UPDATE SKIP LOCKED）
│   ├── processing-write-back.ts                # Create：renewLease/markProcessed/scheduleRetry/markDeadLettered
│   └── processing-errors.ts                    # Create：lease_lost/not_found 稳定结果辅助
└── test/
    ├── processing-types.test.ts                # Create [ENV-INDEPENDENT]：类型/结果判别
    ├── processing-sql.test.ts                  # Create [ENV-INDEPENDENT]：SQL 构造纯逻辑（参数化、SKIP LOCKED）
    ├── package-entry.test.ts                   # Modify：新增处理侧出口断言 + 私有路径负例
    └── integration/
        ├── processing-migrations.test.ts       # Create [PG-GATED]：增量 Migration up/down/状态检测/列与约束
        ├── processing-claim.test.ts            # Create [PG-GATED]：原子领取、SKIP LOCKED、并发不重叠
        ├── processing-fencing.test.ts          # Create [PG-GATED]：lease_id fencing、旧 lease 写回拒绝
        └── processing-transitions.test.ts      # Create [PG-GATED]：renew/processed/retry/dead-letter 转换与回滚
```

每个文件单一职责；不创建 Worker 运行循环或业务处理器。

---

## Consumes / Produces 总览

- **Consumes**：`docs/architecture/ingestion-inbox-processing-repository.md`（approved 规格）、`@aurora/event-schema`（`EventEnvelope`、`IngestionErrorCode`）、`packages/ingestion-inbox` 现有 `errors.ts`/`state-queries.ts`、ADR-004/008/010 约束。
- **Produces**：`lease_id` 增量 Migration、`IngestionInboxProcessingRepository`（5 个方法）、稳定结果类型、真实 PostgreSQL 并发/租约/状态转换测试、包入口/边界、ADR-008 证据、更新后的 formalization-readiness。

---

## Task 1: 处理侧公共类型与稳定结果 [ENV-INDEPENDENT]

**目标：** 冻结 `IngestionInboxProcessingRepository` 接口、`ClaimAvailableInboxEventsInput/Result`、`RenewInboxLeaseInput`、`MarkInboxEventProcessedInput`、`ScheduleInboxEventRetryInput`、`MarkInboxEventDeadLetteredInput`、`InboxLeaseMutationResult` 及 `lease_lost`/`not_found` 稳定判别。

- Consumes: 规格 §8/§9/§10/§11/§12、现有 `types.ts`。
- Produces: `src/processing-types.ts`、`src/processing-errors.ts`。

- [ ] **Step 1: 失败测试**
  - `test/processing-types.test.ts`：
    - `ClaimAvailableInboxEventsInput` 有 `limit: number`、`leaseDurationMs: number`、`workerId: string`；
    - `ClaimedInboxEvent` 含 `id`、`projectId`、`eventId`、`event: EventEnvelope`、`attemptCount`、`leaseId`、`leaseExpiresAt`；
    - `InboxLeaseMutationResult` 判别 `success`/`lease_lost`/`not_found`；
    - `ClaimAvailableInboxEventsResult` 判别 `claimed`（数组）/`nothingToClaim`（空）。
  - 先不建类型，测试预期失败。

- [ ] **Step 2: 最小实现**
  - `processing-types.ts`：全部接口与判别联合。
  - `processing-errors.ts`：`leaseLostResult()`/`notFoundResult()`/`successResult()` 辅助。

- [ ] **Step 3: 确认通过**
  - `pnpm --filter @aurora/ingestion-inbox typecheck` exit 0；`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`；`pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `src/processing-types.ts`、`src/processing-errors.ts`、`test/processing-types.test.ts`。

---

## Task 2: lease_id 增量 Migration、约束与索引 [PG-GATED]

**目标：** 增量 Migration 添加 `lease_id`（UUID 可空）与 lease 字段一致性 check constraint；确认 claim/过期租约所需索引已覆盖。

- Consumes: 规格 §13、现有初始 Migration。
- Produces: `migrations/<timestamp>_event-inbox-processing.ts`。

- [ ] **Step 1: 失败测试**
  - `test/integration/processing-migrations.test.ts`（`describe.skipIf(!process.env.AURORA_TEST_DATABASE_URL)`）：
    - 空库执行全部 Migration → 版本状态检测；
    - 重复 `up` 幂等；
    - `down` 后重新 `up` 对称；
    - `event_inbox` 存在 `lease_id` 列；
    - check constraint 存在（`ck_event_inbox_lease_consistency` 或等价）；
    - 手工插入 `state='leased'` 但 `lease_id IS NULL` 被拒；`state='processed'` 但 `lease_id IS NOT NULL` 被拒。

- [ ] **Step 2: 最小实现 Migration**
  - 增量 Migration（不编辑初始 Migration）：
    ```ts
    export const up = (pgm) => {
      pgm.addColumn('event_inbox', { lease_id: { type: 'uuid' } });
      pgm.addConstraint('event_inbox', 'ck_event_inbox_lease_consistency', {
        check: `(state = 'leased') = (lease_id IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)`,
      });
    };
    export const down = (pgm) => {
      pgm.dropConstraint('event_inbox', 'ck_event_inbox_lease_consistency');
      pgm.dropColumn('event_inbox', 'lease_id');
    };
    ```
  - 说明：`(state='leased') = (lease_id IS NOT NULL AND ...)` 强制 leased 必须三字段齐全、非 leased 不得残留。

- [ ] **Step 3: 确认通过**
  - 真实 PG：up/down/up 对称、列与约束存在、约束负例被拒。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-inbox typecheck`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `migrations/<timestamp>_event-inbox-processing.ts`、`test/integration/processing-migrations.test.ts`。

---

## Task 3: 原子领取 claimAvailable（FOR UPDATE SKIP LOCKED）[PG-GATED]

**目标：** 实现 `claimAvailable`：候选选择 + `FOR UPDATE SKIP LOCKED` + 同一事务更新为 `leased` + 返回实际领取记录；`attempt_count` 递增。

- Consumes: 规格 §6/§7、`processing-types.ts`。
- Produces: `src/processing-claim.ts`。

- [ ] **Step 1: 失败测试**
  - `test/processing-sql.test.ts`（ENV-INDEPENDENT）：claim SQL 包含 `FOR UPDATE SKIP LOCKED`、`lease_id = gen_random_uuid()`、`now() + leaseDurationMs`、`attempt_count = attempt_count + 1`、`RETURNING` 字段；参数化（无字符串拼接不可信值）。
  - `test/integration/processing-claim.test.ts`（PG-GATED）：
    - `pending` 可领取；
    - 到期 `retry_waiting` 可领取；未到期不可领取；
    - 有效 `leased` 不可被其他 Worker 领取；过期 `leased` 可重领并生成新 `leaseId`；
    - 两个并发 Worker 领取相同候选集合结果互不重叠；
    - `attempt_count` 新领取递增；
    - 事务回滚不留下 `leased` 状态。

- [ ] **Step 2: 最小实现**
  - `processing-claim.ts`：`claimAvailable(pool, input): Promise<ClaimAvailableInboxEventsResult>`。校验 `limit`（`1..100`）、`leaseDurationMs`（`>0`）有界。SQL：
    ```sql
    WITH candidates AS (
      SELECT id FROM event_inbox
      WHERE state IN ('pending','retry_waiting') AND available_at <= now()
         OR (state = 'leased' AND lease_expires_at <= now())
      ORDER BY id
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE event_inbox ei
    SET state = 'leased',
        lease_id = gen_random_uuid(),
        lease_owner = $2,
        lease_expires_at = now() + ($3 * interval '1 millisecond'),
        attempt_count = attempt_count + 1
    FROM candidates c
    WHERE ei.id = c.id
    RETURNING ei.id, ei.project_id, ei.event_id, ei.envelope,
              ei.attempt_count, ei.lease_id, ei.lease_expires_at
    ```
  - 参数 `[limit, workerId, leaseDurationMs]`；映射返回行到 `ClaimedInboxEvent`（envelope 反序列化用现有 `jsonToEventEnvelope`）；空结果返回 `nothingToClaim`。

- [ ] **Step 3: 确认通过**
  - 单元 SQL 断言 + 真实 PG 并发测试通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-inbox typecheck`；`pnpm lint`；`pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `src/processing-claim.ts`、`test/processing-sql.test.ts`、`test/integration/processing-claim.test.ts`。

---

## Task 4: 续租 renewLease [PG-GATED]

**目标：** 仅当前有效 lease 可续租；新过期时间晚于数据库当前时间；不递增 attempt_count。

- Consumes: 规格 §9。
- Produces: `src/processing-write-back.ts`（renewLease 部分）。

- [ ] **Step 1: 失败测试**
  - `test/integration/processing-fencing.test.ts`（PG-GATED）：
    - 有效 lease 续租成功，`lease_expires_at` 延长；
    - 续租不递增 `attempt_count`；
    - 过期 lease 续租 → `lease_lost`；
    - 错误 `leaseId` 续租 → `lease_lost`；
    - `processed`/`dead_lettered`/`retry_waiting` 记录续租 → `lease_lost`。

- [ ] **Step 2: 最小实现**
  - `processing-write-back.ts`：`renewLease(pool, { id, leaseId, leaseDurationMs })`：
    ```sql
    UPDATE event_inbox
    SET lease_expires_at = now() + ($3 * interval '1 millisecond')
    WHERE id = $1 AND state = 'leased' AND lease_id = $2 AND lease_expires_at > now()
    RETURNING id
    ```
  - 行数 0 → `lease_lost`（与 `not_found` 通过先查存在性区分，或统一 `lease_lost` 并说明安全原因）。

- [ ] **Step 3: 确认通过**
  - fencing 测试通过。

- [ ] **Step 4: 相关回归**
  - typecheck/lint。

- [ ] **Step 5: 建议提交边界**
  - `src/processing-write-back.ts`、`test/integration/processing-fencing.test.ts`。

---

## Task 5: 完成处理 markProcessed [PG-GATED]

**目标：** 仅有效 lease 可标记完成；清空 lease 字段；设置 processed_at；重复旧 lease 返回 `lease_lost`。

- Consumes: 规格 §10。
- Produces: `src/processing-write-back.ts`（markProcessed 部分）。

- [ ] **Step 1: 失败测试**
  - `test/integration/processing-transitions.test.ts`（PG-GATED）：
    - 有效 lease `markProcessed` 成功，`state='processed'`、`processed_at` 设置、lease 字段清空；
    - 旧 lease 重复调用 → `lease_lost`；
    - `processed` 不可再领取；
    - EventEnvelope 保持不变。

- [ ] **Step 2: 最小实现**
  - `markProcessed(pool, { id, leaseId })`：
    ```sql
    UPDATE event_inbox
    SET state = 'processed',
        processed_at = now(),
        lease_owner = NULL, lease_id = NULL, lease_expires_at = NULL,
        last_error_code = NULL
    WHERE id = $1 AND state = 'leased' AND lease_id = $2 AND lease_expires_at > now()
    RETURNING id
    ```

- [ ] **Step 3: 确认通过**
  - transitions 测试通过。

- [ ] **Step 4: 相关回归**
  - typecheck/lint。

- [ ] **Step 5: 建议提交边界**
  - `processing-write-back.ts`、`test/integration/processing-transitions.test.ts`。

---

## Task 6: 安排重试 scheduleRetry [PG-GATED]

**目标：** 仅有效 lease 可安排重试；调用方提供 `availableAt`；清空 lease 字段；保留 attempt_count；允许稳定脱敏 `last_error_code`。

- Consumes: 规格 §11、`@aurora/event-schema`（`IngestionErrorCode`）。
- Produces: `src/processing-write-back.ts`（scheduleRetry 部分）。

- [ ] **Step 1: 失败测试**
  - `test/integration/processing-transitions.test.ts`（扩展）：
    - 有效 lease `scheduleRetry` 成功，`state='retry_waiting'`、`available_at` 设为传入值、lease 字段清空、attempt_count 保留；
    - `availableAt` 未来时未到期不可领取；
    - 可选 `last_error_code` 写入稳定脱敏码；
    - 旧 lease 调用 → `lease_lost`。

- [ ] **Step 2: 最小实现**
  - `scheduleRetry(pool, { id, leaseId, availableAt, errorCode? })`：
    ```sql
    UPDATE event_inbox
    SET state = 'retry_waiting',
        available_at = $3,
        lease_owner = NULL, lease_id = NULL, lease_expires_at = NULL,
        last_error_code = $4
    WHERE id = $1 AND state = 'leased' AND lease_id = $2 AND lease_expires_at > now()
    RETURNING id
    ```
  - `availableAt` 为 ISO 字符串（数据库时间），校验晚于 now（由调用方保证 + Repository 只校验有界）。

- [ ] **Step 3: 确认通过**
  - transitions 测试通过。

- [ ] **Step 4: 相关回归**
  - typecheck/lint。

- [ ] **Step 5: 建议提交边界**
  - `processing-write-back.ts`、transitions 测试扩展。

---

## Task 7: 标记死信 markDeadLettered [PG-GATED]

**目标：** 仅有效 lease 可标记死信；设置 dead_lettered_at；清空 lease 字段；保留 attempt_count；只允许稳定脱敏错误码。

- Consumes: 规格 §12。
- Produces: `src/processing-write-back.ts`（markDeadLettered 部分）。

- [ ] **Step 1: 失败测试**
  - transitions 测试扩展：
    - 有效 lease `markDeadLettered` 成功，`state='dead_lettered'`、`dead_lettered_at` 设置、lease 字段清空；
    - `dead_lettered` 不可再领取；
    - 旧 lease 调用 → `lease_lost`。

- [ ] **Step 2: 最小实现**
  - `markDeadLettered(pool, { id, leaseId, errorCode? })`：
    ```sql
    UPDATE event_inbox
    SET state = 'dead_lettered',
        dead_lettered_at = now(),
        lease_owner = NULL, lease_id = NULL, lease_expires_at = NULL,
        last_error_code = $3
    WHERE id = $1 AND state = 'leased' AND lease_id = $2 AND lease_expires_at > now()
    RETURNING id
    ```

- [ ] **Step 3: 确认通过**
  - transitions 测试通过。

- [ ] **Step 4: 相关回归**
  - typecheck/lint。

- [ ] **Step 5: 建议提交边界**
  - `processing-write-back.ts`、transitions 测试扩展。

---

## Task 8: 包出口、Workspace Policy 与安全负例 [ENV-INDEPENDENT]

**目标：** `index.ts` 导出 `IngestionInboxProcessingRepository` 接口与全部处理侧类型/函数；私有路径负例；敏感字段/SQL 日志扫描。

- Consumes: 规格 §15。
- Produces: `src/index.ts` 扩展、`test/package-entry.test.ts` 扩展、`test/security-negative.test.ts` 扩展。

- [ ] **Step 1: 失败测试**
  - `package-entry.test.ts`：断言包根导出处理侧类型与函数；`processing-claim`/`processing-write-back` 等私有路径不可导入。
  - `security-negative.test.ts`：处理侧 src 不含 `console.log`/SQLSTATE/`lease_id` 日志/EventEnvelope 日志。

- [ ] **Step 2: 最小实现**
  - `index.ts` 导出处理侧公共 API；完善负例测试。

- [ ] **Step 3: 确认通过**
  - `pnpm check:boundaries` exit 0；`pnpm lint` exit 0；负例测试通过。

- [ ] **Step 4: 相关回归**
  - 全包 typecheck。

- [ ] **Step 5: 建议提交边界**
  - `src/index.ts`、`test/package-entry.test.ts`、`test/security-negative.test.ts`。

---

## Task 9: 文档、ADR 证据与根级门禁 [ENV-INDEPENDENT / 结果门控]

**目标：** README 更新、formalization-readiness、ADR-008 证据；根级完整质量门禁。

- Consumes: 全部 Task 产物、规格、ADR-008。
- Produces: `packages/ingestion-inbox/README.md` 更新、`docs/architecture/formalization-readiness.md` 更新、ADR-008 追加记录。

- [ ] **Step 1: 失败测试（文档契约先行）**
  - `test/documentation-contract.test.ts`：README 含处理侧职责/非职责/`AURORA_TEST_DATABASE_URL`；不宣称 Worker 已实现。

- [ ] **Step 2: 最小实现文档**
  - 更新 `packages/ingestion-inbox/README.md`（处理侧能力）；
  - 更新 `formalization-readiness.md`（Worker 波次：processing repository implemented / worker runtime not-started / policy blocked）；
  - 真实实现并验证后，ADR-008 追加处理侧 Repository 证据。

- [ ] **Step 3: 确认通过**
  - 文档契约测试通过；`pnpm format:check`、`git diff --check`。

- [ ] **Step 4: 相关回归**
  - 全仓 `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:coverage`、`pnpm check:boundaries`、`pnpm build`、`pnpm check:ci`、`git diff --check`（真实 PG 可用时再加 `test:integration`）。

- [ ] **Step 5: 建议提交边界**
  - README、formalization-readiness、ADR-008 追加记录（若真实实现）。

---

## 完成报告要求

实施完成并全部门禁通过后，报告必须包含：完成的 Task（ENV-INDEPENDENT vs PG-GATED 区分）；创建和修改的文件；增量 Migration 与新增 `lease_id` 字段；状态转换集合；数据库时间选择（PostgreSQL `now()`）；claim SQL 与 `FOR UPDATE SKIP LOCKED`；lease fencing（`lease_id` + 条件匹配）；`IngestionInboxProcessingRepository` 公共 API；并发/过期/旧 lease 测试；事务回滚；覆盖率与全仓门禁退出码；实际依赖版本；与计划的偏差；ADR 状态（ADR-008 in-progress、ADR-010 implemented、ADR-011 in-progress）；Git 状态；剩余模块统计；建议提交边界；并明确说明：未实现 Worker 应用、业务处理器、重试策略、人工重放、凭证模块、CI/RDS/IaC，未规划或实施下一模块，未提交或推送。
