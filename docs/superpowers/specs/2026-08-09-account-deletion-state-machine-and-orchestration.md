---
title: SEC-01 A5 Account Deletion State Machine and Orchestration
status: approved
owner: platform/security
created: 2026-08-09
last-reviewed: 2026-08-09
applies-to: 管理平台 A5 账号注销的机器契约与权威状态机——注销预检、双重身份复核、唯一 Owner 阻塞、7 天冷静期、撤销、全部 Session 终止、账号访问限制、持久化清理交接与审计；基于 accepted ADR-028/029/030/032、approved A5 安全规则与 PLT-03/04 真实实现
related:
  - ../../adr/ADR-028-platform-session-csrf-security.md
  - ../../adr/ADR-029-platform-database-access-and-migration.md
  - ../../adr/ADR-030-platform-session-csrf-password-physical-parameters.md
  - ../../adr/ADR-032-platform-outbox-tasks-cache-objects.md
  - ../superpowers/g10-approval-package.md
  - ../superpowers/specs/2026-07-29-aurora-account-deletion-data-lifecycle-design.md
  - ../superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md
  - ../superpowers/specs/2026-08-09-platform-workspace-organization-governance.md
  - ../../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../security/account-deletion-and-data-lifecycle.md
supersedes: none
superseded-by: none
---

# SEC-01 A5 Account Deletion State Machine and Orchestration — 正式规格

## 1. 定位与效力

本规格是 G10 叶子 **SEC-01**（A5 账号注销状态机与编排）的正式实施依据。它把 approved A5 产品/安全规则（A5-001—011 + `account-deletion-and-data-lifecycle.md`）、accepted ADR-028/029/030/032、approved UX/PRD 与真实 `@aurora/platform-identity`/`platform-session`/`platform-organization`/`platform-audit`/`platform-contract` 实现形式化为可执行规格。PLT-03（身份/认证/邀请）与 PLT-04（组织/项目/成员/治理）均已关闭（42/36），本规格构建于其真实表与能力之上。

**已批准决策（本规格不重新询问）：**

| 决策 | 来源 |
|---|---|
| PostgreSQL 17 + Kysely + node-pg-migrate + SQL-first；data → {protocol} 边界 | ADR-029（accepted） |
| Redis 权威 Session（SHA-256 摘要存储、noeviction、503 失败关闭）、`revokeAllAccountSessions`、CSRF 同步令牌 | ADR-030/028（accepted） |
| 通用事务性 Outbox；**YAGNI 实施约束**：仅当有真实 consumer 且 ADR 明确要求时才 provision | ADR-032（accepted） |
| A5-001—011：两阶段注销、7 天（168h）冷静期、双重身份复核、全部 Session 终止、唯一 Owner 阻塞、组织关系冻结、普通业务匿名保留、一年审计、7 天在线清理、35 天备份淘汰 | `account-deletion-and-data-lifecycle.md`（approved） |
| 注销预检是 UX 提前反馈，最终 `DeleteAccount` Command 服务端重新校验；A5 不内嵌继任者/不自动转让/不级联删除 | UX §7.7/§8.5/§9.5（approved）+ G10 package |

**本规格不实现**：SEC-02（跨存储物理删除传播、对象存储清理、Redis/BullMQ 全部清理、备份物理淘汰、恢复重放）、OPS-07（删除重放验证）。本规格只负责：机器契约、注销预检、双重身份复核、唯一 Owner 阻塞、注销受理、7 天冷静期、撤销、全部 Session 终止、账号访问限制、**持久化的清理交接 intent** 与审计。

## 2. 目标与非目标

### 目标

1. 把 `identityDeleteAccountPreflight` / `identityDeleteAccount` 从 blocked 解锁为 stable，生成真实 OpenAPI/client/server；
2. 权威账号注销状态机（`active` → `deletion_cooling` → `terminated`），服务端权威时间戳驱动 168 小时冷静期；
3. 双重身份复核：当前密码重验 + 发送到已验证邮箱的一次性确认（复用 PLT-03 意图流模式）；
4. 唯一 Owner 预检与最终服务端复检；阻塞组织清单只返回最小可识别信息与安全转让目标；
5. 注销受理后全部 Session 终止 + 账号停止正常登录/业务访问（冷却期冻结组织关系，禁止新授权）；
6. 冷静期内专用撤销流程（同样双重复核）；撤销后账号回到 active，既有关系恢复，但已终止 Session 继续无效；
7. 跨过不可逆边界前再次检查唯一 Owner；通过后进入 `terminated` 并持久化清理交接 intent；
8. 高风险事件（预检阻塞、申请、撤销、Session 终止、进入不可逆、交接创建）写入安全审计，不写密码/邮箱/令牌明文；
9. Console A5 注销危险区（预检 → 阻塞清单 → 双重确认 → 受理/撤销 → 冷静期状态展示）。

### 非目标

- SEC-02 跨存储物理删除、对象存储清理、Redis/BullMQ 全量清理、备份淘汰、恢复重放验证；
- 设备/Session 列表、批量退出、异常登录分析、内嵌继任者选择、跨组织批量转让、自动提升、级联删除组织/项目、账号数据导出（PRD/UX deferred）；
- `recent-verification` 认证级别与 SSO/2FA/passkey（`requires-benchmark` + 安全评审门禁，不在本叶子）；
- 真实删除任务 Worker（BullMQ）——本叶子只持久化交接 intent，消费/执行属于 SEC-02。

## 3. 系统边界与包结构

### 3.1 依赖方向（accepted ADR-002/006 + Workspace Policy）

```
apps/console (console 层) → packages/platform-contract (contract 层, client)
apps/platform-api (service 层)
  → packages/platform-contract (contract 层, server)
  → packages/platform-identity (data 层)     — 复用账号/审计/事务；新增注销 Repository（可放此包或新包）
  → packages/platform-session (data 层)       — revokeAllAccountSessions
  → packages/platform-organization (data 层)  — 唯一 Owner/成员查询
packages/platform-identity (data 层) → node-pg-migrate/pg
```

- **data 层只允许依赖 protocol 层**（Workspace Policy `graph.ts`）。注销状态与 Repository 落在 `@aurora/platform-identity`（data 层）或独立 data 包；`platform-api` handler 在 service 层消费契约类型并把纯值传给 data 层 Repository（PLT-03/04 已验证模式）。
- `apps/platform-api` 是唯一消费契约 + data 包的 service 层；新 handler 沿用 `parseInput`/`serializeOutput`、Session/CSRF/Origin 插件、`runIdempotentCommand`、全局 RFC 9457 error handler。
- `apps/platform-worker` **本轮不新增消费逻辑**（交接 intent 由未来 SEC-02 consumer 消费；不得让现有邮件 Outbox consumer 处理非邮件行）。

### 3.2 新表（Migration，基于 ADR-029 工具链）

#### `account_deletion_intents`（双重复核的一次性邮箱确认）

| 列 | 类型 | 约束 |
|---|---|---|
| `intent_id` | uuid PK | `gen_random_uuid()` |
| `account_id` | uuid FK | → `accounts.account_id`，`NOT NULL` |
| `intent_kind` | text | `NOT NULL` CHECK IN ('deletion_request','deletion_cancel') |
| `token_digest` | text | `NOT NULL` UNIQUE（SHA-256，不存原始 token） |
| `expires_at` | timestamptz | `NOT NULL`（短期，如 2h） |
| `consumed_at` | timestamptz | NULL = 未消费；一次性 |
| `created_at` | timestamptz | `NOT NULL DEFAULT now()` |

> 不新增独立 `account_deletions` 状态表：权威注销状态直接由 `accounts.status`（CHECK 已含 `deletion_cooling`/`terminated`）+ 新增时间戳列承载（见 §4.1）。这避免双表状态分裂。

#### `accounts` 扩展（Migration 追加列）

| 列 | 类型 | 约束 |
|---|---|---|
| `deletion_requested_at` | timestamptz | NULL（注销受理时刻） |
| `deletion_cooling_ends_at` | timestamptz | NULL（= requested_at + 168h） |
| `deletion_terminated_at` | timestamptz | NULL（进入不可逆/终态时刻） |

> `deletion_terminated_at` 同时充当"已进入不可逆阶段"标记；`accounts.status = 'terminated'` 表示终态（在线主存已确认清理或等待 SEC-02 完成跨系统清理）。本叶子只把状态推进到 `terminated` 并创建交接 intent；跨系统清理完成确认属于 SEC-02。

#### `account_cleanup_handoffs`（持久化清理交接 intent）

| 列 | 类型 | 约束 |
|---|---|---|
| `handoff_id` | uuid PK | `gen_random_uuid()` |
| `account_id` | uuid FK | → `accounts.account_id`，`NOT NULL`，UNIQUE（每账号至多一个活跃交接） |
| `status` | text | `NOT NULL` DEFAULT 'pending' CHECK IN ('pending','in_progress','succeeded','failed','dead_lettered') |
| `required_lifecycle` | jsonb | `NOT NULL`（冻结的所需生命周期 intent：7 天在线清理、1 年审计、35 天备份淘汰等） |
| `attempt_count` | integer | `NOT NULL` DEFAULT 0 |
| `created_at` / `updated_at` | timestamptz | `NOT NULL DEFAULT now()` |

> 这是"真实、可恢复、可审计的 orchestration intent"。未来 SEC-02 的 consumer 可以 claim/retry/识别账号/知道所需生命周期/审计/续跑。**不是**"只打印一条日志"。本叶子不实现 SEC-02 的物理清理，但测试必须证明 `deletion transition + handoff creation` 在同一事务/一致语义内完成。

## 4. 权威状态机

### 4.1 状态与字段

`accounts.status` CHECK 已允许：`active`、`pending_verification`、`deletion_cooling`、`terminated`。

| 状态 | 用户语义 | 可登录/业务访问 | 可撤销 | 退出条件 |
|---|---|---|---|---|
| `active` | 账号正常 | 是 | 不适用 | 注销受理 |
| `deletion_cooling` | 注销已受理，账号停止使用 | 否（登录拒绝；冻结关系） | 是（专用撤销流程） | 受理后 168h 届满且最终检查通过 → `terminated`；或撤销 → `active` |
| `terminated` | 已跨不可恢复边界 | 否 | 否 | 终态（SEC-02 完成跨系统清理确认） |

### 4.2 状态迁移

```
active
  │  preflight(最新完整无阻塞) + 密码复核 + 邮箱一次性确认 + 危险确认
  │  + 服务端最终唯一 Owner 复检通过
  ▼
deletion_cooling
  │  requested_at 权威时间戳；cooling_ends_at = requested_at + 168h
  │  全部 Session 终止（revokeAllAccountSessions + incrementSecurityVersion）
  │  登录拒绝；业务访问拒绝；关系冻结
  ├─ 冷静期内 + 密码复核 + 邮箱一次性确认（deletion_cancel）→ active（关系恢复；已终止 Session 无效）
  └─ 168h 届满 + 最终唯一 Owner 复检通过 → terminated
        │  + 持久化 account_cleanup_handoffs（status=pending）
        ▼
terminated（终态；SEC-02 跨系统清理）
```

**失败/重试语义**：

- 预检陈旧/部分/不可用 → 失败关闭，不进入确认阶段；
- 冷静期届满但唯一 Owner 复检失败 → **不得**进入 `terminated`；账号继续停止使用，撤销流程保持可用；
- 撤销请求在 `deletion_cooling` 之外 → 稳定 409 `state_machine_conflict`；
- 受理/撤销/进入终态均幂等（`runIdempotentCommand`）；跨不可逆边界前的复检以事务内重新读取为准。

**推进触发（无 Worker 的 lazy finalization）**：SEC-01 不引入 Worker。`deletion_cooling → terminated` 的推进由**服务端权威的 lazy 最终化**完成：任何注销相关操作（预检、撤销、或 console 重新检查）在读取到 `status='deletion_cooling'` 且 `now() >= deletion_cooling_ends_at` 时，调用确定性纯函数 `decideDeletionFinalization(account, now, ownerBlocked)`：
- 返回 `finalize`（未阻塞、已届满）→ 在同一事务内执行最终唯一 Owner 复检 + 置 `terminated` + 写交接 + 审计；
- 返回 `keep_cooling`（唯一 Owner 或其他最终检查失败）→ 不推进，账号继续停止使用，撤销流程可用；
- 返回 `not_due`（未届满）→ 不推进。
该函数是纯函数（可单测，含 fake clock），事务边界在 handler 用 `runIdempotentCommand` 保证幂等。**`keep_cooling` 是无写入的 no-op，不得被幂等缓存**：每次触发都必须重新求值 `decideDeletionFinalization` 与最终唯一 Owner 复检，不能因先前一次 `keep_cooling` 结果被缓存而永久卡住账号。因此实现上 `keep_cooling` 在事务内以回滚哨兵抛出（回滚 `processing` 幂等记录），后续任一触发（预检/撤销/重新检查）重新评估；当唯一 Owner 阻塞解除后，下一次触发必须能够推进到 `terminated` 并创建交接。SEC-02 的 Worker 在未来复用同一最终化函数作为生产触发，不改变本状态机。

**客户端时间与倒计时不授予资格**：只有服务端 `now()`（可注入 fake clock 测试）与持久化 `requested_at`/`cooling_ends_at` 决定边界。

## 5. 操作与契约（从 BLOCKED → PLATFORM_OPERATIONS stable）

### 5.1 解锁操作

| operationId | 方法/路径 | authLevel | CSRF | idempotency | page | domain |
|---|---|---|---|---|---|---|
| `identityDeleteAccountPreflight` | GET `/api/platform/v1/account/deletion/preflight` | session | 否 | 否 | account.security | identity |
| `identityRequestAccountDeletion` | POST `/api/platform/v1/account/deletion/request` | session | 是 | 是 | account.security | identity |
| `identityDeleteAccountIntentLink` | GET `/api/platform/v1/account/deletion/intent/:token` | public | 否 | 否 | account.security | identity |
| `identityDeleteAccount` | POST `/api/platform/v1/account/deletion` | session | 是 | 是 | account.security | identity |
| `identityCancelAccountDeletionIntentLink` | GET `/api/platform/v1/account/deletion/cancel/intent/:token` | public | 否 | 否 | account.security | identity |
| `identityCancelAccountDeletion` | POST `/api/platform/v1/account/deletion/cancel` | intent | 是 | 是 | account.security | identity |

> 认证级别语义：**受理**走 `session`（用户必须已在 A5 页登录，Session 确立身份；最终 POST 携带当前密码 + 消费 `deletion_request` 意图 cookie，两项证明绑定本次意图）。**撤销**走 `intent`——受理后全部 Session 已终止，冷却期账号无法（也不应）登录，撤销完全由邮箱意图 cookie 认证（`deletion_cancel` kind），POST 体携带当前密码，handler 从意图解析账号并验证密码。这符合 A5 §5.3"撤销同样要求当前密码＋已验证邮箱一次性确认，撤销成功后用户重新登录"。

> 从 `BLOCKED_OPERATIONS` 移除 `identityDeleteAccountPreflight` / `identityDeleteAccount`（保留 `usageGetSummary` 等 blocked）；`identityRequestAccountDeletion` / `identityCancelAccountDeletion` / `identityDeleteAccountIntentLink` / `identityCancelAccountDeletionIntentLink` 直接新增为 stable（同 PLT-04 先例）。`authLevel` 沿用 PLT-03 语义：session 操作需 Session；intent-link GET 是公开 GET（建立短期 HttpOnly intent cookie）。

### 5.2 关键请求/响应形状（实施计划精化）

- `identityDeleteAccountPreflightResponse`: `{ status: 'ready'|'blocked'|'unavailable', blockingOrganizations?: [{ organizationId, organizationName, organizationKind }], requiredLifecycle: { coolingHours: 168, onlineCleanupDays: 7, auditRetentionYears: 1, backupRetentionDays: 35 }, serverTime }`；
  - `ready` = 无唯一 Owner 阻塞；`blocked` = 存在阻塞组织（只返回最小可识别信息，不泄露已不再可访问组织）；`unavailable` = 投影不可判定/预检失败关闭；
  - `organizationName` 只返回当前账号仍有权看到的组织（复用 B1/B7 权限投影）；不返回继任者、成员或转让路径实现。
- `identityDeleteAccountRequest`: `{ currentPassword, idempotencyKey }`；
  - 意图确认通过 HttpOnly intent cookie（`deletion_request` kind）承载；请求体不含原始 token（ADR-028 决定细节 6 模式）；最终 POST 用 session CSRF + intent cookie（`deletion_request` kind）。
- `identityRequestAccountDeletionRequest`: `{ idempotencyKey }`（session，触发创建 `deletion_request` 意图 + 发送注销确认邮件）；`identityRequestAccountDeletionResponse`: `{ status: 'succeeded', maskedEmail, resendAvailableAt? }`（镜像 `identityRequestPasswordReset` 的枚举安全模式——成功/失败统一返回，不泄漏意图存在性）；
- `identityDeleteAccountResponse`: `{ status: 'succeeded', accountStatus: 'deletion_cooling', deletionRequestedAt, deletionCoolingEndsAt, sessionImpact: 'revoked_all' }`；
- `identityCancelAccountDeletionRequest`: `{ currentPassword, idempotencyKey }`（+ 同样的一次性邮箱确认 intent cookie `deletion_cancel` kind）；`identityCancelAccountDeletionResponse`: `{ status: 'succeeded', accountStatus: 'active', sessionImpact: 'revoked_all' }`；
- `identityDeleteAccountIntentLinkResponse`: `{ status: 'valid', csrf, maskedEmail?, intentKind }`（镜像 PLT-03 intent-link 返回形状）。

全部响应是 closed object（strict zod，`additionalProperties:false`），不泄漏密码、token 明文、Session ID、CSRF secret 或原始邮箱。

### 5.3 失败语义（RFC 9457 + accepted ADR-028）

| 场景 | HTTP | code |
|---|---|---|
| 结构性请求无效 | 400 | structural_error |
| Session 缺失/过期/撤销 | 401 | authentication（含安全登录目标） |
| CSRF 失败 | 403 | authorization |
| 密码复核失败（注销/撤销） | 403 | authorization（统一，防枚举） |
| 邮箱确认意图无效/过期 | 409 | business_validation |
| 唯一 Owner 阻塞（最终复检） | 409 | state_machine_conflict（返回最新阻塞组织清单） |
| 撤销不在冷静期内 | 409 | state_machine_conflict |
| 幂等键冲突 | 409 | idempotency_conflict |
| 字段校验失败 | 422 | field_validation |
| 限频 | 429 | rate_limited |
| Redis/DB 不可用 | 503 | authority_unavailable（失败关闭） |

**防枚举**：预检只对当前 Session 账号返回；密码复核与邮箱确认失败不泄漏"邮箱是否存在/账号是否在注销"。

## 6. 唯一 Owner 预检与最终复检

### 6.1 数据来源（PLT-04 真实能力）

- 唯一 Owner 判定直接消费 `@aurora/platform-organization` 的 `organization_members`（`role='owner'`）真实数据；
- **不得在 SEC-01 复制一套 owner 计算逻辑**。需要新增的查询是"某账号在其全部组织中的成员/角色投影"与"某组织的 owner 计数"——这些目前只有 `findMembership`（单 org）与 `listMembers`（org → members，含 role）可用。本规格允许新增一个**只读查询函数**（放 `platform-organization`，遵循 owner 不变量，不重新实现转移/变更逻辑）来回答"账号是否为某组织唯一 Owner"与"账号在哪些组织是 Owner"；
- `transferOwnership` 是 B3 独立流程（已存在），A5 只提供导航入口，不内嵌、不自动调用。

### 6.2 阻塞判定

- `kind='personal'` 工作空间：注册时每个账号恰好拥有一个 personal workspace 且是唯一 Owner。**personal workspace 不视为注销阻塞组织**（其无业务项目所有权语义；若 personal workspace 未来可含项目，属 B2 范围变更，不阻塞本叶子）。预检只对 `kind='organization'` 组织判定唯一 Owner 阻塞。此判定在 spec 冻结，实施计划按此实现（并测试该语义）。
- 阻塞组织清单只返回当前账号仍有权看到的最小组织标识 + 安全转让目标（组织名），不返回成员、继任者或审计数据；
- 预检结果可能陈旧；每次进入 A5/重新检查/最终提交都重新查询，最终 `identityDeleteAccount` 在事务内再次复检唯一 Owner，拒绝任何陈旧或并发失效的客户端判断。

## 7. 双重身份复核（复用 PLT-03 身份能力）

- **当前密码复核**：复用 `@aurora/platform-identity` `verifyPassword`（Argon2id）。`identityDeleteAccount` / `identityCancelAccountDeletion` 在 Session 内读取当前账号密码摘要并验证当前密码；失败统一 403（防枚举）。
- **已验证邮箱一次性确认**：新建 `account_deletion_intents` 表（`deletion_request` / `deletion_cancel` 两种 kind），镜像 PLT-03 意图流：创建意图（存 SHA-256 digest）→ 发送确认邮件（Outbox）→ GET intent link 建立短期 HttpOnly intent cookie → POST 确认（intent cookie + CSRF）→ 一次性消费。
- **绑定本次意图**：intent 记录 `account_id` + `intent_kind`，只对本账号 + 本意图有效；`consumed_at` 一次性；`expires_at` 短期（如 2h）。
- **新鲜度**：两项证明都必须在 `expires_at` 内且未消费；任一项缺失/过期 → 失败关闭。
- **不建立第二套密码验证系统**：`verifyPassword` + 现有 intent-cookie 机制即是全部。

### 7.1 撤销意图的触发（approved 规则内的唯一一致实现）

受理后全部 Session 已终止、冷静期禁止登录（A5-004/§5.1），而撤销又要求邮箱一次性确认（A5-007/§5.3）。因此撤销确认链接必须**在受理时同步通过已验证邮箱发送**：受理事务创建 `deletion_cancel` 意图（`account_id` 绑定、`token_digest` 摘要、短期 `expires_at` 限定在冷静窗口内）并经 Outbox 发确认邮件。用户在整个冷静期内点击该链接 → GET intent-link 建立 `deletion_cancel` 意图 cookie → POST `identityCancelAccountDeletion` 消费意图并重验当前密码 → 撤销成功。链接在 `expires_at`（冷却窗口内，如 ≤72h）内有效、一次性、绑定账号，密码证明在撤销时刻重新输入——满足"两项证明新鲜、短期有效并绑定本次撤销意图"。这不需要冷却期登录，也不暴露任何业务数据，符合"允许专用撤销流程"。

### 7.1 邮件发送边界

- 确认邮件经 `@aurora/platform-email` `EmailDeliveryPort` + 通用 Outbox 发送；`EmailIntentType` 目前是严格 3 值联合（`email_verification|password_reset|organization_invitation`）——**必须新增 `deletion_confirmation` 意图类型**（data 层 + email port + outbox-consumer 校验白名单同步），否则邮件 consumer 会把非白名单 payload dead-letter；
- **受理事务同时创建 `deletion_request` 确认意图（用户操作时消费）与 `deletion_cancel` 撤销意图（随确认邮件一并发送，冷静期内有效）**——见 §7.1；
- 邮件链接内嵌一次性 token；token 明文只在 Outbox payload 短暂暂存（PLT-03 spec §4.11 语义），权威意图表只存 digest；
- 禁止日志打印验证码/链接；`maskedEmail` 只在返回中。

## 8. Session 终止与账号访问限制

- **受理时**：事务内 `incrementSecurityVersion` + 提交后 `revokeAllAccountSessions(deps.sessionStore, accountId)`（镜像 password.ts 模式）；当前 Session 的 Cookie 一并清除；
- **撤销时**：同样终止全部 Session（撤销成功后账号回到 active，但用户必须重新登录）；
- **登录门禁（必须补）**：`apps/platform-api/src/routes/login.ts` 当前**不检查 `accounts.status`**——冷却/终态账号仍可登录。SEC-01 必须在登录与 `identityGetSession` 中按状态门禁：`deletion_cooling`/`terminated` → 拒绝登录/拒绝返回业务 Session；`deletion_cooling` 只允许进入撤销流程（本叶子通过登录拒绝 + Session 撤销实现，撤销需要重新登录后进入专用流程）；
- **Session 不复活**：Redis 权威 + 全部撤销 + security_version 递增，缓存/故障转移/备份恢复不得复活（accepted ADR-030/028）。

## 9. 清理交接（ADR-032 边界）

- 跨不可逆边界（`deletion_cooling` → `terminated`）时，同一事务内：
  1. 最终唯一 Owner 复检通过；
  2. `accounts.status = 'terminated'`、`deletion_terminated_at = now()`；
  3. 写入 `account_cleanup_handoffs`（`status='pending'`，`required_lifecycle` 冻结 7 天在线清理 / 1 年审计 / 35 天备份淘汰 intent）；
  4. 审计记录进入不可逆阶段 + 交接创建。
- **不实现** SEC-02 的物理清理（PostgreSQL 逐记录删除、对象存储、Redis/BullMQ 全量、备份淘汰、恢复重放）。交接 intent 是 SEC-02 的 claim/retry 输入。
- **禁止"只打印一条日志"**：必须持久化交接 intent，且事务/一致性语义由测试证明（受理 → 交接行存在；回滚 → 无交接行）。
- **不得让现有邮件 Outbox consumer 消费交接行**：交接行不入 `outbox` 表（避免被 `consumeOutboxEmails` 当邮件 dead-letter）；它是独立表。`account_cleanup_handoffs` 由未来 SEC-02 consumer 消费。

## 10. 审计（复用 platform-audit）

写入复用 `@aurora/platform-identity` `insertAuditEvent`（同事务，identity 包根导出，接受 Pool/PoolClient）。必须记录：

| 事件 | action | 安全投影 |
|---|---|---|
| 预检被唯一 Owner 阻塞 | `account.deletion.preflight_blocked` | 阻塞组织数量/类型（**不含邮箱/密码/完整 ID**） |
| 注销申请受理 | `account.deletion.requested` | 目标账号、requested_at、cooling_ends_at |
| 注销撤销 | `account.deletion.cancelled` | 目标账号、撤销时刻 |
| 进入不可逆阶段 | `account.deletion.terminated` | 目标账号、terminated_at、handoff_id |
| 清理交接创建 | `account.deletion.handoff_created` | handoff_id、required_lifecycle |
| 身份复核结果 | `account.deletion.identity_recheck`（如适用） | 只写"复核通过/失败"安全投影，**不写邮箱/密码/令牌** |

审计**绝不**保存：密码、验证码、验证 URL、Session、CSRF secret、私密令牌明文、完整邮箱。一年保留与 B7 权限读取由既有 `security_audit_events` + `platform-audit` 承载。

## 11. Console A5 注销危险区（UX §8.5 已批准结构）

在 `apps/console/src/views/account/AccountSecurityView.vue` 的独立危险区增加"注销账号"：

1. 进入注销区 → 请求 `identityDeleteAccountPreflight`；
2. `loading`：无权威结果前不显示可提交操作；
3. `blocked`：展示阻塞组织清单（名称 + 类型），每个阻塞组织提供"转让所有权"真实入口（导航到对应组织 B3 独立流程）；不显示最终提交；"重新检查"重新请求权威预检；
4. `ready`：进入注销确认阶段——危险确认 + 当前密码字段 + 触发"发送邮箱确认"（创建 `deletion_request` intent + 邮件）→ 用户从邮件进入确认 → 最终 `identityDeleteAccount`；
5. 受理成功 → 显示冷静期状态（服务端 `deletionCoolingEndsAt`，**不信任客户端倒计时**）+ Session 已终止 → 引导重新登录/撤销流程；确认邮件已附带撤销链接；
6. 冷静期撤销：用户通过已发送的撤销邮件链接（`deletion_cancel` intent）进入专用撤销页 → 输入当前密码 → 撤销成功 → 重新登录；
7. 状态覆盖 `loading/empty/error/forbidden/processing/partial/stale/unavailable`；注销绝不允许 `partial` 成功。

第一版不提供设备/Session 列表、批量退出、内嵌继任者、级联删除、账号数据导出（UX §8.5 明确排除）。

## 12. 验收门禁（verification-before-completion）

| 类别 | 门禁 |
|---|---|
| unit | 状态机纯函数（`decideDeletionFinalization` + fake clock 的 168h 边界、撤销窗口、幂等）、唯一 Owner 判定、intent 一次性/过期、防枚举 |
| migration | `account_deletion_intents` / `accounts` 扩展 / `account_cleanup_handoffs` up/down 幂等（真实 PostgreSQL 17） |
| real PostgreSQL integration | 注销受理事务（状态迁移 + 审计 + 交接同事务）、撤销、唯一 Owner 阻塞、进入终态事务回滚 → 无交接行、lazy 最终化（届满→terminated+交接；阻塞→keep_cooling） |
| Session | `revokeAllAccountSessions` 终止当前+其他 Session；旧 CSRF 失效；受保护请求被拒 |
| HTTP integration | `apps/platform-api`：preflight → 阻塞 → 双重确认 → 受理 → 冷静期 → 撤销全流程（真实 PG+Redis，fake clock） |
| security-negative | 冷却账号登录被拒、唯一 Owner 复检失败失败关闭、撤销不在窗口 409、密码/邮箱/token 不落日志/URL/Store、CSRF 负例、Redis down→503 |
| contract/codegen | OpenAPI lint、drift、manifest stable 列表更新（新增 4 操作；blocked 移除 2） |
| package-entry | platform-identity/contract 受影响包 test:package |
| Console | vitest + targeted Chromium（A5 危险区 + axe）；不跑全矩阵 |
| coverage | 受影响包阈值（branches 75/functions 80/lines 80/statements 80） |
| root | format/lint/typecheck/boundaries/build/git diff --check |

## 13. 完成定义

SEC-01 completed 当且仅当：

1. `identityDeleteAccountPreflight` / `identityDeleteAccount` 从 blocked → stable，新增 `identityRequestAccountDeletion` / `identityCancelAccountDeletion` / `identityDeleteAccountIntentLink` / `identityCancelAccountDeletionIntentLink`，OpenAPI/client/server 真实生成，drift 门禁通过；
2. 权威状态机真实实现（`active` → `deletion_cooling` → `terminated`；168h 服务端权威；撤销窗口；失败关闭）；
3. 双重身份复核复用真实 `verifyPassword` + 一次性邮箱意图流，两项证明新鲜/绑定本意图；
4. 唯一 Owner 预检与最终复检消费 PLT-04 真实组织数据，阻塞清单最小化，不自动转让/不级联删除；
5. 受理后全部 Session 终止 + 登录门禁（冷却/终态拒绝登录）；
6. `terminated` 转换与 `account_cleanup_handoffs` 创建同事务、可审计、可恢复；
7. 高风险事件全部审计，不写密码/邮箱/令牌/会话秘密；
8. Console A5 危险区真实（非 unavailable）通过 targeted Chromium + axe；
9. 全部门禁新鲜通过；
10. **独立验收通过**（verification-before-completion）；
11. 叶子计数 42/36 → **43/35**。

## 14. 与相邻叶子/模块的边界

- **PLT-03**：复用账号/密码/意图/审计/事务/Outbox 与 Session 撤销；不重建。
- **PLT-04**：消费唯一 Owner / 成员真实数据与 `transferOwnership` 独立流程；不在 A5 内嵌转让。
- **SEC-02**：跨存储物理删除、对象存储、Redis/BullMQ 全量清理、备份淘汰、恢复重放 → 后续叶子。本叶子只持久化交接 intent。
- **B5**：保持 blocked/unavailable；无关。
- **OPS-07**：删除重放验证 → 后续叶子。
- **G11—G13**：C/D 页保持 unavailable；无关。

## 15. 固定回读与权威边界

本规格是 SEC-01 的唯一实施依据，合并以下权威：

- PRD §4.1（账号安全规则，含"注销前检查唯一所有者"）、§13、§16—17；
- UX §7.7、§8.5、§9.5、§11.1.1、§12.6；
- `account-deletion-and-data-lifecycle.md`（approved，全文，§2—11）；
- A5 专项设计（approved，全文）；
- backend design §4/§6 A5/§7/§8/§13；
- ADR-028/029/030/032（accepted）；G10 APPROVAL PACKAGE；
- PLT-03/PLT-04 正式规格与真实实现基础。

**不变量（任何 Task 不得违反）**：

- 7 天冷静期为服务端权威 168 小时，客户端时间不授予资格；边界并发不得同时撤销成功与进入不可逆成功；
- 双重身份复核缺任一证明不得受理或撤销注销；不建立第二套密码系统；
- 唯一 Owner 阻塞不因预检放行而失效——最终 Command 服务端复检，失败关闭；
- 受理后全部 Session 立即终止；冷却/终态账号拒绝登录；
- 清理交接必须真实持久化且同事务一致，禁止"只打印一条日志"冒充完成；
- 审计、日志、URL、Store、Playwright trace 不写密码/邮箱/令牌/会话秘密；
- 不实现 SEC-02/OPS-07 能力，不 provision 无 consumer 基础设施（ADR-032 YAGNI）。
