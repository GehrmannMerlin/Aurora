---
title: PLT-03 Platform Identity, Authentication and Invitation
status: approved
owner: platform/identity
created: 2026-08-09
last-reviewed: 2026-08-09
applies-to: 管理平台身份、认证与邀请第一增量——A1 注册/邮箱验证、A2 登录/退出、A3 忘记/重置密码、A4 接受组织邀请、A5 账号安全中的修改密码；基于 accepted ADR-029/030/031/032 与 approved UX/PRD
related:
  - ../../adr/ADR-029-platform-database-access-and-migration.md
  - ../../adr/ADR-030-platform-session-csrf-password-physical-parameters.md
  - ../../adr/ADR-031-platform-email-delivery.md
  - ../../adr/ADR-032-platform-outbox-tasks-cache-objects.md
  - ../../adr/ADR-028-platform-session-csrf-security.md
  - ../superpowers/g10-approval-package.md
  - ../../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../superpowers/specs/2026-07-28-aurora-platform-backend-design.md
supersedes: none
superseded-by: none
---

# PLT-03 Platform Identity, Authentication and Invitation — 正式规格

## 1. 定位与效力

本规格是 G10 叶子 **PLT-03**（`feature/g10-identity-organization-governance` 分支，实施状态 41/37 目标）的正式实施依据。它把已批准的产品规则、accepted ADR-029/030/031/032、approved UX/PRD 与真实 `@aurora/platform-contract` 契约基础形式化为可执行规格。

**已批准决策（本规格不重新询问，权威优先级见 CLAUDE.md）：**

| 决策 | 来源 |
|---|---|
| PostgreSQL 17 + Kysely + node-pg-migrate + SQL-first | ADR-029（accepted） |
| Argon2id + 每密码唯一盐；Cookie HttpOnly/Secure/SameSite=Lax；Session 空闲≤30m/绝对≤8h；Redis noeviction 权威 Session；CSRF 自定义 Header + Origin/Fetch-Metadata；能力令牌短期限定；工作负载身份；Session ID SHA-256 摘要存储 | ADR-030（accepted） |
| EmailDeliveryPort + 单供应商适配器 + 复用通用 Outbox；送达非承诺；secret 不进 Git/日志/前端；禁止日志打印验证码/网页显示 reset token/fake email | ADR-031（accepted） |
| PostgreSQL 事务性 Outbox + Redis/BullMQ + 私有 S3；附 **YAGNI 实施约束**：仅当 approved 叶子规格确实需要、存在真实 consumer、且 ADR 明确要求时才 provision | ADR-032（accepted） |
| Session/CSRF 契约形状：HttpOnly 不透明 Session、同步 CSRF、认证级别、401/503/403/404 失败语义、A5/重置撤销全部 | ADR-028（accepted） |
| 回收站恢复安全规则、B6 私密令牌参数口径 | G10 APPROVAL PACKAGE（approved） |

**本规格不实现**：PLT-04（组织治理 B1-B8）、SEC-01（账号注销 A5 删除编排）、G11-G13。`identityDeleteAccountPreflight`/`identityDeleteAccount` 属于 SEC-01，保持 blocked。

## 2. 目标与非目标

### 目标

1. A1 注册 + 邮箱验证（register + email verification）；
2. A2 登录 + 退出（login/logout，含 Session 建立/旋转/撤销）；
3. A3 忘记密码/重置密码（forgot/reset password，含一次性 token + 有效期 + 撤销全部 Session）；
4. A4 接受组织邀请（accept invitation，含原子创建成员+项目权限、邮箱匹配、防枚举）；
5. A5 账号安全中的修改密码（change-password）；
6. 基于真实 PostgreSQL 17 + Redis 的 Session/CSRF/密码物理实现；
7. EmailDeliveryPort + 供应商适配器 + Outbox 邮件交付；
8. 从 `BLOCKED_OPERATIONS` 解锁 8 个身份操作 + `organizationAcceptInvitation`，生成真实 OpenAPI/client/server；
9. Console 真实注册/登录/验证/重置/邀请/修改密码 UI（逐步替换 unavailable 页）；
10. 全量自动化测试：unit/migration/integration（真实 PG + Redis）/browser/security-negative/coverage。

### 非目标

- 不做 SSO/OAuth/2FA/passkey/magic-link（PRD 明确 deferred）；
- 不做 PLT-04 组织治理（B1-B8）；
- 不做 SEC-01 账号注销（A5 删除编排）；
- 不做设备管理/异常登录分析（PRD deferred）；
- 不实现 B5 Resource Usage 真实 Query（DAT-21 缺失，前端 unavailable）；
- 不创建无 consumer 的 Redis/缓存/对象存储/后台基础设施（ADR-032 YAGNI 约束）。

## 3. 系统边界与包结构

### 3.1 依赖方向（accepted ADR-002/006 + Workspace Policy）

```
apps/console (console 层)
  → packages/platform-contract (contract 层, client)
apps/platform-api (service 层)
  → packages/platform-contract (contract 层, server)
  → packages/platform-identity (data 层)
  → packages/platform-session (data 层)
  → packages/platform-email (data 层)
packages/platform-identity (data 层)
  → packages/platform-contract (contract 层, 仅类型/常量)
  → node-pg-migrate/pg (dev 迁移)
apps/platform-worker (service 层)
  → packages/platform-email (data 层)  — Outbox 消费
  → packages/platform-contract (contract 层)
```

- `console` 层禁止依赖 `data`/`service` 内部包；
- `platform-identity` 等 data 层包只允许依赖 `contract` 层与运行时工具；
- `apps/platform-api`/`platform-worker` 是 service 层，是唯一 HTTP/后台入口。

### 3.2 新包（真实创建，镜像 `@aurora/ingestion-credentials` 结构）

| 包 | 层 | 职责 |
|---|---|---|
| `packages/platform-identity` | data | 账号、密码摘要、验证意图、重置意图、邀请、审计、幂等记录、Outbox 的 Migration + Repository |
| `packages/platform-session` | data | Redis 权威 Session（创建/旋转/撤销/撤销全部/校验）、CSRF 绑定、Session ID SHA-256 摘要 |
| `packages/platform-email` | data | `EmailDeliveryPort` 接口、供应商适配器、Outbox 消费（worker 调用） |
| `apps/platform-api` | service | Fastify HTTP 服务：全部 PLT-03 操作 handler、Session Cookie、CSRF、Origin 校验 |
| `apps/platform-worker` | service | Outbox 邮件发送消费者（轮询 + 租约 + 重试，非 BullMQ 独立队列，遵循 YAGNI） |

> **YAGNI 决策（ADR-032 约束）**：PLT-03 邮件交付存在真实 consumer（验证/重置/邀请），Outbox 表（PostgreSQL）+ 简单 Worker 轮询即可满足"可靠异步交付"；**不创建独立 Redis/BullMQ 队列、不创建 S3/对象存储**（本叶子无对象存储 consumer）。Redis 仅用于 Session（ADR-030 明确要求，真实 consumer 存在）。Preview 部署为私有 Docker network 内的 Redis container，无公网 6379。

## 4. 数据模型（基于 ADR-029，真实 Migration）

### 4.1 `accounts` 表

| 列 | 类型 | 约束 |
|---|---|---|
| `account_id` | uuid PK | `gen_random_uuid()` |
| `email` | text | `NOT NULL` UNIQUE，**规范化后存储**（小写 + trim + 域名规范） |
| `email_normalized` | text | `NOT NULL` UNIQUE（`lower(trim(email))` 的确定性形式，用于匹配与防枚举） |
| `verified_at` | timestamptz | NULL = 未验证 |
| `security_version` | integer | `NOT NULL DEFAULT 0`，密码变更/重置时递增（Session 失效语义） |
| `status` | text | `NOT NULL DEFAULT 'active'`，CHECK IN ('active','pending_verification','deletion_cooling','terminated') |
| `created_at` / `updated_at` | timestamptz | `NOT NULL DEFAULT now()` |

### 4.2 `account_credentials` 表（密码摘要）

| 列 | 类型 | 约束 |
|---|---|---|
| `account_id` | uuid PK/FK | → `accounts.account_id` |
| `password_hash` | text | `NOT NULL`，Argon2id 编码串（含盐+参数），**绝不存储明文** |
| `password_version` | integer | `NOT NULL DEFAULT 1` |
| `changed_at` | timestamptz | `NOT NULL DEFAULT now()` |

### 4.3 `email_verification_intents` 表（邮箱验证意图）

| 列 | 类型 | 约束 |
|---|---|---|
| `intent_id` | uuid PK | `gen_random_uuid()` |
| `account_id` | uuid FK | → `accounts.account_id` |
| `token_digest` | text | `NOT NULL` UNIQUE，**SHA-256(token)**，不存原始 token |
| `expires_at` | timestamptz | `NOT NULL`，短期（如 2h） |
| `consumed_at` | timestamptz | NULL = 未消费；一次性 |
| `created_at` | timestamptz | |

### 4.4 `password_reset_intents` 表（重置意图）

| 列 | 类型 | 约束 |
|---|---|---|
| `intent_id` | uuid PK | `gen_random_uuid()` |
| `account_id` | uuid FK | → `accounts.account_id` |
| `token_digest` | text | `NOT NULL` UNIQUE，**SHA-256(token)** |
| `expires_at` | timestamptz | `NOT NULL`，短期（如 2h） |
| `consumed_at` | timestamptz | NULL = 未消费；一次性 |
| `created_at` | timestamptz | |

### 4.5 `organizations` 表（个人工作空间 + 组织；PLT-03 只建基础 + 邀请所需字段）

| 列 | 类型 | 约束 |
|---|---|---|
| `organization_id` | uuid PK | `gen_random_uuid()` |
| `name` | text | `NOT NULL` |
| `kind` | text | `NOT NULL` CHECK IN ('personal','organization') |
| `timezone` | text | `NOT NULL DEFAULT 'UTC'`（B4 归属 PLT-04，默认值即可） |
| `created_at` / `updated_at` | timestamptz | |

### 4.6 `organization_members` 表（成员 + Owner；PLT-03 只建接受邀请所需）

| 列 | 类型 | 约束 |
|---|---|---|
| `organization_id` | uuid FK | PK 部分 |
| `account_id` | uuid FK | PK 部分 |
| `role` | text | `NOT NULL` CHECK IN ('owner','admin','member') |
| `created_at` | timestamptz | |

> **Owner 不变量**：每个 `kind='personal'` 组织有且只有一个 `role='owner'`（注册时原子创建）。`kind='organization'` 同样要求唯一 Owner（invitation 接受后由邀请设置）。

### 4.7 `organization_invitations` 表（PLT-03 接受侧）

| 列 | 类型 | 约束 |
|---|---|---|
| `invitation_id` | uuid PK | `gen_random_uuid()` |
| `organization_id` | uuid FK | → `organizations` |
| `invited_email` | text | `NOT NULL`，规范化 |
| `org_role` | text | `NOT NULL` CHECK IN ('owner','admin','member') |
| `token_digest` | text | `NOT NULL` UNIQUE，**SHA-256(token)** |
| `expires_at` | timestamptz | `NOT NULL`，默认 7 天 |
| `status` | text | `NOT NULL` CHECK IN ('pending','accepted','revoked','expired') |
| `accepted_at` | timestamptz | NULL |
| `created_at` | timestamptz | |

> **唯一有效邀请**：`(organization_id, invited_email)` 上唯一索引——仅当 status='pending' 时唯一（partial unique index）。

### 4.8 `project_members` 表（邀请接受的原子项目权限；PLT-03 只建接受写入）

| 列 | 类型 | 约束 |
|---|---|---|
| `project_id` | uuid FK | PK 部分 |
| `account_id` | uuid FK | PK 部分 |
| `role` | text | `NOT NULL` CHECK IN ('project_admin','developer','read_only') |
| `created_at` | timestamptz | |

> 注：PLT-04 才实现项目创建/管理；PLT-03 的邀请接受需要真实写入项目权限（PRD §4.3"接受邀请时一次性创建组织成员和项目权限"）。项目行由 B2 创建，但邀请接受的原子写入在 PLT-03 必须存在真实表结构。

### 4.9 `security_audit_events` 表（审计；PLT-03 只写身份安全事件）

| 列 | 类型 | 约束 |
|---|---|---|
| `event_id` | uuid PK | `gen_random_uuid()` |
| `organization_id` | uuid | NULL（身份事件可无 org） |
| `actor_account_id` | uuid | NULL（注册等无 actor） |
| `action` | text | `NOT NULL`，如 `account.registered`、`email.verified`、`password.reset`、`invitation.accepted` |
| `target_account_id` | uuid | NULL |
| `occurred_at` | timestamptz | `NOT NULL DEFAULT now()` |
| `details` | jsonb | `NOT NULL DEFAULT '{}'`，**绝不包含密码/token/完整邮箱** |

### 4.10 `idempotency_records` 表（幂等）

| 列 | 类型 | 约束 |
|---|---|---|
| `idempotency_key` | text PK | `NOT NULL` |
| `operation` | text | `NOT NULL` |
| `request_digest` | text | `NOT NULL`（规范化请求 SHA-256） |
| `status` | text | `NOT NULL` CHECK IN ('processing','succeeded','failed') |
| `result_data` | jsonb | NULL |
| `created_at` / `updated_at` | timestamptz | |

### 4.11 `outbox` 表（ADR-032 通用 Outbox；PLT-03 邮件）

| 列 | 类型 | 约束 |
|---|---|---|
| `outbox_id` | uuid PK | `gen_random_uuid()` |
| `aggregate_type` | text | `NOT NULL`，如 `email.verification`、`email.password_reset`、`email.invitation` |
| `aggregate_id` | uuid | NULL |
| `payload` | jsonb | `NOT NULL`；含收件人掩码、意图类型、幂等键、模板数据；**含一次性高熵 token（用于邮件链接渲染）** |
| `status` | text | `NOT NULL` CHECK IN ('pending','processing','succeeded','failed','dead_lettered') |
| `attempt_count` | integer | `NOT NULL DEFAULT 0` |
| `available_at` | timestamptz | `NOT NULL DEFAULT now()` |
| `created_at` / `updated_at` | timestamptz | |

> **token 暂存语义（诚实设计）**：邮件链接必须携带一次性 token（用户点击），而发送是异步的，因此原始 token 必须经 Outbox 到达 Worker 以渲染邮件。权威意图表（4.3/4.4/4.7）只存 **SHA-256 摘要**；Outbox payload 暂存的一次性 token 是**短期（如 ≤2h）+ 单次使用 + 高熵随机**，随发送完成即清理，暴露窗口受此限制。这是"服务端权威只存摘要"与"邮件必须携带 token"两条 approved 规则的唯一一致实现。

## 5. 密码与 Session 安全（accepted ADR-030）

### 5.1 Argon2id

- 密码哈希用 **Argon2id**，每密码唯一盐（≥16 字节 CSPRNG）；
- 参数按 OWASP 2026 当前推荐并以仓库 benchmark 微调；默认值写入配置（如 `m=19456, t=2, p=1`，可配置）；
- **密码绝不写入日志、URL、前端 Store、MSW fixture、Playwright trace**；
- 校验失败与不存在账号返回统一结果（防枚举）。

### 5.2 Session（Redis 权威）

- 高熵随机不透明 Session ID（≥32 字节 CSPRNG）；
- Cookie：`HttpOnly` + `Secure` + `SameSite=Lax` + 无 `Domain` + `Path=/`；
- **Redis 只存 Session ID 的 SHA-256 摘要**（ADR-030 决定细节 9），绝不存原始值；
- Session 数据：`accountId`、`authLevel`、`expiresAt`、`rotationDueAt`、`csrfSecret`；
- Redis `maxmemory-policy noeviction`；隔离命名空间（`aurora:platform:session:*`）；
- Redis 不可用 → 受保护操作 503 失败关闭，不伪装 401；
- **登录成功旋转 Session ID**（旧摘要删除，新摘要写入）；
- **退出立即撤销当前 Session**；
- **密码重置/修改密码 → 撤销该账号全部 Session**（security_version 递增 + Redis 批量删除该账号 session key）。

### 5.3 CSRF

- 同步 CSRF token 绑定 Session，`identityGetSession` 返回；
- 非安全方法（POST/PATCH/DELETE）用自定义 Header `X-Aurora-CSRF` 提交；
- 校验 Header 值 == Session 的 CSRF secret（constant-time）；
- 校验 `Origin`/目标 Origin 与适用 `Fetch-Metadata`；
- CSRF 校验失败 → 403；
- 登录前/无 Session 的公开 Command（register/login/request-reset）→ 无 Session CSRF 需求，但受 rate-limit 与 anti-abuse 保护。

### 5.4 认证级别（accepted ADR-028）

- `public`：session, register, login, request-password-reset；
- `intent`：GET 验证/重置/邀请链接 → 建立短期 HttpOnly intent，清理原始 token，重定向干净 URL；
- `session`：change-password, logout, confirm-email-verification（需 session）, confirm-password-reset（intent + session 均可但需 CSRF）, accept-invitation（需 session + email 匹配）；
- `recent-verification`：SEC-01 用，本叶子不实现。

## 6. EmailDeliveryPort 与 Outbox（accepted ADR-031/032）

### 6.1 端口契约

```ts
export type EmailIntentType = 'email_verification' | 'password_reset' | 'organization_invitation';

export interface EmailDeliveryRequest {
  readonly intentType: EmailIntentType;
  readonly toAddress: string;        // 规范化收件邮箱
  readonly toAddressMasked: string;  // 服务端掩码
  readonly templateData: {           // 绝不含 token 明文/密码/secret
    readonly maskedEmail: string;
    readonly intentTokenReference: string; // 意图 ID（非 token）
    readonly expiresInMinutes: number;
  };
}

export interface EmailDeliveryPort {
  readonly deliver: (request: EmailDeliveryRequest) => Promise<EmailDeliveryResult>;
}
export type EmailDeliveryResult = { status: 'enqueued' } | { status: 'failed'; reason: string };
```

### 6.2 Outbox 写入（事务内）

- 业务事务（注册/请求重置/邀请创建）**同事务**写入 `outbox` 行（payload 只存引用与掩码，**绝不存 token 明文**）；
- `available_at = now()` 立即可用；送达非承诺——`enqueued` 不代表收件箱到达；
- Worker 轮询 `pending` + `available_at <= now()` → 标记 `processing` → 调用 `EmailDeliveryPort.deliver` → `succeeded`/`failed`（重试）→ 超限 `dead_lettered`。

### 6.3 供应商适配器（accepted ADR-031）

- 定义 `EmailDeliveryPort` 实现；具体供应商（阿里云 DirectMail / SES / Resend 等）由用户授权注册，secret 只在服务端环境变量/GitHub approved store，**绝不进 Git/日志/前端**；
- **Preview 门禁**：真实 provider credential 缺失时输出 `EMAIL_PROVIDER_CREDENTIAL_ACTION_REQUIRED`（含：哪个 accepted provider、用户去哪个服务完成什么、创建什么 credential 名、credential 放哪里、不得把 secret 粘贴到聊天）。所有不依赖 secret 的工作（契约/迁移/Repository/Outbox/Worker/测试/UI）先行完成；只有公网 E2E 真正需要时才输出该门禁。
- **禁止**：日志打印验证码/重置 token、网页显示 raw token、fake email 冒充真实交付。

## 7. OpenAPI / 契约（基于 PLT-01 真实基础）

### 7.1 解锁操作（从 BLOCKED → PLATFORM_OPERATIONS stable）

| operationId | 方法/路径 | authLevel | CSRF | idempotency | page |
|---|---|---|---|---|---|
| `identityRegister` | POST `/api/platform/v1/auth/register` | public | 否 | 是 | auth.register |
| `identityConfirmEmailVerification` | POST `/api/platform/v1/auth/email/confirm` | intent | 是 | 是 | auth.verify-email-confirm |
| `identityLogin` | POST `/api/platform/v1/auth/login` | public | 否 | 是 | auth.login |
| `identityLogout` | POST `/api/platform/v1/auth/logout` | session | 是 | 否 | auth.login |
| `identityRequestPasswordReset` | POST `/api/platform/v1/auth/password/request` | public | 否 | 是 | auth.forgot-password |
| `identityConfirmPasswordReset` | POST `/api/platform/v1/auth/password/confirm` | intent | 是 | 是 | auth.reset-password |
| `identityChangePassword` | POST `/api/platform/v1/auth/password/change` | session | 是 | 是 | account.security |
| `organizationAcceptInvitation` | POST `/api/platform/v1/invitations/accept` | session | 是 | 是 | invitation.accept |

> **authLevel 语义**：`intent` = 邮件链接 GET 建立的短期 HttpOnly intent cookie 是认证机制（UX §7.2/§7.5/§7.6）。`identityConfirmEmailVerification`/`identityConfirmPasswordReset` 用 `intent`：确认成功时若存在匹配该账号的 Session 则旋转（验证场景）/撤销（重置场景，ADR-030），无 Session 则完成操作后要求登录。`organizationAcceptInvitation` 用 `session`（必须已登录且账号邮箱与邀请邮箱规范匹配），但接受动作只对**本次访问建立的邀请 intent** 有效（UX §7.6 不自动接受）。
>
> 各操作 schema 模块放 `packages/platform-contract/src/identity/<name>.ts`（如 `register.ts`、`login.ts`、`password.ts`、`invitation.ts`），导出 `OPERATION_ID_*` + `*Request`/`*Response` SchemaDef；注册进 `PLATFORM_OPERATIONS`，从 `BLOCKED_OPERATIONS` 移除，`index.ts` re-export；运行 `pnpm platform-contract:generate` 生成 OpenAPI + manifest，`platform-contract:drift` 门禁通过。

### 7.2 关键请求/响应形状（草案，实施计划精化）

- `identityRegisterRequest`: `{ email, password, idempotencyKey }`；`identityRegisterResponse`: `{ accountId, workspaceId, emailMasked, verificationStatus, resendAvailableAt?, serverTime }`；
- `identityLoginRequest`: `{ email, password, idempotencyKey }`；`identityLoginResponse`: `{ account, authentication, session, csrf, navigation, continuation? }`；
- **意图消费（不携带原始 token）**：验证/重置/邀请的邮件链接 GET 建立短期 HttpOnly intent（含该 intent 的 CSRF 绑定），并清理原始 token、重定向干净 URL。最终确认是 CSRF 保护的 POST，请求体**只含意图所需字段**（如重置的新密码），**不含原始 token**——意图身份由 HttpOnly intent cookie 承载（ADR-028 §决定细节 6、UX §8.1/§7.6）；
- `identityConfirmEmailVerificationRequest`: `{}`（intent cookie + CSRF header）；响应 `{ verificationStatus, account }`；
- `identityConfirmPasswordResetRequest`: `{ newPassword }`（intent cookie + CSRF header）；响应 `{ status: 'succeeded' }`（不自动登录）；
- `organizationAcceptInvitationRequest`: `{}`（intent cookie + CSRF header）；响应 `{ organization, membership, navigationTargets }`；
- 所有响应是 **closed object**（strict zod，`additionalProperties:false`），不泄漏 passwordHash/sessionId/token/roles。

## 8. Console 页面（逐步替换 unavailable）

真实实现（Vue 3 + Aurora UI 包装层 + generated client）：
- `/register`（A1）：email + password + register 按钮；成功 → `/verify-email`；
- `/verify-email`（A1）：masked email + verificationStatus + resend（服务端冷却）+ skip 进入受限 workspace；
- `/verify-email/confirm`（A1）：intent 状态 + 显式 Confirm + 成功/过期/无效/已验证/不可用；
- `/login`（A2）：email + password + login；成功导航优先级：邀请 intent → returnTo → /workspace；错误不泄漏账号存在性；
- `/forgot-password`（A3）：email + 统一结果 + 服务端冷却；不泄漏账号存在；
- `/reset-password`（A3）：new password + confirm（无确认字段重复）；成功 → /login；
- `/invitations/accept`（A4）：masked invited email + 权限摘要（只读）+ Accept 按钮；邮箱不匹配显示 masked email + switch account（不自动登出）；
- `/account/security`（A5）：change-password 表单（当前密码 + 新密码）+ logout 按钮；独立 Command/status/反馈。

全部页面实现 loading/error/forbidden/processing/partial/stale/unavailable 状态，危险操作不乐观成功，一次性秘密不进 Store/URL/日志。

## 9. 失败语义与错误映射（RFC 9457 + accepted ADR-028）

| 场景 | HTTP | code |
|---|---|---|
| 结构性请求无效 | 400 | structural_error |
| Session 缺失/过期/撤销 | 401 | authentication（含安全登录目标） |
| CSRF 失败 | 403 | authorization |
| 权限不足（邮箱不匹配等） | 403/404 | authorization / not_found（防枚举） |
| 资源不存在 | 404 | not_found |
| 业务冲突（email 已注册/邀请已过期） | 409 | business_validation / state_machine_conflict |
| 幂等键冲突（同键不同请求） | 409 | idempotency_conflict |
| 版本冲突 | 412 | version_conflict |
| 字段校验失败 | 422 | field_validation |
| 限频 | 429 | rate_limited（retryAfter 仅安全时） |
| Redis 不可用 | 503 | authority_unavailable（失败关闭） |
| 下游部分失败 | 503 | downstream_partial_failure |

**防枚举**：register/login/request-reset/confirm 的公开结果不随账号是否存在而变化。

## 10. 验收门禁（verification-before-completion）

| 类别 | 门禁 |
|---|---|
| unit | 各包 vitest：Argon2id、token digest、intent 过期、幂等、防枚举、email port、outbox 状态机、Session rotate/revoke/revoke-all、CSRF constant-time |
| migration | node-pg-migrate up/down 幂等（真实 PostgreSQL 17） |
| real PostgreSQL integration | Repository 集成（accounts/credentials/intents/invitations/audit/idempotency/outbox） |
| Session/CSRF | Redis 真实集成：创建/旋转/撤销/撤销全部/503 失败关闭 |
| HTTP integration | `apps/platform-api` Fastify `app.inject`：register→verify→login→logout→reset→change-password→accept-invitation 全流程（真实 PG+Redis） |
| contract/codegen | OpenAPI lint、drift 门禁、manifest stable 列表更新 |
| package-entry | `@aurora/platform-contract test:package` + 新包 package-entry |
| Console | vitest + Playwright（真实浏览器）+ axe；register/login/reset/invitation/change-password 流程 |
| security-negative | 密码不落日志、token 不落 URL/Store、防枚举（统一结果）、CSRF 负例、Session 撤销负例、Redis down→503 |
| coverage | 各包阈值（branches 75/functions 80/lines 80/statements 80） |
| root | format/lint/typecheck/boundaries/build/git diff --check |

## 11. 完成定义

PLT-03 completed 当且仅当：

1. 8 个操作从 blocked → stable，OpenAPI/client/server 真实生成，drift 门禁通过；
2. PostgreSQL 17 Migration 真实存在（11 张表），up/down 幂等；
3. Argon2id/Session/CSRF 物理实现符合 ADR-030（含 Session ID 摘要、Redis noeviction、503 失败关闭）；
4. EmailDeliveryPort + Outbox + Worker 真实存在（不泄露 token/secret，送达非承诺）；
5. Console 8 个真实页面（非 unavailable）通过 Playwright + axe；
6. 全部门禁新鲜通过（unit/migration/integration/browser/security-negative/coverage/boundaries）；
7. **独立验收通过**（verification-before-completion）；
8. 叶子计数 40/38 → **41/37**。

## 12. 与相邻叶子的边界

- **PLT-04**：组织创建/项目管理/成员管理/时区/令牌/审计/回收站 → 本叶子只建邀请接受所需的 organizations/members/project_members 基础表与 `organizationAcceptInvitation`；其余 B 操作保持 blocked。
- **SEC-01**：`identityDeleteAccountPreflight`/`identityDeleteAccount` 保持 blocked；本叶子不实现注销编排、不建 deletion 状态机表。
- **B5 Usage**：`usageGetSummary` 保持 blocked；本叶子不实现、不造假。

## 13. 固定回读与权威边界

本规格是 PLT-03 的唯一实施依据，合并以下权威：

- PRD §4.1-4.3（账号/组织/邀请）、§13（权限与安全）、§19.1（必须完成）；
- UX §7.2-7.6、§8.1-8.5、§9.1-9.5、§10.2.1、§11.1-11.4；
- backend design §4/§5/§6 A1-A5/§7/§8；
- ADR-028/029/030/031/032（accepted）；
- G10 APPROVAL PACKAGE（approved product rules）；
- 真实 `packages/platform-contract` 契约基础与 `apps/console` 壳层。

**不变量（任何实现不得违反）**：

- 密码/token/session/CSRF secret 绝不进入日志、URL、前端 Store、MSW fixture、Playwright trace；
- 公开结果绝不泄漏账号存在性（防枚举）；
- Session 权威在 Redis，Redis down → 503 失败关闭；
- Email Outbox = 送达非承诺；不建无 consumer 基础设施（YAGNI）；
- 不实现 PLT-04/SEC-01/G11-G13 能力。
