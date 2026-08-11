# OPS-07 Backup / Restore / DR / Delete-Replay Validation Implementation Plan

> **For agentic workers:** This plan is executed INLINE by the main session (user override: no subagents, no executing-plans skill). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Aurora 备份/恢复/灾备/删除重放验证能力——备份策略契约、恢复编排模型、删除重放契约、备份淘汰校验、DR Runbook 与证据模板，全部可本地验证（契约单测 + `cdk synth` + 1 条 focused 本地 PG restore 集成），不创建真实 AWS 资源、不触碰阿里云 Preview；SEC-02 缺失时记录 `OPS07_PREREQUISITE_DEBT`，delete-replay acceptance = `prerequisite-pending`。

**Architecture:** 在 `tooling/aws-infra` 新增 `src/backup/` 纯契约模块（`backup-policy.ts` 备份策略/保留/RPO-RTO、`restore-order.ts` 恢复顺序编排、`deletion-replay.ts` 删除重放契约与校验）与 `src/stacks/backup-stack.ts`（备份 KMS key + 策略标签，RDS 自动备份已在 DataStack：35 天 + PITR）。恢复顺序严格遵循 [backup-and-recovery](../operations/backup-and-recovery.md) §6；删除重放遵循 §5 与 A5 规则；SEC-02（跨存储删除传播）为 G04 not-started → 诚实记录前置债务，不伪造删除重放已验证。

**Tech Stack:** TypeScript（严格模式、NodeNext ESM）、aws-cdk-lib（`kms`/`rds`/`iam`）、vitest、docker（本地 disposable PG harness 的 1 条 focused restore 集成）。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --------- | ------------ | -------- | ------------------------ | -------- |
| OPS-07 | `BASE-PRD`（核心业务 PRD §14/§16—18）、`BASE-ARCH`（架构规范）、`BASE-IMPL`（代码/测试/ADR/文档规范）、`SEC-A5`（[account-deletion-and-data-lifecycle](../security/account-deletion-and-data-lifecycle.md) §6—11、[A5 设计](../superpowers/specs/2026-07-29-aurora-account-deletion-data-lifecycle-design.md) §8—9）、`OPS-QUALITY`（[test-strategy](../testing/test-strategy.md)、[测试/部署/发布设计](../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md) §10—11）、`OPS-DELIVERY`（[backup-and-recovery](../operations/backup-and-recovery.md) 全文、[release-migration-and-rollback](../releases/release-migration-and-rollback.md) §2—4、[deployment](../architecture/deployment.md)）、`FORM`（[formalization-readiness](../architecture/formalization-readiness.md)、[ADR 索引](../adr/README.md)） | backup-and-recovery 全文；测试/部署设计 §10—11；A5 规则 §6—11 | 生产 RDS 自动备份 35 天 + PITR、删除保护；恢复顺序：基础设施与密钥 → PostgreSQL/Migration → Session/任务安全状态 → 私密对象 → Outbox/任务续跑 → 删除/撤销事实重放 → 关键 Query/Command → 只读验证 → 受控开放流量；恢复不得复活已删除数据/已撤销凭证/已失效 Session；备份最长 35 天自然淘汰，不得逐记录破坏共享不可变备份；审计按一年最小匿名摘要独立保留 | SEC-02（跨存储删除传播）未实现 → delete-replay acceptance = prerequisite-pending；跨区域/备份账号副本需用户提供备份账号/区域 → cross-region copy requires-backup-account；真实 RPO/RTO 测量需 staging/release 环境 → RPO_RTO_EVIDENCE_PENDING |

## Global Constraints

- 目标（approved，`requires-benchmark`）：PostgreSQL 单区域多 AZ `RPO ≤ 5 分钟`、`RTO ≤ 60 分钟`；区域级 `RPO ≤ 24 小时`、`RTO ≤ 8 小时`（test-strategy §6；测试/部署设计 §11.1）。
- RDS 生产自动备份 35 天 + PITR + 删除保护（已在 DataStack，OPS-04）；每日加密恢复点副本到隔离备份账号/第二区域（`requires-backup-account`，用户提供拓扑后落位）。
- 恢复顺序固定为 backup-and-recovery §6；**任何恢复不得使已撤销 Session 重新有效、不得复活已删除数据、不得恢复已撤销凭证**（backup-and-recovery §3/§5；ADR-013/014 revoked 为永久终态）。
- 含注销前直接身份数据的备份最长 35 天自然淘汰；不逐记录破坏共享不可变备份；备份不能成为用户撤销注销或读取已删除数据的路径（backup-and-recovery §5；A5 规则）。
- 安全审计按一年最小匿名摘要独立保留，不能通过恢复普通业务数据绕过期限（A5 规则）。
- **不创建真实 AWS 资源**：只写 IaC + 契约 + 测试；`cdk deploy` 需凭据（`PROVISIONING_EVIDENCE_PENDING`）。跨区域副本/备份账号资源不自动创建。
- **不触碰** 阿里云 Preview；本地 disposable PG harness（`aurora-test-pg`，docker）只用于 **1 条 focused restore 集成**。
- 测试预算（用户限定）：backup/restore tooling targeted tests、IaC synth/static、restore ordering tests、deletion-replay contract tests、受影响 typecheck、`git diff --check`。**禁止**完整 PostgreSQL integration suite、root coverage、浏览器、完整 benchmark。
- **唯一不可假通过处**：delete-replay 验收。SEC-02 缺失时只允许 `OPS-07 implementation = completed-to-available-boundary`、`delete-replay acceptance = prerequisite-pending`，**不得**写 OPS-07 completed、**不得**临时伪造 SEC-02 / 假 deletion API / 用 mock 代替跨存储删除真实性。不影响 OPS-05/06 completed。
- 不越界 OPS-05/06；不实现 G08/G04。

---

## File Structure

```
tooling/aws-infra/
  src/backup/
    backup-policy.ts         # BackupPolicy + AURORA_BACKUP_POLICY + validateBackupPolicy（纯函数）
    restore-order.ts         # RestoreStep/RestorePlan + planRestoreOrder + assertRestoreSafety（纯函数）
    deletion-replay.ts       # DeletionReplayFact + validateDeletionReplay + PREREQUISITE marker（纯函数）
    index.ts
  src/stacks/backup-stack.ts # KMS 备份 key + 备份策略标签 + 无破坏性资源断言
  src/app.ts                 # Modify: 接线 BackupStack
  test/backup/
    backup-policy.test.ts
    restore-order.test.ts
    deletion-replay.test.ts
    backup-stack.test.ts
deploy/aws/
  restore-smoke.sh           # 1 条 focused 本地 PG restore 集成（docker disposable harness）
docs/operations/
  runbooks/backup-restore-dr.md        # DR/恢复/备份淘汰/删除重放 Runbook + 演练证据模板
docs/architecture/
  backup-restore-dr-delete-replay.md   # OPS-07 正式规格
```

接口契约（跨任务复用）：

- `src/backup/backup-policy.ts` 导出 `interface BackupPolicy { retentionDays: number; pitr: boolean; crossRegionCopy: { enabled: boolean; cadence: 'daily'; targetRegion: string | undefined; encryptionKmsKeyRef: string | undefined }; targets: { singleRegionRpoSeconds: number; singleRegionRtoSeconds: number; regionalRpoSeconds: number; regionalRtoSeconds: number }; note: string }`、`AURORA_BACKUP_POLICY: BackupPolicy`（35 天、PITR、daily 跨区域、RPO 300s/RTO 3600s、区域 RPO 86400s/RTO 28800s，`requires-benchmark`）、`function validateBackupPolicy(policy: BackupPolicy): readonly string[]`。
- `src/backup/restore-order.ts` 导出 `type RestoreStep = { phase: 'infra-keys' } | { phase: 'postgres-migrations' } | { phase: 'session-task-state' } | { phase: 'private-objects' } | { phase: 'outbox-resume' } | { phase: 'deletion-replay' } | { phase: 'query-command-verify' } | { phase: 'readonly-verify' } | { phase: 'controlled-traffic' }`、`interface RestorePlan { steps: readonly RestoreStep[]; note: string }`、`function planRestoreOrder(): RestorePlan`（固定顺序 backup-and-recovery §6）、`function assertRestoreSafety(plan: RestorePlan): readonly string[]`（恢复不得复活已删除/已撤销/已失效）。
- `src/backup/deletion-replay.ts` 导出 `type DeletionFactKind = 'account-deletion' | 'session-revocation' | 'org-relation' | 'direct-identity' | 'same-email' | 'credential-revocation' | 'backup-expiry'`、`interface DeletionReplayFact { kind; replayBeforeOpen: boolean }`、`interface DeletionReplayValidation { violations: readonly string[]; prerequisiteDebt: readonly string[] }`、`function validateDeletionReplay(facts, policy): DeletionReplayValidation`（含 SEC-02 `prerequisite-pending` 标记）。
- `BackupStack` 构造签名 `new BackupStack(scope, id, { env })`，导出 `backupKey`。
- `deploy/aws/restore-smoke.sh`：无参/`--container <name>`，对本地 disposable PG 执行 create small dataset → pg_dump → restore → verify critical rows；输出机器可读证据。

---

### Task 1: Backup policy/resources

**Files:**
- Create: `tooling/aws-infra/src/backup/backup-policy.ts`, `tooling/aws-infra/src/backup/index.ts`, `tooling/aws-infra/test/backup/backup-policy.test.ts`
- Create: `tooling/aws-infra/src/stacks/backup-stack.ts`, `tooling/aws-infra/test/backup/backup-stack.test.ts`
- Modify: `tooling/aws-infra/src/app.ts`（接线 BackupStack）

**Interfaces:**
- Produces: `BackupPolicy`、`AURORA_BACKUP_POLICY`、`validateBackupPolicy`；`BackupStack`（`backupKey`）。

- [ ] **Step 1: 写失败测试** `backup-policy.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { AURORA_BACKUP_POLICY, validateBackupPolicy } from '../../src/backup/backup-policy.js';

describe('backup policy', () => {
  it('freezes 35-day retention with PITR and daily cross-region copy', () => {
    expect(AURORA_BACKUP_POLICY.retentionDays).toBe(35);
    expect(AURORA_BACKUP_POLICY.pitr).toBe(true);
    expect(AURORA_BACKUP_POLICY.crossRegionCopy.cadence).toBe('daily');
  });

  it('declares approved RPO/RTO targets marked requires-benchmark', () => {
    expect(AURORA_BACKUP_POLICY.targets.singleRegionRpoSeconds).toBe(300); // RPO <= 5min
    expect(AURORA_BACKUP_POLICY.targets.singleRegionRtoSeconds).toBe(3600); // RTO <= 60min
    expect(AURORA_BACKUP_POLICY.targets.regionalRpoSeconds).toBe(86400); // RPO <= 24h
    expect(AURORA_BACKUP_POLICY.targets.regionalRtoSeconds).toBe(28800); // RTO <= 8h
    expect(AURORA_BACKUP_POLICY.note).toContain('requires-benchmark');
  });

  it('validates the frozen policy', () => {
    expect(validateBackupPolicy(AURORA_BACKUP_POLICY)).toEqual([]);
  });

  it('rejects a policy that disables PITR or shrinks retention below 35 days', () => {
    expect(validateBackupPolicy({ ...AURORA_BACKUP_POLICY, pitr: false })).toContain('pitr-required');
    expect(validateBackupPolicy({ ...AURORA_BACKUP_POLICY, retentionDays: 7 })).toContain('retention-min');
  });
});
```

`backup-stack.test.ts`：synth 后含 `AWS::KMS::Key`（`aurora-<env>-kms-backup`）、key 不公共、无 S3/EBS 删除资源、标签齐全；`app.ts` 组合后 backup 栈存在。

- [ ] **Step 2: 运行确认失败**：`pnpm --filter @aurora/aws-infra test` → 新测试失败。

- [ ] **Step 3a: 实现 `backup-policy.ts`**：`AURORA_BACKUP_POLICY = Object.freeze({ retentionDays: 35, pitr: true, crossRegionCopy: { enabled: true, cadence: 'daily', targetRegion: undefined, encryptionKmsKeyRef: undefined }, targets: { singleRegionRpoSeconds: 300, singleRegionRtoSeconds: 3600, regionalRpoSeconds: 86400, regionalRtoSeconds: 28800 }, note: 'approved targets; requires-benchmark; cross-region copy requires-backup-account' })`；`validateBackupPolicy`：`pitr !== true → 'pitr-required'`、`retentionDays < 35 → 'retention-min'`、`crossRegionCopy.enabled && cadence !== 'daily' → 'copy-cadence'`、`targets` 正数校验；`Object.freeze` 返回违规数组。

- [ ] **Step 3b: 实现 `backup-stack.ts`**：`new kms.Key(this, 'BackupKey', { alias: resourceName(env,'kms','backup'), enableKeyRotation: true })`；导出 `backupKey`；`Tags.of(...)` 打 `standardTags`；文件头注释明确：跨区域副本目标需备份账号/第二区域（`requires-backup-account`），RDS 自动备份 35 天 + PITR 在 DataStack（OPS-04）。

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/aws-infra test` 全绿；typecheck 通过；`synth` 生成含 Backup 栈的 12 模板（6 栈 × 2 环境）。

- [ ] **Step 5: Commit**：`feat(backup): OPS-07 backup policy contract + backup kms key`.

---

### Task 2: Restore orchestration + focused restore smoke

**Files:**
- Create: `tooling/aws-infra/src/backup/restore-order.ts`, `tooling/aws-infra/test/backup/restore-order.test.ts`
- Create: `deploy/aws/restore-smoke.sh`

**Interfaces:**
- Consumes: Task 1 的 `BackupPolicy`。
- Produces: `RestoreStep`、`RestorePlan`、`planRestoreOrder()`、`assertRestoreSafety(plan)`；`deploy/aws/restore-smoke.sh`（本地 focused 集成）。

- [ ] **Step 1: 写失败测试** `restore-order.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { assertRestoreSafety, planRestoreOrder } from '../../src/backup/restore-order.js';

describe('restore orchestration', () => {
  it('orders restore per backup-and-recovery §6', () => {
    const plan = planRestoreOrder();
    expect(plan.steps.map((step) => step.phase)).toEqual([
      'infra-keys', 'postgres-migrations', 'session-task-state', 'private-objects',
      'outbox-resume', 'deletion-replay', 'query-command-verify', 'readonly-verify',
      'controlled-traffic',
    ]);
  });

  it('asserts restore cannot resurrect deleted/revoked/session state', () => {
    const plan = planRestoreOrder();
    expect(assertRestoreSafety(plan)).toEqual([]);
    // 人为打乱顺序 → 违规
    const scrambled = { ...plan, steps: [...plan.steps].reverse() };
    expect(assertRestoreSafety(scrambled)).not.toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3a: 实现 `restore-order.ts`**：`planRestoreOrder()` 返回固定 `RestoreStep[]`（顺序 = backup-and-recovery §6 原文顺序）；`assertRestoreSafety(plan)`：验证顺序（`deletion-replay` 必须在 `query-command-verify` 与 `controlled-traffic` 之前、`infra-keys` 必须第一、`postgres-migrations` 必须第二）、`deletion-replay` 存在、`note` 含 `no-resurrection`；违规返回稳定字符串。

- [ ] **Step 3b: 实现 `deploy/aws/restore-smoke.sh`**（本地 focused 集成，docker disposable harness）：

```bash
#!/usr/bin/env bash
# Focused local restore smoke (OPS-07 Task 2). Uses the disposable local PG
# container (aurora-test-pg, port 15432). Creates a small dataset, pg_dump,
# restores into a scratch DB, verifies critical rows. Evidence-only; NOT the
# production RPO/RTO drill (RPO_RTO_EVIDENCE_PENDING).
set -euo pipefail
CONTAINER="${AURORA_RESTORE_CONTAINER:-aurora-test-pg}"
PG_USER="${PGUSER:-aurora}"
SRC="aurora_restore_smoke_src"
DST="aurora_restore_smoke_restored"
DBURL="postgresql://${PG_USER}@localhost:15432"
docker start "$CONTAINER" >/dev/null 2>&1 || true
docker exec "$CONTAINER" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${SRC}" -c "DROP DATABASE IF EXISTS ${DST}" >/dev/null
docker exec "$CONTAINER" createdb -U "$PG_USER" "$SRC"
docker exec "$CONTAINER" psql -U "$PG_USER" -d "$SRC" -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE evt(id bigint primary key, payload jsonb NOT NULL)" \
  -c "INSERT INTO evt VALUES (1,'{\"a\":1}'),(2,'{\"b\":2}'),(3,'{\"c\":3}')" >/dev/null
docker exec "$CONTAINER" pg_dump -U "$PG_USER" -d "$SRC" --no-owner --no-privileges -f /tmp/aurora_dump.sql
docker exec "$CONTAINER" createdb -U "$PG_USER" "$DST"
docker exec "$CONTAINER" sh -c "psql -U ${PG_USER} -d ${DST} -v ON_ERROR_STOP=1 -f /tmp/aurora_dump.sql" >/dev/null
COUNT=$(docker exec "$CONTAINER" psql -U "$PG_USER" -d "$DST" -tAc "SELECT count(*) FROM evt")
docker exec "$CONTAINER" psql -U "$PG_USER" -d postgres -c "DROP DATABASE ${DST}" >/dev/null
docker exec "$CONTAINER" psql -U "$PG_USER" -d postgres -c "DROP DATABASE ${SRC}" >/dev/null
test "$COUNT" = "3" || { echo "restore-smoke FAIL: count=$COUNT"; exit 1; }
echo "restore-smoke PASS: dataset of 3 rows backed up and restored with row count verified"
```

- [ ] **Step 4: 运行确认**：`pnpm --filter @aurora/aws-infra test` 全绿；**执行一次** `bash deploy/aws/restore-smoke.sh` → `restore-smoke PASS`（若本地 PG harness 无法启动，记录 `RESTORE_EVIDENCE_PENDING` 并继续，不伪造）。`git diff --check` 干净。

- [ ] **Step 5: Commit**：`feat(backup): OPS-07 restore orchestration + local restore smoke`.

---

### Task 3: DR drill + RPO/RTO evidence

**Files:**
- Create: `docs/operations/runbooks/backup-restore-dr.md`（含 DR 演练证据模板）

**Interfaces:**
- Consumes: Task 1 `AURORA_BACKUP_POLICY`（RPO/RTO targets）、Task 2 `planRestoreOrder`。

- [ ] **Step 1: 写 Runbook** `docs/operations/runbooks/backup-restore-dr.md`：frontmatter（title/alert-ids/owner）+ 症状 + 恢复流程（按 backup-and-recovery §6 顺序）+ 恢复验证清单（业务不变量、Migration 版本、审计、关键 Query/Command、删除事实）+ **DR 演练证据模板**（恢复点、制品/Migration 版本、实际 RPO/RTO、缺失/损坏数据、删除重放、验证清单、Owner、发现与整改）+ **月度 DB 恢复演练 / 季度跨系统 DR 演练 cadence**（backup-and-recovery §2/§7）。

- [ ] **Step 2: Runbook 契约测试补齐**：`runbook-contract.test.ts` 新增断言 `docs/operations/runbooks/backup-restore-dr.md` 存在且 frontmatter 齐全（不强制每个告警 id 引用——DR Runbook 是恢复类，非单告警主题）。

- [ ] **Step 3: RPO/RTO 一致性检查**：`backup-policy.test.ts` 新增断言——单区域 `rpoSeconds(300) ≤ 5min`、`rtoSeconds(3600) ≤ 60min`；区域 `rpoSeconds(86400) ≤ 24h`、`rtoSeconds(28800) ≤ 8h`；与 test-strategy §6 / 测试/部署设计 §11.1 数值一致。

- [ ] **Step 4: 运行确认**：`pnpm --filter @aurora/aws-infra test` 全绿；Runbook 契约通过。

- [ ] **Step 5: Commit**：`docs(backup): OPS-07 DR runbook + RPO/RTO evidence template`.

---

### Task 4: Delete-replay / backup-expiry validation + Runbook + spec

**Files:**
- Create: `tooling/aws-infra/src/backup/deletion-replay.ts`, `tooling/aws-infra/test/backup/deletion-replay.test.ts`
- Create: `docs/architecture/backup-restore-dr-delete-replay.md`
- Modify: `deploy/aws/restore-smoke.sh`（无变更）——保留。

**Interfaces:**
- Consumes: Task 1 `BackupPolicy`、Task 2 `RestorePlan`。
- Produces: `DeletionReplayFact`、`DeletionReplayValidation`、`validateDeletionReplay`。

- [ ] **Step 1: 写失败测试** `deletion-replay.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { AURORA_BACKUP_POLICY } from '../../src/backup/backup-policy.js';
import { validateDeletionReplay } from '../../src/backup/deletion-replay.js';

describe('deletion replay contract', () => {
  it('marks delete-replay acceptance as prerequisite-pending until SEC-02 exists', () => {
    const result = validateDeletionReplay([], AURORA_BACKUP_POLICY);
    expect(result.prerequisiteDebt).toContain('sec-02-cross-store-deletion-pending');
  });

  it('requires replaying deletion facts before the service reopens', () => {
    const facts = [
      { kind: 'account-deletion', replayBeforeOpen: true },
      { kind: 'session-revocation', replayBeforeOpen: true },
      { kind: 'credential-revocation', replayBeforeOpen: true },
    ] as const;
    const result = validateDeletionReplay(facts, AURORA_BACKUP_POLICY);
    expect(result.violations).toEqual([]);
  });

  it('rejects a replay plan that would resurrect revoked credentials or deleted data', () => {
    const facts = [{ kind: 'credential-revocation', replayBeforeOpen: false }] as const;
    const result = validateDeletionReplay(facts, AURORA_BACKUP_POLICY);
    expect(result.violations).toContain('credential-revocation-must-replay');
  });

  it('enforces 35-day backup expiry without record-level destruction', () => {
    const result = validateDeletionReplay([], AURORA_BACKUP_POLICY);
    expect(result.violations).toContain('backup-expiry-missing');
  });
});
```

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3: 实现 `deletion-replay.ts`**：

```ts
import type { BackupPolicy } from './backup-policy.js';

export type DeletionFactKind =
  | 'account-deletion' | 'session-revocation' | 'org-relation' | 'direct-identity'
  | 'same-email' | 'credential-revocation' | 'backup-expiry';

export interface DeletionReplayFact {
  readonly kind: DeletionFactKind;
  /** Must be replayed before the service reopens to traffic. */
  readonly replayBeforeOpen: boolean;
}

export interface DeletionReplayValidation {
  readonly violations: readonly string[];
  readonly prerequisiteDebt: readonly string[];
}

const MANDATORY_PRE_OPEN: readonly DeletionFactKind[] = [
  'account-deletion', 'session-revocation', 'org-relation', 'direct-identity',
  'same-email', 'credential-revocation',
];

export function validateDeletionReplay(
  facts: readonly DeletionReplayFact[],
  policy: BackupPolicy,
): DeletionReplayValidation {
  const violations: string[] = [];
  const covered = new Set(facts.map((fact) => fact.kind));
  for (const kind of MANDATORY_PRE_OPEN) {
    const fact = facts.find((candidate) => candidate.kind === kind);
    if (fact === undefined) {
      violations.push(`${kind}-must-replay`);
    } else if (!fact.replayBeforeOpen) {
      violations.push(`${kind}-must-replay`);
    }
  }
  if (covered.has('backup-expiry')) {
    const expiry = facts.find((fact) => fact.kind === 'backup-expiry');
    if (expiry !== undefined && expiry.replayBeforeOpen) {
      violations.push('backup-expiry-is-background-not-pre-open');
    }
  } else {
    violations.push('backup-expiry-missing');
  }
  if (policy.retentionDays < 35) violations.push('backup-expiry-retention-min');
  // SEC-02 (cross-store deletion propagation) is a G04 leaf that does not
  // exist yet. Delete-replay acceptance stays prerequisite-pending — we never
  // fake cross-store deletion truth (user rule: the one thing OPS-07 cannot
  // fake-pass).
  const prerequisiteDebt = ['sec-02-cross-store-deletion-pending'];
  return Object.freeze({ violations: Object.freeze(violations), prerequisiteDebt: Object.freeze(prerequisiteDebt) });
}
```

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/aws-infra test` 全绿；typecheck 通过。

- [ ] **Step 5: 正式规格 + 文档同步**。创建 `docs/architecture/backup-restore-dr-delete-replay.md`（`status: approved`、`implementation-status: implemented-in-feature-branch`；备份策略、恢复编排、DR 演练、删除重放契约、备份淘汰、**OPS07_PREREQUISITE_DEBT / delete-replay acceptance = prerequisite-pending**、RPO_RTO_EVIDENCE_PENDING / RESTORE_EVIDENCE_PENDING / PROVISIONING_EVIDENCE_PENDING 记录）。`AGENTS.md`/`AURORA_RULES.md` 的 G16/OPS-07 条目在最终收尾 Task 统一同步。

- [ ] **Step 6: 定向验证（用户限定）**：`pnpm --filter @aurora/aws-infra test`、`typecheck`、`synth`（12 模板）、`git diff --check`、secret-negative（`grep -rnE 'AKIA|BEGIN .*PRIVATE KEY|aurora_ingest_|SecretAccessKey' tooling/aws-infra/src/backup tooling/aws-infra/src/stacks/backup-stack.ts deploy/aws/restore-smoke.sh docs/operations/runbooks/backup-restore-dr.md docs/architecture/backup-restore-dr-delete-replay.md` → 0）。**禁止**完整 PostgreSQL suite、root coverage、浏览器。本地 `pnpm check:boundaries` 的 `examples/sdk-reference` 缺失 package.json 为 `KNOWN_BASELINE_DEBT`（非本轮 diff，CI 无此目录）——记录并继续。

- [ ] **Step 7: Commit**：`feat(backup): OPS-07 delete-replay contract + backup/DR spec (delete-replay acceptance prerequisite-pending)`.

---

## Self-Review

**Spec coverage（OPS-07 要求）**：PostgreSQL backup = Task 1（35 天 + PITR 策略 + RDS 既有配置 + KMS key）；restore order = Task 2（backup-and-recovery §6 顺序 + focused restore smoke）；encryption = Task 1（storageEncrypted RDS + KMS backup key）；retention = Task 1/4（35 天策略）；backup expiry = Task 4（35 天自然淘汰 + 不逐记录破坏共享不可变备份）；RPO/RTO = Task 1/3（单区域 5min/60min、区域 24h/8h，`requires-benchmark`）；region/service failure recovery = Task 3（DR Runbook + 证据模板）；restored system safety = Task 2/4（恢复不得复活删除/撤销/失效）；deletion replay = Task 4（契约 + 前置债务，**不伪造**）；deleted data 不因 restore 复活 = Task 4；已撤销凭证不复活 = Task 4；Audit/backup 生命周期保持 A5 规则 = Task 3/4（审计一年独立保留、备份 35 天淘汰）。

**Placeholder scan**：无 "TBD/TODO"。占位仅为账号/备份账号/区域（approved 契约 `requires-backup-account`）与证据状态（`RPO_RTO_EVIDENCE_PENDING`/`RESTORE_EVIDENCE_PENDING`/`PROVISIONING_EVIDENCE_PENDING`），均为诚实标注。

**Type consistency**：`BackupPolicy`/`AURORA_BACKUP_POLICY`/`validateBackupPolicy`、`RestoreStep`/`RestorePlan`/`planRestoreOrder`/`assertRestoreSafety`、`DeletionReplayFact`/`DeletionReplayValidation`/`validateDeletionReplay`、`BackupStack.backupKey` 在 Task 1—4 间一致。

**本计划不创建真实 AWS 资源、不运行 `cdk deploy`、不修改 `deploy/preview/`、不伪造 delete-replay 已验证、不越界 OPS-05/06。**
