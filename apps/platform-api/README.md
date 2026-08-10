# Aurora Platform API

## 模块定位

`@aurora/platform-api` 是管理平台 HTTP 服务（service 层，`aurora.layer: service`），基于 Fastify 5.10.0（accepted ADR-026）。它是唯一的浏览器公开 HTTP 入口，承载 PLT-03 身份/认证/邀请操作（注册/登录/退出/忘记与重置密码/修改密码/接受邀请）与 Session/Cookie/CSRF/Origin 安全插件。当前 Task 6 提供服务骨架：session/csrf/origin 插件、`GET /api/platform/v1/session`、健康路由与注册桩（返回 `identityRegisterResponse` 契约形状并建立 Session）。

## 职责

- Fastify 应用工厂 `buildPlatformApi`、组合根 `buildPlatformServer`、启动入口 `startPlatformApi`；
- `GET /api/platform/v1/session`（identityGetSession）：无 Session → 统一 401＋安全登录目标；有 Session → 返回账号摘要、认证级别、Session 到期/轮换、CSRF token 与导航目标；
- `POST /api/platform/v1/auth/register`（Task 6 桩）：真实创建账号＋个人工作空间＋建立 Session，返回 `identityRegisterResponse` 契约形状；
- `GET /api/platform/v1/health`：存活检查；
- `GET /api/platform/v1/organizations/:organizationId/projects/:projectId/requests`（requestsListEndpoints，DAT-16）：项目级授权下的请求指标/接口列表只读查询（复用 `requireSession` + `effectivePermissions` + `requireProjectAccess`，无权限 403 不查数据、项目不属于 org 404；返回 `queryResponse`，percentile `unavailable`）；
- 插件：cookie-session（`aurora_session` HttpOnly Cookie 解析、`getSession`、受保护操作缺失/过期/撤销 → 401、Redis down → 503 失败关闭）、csrf（非安全方法 `X-Aurora-CSRF` 校验，失败 → 403）、origin（状态改变请求 Origin allow-list + `Sec-Fetch-Site: cross-site` 拒绝）；
- RFC 9457 `auroraProblem` 错误映射（structural_error/authentication/authorization/not_found/business_validation/authority_unavailable 等），绝不泄漏 SQL/栈/约束名/password/token/sessionId/csrf/email；
- 生命周期：启动、graceful shutdown、PostgreSQL Pool + Redis session store 释放。

## 非职责

- 不实现完整 register/login/logout/forgot-reset/change-password/accept-invitation 流程（PLT-03 Task 7）；
- 不实现 platform-worker 邮件消费者（Task 8）；
- 不使用 `@fastify/cors`（显式 Origin adapter，ADR-026 决定细节 3）；
- 不创建 CI、RDS、容器、IaC（后续模块）。

## 安全不变量

- Cookie：`aurora_session`、`HttpOnly`、`Secure`（按配置）、`SameSite=Lax`、`Path=/`、无 `Domain`（`@aurora/platform-session` `sessionCookieOptions`）；
- Session 权威在 Redis，只存 Session ID 的 SHA-256 摘要；Redis down → 受保护操作 503，不伪装 401；
- 密码/一次性 token/Session ID/CSRF secret 绝不进入日志、URL、前端 Store、MSW fixture、Playwright trace；
- 公开结果（register/request-reset/login）绝不泄漏账号存在性。

## 命令

```bash
cd apps/platform-api
pnpm install
pnpm typecheck                 # 严格 TypeScript 检查
pnpm test                      # 单元/inject 测试
pnpm test:coverage             # v8 覆盖率（含阈值）
AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test \
AURORA_TEST_REDIS_URL=redis://localhost:16379 \
pnpm test:integration          # 真实 PostgreSQL 17 + Redis 集成
cd ../.. && pnpm check:boundaries
```

集成测试需要真实 PostgreSQL 17（`AURORA_TEST_DATABASE_URL`，必须指向 `/aurora_inbox_test`）与 Redis 7（`AURORA_TEST_REDIS_URL`）；禁止以 SQLite/mock/PGlite 冒充真实数据库证据。配置经 `config.ts` 校验并冻结（`HOST`/`PORT`/`DATABASE_URL`/`REDIS_URL`/`SESSION_IDLE_MS`/`SESSION_ABSOLUTE_MS`/`COOKIE_SECURE`/`EMAIL_DELIVERY_MODE`/`APP_ORIGIN`）。

## 关联文档

- [PLT-03 正式规格](../../docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md)
- [ADR-026 管理平台后端运行时与契约链](../../docs/adr/ADR-026-platform-backend-runtime-and-contract-chain.md)
- [ADR-028 管理平台 Session、CSRF 与认证传输契约](../../docs/adr/ADR-028-platform-session-csrf-security.md)
- [ADR-030 平台 Session/CSRF/密码物理参数](../../docs/adr/ADR-030-platform-session-csrf-password-physical-parameters.md)
- [请求指标查询投影正式规格](../../docs/architecture/request-metric-query-projection.md)
