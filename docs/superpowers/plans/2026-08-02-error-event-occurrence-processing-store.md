# 实施计划：错误事件 occurrence 处理存储第一增量

## 文件头

- 日期：2026-08-02
- 模块：`packages/processing-store`（`@aurora/processing-store`）
- 正式规格：`docs/architecture/error-event-occurrence-processing-store.md`（approved）
- ADR：`docs/adr/ADR-018-error-event-occurrence-processing-storage.md`（accepted）
- 计划状态：ready-for-implementation
- 目标读者：零上下文工程师
- 权威来源：CLAUDE.md/AGENTS.md/AURORA_RULES.md 快照、approved 规格、accepted ADR-005/008/010/012/015/016/017/018、approved 错误事件协议契约/Inbox 数据模型/处理侧 Repository/Worker 规格

## Goal

创建 `@aurora/processing-store`（`data` 层）包，为未来具体错误事件 processor 提供稳定的错误事件 occurrence 处理存储：`error_event_occurrences` 表 + Migration、`persistErrorEventOccurrence` 持久化 Repository、`(project_id, event_id)` 唯一幂等、通过 `@aurora/event-schema` 根入口验证输入、稳定结果。**不**实现具体错误事件 processor、查询 API、Issue 分组、fingerprint、Source Map 或搜索；**不**把 processing-store 接入 Worker；**不**冻结数据保留规则。

## Architecture

```
packages/processing-store/
  src/
    errors.ts                        # ProcessingStoreError + kind
    error-occurrence-types.ts        # 输入/结果联合类型
    error-occurrence-input.ts        # 顶层 unknown 输入解析 + event-schema 错误事件映射
    error-occurrence-repository.ts   # persistErrorEventOccurrence 持久化
    index.ts                         # 包根导出
  migrations/
    1722500000003_error-event-occurrences.ts   # 追加 Migration
  test/
    error-occurrence-input.test.ts   # 输入解析单测
    error-occurrence-repository.test.ts  # 持久化/错误映射单测
    package-entry.test.ts            # 包入口测试
    security-negative.test.ts        # SQL/敏感信息负例
    drift-against-event-schema.test.ts  # error_category 协议漂移测试
    integration/
      helpers.ts                     # 集成测试助手
      migrations.test.ts             # Migration up/down/up
      error-occurrence.test.ts       # 真实 PostgreSQL 持久化
  README.md
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts
```

依赖方向：`error-occurrence-repository.ts` 依赖 `error-occurrence-input.ts` 与 `error-occurrence-types.ts` 与 `errors.ts`；`error-occurrence-input.ts` 依赖 `@aurora/event-schema` 根入口与 `errors.ts`；均不依赖 Inbox/Worker。包根 `index.ts` 导出最小公共 API。

## Tech Stack

- TypeScript 6.0.3（strict，NodeNext，ES2024，verbatimModuleSyntax，exactOptionalPropertyTypes）
- `pg` 8.22.0（生产运行时依赖）
- `node-pg-migrate` 9.0.0、`@types/pg` 8.20.0、`@vitest/coverage-v8` 4.1.10（开发依赖）
- `@aurora/event-schema`（workspace:* 开发依赖，vitest alias 指向 src/index.ts；包根 `parseErrorEventEnvelope`/`ErrorCategory`/`EventType`/`ErrorEventEnvelope` 类型）
- vitest 4.1.10（测试）；真实 PostgreSQL 17（集成测试，`AURORA_TEST_DATABASE_URL`）

## Global Constraints

- 只实现错误事件 occurrence 能力；不创建 `utils`/`helpers`/`common`/`base-repository`/`generic-store`/`universal-event-table`；
- 不修改 Inbox、Worker、event-schema、ingestion-api、OpenAPI；`apps/ingestion-worker` 的 `package.json` 不新增 `@aurora/processing-store` 依赖；
- 输入经 `@aurora/event-schema` 根入口 `parseErrorEventEnvelope` 验证；不复制错误事件类型；不访问 `@aurora/event-schema/src`/`internal`；
- `(project_id, event_id)` 唯一幂等；`ON CONFLICT DO NOTHING`；不做"先查询再插入"；
- `normalized_body` 只存协议规范化正文（`ErrorEventEnvelope.body`），不存完整 Envelope/Header/凭证/SQL/lease；jsonb CHECK `jsonb_typeof = 'object'` + `error_category = normalized_body->>'category'`；
- `error_category` 三值来自 `ErrorCategory` 公共常量（`javascript`/`unhandled_rejection`/`resource`）；不复制独立漂移枚举；
- `occurred_at` 来自信封；`created_at` 为数据库 `now()`；
- SQL 全参数化；不暴露 SQLSTATE/约束名/SQL；稳定结果不通过正常控制流抛异常（除 `ProcessingStoreError` 用于程序缺陷）；
- 不写日志；不访问 `process.env`；不使用 `Math.random`；
- 不 `git add`/`commit`/`push`；不创建 worktree；不切换分支。

## 文件树（完整）

```
packages/processing-store/package.json
packages/processing-store/tsconfig.json
packages/processing-store/tsconfig.build.json
packages/processing-store/vitest.config.ts
packages/processing-store/README.md
packages/processing-store/src/errors.ts
packages/processing-store/src/error-occurrence-types.ts
packages/processing-store/src/error-occurrence-input.ts
packages/processing-store/src/error-occurrence-repository.ts
packages/processing-store/src/index.ts
packages/processing-store/migrations/1722500000003_error-event-occurrences.ts
packages/processing-store/test/error-occurrence-input.test.ts
packages/processing-store/test/error-occurrence-repository.test.ts
packages/processing-store/test/package-entry.test.ts
packages/processing-store/test/security-negative.test.ts
packages/processing-store/test/drift-against-event-schema.test.ts
packages/processing-store/test/integration/helpers.ts
packages/processing-store/test/integration/migrations.test.ts
packages/processing-store/test/integration/error-occurrence.test.ts
```

## 每个文件单一职责

- `errors.ts`：`ProcessingStoreError`（`kind`: `invalid_input`/`database_unavailable`/`statement_failed`）与 `toStableError`；不包含其他逻辑。
- `error-occurrence-types.ts`：`PersistErrorEventOccurrenceInput`、`PersistErrorEventOccurrenceResult` 联合类型、`ErrorOccurrenceRow`（私有 DB 行映射）定义。
- `error-occurrence-input.ts`：`parsePersistErrorEventOccurrenceInput(input: unknown)` 顶层校验 + `parseErrorEventEnvelope` 映射；生成稳定数据库参数对象。
- `error-occurrence-repository.ts`：`persistErrorEventOccurrence(pool, input)`：事务内 `INSERT ... ON CONFLICT DO NOTHING RETURNING id`；映射 `inserted`/`duplicate`/`temporarily_unavailable`。
- `index.ts`：包根导出 `persistErrorEventOccurrence`、`ProcessingStoreError` 及公共类型。
- `1722500000003_error-event-occurrences.ts`：`error_event_occurrences` 表 + 唯一约束 + CHECK 约束 + `up`/`down`。
- 集成测试：`helpers.ts`（`testDatabaseUrl`/`assertIsTestDatabase`/`createTestPool`/`queryRows`/`queryRow`）、`migrations.test.ts`（Migration up/down/up）、`error-occurrence.test.ts`（真实 PostgreSQL 持久化）。

## 关键设计决策

1. **API 形态**：`persistErrorEventOccurrence(pool, input)` 接受 `Pool`（与 `persistBatch`/`replayDeadLettered` 同风格）。`input` 为 `unknown`，内部 `parsePersistErrorEventOccurrenceInput` 校验顶层后从 `eventEnvelope` 字段提取 unknown 传给 `parseErrorEventEnvelope`。
2. **错误事件验证**：用 `@aurora/event-schema` 根入口 `parseErrorEventEnvelope`；成功时 `data` 是 `ErrorEventEnvelope`（`body` 已是 `ErrorEventBody`）。`error_category = data.body.category`；`normalized_body = data.body`（协议规范化正文，不含信封壳）。
3. **invalid_input code**：顶层校验失败使用稳定私有 code（`invalid_top_level`/`invalid_project_id`/`invalid_envelope`）；`parseErrorEventEnvelope` 失败返回 `invalid_envelope`（不回显 issue 输入值，不把 issue 数组写入结果；可在诊断 message 用首个 issue code 文本，但不暴露输入）。规格第 9 节要求 `invalid_input` 含 `code`。
4. **幂等**：`INSERT INTO error_event_occurrences (project_id, event_id, protocol_version, occurred_at, error_category, normalized_body) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (project_id, event_id) DO NOTHING RETURNING id`；`rows.length === 1` → `inserted`；`0` → `duplicate`。
5. **created_at**：表列 default `now()`；INSERT 不传 created_at。
6. **数据库错误映射**：连接失败码（`ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND`）与语句失败统一 → `temporarily_unavailable`；不泄露 SQLSTATE/约束名/SQL。
7. **occurred_at 转换**：`new Date(data.occurredAt).toISOString()`（信封 occurredAt 为正安全整数毫秒，协议已验证）。
8. **drift 测试**：从 `@aurora/event-schema` 根入口读 `ErrorCategory` 三值，与数据库 CHECK 定义字符串比对；另断言 src 无重复三值字面量枚举（仅从 event-schema 导入）。

## 完整 TypeScript 签名

```ts
// src/errors.ts
export type ProcessingStoreErrorKind = 'invalid_input' | 'database_unavailable' | 'statement_failed';
export class ProcessingStoreError extends Error {
  readonly kind: ProcessingStoreErrorKind;
  constructor(kind: ProcessingStoreErrorKind, message: string);
}

// src/error-occurrence-types.ts
export interface PersistErrorEventOccurrenceInput {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
}

export type PersistErrorEventOccurrenceResult =
  | { readonly status: 'inserted'; readonly occurrenceId: string }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

// src/error-occurrence-input.ts（内部）
export interface ErrorOccurrenceDbParams {
  readonly projectId: string;
  readonly eventId: string;
  readonly protocolVersion: number;
  readonly occurredAtIso: string;
  readonly errorCategory: string;
  readonly normalizedBody: unknown;
}
export function parsePersistErrorEventOccurrenceInput(
  input: unknown,
): ErrorOccurrenceDbParams | { readonly status: 'invalid_input'; readonly code: string };

// src/error-occurrence-repository.ts
export function persistErrorEventOccurrence(
  pool: Pool,
  input: unknown,
): Promise<PersistErrorEventOccurrenceResult>;
```

## 每个 Task 精确路径与 TDD 闭环

### Task 1：ADR 状态、正式规格与结果契约类型

**Consumes**：ADR-018（accepted）、正式规格（approved）。
**Produces**：`src/error-occurrence-types.ts`、`src/errors.ts`；ADR-018 追加记录（accepted / not-started 已有）、规格（approved / not-started 已有）。

1. 失败测试：`test/package-entry.test.ts` 引入 `import { ProcessingStoreError } from '../src/errors.js'` 与类型断言 `PersistErrorEventOccurrenceResult`（此时文件不存在 → import 失败）。同时 `test/error-occurrence-types.test.ts` 断言结果联合类型可构造。
2. 预期失败：`ERR_MODULE_NOT_FOUND` / TS2307。
3. 最小实现：创建 `src/errors.ts`（`ProcessingStoreError` + `toStableError`）；创建 `src/error-occurrence-types.ts`（输入/结果联合类型 + 私有 `ErrorOccurrenceDbParams`）。
4. 确认通过：`pnpm --filter @aurora/processing-store typecheck`（此时 package 尚未创建——先创建最小 package.json/tsconfig 壳；见 Task 2。修正顺序：Task 1 先建 types/errors，Task 2 建包壳与配置，类型测试在 Task 2 后运行）。
   - 修正：Task 1 只创建 `src/errors.ts` 与 `src/error-occurrence-types.ts` 源文件，不跑测试；Task 2 建包壳后统一 typecheck。
5. 回归：无（新包）。
6. 提交边界：types.ts + errors.ts。

### Task 2：包壳、TypeScript/ESLint/Vitest 配置与 Workspace Policy

**Consumes**：ADR-018（data 层）、正式规格第 5 节、ingestion-inbox 包壳模式。
**Produces**：`package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`；根 `package.json` 与 `eslint.config.mjs` 追加路径；`pnpm install` 生成 lockfile。

1. 失败测试：创建 `test/package-entry.test.ts` 断言包名/`aurora.layer: data`/exports 结构（package.json 缺失 → 失败）。
2. 预期失败：文件不存在 / manifest 断言失败。
3. 最小实现：创建包壳文件；根 `package.json` 的 `format:check`/`lint` 追加 `packages/processing-store/**` 路径；`eslint.config.mjs` 的 files 数组追加 `packages/processing-store/**/*.ts`；`pnpm install --frozen-lockfile`（新增包使 lockfile 变化 → 使用 `pnpm install` 更新 lockfile；本计划全局约束禁止 `git add`/`commit`，install 更新 lockfile 是允许的）。
   - 注意：`--frozen-lockfile` 在 lockfile 未含新包时会失败；因此 Task 2 使用 `pnpm install`（非 frozen）首次生成，后续 Task 全用 `pnpm install --frozen-lockfile`。
4. 确认通过：`pnpm --filter @aurora/processing-store typecheck`、`pnpm check:boundaries`。
5. 回归：`pnpm install --frozen-lockfile`（此时应通过）、`pnpm --filter @aurora/event-schema test`（无变化）。
6. 提交边界：包壳 + 根配置追加 + lockfile。

### Task 3：Migration、表、约束与 up/down/up

**Consumes**：正式规格第 12—15、25 节、ingestion-inbox migrations 模式。
**Produces**：`migrations/1722500000003_error-event-occurrences.ts`、`test/integration/migrations.test.ts`、`test/integration/helpers.ts`。

1. 失败测试：`test/integration/migrations.test.ts` 断言 `error_event_occurrences` 表存在、列（id/project_id/event_id/protocol_version/occurred_at/error_category/normalized_body/created_at）、唯一约束、CHECK 约束（category 三值、jsonb object、category=body->>'category'）、down 后表消失、up/down/up 对称（Migration 未创建 → 失败）。
2. 预期失败：`to_regclass('error_event_occurrences')` 为 null。
3. 最小实现：创建 `helpers.ts`（复用 ingestion-inbox 模式）；创建 Migration（up/down 对称）。
4. 确认通过：`pnpm --filter @aurora/processing-store test:integration`。
5. 回归：无（新包）。
6. 提交边界：Migration + 集成测试。

### Task 4：顶层 unknown 输入解析与 event-schema 错误事件映射

**Consumes**：`error-occurrence-types.ts`、`errors.ts`、`@aurora/event-schema` 根入口。
**Produces**：`src/error-occurrence-input.ts`、`test/error-occurrence-input.test.ts`。

1. 失败测试：`test/error-occurrence-input.test.ts`：
   - 非对象 input（null/字符串/数组）→ `invalid_input` code `invalid_top_level`；
   - 缺 projectId → `invalid_project_id`；
   - projectId 非字符串/空字符串 → `invalid_project_id`；
   - 缺 eventEnvelope → `invalid_envelope`；
   - 非错误事件信封（eventType `request`）→ `invalid_envelope`；
   - 错误协议版本 → `invalid_envelope`；
   - 错误正文非法（resource URL 非法）→ `invalid_envelope`；
   - 合法三类别（javascript/promise/rejection/resource）→ 返回 `ErrorOccurrenceDbParams`，`errorCategory` 与 `body.category` 一致，`occurredAtIso` 与信封 occurredAt 一致；
   - 输入对象不被修改；
   - 不访问 `process.env`；不 `console`。
2. 预期失败：`parsePersistErrorEventOccurrenceInput` 未实现 → TS2307 / 断言失败。
3. 最小实现：实现 `parsePersistErrorEventOccurrenceInput`（顶层校验 + `parseErrorEventEnvelope` 分发）。
4. 确认通过：`pnpm --filter @aurora/processing-store test`。
5. 回归：无（新包）。
6. 提交边界：error-occurrence-input.ts + 单测。

### Task 5：Repository INSERT、幂等与稳定错误映射

**Consumes**：`error-occurrence-input.ts`、`error-occurrence-types.ts`、`errors.ts`。
**Produces**：`src/error-occurrence-repository.ts`、`test/error-occurrence-repository.test.ts`。

1. 失败测试：`test/error-occurrence-repository.test.ts`（注入 fake pool/client）：
   - `input` 解析失败 → `invalid_input`（不执行 INSERT）；
   - INSERT `rows.length === 1` → `inserted`（含 occurrenceId）；
   - INSERT `rows.length === 0`（ON CONFLICT 命中）→ `duplicate`；
   - INSERT 抛连接错误 → `temporarily_unavailable`；
   - INSERT 抛语句错误 → `temporarily_unavailable`；
   - 事务 BEGIN/COMMIT/ROLLBACK 顺序（失败时 ROLLBACK、client 释放）；
   - 不暴露 SQL/SQLSTATE/约束名（结果/错误 message 不含这些文本）；
   - 输入对象不被修改；
   - 不 `console`/`process.env`/`Math.random`。
2. 预期失败：`persistErrorEventOccurrence` 未实现 → TS2307 / 断言失败。
3. 最小实现：实现 `persistErrorEventOccurrence`（事务 + `INSERT ... ON CONFLICT DO NOTHING RETURNING id` + 错误映射）。
4. 确认通过：`pnpm --filter @aurora/processing-store test`。
5. 回归：无（新包）。
6. 提交边界：error-occurrence-repository.ts + 单测。

### Task 6：三类错误事件、duplicate、跨项目与数据库失败的真实 PostgreSQL 测试

**Consumes**：全部实现 + `helpers.ts`。
**Produces**：`test/integration/error-occurrence.test.ts`。

1. 失败测试：
   - 空库跑 Migration → 表存在；
   - JavaScript 错误 occurrence 写入 → `inserted`，`occurrenceId` 数字；
   - Promise rejection occurrence 写入 → `inserted`；
   - 资源错误 occurrence 写入 → `inserted`；
   - `protocolVersion` 正确（= 1）；
   - `occurredAt` 正确（与信封一致，timestamptz）；
   - `createdAt` 来自数据库（查询 `created_at` 非空且接近 now，不等于调用方传入值）；
   - `normalizedBody` 与解析结果一致（`jsonb` 列 = 协议规范化正文）；
   - 不存完整 EventEnvelope（`normalized_body` 无 `protocolVersion`/`eventId`/`eventType` 顶层键）；
   - 同 project/eventId 再写 → `duplicate`，且不创建新行（COUNT 不变）；
   - duplicate 不更新原记录（`created_at`/`normalized_body` 不变）；
   - 相同 eventId 不同 project 可分别写入 → 两个 `inserted`；
   - 非法 category 直接 SQL INSERT → CHECK 拒绝；
   - `normalized_body` 非对象直接 SQL INSERT → CHECK 拒绝；
   - category 与正文 category 不一致直接 SQL INSERT → CHECK 拒绝；
   - 数据库错误映射：无连接/无效查询 → `temporarily_unavailable`（或稳定错误，不泄露细节）；
   - Schema/Pool 完整清理。
2. 预期失败：Repository/表未实现 → 失败。
3. 最小实现：写集成测试（复用 helpers）。
4. 确认通过：`pnpm --filter @aurora/processing-store test:integration`。
5. 回归：无（新包；后续 Task 7 回归全仓）。
6. 提交边界：集成测试文件。

### Task 7：包根出口、私有路径负例、协议漂移与安全扫描

**Consumes**：全部实现。
**Produces**：`src/index.ts`、`test/package-entry.test.ts`（补全）、`test/drift-against-event-schema.test.ts`、`test/security-negative.test.ts`。

1. 失败测试：
   - `package-entry.test.ts`：`persistErrorEventOccurrence`/`ProcessingStoreError`/`PersistErrorEventOccurrenceResult` 从包根导出；私有路径（`@aurora/processing-store/error-occurrence-repository` 等）以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝；
   - `drift-against-event-schema.test.ts`：从 `@aurora/event-schema` 读 `ErrorCategory` 三值，与 Migration CHECK 字符串比对；断言 src 不复制三值字面量（仅 import）；
   - `security-negative.test.ts`：src 不含 `SQLSTATE`/`constraint`/`postgres://`/`postgresql://`/`X-Aurora-Client-Key`/`clientKey`/`Authorization`/`cookie`/`secret`/`console.`/`process.env`/`Math.random`；不含 `+ ${` 字符串拼接 SQL。
2. 预期失败：导出缺失 / 负例命中。
3. 最小实现：`index.ts` 导出；确认包根 exports map；补充负例测试。
4. 确认通过：`pnpm --filter @aurora/processing-store test`、`test:package`（build + package-entry）、`pnpm check:boundaries`。
5. 回归：`pnpm --filter @aurora/event-schema test`、`pnpm --filter @aurora/ingestion-inbox test`、`pnpm --filter @aurora/ingestion-worker test`、`pnpm --filter @aurora/ingestion-api test`、`pnpm openapi:check`。
6. 提交边界：index.ts + 负例/漂移测试。

### Task 8：README、文档、覆盖率、ADR 证据与完整门禁

**Consumes**：全部实现。
**Produces**：`README.md`、规格 `implementation-status: implemented`、ADR-018 追加实施证据、`docs/README.md`、`docs/adr/README.md`、`docs/architecture/formalization-readiness.md`、`AGENTS.md`、`AURORA_RULES.md` 状态同步。

1. 失败测试：无新代码测试；执行 `pnpm --filter @aurora/processing-store test:coverage`（85/80/85/85）。
2. 最小实现：README；规格/ADR/文档/入口状态同步。
3. 确认通过：`pnpm --filter @aurora/processing-store test:coverage`、全仓门禁（见 CLI）。
4. 回归：全仓。
5. 提交边界：README + 文档 + 状态同步。

## CLI / 命令

```text
cd D:/Develop/SDK/Aurora
pnpm install                                 # Task 2 首次（lockfile 含新包）
pnpm install --frozen-lockfile               # 后续
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm build
pnpm check:ci
pnpm --filter @aurora/processing-store test
pnpm --filter @aurora/processing-store test:coverage
pnpm --filter @aurora/processing-store test:integration
pnpm --filter @aurora/processing-store test:package
pnpm --filter @aurora/processing-store typecheck
pnpm --filter @aurora/processing-store build
pnpm benchmark:ingestion:smoke
git diff --check
```

## 预期结果

- `@aurora/processing-store` 单元测试全绿；
- 真实 PostgreSQL 17 集成测试全绿（三类错误事件、duplicate、跨项目、约束、Migration up/down/up）；
- 协议漂移测试证明 `error_category` 来自 event-schema 公共常量；
- 覆盖率 85/80/85/85；
- 全仓门禁 exit 0；benchmark smoke exit 0；
- 回归：event-schema/ingestion-inbox/ingestion-worker/ingestion-api 全绿；OpenAPI 无变化。

## 建议提交边界

- Commit 1：Task 1-2（types/errors/包壳/配置）。
- Commit 2：Task 3（Migration + 集成测试基建）。
- Commit 3：Task 4-5（input 解析 + Repository）。
- Commit 4：Task 6-7（真实 PG 集成 + 包入口/漂移/负例）。
- Commit 5：Task 8（README/文档/状态同步）。

（实际提交仅在用户授权时执行；本计划记录提交边界。）

## 禁止

- TODO/TBD/伪代码/模糊占位/未定义类型/生产参数/生产 SLO/实现 processor 或查询或 Issue/规划下一模块/修改 Inbox 或 Worker 或 event-schema 或 OpenAPI/git commit 授权。
