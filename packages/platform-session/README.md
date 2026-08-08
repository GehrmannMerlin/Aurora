# Aurora Platform Session

## 模块定位

`@aurora/platform-session` 是管理平台身份、认证与邀请第一增量（PLT-03）的**数据层**包。它承载 spec
[platform-identity-authentication-invitation](../../docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md)
§5.2（Session，Redis 权威）、§5.3（CSRF）与 §5.4（认证级别）的物理实现，以及 accepted
[ADR-030](../../docs/adr/ADR-030-platform-session-csrf-password-physical-parameters.md)
的 Session/Cookie/CSRF 参数。

本包是 PLT-03 Task 4 的结果：Redis 权威 Session（创建/旋转/撤销/撤销全部/校验）、CSRF secret
绑定与主机限定 Session Cookie 选项均已真实存在。**本包没有 DB Migration**（Session 存于 Redis，
不属于 PostgreSQL 数据模型），因此没有 `migrate` 脚本。

## 职责

- 高熵随机不透明 Session ID（32 字节 CSPRNG，base64url）；
- **Redis 只存 Session ID 的 SHA-256 摘要**（ADR-030 决定细节 9），绝不存原始值；
- Redis key 隔离命名空间 `aurora:platform:session:*`（可用 `keyPrefix` 覆盖）：
  - `aurora:platform:session:<sha256(cookieValue)>` → JSON `{accountId, authLevel, expiresAt, rotationDueAt, csrfSecret}`，TTL = 空闲期限（`PX`）；
  - `aurora:platform:session:account:<accountId>` → Set（该账号全部 Session 摘要），供 `revokeAllAccountSessions` 批量撤销；
- Session 空闲期限由 Redis TTL 承载，绝对期限由存储的 `expiresAt` 在读时校验；
- 登录旋转 Session ID（旧摘要删除、新摘要写入）；退出撤销当前 Session；密码重置/修改密码撤销该账号全部 Session；
- CSRF：`createCsrfSecret`（32 字节 base64url）＋`verifyCsrf`（constant-time）；
- Cookie：`HttpOnly`＋`Secure`＋`SameSite=Lax`＋无 `Domain`＋`Path=/`（ADR-030 决定细节 2）。

## 非职责

- 不实现 HTTP、Fastify、平台 API、Session 失败语义（401/503/403 属于 `apps/platform-api`，PLT-03 Task 6）；
- 不实现账号/密码/意图/邀请 Repository（`@aurora/platform-identity`）；
- 不实现邮件交付（`@aurora/platform-email`）；
- 不创建 Redis/BullMQ/S3/云资源/CI/IaC（ADR-032 YAGNI——本叶子 Redis 只用于 Session）。

## 安全模型

- 原始 cookieValue 只由 `createSession`/`rotateSession` 返回给响应 Cookie 设置者，**绝不写入 Redis、
  绝不写入日志、URL、前端 Store、MSW fixture 或 Playwright trace**；
- Redis 仅存摘要——Redis 被攻破不暴露活动 Session 凭据（ADR-030 决定细节 9）；
- Session 载荷包含 `csrfSecret`，`verifyCsrf` 用 `timingSafeEqual` 常量时间比较，长度不匹配短路返回 `false`；
- 数据层只依赖 `redis`（外部）与 `node:crypto`，不依赖 `@aurora/platform-contract`
  （contract 层，Workspace Policy `data → {protocol}`）；
- Redis 不可用的失败关闭（503）语义由 `apps/platform-api` 层承载，本包只负责存取。

## 对外接口

包根导出：

- `createSessionStore({ url, keyPrefix? })` → 连接并返回 `SessionStore`（调用者负责 `client.quit()`）；
- `createSession(store, { accountId, authLevel, now, idleMs, absoluteMs })` → `{ cookieValue, expiresAt }`；
- `getSession(store, cookieValue, now)` → `SessionPayload | null`（缺失/过期/撤销 → `null`）；
- `rotateSession(store, cookieValue, now, input)` → 新 `{ cookieValue, expiresAt } | null`（登录旋转）；
- `revokeSession(store, cookieValue)` → `void`（退出撤销当前 Session）；
- `revokeAllAccountSessions(store, accountId)` → `void`（密码重置/修改密码/A5 撤销全部）；
- `createCsrfSecret()` / `verifyCsrf(secret, token)`；
- `sessionCookieOptions(secure)` → `{ httpOnly: true, secure, sameSite: 'lax', path: '/' }`；
- 类型：`SessionPayload`、`SessionStore`、`SessionAuthLevel`、`CreateSessionInput`、
  `RotateSessionInput`、`CreateSessionStoreOptions`、`SessionCookieOptions`。

`SessionAuthLevel = 'pending_verification' | 'authenticated' | 'restricted'`（accepted ADR-028 §决定细节 6）。

不暴露 Redis 原始 key、`client` 内部状态、密码摘要、token 明文或内部路径。

## 命令

```bash
pnpm --filter @aurora/platform-session typecheck        # TypeScript strict
pnpm --filter @aurora/platform-session test             # 单元测试（不连 Redis）
pnpm --filter @aurora/platform-session test:integration # 真实 Redis 集成测试（AURORA_TEST_REDIS_URL）
pnpm --filter @aurora/platform-session test:coverage    # 覆盖率
pnpm --filter @aurora/platform-session test:package     # 构建 + 包入口验证
pnpm --filter @aurora/platform-session build            # 构建 dist
```

集成测试需要真实 Redis（本地容器 `aurora-test-redis`，`AURORA_TEST_REDIS_URL=redis://localhost:16379`）；
未设置该环境变量时集成测试自动跳过。禁止以 mock/内存替代真实 Redis 证据。

## 关联文档

- [PLT-03 正式规格](../../docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md)
- [PLT-03 实施计划](../../docs/superpowers/plans/2026-08-09-platform-identity-authentication-invitation.md)
- [ADR-028 平台 Session/CSRF/认证传输契约](../../docs/adr/ADR-028-platform-session-csrf-security.md)
- [ADR-030 平台 Session/CSRF/密码物理参数](../../docs/adr/ADR-030-platform-session-csrf-password-physical-parameters.md)
