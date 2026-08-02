# Ingestion Inbox Data Model (数据接入 Inbox 数据模型第一增量) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ REAL-POSTGRES GATE (must hold before executing):** This plan is **complete and ready-for-implementation**, but execution is gated on a reachable PostgreSQL 17 instance via `AURORA_TEST_DATABASE_URL`. As of 2026-08-01 the variable is **NOT SET**, Docker daemon is NOT reachable, no psql, no local PG service, no `pg` installed. Until that gate passes, implement only the non-database-safe subset explicitly marked `[ENV-INDEPENDENT]` below; **do not** mark `implementation-status: implemented`, do not claim migrations/constraints/concurrency verified, and do not substitute mocks for real PostgreSQL evidence. The conservative path is: finish spec + plan + self-check, then STOP and report how to provide `AURORA_TEST_DATABASE_URL`.

**Goal:** 在 `@aurora/ingestion-inbox` 中冻结并实施数据接入 `event_inbox` 数据模型第一增量：`node-pg-migrate` Migration（`event_inbox` 表 + `(project_id, event_id)` 幂等唯一约束 + 状态/租约/重试/死信结构字段 + 最小索引）、TypeScript 行映射、原子批次持久化 Repository（`persistBatch`，事务内插入 + `ON CONFLICT`，区分 `inserted`/`duplicate`）、真实 PostgreSQL 集成测试与包边界。本计划只实施 Inbox 数据模型与持久化；**不**实现 Fastify 路由、HTTP 鉴权、Origin/CORS/environment 校验、客户端密钥、接入服务编排、Worker 消费循环、重试调度、死信重放、Redis/BullMQ、SQS/Kinesis、RDS/CI/IaC。

**Architecture:** SQL-first 包：`pg`（`Pool`）管理连接，事务通过同一 client 显式执行，参数化批量插入 + `ON CONFLICT (project_id, event_id) DO NOTHING` 实现幂等与部分成功。`node-pg-migrate` 以程序化/脚本方式执行 Migration（默认事务、Migration 锁、`pgmigrations` 版本表）。`event_inbox` 单一 `state` 字段 + `available_at` + `lease_owner`/`lease_expires_at` + `attempt_count` 表达 ADR-008 最小状态模型（pending/leased/retry_waiting/processed/dead_lettered）。EventEnvelope 以 JSONB 原样保存（已通过 event-schema 公共解析器）。包 `aurora.layer: data`（若 policy 扩展）或 `tooling` 之外的新层；只从 `@aurora/event-schema` 包根导入。

**Tech Stack:** PostgreSQL 17、`pg` 8.22.0（生产依赖，Node ≥16 兼容 Node 24）、`@types/pg` 8.20.3（devDependency）、`node-pg-migrate` 9.0.0（devDependency，自带类型，Node ≥20.11）、TypeScript 6.0.3、Vitest 4.1.10、@vitest/coverage-v8 4.1.10、pnpm 11.17.0、Node.js ≥24.18.0（当前 v24.18.0）。

**Plan status:** ready-for-implementation（等待真实 PostgreSQL 17 门禁通过；本消息已预先批准无歧义派生的规格与计划；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 只新增 `packages/ingestion-inbox/`（src/、migrations/、test/、test/integration/、README.md、package.json、tsconfig.json、tsconfig.build.json、vitest.config.ts）与相关索引文档。不修改 `packages/event-schema` 源码或公共 API。
- `pg` 是生产运行时依赖；`@types/pg`、`node-pg-migrate`、`vitest`、`typescript`、`@types/node` 是 devDependencies。
- 数据库包不依赖 Browser、Core 或任何 SDK 插件；只从 `@aurora/event-schema` 包根导入（`EventEnvelope`、`IngestionReceiptState`、`IngestionErrorCode`、`EVENT_SCHEMA_LIMITS`、`BATCH_EVENT_LIMITS`）；不访问 `src`/`internal`。
- "已可靠接收"（`accepted`/`duplicate_accepted`）严格对应 `event_inbox` 事务成功 COMMIT；本计划不实现 Inbox 写入之外的 HTTP/Worker/队列。
- 幂等范围严格为 `(project_id, event_id)`；不建立全局 event_id 唯一；不同项目可用相同 eventId；不向上层暴露 SQLSTATE/约束名/SQL 文本。
- 部分成功：合法事件与重复事件在事务内用 `ON CONFLICT DO NOTHING` 区分；单条冲突不回滚整批。
- 不承诺全局/项目内/批次内处理顺序；`id`、`received_at`、`batch_index` 只用于追踪与确定性测试。
- 状态模型：`pending`/`leased`/`retry_waiting`/`processed`/`dead_lettered`；`processed`/`dead_lettered` 为终态；租约过期可重投；`available_at` 前不可提前领取；精确最大重试/退避数值保持后续 Worker 决策，不引入无限重试默认。
- 数据最小化：禁止存储客户端密钥、secret/摘要、Cookie、Authorization、请求 Header、Browser Session、完整 allowlist、SQL 错误/堆栈、未批准用户身份信息。
- SQL 全部参数化；禁止字符串拼接不可信值；禁止 `pg` 类型/错误泄露到公共协议层；错误映射为稳定内部失败。
- 文件 kebab-case，类型/接口 PascalCase，函数/变量 camelCase，布尔 `is`/`has`/`can`/`should` 前缀。禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore`、静默 catch。
- 不创建 `utils`/`helpers`/`common`/`misc`；不提前创建通用 Repository 框架或多数据库兼容层。
- 真实 PostgreSQL 测试使用 `AURORA_TEST_DATABASE_URL`；测试确认目标是测试数据库；每次测试独立 Schema/唯一命名空间；清理失败显式报错；禁止 SQLite/mock/PGlite 替代真实 PostgreSQL 完成证据。
- 第一增量不引入独立 SQL linter；不创建 GIN 索引；不做过早分区；性能结论均 `requires-benchmark`。
- Migration 确定性、版本稳定、默认事务、Migration 锁、应用启动不自动迁移生产数据库、已发布 Migration 只追加；生产回滚向前修复/expand-contract。
- ADR 状态：ADR-010 保持 `accepted / not-started`（真实实现后更新 `in-progress`）；ADR-008 `accepted / not-started`；ADR-009 `accepted / in-progress`；ADR-005 `accepted / in-progress`。真实 PostgreSQL 验证可用前，Inbox 规格与实现状态不得标为 `implemented`。

---

## 文件树

```text
packages/ingestion-inbox/
├── package.json                  # Create：包清单（pg 生产依赖，node-pg-migrate/@types/pg devDeps）
├── tsconfig.json                 # Create：extends 根 base，noEmit，types node+vitest/globals
├── tsconfig.build.json           # Create：src→dist 构建
├── vitest.config.ts              # Create：node 环境，test/ 与 test/integration/ 分离（integration 由 env 门控）
├── README.md                     # Create：模块定位/职责/命令/测试变量
├── migrations/
│   └── 1722500000000_event-inbox.ts  # Create：node-pg-migrate 迁移（event_inbox 表 + 约束 + 索引）
├── src/
│   ├── index.ts                  # Create：包根公共出口
│   ├── types.ts                  # Create：公共类型（PersistIngestionBatchInput/Result 等）
│   ├── event-inbox-row.ts        # Create：行类型与事件持久化映射（EventEnvelope→JSONB）
│   ├── persist-batch.ts          # Create：persistBatch SQL + 事务逻辑
│   ├── errors.ts                 # Create：稳定内部失败类型
│   └── run-migrations.ts         # Create：node-pg-migrate 程序化执行入口（脚本包装）
└── test/
    ├── types.test.ts             # Create [ENV-INDEPENDENT]：公共类型、行映射、错误类型单元测试
    ├── persist-batch.unit.test.ts# Create [ENV-INDEPENDENT]：SQL 构造/映射纯逻辑（不连库）
    ├── package-entry.test.ts     # Create [ENV-INDEPENDENT]：包入口、私有路径负例
    └── integration/
        ├── migrations.test.ts    # Create [PG-GATED]：空库 up、版本检测、down/up、schema 断言
        ├── constraints.test.ts   # Create [PG-GATED]：(project_id,event_id) 唯一、check 约束、索引
        ├── persist-batch.test.ts # Create [PG-GATED]：幂等、部分成功、事务回滚、EventEnvelope 保存
        └── isolation.test.ts     # Create [PG-GATED]：独立 Schema、清理、连接目标校验
```

每个文件单一职责；`src/` 只放数据模型/持久化/迁移执行，不创建 Fastify/Worker/队列实现。

---

## Consumes / Produces 总览

- **Consumes**：`docs/architecture/ingestion-inbox-data-model.md`（approved 规格）、`@aurora/event-schema` 根（`EventEnvelope`、`EVENT_SCHEMA_LIMITS`、`BATCH_EVENT_LIMITS`、`IngestionReceiptState`）、ADR-008/009/010 约束、`node-pg-migrate`/`pg` 实际版本。
- **Produces**：`packages/ingestion-inbox/`（src、migrations、test、README）、Migration `event_inbox`、`persistBatch` Repository、真实 PostgreSQL 集成测试、包入口/边界、ADR-008/010 实施证据（真实实现后）、更新后的 formalization-readiness。

---

## Task 1: 包骨架、配置与依赖边界 [ENV-INDEPENDENT]

**目标：** 创建 `@aurora/ingestion-inbox` 包骨架，安装 `pg`/`node-pg-migrate`/`@types/pg`，建立 tsconfig/vitest/package 配置。此 Task 不连数据库，只搭包结构。

- Consumes: 根 tsconfig.base.json、pnpm-workspace.yaml、ADR-010 §4.4。
- Produces: `packages/ingestion-inbox/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,src/index.ts}`。

- [ ] **Step 1: 失败测试（包入口断言先行）**
  - 创建 `test/package-entry.test.ts`，断言：
    - 包根导出 `persistBatch`（或等价入口）与全部公共类型；
    - 包 `aurora.layer` 为 `data`（或按 Workspace Policy 允许的新层值；若 policy 未定义 `data` 层则本 Task 记录需扩展 policy 的决策）；
    - `pg` 在生产 `dependencies`，`node-pg-migrate`/`@types/pg` 在 `devDependencies`；
    - 私有路径（`src/`、`internal/`）不可导入。
  - 先只建空 `src/index.ts`，测试预期失败（入口未导出）。

- [ ] **Step 2: 最小实现包骨架**
  - 创建 `package.json`：
    ```json
    {
      "name": "@aurora/ingestion-inbox",
      "version": "0.0.0",
      "private": true,
      "type": "module",
      "engines": { "node": ">=24.18.0 <25" },
      "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
      "files": ["dist"],
      "scripts": {
        "build": "tsc -p tsconfig.build.json",
        "typecheck": "tsc -p tsconfig.json --noEmit",
        "test": "vitest run --exclude test/integration/**",
        "test:integration": "vitest run test/integration",
        "migrate": "tsx src/run-migrations.ts"
      },
      "dependencies": { "pg": "8.22.0" },
      "devDependencies": {
        "@aurora/event-schema": "workspace:*",
        "@types/node": "24.13.3",
        "@types/pg": "8.20.3",
        "node-pg-migrate": "9.0.0",
        "typescript": "6.0.3",
        "vitest": "4.1.10"
      },
      "aurora": { "layer": "data" }
    }
    ```
  - `tsconfig.json` extends 根 base，`noEmit: true`，`types: ["node","vitest/globals"]`，include `src/**/*.ts`, `test/**/*.ts`, `migrations/**/*.ts`, `vitest.config.ts`。
  - `tsconfig.build.json` extends，`noEmit: false`，`outDir: dist`，`rootDir: src`，include `src/**/*.ts`。
  - `vitest.config.ts`：node 环境，`include: ['test/**/*.test.ts']`，排除 `test/integration` 的常规 `test` 脚本。
  - `src/index.ts` 初始导出占位。
  - **注**：若 `aurora.layer: data` 触发 Workspace Policy `forbidden-layer-dependency` 或 layer 未定义，本 Task 记录需在 `tooling/workspace-policy/src/graph.ts` 增加 `data` 层规则（只允许依赖 `protocol`）；这是计划内的小型 policy 扩展。

- [ ] **Step 3: 确认通过**
  - `pnpm --filter @aurora/ingestion-inbox typecheck` exit 0；
  - `pnpm --filter @aurora/ingestion-inbox test`（包入口断言）通过。

- [ ] **Step 4: 相关回归**
  - `pnpm check:boundaries`：确认新包不违反依赖方向（`data → protocol` 允许）；
  - `pnpm --filter @aurora/event-schema test`：确认 event-schema 未受影响。

- [ ] **Step 5: 建议提交边界**
  - `packages/ingestion-inbox/package.json`、`tsconfig*.json`、`vitest.config.ts`、`src/index.ts`、`test/package-entry.test.ts`；若需 `tooling/workspace-policy/src/graph.ts` 的 layer 扩展则一并提交。

---

## Task 2: 公共类型与行映射 [ENV-INDEPENDENT]

**目标：** 冻结 `PersistIngestionBatchInput`/`Result`、`InboxEventInput`/`InboxEventPersistResult`、`event_inbox` 行类型、`EventEnvelope→JSONB` 映射与稳定错误类型。

- Consumes: 规格 §7/§14、`@aurora/event-schema` 根（`EventEnvelope`、`EVENT_SCHEMA_LIMITS`、`BATCH_EVENT_LIMITS`）。
- Produces: `src/types.ts`、`src/event-inbox-row.ts`、`src/errors.ts`。

- [ ] **Step 1: 失败测试（类型断言先行）**
  - `test/types.test.ts` 断言：
    - `PersistIngestionBatchInput` 有 `projectId: string`、`events: readonly InboxEventInput[]`、可选 `receivedAt`/`requestId`/`batchId`；
    - `InboxEventInput` 有 `batchIndex: number`、`event: EventEnvelope`；
    - `InboxEventPersistResult.outcome` 为 `'inserted' | 'duplicate'`；
    - 行映射函数把合法 `EventEnvelope` 序列化为 JSONB 字符串、反序列化回同构对象；
    - 空数组输入抛稳定错误；
    - `errors.ts` 定义稳定内部失败类型（不含 PostgreSQL 细节）。
  - 先不建类型，测试预期失败。

- [ ] **Step 2: 最小实现类型与映射**
  - `src/types.ts`：完整接口。
  - `src/event-inbox-row.ts`：`InboxRow` 类型 + `eventEnvelopeToJson`/`jsonToEventEnvelope`（JSON.stringify/parse，不改写 eventId）。
  - `src/errors.ts`：`IngestionInboxError`（`kind: 'invalid_input' | 'database_unavailable' | 'statement_failed'`）+ 稳定消息，不携带 SQL/SQLSTATE。
  - `src/index.ts` 导出公共类型与入口。

- [ ] **Step 3: 确认通过**
  - `pnpm --filter @aurora/ingestion-inbox typecheck` exit 0；
  - `pnpm --filter @aurora/ingestion-inbox test`（types 断言）通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`（新包 eslint 覆盖）、`pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `src/types.ts`、`src/event-inbox-row.ts`、`src/errors.ts`、`test/types.test.ts`。

---

## Task 3: Migration 执行入口与 run-migrations [PG-GATED]

**目标：** 实现 `node-pg-migrate` 程序化执行入口（`run-migrations.ts`），脚本命令 `migrate` 显式执行 Migration；不应用启动自动迁移。

- Consumes: ADR-010 §4.3、规格 §15、`node-pg-migrate` 9.0.0 API。
- Produces: `src/run-migrations.ts`、根 `package.json` scripts 若需。

- [ ] **Step 1: 失败测试**
  - `test/integration/migrations.test.ts`（PG-GATED）：
    - 无 `AURORA_TEST_DATABASE_URL` 时跳过并显式报告（`describe.skipIf(!process.env.AURORA_TEST_DATABASE_URL)`）；
    - 连接目标校验（database name 前缀/隔离 Schema）；
    - 空库执行 `up` → `pgmigrations` 出现记录；
    - 重复 `up` → 无重复执行（版本状态检测）；
    - `down` 后重新 `up` → schema 恢复；
    - 断言 `event_inbox` 表/列/约束/索引存在。
  - 环境不可用时测试跳过，但计划必须包含这些断言。

- [ ] **Step 2: 最小实现 run-migrations**
  - `src/run-migrations.ts` 使用 `node-pg-migrate` 程序化 API（`runner`/`migrate` 调用），从 `AURORA_TEST_DATABASE_URL` 或显式连接配置读取，`direction: 'up'`，默认事务。
  - 根或包 `migrate` 脚本调用它。
  - **PG-GATED**：仅当真实 PostgreSQL 可用时本 Task 的集成测试才执行；环境不可用时记录"未验证"。

- [ ] **Step 3: 确认通过**
  - `AURORA_TEST_DATABASE_URL` 存在时：`pnpm --filter @aurora/ingestion-inbox migrate` 空库 up 成功、版本表存在、重复执行幂等；
  - 环境不可用时：明确记录未执行，不宣称通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-inbox typecheck`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/run-migrations.ts`、`test/integration/migrations.test.ts`。

---

## Task 4: event_inbox 表 Migration（表、约束、索引）[PG-GATED]

**目标：** 编写并应用 `event_inbox` 表 Migration：列、主键、`(project_id, event_id)` 唯一、状态 check、`available_at`/`attempt_count` 约束、最小索引。

- Consumes: 规格 §7/§11/§12、ADR-008 幂等键。
- Produces: `migrations/<timestamp>_event-inbox.ts`。

- [ ] **Step 1: 失败测试**
  - `test/integration/constraints.test.ts`（PG-GATED）：
    - `(project_id, event_id)` 唯一：插入后重复插入被拒或经 `ON CONFLICT` 处理；
    - 不同 project 相同 eventId 可共存；
    - 非法 `state` 被 check 拒绝；
    - `attempt_count < 0` 被拒绝；
    - 索引 `uq_event_inbox_project_event`、`(state, available_at)`、`(received_at)`、`(lease_expires_at)` 存在。

- [ ] **Step 2: 最小实现 Migration**
  - `migrations/<stable-timestamp>_event-inbox.ts`（node-pg-migrate 格式）：
    ```ts
    import type { MigrationBuilder } from 'node-pg-migrate';
    export const shorthands = undefined;
    export const up = (pgm: MigrationBuilder): void => {
      pgm.createTable('event_inbox', {
        id: { type: 'bigserial', primaryKey: true },
        project_id: { type: 'uuid', notNull: true },
        event_id: { type: 'varchar(128)', notNull: true },
        event_type: { type: 'varchar(64)', notNull: true },
        protocol_version: { type: 'integer', notNull: true },
        envelope: { type: 'jsonb', notNull: true },
        request_id: { type: 'varchar(256)' },
        batch_id: { type: 'varchar(256)' },
        batch_index: { type: 'integer' },
        received_at: { type: 'timestamptz', notNull: true },
        state: { type: 'varchar(24)', notNull: true, default: 'pending' },
        available_at: { type: 'timestamptz', notNull: true },
        lease_owner: { type: 'varchar(256)' },
        lease_expires_at: { type: 'timestamptz' },
        attempt_count: { type: 'integer', notNull: true, default: 0 },
        processed_at: { type: 'timestamptz' },
        dead_lettered_at: { type: 'timestamptz' },
        last_error_code: { type: 'varchar(64)' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      });
      pgm.addConstraint('event_inbox', 'uq_event_inbox_project_event', {
        unique: ['project_id', 'event_id'],
      });
      pgm.addConstraint('event_inbox', 'ck_event_inbox_state', {
        check: "state IN ('pending','leased','retry_waiting','processed','dead_lettered')",
      });
      pgm.addConstraint('event_inbox', 'ck_event_inbox_attempt_count', {
        check: 'attempt_count >= 0',
      });
      pgm.createIndex('event_inbox', ['state', 'available_at']);
      pgm.createIndex('event_inbox', ['received_at']);
      pgm.createIndex('event_inbox', ['lease_expires_at']);
    };
    export const down = (pgm: MigrationBuilder): void => {
      pgm.dropTable('event_inbox');
    };
    ```
  - 说明：`available_at` NOT NULL 反映"该记录最早可领取时间"必填语义；`down` 只用于本地测试对称性，生产回滚走向前修复。

- [ ] **Step 3: 确认通过**
  - 真实 PG：空库 `up` 成功；`down`/`up` 对称；约束/索引断言通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-inbox typecheck`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `migrations/<timestamp>_event-inbox.ts`、`test/integration/constraints.test.ts`。

---

## Task 5: 原子批次持久化 Repository（persistBatch）[PG-GATED]

**目标：** 实现 `persistBatch`：事务内参数化批量插入 + `ON CONFLICT (project_id, event_id) DO NOTHING`，区分 `inserted`/`duplicate`，返回可映射到 `IngestionRequestReceipt` 的内部结果；暂时数据库失败返回稳定错误。

- Consumes: 规格 §6/§9/§14、`src/types.ts`、`src/event-inbox-row.ts`、`src/errors.ts`。
- Produces: `src/persist-batch.ts`、`src/index.ts` 导出。

- [ ] **Step 1: 失败测试（单元 + 集成）**
  - `test/persist-batch.unit.test.ts`（ENV-INDEPENDENT）：SQL 构造纯逻辑——批量插入语句包含正确列、`ON CONFLICT DO NOTHING`、`RETURNING` 映射；空输入抛稳定错误；不修改输入。
  - `test/integration/persist-batch.test.ts`（PG-GATED）：
    - 单事件成功 → `inserted`；
    - 同项目同 eventId 再次提交 → `duplicate`，且只一条记录；
    - 不同项目相同 eventId → 两条记录；
    - 混合新事件与重复事件 → 部分 `inserted` 部分 `duplicate`，全部 COMMIT；
    - 事务回滚：让一条插入失败（如非法 project_id 长度/类型）→ 无任何 `accepted` 记录残留；
    - `envelope` 原样保存（反序列化同构）；
    - 表中无 `X-Aurora-Client-Key`/secret/Authorization 字段。

- [ ] **Step 2: 最小实现 persistBatch**
  - `src/persist-batch.ts`：
    ```ts
    import { Pool } from 'pg';

    export async function persistBatch(
      pool: Pool,
      input: PersistIngestionBatchInput,
    ): Promise<PersistIngestionBatchResult> {
      if (input.events.length === 0) throw new IngestionInboxError('invalid_input', 'empty batch');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `INSERT INTO event_inbox
             (project_id, event_id, event_type, protocol_version, envelope, batch_index, received_at, available_at, created_at, updated_at)
           SELECT $1, event_id, event_type, protocol_version, envelope, batch_index, received_at, received_at, now(), now()
           FROM jsonb_to_recordset($2::jsonb) AS x(
             event_id varchar(128), event_type varchar(64), protocol_version integer,
             envelope jsonb, batch_index integer, received_at timestamptz
           )
           ON CONFLICT (project_id, event_id) DO NOTHING
           RETURNING event_id`,
          [input.projectId, JSON.stringify(rows)],
        );
        await client.query('COMMIT');
        // 用 RETURNING 的 event_id 集合 + 输入全集对比映射 inserted/duplicate
        return mapResults(input.events, returnedEventIds);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw toStableError(error);
      } finally {
        client.release();
      }
    }
    ```
  - `toStableError` 把 `pg` 错误映射为 `IngestionInboxError`（`database_unavailable`/`statement_failed`），不泄露 SQL/SQLSTATE/约束名。
  - 说明：`ON CONFLICT` 逐条判断；`RETURNING event_id` 只返回实际插入行，对比输入全集得 `duplicate`。若 `jsonb_to_recordset` 参数化在目标 PG 17 有兼容问题，改逐行 `INSERT ... ON CONFLICT DO NOTHING` 参数化（不拼接），以真实 PG 验证为准。

- [ ] **Step 3: 确认通过**
  - 单元测试（ENV-INDEPENDENT）通过；
  - 真实 PG：集成测试全部通过（幂等/部分成功/回滚/Envelope 保存）。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-inbox typecheck`；`pnpm lint`；`pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `src/persist-batch.ts`、`test/persist-batch.unit.test.ts`、`test/integration/persist-batch.test.ts`。

---

## Task 6: 状态与租约结构约束 [PG-GATED]

**目标：** 验证状态/租约结构性字段约束：`processed`/`dead_lettered` 不可普通领取、租约过期可重投、`available_at` 前不可领取、`attempt_count` 语义。本轮只建结构与约束，不实现 Worker 领取循环。

- Consumes: 规格 §10/§11、ADR-008 租约语义。
- Produces: `test/integration/constraints.test.ts` 扩展（状态转换/租约字段断言）。

- [ ] **Step 1: 失败测试**
  - `constraints.test.ts` 扩展断言：
    - 手工更新 `state='processed'` 后，`persistBatch`/后续查询不得把它当作可领取（本轮通过 SQL 断言 + 明确查询逻辑）；
    - `state='retry_waiting'` 且 `available_at` 在未来时，`available_at <= now()` 查询不返回该记录；
    - `state='leased'` 且 `lease_expires_at` 过期时，`lease_expires_at < now()` 查询返回该记录（可重投）；
    - `state='dead_lettered'` 不进入 `state IN ('pending','retry_waiting')` 查询。

- [ ] **Step 2: 最小实现**
  - 本 Task 主要是约束验证，不改 SQL（结构字段已在 Task 4 建好）；补充明确的状态/租约查询 helper（`src/state-queries.ts`）供测试与未来 Worker 使用：
    ```ts
    export const CLAIMABLE_STATES = ['pending', 'retry_waiting'] as const;
    export function claimableWhereClause(): string {
      return `state IN ('pending','retry_waiting') AND available_at <= now()`;
    }
    ```
  - 这些 helper 是未来 Worker 的结构性前置，不实现领取循环。

- [ ] **Step 3: 确认通过**
  - 真实 PG：状态/租约约束断言通过。

- [ ] **Step 4: 相关回归**
  - 全包 typecheck/lint。

- [ ] **Step 5: 建议提交边界**
  - `src/state-queries.ts`、`test/integration/constraints.test.ts` 扩展。

---

## Task 7: 包入口、Workspace Policy 与安全负例 [ENV-INDEPENDENT]

**目标：** 包入口断言、私有路径负例、Workspace Policy 数据层规则、敏感字段与 SQL 日志扫描。

- Consumes: 规格 §19、Workspace Policy、ESLint。
- Produces: `test/package-entry.test.ts` 扩展、`test/security-negative.test.ts`（ENV-INDEPENDENT）、policy layer 若需。

- [ ] **Step 1: 失败测试**
  - `security-negative.test.ts` 断言：
    - `src/` 不含 `X-Aurora-Client-Key`、`clientKey`、`secret`、`Authorization`、`Cookie` 字段名；
    - SQL 不含字符串插值不可信值（`+ ${`、`` `...${`` 拼接列/值）；
    - 错误类型不含 `SQLSTATE`、约束名、SQL 文本字段。
  - 先不建测试，随后补实现使断言通过。

- [ ] **Step 2: 最小实现**
  - 完善 `package-entry.test.ts`（包根导出、私有路径负例）；
  - `security-negative.test.ts`；
  - 若 `aurora.layer: data` 需 Workspace Policy 规则，在 `tooling/workspace-policy/src/graph.ts` 增加 `data` 层（只允许依赖 `protocol`），并同步 `tooling/workspace-policy/test/dependency-policy.test.ts`。

- [ ] **Step 3: 确认通过**
  - `pnpm check:boundaries` exit 0；`pnpm lint` exit 0；安全负例测试通过。

- [ ] **Step 4: 相关回归**
  - 全包 typecheck；`pnpm --filter @aurora/event-schema test` 不受影响。

- [ ] **Step 5: 建议提交边界**
  - `test/security-negative.test.ts`、policy 扩展、`package-entry.test.ts` 扩展。

---

## Task 8: 文档、ADR 证据与根级门禁 [ENV-INDEPENDENT / 结果门控]

**目标：** README、formalization-readiness、ADR 证据；根级完整质量门禁；依据真实 PostgreSQL 可用性决定实施状态标记。

- Consumes: 全部 Task 产物、规格、ADR-008/010。
- Produces: `packages/ingestion-inbox/README.md`、`docs/architecture/formalization-readiness.md` 更新、ADR 追加记录。

- [ ] **Step 1: 失败测试（文档契约先行）**
  - `test/documentation-contract.test.ts`（ENV-INDEPENDENT）：README 含 `## 模块定位`、`## 职责`、`## 非职责`、`## 命令`、`AURORA_TEST_DATABASE_URL`；README 不宣称 Migration 已验证（真实 PG 可用前）。

- [ ] **Step 2: 最小实现文档**
  - 创建 `packages/ingestion-inbox/README.md`（模块定位/职责/非职责/命令/测试变量/真实 PG 门禁说明）。
  - 更新 `docs/architecture/formalization-readiness.md`：数据接入链路状态（Inbox 数据模型；真实 PG 可用性决定 `implemented` vs `not-started`）。
  - 真实实现并验证后，ADR-010 追加 Inbox 实施证据、实施状态更新 `in-progress`；ADR-008 追加 Inbox 数据模型实施证据。**真实 PG 验证不可用时，不追加实施证据、不更新 ADR 实施状态。**

- [ ] **Step 3: 确认通过**
  - 文档契约测试通过；`pnpm format:check`、`git diff --check`。

- [ ] **Step 4: 相关回归**
  - 全仓 `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:coverage`、`pnpm check:boundaries`、`pnpm build`、`pnpm check:ci`、`git diff --check`（真实 PG 可用时再加 `test:integration`）。

- [ ] **Step 5: 建议提交边界**
  - README、formalization-readiness、ADR 追加记录（若真实实现）。

---

## 完成报告要求

实施完成并全部门禁通过后，报告必须包含：完成的 Task（ENV-INDEPENDENT vs PG-GATED 区分）；创建和修改的文件；`event_inbox` 表结构；状态模型（pending/leased/retry_waiting/processed/dead_lettered）；幂等与部分成功（`(project_id, event_id)` + `ON CONFLICT`）；Repository `persistBatch` 公共 API；Migration 验证结果（真实 PG 空库 up/版本检测/down-up）；真实 PostgreSQL 17 测试结果（连接版本、约束、并发、回滚）**或明确声明真实 PG 不可用、未验证**；覆盖率与全仓门禁退出码；使用的实际依赖版本（`pg`/`node-pg-migrate`/`@types/pg`）；与计划的偏差；ADR 状态（ADR-010/008/009/005）；Git 状态；剩余模块统计；建议提交边界；并明确说明：未实现 Fastify/接入服务/Worker/CI/RDS/IaC，未规划或实施下一模块，未提交或推送，且**真实 PostgreSQL 不可用时不得把实现状态标为 implemented、不得用 mock 冒充真实数据库证据**。
