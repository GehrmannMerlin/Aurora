---
title: ADR-013：客户端上报凭证存储与验证
status: accepted
implementation-status: implemented
approval-status: approved
owner: ingestion/security
date: 2026-08-02
last-reviewed: 2026-08-02
applies-to: 客户端上报凭证的数据库模型、密钥摘要与 constant-time 校验、状态与过期、Origin/environment 授权策略、PostgreSQL 凭证验证、ingestion-api 请求授权 adapter
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/platform-backend.md
  - ../../docs/architecture/deployment.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/architecture/system-overview.md
  - ../../docs/architecture/ingestion-inbox-data-model.md
  - ../../docs/security/ingestion-transport-and-client-credential.md
  - ../../docs/security/ingestion-client-credential-storage-and-verification.md
  - ../../docs/api/ingestion-openapi.md
  - ../../docs/adr/ADR-004-asynchronous-event-processing.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../docs/adr/ADR-011-ingestion-http-service-runtime.md
supersedes: none
superseded-by: none
---

# ADR-013：客户端上报凭证存储与验证

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：implemented
- 审批状态：approved
- 日期：2026-08-02
- Owner：ingestion/security
- 适用范围：客户端上报凭证的数据库模型、密钥摘要与 constant-time 校验、状态与过期、Origin/environment 授权策略、PostgreSQL 凭证验证、ingestion-api 请求授权 adapter
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 5、6、7 章
- 关联决策包：[数据接入传输与客户端上报密钥安全决策包](../security/ingestion-transport-and-client-credential.md)
- 关联 OpenAPI：[数据接入 OpenAPI 机器契约](../api/ingestion-openapi.md)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-02 由用户批准（`decision-status: accepted`、`approval-status: approved`），实施状态保持 `not-started`。批准授权客户端上报凭证存储与验证的最终决定；批准不代表凭证创建、轮换、撤销管理 API、平台页面、CI、RDS 或 IaC 已经实现。

## 背景

Aurora 已接受 ADR-008（数据接入可靠缓冲 = PostgreSQL 事务性 Inbox）、ADR-009（数据接入公开传输与客户端上报密钥安全语义）、ADR-010（数据接入数据库访问与 Migration 工具链）和 ADR-011（数据接入同步 HTTP 服务运行时）。数据接入 OpenAPI 机器契约、Inbox 数据模型、接入 HTTP 服务与 Worker 运行时已实施。ADR-009 冻结了密钥物理格式 `aurora_ingest_<keyId>_<secret>`、传递位置（`X-Aurora-Client-Key`）、状态语义、来源匹配与环境标识，但明确把"精确随机位数和摘要算法"留给后续凭证数据模型与安全实现规格（ADR-009 第 113 行、OpenAPI 第 48 行）。

当前真实缺口：没有客户端上报密钥数据库表；没有密钥摘要验证；没有 active/disabled/revoked/expired 校验；没有真实 Origin/environment 授权数据；`apps/ingestion-api` 的生产 composition root 仍依赖测试用的 `allowAllIngestionAdmissionPolicy` 风格 authorizer，尚无真实 authorizer 实现。本 ADR 于 2026-08-02 由用户批准，解除该阻塞。

## 决策驱动因素

- **浏览器可见凭证威胁模型**：客户端上报密钥可被加载页面的人读取，泄露风险由能力边界而非保密性控制；它绝不能授权数据读取；
- **高熵随机 secret**：secret 具备完整 256-bit 随机熵，不需要密码型慢哈希；
- **不保存原始 secret**：数据库只保存单向摘要，泄露数据库不能重放 secret；
- **constant-time 比较**：避免 secret 枚举；不存在 keyId 时也执行 dummy digest 比较；
- **状态与过期**：disabled/revoked/expired/未知 key/secret 不匹配全部认证失败，不向客户端区分；
- **来源匹配是防误用而非强边界**：Origin 精确匹配，不使用 Referer 回退；
- **复用 PostgreSQL 与既有工程链**：与 Inbox 相同工具链（PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first），不引入新基础设施；
- **不实现管理 API**：本轮只做存储与验证，凭证创建/轮换/撤销管理留待后续。

## 现有约束

- ADR-009：密钥格式 `aurora_ingest_<keyId>_<secret>`；`X-Aurora-Client-Key`/`X-Aurora-Environment`；Origin 匹配；缺失 Origin 默认拒绝 + `allowNonBrowser`；HTTP 状态映射（401/403/503）；凭证不出现在 Query/日志/审计/错误响应；
- ADR-010：PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first；`AURORA_TEST_DATABASE_URL`；测试数据库隔离；
- ADR-011：`apps/ingestion-api` composition root 拥有 Pool；`buildIngestionApi` 接受外部依赖；生产启动必须显式提供 authorizer；
- OpenAPI：HTTP 状态码、Header、receipt 映射不变；凭证 OpenAPI 视为 opaque string；
- 批次/接收结果协议：`IngestionErrorCode` 是稳定错误码唯一来源；HTTP 只作传输投影。

## 最终决策

### 4.1 密钥格式（第一版编码）

- 格式：`aurora_ingest_<keyId>_<secret>`（ADR-009 已批准）；
- `keyId`：16 个随机字节的无填充 base64url，编码后固定 22 个字符；
- `secret`：32 个随机字节的无填充 base64url，编码后固定 43 个字符；
- base64url 只允许 `A-Z`/`a-z`/`0-9`/`-`/`_`；不允许 `=` padding；不允许空格；不进行大小写归一化；不接受额外前缀、后缀或分隔段；
- 本轮只实现解析和验证，不实现用户可调用的密钥创建 API；测试 fixture 可生成满足格式的密钥，但生成器不作为生产公共 API 暴露。

### 4.2 secret 摘要

- secret 原始值为 256-bit 随机数；
- 数据库只保存 SHA-256 摘要（解码后的 32 字节 secret 作为摘要输入；摘要结果固定 32 字节）；
- PostgreSQL 使用 `bytea` 保存；
- 不保存完整密钥、原始 secret 或可逆密文；
- 使用 Node.js `crypto.createHash('sha256')` 与 `crypto.timingSafeEqual`；
- 第一版不使用 bcrypt/scrypt/Argon2/PBKDF2/pepper/KMS/HSM；
- 未来若增加 pepper 或 KMS，必须独立 ADR 和向前兼容迁移。

### 4.3 查询与比较

验证流程：

1. 严格解析完整客户端密钥；
2. 取得 keyId 和 secret；
3. 根据 keyId 查询最多一条凭证记录（连同策略）；
4. 计算候选 secret 摘要；
5. 使用 `timingSafeEqual` 比较；
6. 不根据错误类型向调用方暴露细节。

不存在 keyId 时也必须执行一次与固定 32-byte dummy digest 的比较。禁止 `===` 比较摘要、查询完整密钥、按 secret 查询、把 keyId/secret 拼接进 SQL、暴露 SQLSTATE 或约束名。

### 4.4 凭证状态

- 数据库状态只包含 `active`、`disabled`、`revoked`；
- `expired` 不作为可写状态保存，而由 `expires_at <= database_now` 动态推导；
- active 且未过期 → 可继续授权；disabled/revoked/expired/未知 key/secret 不匹配/格式非法 → 认证失败；
- 统一映射为 ingestion-api 既有的 `unauthenticated` 结果和 HTTP 401；
- 不向客户端区分 key 不存在、secret 错误、disabled、revoked、expired。

### 4.5 Origin 与 environment

- 第一增量保存每个凭证的有效授权策略快照（精确 Origin 集合、environment 集合、`allow_non_browser`）；
- 这不是新的平台项目模型，也不替代未来项目配置权威；
- Origin 使用规范化后的完整 HTTP(S) origin 精确匹配；不允许 wildcard/正则/子字符串/后缀匹配；不使用 Referer 回退；
- environment 使用精确、区分大小写的稳定标识匹配；
- 缺失 Origin 只在 `allow_non_browser=true` 时允许；存在 Origin 时即使允许 non-browser 仍必须通过 Origin allowlist；
- 空 Origin allowlist 不表示允许全部；空 environment 集合不表示允许全部；
- 未来凭证管理模块负责保证策略不宽于项目级策略；本轮只负责读取和强制执行。

### 4.6 数据库表与工具链

- 独立凭证数据包 `packages/ingestion-credentials`（包名 `@aurora/ingestion-credentials`）；
- 使用新的追加 Migration，不编辑已有 Migration；
- 表：`ingestion_client_credentials`（含 `id`、`project_id`、`key_id`、`secret_digest`、`status`、`allow_non_browser`、`expires_at`、`created_at`、`updated_at`）、`ingestion_client_credential_origins`（`credential_id`、`origin`）、`ingestion_client_credential_environments`（`credential_id`、`environment`）；
- 约束：`key_id` 唯一；`secret_digest` 固定 32 bytes；status 只允许 active/disabled/revoked；`expires_at` 可空；不包含 raw key/secret/Cookie/Session/Header；不为 secret_digest 创建索引；
- 至少评估索引：unique key_id、project_id、子表 credential_id、expires_at；
- 禁止：secret digest 索引、JSONB 策略、GIN 索引、过早分区、凭证与 Inbox 同表、创建用户或 Session 表。

### 4.7 验证顺序（固定）

1. 严格解析客户端密钥；
2. 校验 environment 输入；
3. 规范化 Origin 或确认缺失；
4. 使用 keyId 查询凭证及策略；
5. 计算候选 digest；
6. constant-time digest comparison；
7. 检查 status；
8. 使用数据库时间检查 expires_at；
9. 校验 environment；
10. 校验 Origin 或 allow_non_browser；
11. 返回 authorized projectId。

数据库错误映射为 `temporarily_unavailable`；不返回 unauthenticated；不返回 authorized；不泄露数据库信息。

### 4.8 公共验证 API

`@aurora/ingestion-credentials` 包根冻结最小公共 API（命名遵循仓库风格）：

```ts
export type IngestionCredentialVerificationResult =
  | { readonly status: 'authorized'; readonly projectId: string; readonly allowedOrigin: string | null }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'origin_forbidden' }
  | { readonly status: 'environment_forbidden' }
  | { readonly status: 'temporarily_unavailable' };

export interface VerifyIngestionCredentialInput {
  readonly clientKey: string;
  readonly environment: string;
  readonly origin: string | null;
}

export function verifyIngestionCredential(
  pool: Pool,
  input: VerifyIngestionCredentialInput,
): Promise<IngestionCredentialVerificationResult>;
```

不暴露数据库行、pg 错误、secret digest、凭证状态、keyId、allowlist、SQLSTATE；不修改输入；结果稳定可判别。

### 4.9 ingestion-api 集成

- 在 `apps/ingestion-api` 创建私有 adapter（如 `src/postgres-request-authorizer.ts`），调用 `@aurora/ingestion-credentials` 包根，映射 `authorized`/`unauthenticated`/`origin_forbidden`/`environment_forbidden`/`temporarily_unavailable` 到既有 `IngestionRequestAuthorizer` 结果；
- composition root 复用已拥有的 PostgreSQL Pool，构造真实 authorizer；不创建第二个 Pool；服务关闭时仍只关闭一次 Pool；
- `buildIngestionApi` 继续允许注入 fake authorizer；测试接口保持兼容；
- 生产启动不再依赖永远允许的 authorizer；
- HTTP 语义不变：认证失败 → 401；Origin/environment 禁止 → 403；数据库/verifier 暂时不可用 → 503；authorized 才允许继续解析和持久化；未授权请求不得调用 Inbox。

## 结果与影响

### 正面影响

- 客户端上报密钥获得真实存储与验证，生产 composition root 不再依赖允许全部；
- secret 只存摘要，数据库泄露不能重放；
- constant-time 比较避免枚举；不存在 key 时也执行 dummy 比较；
- 状态/过期/来源/环境语义与 ADR-009 完全一致；
- 复用 PostgreSQL 与既有工程链，无新基础设施。

### 负面影响与代价

- 需要额外 Migration 与数据表；
- 凭证管理（创建/轮换/撤销）仍缺失，生产还不能自助管理密钥；
- 需要维护策略快照与未来项目配置权威的一致性。

### 未解决问题

- 凭证创建、轮换、撤销管理 API（后续独立模块）；
- 凭证交付/重显/轮换 UI（平台 C14）；
- 精确策略管理（未来项目配置权威）；
- CI、RDS、IaC、容量基准。

## 实施约束

- 完全遵守 ADR-009 密钥格式、传递位置、状态语义、来源/环境规则与 HTTP 状态映射；
- 不修改 `X-Aurora-Client-Key`/`X-Aurora-Environment`/OpenAPI 状态码/ingestion-api 公开 HTTP 语义；
- 不创建用户身份、Session 或管理平台认证；
- 不设计凭证管理 API；不实现密钥轮换工作流；
- 不把完整密钥或 secret 写入数据库；
- 凭证包不依赖 `apps/ingestion-api`；`apps/ingestion-api` 只通过凭证包根导入。

## 迁移方案

本 ADR accepted 后：编写客户端凭证存储与验证正式规格 → writing-plans → 实施 `@aurora/ingestion-credentials`（Migration、解析、摘要、查询验证、Origin 规范化、稳定结果）→ 集成 `apps/ingestion-api` 私有 adapter → 真实 PostgreSQL 与 HTTP 集成验证。

## 回滚方案

若凭证验证在实施中发现缺陷，可在生产部署前替换 adapter 实现（授权端口抽象则迁移成本低）；Migration 发布后遵循向前修复与 expand/contract。不得通过静默放行降级。

## 验证方式

- 密钥格式解析单元测试（合法/非法/边界）；
- digest 与 constant-time 比较测试；
- 真实 PostgreSQL 凭证验证集成测试（authorized/unauthenticated/origin_forbidden/environment_forbidden/temporarily_unavailable）；
- HTTP 401/403/503 集成测试；accepted/duplicate 回归；
- 敏感信息扫描（无 raw key/secret/digest/数据库 URL/SQLSTATE 泄漏）；
- 全仓质量门禁与覆盖率 85/80/85/85。

## 重新评估条件

- 凭证泄露路径出现新的浏览器威胁；
- secret 熵要求变化；
- 需要 pepper/KMS/HSM 或密码型慢哈希；
- 平台项目配置权威实现后需要策略迁移。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-02：用户批准与最终决定

- 决策状态更新为 `accepted`，实施状态保持 `not-started`，审批状态 `approved`；
- 用户批准本消息中的精确决定：PostgreSQL 17、SQL-first、`pg`、`node-pg-migrate`、独立凭证数据包、16-byte keyId、32-byte secret、SHA-256 digest、timing-safe comparison、active/disabled/revoked、expires_at 动态失效、effective Origin/environment policy snapshot、ingestion-api 请求授权 adapter、不实现管理 API；
- 本次批准不代表凭证创建、轮换、撤销管理 API、平台页面、CI、RDS 或 IaC 已经实现。

### 2026-08-02：客户端凭证存储与验证第一增量实施证据

- 实施状态更新为 `implemented`：`@aurora/ingestion-credentials` 包与 `apps/ingestion-api` 私有 adapter 已实施并通过真实 PostgreSQL 17.10 与 HTTP 集成验证及全仓质量门禁；凭证创建/轮换/撤销管理 API 与完整生产配置仍未实现；
- 实施内容：`ingestion_client_credentials`/`ingestion_client_credential_origins`/`ingestion_client_credential_environments` Migration（`key_id` 唯一、`secret_digest` bytea 固定 32 字节、status check、`(credential_id, origin)`/`(credential_id, environment)` 唯一、策略快照）；`parseIngestionClientKey`（16-byte keyId + 32-byte secret base64url 严格解析）；`sha256Digest`/`timingSafeDigestEqual`（Node crypto）；`normalizeOrigin`（WHATWG URL、仅 http/https、禁止 userinfo/query/fragment、path 空或 `/`、拒绝 `null`/wildcard）；`verifyIngestionCredential`（固定验证顺序、数据库时间过期、constant-time 比较、不存在 keyId 时 dummy digest 比较、数据库错误 → `temporarily_unavailable`）；稳定结果判别；
- `apps/ingestion-api` 新增私有 `postgres-request-authorizer.ts`（复用已拥有的 Pool，映射到 `IngestionRequestAuthorizer`），`startIngestionApi` composition root 构造真实 authorizer；`buildIngestionApi` 仍支持注入 fake authorizer；HTTP 401/403/503 语义不变；未授权请求不调用 Inbox；
- 实际依赖：`@aurora/ingestion-credentials` 依赖 `pg` 8.22.0、`@aurora/event-schema`；`apps/ingestion-api` 增加 `@aurora/ingestion-credentials` 包根依赖；
- 测试：单元测试（密钥格式/digest/Origin 规范化/验证判别/包入口/安全负例/文档契约）+ 真实 PostgreSQL 17.10 凭证验证集成测试（authorized/未知 key/错误 secret/disabled/revoked/expired/Origin 允许与禁止/缺失 Origin + allowNonBrowser/environment/数据库故障/跨项目隔离）+ HTTP 401/403/503 集成测试与 accepted/duplicate 回归；
- 验证命令：`pnpm --filter @aurora/ingestion-credentials test/test:integration/typecheck/lint/build`、`pnpm --filter @aurora/ingestion-api test/test:integration/typecheck/lint/build`、`pnpm check:boundaries`、全仓门禁全部 exit 0；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：凭证创建、轮换、撤销管理 API、平台页面、完整生产配置、CI、RDS、IaC。