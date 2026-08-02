# 客户端上报凭证存储与验证第一增量 (客户端凭证数据模型、摘要校验与请求授权第一增量) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/ingestion-credentials`（包名 `@aurora/ingestion-credentials`）冻结并实施客户端上报凭证存储与验证第一增量：密钥格式解析（`aurora_ingest_<keyId>_<secret>`）、SHA-256 secret 摘要与 constant-time 比较、`ingestion_client_credentials`/`origins`/`environments` 追加 Migration、active/disabled/revoked 状态与动态过期、有效 Origin/environment 策略快照、`verifyIngestionCredential` PostgreSQL 验证与稳定结果，并在 `apps/ingestion-api` 集成私有 `postgres-request-authorizer` adapter（复用已拥有 Pool，映射到 `IngestionRequestAuthorizer`，HTTP 401/403/503 语义不变）。这是 ADR-013 的第一增量；**不**实现凭证创建/轮换/撤销管理 API、平台页面或轮换工作流。

**Architecture:** 独立凭证数据包 `@aurora/ingestion-credentials`（`aurora.layer: data`），只接受外部 `pool: Pool | PoolClient`，不创建/关闭 Pool。密钥解析与摘要为纯函数；`verifyIngestionCredential` 固定验证顺序：解析密钥 → 校验 environment → 规范化 Origin/确认缺失 → 按 keyId 查询凭证及策略 → 计算候选 digest → `timingSafeEqual` → 检查 status → 数据库时间检查 expires_at → 校验 environment → 校验 Origin/allow_non_browser → 返回 authorized。数据库错误映射 `temporarily_unavailable`。`apps/ingestion-api` 私有 adapter 把凭证包稳定结果映射到 `IngestionRequestAuthorizer` 结果（`string|null` ↔ `string|undefined`），composition root 复用已拥有 Pool 构造真实 authorizer，`buildIngestionApi` 仍支持注入 fake authorizer。

**Tech Stack:** Node.js ≥24.18.0、TypeScript 6.0.3、Vitest 4.1.10、pnpm 11.17.0、PostgreSQL 17 + `pg` 8.22.0 + `node-pg-migrate` 9.0.0（复用 ADR-010 工具链）、`@aurora/event-schema`（仅包根，如需）。Node 内置 `node:crypto`（`createHash`/`timingSafeEqual`）。不引入 bcrypt/scrypt/Argon2/PBKDF2/pepper/KMS/HSM。

**Plan status:** ready-for-implementation（本消息已预先批准无歧义派生的规格与计划；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 只修改 `packages/ingestion-credentials`（新增 `src/*.ts`、`migrations/*.ts`、`test/*.test.ts`、`test/integration/*.test.ts`、`README.md`、`package.json`、`tsconfig*.json`、`vitest.config.ts`）、`apps/ingestion-api`（新增 `src/postgres-request-authorizer.ts`、`src/start.ts` 接入真实 authorizer、`package.json` 增加包根依赖、新增 HTTP 集成测试）与相关索引文档（formalization-readiness、AGENTS.md、AURORA_RULES.md、docs/README.md、根 package.json format/lint 清单）。
- 完全遵守 ADR-009 密钥格式 `aurora_ingest_<keyId>_<secret>`、Header、Origin/environment 规则与 HTTP 状态映射；**不修改** `X-Aurora-Client-Key`/`X-Aurora-Environment`/OpenAPI 状态码/ingestion-api 公开 HTTP 语义。
- 不创建用户身份、Session 或管理平台认证；不设计凭证管理 API；不实现密钥轮换工作流；不把完整密钥或 secret 写入数据库。
- raw secret 永不持久化；数据库只存 SHA-256 摘要（bytea 固定 32 字节）；不存可逆密文；不为 secret_digest 创建索引。
- 使用 `timingSafeEqual`；不存在 keyId 时也执行 dummy digest 比较。
- 状态集合只含 `active`/`disabled`/`revoked`；`expired` 由 `expires_at <= database_now` 动态推导。
- Origin 使用规范化后的完整 HTTP(S) origin 精确匹配；禁止 wildcard/正则/子串；environment 精确区分大小写匹配；缺失 Origin 只在 `allow_non_browser=true` 时允许。
- 不修改 Inbox ACK、event-schema、Worker；凭证包不依赖 service 应用；service 只通过凭证包根导入。
- 真实 PostgreSQL 集成测试使用 `AURORA_TEST_DATABASE_URL`；确认目标是测试数据库（`aurora_inbox_test` 前缀）；独立 Schema/命名空间隔离；清理失败显式报错；禁止 SQLite/mock/PGlite 替代证据。
- 覆盖 率 lines ≥85 / branches ≥80 / functions ≥85 / statements ≥85。
- 测试 fixture 可生成满足格式的密钥，但生成器不得从包根导出、不作为生产公共 API。
- ADR 状态：ADR-013 `accepted / implemented`；ADR-009/011 `accepted / in-progress` 不变；ADR-010 `accepted / implemented` 不变。

---

## 文件树

```text
packages/ingestion-credentials/
├── package.json                         # Create：@aurora/ingestion-credentials，private，type module，Node 24，aurora.layer: data
├── tsconfig.json                        # Create：extends ../../tsconfig.base.json，noEmit，include src/test/migrations/vitest.config.ts
├── tsconfig.build.json                  # Create：emit dist，include src，exclude test/migrations
├── vitest.config.ts                     # Create：alias @aurora/event-schema，include test/**/*.test.ts，coverage thresholds
├── README.md                            # Create：模块职责/非职责/接口/命令/文档契约
├── migrations/
│   └── <timestamp>_ingestion-client-credentials.ts   # Create：三表追加 Migration
└── src/
    ├── index.ts                         # Create：包根公共出口
    ├── client-key.ts                    # Create：parseIngestionClientKey（密钥格式解析）
    ├── digest.ts                        # Create：sha256Digest / timingSafeDigestEqual / DUMMY_DIGEST
    ├── origin.ts                        # Create：normalizeOrigin（WHATWG URL 规范化）
    ├── verification-types.ts            # Create：VerifyIngestionCredentialInput / IngestionCredentialVerificationResult
    ├── verification.ts                  # Create：verifyIngestionCredential（查询 + 固定验证顺序）
    └── create-fixture.ts                # Create：仅测试使用的 fixture helper（从包根不导出，src 内部但仍只被 test 引用）
└── test/
    ├── client-key.test.ts               # Create [ENV-INDEPENDENT]：密钥格式解析
    ├── digest.test.ts                   # Create [ENV-INDEPENDENT]：摘要与 constant-time 比较
    ├── origin.test.ts                   # Create [ENV-INDEPENDENT]：Origin 规范化
    ├── verification-types.test.ts       # Create [ENV-INDEPENDENT]：结果判别
    ├── package-entry.test.ts            # Create [ENV-INDEPENDENT]：包根出口 + 私有路径负例 + manifest
    ├── security-negative.test.ts        # Create [ENV-INDEPENDENT]：敏感信息扫描
    ├── documentation-contract.test.ts   # Create [ENV-INDEPENDENT]：README/规格契约
    └── integration/
        ├── helpers.ts                   # Create [PG]：testDatabaseUrl/assertIsTestDatabase/createTestPool/migrationsUp/clean
        ├── credential-schema.test.ts    # Create [PG-GATED]：Migration/表/约束/索引/raw secret 不存在
        ├── credential-verify.test.ts    # Create [PG-GATED]：authorized/未知 key/错误 secret/disabled/revoked/expired/Origin/environment/数据库故障/跨项目
        └── credential-http.test.ts      # Create [PG-GATED]：ingestion-api 真实 authorizer HTTP 401/403/503 + accepted/duplicate 回归

apps/ingestion-api/
├── src/postgres-request-authorizer.ts   # Create：私有 adapter（凭证包 → IngestionRequestAuthorizer）
├── src/start.ts                         # Modify：composition root 构造真实 authorizer（复用已拥有 Pool）
└── test/integration/
    ├── credential-http-auth.test.ts     # Create [PG-GATED]：真实 authorizer HTTP 集成
    └── loopback.test.ts                 # Modify：fake authorizer 兼容保持
```

每个文件单一职责；不创建凭证管理 API、轮换工作流、Session 或平台内容。

---

## Consumes / Produces 总览

- **Consumes**：`docs/security/ingestion-client-credential-storage-and-verification.md`（approved 规格）、`docs/adr/ADR-013-ingestion-client-credential-storage-and-verification.md`（accepted）、`docs/adr/ADR-009-ingestion-transport-and-client-credential.md`、`docs/api/ingestion-openapi.md`、`docs/architecture/ingestion-http-service.md`、`apps/ingestion-api` 的 `access-policy.ts`（`IngestionRequestAuthorizer`）、`@aurora/ingestion-inbox` 包根（仅 ingest-api 依赖，不在凭证包）、ADR-010 工具链。
- **Produces**：`@aurora/ingestion-credentials` 包（解析/摘要/查询验证/Origin 规范化/稳定结果/Migration）、`apps/ingestion-api` 私有 authorizer adapter 与 composition root 集成、真实 PostgreSQL 与 HTTP 集成测试、README、ADR-013 实施证据、formalization-readiness 更新。

---

## Task 1: 包脚手架与包边界 [ENV-INDEPENDENT]

**目标：** 创建 `packages/ingestion-credentials` 目录、`package.json`、`tsconfig*.json`、`vitest.config.ts`、`src/index.ts` 最小入口；包名、layer、exports、engines 正确；不引入任何密码型哈希库或管理框架。

- Consumes: 规格 §5/§6、ADR-013、`@aurora/ingestion-inbox` 包结构样式。
- Produces: `package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`src/index.ts`。

- [ ] **Step 1: 失败测试**
  - `test/package-entry.test.ts`：
    - manifest `name` 为 `@aurora/ingestion-credentials`、`private: true`、`type: module`、`engines.node` 为 `>=24.18.0 <25`、`aurora.layer` 为 `data`；
    - exports 只含 `"."`（`types`/`import` 指向 `./dist/index.js`）；`files` 含 `dist`；
    - 依赖含 `pg`（8.22.0），不含 `bcrypt`/`scrypt`/`argon2`/`pbkdf2`/`@aws-sdk/*`/`kms`/`hsm`；
    - 不导出 `create-fixture`（包根出口不含 fixture helper）。

- [ ] **Step 2: 最小实现**
  - 创建 `package.json`：
    ```json
    {
      "name": "@aurora/ingestion-credentials",
      "version": "0.0.0",
      "private": true,
      "type": "module",
      "description": "Aurora data ingestion client reporting credential storage and verification",
      "engines": { "node": ">=24.18.0 <25" },
      "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
      "files": ["dist"],
      "scripts": {
        "build": "tsc -p tsconfig.build.json",
        "typecheck": "tsc -p tsconfig.json --noEmit",
        "test": "vitest run --exclude test/integration/**",
        "test:integration": "vitest run test/integration --no-file-parallelism",
        "test:coverage": "vitest run --coverage --no-file-parallelism"
      },
      "dependencies": { "pg": "8.22.0" },
      "devDependencies": {
        "@types/node": "24.13.3",
        "@types/pg": "8.20.0",
        "@vitest/coverage-v8": "4.1.10",
        "node-pg-migrate": "9.0.0",
        "typescript": "6.0.3",
        "vitest": "4.1.10"
      },
      "aurora": { "layer": "data" }
    }
    ```
  - 创建 `tsconfig.json`（extends `../../tsconfig.base.json`，`noEmit: true`，`types: ["node", "vitest/globals"]`，include `src/**/*.ts`、`test/**/*.ts`、`migrations/**/*.ts`、`vitest.config.ts`）；
  - 创建 `tsconfig.build.json`（extends `./tsconfig.json`，`noEmit: false`，`outDir: dist`，`declaration: true`，include 仅 `src/**/*.ts`）；
  - 创建 `vitest.config.ts`（include `test/**/*.test.ts`，`testTimeout: 30_000`，coverage provider v8，include `src/**/*.ts`，exclude `src/index.ts`、`src/create-fixture.ts`，thresholds 85/80/85/85）；
  - 创建 `src/index.ts`（随 Task 逐项追加导出）。

- [ ] **Step 3: 确认通过**
  - `pnpm --filter @aurora/ingestion-credentials typecheck` exit 0；`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`；`pnpm check:boundaries`（确认 `data` 层允许零 protocol 依赖——本包不依赖 event-schema 除非需要）。

- [ ] **Step 5: 建议提交边界**
  - `packages/ingestion-credentials/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`src/index.ts`、`test/package-entry.test.ts`；根 `package.json` format/lint 清单追加本包。

---

## Task 2: 密钥格式解析 [ENV-INDEPENDENT]

**目标：** 实现 `parseIngestionClientKey`：严格解析 `aurora_ingest_<keyId>_<secret>`；keyId 16 字节 base64url（22 字符）、secret 32 字节 base64url（43 字符）；拒绝 padding/空格/大小写归一化/额外段。

- Consumes: 规格 §6、ADR-009 密钥格式。
- Produces: `src/client-key.ts`、`test/client-key.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/client-key.test.ts`：
    - 合法密钥解析出 keyId/secret 且各自解码后字节数正确；
    - 错误前缀（非 `aurora_ingest_`）→ 失败；
    - 缺失段（少于三段）→ 失败；
    - 多余段（四段）→ 失败；
    - keyId 长度错误（21/23 字符）→ 失败；
    - secret 长度错误（42/44 字符）→ 失败；
    - 非 base64url 字符（`+`/`/`/`=`/空格）→ 失败；
    - padding（`=` 结尾）→ 失败；
    - 大小写不被归一化（`A` 与 `a` 视为不同 → 解码结果不同或格式不同）；
    - 不修改输入字符串。

- [ ] **Step 2: 最小实现**
  - `src/client-key.ts`：
    ```ts
    export const KEY_ID_BYTES = 16;
    export const SECRET_BYTES = 32;
    export const KEY_ID_LENGTH = 22;
    export const SECRET_LENGTH = 43;
    export interface ParsedClientKey { readonly keyId: string; readonly secret: string; }
    export function parseIngestionClientKey(clientKey: string): ParsedClientKey | null;
    ```
    - 用正则 `^aurora_ingest_([A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{43})$` 匹配；再用 base64url 解码校验字节数（16/32）与严格字符集；失败返回 `null`。
    - 不导出生成器（fixture 生成器在 Task 8）。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/client-key.ts`、`test/client-key.test.ts`、`src/index.ts`（导出解析）。

---

## Task 3: digest 与 constant-time 比较 [ENV-INDEPENDENT]

**目标：** 实现 `sha256Digest`、`timingSafeDigestEqual`、固定 `DUMMY_DIGEST`（32 字节）；摘要输入为解码后的 32 字节 secret；比较使用 `crypto.timingSafeEqual`。

- Consumes: 规格 §7/§8。
- Produces: `src/digest.ts`、`test/digest.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/digest.test.ts`：
    - `sha256Digest(secretBytes)` 返回 32 字节 Buffer；
    - 相同 secret → 相同 digest；
    - 不同 secret → 不同 digest；
    - `timingSafeDigestEqual(a, b)`：相等 true、不等 false、长度不同不抛错（先比长度）；
    - `DUMMY_DIGEST` 固定 32 字节；
    - 使用 `crypto.timingSafeEqual`（实现内断言或代码审查）。

- [ ] **Step 2: 最小实现**
  - `src/digest.ts`：
    ```ts
    import { createHash, timingSafeEqual } from 'node:crypto';
    export const DUMMY_DIGEST = Buffer.alloc(32); // 固定 dummy（全零 32 字节）
    export function sha256Digest(secretBytes: Uint8Array): Buffer;
    export function timingSafeDigestEqual(a: Uint8Array, b: Uint8Array): boolean;
    ```
    - `sha256Digest`：`createHash('sha256').update(secretBytes).digest()`；
    - `timingSafeDigestEqual`：`a.length !== b.length ? false : timingSafeEqual(a, b)`。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/digest.ts`、`test/digest.test.ts`、`src/index.ts`（导出摘要）。

---

## Task 4: Origin 规范化 [ENV-INDEPENDENT]

**目标：** 实现 `normalizeOrigin`：WHATWG URL；只允许 http/https；必须存在 host；禁止 userinfo/query/fragment；path 空或 `/`；默认端口折叠；返回 `URL.origin`；拒绝 `null`/wildcard/非 origin。

- Consumes: 规格 §11。
- Produces: `src/origin.ts`、`test/origin.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/origin.test.ts`：
    - `https://example.com` → `https://example.com`；
    - `https://example.com/` → `https://example.com`；
    - `https://example.com:443` → `https://example.com`（默认端口折叠）；
    - `http://example.com:80` → `http://example.com`；
    - 拒绝 `https://user:pass@example.com`（userinfo）；
    - 拒绝 `https://example.com/path`；
    - 拒绝 `https://example.com?q=1`；
    - 拒绝 `https://example.com#frag`；
    - 拒绝 `ftp://example.com`、`file:///tmp`；
    - 拒绝 `null`、`*`、空字符串、非字符串输入；
    - 拒绝缺少 host 的 URL（如 `https:///path`）；
    - 输入 `unknown` 非字符串 → 返回 `null`。

- [ ] **Step 2: 最小实现**
  - `src/origin.ts`：
    ```ts
    export function normalizeOrigin(input: unknown): string | null;
    ```
    - 非 string → `null`；`new URL(input)` try/catch → `null`；
    - 校验 `protocol === 'http:' || 'https:'`；`username/password` 非空 → `null`；`search !== ''` → `null`；`hash !== ''` → `null`；`pathname` 非 `''` 且非 `'/'` → `null`；`host === ''` → `null`；
    - 返回 `url.origin`（WHATWG 已折叠默认端口）。
    - 不读取网络/DNS。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/origin.ts`、`test/origin.test.ts`、`src/index.ts`（导出 Origin 规范化）。

---

## Task 5: 验证类型与稳定结果 [ENV-INDEPENDENT]

**目标：** 冻结 `VerifyIngestionCredentialInput` 与 `IngestionCredentialVerificationResult` 判别联合。

- Consumes: 规格 §12。
- Produces: `src/verification-types.ts`、`test/verification-types.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/verification-types.test.ts`：
    - 输入含 `clientKey`、`environment`、`origin: string | null`；
    - 判别五态结果（authorized{projectId, allowedOrigin: string|null} / unauthenticated / origin_forbidden / environment_forbidden / temporarily_unavailable）；
    - authorized 的 `allowedOrigin` 可为 `null`。

- [ ] **Step 2: 最小实现**
  - `src/verification-types.ts`：接口与判别联合（与规格 §12 完全一致）。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/verification-types.ts`、`test/verification-types.test.ts`、`src/index.ts`（导出类型）。

---

## Task 6: 数据库 Migration [PG-GATED]

**目标：** 追加 Migration 创建 `ingestion_client_credentials`、`ingestion_client_credential_origins`、`ingestion_client_credential_environments`；约束与索引；不编辑已有 Migration。

- Consumes: 规格 §10、ADR-010（node-pg-migrate）。
- Produces: `migrations/<timestamp>_ingestion-client-credentials.ts`、`test/integration/credential-schema.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/integration/credential-schema.test.ts`（`describe.skipIf(!process.env.AURORA_TEST_DATABASE_URL)`）：
    - 空库执行全部 Migration → 三表存在、列存在；
    - `key_id` 唯一：重复插入被拒；
    - `secret_digest` 长度约束：`octet_length(secret_digest) = 32`；
    - status check：`'active'`/`'disabled'`/`'revoked'` 合法，`'expired'`/`'pending'` 被拒；
    - `(credential_id, origin)` 唯一；`(credential_id, environment)` 唯一；
    - `allow_non_browser` 默认 false；
    - `expires_at` 可空；
    - raw secret 字段不存在（查询列名 `secret`/`raw_key`/`client_key` → 无）；
    - 索引：unique key_id 存在；secret_digest 无索引（`pg_indexes` 不含 secret_digest）；
    - 清理。

- [ ] **Step 2: 最小实现**
  - `migrations/<timestamp>_ingestion-client-credentials.ts`：
    ```ts
    export const up = (pgm) => {
      pgm.createTable('ingestion_client_credentials', {
        id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
        project_id: { type: 'uuid', notNull: true },
        key_id: { type: 'varchar(22)', notNull: true, unique: true },
        secret_digest: { type: 'bytea', notNull: true },
        status: { type: 'varchar', notNull: true },
        allow_non_browser: { type: 'boolean', notNull: true, default: false },
        expires_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      });
      pgm.addConstraint('ingestion_client_credentials', 'ck_icc_status', {
        check: "status IN ('active','disabled','revoked')",
      });
      pgm.addConstraint('ingestion_client_credentials', 'ck_icc_digest_length', {
        check: 'octet_length(secret_digest) = 32',
      });
      pgm.createIndex('ingestion_client_credentials', 'project_id');
      // 按需评估 expires_at 索引：第一增量不建（避免无证据索引）。

      pgm.createTable('ingestion_client_credential_origins', {
        credential_id: { type: 'uuid', notNull: true, references: 'ingestion_client_credentials' },
        origin: { type: 'varchar', notNull: true },
      });
      pgm.addConstraint('ingestion_client_credential_origins', 'uq_icco_cred_origin', {
        unique: ['credential_id', 'origin'],
      });

      pgm.createTable('ingestion_client_credential_environments', {
        credential_id: { type: 'uuid', notNull: true, references: 'ingestion_client_credentials' },
        environment: { type: 'varchar', notNull: true },
      });
      pgm.addConstraint('ingestion_client_credential_environments', 'uq_icce_cred_env', {
        unique: ['credential_id', 'environment'],
      });
    };
    export const down = (pgm) => {
      pgm.dropTable('ingestion_client_credential_environments');
      pgm.dropTable('ingestion_client_credential_origins');
      pgm.dropTable('ingestion_client_credentials');
    };
    ```

- [ ] **Step 3: 确认通过**
  - 真实 PG：空库 Migration、约束负例被拒、索引断言。

- [ ] **Step 4: 相关回归**
  - `typecheck`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `migrations/<timestamp>_ingestion-client-credentials.ts`、`test/integration/credential-schema.test.ts`。

---

## Task 7: verifyIngestionCredential（查询 + 固定验证顺序）[PG-GATED]

**目标：** 实现 `verifyIngestionCredential(pool, input)`：固定顺序（解析密钥 → 校验 environment → 规范化 Origin/确认缺失 → 按 keyId 查询凭证及策略 → 计算候选 digest → `timingSafeEqual` → status → 数据库时间 expires_at → environment → Origin/allow_non_browser → authorized）。数据库错误 → `temporarily_unavailable`。

- Consumes: 规格 §8/§9/§12/§13、Task 2-6 产物。
- Produces: `src/verification.ts`、`test/integration/credential-verify.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/integration/credential-verify.test.ts`（真实 PG；fixture 插入 digest 与策略记录）：
    - 合法凭证 + 正确 secret + Origin 允许 + environment 允许 → `authorized{projectId, allowedOrigin}`；
    - 未知 key → `unauthenticated`（且内部执行 dummy 比较）；
    - 错误 secret → `unauthenticated`；
    - disabled/revoked → `unauthenticated`；
    - expired（`expires_at` 过去）→ `unauthenticated`；
    - Origin allowed（精确匹配）→ authorized；Origin 不在 allowlist → `origin_forbidden`；
    - 缺失 Origin + allowNonBrowser=false → `origin_forbidden`；+ allowNonBrowser=true → authorized（有 environment 匹配时）；
    - environment 在集合 → authorized；不在 → `environment_forbidden`；
    - 数据库故障（连接错误/语句失败）→ `temporarily_unavailable`（不返回 unauthenticated/authorized）；
    - 不同 project 的凭证互不影响；
    - 格式非法密钥 → `unauthenticated`；
    - 不修改输入。

- [ ] **Step 2: 最小实现**
  - `src/verification.ts`：
    ```ts
    export async function verifyIngestionCredential(
      pool: Pool | PoolClient,
      input: VerifyIngestionCredentialInput,
    ): Promise<IngestionCredentialVerificationResult>;
    ```
    - 1) `parseIngestionClientKey` → null → `unauthenticated`；
    - 2) `input.environment` 空或超长（常量上限）→ `unauthenticated`；
    - 3) `input.origin === null ? null : normalizeOrigin(input.origin)`（非法 origin → 视为 origin_forbidden 或 unauthenticated，见规格：origin 非法拒绝）；
    - 4) `SELECT c.id, c.project_id, c.secret_digest, c.status, c.allow_non_browser, c.expires_at FROM ingestion_client_credentials c WHERE c.key_id = $1`（参数化）；
    - 无行 → `timingSafeDigestEqual(candidateDigest, DUMMY_DIGEST)` 后返回 `unauthenticated`；
    - 5) `candidateDigest = sha256Digest(secretBytes)`；
    - 6) `timingSafeDigestEqual(candidateDigest, row.secret_digest)` 为 false → `unauthenticated`；
    - 7) status 非 active → `unauthenticated`；
    - 8) `expires_at !== null && expires_at <= now()`（SQL 用 `now()`）→ `unauthenticated`；
    - 9) 查询 `ingestion_client_credential_environments`：若集合非空且 environment 不在集合 → `environment_forbidden`；
    - 10) 查询 `ingestion_client_credential_origins`：若 origin 存在 → 不在集合 → `origin_forbidden`；若 origin 缺失 → `allow_non_browser` false → `origin_forbidden`；
    - 11) 返回 `authorized{projectId, allowedOrigin: origin}`；
    - 数据库错误 catch → `temporarily_unavailable`（不泄露细节）。

- [ ] **Step 3: 确认通过**
  - 真实 PG 全部验证用例通过。

- [ ] **Step 4: 相关回归**
  - `typecheck`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/verification.ts`、`test/integration/credential-verify.test.ts`、`src/index.ts`（导出验证）。

---

## Task 8: fixture helper 与敏感信息扫描 [ENV-INDEPENDENT]

**目标：** 提供测试专用 fixture helper（生成满足格式的密钥与插入 digest/策略记录），但**不**从包根导出；敏感信息扫描。

- Consumes: 规格 §7/§16/§24。
- Produces: `src/create-fixture.ts`、`test/security-negative.test.ts`、`test/package-entry.test.ts` 扩展。

- [ ] **Step 1: 失败测试**
  - `test/security-negative.test.ts`：
    - `src/` 与 `test/` 不含 `console.log` 原始 key/secret/digest；
    - 不含 `bcrypt`/`scrypt`/`argon2`/`pbkdf2`/`kms` 引用；
    - 不含 SQLSTATE/constraint 名泄漏模式；
    - 不含数据库 URL（`postgres://...:pass@`）；
  - `test/package-entry.test.ts` 扩展：包根出口不含 `create-fixture`/`generateClientKey`。

- [ ] **Step 2: 最小实现**
  - `src/create-fixture.ts`：`generateFixtureClientKey()`（用 `node:crypto.randomBytes` + base64url 生成合法密钥）、`insertCredentialFixture(pool, {projectId, keyId, secret, status, allowNonBrowser, expiresAt, origins, environments})`（插入 digest 与策略）。仅被 `test/` 引用；不 export 到包根。
  - `security-negative.test.ts` 完善。

- [ ] **Step 3: 确认通过**
  - `pnpm check:boundaries` exit 0；`pnpm lint` exit 0；负例测试通过。

- [ ] **Step 4: 相关回归**
  - 全包 `typecheck`。

- [ ] **Step 5: 建议提交边界**
  - `src/create-fixture.ts`、`test/security-negative.test.ts`、`test/package-entry.test.ts`。

---

## Task 9: 包根出口、README 与文档契约 [ENV-INDEPENDENT]

**目标：** `src/index.ts` 导出全部公共 API；README；文档契约测试。

- Consumes: 规格 §12/§24。
- Produces: `src/index.ts` 完善、`README.md`、`test/documentation-contract.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/documentation-contract.test.ts`：README 含模块职责/非职责、`AURORA_TEST_DATABASE_URL`、密钥格式、不宣称凭证管理 API 已实现；规格含 `implementation-status` 与 `verifyIngestionCredential`。

- [ ] **Step 2: 最小实现**
  - `index.ts` 导出：`parseIngestionClientKey`、`sha256Digest`、`timingSafeDigestEqual`、`DUMMY_DIGEST`、`normalizeOrigin`、`verifyIngestionCredential`、`VerifyIngestionCredentialInput`、`IngestionCredentialVerificationResult` 及常量；
  - `README.md` 完整。

- [ ] **Step 3: 确认通过**
  - 文档契约测试通过；`pnpm format:check`（本包文件）。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`；`pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `src/index.ts`、`README.md`、`test/documentation-contract.test.ts`。

---

## Task 10: ingestion-api 私有 adapter 与 composition root 集成 [ENV-INDEPENDENT + PG-GATED]

**目标：** 创建 `apps/ingestion-api/src/postgres-request-authorizer.ts`（凭证包 → `IngestionRequestAuthorizer` 映射，`string|null` ↔ `string|undefined`）；`startIngestionApi` composition root 构造真实 authorizer（复用已拥有 Pool）；`buildIngestionApi` 仍支持注入 fake。

- Consumes: 规格 §15/§16、`apps/ingestion-api` 的 `access-policy.ts`/`start.ts`/`app.ts`。
- Produces: `src/postgres-request-authorizer.ts`、`src/start.ts` 修改、`test/integration/credential-http-auth.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/integration/credential-http-auth.test.ts`（真实 PG，用 `buildIngestionApi` + `postgres-request-authorizer` adapter + 真实 Inbox）：
    - 合法凭证 + 合法 Origin/environment → POST 成功，Inbox 出现记录；
    - 错误 secret / 未知 key / disabled / revoked / expired → 401；
    - Origin 不允许 / 缺失 Origin 且 allowNonBrowser=false → 403；
    - environment 不允许 → 403；
    - 数据库不可用（临时破坏连接或注入失败）→ 503；
    - 未授权请求不调用 Inbox（Inbox 记录数不变）；
    - accepted 只在 Inbox COMMIT 后返回（回归）；
    - `buildIngestionApi` 注入 fake authorizer 的既有测试仍通过（回归）。
  - `startIngestionApi` 测试：只使用一个 Pool、shutdown 只关闭一次 Pool（复用 loopback 冒烟）。

- [ ] **Step 2: 最小实现**
  - `src/postgres-request-authorizer.ts`：
    ```ts
    import { verifyIngestionCredential } from '@aurora/ingestion-credentials';
    import type { IngestionRequestAuthorizer, AuthorizeIngestionRequestInput, AuthorizeIngestionRequestResult } from './access-policy.js';
    export function createPostgresRequestAuthorizer(pool: Pool): IngestionRequestAuthorizer {
      return {
        async authorize(input: AuthorizeIngestionRequestInput): Promise<AuthorizeIngestionRequestResult> {
          const result = await verifyIngestionCredential(pool, {
            clientKey: input.clientKey,
            environment: input.environment,
            origin: input.origin ?? null,
          });
          switch (result.status) {
            case 'authorized': return { status: 'authorized', projectId: result.projectId, ...(result.allowedOrigin === null ? {} : { allowedOrigin: result.allowedOrigin }) };
            case 'unauthenticated': return { status: 'unauthenticated' };
            case 'origin_forbidden': return { status: 'originForbidden' };
            case 'environment_forbidden': return { status: 'environmentForbidden' };
            case 'temporarily_unavailable': return { status: 'temporarilyUnavailable' };
          }
        },
      };
    }
    ```
  - `src/start.ts`：composition root 在创建 Pool 后 `const authorizer = createPostgresRequestAuthorizer(pool)`；`buildIngestionApi({ config, pool, authorizer, admissionPolicy, requestIdProvider })`；不再接受外部 authorizer（或保留可选注入以兼容测试——见偏差处理）。生产不再依赖允许全部。
  - `apps/ingestion-api/package.json`：增加 `@aurora/ingestion-credentials` 依赖。

- [ ] **Step 3: 确认通过**
  - 真实 PG HTTP 401/403/503 与 accepted 回归通过；loopback 冒烟（单个 Pool、shutdown 一次）通过。

- [ ] **Step 4: 相关回归**
  - `apps/ingestion-api` 全量 `test`（含 fake authorizer 兼容）；`pnpm lint`；`pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `src/postgres-request-authorizer.ts`、`src/start.ts`、`apps/ingestion-api/package.json`、`test/integration/credential-http-auth.test.ts`。

---

## Task 11: 覆盖率、根级门禁、文档与 ADR 证据 [ENV-INDEPENDENT / 结果门控]

**目标：** 覆盖率 ≥ lines 85 / branches 80 / functions 85 / statements 85；README、formalization-readiness、ADR-013 证据、ADR 索引同步；根级完整质量门禁。

- Consumes: 全部 Task 产物、规格、ADR-013。
- Produces: `README.md` 更新、`docs/architecture/formalization-readiness.md` 更新、ADR-013 追加记录、`docs/adr/README.md` 状态同步、`docs/README.md`、`AGENTS.md`/`AURORA_RULES.md` 同步、根 `package.json` format/lint 清单。

- [ ] **Step 1: 失败测试（文档契约先行）**
  - `test/documentation-contract.test.ts`：README 含凭证包职责/非职责、不宣称凭证管理 API 已实现。

- [ ] **Step 2: 最小实现文档**
  - 更新 `README.md`；
  - 更新 `formalization-readiness.md`：credential schema implemented、credential verification implemented、credential lifecycle management not-started、完整 ingestion production readiness in-progress；
  - ADR-013 追加实施证据；ADR 索引同步 ADR-013 `implemented`；
  - `AGENTS.md`/`AURORA_RULES.md` 状态同步；`docs/README.md` 若需要登记新正式文档。

- [ ] **Step 3: 确认通过**
  - 文档契约测试通过；`pnpm format:check`、`git diff --check`。

- [ ] **Step 4: 相关回归**
  - 全仓：`pnpm install --frozen-lockfile`、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:coverage`、`pnpm check:boundaries`、`pnpm build`、`pnpm check:ci` 分段、`git diff --check`；真实 PG 可用时加凭证包与 ingestion-api `test:integration`；Worker 回归。

- [ ] **Step 5: 建议提交边界**
  - README、formalization-readiness、ADR-013 追加记录、ADR 索引、AGENTS/AURORA_RULES、docs/README、根 package.json。

---

## 完成报告要求

实施完成并全部门禁通过后，报告必须包含：当前凭证缺口核验；最终模块选择；新 ADR 路径/编号/状态；正式规格路径与状态；writing-plans 路径与状态；Task 数量与完成状态；包目录与依赖；密钥格式；digest 与 constant-time comparison；数据库表和约束；Origin/environment 策略；凭证状态与过期；公共验证 API；ingestion-api adapter；Pool 所有权；PostgreSQL 测试；HTTP 401/403/503 集成测试；覆盖率；敏感信息扫描；全部质量命令与退出码；与计划的偏差；ADR 状态（ADR-013 implemented、ADR-009/011 in-progress、ADR-010 implemented）；Git 状态；更新后的剩余模块统计；建议提交边界；并明确说明：未提交或推送；未实现凭证创建/轮换/撤销管理 API、Worker policy、人工重放、CI/RDS/IaC；未规划或实施下一模块。
