# 客户端上报凭证生命周期服务第一增量 (创建、轮换、停用、启用、撤销) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/ingestion-credentials`（`@aurora/ingestion-credentials`，扩展，不新建包）冻结并实施客户端上报凭证生命周期服务第一增量：`generateClientKeyPair`（`crypto.randomBytes` 16-byte keyId + 32-byte secret、无 padding base64url）、`createIngestionClientCredential`（单一事务写入 credential/origins/environments、COMMIT 后返回一次性 clientKey、keyId 唯一冲突有界重试）、`rotateIngestionClientCredential`（`SELECT ... FOR UPDATE` 锁定、新 active + 旧 revoked 原子提交、原样继承策略与 expiresAt、COMMIT 后返回新 key）、`disableIngestionClientCredential`/`enableIngestionClientCredential`/`revokeIngestionClientCredential`（事务内状态判断与写入、数据库时间判断过期、幂等成功/revoked 永久终态）、稳定生命周期结果。不新增 Migration（现有 Schema 足以表达全部语义）。这是 ADR-014 的第一增量；**不**实现管理 HTTP API、管理平台 UI、管理员授权或完整审计。

**Architecture:** 扩展 `@aurora/ingestion-credentials`（`aurora.layer: data`），生命周期函数只接受外部 `pool: Pool | PoolClient`，不创建/关闭 Pool。所有状态变更在单一事务内完成：从 Pool 获取 client、显式 BEGIN、状态判断与写入、COMMIT；创建/轮换使用 `SELECT ... FOR UPDATE` 行锁；过期判断使用数据库时间 `now()`；keyId 碰撞只对唯一约束冲突做有界重试（内部常量 `MAX_KEY_ID_ATTEMPTS`）。稳定结果判别联合；metadata 不含 digest；完整 clientKey 只出现在 create/rotate 成功结果。

**Tech Stack:** Node.js ≥24.18.0、TypeScript 6.0.3、Vitest 4.1.10、pnpm 11.17.0、PostgreSQL 17 + `pg` 8.22.0（复用 ADR-010 工具链）。Node 内置 `node:crypto`（`randomBytes`/`createHash`/`timingSafeEqual`）。不引入 KMS/HSM/新密钥管理基础设施。

**Plan status:** ready-for-implementation（本消息已预先批准无歧义派生的规格与计划；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 只修改 `packages/ingestion-credentials`（新增 `src/lifecycle*.ts`、`test/lifecycle*.test.ts`、`test/integration/lifecycle*.test.ts`、README 更新）与相关索引文档（formalization-readiness、AGENTS.md、AURORA_RULES.md、docs/README.md）。
- **不新增 Migration**（现有 `ingestion_client_credentials`/`origins`/`environments` 表足以表达全部语义）；不修改已有 Migration。
- 完全遵守 ADR-009/013 密钥格式、摘要、状态、Origin/environment 语义；**不改变**密钥格式、摘要算法、状态集合、Origin/environment 验证语义或 ingestion-api HTTP 契约。
- secret 永不持久化；完整 key 只出现在 create/rotate 成功结果；COMMIT 前不返回 key。
- 不实现管理 HTTP API、管理平台 UI、管理员授权、完整审计、跨项目批量管理、hard/soft delete、恢复已撤销凭证。
- 不引入 KMS/HSM/新密钥管理基础设施。
- 所有生命周期操作使用数据库事务与行锁；使用数据库时间判断 expiresAt。
- keyId 碰撞只对明确唯一冲突做有界重试（`MAX_KEY_ID_ATTEMPTS` 内部常量）；不对任意 PostgreSQL 错误盲目重试；不暴露 constraint 名/SQLSTATE。
- 结果稳定可判别；metadata 不含 digest；mutation 结果不含 clientKey。
- 真实 PostgreSQL 集成测试使用 `AURORA_TEST_DATABASE_URL`；确认目标是测试数据库（`aurora_inbox_test` 前缀）；独立 Schema/命名空间隔离；清理失败显式报错；禁止 SQLite/mock/PGlite 替代证据。
- 覆盖率 lines ≥85 / branches ≥80 / functions ≥85 / statements ≥85。
- fixture helper 保持私有，不从包根导出。
- ADR 状态：ADR-014 `accepted / implemented`；ADR-013 `accepted / implemented`；ADR-009/011 `accepted / in-progress`；ADR-010 `accepted / implemented`；ADR-008 `accepted / in-progress` 不变。

---

## 文件树

```text
packages/ingestion-credentials/
├── src/
│   ├── index.ts                    # Modify：新增生命周期导出
│   ├── lifecycle-types.ts          # Create：CreateIngestionClientCredentialInput/Result、Rotate/Mutate 输入与结果
│   ├── lifecycle-create.ts         # Create：generateClientKeyPair + createIngestionClientCredential
│   ├── lifecycle-rotate.ts         # Create：rotateIngestionClientCredential
│   └── lifecycle-mutate.ts         # Create：disable/enable/revoke + 共享事务状态变更
├── test/
│   ├── lifecycle-create.test.ts    # Create [ENV-INDEPENDENT]：key 生成/create 输入/结果判别
│   ├── lifecycle-rotate.test.ts    # Create [ENV-INDEPENDENT]：rotate 纯逻辑（fake Pool）
│   ├── lifecycle-mutate.test.ts    # Create [ENV-INDEPENDENT]：disable/enable/revoke 纯逻辑（fake Pool）
│   ├── package-entry.test.ts       # Modify：新增生命周期出口 + 私有路径负例
│   ├── security-negative.test.ts   # Modify：clientKey/secret/digest 不进入源码/日志
│   ├── documentation-contract.test.ts  # Modify：README/规格契约
│   └── integration/
│       ├── lifecycle-create.test.ts    # Create [PG-GATED]：创建/原子性/verify/keyId 碰撞
│       ├── lifecycle-rotate.test.ts    # Create [PG-GATED]：轮换/继承/并发 rotate/事务回滚
│       └── lifecycle-mutate.test.ts    # Create [PG-GATED]：disable/enable/revoke/认证回归
```

每个文件单一职责；不创建管理 HTTP API、UI、完整审计或新 Migration。

---

## Consumes / Produces 总览

- **Consumes**：`docs/security/ingestion-client-credential-lifecycle.md`（approved 规格）、`docs/adr/ADR-014-ingestion-client-credential-lifecycle.md`（accepted）、`docs/adr/ADR-013-ingestion-client-credential-storage-and-verification.md`、现有 `client-key.ts`（`parseIngestionClientKey`/`decodeSecretBytes`/常量）、`digest.ts`（`sha256Digest`/`timingSafeDigestEqual`/`DUMMY_DIGEST`）、`origin.ts`（`normalizeOrigin`）、`verification.ts`（`verifyIngestionCredential`）、现有 Migration、`apps/ingestion-api` 认证回归测试。
- **Produces**：生命周期能力（create/rotate/disable/enable/revoke、keyId 生成、事务行锁、keyId 碰撞重试、稳定结果）、真实 PostgreSQL 创建/轮换/状态/并发集成测试、ingestion-api 认证回归、README、ADR-014 证据、formalization-readiness 更新。

---

## Task 1: 生命周期类型与稳定结果 [ENV-INDEPENDENT]

**目标：** 冻结 `CredentialMetadata`（不含 digest）、`CreateIngestionClientCredentialInput/Result`、`RotateIngestionClientCredentialInput/Result`、`MutateIngestionClientCredentialInput/Result` 判别联合。

- Consumes: 规格 §17/§18/§19。
- Produces: `src/lifecycle-types.ts`、`test/lifecycle-create.test.ts`（类型判别部分）。

- [ ] **Step 1: 失败测试**
  - `test/lifecycle-create.test.ts`：
    - `CredentialMetadata` 含 credentialId/projectId/keyId/status/allowNonBrowser/expiresAt/createdAt/updatedAt，**不含** secretDigest（类型无该字段）；
    - create 结果判别：`success{metadata, clientKey}`/`invalid_input`/`temporarily_unavailable`/`generation_failed`；
    - rotate 结果判别：`success`/`not_found`/`invalid_state`/`expired`/`temporarily_unavailable`/`generation_failed`；
    - mutate 结果判别：`success`/`not_found`/`invalid_state`/`expired`/`temporarily_unavailable`；
    - create 输入 `CreateIngestionClientCredentialInput` 无 keyId/secret/digest/status 字段（类型级）。

- [ ] **Step 2: 最小实现**
  - `src/lifecycle-types.ts`：全部接口与判别联合（与规格 §17/§18 完全一致）。

- [ ] **Step 3: 确认通过**
  - `pnpm --filter @aurora/ingestion-credentials typecheck` exit 0；`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`；`pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `src/lifecycle-types.ts`、`test/lifecycle-create.test.ts`。

---

## Task 2: key 生成与创建（纯逻辑）[ENV-INDEPENDENT]

**目标：** 实现 `generateClientKeyPair`（`crypto.randomBytes` 16/32 字节、无 padding base64url、不使用 `Math.random`）与 `createIngestionClientCredential` 的纯逻辑部分（输入校验、事务编排骨架）。

- Consumes: 规格 §7/§15/§19、`client-key.ts` 常量、`digest.ts`。
- Produces: `src/lifecycle-create.ts`、`test/lifecycle-create.test.ts`。

- [ ] **Step 1: 失败测试**
  - `test/lifecycle-create.test.ts`：
    - `generateClientKeyPair()` 返回 keyId 22 字符、secret 43 字符，base64url 无 padding；
    - 两次调用 keyId/secret 不同（随机）；
    - 不使用 `Math.random`（实现不引用，代码审查）；
    - `createIngestionClientCredential` 输入校验：
      - projectId 非 UUID → `invalid_input`；
      - Origin 含非法值（未通过 `normalizeOrigin`）→ `invalid_input`；
      - environments 超长 → `invalid_input`；
      - `allowNonBrowser` 非 boolean（类型级，运行时不需）→ 编译期拒绝；
      - `expiresAt` 非法（过去时间，用 fake 数据库时间）→ `invalid_input`；
    - 输入不被修改。

- [ ] **Step 2: 最小实现**
  - `src/lifecycle-create.ts`：
    ```ts
    export function generateClientKeyPair(): { keyId: string; secret: string; clientKey: string };
    export async function createIngestionClientCredential(
      pool: Pool | PoolClient,
      input: CreateIngestionClientCredentialInput,
    ): Promise<CreateIngestionClientCredentialResult>;
    ```
    - `generateClientKeyPair` 用 `randomBytes(KEY_ID_BYTES)`/`randomBytes(SECRET_BYTES)` + 无 padding base64url（复用 `toBase64Url` 风格）；
    - 输入校验：projectId UUID 正则、Origin 去重/`normalizeOrigin`/长度上限、environments 去重/长度上限、`expiresAt` 校验（本 Task 先校验格式，数据库时间比较在 Task 3）；
    - 事务编排骨架（BEGIN/插入 credential/origins/environments/COMMIT，keyId 碰撞重试循环在 Task 3）。

- [ ] **Step 3: 确认通过**
  - `typecheck`、`test` 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/lifecycle-create.ts`、`test/lifecycle-create.test.ts`。

---

## Task 3: 创建事务 + keyId 碰撞重试（PG 集成）[PG-GATED]

**目标：** 完成 `createIngestionClientCredential` 的数据库事务：插入 credential/origins/environments 原子提交；keyId 唯一冲突有界重试；COMMIT 前不返回 key；非 keyId 错误不误重试。

- Consumes: 规格 §7/§16、`create-fixture.ts` 现有插入模式。
- Produces: `test/integration/lifecycle-create.test.ts`（真实 PG）。

- [ ] **Step 1: 失败测试**
  - `test/integration/lifecycle-create.test.ts`（真实 PG）：
    - 创建成功：credential/origins/environments 原子写入；clientKey 可通过现有 `verifyIngestionCredential` 认证；
    - 数据库无 raw secret/完整 key（`information_schema.columns` 无 secret/client_key 列）；
    - digest 与返回 key 匹配（重新 parse + digest 查询比对）；
    - COMMIT 失败（模拟子插入失败）不返回 key；
    - Origin 写入失败回滚 credential（计数不变）；
    - environment 写入失败回滚全部；
    - keyId 唯一冲突（预插入同 keyId）触发有界重试后成功；
    - 非 keyId 错误（如 status 约束）不被误重试（立即失败，不循环）。

- [ ] **Step 2: 最小实现**
  - `src/lifecycle-create.ts` 事务部分：
    - `MAX_KEY_ID_ATTEMPTS = 5`（内部常量）；
    - `for attempt < MAX_KEY_ID_ATTEMPTS`：生成 keyId → `BEGIN` → `INSERT INTO ingestion_client_credentials` → 插入 origins/environments → `COMMIT`；捕获唯一冲突（`error.code === '23505'` 且约束含 `key_id`）→ 重试；其他错误 → `temporarily_unavailable`；
    - `expiresAt` 非空时必须晚于数据库 `now()`（用 `SELECT now()` 或 `expires_at > now()` 校验）；
    - COMMIT 成功后返回 `success{metadata, clientKey}`。

- [ ] **Step 3: 确认通过**
  - 真实 PG 创建测试通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-credentials test`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/lifecycle-create.ts`、`test/integration/lifecycle-create.test.ts`。

---

## Task 4: 轮换（SELECT FOR UPDATE + 原子撤销）[PG-GATED]

**目标：** 实现 `rotateIngestionClientCredential`：`SELECT ... FOR UPDATE` 锁定、确认非 revoked 且未过期、读取旧策略、创建新 active + 旧 revoked 原子提交、原样继承策略与 expiresAt、COMMIT 后返回新 key；并发 rotate 只有一个成功。

- Consumes: 规格 §9/§14。
- Produces: `src/lifecycle-rotate.ts`、`test/lifecycle-rotate.test.ts`（fake Pool 纯逻辑 + 真实 PG）。

- [ ] **Step 1: 失败测试**
  - `test/lifecycle-rotate.test.ts`：
    - fake Pool 纯逻辑：active 轮换走事务、not_found、revoked → `invalid_state`、expired → `expired`、disabled 允许轮换；
    - 真实 PG：active 轮换成功，新 key 可认证、旧 key 立即 401、新旧不同 keyId、无同时 active；disabled 轮换成功（新 active 旧 revoked）；expired 不可轮换；revoked 不可轮换；Origin/environment/allowNonBrowser/expiresAt 原样继承；事务失败（模拟子插入失败）旧 key 仍有效且不返回新 key；**两个并发 rotate 只有一个成功**（结果一个 success 一个 not_found 或 invalid_state）；rotate 与 revoke 并发不产生额外 active key。

- [ ] **Step 2: 最小实现**
  - `src/lifecycle-rotate.ts`：
    - `SELECT id, project_id, status, allow_non_browser, expires_at FROM ingestion_client_credentials WHERE key_id = $1 FOR UPDATE`；
    - 无行 → `not_found`；status revoked → `invalid_state`；expired（`expires_at <= now()`）→ `expired`；
    - 读取旧 origins/environments；
    - 生成新 keyId/secret，插入新 active 凭证（原样策略与 expiresAt），更新旧凭证 status=revoked；
    - 同一事务 COMMIT；成功后返回 `success{metadata: 新凭证, clientKey}`。

- [ ] **Step 3: 确认通过**
  - 真实 PG 轮换/并发/回滚测试通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-credentials test`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/lifecycle-rotate.ts`、`test/lifecycle-rotate.test.ts`。

---

## Task 5: 停用/启用/撤销（事务状态变更）[PG-GATED]

**目标：** 实现 `disableIngestionClientCredential`/`enableIngestionClientCredential`/`revokeIngestionClientCredential`：事务内状态判断与写入、数据库时间判断过期、幂等成功/revoked 永久终态。

- Consumes: 规格 §10/§11/§12/§14。
- Produces: `src/lifecycle-mutate.ts`、`test/lifecycle-mutate.test.ts`（fake Pool + 真实 PG）。

- [ ] **Step 1: 失败测试**
  - `test/lifecycle-mutate.test.ts`：
    - fake Pool 纯逻辑：active→disabled、disabled 幂等、disabled→active、active 幂等 enable、revoked→invalid_state、expired→expired、active→revoked、disabled→revoked、revoked 幂等 revoke、not_found；
    - 真实 PG：上述全部 + expired disabled 不可 enable；revoked 不可 enable；revoked 永远不能恢复（enable 返回 invalid_state）；disabled key 认证 401；re-enabled key 恢复认证；revoked key 401；enable 用数据库时间判断过期（插入过期 disabled，enable 返回 expired）。

- [ ] **Step 2: 最小实现**
  - `src/lifecycle-mutate.ts`：
    - 共享事务状态变更逻辑：`SELECT status, expires_at FROM ingestion_client_credentials WHERE key_id = $1 FOR UPDATE` → 无行 `not_found` → 判断目标状态迁移 → `UPDATE ... SET status = $2, updated_at = now()` → COMMIT；
    - disable：active→disabled、disabled 幂等、revoked→invalid_state、expired→expired；
    - enable：disabled 且未过期→active、active 幂等、revoked→invalid_state、expired→expired（`expires_at > now()` 才可启用）；
    - revoke：active/disabled→revoked、revoked 幂等、expired 允许转 revoked。

- [ ] **Step 3: 确认通过**
  - 真实 PG 状态变更测试通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-credentials test`；`pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/lifecycle-mutate.ts`、`test/lifecycle-mutate.test.ts`。

---

## Task 6: 包根出口、安全负例与文档契约 [ENV-INDEPENDENT]

**目标：** `index.ts` 导出全部生命周期 API；安全负例（clientKey/secret/digest 不入源码/日志/快照、无 getSecret/revealKey）；README 更新；文档契约。

- Consumes: 规格 §18/§21/§22/§26。
- Produces: `src/index.ts` 完善、`test/package-entry.test.ts` 扩展、`test/security-negative.test.ts` 扩展、`test/documentation-contract.test.ts` 扩展、`README.md` 更新。

- [ ] **Step 1: 失败测试**
  - `package-entry.test.ts` 扩展：包根导出 5 个生命周期函数 + 类型；`lifecycle-rotate.ts` 等私有路径不可导入；
  - `security-negative.test.ts` 扩展：`src/` 不含 `clientKey` 字符串拼接日志、不含 `getSecret`/`revealKey` 函数名、不含 `Math.random`、不含 `console.log` 原始 key；`test/` 快照不含 clientKey（fixture 生成动态值，不写死）；
  - `documentation-contract.test.ts`：README 含生命周期职责/非职责、不宣称管理 HTTP API 已实现。

- [ ] **Step 2: 最小实现**
  - `index.ts` 导出生命周期 API；README 更新（生命周期章节）；负例与文档契约测试完善。

- [ ] **Step 3: 确认通过**
  - `pnpm check:boundaries` exit 0；`pnpm lint` exit 0；全部负例与文档契约测试通过。

- [ ] **Step 4: 相关回归**
  - 全包 `typecheck`。

- [ ] **Step 5: 建议提交边界**
  - `src/index.ts`、`README.md`、`test/package-entry.test.ts`、`test/security-negative.test.ts`、`test/documentation-contract.test.ts`。

---

## Task 7: ingestion-api 认证回归 [PG-GATED]

**目标：** 确认生命周期能力不破坏 ingestion-api 认证：disabled/revoked key 拒绝、rotate 后旧 key 401、`buildIngestionApi` fake authorizer 兼容。

- Consumes: 规格 §25、`apps/ingestion-api` 认证测试。
- Produces: `apps/ingestion-api/test/integration/credential-http-auth.test.ts` 扩展（rotate/disable/revoke 后 HTTP 行为）。

- [ ] **Step 1: 失败测试**
  - `credential-http-auth.test.ts` 扩展（真实 PG）：
    - 创建凭证 → disable → POST 返回 401；
    - 创建凭证 → revoke → POST 返回 401；
    - 创建凭证 → rotate → 旧 key POST 返回 401、新 key POST 200；
    - 创建凭证 → disable → enable → POST 恢复 200；
    - 既有 fake authorizer 测试（`routes-inject.test.ts`）保持通过（回归）。

- [ ] **Step 2: 最小实现**
  - 扩展 `credential-http-auth.test.ts`（复用生命周期 API + `buildIngestionApi`）。

- [ ] **Step 3: 确认通过**
  - 真实 PG HTTP 认证回归通过；`pnpm --filter @aurora/ingestion-api test` 全绿。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`；`pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `apps/ingestion-api/test/integration/credential-http-auth.test.ts`。

---

## Task 8: 覆盖率、根级门禁、文档与 ADR 证据 [ENV-INDEPENDENT / 结果门控]

**目标：** 覆盖率 ≥ lines 85 / branches 80 / functions 85 / statements 85；README、formalization-readiness、ADR-014 证据、ADR 索引同步；根级完整质量门禁。

- Consumes: 全部 Task 产物、规格、ADR-014。
- Produces: `README.md` 更新、`docs/architecture/formalization-readiness.md` 更新、ADR-014 追加记录、`docs/adr/README.md` 状态同步、`docs/README.md`、`AGENTS.md`/`AURORA_RULES.md` 同步。

- [ ] **Step 1: 失败测试（文档契约先行）**
  - `test/documentation-contract.test.ts`：README 含生命周期职责/非职责、不宣称管理 HTTP API 已实现。

- [ ] **Step 2: 最小实现文档**
  - 更新 `README.md`；
  - 更新 `formalization-readiness.md`：credential lifecycle service implemented、credential management HTTP API not-started/blocked、management authorization/audit blocked；
  - ADR-014 追加实施证据；ADR 索引同步 ADR-014 `implemented`；
  - `AGENTS.md`/`AURORA_RULES.md` 状态同步；`docs/README.md` 若需要登记新正式文档。

- [ ] **Step 3: 确认通过**
  - 文档契约测试通过；`pnpm format:check`、`git diff --check`。

- [ ] **Step 4: 相关回归**
  - 全仓：`pnpm install --frozen-lockfile`、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:coverage`、`pnpm check:boundaries`、`pnpm build`、`pnpm check:ci` 分段、`git diff --check`；真实 PG 可用时加凭证包与 ingestion-api `test:integration`；Worker 回归。

- [ ] **Step 5: 建议提交边界**
  - README、formalization-readiness、ADR-014 追加记录、ADR 索引、AGENTS/AURORA_RULES、docs/README、根 package.json。

---

## 完成报告要求

实施完成并全部门禁通过后，报告必须包含：当前生命周期能力核验；最终模块选择；新 ADR 路径/编号/状态；正式规格路径与状态；writing-plans 路径与状态；Task 数量与完成状态；创建和修改的文件；公共生命周期 API；create 一次性 key 语义；rotate 事务和旧 key 失效；disable/enable/revoke 状态；并发和行锁；keyId 碰撞处理；PostgreSQL 测试；ingestion-api 认证回归；覆盖率；敏感信息扫描；全部质量命令与退出码；与计划的偏差；ADR 状态（ADR-014 implemented、ADR-013 implemented、ADR-009/011 in-progress、ADR-010 implemented）；Git 状态；更新后的剩余模块统计；建议提交边界；并明确说明：未提交或推送；未实现管理 HTTP API、管理 UI、管理员授权、完整审计、Worker policy、CI/RDS/IaC；未规划或实施下一模块。
