# Request Event Sample Processing Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 文件头

- 日期：2026-08-03
- 模块：`packages/processing-store`（`@aurora/processing-store`）请求事件安全样本处理存储
- 正式规格：`docs/architecture/request-event-sample-processing-store.md`（approved）
- ADR：`docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md`（accepted / not-started）
- 计划状态：ready-for-implementation
- 目标读者：零上下文工程师
- 权威来源：CLAUDE.md/AGENTS.md/AURORA_RULES.md 快照、approved 规格、accepted ADR-004/005/006/008/010/012/018/019、approved 请求事件协议契约、PRD 5.1.2/5.1.3/5.1.5/5.1.6、RULE-REQUEST-PERSISTENCE-20260803-002、既有 Error store 规格

## Goal

在 `packages/processing-store` 内实现请求事件安全样本存储第一增量：`request_event_samples` 表 + Migration、`persistRequestEventSample` Repository、`(project_id, event_id)` 唯一幂等、通过 `@aurora/event-schema` 根入口 `parseRequestEventEnvelope` 验证、受协议约束的六字段 jsonb 安全投影、稳定结果。**不**实现聚合、样本选择、Request Processor、Performance、路由、production composition root、Issue、查询、数据删除任务。

## Architecture

```
packages/processing-store/
  src/
    request-sample-types.ts          # 输入/结果联合类型 + 私有 DbParams
    request-sample-input.ts          # 顶层 unknown 输入解析 + parseRequestEventEnvelope 映射
    request-sample-repository.ts     # persistRequestEventSample 事务持久化
    index.ts                         # 追加导出（编辑）
  migrations/
    1722500000004_request-event-samples.ts   # 追加 Migration（编辑目录）
  test/
    request-sample-input.test.ts     # 输入解析单测
    request-sample-repository.test.ts # 持久化/错误映射单测
    package-entry.test.ts            # 追加 request sample 导出断言（编辑）
    security-negative.test.ts        # 追加请求体/Header/Query 负例（编辑）
    drift-request-against-event-schema.test.ts  # 请求样本协议漂移测试
    integration/
      migrations.test.ts             # 追加 request_event_samples 表断言（编辑）
      request-sample.test.ts         # 真实 PostgreSQL 17.10 持久化
  README.md                          # 追加请求样本能力（编辑）
```

依赖方向：`request-sample-repository.ts` → `request-sample-input.ts` → `@aurora/event-schema` 包根 + `request-sample-types.ts`。`aurora.layer: data`，允许 `data → {protocol}`（现有允许矩阵已支持）。

## Tech Stack

- TypeScript 6.0.3（strict，NodeNext，ES2024，verbatimModuleSyntax）
- `pg` 8.22.0（生产）；`node-pg-migrate` 9.0.0、`@vitest/coverage-v8` 4.1.10（开发）
- `@aurora/event-schema`（workspace:* 开发依赖，vitest alias 指向 src/index.ts；`parseRequestEventEnvelope`/`EventType`/`RequestEventBody` 类型）
- vitest 4.1.10；真实 PostgreSQL 17（集成测试，`AURORA_TEST_DATABASE_URL`）

## Global Constraints

- 只实现请求安全样本存储能力；不实现聚合/样本选择/Request Processor/Performance/路由/查询/删除任务；
- 不判断某事件是否应成为样本（类别由上游策略执行器负责）；
- 只从 `@aurora/event-schema` 包根导入；不访问 `src`/`internal`；
- `sample_body` 只保存协议解析后的六字段白名单（method/url/startedAt/durationMs/outcome/statusCode）；URL 已由协议层移除查询参数与片段；
- 不保存请求/响应体、Header、Cookie、Authorization、敏感查询、完整 URL、DOM/文本、IP、指纹；不保存完整 Envelope/信封字段；
- `(project_id, event_id)` 唯一幂等；`ON CONFLICT DO NOTHING`；不做先查后插；
- `occurred_at` 用信封 `occurredAt`；`created_at` 为数据库 `now()`；
- SQL 全参数化；不暴露 SQLSTATE/约束名/SQL；稳定结果不通过正常控制流抛异常；
- 不写日志；不访问 `process.env`；不使用 `Math.random`；
- 不修改 `error_event_occurrences`/`event_inbox`/`persistErrorEventOccurrence`/Error processor/ingestion-api/request-event-contract/Worker；
- 不 `git add`/`commit`/`push`/`stash`/`reset`/`rebase`/`clean`。

## 文件树（完整）

```
packages/processing-store/src/request-sample-types.ts
packages/processing-store/src/request-sample-input.ts
packages/processing-store/src/request-sample-repository.ts
packages/processing-store/src/index.ts   # 追加导出（编辑）
packages/processing-store/migrations/1722500000004_request-event-samples.ts
packages/processing-store/test/request-sample-input.test.ts
packages/processing-store/test/request-sample-repository.test.ts
packages/processing-store/test/package-entry.test.ts   # 追加断言（编辑）
packages/processing-store/test/security-negative.test.ts   # 追加负例（编辑）
packages/processing-store/test/drift-request-against-event-schema.test.ts
packages/processing-store/test/integration/migrations.test.ts   # 追加断言（编辑）
packages/processing-store/test/integration/request-sample.test.ts
packages/processing-store/README.md   # 追加请求样本能力（编辑）
```

## 每个文件单一职责

- `request-sample-types.ts`：`PersistRequestEventSampleInput`、`PersistRequestEventSampleResult` 联合类型、私有 `RequestSampleDbParams`。
- `request-sample-input.ts`：`parsePersistRequestEventSampleInput(input: unknown)` 顶层校验 + `parseRequestEventEnvelope` 映射 → `RequestSampleDbParams`。
- `request-sample-repository.ts`：`persistRequestEventSample(pool, input)` 事务内 `INSERT ... ON CONFLICT DO NOTHING RETURNING id`。
- `1722500000004_request-event-samples.ts`：`request_event_samples` 表 + 唯一约束 + jsonb object CHECK + up/down。
- 集成测试：`request-sample.test.ts`（真实 PG 持久化）、`migrations.test.ts`（表/约束/down/up）。

## 关键设计决策

1. **API 形态**：`persistRequestEventSample(pool, input)` 接受 `Pool`（与 `persistErrorEventOccurrence` 同风格）。`input` 为 `unknown`，内部 `parsePersistRequestEventSampleInput` 校验顶层后从 `eventEnvelope` 提取 unknown 传给 `parseRequestEventEnvelope`。
2. **安全投影**：成功解析的 `RequestEventEnvelope`，`sample_body = envelope.body`（协议已保证六字段白名单、URL 去查询片段）；`occurred_at = new Date(envelope.occurredAt).toISOString()`；不保存信封字段。
3. **invalid_input code**：顶层校验失败使用稳定私有 code（`invalid_top_level`/`invalid_project_id`/`invalid_envelope`）；`parseRequestEventEnvelope` 失败返回 `invalid_envelope`（不回显输入值）。
4. **幂等**：`INSERT INTO request_event_samples (project_id, event_id, protocol_version, occurred_at, sample_body) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (project_id, event_id) DO NOTHING RETURNING id`；`rows.length === 1` → `inserted`；`0` → `duplicate`。
5. **created_at**：列 default `now()`；INSERT 不传 created_at。
6. **数据库错误映射**：连接失败/语句失败 → `temporarily_unavailable`；不泄露 SQLSTATE/约束/SQL。

## 完整 TypeScript 签名

```ts
// src/request-sample-types.ts
export interface PersistRequestEventSampleInput {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
}

export type PersistRequestEventSampleResult =
  | { readonly status: 'inserted'; readonly sampleId: string }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

export interface RequestSampleDbParams {
  readonly projectId: string;
  readonly eventId: string;
  readonly protocolVersion: number;
  readonly occurredAtIso: string;
  readonly sampleBody: unknown;
}

// src/request-sample-input.ts（内部）
export function parsePersistRequestEventSampleInput(
  input: unknown,
): RequestSampleDbParams | { readonly status: 'invalid_input'; readonly code: string };

// src/request-sample-repository.ts
export function persistRequestEventSample(
  pool: Pool,
  input: unknown,
): Promise<PersistRequestEventSampleResult>;
```

## 每个 Task 精确路径与 TDD 闭环

### Task 1：安全样本投影与稳定类型

**Consumes**：`request-event-types.ts`（`RequestEventBody`）、`processor` 无（包内）。
**Produces**：`src/request-sample-types.ts`、`src/request-sample-input.ts`、`test/request-sample-input.test.ts`。

1. 失败测试：`test/request-sample-input.test.ts`：
   - 非对象 input（null/字符串/数组）→ `invalid_top_level`；
   - 缺/非法 projectId → `invalid_top_level`/`invalid_project_id`；
   - 缺 envelope → `invalid_top_level`；
   - 非 Request 事件（error/performance/resource/未知 eventType）→ `invalid_envelope`；
   - 不支持的 protocolVersion → `invalid_envelope`；
   - 请求正文非法（非法 method/URL/时间戳/超长/缺失必填）→ `invalid_envelope`；
   - 合法五类 outcome + 各 HTTP 方法 → 返回 `RequestSampleDbParams`，`sampleBody` 与 `body` 一致，`occurredAtIso` 与信封 occurredAt 一致；
   - 输入对象不被修改。
2. 预期失败：`ERR_MODULE_NOT_FOUND` / TS2307。
3. 最小实现：创建 `request-sample-types.ts` + `request-sample-input.ts`。
4. 确认通过：`pnpm --filter @aurora/processing-store test`。
5. 回归：`error-occurrence-input.test.ts`（Error 解析不回归）。
6. 提交边界：types + input + 单测。

### Task 2：request_event_samples Migration

**Consumes**：规格第 12—15 节、`1722500000003_error-event-occurrences.ts` 模式。
**Produces**：`migrations/1722500000004_request-event-samples.ts`、`test/integration/migrations.test.ts` 追加。

1. 失败测试：`test/integration/migrations.test.ts` 追加断言 `request_event_samples` 表存在、列（id/project_id/event_id/protocol_version/occurred_at/sample_body/created_at）、唯一约束、`jsonb_typeof(sample_body) = 'object'` CHECK、down 后表消失、up/down/up 对称（Migration 未创建 → 失败）；`beforeAll` 追加 `DROP TABLE IF EXISTS request_event_samples CASCADE`。
2. 预期失败：`to_regclass('request_event_samples')` 为 null。
3. 最小实现：创建 Migration（up/down 对称）。
4. 确认通过：`pnpm --filter @aurora/processing-store test:integration`。
5. 回归：`error-event-occurrences` 表断言不回归（migrations.test 原有断言保持）。
6. 提交边界：Migration + migrations.test 追加。

### Task 3：persistRequestEventSample Repository

**Consumes**：`request-sample-input.ts`、`request-sample-types.ts`。
**Produces**：`src/request-sample-repository.ts`、`test/request-sample-repository.test.ts`。

1. 失败测试：`test/request-sample-repository.test.ts`（fake pool/client，模式同 `error-occurrence-repository.test.ts`）：
   - input 解析失败 → `invalid_input`（不执行 INSERT）；
   - INSERT `rows.length === 1` → `inserted`（含 sampleId）；
   - INSERT `rows.length === 0`（ON CONFLICT 命中）→ `duplicate`；
   - INSERT 抛连接/语句错误 → `temporarily_unavailable`（ROLLBACK）；
   - 不泄露 SQL/SQLSTATE/约束名；
   - 输入不变；
   - 不 `console`/`process.env`/`Math.random`。
2. 预期失败：`persistRequestEventSample` 未实现 → TS2307。
3. 最小实现：实现 `persistRequestEventSample`（事务 + `INSERT ... ON CONFLICT DO NOTHING RETURNING id` + 错误映射）。
4. 确认通过：`pnpm --filter @aurora/processing-store test`。
5. 回归：`error-occurrence-repository.test.ts` 不回归。
6. 提交边界：repository.ts + 单测。

### Task 4：包根导出、隐私负例与协议漂移

**Consumes**：全部实现。
**Produces**：`src/index.ts` 追加导出、`test/package-entry.test.ts` 追加、`test/security-negative.test.ts` 追加、`test/drift-request-against-event-schema.test.ts`。

1. 失败测试：
   - `package-entry.test.ts`：`persistRequestEventSample`/`PersistRequestEventSampleResult` 从包根导出；私有路径 `@aurora/processing-store/request-sample-repository` 等以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝；
   - `security-negative.test.ts`：src 不含 `requestHeader`/`responseHeader`/`requestBody`/`responseBody`/`X-Aurora-Client-Key`/`Authorization`/`cookie`/`token`/`password`/`SQLSTATE`/`postgres://`/`console.`/`process.env`/`Math.random`；不含 `+ ${` 字符串拼接 SQL；
   - `drift-request-against-event-schema.test.ts`：`sample_body` 投影字段与 `RequestEventBody` 六字段一致；Migration `jsonb_typeof` CHECK 存在；src 不复制独立枚举。
2. 预期失败：导出缺失 / 负例命中。
3. 最小实现：`index.ts` 导出；确认负例通过。
4. 确认通过：`pnpm --filter @aurora/processing-store test`、`test:package`、`pnpm check:boundaries`。
5. 回归：`pnpm --filter @aurora/event-schema test`。
6. 提交边界：index.ts + 负例/漂移测试。

### Task 5：真实 PostgreSQL 17.10 集成测试

**Consumes**：全部实现 + `test/integration/helpers.ts`。
**Produces**：`test/integration/request-sample.test.ts`。

1. 失败测试：
   - 空库跑 Migration → `request_event_samples` 表存在；
   - 合法 Request 事件样本写入 → `inserted`，`sampleId` 数字；
   - `protocolVersion`/`occurredAt` 正确；`createdAt` 来自数据库；
   - `sampleBody` 与解析结果一致（jsonb 列 = 六字段投影）；
   - 不存完整 Envelope/请求体/Header/凭证；
   - 同 project/eventId 再写 → `duplicate`，COUNT 不变；
   - duplicate 不覆盖原样本；
   - 相同 eventId 不同 project 可分别写入；
   - 非 Request 事件调用 → `invalid_input` 且不写入；
   - 数据库暂时不可用（注入失败 store）→ `temporarily_unavailable`；
   - `jsonb_typeof(sample_body)` 非 object 直接 SQL INSERT → CHECK 拒绝；
   - `(project_id, event_id)` 唯一约束；
   - **error_event_occurrences 回归**：`persistErrorEventOccurrence` 写入/duplicate 不受影响；
   - Schema/Pool 完整清理。
2. 预期失败：Repository/表未实现 → 失败。
3. 最小实现：写集成测试。
4. 确认通过：`pnpm --filter @aurora/processing-store test:integration`。
5. 回归：既有 `error-occurrence.test.ts` 集成测试。
6. 提交边界：集成测试文件。

### Task 6：README、文档、覆盖率与状态同步

**Consumes**：全部实现。
**Produces**：`README.md` 追加、规格 `implementation-status: implemented`、ADR-019 追加实施证据、`docs/README.md`、`docs/architecture/formalization-readiness.md`、`AGENTS.md`、`AURORA_RULES.md` 状态同步。

1. 失败测试：无新代码测试；执行 `pnpm --filter @aurora/processing-store test:coverage`（85/80/85/85）。
2. 最小实现：README；规格/ADR/文档/入口状态同步。
3. 确认通过：`pnpm --filter @aurora/processing-store test:coverage`、全仓门禁（见 CLI）。
4. 回归：全仓。
5. 提交边界：README + 文档 + 状态同步。

## CLI / 命令

```text
cd D:/Develop/SDK/Aurora
pnpm install --frozen-lockfile
pnpm --filter @aurora/processing-store typecheck
pnpm --filter @aurora/processing-store test
pnpm --filter @aurora/processing-store test:integration
pnpm --filter @aurora/processing-store test:coverage
pnpm --filter @aurora/processing-store test:package
pnpm --filter @aurora/processing-store build
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

- `@aurora/processing-store` 单元测试全绿（含 request sample）；
- 真实 PostgreSQL 17.10 集成测试全绿（写入/duplicate/并发/非 Request/隐私/约束/Migration up/down/up）；
- 覆盖率 85/80/85/85；
- 全仓门禁 exit 0；benchmark smoke exit 0；OpenAPI 无变化；
- 回归：event-schema/Error store/ingestion-worker/ingestion-api 全绿。

## 建议提交边界

- Commit 1：Task 1（types/input/单测）。
- Commit 2：Task 2（Migration + 集成基建）。
- Commit 3：Task 3（repository/单测）。
- Commit 4：Task 4（index/负例/漂移）。
- Commit 5：Task 5（真实 PG 集成）。
- Commit 6：Task 6（README/文档/状态同步）。

（本轮不实际执行 Git 提交；以上仅为逻辑边界。）

## 禁止

- TODO/TBD/伪代码/模糊占位/未定义类型/实现聚合或样本选择或 Request Processor/把样本表描述为完整请求历史/保存请求体/响应体/Header/Cookie/Authorization/敏感查询/完整 URL/修改 request-event-contract/修改 Error store/修改 Worker/修改 POST /v1/batches/git add/commit/push/stash/reset/rebase/clean。
