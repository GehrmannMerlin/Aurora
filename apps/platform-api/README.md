# Aurora Platform API

## 模块定位

`@aurora/platform-api` 是管理平台 HTTP 服务（service 层，`aurora.layer: service`），基于 Fastify 5.10.0（accepted ADR-026）。它是唯一的浏览器公开 HTTP 入口，承载 PLT-03 身份/认证/邀请操作与 Session/Cookie/CSRF/Origin 安全插件。注册、登录、退出、密码流程、邮箱确认及 Session 下的邮箱验证重发均为真实 Command，不是桩。

## 职责

- Fastify 应用工厂 `buildPlatformApi`、组合根 `buildPlatformServer`、启动入口 `startPlatformApi`；
- `GET /api/platform/v1/session`（identityGetSession）：无 Session → 统一 401＋安全登录目标；有 Session → 返回账号摘要、认证级别、Session 到期/轮换、CSRF token 与导航目标；
- `POST /api/platform/v1/auth/register`：事务内创建账号、个人工作空间、验证 intent 与 Outbox，建立
  pending-verification Session；成功只返回 `deliveryStatus=queued`，不承诺收件箱送达；
- `POST /api/platform/v1/auth/email/resend`：只从 Session 恢复账号和掩码邮箱，不接受可编辑邮箱；同步
  CSRF/idempotency，行锁下执行 60 秒冷却和滚动 24 小时最多 5 次，创建最新唯一有效链接并 supersede 旧链接；
- `POST /api/platform/v1/auth/email/confirm`：消费最新有效 intent、激活账号；旧链接稳定失败且不误激活；
- `GET /api/platform/v1/health`：存活检查；
- `GET /api/platform/v1/organizations/:organizationId/projects/:projectId/requests`（requestsListEndpoints，DAT-16）：项目级授权下的请求指标/接口列表只读查询（复用 `requireSession` + `effectivePermissions` + `requireProjectAccess`，无权限 403 不查数据、项目不属于 org 404；返回 `queryResponse`，percentile `unavailable`）；
- `GET /api/platform/v1/organizations/:organizationId/projects/:projectId/data-status`（diagnosticsGetDataStatus，DAT-20）：项目级授权下的接入诊断状态只读查询（复用 `requireProjectAccess`；组合 event_inbox 状态机/凭证安全状态/processing-store 可查询证据三个只读查询，安全投影，rejection 恒 `unavailable`，缺失恒 `empty`/`not_receiving`）；
- `GET /api/platform/v1/organizations/:organizationId/projects/:projectId/performance`（performanceListPages，DAT-17）：项目级授权下的性能指标查询只读投影（复用 `requireProjectAccess`；`queryPerformanceMetricSummary` 半开窗口聚合，无权限 403 不查数据、项目不属于 org 404；返回 `queryResponse`，`pages`/`percentiles` 恒 `unavailable`）；
- 插件：cookie-session（`aurora_session` HttpOnly Cookie 解析、`getSession`、受保护操作缺失/过期/撤销 → 401、Redis down → 503 失败关闭）、csrf（非安全方法 `X-Aurora-CSRF` 校验，失败 → 403）、origin（状态改变请求 Origin allow-list + `Sec-Fetch-Site: cross-site` 拒绝）；
- RFC 9457 `auroraProblem` 错误映射（structural_error/authentication/authorization/not_found/business_validation/authority_unavailable 等），绝不泄漏 SQL/栈/约束名/password/token/sessionId/csrf/email；
- 生命周期：启动、graceful shutdown、PostgreSQL Pool + Redis session store 释放。

## 非职责

- 不同步调用供应商或发送邮件；只事务写 Outbox，真实交付由 `apps/platform-worker` 完成；
- 不实现 platform-worker 邮件消费者（Task 8）；
- 不使用 `@fastify/cors`（显式 Origin adapter，ADR-026 决定细节 3）；
- 不创建 CI、RDS、容器、IaC（后续模块）。

## 安全不变量

- Cookie：`aurora_session`、`HttpOnly`、`Secure`（按配置）、`SameSite=Lax`、`Path=/`、无 `Domain`（`@aurora/platform-session` `sessionCookieOptions`）；
- Session 权威在 Redis，只存 Session ID 的 SHA-256 摘要；Redis down → 受保护操作 503，不伪装 401；
- 密码/一次性 token/Session ID/CSRF secret 绝不进入日志、URL、前端 Store、MSW fixture、Playwright trace；
- 重发请求不接受邮箱字段；429 返回 `Retry-After`/`resendAvailableAt`，503 失败关闭且不伪造 queued；
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
- [接入诊断状态查询正式规格](../../docs/architecture/ingestion-diagnostics-status-query.md)
- [性能指标查询投影正式规格](../../docs/architecture/performance-query-projection.md)
