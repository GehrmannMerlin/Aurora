# Aurora Ingestion API

## 模块定位

`@aurora/ingestion-api` 是数据接入同步 HTTP 服务第一增量，承载 ADR-008 后续依赖链第 4 项的 HTTP 编排。它基于 Fastify 5.10.0 实现 `POST /v1/batches`，严格符合 approved OpenAPI 机器契约，调用 `@aurora/ingestion-inbox` 的 `persistBatch` 完成可靠接收。

## 职责

- Fastify 应用工厂 `buildIngestionApi` 与启动入口 `startIngestionApi`；
- `POST /v1/batches` 路由（`application/json`、`X-Aurora-Client-Key`、`X-Aurora-Environment`、Origin）；
- OPTIONS/CORS adapter（显式、不装 `@fastify/cors`，禁 `*`、禁 Cookie credential）；
- 请求 ID（`globalThis.crypto.randomUUID()`，不接受客户端权威值）；
- 请求授权端口 `IngestionRequestAuthorizer` 与请求准入端口 `IngestionAdmissionPolicy`；
- event-schema 批次解析、Inbox `persistBatch` 调用、receipt 与 HTTP 映射、Retry-After；
- 生命周期：启动、graceful shutdown、PostgreSQL Pool 释放；
- 单元、inject、loopback、真实 PostgreSQL 集成、OpenAPI 漂移测试。

## 非职责

- 不实现真实凭证数据库、密钥创建/轮换/撤销、管理 API；
- 不实现 Worker、租约消费、重试调度、死信重放、采样、真实限流系统；
- 不实现 SDK transport、Redis/BullMQ、SQS/Kinesis；
- 不创建 CI、RDS、容器、IaC、管理平台。

## 命令

```bash
pnpm --filter @aurora/ingestion-api test               # 单元 + inject + OpenAPI 漂移
pnpm --filter @aurora/ingestion-api test:integration   # 真实 PostgreSQL 17 集成（需 AURORA_TEST_DATABASE_URL）
pnpm --filter @aurora/ingestion-api typecheck
pnpm --filter @aurora/ingestion-api build
```

集成测试需要真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL` 连接；禁止以 SQLite/mock/PGlite 替代真实数据库证据。配置通过 `start.ts` 从环境变量读取（`HOST`/`PORT`/`REQUEST_BODY_LIMIT_BYTES`/`GRACEFUL_SHUTDOWN_TIMEOUT_MS`/`DATABASE_URL`/`LOG_ENABLED`/`LOG_LEVEL`），由 `configuration.ts` 校验并冻结；请求体字节上限是启动必填配置，非产品承诺。

## 关联文档

- [数据接入同步 HTTP 服务正式规格](../../docs/architecture/ingestion-http-service.md)
- [数据接入 OpenAPI 机器契约](../../docs/api/ingestion-openapi.md)
- [Inbox 数据模型正式规格](../../docs/architecture/ingestion-inbox-data-model.md)
- [ADR-011 数据接入同步 HTTP 服务的运行时与应用边界](../../docs/adr/ADR-011-ingestion-http-service-runtime.md)
