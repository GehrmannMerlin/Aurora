# SEC-02 Retention / Cross-Store Deletion Propagation Implementation Plan

> **For agentic workers:** This plan is executed INLINE by the main session (user override: no subagents, no executing-plans skill). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立消费 `account_cleanup_handoffs`（SEC-01 意图）的跨存储删除传播——清理状态机、跨存储 adapter（PostgreSQL 真实、Redis/对象/备份契约）、orchestrator worker、审计记录、部分失败重试、幂等完成、备份淘汰与恢复后删除重放契约。

**Architecture:** 在 `apps/platform-worker`（service 层，已依赖 platform-identity + pg）新增 `src/retention/`：纯状态机（`cleanup-state-machine.ts`）、adapter 端口 + 契约实现（`cleanup-adapters.ts`、`redis-session-cleanup-adapter.ts`、`object-storage-cleanup-adapter.ts`、`backup-lifecycle-cleanup-adapter.ts`）、真实 PostgreSQL 清理（`postgres-cleanup-adapter.ts`）与审计（`audit-cleanup-adapter.ts`）、orchestrator（`cleanup-orchestrator.ts`）作为第二个轮询循环；在 `packages/platform-identity/migrations/` 增加 `account_cleanup_steps` 表（每存储步骤状态，支持部分失败重试 + 幂等完成）。

**Tech Stack:** TypeScript（严格模式、NodeNext ESM）、pg、node-pg-migrate（SQL-first，ADR-029）、vitest。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --------- | ------------ | -------- | ------------------------ | -------- |
| SEC-02 | `BASE-PRD`（核心 PRD §14/§16—17）、`BASE-ARCH`（架构规范）、`BASE-IMPL`（代码/测试/ADR/文档规范）、`SEC-A5`（[account-deletion-and-data-lifecycle](../security/account-deletion-and-data-lifecycle.md) §6—11）、`OPS-DELIVERY`（[backup-and-recovery](../operations/backup-and-recovery.md) §5、[release-migration-and-rollback](../releases/release-migration-and-rollback.md)）、`FORM`（[formalization-readiness](../architecture/formalization-readiness.md)、[ADR 索引](../adr/README.md)）、ADR-029/032 | A5 §6—10；backup-and-recovery §5 | 不可逆清理不能部分成功后冒充完成；清理可安全重试/续跑、失败不回滚为可登录账号；共享不可变备份不逐记录破坏、35 天自然淘汰；恢复不复活账号/权限/Session/直接身份；审计一年最小匿名摘要；同邮箱新账号不继承旧关系 | 生产 Redis/BullMQ 与对象存储由 ADR-032 defer → adapter 为契约实现；业务事实行为人匿名化依赖身份映射（deferred）；OPS-07 未合入 main → `OPS07_DELETE_REPLAY_INTEGRATION_PENDING` |

## Global Constraints

- **不伪造完成**：全部必需存储步骤 `succeeded` 后才允许 handoff 转 `succeeded`（A5 §8）；跨系统确认完成前只显示"清理中"。
- 清理可安全重试/续跑；已成功步骤幂等跳过；失败不把账号回滚为可登录。
- 共享不可变备份不逐记录破坏；含注销前账号数据的备份最长 35 天自然淘汰。
- 恢复后服务开放前重放删除事实（账号不能登录、Session 无效、直接身份重新删除/匿名化、已撤销凭证不复活）。
- 安全审计保留一年最小匿名摘要；不可逆阶段移除姓名/邮箱等直接身份。
- 同邮箱新账号全新身份，不恢复旧关系/权限/Session；不保存原始邮箱墓碑。
- 测试预算（用户限定）：deletion state-machine unit tests、1 条 focused PostgreSQL integration、Redis/BullMQ cleanup contract test、Object Storage adapter contract test、backup/delete-replay contract test、affected typecheck、`git diff --check`。**禁止**完整 PostgreSQL suite、root test/coverage、浏览器、完整 DR drill。
- 不越界 DAT-18/19/21；不实现 G12 UI、邮件/通知发送、收费/额度。

---

## File Structure

```
packages/platform-identity/
  migrations/1786245000000_account-cleanup-steps.ts   # Create: account_cleanup_steps 表
apps/platform-worker/
  src/retention/
    cleanup-state-machine.ts        # 纯状态机：步骤顺序/单步结果/handoff 结果/幂等
    cleanup-adapters.ts             # CleanupAdapter 端口 + CleanupInput/CleanupResult 类型
    redis-session-cleanup-adapter.ts    # 契约（Session Redis ADR-032 defer）
    object-storage-cleanup-adapter.ts   # 契约（对象存储 ADR-032 defer）
    backup-lifecycle-cleanup-adapter.ts # 契约（35 天自然淘汰策略）
    delete-replay.ts                # 纯契约：恢复后删除重放前置事实（对齐 OPS-07）
    postgres-cleanup-adapter.ts     # 真实：账号直接身份/成员关系清理 SQL
    audit-cleanup-adapter.ts        # 真实：清理完成/失败安全审计
    cleanup-orchestrator.ts         # 轮询 handoffs → 执行 adapters → 持久化步骤 → 迁移 handoff → 审计
  src/worker.ts                     # Modify: 增加 cleanup 轮询循环（与 Outbox 并存）
  src/config.ts                     # Modify: cleanup 配置（maxAttempts、pollIntervalMs）
  test/retention/
    cleanup-state-machine.test.ts
    cleanup-adapters.test.ts        # 契约 adapter 测试（redis/object/backup）
    delete-replay.test.ts
    postgres-cleanup-adapter.test.ts  # unit（mock 不跑真实 PG）
    integration/cleanup-orchestrator.test.ts  # 1 条 focused PostgreSQL integration
docs/architecture/retention-cross-store-deletion-propagation.md  # Create: SEC-02 正式规格
```

接口契约（跨任务复用）：

- `cleanup-state-machine.ts` 导出 `type CleanupStoreId = 'postgres'|'redis-sessions'|'object-storage'|'audit'|'backup-lifecycle'`、`interface CleanupStep { store: CleanupStoreId; status: 'pending'|'succeeded'|'failed'; errorCode?: string; attemptCount: number }`、`function decideCleanupStores(requiredLifecycle: unknown): readonly CleanupStoreId[]`（固定顺序 postgres→redis-sessions→object-storage→audit→backup-lifecycle）、`function decideStepAfterAttempt(step: CleanupStep, ok: boolean, errorCode: string | undefined): CleanupStep`、`function decideHandoffOutcome(steps: readonly CleanupStep[], attemptCount: number, maxAttempts: number): 'succeeded'|'retry'|'dead_lettered'`、`function isStepEligibleForRun(step: CleanupStep): boolean`。
- `cleanup-adapters.ts` 导出 `interface CleanupInput { accountId: string; accountEmail: string; requiredLifecycle: unknown }`、`type CleanupResult = { readonly ok: true } | { readonly ok: false; readonly errorCode: string }`、`interface CleanupAdapter { readonly store: CleanupStoreId; cleanup(input: CleanupInput): Promise<CleanupResult> }`。
- `delete-replay.ts` 导出 `type DeleteReplayFact = 'account-deletion'|'session-revocation'|'org-relation'|'direct-identity'|'same-email'|'credential-revocation'`、`function validateDeleteReplayFacts(facts: readonly DeleteReplayFact[]): readonly string[]`（空 = 通过；缺失前置事实返回违规）。
- `postgres-cleanup-adapter.ts` 导出 `class PostgresCleanupAdapter implements CleanupAdapter`（构造 `(pool: Pool)`）。
- `cleanup-orchestrator.ts` 导出 `interface CleanupOrchestratorOptions { pool; adapters: readonly CleanupAdapter[]; maxAttempts: number; now: () => Date }`、`function runCleanupRound(options): Promise<CleanupRoundResult>`。

---

### Task 1: 删除状态机 + adapter 端口 + 契约 adapter

**Files:**
- Create: `apps/platform-worker/src/retention/cleanup-state-machine.ts`, `apps/platform-worker/src/retention/cleanup-adapters.ts`, `apps/platform-worker/src/retention/redis-session-cleanup-adapter.ts`, `apps/platform-worker/src/retention/object-storage-cleanup-adapter.ts`, `apps/platform-worker/src/retention/backup-lifecycle-cleanup-adapter.ts`, `apps/platform-worker/test/retention/cleanup-state-machine.test.ts`, `apps/platform-worker/test/retention/cleanup-adapters.test.ts`

**Interfaces:**
- Produces: `CleanupStoreId`、`CleanupStep`、`decideCleanupStores`、`decideStepAfterAttempt`、`decideHandoffOutcome`、`isStepEligibleForRun`；`CleanupInput`、`CleanupResult`、`CleanupAdapter`。

- [ ] **Step 1: 写失败测试** `cleanup-state-machine.test.ts`（纯函数覆盖：固定存储顺序、单步失败→failed+errorCode、全部成功→succeeded、部分失败→retry、超限→dead_lettered、succeeded 步骤不重跑）与 `cleanup-adapters.test.ts`（redis/object/backup 契约 adapter 返回 ok、store 标识正确、backup 策略 35 天/不逐记录破坏）。

- [ ] **Step 2: 运行确认失败**：`pnpm --filter @aurora/platform-worker test` → 失败（模块不存在）。

- [ ] **Step 3: 实现**。`cleanup-state-machine.ts`：

```ts
export type CleanupStoreId =
  | 'postgres' | 'redis-sessions' | 'object-storage' | 'audit' | 'backup-lifecycle';

export interface CleanupStep {
  readonly store: CleanupStoreId;
  readonly status: 'pending' | 'succeeded' | 'failed';
  readonly errorCode?: string;
  readonly attemptCount: number;
}

const CLEANUP_STORE_ORDER: readonly CleanupStoreId[] = [
  'postgres', 'redis-sessions', 'object-storage', 'audit', 'backup-lifecycle',
];

export function decideCleanupStores(_requiredLifecycle: unknown): readonly CleanupStoreId[] {
  return Object.freeze([...CLEANUP_STORE_ORDER]);
}

export function decideStepAfterAttempt(
  step: CleanupStep,
  ok: boolean,
  errorCode: string | undefined,
): CleanupStep {
  if (ok) {
    return Object.freeze({ store: step.store, status: 'succeeded', attemptCount: step.attemptCount + 1 });
  }
  return Object.freeze({
    store: step.store,
    status: 'failed',
    ...(errorCode === undefined ? {} : { errorCode }),
    attemptCount: step.attemptCount + 1,
  });
}

export function isStepEligibleForRun(step: CleanupStep): boolean {
  return step.status !== 'succeeded';
}

export function decideHandoffOutcome(
  steps: readonly CleanupStep[],
  attemptCount: number,
  maxAttempts: number,
): 'succeeded' | 'retry' | 'dead_lettered' {
  const allSucceeded = steps.length > 0 && steps.every((step) => step.status === 'succeeded');
  if (allSucceeded) return 'succeeded';
  if (attemptCount >= maxAttempts) return 'dead_lettered';
  return 'retry';
}
```

`cleanup-adapters.ts`（端口 + 类型）、三个契约 adapter（`cleanup()` 返回 `{ ok: true }`，store 标识固定，backup adapter 额外导出 `BACKUP_EXPIRY_DAYS = 35` 与 `assertNoRecordLevelDestruction(lifecycle)`）。

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/platform-worker test` 全绿；typecheck 通过。

- [ ] **Step 5: Commit**：`feat(retention): SEC-02 deletion state machine + cleanup adapter contracts`.

---

### Task 2: PostgreSQL 清理 adapter + 审计 adapter（真实）

**Files:**
- Create: `apps/platform-worker/src/retention/postgres-cleanup-adapter.ts`, `apps/platform-worker/src/retention/audit-cleanup-adapter.ts`, `apps/platform-worker/test/retention/postgres-cleanup-adapter.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CleanupAdapter`/`CleanupInput`/`CleanupResult`。
- Produces: `PostgresCleanupAdapter`（`store: 'postgres'`）、`AuditCleanupAdapter`（`store: 'audit'`）。

- [ ] **Step 1: 写失败测试**（unit，mock pool）：`postgres-cleanup-adapter.test.ts` 断言 cleanup() 按序执行 SQL（直接身份删除、成员关系删除、pending 邀请撤销、审计匿名化、accounts 匿名终端态）且在任一步失败返回 `{ ok: false, errorCode }`；`audit-cleanup-adapter.test.ts` 断言写入 `security_audit_events`（action 含 `cleanup_completed`/`cleanup_failed`、不写密码/令牌）。

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3: 实现** `postgres-cleanup-adapter.ts`（真实 SQL，单事务）：

```ts
import type { Pool } from 'pg';
import type { CleanupAdapter, CleanupInput, CleanupResult } from './cleanup-adapters.js';

export class PostgresCleanupAdapter implements CleanupAdapter {
  readonly store = 'postgres' as const;
  constructor(private readonly pool: Pool) {}

  async cleanup(input: CleanupInput): Promise<CleanupResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // direct identity: credentials + intents (delete)
      await client.query('DELETE FROM account_credentials WHERE account_id = $1', [input.accountId]);
      await client.query('DELETE FROM email_verification_intents WHERE account_id = $1', [input.accountId]);
      await client.query('DELETE FROM password_reset_intents WHERE account_id = $1', [input.accountId]);
      await client.query('DELETE FROM account_deletion_intents WHERE account_id = $1', [input.accountId]);
      // memberships (delete)
      await client.query('DELETE FROM organization_members WHERE account_id = $1', [input.accountId]);
      await client.query('DELETE FROM project_members WHERE account_id = $1', [input.accountId]);
      // pending invitations for the account email (revoke)
      await client.query(
        `UPDATE organization_invitations SET status = 'revoked' WHERE status = 'pending' AND invited_email = $1`,
        [input.accountEmail],
      );
      // audit: anonymize actor/target references (FK-free table; 1-year retention is a policy, not a row)
      await client.query(
        `UPDATE security_audit_events SET actor_account_id = NULL, target_account_id = NULL
         WHERE actor_account_id = $1 OR target_account_id = $1`,
        [input.accountId],
      );
      // account: anonymous terminal shell (email freed, no original-email tombstone per A5 §10)
      await client.query(
        `UPDATE accounts
         SET email = 'deleted:' || account_id::text,
             email_normalized = 'deleted:' || account_id::text,
             verified_at = NULL,
             status = 'terminated'
         WHERE account_id = $1`,
        [input.accountId],
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = error instanceof Error ? error.message : String(error);
      return { ok: false, errorCode: `postgres_cleanup_failed:${code}` };
    } finally {
      client.release();
    }
  }
}
```

`audit-cleanup-adapter.ts`：`cleanup()` 写入一条 `security_audit_events`（`action: 'cleanup_completed'`，details 含 accountId 匿名摘要与生命周期，不含直接身份），返回 `{ ok: true }`。

- [ ] **Step 4: 运行确认通过**：unit 测试全绿；typecheck 通过。

- [ ] **Step 5: Commit**：`feat(retention): SEC-02 real postgres + audit cleanup adapters`.

---

### Task 3: account_cleanup_steps Migration + orchestrator + worker 接线 + focused integration

**Files:**
- Create: `packages/platform-identity/migrations/1786245000000_account-cleanup-steps.ts`
- Create: `apps/platform-worker/src/retention/cleanup-orchestrator.ts`, `apps/platform-worker/test/retention/integration/cleanup-orchestrator.test.ts`
- Modify: `apps/platform-worker/src/worker.ts`, `apps/platform-worker/src/config.ts`, `apps/platform-worker/src/start.ts`

**Interfaces:**
- Consumes: Task 1/2 的 `decideCleanupStores`/`decideStepAfterAttempt`/`decideHandoffOutcome`/`isStepEligibleForRun`、`CleanupAdapter`。
- Produces: `CleanupOrchestratorOptions`、`runCleanupRound(options)`。

- [ ] **Step 1: 写失败测试**（unit，mock pool + fake adapters）：`cleanup-orchestrator` 对 pending handoff 执行步骤、部分失败转 retry、全部成功转 succeeded、succeeded 步骤幂等跳过、超限 dead_lettered、审计写入。`integration/cleanup-orchestrator.test.ts`（1 条 focused PostgreSQL）：本地 `AURORA_TEST_DATABASE_URL` 建真实表 → 插入一个 pending handoff + 关联账号数据 → `runCleanupRound` → 断言账号数据已删除/匿名化、handoff succeeded。

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3a: Migration** `1786245000000_account-cleanup-steps.ts`：

```ts
import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('account_cleanup_steps', {
    handoff_id: { type: 'uuid', notNull: true, references: 'account_cleanup_handoffs' },
    store: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    error_code: { type: 'text' },
    attempt_count: { type: 'integer', notNull: true, default: 0 },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { constraints: { primaryKey: ['handoff_id', 'store'] } });
  pgm.addConstraint('account_cleanup_steps', 'ck_account_cleanup_steps_status', {
    check: "status IN ('pending','succeeded','failed')",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('account_cleanup_steps');
};
```

- [ ] **Step 3b: orchestrator** `cleanup-orchestrator.ts`：`runCleanupRound` 在单事务内（`SELECT ... FOR UPDATE` 锁 pending handoff）→ 读取/初始化 `account_cleanup_steps` → 对每个 eligible 步骤调用对应 adapter → `decideStepAfterAttempt` 持久化 → 全部成功则 handoff `succeeded` + 审计 + 删除 handoff/steps；部分失败且未超限则 handoff `in_progress`（续跑）；超限则 `dead_lettered` + 审计 `cleanup_failed`。返回 `CleanupRoundResult { claimed: number; succeeded: number; retried: number; deadLettered: number }`。

- [ ] **Step 3c: worker 接线**：`config.ts` 增加 `cleanup: { enabled: boolean; maxAttempts: number; pollIntervalMs: number }`；`worker.ts`/`start.ts` 增加第二个轮询循环（复用 timers/poll 模式），每 `pollIntervalMs` 调 `runCleanupRound`。

- [ ] **Step 4: 运行确认**：unit 全绿；**1 条 focused PostgreSQL integration** 通过（本地 `aurora-test-pg`）；typecheck 通过；`git diff --check` 干净。

- [ ] **Step 5: Commit**：`feat(retention): SEC-02 cleanup orchestrator + steps migration + worker wiring`.

---

### Task 4: Backup-expiry / delete-replay 契约 + 规格 + 定向验证

**Files:**
- Create: `apps/platform-worker/src/retention/delete-replay.ts`, `apps/platform-worker/test/retention/delete-replay.test.ts`
- Create: `docs/architecture/retention-cross-store-deletion-propagation.md`（已存在，补齐证据状态）

**Interfaces:**
- Consumes: Task 1 的 backup 契约。
- Produces: `DeleteReplayFact`、`validateDeleteReplayFacts`。

- [ ] **Step 1: 写失败测试** `delete-replay.test.ts`：前置事实齐全（account-deletion/session-revocation/org-relation/direct-identity/same-email/credential-revocation）→ 无违规；缺失任一 → 对应违规；已撤销凭证不得复活 → `credential-revocation-must-replay`。

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3: 实现 `delete-replay.ts`**：`validateDeleteReplayFacts(facts)` 校验六个前置删除事实都在 `facts` 中（缺失返回 `${fact}-must-replay`），对齐 OPS-07 `validateDeletionReplay` 语义。

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/platform-worker test` 全绿；typecheck 通过。

- [ ] **Step 5: 定向验证（用户限定）**：state-machine/adapters/delete-replay unit tests、1 条 focused PostgreSQL integration、affected typecheck、`git diff --check`、secret-negative（`grep -rnE 'AKIA|BEGIN .*PRIVATE KEY|aurora_ingest_|SecretAccessKey' apps/platform-worker/src/retention packages/platform-identity/migrations docs/architecture/retention-cross-store-deletion-propagation.md` → 0）。**禁止**完整 PostgreSQL suite、root test/coverage、浏览器。`docs/architecture/retention-cross-store-deletion-propagation.md` 标记 `implementation-status: implemented-in-feature-branch` 与 `OPS07_DELETE_REPLAY_INTEGRATION_PENDING`。

- [ ] **Step 6: Commit**：`feat(retention): SEC-02 backup-expiry + delete-replay contract + spec`.

---

## Self-Review

**Spec coverage（SEC-02）**：durable deletion intent = SEC-01 `account_cleanup_handoffs`（复用）+ Task 3 orchestrator；cross-store cleanup = Task 1/2/3（postgres 真实 + redis/object/audit/backup 契约）；partial failure retry = Task 1 `decideStepAfterAttempt`/`decideHandoffOutcome` + Task 3 steps 表；idempotent completion = Task 1 `isStepEligibleForRun`（succeeded 跳过）+ Task 3；backup expiry = Task 1/4（35 天 + 不逐记录破坏）；restore 后 delete replay = Task 4 `validateDeleteReplayFacts`（对齐 OPS-07）。**不伪造 completed**：全部步骤 succeeded 才转 succeeded；失败不把账号回滚为可登录（accounts 保持 terminated）。

**Placeholder scan**：无 "TBD/TODO"。占位仅为账号邮箱（orchestrator 从 accounts 查询传入，真实输入）。

**Type consistency**：`CleanupStoreId`/`CleanupStep`/`decideCleanupStores`/`decideStepAfterAttempt`/`decideHandoffOutcome`/`isStepEligibleForRun`、`CleanupInput`/`CleanupResult`/`CleanupAdapter`、`DeleteReplayFact`/`validateDeleteReplayFacts`、`CleanupOrchestratorOptions`/`runCleanupRound` 在 Task 1—4 间一致。

**本计划不实现 DAT-18/19/21、不实现 G12 UI、不创建生产 Redis/对象存储资源、不伪造清理完成、不越界其他分组。**
