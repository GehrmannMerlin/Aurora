# DAT-13 Issue Aggregate Representative Sample Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggregate fingerprint-grouped error occurrences into a real project-scoped Issue (project-scoped identity, occurrence counts, first/last seen, bounded safe representative samples, lifecycle columns, optimistic version) and wire it through the error processor — per accepted ADR-033.

**Architecture:** Data-model-first. Add the `issues` + `issue_event_applications` + `issue_samples` tables (accepted ADR-033 decision details 3/5/5b/5c/5d) as an additive migration in `@aurora/processing-store`; add a `decideIssueSample` pure bounded-sample policy and a `persistIssueContribution` Repository (event-application idempotency, `GREATEST` last_seen, first-insert race recovery, bounded replacement, aggregation-side `by_time` reopen); extend `@aurora/ingestion-worker` `createErrorEventProcessor` to compute the DAT-12 fingerprint (already done) and call `persistIssueContribution`.

**Tech Stack:** TypeScript, `@aurora/event-schema` (`ErrorEventBody`/`ErrorCategory`), `pg` + node-pg-migrate (additive migration), `@aurora/processing-store` (`computeErrorFingerprint` from DAT-12), Vitest + real PostgreSQL 17.10.

## 固定回读与权威边界

| 来源 | 用途 |
|---|---|
| `../../AGENTS.md` / `../../AURORA_RULES.md` | 任务路由、G03 边界、质量门禁 |
| `../adr/ADR-033-issue-aggregate-data-model.md`（accepted） | **Issue 数据模型唯一权威**：`issues`/`issue_samples`/`issue_event_applications` 表结构、`(project_id, fingerprint, fingerprint_version)` 聚合键、有界样本策略、乐观 `version`、事件应用登记、`ON DELETE NO ACTION` |
| `../architecture/issue-aggregate-representative-sample-store.md`（本文规格） | Repository/纯函数/处理器接线的唯一权威来源（§4—§5） |
| `../architecture/error-normalization-fingerprint.md`（approved，DAT-12） | `computeErrorFingerprint` 输出（`fingerprint`/`fingerprintVersion`/`normalizedTitle`）是 Issue 聚合键输入 |
| `../architecture/error-event-processor.md`（approved） | `createErrorEventProcessor` 既有端口与结果映射（本增量扩展聚合调用，不修改结果映射） |
| PRD §9.1—9.3/9.6/§10.4 | 聚合语义、样本容量/替换、算法版本、再次出现重开 |
| `../adr/ADR-018-...` + DAT-12 Migration `1722500000007` | `error_event_occurrences` 指纹增列先例（只读） |

**Module ID: DAT-13**（G03 第二叶子）。本计划**不得**实现 DAT-14（生命周期 Command/活动/审计表）、DAT-15（Query）、Source Map、自定义 fingerprint、页面/环境/发布维度、Console UI。`issue_activities`/`issue_notes` 表由 DAT-14 实施（ADR-033 决定细节 5c/5d），本计划只实现 `issues`/`issue_event_applications`/`issue_samples`。

## Global Constraints

- 事件应用登记：每个 `(project_id, event_id)` 至多应用一次 Issue 聚合（`issue_event_applications` 唯一约束 + `ON CONFLICT DO NOTHING`），Worker retry/ADR-017 重放下 `occurrence_count` 不重复累加。
- 聚合确定性：`last_seen_at = GREATEST(last_seen_at, occurredAt)`（乱序处理不回退）；`first_seen_at` 不变；`occurrence_count` 只增不减。
- 首次 INSERT 竞态：`INSERT ... ON CONFLICT DO NOTHING RETURNING id` 失败 → 重新 `SELECT ... FOR UPDATE` 按已存在路径应用；"只创建一个 Issue"不变量由唯一约束保证。
- 样本有界：`DEFAULT_MAX_ISSUE_SAMPLES = 100` 服务端常量；`regular` 达到上限只更新计数不存样本；`first`/`latest`/`reappeared` 优先保留，替换最旧 `regular`（无则最旧 `latest`/`reappeared`）；`(project_id, event_id)` 样本幂等。
- 再次出现重开（v1 只 `by_time`）：`resolved`（`resolved_at` 之后的新事件）或 `ignored_until`（到期后）→ 自动恢复 `open` 并递增 `version`（ADR-033 决定细节 4/12）。
- 隐私：`sample_body` 只存已验证错误正文安全投影；`normalized_title` 来自 DAT-12 `normalizedTitle`；禁止原始 PII/secret/URL query。
- 每 Task 目标验证：受影响 package `typecheck` + 该 Task 的 targeted tests + `git diff --check`；涉及 Migration 时跑对应真实 PG 集成测试。

---

### Task 1: Migration + types + package exports

**Files:**
- Create: `packages/processing-store/migrations/1722500000008_issue-aggregate-and-samples.ts`
- Create: `packages/processing-store/src/issue-contribution-types.ts`
- Modify: `packages/processing-store/src/index.ts`
- Test: `packages/processing-store/test/integration/issue-migration.integration.test.ts`

**Migration (accepted ADR-033 decision details 3/5/5b):**
- `issues`：`id bigserial PK`、`project_id uuid NOT NULL`、`fingerprint varchar(1024) NOT NULL`、`fingerprint_version integer NOT NULL`、`category varchar(64) NOT NULL`、`normalized_title varchar NOT NULL`、`first_seen_at timestamptz NOT NULL`、`last_seen_at timestamptz NOT NULL`、`occurrence_count bigint NOT NULL DEFAULT 1`、`sample_count integer NOT NULL DEFAULT 0`、`version integer NOT NULL DEFAULT 1`、`status varchar(16) NOT NULL DEFAULT 'open'`、`assignee_account_id uuid NULL`、`priority varchar(16) NULL`、`resolved_at timestamptz NULL`、`resolved_version varchar NULL`、`resolved_reason varchar(16) NULL`、`ignored_until timestamptz NULL`、`merged_into_issue_id bigint NULL`、`created_at`/`updated_at timestamptz NOT NULL DEFAULT now()`；
  - 唯一约束 `(project_id, fingerprint, fingerprint_version)`；CHECK：`category IN ('javascript','unhandled_rejection','resource')`、`status IN ('open','in_progress','resolved','ignored')`、`priority IS NULL OR IN ('urgent','high','medium','low')`、`resolved_reason IS NULL OR IN ('by_version','by_time')`、`occurrence_count >= 1`、`sample_count >= 0 AND sample_count <= occurrence_count`；索引 `(project_id, status, last_seen_at)`。
- `issue_event_applications`：`project_id uuid NOT NULL`、`event_id varchar(128) NOT NULL`、`issue_id bigint NOT NULL REFERENCES issues(id) ON DELETE NO ACTION`、`created_at`；PK `(project_id, event_id)`。
- `issue_samples`：`id bigserial PK`、`issue_id bigint NOT NULL REFERENCES issues(id) ON DELETE NO ACTION`、`project_id uuid NOT NULL`、`event_id varchar(128) NOT NULL`、`occurred_at timestamptz NOT NULL`、`sample_body jsonb NOT NULL`、`sample_kind varchar(32) NOT NULL`、`created_at`；
  - 唯一约束 `(project_id, event_id)`；CHECK `jsonb_typeof(sample_body) = 'object'`、`sample_kind IN ('first','latest','reappeared','unique_environment','unique_release','unique_browser','unique_page','higher_severity','regular')`；索引 `(issue_id, occurred_at)`。

**Types:**
```ts
export const DEFAULT_MAX_ISSUE_SAMPLES = 100 as const;

export interface PersistIssueContributionInput {
  readonly projectId: string;
  readonly fingerprint: string;          // DAT-12 computeErrorFingerprint.fingerprint
  readonly fingerprintVersion: number;
  readonly category: string;             // ErrorCategory 常量
  readonly normalizedTitle: string;      // DAT-12 normalizedTitle
  readonly eventId: string;
  readonly occurredAtIso: string;        // 信封 occurredAt
  readonly sampleBody: unknown;          // 已验证错误正文安全投影
}

export type PersistIssueContributionResult =
  | { readonly status: 'inserted'; readonly issueId: string }
  | { readonly status: 'applied' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };
```

- [ ] **Step 1: Write failing migration test**
`test/integration/issue-migration.integration.test.ts`（复用 helpers）：drop 全部 processing-store 表 → `migrateUp` → 断言 `issues`/`issue_event_applications`/`issue_samples` 存在、唯一约束/CHECK 生效（插入非法 status 失败、重复 (project_id, event_id) 应用失败）、migration down/up 安全。
- [ ] **Step 2: Run to verify it fails**（migration `1722500000008` 不存在）
- [ ] **Step 3: Write migration + types + exports**
- [ ] **Step 4: Run integration test green + typecheck + `git diff --check`**

### Task 2: `decideIssueSample` pure policy + `persistIssueContribution` Repository

**Files:**
- Create: `packages/processing-store/src/issue-sample-decision.ts`（纯函数）
- Create: `packages/processing-store/src/issue-contribution-repository.ts`
- Modify: `packages/processing-store/src/index.ts`（导出）
- Test: `packages/processing-store/test/issue-sample-decision.test.ts`、`test/issue-contribution-repository.test.ts`

**Pure function:**
```ts
export interface DecideIssueSampleInput {
  readonly sampleCount: number;           // 当前 issue_samples 行数
  readonly eventSampleKind: string;       // 'first' | 'latest' | 'reappeared' | 'regular'
  readonly evictableSampleId: string | null; // 最旧 regular；无则最旧 latest/reappeared；再无不含 first → null
}
export type IssueSampleDecision =
  | { readonly action: 'store' }
  | { readonly action: 'replace'; readonly replaceSampleId: string }
  | { readonly action: 'skip' };

export function decideIssueSample(input: DecideIssueSampleInput): IssueSampleDecision;
```
规则（固定优先级，无随机/无副作用，DAT-13 规格 §5.2 + ADR-033 决定细节 6—8）：
- `sampleCount < DEFAULT_MAX_ISSUE_SAMPLES` → `store`；
- `eventSampleKind === 'regular'` → `skip`（普通重复只更新计数）；
- `evictableSampleId === null` → `skip`（无可替换，保护 first/latest/reappeared）；
- `eventSampleKind === 'first'` → `store`（创建时固定；容量内正常）／容量满时替换 evictable；
- `latest`/`reappeared` → `replace`（`replaceSampleId = evictableSampleId`）。

**Repository `persistIssueContribution(pool, input)`（DAT-13 规格 §5.1 + ADR-033 决定细节 9—11）：**
1. `BEGIN`；输入校验（unknown、fingerprint 格式、category 常量、occurredAt 合法）失败 → `invalid_input`；
2. `SELECT ... FROM issues WHERE project_id=$1 AND fingerprint=$2 AND fingerprint_version=$3 FOR UPDATE`；未命中 → `INSERT INTO issues (...) ON CONFLICT DO NOTHING RETURNING id`；无行（并发输方）→ 重新 `SELECT ... FOR UPDATE` → `created=false`；有行 → `created=true`、`sample_kind='first'`；
3. `INSERT INTO issue_event_applications (project_id, event_id, issue_id) ON CONFLICT DO NOTHING`；影响行数 0 → 该事件已应用 → `ROLLBACK` 返回 `duplicate`（不重复计数/不写样本）；
4. `UPDATE issues SET occurrence_count = occurrence_count + 1, last_seen_at = GREATEST(last_seen_at, $occurredAt), updated_at = now() WHERE id=$issueId`（created 时跳过计数递增——INSERT 已置 1）；
5. **再次出现重开（v1 `by_time`）**：`status='resolved' AND resolved_at IS NOT NULL AND $occurredAt > resolved_at` 或 `status='ignored' AND ignored_until IS NOT NULL AND $occurredAt >= ignored_until` → `UPDATE issues SET status='open', version=version+1, updated_at=now()`；`eventSampleKind='reappeared'`；
6. 样本：`eventSampleKind`（created→`first`；重开→`reappeared`；`occurredAt > 更新前 last_seen`→`latest`；否则→`regular`）；查询最旧 `regular`（无则最旧 `latest`/`reappeared`）作为 evictable；`decideIssueSample` → `store`/`replace`/`skip`；`store`/`replace` → `INSERT INTO issue_samples (...) ON CONFLICT (project_id, event_id) DO NOTHING`（replace 前 `DELETE` evictable 行）+ `UPDATE issues SET sample_count = sample_count + 1`；
7. `COMMIT` → `created ? 'inserted' : 'applied'`；任一步失败 `ROLLBACK` → `temporarily_unavailable`；不暴露 SQLSTATE/约束名/SQL。

- [ ] **Step 1: Write failing unit tests**（`decideIssueSample` 决策矩阵：容量内/满/regular skip/无 evictable skip/first/reappeared/latest 替换；`persistIssueContribution` 输入校验非法值）
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement pure function + repository + exports**
- [ ] **Step 4: Run unit tests green + typecheck + `git diff --check`**

### Task 3: Error Processor integration

**Files:**
- Modify: `apps/ingestion-worker/src/error-event-processor.ts`
- Modify: `apps/ingestion-worker/test/error-event-processor.test.ts`
- Modify: `apps/ingestion-worker/test/integration/error-event-processor.test.ts`

**Integration（DAT-13 规格 §5.4）：**
- `CreateErrorEventProcessorInput` 增加可注入 `contributeIssue?: (input: PersistIssueContributionInput) => Promise<PersistIssueContributionResult>`（缺省 no-op）；或注入 `persistIssueContribution` 实参；
- `process` 在 `parseErrorEventEnvelope` 成功后：`computeErrorFingerprint` → `persistErrorEventOccurrence`（既有）→ 若 occurrence 结果 `inserted`/`duplicate` 且错误正文有效 → `persistIssueContribution({ projectId, fingerprint, fingerprintVersion, category: body.category, normalizedTitle, eventId, occurredAtIso, sampleBody: body })`；
- 结果映射保持：Issue 贡献 `inserted`/`applied`/`duplicate` → 保持 `processed`；`invalid_input` → `dead-letter{invalid_event_type}`；`temporarily_unavailable` → `retry{service_temporarily_unavailable}`（复用 ADR-016 backoff）；不修改既有端口结果类型；
- 不接入生产 composition root。

- [ ] **Step 1: Write failing processor test**：spy `contributeIssue` 捕获输入（fingerprint/category/normalizedTitle 与 `computeErrorFingerprint` 一致）；`persistErrorEventOccurrence` duplicate 时仍调用 contribute（跨 Store 收敛）；Issue 贡献 `temporarily_unavailable` → retry。
- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement processor integration**
- [ ] **Step 4: Extend worker real-PG integration test**：处理错误事件 → `issues` 一行（occurrence_count=1/first_seen=last_seen）+ `issue_samples` 一行 `first` + `issue_event_applications` 一行；重复事件 → count=2 且不重复样本/不重复应用。运行绿 + typecheck + `git diff --check`。

### Task 4: Real-PG integration tests + docs sync + leaf verification

**Files:**
- Create: `packages/processing-store/test/integration/issue-contribution.integration.test.ts`
- Docs: `packages/processing-store/README.md`、`docs/architecture/error-event-occurrence-processing-store.md`、`docs/architecture/formalization-readiness.md`、`docs/README.md`、`AGENTS.md`、`AURORA_RULES.md`、`docs/adr/ADR-018-...`、`docs/adr/ADR-033-...`

**Integration tests（DAT-13 规格 §7，只测高风险行为）：**
- 首次 occurrence 创建 Issue（`inserted`、count=1、first_seen=last_seen、`first` 样本）；
- 重复 occurrence 聚合（`applied`、count+1、last_seen=GREATEST、first_seen 不变、`(project_id, event_id)` 幂等）；
- 并发同 fingerprint 只创建一个 Issue（唯一约束 + INSERT ON CONFLICT + 重锁）；
- 乱序处理（先大后小 occurredAt）`last_seen_at` 不回退；
- 样本保持有界（>100 事件 `regular` 不超、替换不越界、`(project_id, event_id)` 幂等）；
- 项目隔离（不同项目同 fingerprint 各自 Issue）；
- `resolved`/`ignored_until` 再次出现自动重开（status→open、version+1）；
- Migration up/down/up；Schema/Pool 清理。

**Docs sync + leaf-close：**
- `packages/processing-store/README.md`：Issue 聚合/样本能力；
- `docs/architecture/error-event-occurrence-processing-store.md`：Issue 聚合衔接证据；
- `docs/architecture/formalization-readiness.md`、`docs/README.md`：Issue 聚合 implemented；Issue Command（DAT-14）/Query（DAT-15）not-started；
- ADR-018：追加 Issue 聚合证据；ADR-033：追加 DAT-13 实施证据（accepted/not-started → accepted/implemented 于本增量完成后）；
- `AGENTS.md`/`AURORA_RULES.md`：DAT-13 closed-leaf 条目 + 计数 `completed 47→48 / remaining 31→30`（独立验收 PASS 后）。

- [ ] **Step 1: Write + run the real-PG integration suite green**
- [ ] **Step 2: Docs + ADR sync**
- [ ] **Step 3: Final verification sweep**（processing-store 单测+集成、worker 单测+集成、typecheck×2、lint、build、`git diff --check`）
- [ ] **Step 4: Independent leaf verification (reviewer)** → ACCEPT → `completed 47→48 / remaining 31→30`，leaf-close commit。
