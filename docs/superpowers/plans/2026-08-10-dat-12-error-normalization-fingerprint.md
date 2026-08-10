# DAT-12 Error Normalization Fingerprint Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize validated Error Event bodies into a stable, versioned fingerprint/group key (with a safe `normalizedTitle`), persist it on each error occurrence, and wire it through the real error processor — without inventing new ADRs.

**Architecture:** Pure algorithm + additive persistence. Add `computeErrorFingerprint` + `ERROR_FINGERPRINT_VERSION` as a pure module in `@aurora/processing-store` (data layer); extend `persistErrorEventOccurrence` with an additive migration (fingerprint columns on `error_event_occurrences`) so each occurrence carries its group key; extend `@aurora/ingestion-worker` `createErrorEventProcessor` to parse the envelope, compute the fingerprint, and pass it to the store. No new package, no new ADR (PRD §9.6 fixes version/compatibility semantics).

**Tech Stack:** TypeScript, `@aurora/event-schema` (`parseErrorEventEnvelope`, `ErrorEventBody`, `ErrorCategory`, `ErrorResourceType`), `pg` + node-pg-migrate (additive migration), Vitest + real PostgreSQL 17.10.

## 固定回读与权威边界

| 来源 | 用途 |
|---|---|
| `../../AGENTS.md` / `../../AURORA_RULES.md` | 任务路由、G03 边界、质量门禁 |
| `../architecture/error-normalization-fingerprint.md`（本文规格） | 模块唯一权威来源；所有字段/占位符/版本/隐私/缺失行为以规格 §4—§10 为准 |
| `../protocol/error-event-contract.md` | `ErrorEventBody`/`ErrorDescriptor`/`ErrorResourceType`/`ERROR_EVENT_LIMITS`（只读） |
| `../architecture/error-event-occurrence-processing-store.md` + ADR-018 | `error_event_occurrences` 列与 `(project_id, event_id)` 幂等（只读；本增量只 additive 增列） |
| `../architecture/error-event-processor.md` | `createErrorEventProcessor` 工厂与结果映射（只读；本增量扩展持久化输入） |
| ADR-033（accepted） | `error_event_occurrences` 指纹增列是 Issue 聚合键前置（决定细节 2/5b） |

**Module ID: DAT-12**（G03 第一叶子）。本计划**不得**实现 DAT-13/14/15、Source Map、自定义 fingerprint 输入、页面/环境/发布维度、Console UI。

## Global Constraints

- 纯函数确定性：`computeErrorFingerprint` 无随机、无时钟、无 I/O、不写日志、不修改输入、输出冻结；同输入必同输出。
- 隐私硬边界：fingerprint 只含归一化占位符 + 类别/错误类型 + 关键帧归一化位置；禁止原始 email/手机号/UUID/token/secret/Cookie/Authorization/完整 URL query；帧 `file` 先截断查询/片段并排除 scheme/authority。
- 版本语义：`ERROR_FINGERPRINT_VERSION = 1` 固定；算法变化必须升版本；不自动重组历史数据（PRD §9.6）。
- 只 additive 增列 `error_event_occurrences`（`fingerprint`/`fingerprint_version`），不修改既有列/约束/幂等键；不修改 Inbox/event-schema/ingestion-api/OpenAPI。
- 每 Task 目标验证：受影响 package `typecheck` + 该 Task 的 targeted tests + `git diff --check`；涉及 Migration 时跑对应真实 PG 集成测试。

---

### Task 1: Fingerprint contract + deterministic pure algorithm

**Files:**
- Create: `packages/processing-store/src/error-fingerprint-types.ts`
- Create: `packages/processing-store/src/error-fingerprint.ts`
- Modify: `packages/processing-store/src/index.ts`（导出常量/类型/函数）
- Test: `packages/processing-store/test/error-fingerprint.test.ts`

**Interfaces:**
- Consumes: `@aurora/event-schema` 包根（`ErrorEventBody`/`ErrorDescriptor`/`ErrorResourceType`/`ErrorCategory`/`ERROR_EVENT_LIMITS` 类型与常量）。
- Produces:
```ts
export const ERROR_FINGERPRINT_VERSION = 1 as const;

export interface ErrorFingerprintInput {
  readonly projectId: string;
  readonly body: ErrorEventBody; // 已经 parseErrorEventEnvelope 校验
}

export interface ErrorFingerprintResult {
  readonly fingerprint: string;        // 如 "v1|javascript|TypeError|app.js:42|request failed :uuid"
  readonly fingerprintVersion: number; // ERROR_FINGERPRINT_VERSION
  readonly normalizedTitle: string;    // 归一化消息的有界截断（安全投影标题）
}

export function computeErrorFingerprint(input: ErrorFingerprintInput): ErrorFingerprintResult;
```
- 内部私有函数（不导出）：`normalizeMessage`（规格 §5 占位符替换/保留）、`parseStackFrames`/`selectKeyFrame`（规格 §6 帧解析/选择/URL 投影）、`canonicalizeNonStandardReason`（规格 §7 拒绝 non_standard 有界规范投影）、`escapeComponent`（`|`/`\n`/控制字符转义）。

- [ ] **Step 1: Write the failing contract test**

`packages/processing-store/test/error-fingerprint.test.ts`（Vitest）：

```ts
import { describe, expect, it } from 'vitest';
import {
  ERROR_FINGERPRINT_VERSION,
  computeErrorFingerprint,
} from '../src/index.js';
import type { ErrorEventBody } from '@aurora/event-schema';

const js = (over: Partial<{ name?: string; message: string; stack?: string }>): ErrorEventBody => ({
  category: 'javascript',
  error: {
    ...(over.name === undefined ? {} : { name: over.name }),
    message: over.message,
    ...(over.stack === undefined ? {} : { stack: over.stack }),
  },
});

describe('computeErrorFingerprint', () => {
  it('pins the fingerprint version to 1', () => {
    expect(ERROR_FINGERPRINT_VERSION).toBe(1);
  });

  it('is deterministic for identical input', () => {
    const body = js({ name: 'TypeError', message: 'order 202607250001 failed', stack: 'at f (https://cdn.test/app.js:42:5)' });
    const a = computeErrorFingerprint({ projectId: 'p', body });
    const b = computeErrorFingerprint({ projectId: 'p', body });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprintVersion).toBe(1);
    expect(a.normalizedTitle).toBe(b.normalizedTitle);
  });

  it('groups equivalent errors differing only in dynamic values', () => {
    const body1 = js({ name: 'TypeError', message: 'order 202607250001 failed', stack: 'at f (https://cdn.test/app.js:42:5)' });
    const body2 = js({ name: 'TypeError', message: 'order 202607250999 failed', stack: 'at f (https://cdn.test/app.js:42:5)' });
    expect(computeErrorFingerprint({ projectId: 'p', body: body1 }).fingerprint)
      .toBe(computeErrorFingerprint({ projectId: 'p', body: body2 }).fingerprint);
  });

  it('separates intentionally different errors', () => {
    const body1 = js({ name: 'TypeError', message: 'x is not a function', stack: 'at f (https://cdn.test/app.js:42:5)' });
    const body2 = js({ name: 'ReferenceError', message: 'x is not a function', stack: 'at f (https://cdn.test/app.js:42:5)' });
    expect(computeErrorFingerprint({ projectId: 'p', body: body1 }).fingerprint)
      .not.toBe(computeErrorFingerprint({ projectId: 'p', body: body2 }).fingerprint);
  });

  it('preserves status codes and version numbers, replaces UUID/hash/long digits', () => {
    const a = computeErrorFingerprint({ projectId: 'p', body: js({ name: 'Error', message: 'HTTP 404 version 1.4.3 uuid 550e8400-e29b-41d4-a716-446655440000 retry 2' }) });
    expect(a.fingerprint).toContain('HTTP 404');
    expect(a.fingerprint).toContain('1.4.3');
    expect(a.fingerprint).toContain(':uuid');
    expect(a.fingerprint).not.toContain('550e8400');
  });

  it('omits keyLocation when stack is absent', () => {
    const withStack = computeErrorFingerprint({ projectId: 'p', body: js({ name: 'Error', message: 'boom', stack: 'at f (https://cdn.test/app.js:1:1)' }) });
    const noStack = computeErrorFingerprint({ projectId: 'p', body: js({ name: 'Error', message: 'boom' }) });
    expect(withStack.fingerprint).not.toBe(noStack.fingerprint);
    expect(noStack.fingerprint).toBe('v1|Error|boom');
  });

  it('privacy-negative: fingerprint never contains raw email/phone/uuid/token', () => {
    const result = computeErrorFingerprint({ projectId: 'p', body: js({ name: 'Error', message: 'user a@b.com 13800138000 550e8400-e29b-41d4-a716-446655440000 token abc123' }) });
    expect(result.fingerprint).not.toMatch(/a@b\.com|13800138000|550e8400|abc123/);
    expect(result.normalizedTitle).not.toMatch(/a@b\.com|13800138000/);
  });

  it('strips query/fragment and excludes scheme/authority from stack frame file', () => {
    const result = computeErrorFingerprint({ projectId: 'p', body: js({ name: 'Error', message: 'boom', stack: 'at f (https://cdn.test/app.js?session=abc#frag:10:2)' }) });
    expect(result.fingerprint).toContain('app.js:10');
    expect(result.fingerprint).not.toContain('session=abc');
    expect(result.fingerprint).not.toContain('https://');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/processing-store test -- test/error-fingerprint.test.ts`
Expected: FAIL — `Cannot find module '../src/error-fingerprint-types.js'` / `ERROR_FINGERPRINT_VERSION is not exported`.

- [ ] **Step 3: Write minimal pure modules**

Create `error-fingerprint-types.ts` and `error-fingerprint.ts` implementing the interface above and the normalization/frame/keyLocation/escape rules from spec §4—§8. Include `normalizedTitle` (bounded truncation of normalized message). Do NOT read config, env, or DB.

- [ ] **Step 4: Export from package root**

Modify `packages/processing-store/src/index.ts` to export `ERROR_FINGERPRINT_VERSION`, `computeErrorFingerprint`, `ErrorFingerprintInput`, `ErrorFingerprintResult`.

- [ ] **Step 5: Run the full fingerprint unit test file until green**

Run the Task 1 test file + `pnpm --filter @aurora/processing-store typecheck` + `git diff --check`. All Task 1 assertions green (determinism, grouping, separation, preserve/replace, no-stack, privacy-negative, query-strip).

### Task 2: Additive migration + occurrence store integration

**Files:**
- Create: `packages/processing-store/migrations/1722500000007_error-occurrence-fingerprint.ts`
- Modify: `packages/processing-store/src/error-occurrence-types.ts`（`ErrorOccurrenceDbParams`/`PersistErrorEventOccurrenceInput` 扩展）
- Modify: `packages/processing-store/src/error-occurrence-input.ts`（接受可选 fingerprint；缺省时内部 `computeErrorFingerprint` 兜底）
- Modify: `packages/processing-store/src/error-occurrence-repository.ts`（写入 fingerprint 列）
- Test: `packages/processing-store/test/error-fingerprint-persist.integration.test.ts`

**Migration:**
```ts
// 1722500000007_error-occurrence-fingerprint.ts
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn('error_event_occurrences', {
    fingerprint: { type: 'varchar(1024)', notNull: true },
    fingerprint_version: { type: 'integer', notNull: true, default: 1 },
  });
  pgm.createIndex('error_event_occurrences', ['project_id', 'fingerprint']);
};
export const down = (pgm: MigrationBuilder): void => {
  pgm.dropIndex('error_event_occurrences', ['project_id', 'fingerprint']);
  pgm.dropColumn('error_event_occurrences', ['fingerprint', 'fingerprint_version']);
};
```

- [ ] **Step 1: Write the failing integration test**

`packages/processing-store/test/error-fingerprint-persist.integration.test.ts`（复用既有 real-PG harness，`AURORA_TEST_DATABASE_URL`）：

```ts
import { describe, expect, it } from 'vitest';
import { persistErrorEventOccurrence, computeErrorFingerprint } from '../src/index.js';
// … (pool setup/teardown per existing request-metric integration tests)

describe('persistErrorEventOccurrence fingerprint columns', () => {
  it('stores a fingerprint computed from the validated body', async () => {
    const result = await persistErrorEventOccurrence(pool, {
      projectId,
      eventEnvelope: validErrorEnvelope({ message: 'order 202607250001 failed' }),
    });
    expect(result.status).toBe('inserted');
    const row = await pool.query('SELECT fingerprint, fingerprint_version FROM error_event_occurrences WHERE project_id=$1', [projectId]);
    const expected = computeErrorFingerprint({ projectId, body: parseErrorEventEnvelope(validErrorEnvelope(...)).data.body });
    expect(row.rows[0].fingerprint).toBe(expected.fingerprint);
    expect(row.rows[0].fingerprint_version).toBe(1);
  });

  it('keeps (project_id, event_id) idempotency', async () => {
    // second persist of the same event -> duplicate, one row
  });

  it('migration up/down/up is safe', async () => {
    // runMigrations twice, assert idempotent and columns present
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — migration `1722500000007` does not exist / fingerprint column missing.

- [ ] **Step 3: Write the migration + store changes**

Add the migration, extend `ErrorOccurrenceDbParams` with `fingerprint`/`fingerprintVersion`, extend `parsePersistErrorEventOccurrenceInput` to accept optional fingerprint (validate format: non-empty, length ≤ 1024, stable charset) and compute internally when absent, and write both columns in `persistErrorEventOccurrence`.

- [ ] **Step 4: Run the integration test against real PostgreSQL until green**

Run the Task 2 integration file + affected `typecheck` + `git diff --check`. Do NOT run the full processing suite.

### Task 3: Error Processor integration

**Files:**
- Modify: `apps/ingestion-worker/src/error-event-processor.ts`
- Modify: `apps/ingestion-worker/test/error-event-processor.test.ts`（既有）
- Test: `apps/ingestion-worker/test/error-fingerprint-processor.integration.test.ts`（真实 PG）

**Interfaces:**
- Modify `PersistErrorEventOccurrenceFn` to accept `fingerprint?: string; fingerprintVersion?: number` and pass through.
- `createErrorEventProcessor`：
  - 经 `@aurora/event-schema` 包根 `parseErrorEventEnvelope` 解析信封 → `computeErrorFingerprint({ projectId, body })`（经 `@aurora/processing-store` 包根）→ 随 `input.persist({ projectId, eventEnvelope, fingerprint, fingerprintVersion })` 传入；
  - 解析失败（信封已由 Inbox 校验，实际不应发生）→ 稳定 dead-letter `invalid_event_type`（既有局部前置语义）；
  - 结果映射、retry/backoff、diagnostics 语义不变。

- [ ] **Step 1: Write the failing processor test**

Extend `apps/ingestion-worker/test/error-event-processor.test.ts`：断言处理器调用 `persist` 时传入的 `fingerprint` 等于 `computeErrorFingerprint` 对该事件的输出，且 `fingerprintVersion === 1`（用 spy persist 捕获输入）；既有 processed/retry/dead-letter 映射保持通过。

- [ ] **Step 2: Run to verify it fails**

`pnpm --filter @aurora/ingestion-worker test -- test/error-event-processor.test.ts` → FAIL（persist 未收到 fingerprint）。

- [ ] **Step 3: Implement processor integration**

Modify `createErrorEventProcessor` per Interfaces. 不修改端口结果类型与 retry/backoff 逻辑。

- [ ] **Step 4: Add one real-PG integration test**

`apps/ingestion-worker/test/error-fingerprint-processor.integration.test.ts`：真实 Worker 处理器处理合法错误事件 → `error_event_occurrences` 行 `fingerprint` = `computeErrorFingerprint(...)` 输出。复用既有 worker PG harness。

- [ ] **Step 5: Run both worker test files green + typecheck + `git diff --check`**

### Task 4: Compatibility/privacy verification + docs sync

**Files:**
- Test: `packages/processing-store/test/error-fingerprint.test.ts`（追加版本兼容与 no-stack/name 缺失边界断言）
- Docs: `packages/processing-store/README.md`、`docs/architecture/error-event-occurrence-processing-store.md`、`docs/architecture/formalization-readiness.md`、`docs/README.md`、`AGENTS.md`、`AURORA_RULES.md`
- ADR: `docs/adr/ADR-018-error-event-occurrence-processing-storage.md`（追加实施证据，保持 `accepted / implemented`）

- [ ] **Step 1: Add compatibility + boundary unit assertions**

Append to `error-fingerprint.test.ts`:
- `ERROR_FINGERPRINT_VERSION` fixed at `1`（算法变化必须升版本——测试固定版本号）；
- missing `name` → type 回退类别占位（`js_error`/`rejection_error`/`resource_error`）；
- missing stack → `v1|{type}|{normalizedMessage}` 精确形态；
- resource 类别：`type` 取资源类型、URL path 归一化、query/authority 不进指纹；
- rejection `string`/`non_standard` 各自的确定性指纹与 `non_standard` 规范投影确定性。

Run `pnpm --filter @aurora/processing-store test -- test/error-fingerprint.test.ts` green + typecheck.

- [ ] **Step 2: Sync README + docs + ADR evidence**

- `packages/processing-store/README.md`：错误归一化与 fingerprint 能力、接口、版本语义、隐私边界；
- `docs/architecture/error-event-occurrence-processing-store.md`：fingerprint 增列证据（ADR-018 结论不变）；
- `docs/architecture/formalization-readiness.md`、`docs/README.md`：fingerprint 算法 implemented；Issue 聚合数据模型 not-started（G03 后续叶子）；
- ADR-018：追加 fingerprint 增列实施证据；
- `AGENTS.md`/`AURORA_RULES.md`：全部门禁实际通过后更新阶段快照（DAT-12 implemented、47/31）。

- [ ] **Step 3: Final verification sweep for DAT-12**

1. `pnpm --filter @aurora/processing-store test`（fingerprint 单测 + fingerprint-persist 集成）
2. `pnpm --filter @aurora/ingestion-worker test`（error-event-processor + fingerprint-processor 集成）
3. 受影响 package `typecheck` × 2 + `git diff --check`
4. 不运行根 `check:ci`/Console/SDK/Chromium 全量。

- [ ] **Step 4: Independent leaf verification (reviewer)**

Reviewer 检查：diff + implementer report + 上述 targeted test evidence；只检查 correctness/spec compliance/privacy/data integrity/public contract；确认 DAT-12 叶子独立验收 PASS，更新 G03 计数 `completed 46→47 / remaining 32→31`，提交 leaf-close commit。
