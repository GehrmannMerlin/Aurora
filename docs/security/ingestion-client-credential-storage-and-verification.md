---
title: Aurora 客户端上报凭证存储与验证第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/security
created: 2026-08-02
last-reviewed: 2026-08-02applies-to: packages/ingestion-credentials（@aurora/ingestion-credentials，客户端凭证存储/摘要校验/请求授权）与 apps/ingestion-api 私有 authorizer adapter
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../adr/ADR-011-ingestion-http-service-runtime.md
  - ../adr/ADR-013-ingestion-client-credential-storage-and-verification.md
  - ../security/ingestion-transport-and-client-credential.md
  - ../api/ingestion-openapi.md
  - ../architecture/ingestion-http-service.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: ingestion-credential-schema-or-security-change
---

# Aurora 客户端上报凭证存储与验证第一增量

## 1. 定位、效力与当前状态

本文冻结客户端上报凭证存储与验证第一增量，实施为真实私有包 `@aurora/ingestion-credentials`，并集成到 `apps/ingestion-api` 私有请求授权 adapter。它承载 ADR-013 的机器语义：客户端上报密钥格式解析、secret 摘要与 constant-time 校验、凭证数据库模型、active/disabled/revoked 状态与动态过期、有效 Origin/environment 策略快照、PostgreSQL 凭证验证，以及 `IngestionRequestAuthorizer` 的真实实现。ADR-009 冻结了传输语义（密钥格式、Header、来源/环境、状态码），本文只冻结**存储与验证**，不修改 ADR-009 的传输格式、Header、OpenAPI 状态码或 HTTP 语义。

**批准状态**：本文于 2026-08-02 由用户预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-02 更新为 `implemented`：`@aurora/ingestion-credentials` 包（Migration、解析、摘要、查询验证、Origin 规范化、稳定结果）与 `apps/ingestion-api` 私有 adapter 已实施，并通过真实 PostgreSQL 17.10 凭证验证与 HTTP 401/403/503 集成验证及全仓质量门禁。本文由 accepted ADR-008/009/010/011/013 与 approved OpenAPI、HTTP 服务规格无歧义派生；自动审批依据见规格自检节。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/security
- **适用范围**：`@aurora/ingestion-credentials` 包（密钥格式、摘要、凭证数据模型、策略读取、PostgreSQL 验证、稳定结果、Migration、包根出口、单元与集成测试）与 `apps/ingestion-api` 私有 authorizer adapter。
- **明确非职责**：
  - HTTP、Fastify、OpenAPI、Session、用户登录、管理平台；
  - 密钥创建页面、密钥轮换流程；
  - SDK transport、Worker、Inbox、Redis/BullMQ；
  - 云资源、CI、RDS、IaC；
  - 凭证管理 API。

## 3. 模块选择依据

- ADR-009 冻结密钥格式 `aurora_ingest_<keyId>_<secret>` 与传输语义，但把"精确随机位数和摘要算法"留给后续凭证数据模型与安全实现规格；
- `apps/ingestion-api` 的 `IngestionRequestAuthorizer` 是服务内部抽象端口，生产 composition root 尚无真实 authorizer；
- 仓库无任何客户端凭证表、摘要验证、状态校验或 Origin/environment 授权数据；
- 本模块只做存储与验证，不做凭证管理 API 或轮换工作流。

## 4. 威胁模型

- **浏览器公开密钥**：客户端上报密钥可被加载页面的人读取，泄露风险由能力边界而非保密性控制（PRD 5.3）；密钥只授予上报能力，绝不授权读取/管理/Source Map；
- **数据库泄露不重放**：只存 SHA-256 摘要，不存原始 secret 或可逆密文；
- **secret 枚举**：使用 constant-time 比较；不存在 keyId 时执行 dummy digest 比较，避免路径差异暴露；
- **凭证入 URL/日志**：禁止 Query 传递；凭证不进入日志、诊断、错误响应、审计或普通缓存；
- **来源伪造**：Origin 可被非浏览器伪造，来源匹配是防误用而非强认证；但来源不允许必须返回稳定 403 永久拒绝；
- **环境混淆**：environment 只用于分域/策略/诊断，不授予权限。

## 5. 职责与非职责

### 5.1 职责

- 密钥格式解析（`parseIngestionClientKey`）；
- secret 摘要（SHA-256）与 constant-time 比较；
- 凭证数据库模型与追加 Migration；
- 有效 Origin/environment 策略读取；
- PostgreSQL 凭证验证（固定验证顺序）；
- 稳定验证结果；
- 包根出口、单元测试、PostgreSQL 集成测试；
- `apps/ingestion-api` 私有 authorizer adapter。

### 5.2 非职责

- 不实现 HTTP/Fastify/OpenAPI/Session/用户登录/管理平台；
- 不实现凭证创建页面、轮换流程、管理 API；
- 不实现 SDK transport/Worker/Inbox/Redis/BullMQ；
- 不创建云资源/CI/RDS/IaC。

## 6. 密钥格式

格式：`aurora_ingest_<keyId>_<secret>`（ADR-009）。

第一版编码：

- `keyId`：16 个随机字节的无填充 base64url，编码后固定 22 个字符；
- `secret`：32 个随机字节的无填充 base64url，编码后固定 43 个字符；
- base64url 字符集：`A-Z`、`a-z`、`0-9`、`-`、`_`；
- 不允许 `=` padding；不允许空格；不进行大小写归一化；不接受额外前缀、后缀或分隔段。

本轮只实现解析和验证，不实现用户可调用的密钥创建 API。测试 fixture 可生成满足格式的密钥，但生成器不作为生产公共 API 暴露。

## 7. secret 摘要与 constant-time 比较

- secret 原始值为 256-bit 随机数；
- 摘要输入为解码后的 32 字节 secret；
- 摘要结果固定为 32 字节（SHA-256）；
- PostgreSQL 使用 `bytea` 保存；
- 不保存完整密钥、原始 secret 或可逆密文；
- 使用 Node.js `crypto.createHash('sha256')` 与 `crypto.timingSafeEqual`；
- 第一版不使用 bcrypt/scrypt/Argon2/PBKDF2/pepper/KMS/HSM（secret 有完整 256-bit 熵）；
- 未来增加 pepper/KMS 必须独立 ADR 和向前兼容迁移。

## 8. 查询与比较流程

1. 严格解析完整客户端密钥；
2. 取得 keyId 和 secret；
3. 根据 keyId 查询最多一条凭证记录（连同策略快照）；
4. 计算候选 secret 摘要；
5. 使用 `timingSafeEqual` 比较；
6. 不根据错误类型向调用方暴露细节。

不存在 keyId 时也必须执行一次与固定 32-byte dummy digest 的比较。禁止：`===` 比较摘要；查询完整密钥；按 secret 查询；将 keyId/secret 拼接进 SQL；暴露 SQLSTATE 或约束名。

## 9. 凭证状态与过期

数据库状态只包含 `active`、`disabled`、`revoked`；`expired` 不作为可写状态保存，而由 `expires_at <= database_now` 动态推导。

| 状态/条件          | 授权结果                 |
| ------------------ | ------------------------ |
| active 且未过期    | 可继续授权               |
| disabled           | 认证失败（unauthenticated） |
| revoked            | 认证失败（unauthenticated） |
| expired            | 认证失败（unauthenticated） |
| 未知 key           | 认证失败（unauthenticated） |
| secret 不匹配      | 认证失败（unauthenticated） |
| 格式非法           | 认证失败（unauthenticated） |

统一映射为 ingestion-api 既有 `unauthenticated` 结果与 HTTP 401。不得向客户端区分 key 不存在、secret 错误、disabled、revoked、expired。

## 10. 数据库表（追加 Migration）

使用新的追加 Migration，不编辑任何已有 Migration。

### 10.1 `ingestion_client_credentials`

| 列名               | 类型                  | 约束/说明                                        |
| ------------------ | --------------------- | ------------------------------------------------ |
| `id`               | `uuid`                | 主键（内部 UUID）                                |
| `project_id`       | `uuid`                | 项目作用域                                       |
| `key_id`           | `varchar(22)`         | 唯一；16 字节 base64url                          |
| `secret_digest`    | `bytea`               | 固定 32 字节（SHA-256），不可为 null             |
| `status`           | `varchar`             | check：`active`/`disabled`/`revoked`             |
| `allow_non_browser`| `boolean`             | 默认 false                                       |
| `expires_at`       | `timestamptz`         | 可空；`<= now()` 动态推导 expired                |
| `created_at`       | `timestamptz`         | 非空                                             |
| `updated_at`       | `timestamptz`         | 非空                                             |

约束：`key_id` 唯一；`secret_digest` 固定 32 字节（`octet_length(secret_digest) = 32`）；status 只允许 active/disabled/revoked；`expires_at` 可空；不包含 raw key、secret、Cookie、Session 或 Header。**不为 secret_digest 创建索引。**

### 10.2 `ingestion_client_credential_origins`

| 列名           | 类型      | 约束/说明                              |
| -------------- | --------- | -------------------------------------- |
| `credential_id`| `uuid`    | 外键引用 credentials.id                |
| `origin`       | `varchar` | `(credential_id, origin)` 唯一         |

要求：origin 已规范化；只允许 HTTP(S) origin；不允许 wildcard；不允许路径、查询、fragment 或 userinfo。

### 10.3 `ingestion_client_credential_environments`

| 列名           | 类型      | 约束/说明                                  |
| -------------- | --------- | ------------------------------------------ |
| `credential_id`| `uuid`    | 外键引用 credentials.id                    |
| `environment`  | `varchar` | `(credential_id, environment)` 唯一        |

要求：environment 使用现有已批准长度或普通实现上限；不创建新的环境枚举。

索引：unique `key_id`；`project_id`；子表 `credential_id`；评估 `expires_at` 是否真正需要索引（第一增量评估后按需建立）。

禁止：secret digest 索引、JSONB 策略、GIN 索引、过早分区、凭证与 Inbox 同表、创建用户或 Session 表。

## 11. Origin 规范化

单一职责 `normalizeOrigin` 函数：

- 输入为 `unknown` 或 string；
- 使用 WHATWG URL；
- 只允许 `http:` 和 `https:`；
- 必须存在 host；
- 禁止 username/password；
- 禁止 query；
- 禁止 fragment；
- path 必须为空或 `/`；
- host 规范化为 URL 标准结果；默认端口按 URL 标准折叠；
- 返回 `URL.origin`；
- 拒绝 `null` 字符串、wildcard、非 origin URL；
- 不读取网络或 DNS。

## 12. 公共 API

包根冻结最小公共 API（命名遵循仓库风格）：

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

要求：不暴露数据库行、pg 错误、secret digest、凭证状态、keyId、allowlist、SQLSTATE；不修改输入；结果稳定可判别。若数据包约定不允许把 Pool 暴露到公共函数，使用与 `@aurora/ingestion-inbox` 相同的既有模式（函数接受 `pool: Pool | PoolClient`），不创建通用 Repository 框架。

## 13. 验证顺序（固定）

1. 严格解析客户端密钥；
2. 校验 environment 输入（非空、长度上限）；
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

## 14. 稳定结果

| 结果                     | 含义                                   |
| ------------------------ | -------------------------------------- |
| `authorized`             | 认证通过，返回 projectId 与 allowedOrigin |
| `unauthenticated`        | 密钥/状态/过期/格式失败                 |
| `origin_forbidden`       | Origin 不允许（403）                   |
| `environment_forbidden`  | environment 不允许（403）              |
| `temporarily_unavailable`| 数据库/verifier 暂时不可用（503）      |

## 15. ingestion-api adapter

`apps/ingestion-api` 创建私有 adapter（`src/postgres-request-authorizer.ts`）：

- 调用 `@aurora/ingestion-credentials` 包根；
- 映射 `authorized` → `authorized{projectId, allowedOrigin}`（`string|null` → 端口 `string|undefined`）；
- 映射 `unauthenticated` → `unauthenticated`；
- 映射 `origin_forbidden` → `originForbidden`；
- 映射 `environment_forbidden` → `environmentForbidden`；
- 映射 `temporarily_unavailable` → `temporarilyUnavailable`；
- 不记录原始 key；
- 不实现 SQL；
- 不访问凭证私有路径。

composition root：复用已拥有的 PostgreSQL Pool；构造真实 authorizer；不创建第二个 Pool；服务关闭时仍只关闭一次 Pool；`buildIngestionApi` 继续允许注入 fake authorizer；测试接口保持兼容；生产启动不再依赖永远允许的 authorizer。

现有 HTTP 语义必须保持：认证失败 → 401；Origin/environment 禁止 → 403；数据库或 verifier 暂时不可用 → 503；authorized 才允许继续解析和持久化；未授权请求不得调用 Inbox。

## 16. Pool 所有权

- `@aurora/ingestion-credentials` 只接受外部 Pool（或 `pool: Pool | PoolClient`），不创建、不关闭 Pool；
- `apps/ingestion-api` composition root 拥有 Pool，创建真实 authorizer 时复用该 Pool；`buildIngestionApi` 不创建 Pool；服务关闭时 Pool 只关闭一次。

## 17. 日志与隐私

- 不记录原始 key、secret、digest、数据库 URL、SQL、SQLSTATE、约束名、keyId、allowlist；
- 错误映射为稳定结果，不泄露数据库细节；
- 日志结构有界（沿用既有诊断约束）。

## 18. Migration

- 使用 `node-pg-migrate` 追加 Migration（不编辑已有 Migration）；
- 文件名稳定时间戳前缀 + kebab-case；
- 默认事务 Migration；
- 应用启动不自动迁移生产数据库；
- 已发布 Migration 只追加。

## 19. 单元测试

覆盖：

- 密钥格式（合法/错误前缀/缺失段/多余段/keyId 长度错误/secret 长度错误/非 base64url/padding/空格/大小写不归一化）；
- digest（固定 32 字节、相同 secret 相同 digest、不同 secret 不同 digest）；
- constant-time 比较（长度不同不抛错、相等/不等）；
- Origin 规范化（http/https、默认端口折叠、禁止 userinfo/query/fragment/path 非空或非 `/`、拒绝 `null`/wildcard）；
- 验证顺序与稳定结果判别；
- 不修改输入。

## 20. PostgreSQL 集成测试

真实 PostgreSQL 17 验证：

- 空 Schema Migration、版本检测；
- 表、列、约束和索引；
- `key_id` 唯一、digest 长度约束、status 约束、Origin 唯一、environment 唯一；
- raw secret 不存在于 Schema；
- 合法凭证 authorized；未知 key/错误 secret/disabled/revoked/expired → unauthenticated；
- Origin allowed / forbidden；缺失 Origin + allowNonBrowser false/true；
- environment allowed / forbidden；
- 数据库故障 → temporarilyUnavailable；
- 不同 project 的凭证互不影响；
- 测试 Schema 完整清理。

## 21. HTTP 集成测试

使用 ingestion-api 与真实 PostgreSQL：

- 合法凭证可进入 Inbox；错误 secret/未知 key/disabled/revoked/expired → 401；
- Origin 不允许 → 403；environment 不允许 → 403；non-browser 不允许 → 403；
- verifier 数据库失败 → 503；
- 未授权请求不调用 Inbox；
- accepted 仍只在 Inbox COMMIT 后返回；
- CORS 预检语义不变；
- `buildIngestionApi` fake authorizer 测试仍兼容；
- start composition root 只使用一个 Pool；shutdown 只关闭一次 Pool。

## 22. 覆盖率与质量门禁

- 包维持 TypeScript strict；覆盖率不低于 lines 85%、branches 80%、functions 85%、statements 85%；
- 包入口、私有路径负例、Workspace Policy、敏感信息扫描（无 raw key/secret/digest/数据库 URL/SQLSTATE/约束名）；
- `apps/ingestion-api` 既有测试全部保持通过（fake authorizer 兼容、HTTP 语义不变）。

## 23. 后续管理和轮换衔接

- 未来凭证管理模块负责创建、轮换、撤销，并保证策略不宽于项目级策略；
- `IngestionRequestAuthorizer` 端口保持不变，管理模块通过写 `ingestion_client_credentials` 表提供能力；
- 人工重放、Worker policy、SDK transport 继续按各自模块推进。

## 24. 排除范围

- 凭证创建/轮换/撤销管理 API、平台页面、管理员审计页面、邮件通知；
- Session、用户登录、管理平台认证；
- SDK transport、Worker policy、人工重放；
- CI、RDS、IaC、容量基准。

## 25. 规格自检

- **权威一致性**：Header 与密钥格式符合 ADR-009；HTTP 状态不变；Origin/environment 语义没有放宽；不修改 Inbox ACK；不修改 event-schema；不创建第二套认证协议；不实现用户 Session；
- **兼容性**：`buildIngestionApi` 测试注入能力保持；ingestion-api 公共 HTTP 契约不变；ingestion-inbox 不变；Worker 不变；新包不依赖 service 应用；service 只通过新包根导入；无循环依赖或私有路径；
- **计划质量**：每项安全要求有 Task 和测试；表名、列名、类型、状态和 API 全文一致；每个 Task 有 TDD 闭环；无占位；无管理 API、轮换或平台内容；
- **安全**：raw secret 永不持久化；SHA-256 输入和输出明确；`timingSafeEqual`；不存在 key 时枚举错误差异被 dummy 比较消除；Origin 精确匹配；environment 精确匹配；数据库失败不误报认证失败；日志不包含 secret/digest/body；测试数据库隔离。

自动审批依据：本文全部语义由 accepted ADR-008/009/010/011/013 与 approved OpenAPI、HTTP 服务规格无歧义派生；无新增产品/架构/安全/隐私决策；不修改 ADR-009 传输格式、Header、OpenAPI 状态码或 HTTP 语义；自检全部通过。
