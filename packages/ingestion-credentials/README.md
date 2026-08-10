# Aurora Ingestion Credentials

## 模块定位

`@aurora/ingestion-credentials` 是数据接入客户端上报凭证存储与验证第一增量。它承载 [ADR-013](../../docs/adr/ADR-013-ingestion-client-credential-storage-and-verification.md) 的机器语义：客户端上报密钥格式解析（`aurora_ingest_<keyId>_<secret>`）、SHA-256 secret 摘要与 constant-time 校验、`ingestion_client_credentials`/`origins`/`environments` 数据库模型、active/disabled/revoked 状态与动态过期、有效 Origin/environment 策略快照，以及 `verifyIngestionCredential` PostgreSQL 验证。`apps/ingestion-api` 通过私有 adapter 使用本包实现真实请求授权。

## 职责

- 密钥格式解析（16-byte keyId / 32-byte secret base64url 严格校验）；
- secret 摘要（SHA-256，输入为解码后的 32 字节 secret）与 constant-time 比较；
- `ingestion_client_credentials`/`ingestion_client_credential_origins`/`ingestion_client_credential_environments` 追加 Migration；
- active/disabled/revoked 状态与 `expires_at` 动态过期；
- Origin/environment 有效授权策略读取与精确匹配；
- `verifyIngestionCredential` 固定验证顺序与稳定结果；
- `normalizeOrigin` WHATWG URL 规范化；
- 凭证生命周期服务：`createIngestionClientCredential`（单一事务、一次性完整密钥返回）、`rotateIngestionClientCredential`（`SELECT ... FOR UPDATE` 行锁、新 active + 旧 revoked 原子提交、原样继承策略与 expiresAt）、`disableIngestionClientCredential`/`enableIngestionClientCredential`/`revokeIngestionClientCredential`（事务内状态判断与写入、数据库时间判断过期、disabled 可恢复、revoked 永久终态）；
- 只读安全状态查询 `queryProjectCredentialSafeStatus`（DAT-20）：按 status 计数 active/disabled/revoked 并报告 `latestCreatedAt`，只读 `status`/`created_at`，绝不读 `secret_digest`/`key_id`/origin/environment（无新 Migration）；`IngestionCredentialsError` 稳定错误类；
- 单元测试与真实 PostgreSQL 17 集成测试。

## 非职责

- 不实现 HTTP、Fastify、OpenAPI、Session、用户登录、管理平台；
- 不实现凭证管理 HTTP API、管理平台 UI、管理员授权、完整审计；
- 不实现跨项目批量管理、hard/soft delete、恢复已撤销凭证；
- 不实现 SDK transport、Worker、Inbox、Redis/BullMQ；
- 不创建云资源、CI、RDS、IaC；
- 不使用 bcrypt/scrypt/Argon2/PBKDF2/pepper/KMS/HSM。

## 安全模型

- 数据库只保存 SHA-256 摘要（`bytea` 固定 32 字节），不保存完整密钥、原始 secret 或可逆密文；
- 使用 `crypto.timingSafeEqual` 比较；不存在 keyId 时也执行 dummy digest 比较；
- 不向客户端区分 key 不存在、secret 错误、disabled、revoked、expired；
- Origin 精确匹配，禁止 wildcard/正则/子串；environment 精确区分大小写匹配；
- 缺失 Origin 只在 `allow_non_browser=true` 时允许；
- 完整 client key 只出现在 create/rotate 成功结果，且只在 COMMIT 成功后返回一次；
- secret 永不持久化；不提供 getSecret/revealKey 再次显示能力。

## 对外接口

包根导出：`parseIngestionClientKey`、`decodeSecretBytes`、`sha256Digest`、`timingSafeDigestEqual`、`DUMMY_DIGEST`、`normalizeOrigin`、`verifyIngestionCredential`、`IngestionCredentialVerificationResult`、`VerifyIngestionCredentialInput` 及格式常量；生命周期：`generateClientKeyPair`、`createIngestionClientCredential`、`rotateIngestionClientCredential`、`disableIngestionClientCredential`、`enableIngestionClientCredential`、`revokeIngestionClientCredential` 及生命周期输入/结果类型；DAT-20 只读诊断：`queryProjectCredentialSafeStatus`、`ProjectCredentialSafeStatus`、`IngestionCredentialsError`/`IngestionCredentialsErrorKind`。

```ts
export type IngestionCredentialVerificationResult =
  | { readonly status: 'authorized'; readonly projectId: string; readonly allowedOrigin: string | null }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'origin_forbidden' }
  | { readonly status: 'environment_forbidden' }
  | { readonly status: 'temporarily_unavailable' };

export function verifyIngestionCredential(
  pool: Pool | PoolClient,
  input: VerifyIngestionCredentialInput,
): Promise<IngestionCredentialVerificationResult>;

export function createIngestionClientCredential(
  pool: Pool | PoolClient,
  input: CreateIngestionClientCredentialInput,
): Promise<CreateIngestionClientCredentialResult>;

export function rotateIngestionClientCredential(
  pool: Pool | PoolClient,
  input: RotateIngestionClientCredentialInput,
): Promise<RotateIngestionClientCredentialResult>;

export function disableIngestionClientCredential(
  pool: Pool | PoolClient,
  input: MutateIngestionClientCredentialInput,
): Promise<MutateIngestionClientCredentialResult>;
```

不暴露数据库行、pg 错误、secret digest、凭证状态、keyId、allowlist、SQLSTATE；不修改输入；结果稳定可判别。完整 clientKey 只在 create/rotate 成功结果中返回；metadata 不含 digest。

## 数据库表

- `ingestion_client_credentials`：`id`（uuid PK）、`project_id`、`key_id`（唯一 varchar(22)）、`secret_digest`（bytea 固定 32 字节）、`status`（active/disabled/revoked）、`allow_non_browser`（默认 false）、`expires_at`（可空）、`created_at`/`updated_at`；
- `ingestion_client_credential_origins`：`(credential_id, origin)` 唯一；
- `ingestion_client_credential_environments`：`(credential_id, environment)` 唯一。

约束：`key_id` 唯一、`secret_digest` 固定 32 字节、status check、子表唯一；**不为 secret_digest 创建索引**；不包含 raw key/secret/Cookie/Session/Header。

## 命令

```bash
pnpm --filter @aurora/ingestion-credentials typecheck        # TypeScript strict
pnpm --filter @aurora/ingestion-credentials test             # 单元测试（不连数据库）
pnpm --filter @aurora/ingestion-credentials test:integration # 真实 PostgreSQL 17 集成测试
pnpm --filter @aurora/ingestion-credentials test:coverage    # 覆盖率（85/80/85/85）
pnpm --filter @aurora/ingestion-credentials build            # 构建 dist
```

集成测试需要真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL` 连接（目标必须是 `aurora_inbox_test` 测试库）；禁止以 SQLite/mock/PGlite 替代真实数据库证据。

## 关联文档

- [客户端凭证存储与验证正式规格](../../docs/security/ingestion-client-credential-storage-and-verification.md)
- [客户端凭证生命周期服务正式规格](../../docs/security/ingestion-client-credential-lifecycle.md)
- [ADR-013 客户端凭证存储与验证](../../docs/adr/ADR-013-ingestion-client-credential-storage-and-verification.md)
- [ADR-014 客户端凭证生命周期服务](../../docs/adr/ADR-014-ingestion-client-credential-lifecycle.md)
- [数据接入传输与客户端上报密钥安全决策包](../../docs/security/ingestion-transport-and-client-credential.md)
- [ADR-009 数据接入公开传输与客户端上报密钥安全语义](../../docs/adr/ADR-009-ingestion-transport-and-client-credential.md)
- [ADR-010 数据库访问与 Migration 工具链](../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md)
- [接入诊断状态查询正式规格](../../docs/architecture/ingestion-diagnostics-status-query.md)
