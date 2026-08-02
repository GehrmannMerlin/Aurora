# Ingestion HTTP Service (数据接入同步 HTTP 服务第一增量) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `apps/ingestion-api` 中冻结并实施数据接入同步 HTTP 服务第一增量：Fastify 5.10.0 应用工厂 `buildIngestionApi` 与启动入口 `startIngestionApi`，`POST /v1/batches` 路由（严格符合 approved OpenAPI）、OPTIONS/CORS adapter（不装 `@fastify/cors`）、请求 ID、`IngestionRequestAuthorizer`/`IngestionAdmissionPolicy` 端口、event-schema 解析、`@aurora/ingestion-inbox` `persistBatch` 集成、receipt/HTTP 映射、生命周期与 Pool 释放、真实 PostgreSQL 集成与 OpenAPI 漂移测试。本计划只实施 HTTP 服务编排与已批准安全边界；**不**实现真实凭证数据库、Worker、采样、真实限流、SDK transport、CI/RDS/IaC。

**Architecture:** Fastify 5.10.0 应用。`buildIngestionApi` 接受外部依赖（已验证 config、authorizer、admission policy、可选 Pool），不创建/关闭 Pool；`startIngestionApi` 是 composition root，创建 Pool、构建应用、启动、注册关闭、拥有并释放 Pool。显式 CORS adapter 处理 OPTIONS 预检与 POST 响应 Header。请求处理固定顺序：request ID → 方法/媒体类型/body 上限 → 读 key（不记录）→ 读 environment → 读 Origin → authorizer → admission → 解析 JSON → `parseIngestionBatchRequest` → `persistBatch` → COMMIT 后 accepted → receipt/HTTP 映射。

**Tech Stack:** Fastify 5.10.0（生产依赖）、`@aurora/event-schema`（包根）、`@aurora/ingestion-inbox`（包根）、TypeScript 6.0.3、Vitest 4.1.10、@vitest/coverage-v8 4.1.10、pnpm 11.17.0、Node.js ≥24.18.0（当前 v24.18.0，已通过 Fastify 5.10.0 兼容门禁）。

**Plan status:** ready-for-implementation（本消息已预先批准无歧义派生的规格与计划；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 只新增 `apps/ingestion-api/`（src/、test/、test/integration/、README.md、package.json、tsconfig*.json、vitest.config.ts）与相关索引文档。不修改 `packages/event-schema`、`packages/ingestion-inbox`、`docs/api/ingestion.openapi.yaml` 公共语义。
- `fastify` 是生产依赖；`@types/node`、`typescript`、`vitest` 是 devDependencies；`@aurora/event-schema` 与 `@aurora/ingestion-inbox` 是 workspace 生产依赖。
- 应用 `aurora.layer: service`；Workspace Policy 允许 `service → protocol/data/tooling`，禁止反向与 SDK 插件依赖；只从两个包根消费，不访问私有路径。
- 不安装 `@fastify/cors`；显式 CORS adapter 严格符合 ADR-009 与本消息语义。
- "已可靠接收"严格对应 `persistBatch` 事务 COMMIT 成功；服务不重新实现 Inbox 写入、不读取 Migration 表、不捕获约束名。
- 两阶段配置：`start.ts` 读 env，`configuration.ts` 校验生成 typed config，`buildIngestionApi` 只接受已验证 config；路由/业务模块不直接访问 `process.env`。
- `buildIngestionApi` 不创建/关闭 Pool；`startIngestionApi` 拥有并关闭它创建的 Pool，关闭一次；启动失败回滚。
- 请求处理顺序固定（凭证验证先于 JSON 解析）；不得记录原始 body/key/SQL/数据库 URL。
- 请求 ID 默认 `globalThis.crypto.randomUUID()`；不接受客户端权威值；不包含 project/用户/Origin/时间。
- `Retry-After` 整数秒由 `retryAfterMs` 向上取整；只出现在 retryable（429/503）。
- 文件 kebab-case，类型/接口 PascalCase，函数/变量 camelCase，布尔 `is`/`has`/`can`/`should` 前缀。禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore`、静默 catch。
- 不创建 `utils`/`helpers`/`common`/`misc`；不创建通用 services 框架或平台后端应用。
- 测试覆盖率 lines ≥85 / branches ≥80 / functions ≥85 / statements ≥85。
- 真实 PostgreSQL 集成测试使用 `AURORA_TEST_DATABASE_URL`；确认目标是测试数据库；独立 Schema/命名空间隔离；清理失败显式报错；禁止 SQLite/mock/PGlite 替代真实 PostgreSQL 证据。
- 请求体字节上限是启动必填配置，非产品承诺；不写入 OpenAPI 固定业务限制。
- ADR 状态：ADR-011 保持 `accepted / not-started`（真实实现后更新 `in-progress`）；ADR-008/009 `accepted / in-progress`；ADR-010 `accepted / implemented`；ADR-005 `accepted / in-progress`。

---

## 文件树

```text
apps/ingestion-api/
├── package.json                  # Create：fastify 生产依赖，service 层，private
├── tsconfig.json                 # Create：extends 根 base，noEmit，types node+vitest/globals
├── tsconfig.build.json           # Create：src→dist 构建
├── vitest.config.ts              # Create：node 环境，test/ 与 test/integration/ 分离
├── README.md                     # Create：模块定位/职责/命令/测试变量
├── src/
│   ├── index.ts                  # Create：包根公共出口
│   ├── app.ts                    # Create：buildIngestionApi（Fastify app factory）
│   ├── start.ts                  # Create：startIngestionApi（composition root，env adapter + Pool 所有权）
│   ├── configuration.ts          # Create：typed config 校验与冻结
│   ├── access-policy.ts          # Create：IngestionRequestAuthorizer 端口 + 类型
│   ├── admission-policy.ts       # Create：IngestionAdmissionPolicy 端口 + allowAll 测试实现
│   ├── cors.ts                   # Create：显式 CORS adapter（OPTIONS + POST header）
│   ├── request-id.ts             # Create：request ID provider
│   ├── receipt-mapper.ts         # Create：persistBatch 结果 → IngestionEventReceipt 语义
│   ├── error-mapper.ts           # Create：稳定错误 → HTTP 状态/ErrorResponse
│   └── routes/
│       └── ingestion-batches.ts  # Create：POST /v1/batches handler
└── test/
    ├── configuration.test.ts     # Create [ENV-INDEPENDENT]：config 校验
    ├── request-id.test.ts        # Create [ENV-INDEPENDENT]：request ID provider
    ├── cors.test.ts              # Create [ENV-INDEPENDENT]：CORS adapter 单元
    ├── receipt-mapper.test.ts    # Create [ENV-INDEPENDENT]：inserted/duplicate 映射
    ├── error-mapper.test.ts      # Create [ENV-INDEPENDENT]：错误映射
    ├── routes-inject.test.ts     # Create [ENV-INDEPENDENT]：Fastify inject 全部状态/CORS/OpenAPI
    ├── openapi-drift.test.ts     # Create [ENV-INDEPENDENT]：路径/Header/状态码漂移
    ├── lifecycle.test.ts         # Create [ENV-INDEPENDENT]：close/重复关闭/onClose/Pool 释放（fake Pool）
    ├── package-entry.test.ts     # Create [ENV-INDEPENDENT]：包入口/私有路径负例
    ├── security-negative.test.ts # Create [ENV-INDEPENDENT]：无 key/body/SQL 日志、无 wildcard
    ├── fastify-compat.test.ts    # Create：Fastify 5.10.0/Node 24 兼容门禁（已建）
    └── integration/
        ├── helpers.ts            # Create：测试 DB 连接/隔离
        ├── real-postgres.test.ts # Create [PG-GATED]：accepted/duplicate/rollback/关闭释放
        └── loopback.test.ts      # Create [PG-GATED]：listen port 0 + 真实请求 + close
```

每个文件单一职责；`src/` 只放 HTTP 编排/端口/映射，不创建真实凭证库、Worker、限流系统。

---

## Consumes / Produces 总览

- **Consumes**：`docs/architecture/ingestion-http-service.md`（approved 规格）、`@aurora/event-schema` 根（`parseIngestionBatchRequest`、`IngestionBatchRequest`、`IngestionRequestReceipt`、`IngestionEventReceipt`、`IngestionReceiptState`、`IngestionErrorCode`）、`@aurora/ingestion-inbox` 根（`persistBatch`、`PersistIngestionBatchInput/Result`、`InboxEventPersistResult`）、ADR-008/009/010/011 约束、Fastify 5.10.0。
- **Produces**：`apps/ingestion-api/`（src、test、README）、Fastify 应用、`POST /v1/batches` 服务、CORS adapter、端口、真实 PostgreSQL 集成测试、OpenAPI 漂移门禁、ADR-011 实施证据、更新后的 formalization-readiness。

---

## Task 1: 包骨架、配置与 Workspace `service` 边界 [ENV-INDEPENDENT]

**目标：** 创建 `apps/ingestion-api` 包骨架（package/tsconfig/vitest），确认 Workspace Policy `service` 层与根 lint/format 接入。此 Task 不连数据库，只搭包结构。

- Consumes: 根 tsconfig.base.json、pnpm-workspace.yaml、ADR-011 §4.3/4.4。
- Produces: `apps/ingestion-api/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,src/index.ts}`、`tooling/workspace-policy/src/graph.ts`（service 层，已建）。

- [ ] **Step 1: 失败测试（包入口断言先行）**
  - 创建 `test/package-entry.test.ts`，断言：
    - 包根导出 `buildIngestionApi`、`startIngestionApi`、`IngestionRequestAuthorizer`、`IngestionAdmissionPolicy` 及相关类型；
    - 包 `aurora.layer` 为 `service`；`private: true`；
    - `fastify` 在生产 `dependencies`；`@aurora/event-schema`/`@aurora/ingestion-inbox` 是 workspace 依赖；
    - 私有路径（`src/`、`internal/`）不可导入。
  - 先只建空 `src/index.ts`，测试预期失败（入口未导出）。

- [ ] **Step 2: 最小实现包骨架**
  - `package.json`（`fastify: 5.10.0` 生产依赖，`aurora.layer: service`，`private: true`）；
  - `tsconfig.json` extends 根 base，noEmit，types `node`+`vitest/globals`，include src/test/vitest.config；
  - `tsconfig.build.json` 构建 src→dist；
  - `vitest.config.ts` 用别名把 `@aurora/event-schema` 与 `@aurora/ingestion-inbox` 指向各包 src/index.ts；
  - `src/index.ts` 占位导出；
  - 确认 `tooling/workspace-policy/src/graph.ts` 已含 `service` 层（`service → protocol/data/tooling`）。

- [ ] **Step 3: 确认通过**
  - `pnpm --filter @aurora/ingestion-api typecheck` exit 0；
  - `pnpm --filter @aurora/ingestion-api test`（包入口断言）通过。

- [ ] **Step 4: 相关回归**
  - `pnpm check:boundaries`：确认 `service` 层依赖方向正确（service→protocol/data 允许，反向禁止）；
  - `pnpm lint`（根 lint 已含 apps/ingestion-api）。

- [ ] **Step 5: 建议提交边界**
  - `apps/ingestion-api/package.json`、`tsconfig*.json`、`vitest.config.ts`、`src/index.ts`、`test/package-entry.test.ts`、`tooling/workspace-policy/src/graph.ts`（service 层）。

---

## Task 2: 两阶段配置与 request ID [ENV-INDEPENDENT]

**目标：** 冻结 `IngestionApiConfig` 类型与 `loadIngestionApiConfig`（env adapter 校验）、`IngestionRequestIdProvider` 端口与默认 `crypto.randomUUID()` 实现。

- Consumes: 规格 §6/§16、ADR-011 §4.6。
- Produces: `src/configuration.ts`、`src/request-id.ts`。

- [ ] **Step 1: 失败测试**
  - `test/configuration.test.ts`：
    - 完整合法 env → 冻结 config（host/port/requestBodyLimitBytes/gracefulShutdownTimeoutMs/databaseUrl/logEnabled/logLevel）；
    - 缺失 `requestBodyLimitBytes` → 启动失败（抛错）；
    - 非法 port/字节上限 → 抛错；
    - config 对象不可变（Object.isFrozen 或字段只读）。
  - `test/request-id.test.ts`：
    - 默认 provider 生成非空、无 `project`/`user`/`Origin`/时间模式的 UUID；
    - 注入 provider 时返回其值；
    - provider 抛错时上层安全处理（本 Task 断言 provider 接口契约）。

- [ ] **Step 2: 最小实现**
  - `configuration.ts`：`IngestionApiConfig` 接口 + `loadIngestionApiConfig(env: NodeJS.ProcessEnv): IngestionApiConfig`（读取并严格校验，缺失/非法抛错，返回冻结对象）。
  - `request-id.ts`：`IngestionRequestIdProvider = () => string`；`defaultRequestIdProvider` 用 `globalThis.crypto.randomUUID()`。

- [ ] **Step 3: 确认通过**
  - `pnpm --filter @aurora/ingestion-api test`（config + request-id）通过；
  - `pnpm --filter @aurora/ingestion-api typecheck` exit 0。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/configuration.ts`、`src/request-id.ts`、`test/configuration.test.ts`、`test/request-id.test.ts`。

---

## Task 3: 请求授权端口与请求准入端口 [ENV-INDEPENDENT]

**目标：** 冻结 `IngestionRequestAuthorizer` 与 `IngestionAdmissionPolicy` 端口；提供测试用 fake 与 allowAll 实现；生产启动缺少 authorizer 时拒绝启动。

- Consumes: 规格 §8/§9、ADR-011 §4.7。
- Produces: `src/access-policy.ts`、`src/admission-policy.ts`。

- [ ] **Step 1: 失败测试**
  - `test/access-policy.test.ts`（或并入 routes-inject）：
    - `IngestionRequestAuthorizer.authorize` 输入仅含 `clientKey`/`environment`/`origin`（可缺失）/`requestId`；
    - 结果稳定区分 `authorized`（+projectId+allowedOrigin）/`unauthenticated`/`originForbidden`/`environmentForbidden`/`temporarilyUnavailable`；
    - 端口不返回数据库行、不返回 secret 摘要、不记录原始 key；
    - fake 实现可注入。
  - `test/admission-policy.test.ts`：
    - `IngestionAdmissionPolicy.check` 返回 `allow`/`temporarilyRejected`/`retryAfterMs`；
    - allowAll 测试实现返回 `allow`。

- [ ] **Step 2: 最小实现**
  - `access-policy.ts`：`AuthorizeIngestionRequestInput`、`AuthorizeIngestionRequestResult`（判别联合）、`IngestionRequestAuthorizer` 接口。
  - `admission-policy.ts`：`CheckIngestionAdmissionInput/Result`、`IngestionAdmissionPolicy` 接口、`allowAllIngestionAdmissionPolicy`。

- [ ] **Step 3: 确认通过**
  - 相关测试通过；typecheck exit 0。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/access-policy.ts`、`src/admission-policy.ts` 及对应测试。

---

## Task 4: 显式 CORS adapter [ENV-INDEPENDENT]

**目标：** 实现范围有限的显式 CORS adapter：OPTIONS 预检（204、回显单一 Origin、`Vary: Origin`、方法 POST、Header 白名单）与 POST 响应 Header（仅授权端口允许时设置 `Access-Control-Allow-Origin`/`Vary`/`Expose-Headers`）；无 `*`、无 Cookie credential。

- Consumes: 规格 §12、ADR-009/011 §4.5。
- Produces: `src/cors.ts`。

- [ ] **Step 1: 失败测试**
  - `test/cors.test.ts`：
    - 合法预检（POST、Content-Type/X-Aurora-Client-Key/X-Aurora-Environment）→ 204 + 回显 Origin + `Vary: Origin`；
    - Origin 缺失/`null`/带路径/带查询 → 拒绝；
    - 非 POST 方法 → 拒绝；
    - 未允许 Header → 拒绝；
    - 无 `Access-Control-Allow-Credentials: true`；无 `*`；
    - POST 响应 Header helper：授权 Origin 时设 `Access-Control-Allow-Origin`/`Expose-Headers`；未授权不设置。

- [ ] **Step 2: 最小实现**
  - `cors.ts`：`validatePreflightOrigin(origin: string): string | null`（规范化 HTTP(S) origin，拒绝 null/路径/查询/fragment/userinfo）、`isPreflightAllowed(method, headers): boolean`、`applyCorsHeaders(reply, allowedOrigin: string | null)`。

- [ ] **Step 3: 确认通过**
  - cors 测试通过；typecheck/lint 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm lint`。

- [ ] **Step 5: 建议提交边界**
  - `src/cors.ts`、`test/cors.test.ts`。

---

## Task 5: receipt 映射与错误映射 [ENV-INDEPENDENT]

**目标：** `PersistIngestionBatchResult` → 逐事件 receipt 语义（`inserted`→`accepted`、`duplicate`→`duplicate_accepted`）；稳定错误 → HTTP 状态与 `ErrorResponse`。

- Consumes: 规格 §15/§17、`@aurora/ingestion-inbox`（`PersistIngestionBatchResult`）、`@aurora/event-schema`（`IngestionReceiptState`、`IngestionErrorCode`）。
- Produces: `src/receipt-mapper.ts`、`src/error-mapper.ts`。

- [ ] **Step 1: 失败测试**
  - `test/receipt-mapper.test.ts`：
    - `inserted` → `perEventResults[].state = accepted`、`retryable: false`；
    - `duplicate` → `duplicate_accepted`、`retryable: false`；
    - 映射结果可被 `parseIngestionEventReceipt` 接受（公共解析器验证）。
  - `test/error-mapper.test.ts`：
    - 稳定错误 → 对应 HTTP 状态（401/403/413/415/429/503/500）；
    - `Retry-After` 由 `retryAfterMs` 向上取整秒；
    - `ErrorResponse` 含 request ID、不含 SQL/堆栈/约束名。

- [ ] **Step 2: 最小实现**
  - `receipt-mapper.ts`：`mapPersistResultsToEventReceipts(result): IngestionEventReceipt[]`（用 event-schema 状态枚举）。
  - `error-mapper.ts`：`mapErrorToHttp(error): { statusCode, body }`（`ErrorResponse` 含 requestId、稳定 message、可选 errorCode）；`retryAfterSeconds(retryAfterMs): number`。

- [ ] **Step 3: 确认通过**
  - 相关测试通过；typecheck/lint 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/event-schema test`（确认 event-schema 未受影响）。

- [ ] **Step 5: 建议提交边界**
  - `src/receipt-mapper.ts`、`src/error-mapper.ts` 及对应测试。

---

## Task 6: 应用工厂 buildIngestionApi 与 POST 路由 [ENV-INDEPENDENT]

**目标：** 实现 `buildIngestionApi`：注册 `POST /v1/batches` handler（固定处理顺序）、OPTIONS 预检路由、request ID、CORS、authorizer/admission 调用、event-schema 解析、`persistBatch` 调用、receipt/HTTP 映射。接受外部依赖，不创建/关闭 Pool。

- Consumes: 规格 §7/§10/§11、`@aurora/event-schema`（`parseIngestionBatchRequest`）、`@aurora/ingestion-inbox`（`persistBatch`）。
- Produces: `src/app.ts`、`src/routes/ingestion-batches.ts`。

- [ ] **Step 1: 失败测试（inject 先行）**
  - `test/routes-inject.test.ts`：
    - 正确 POST（authorized + valid batch）→ 200 + `IngestionRequestReceipt`（逐事件 accepted）；
    - malformed JSON → 400；
    - invalid batch（`parseIngestionBatchRequest` 失败）→ 400；
    - Content-Type 非 json → 415；
    - body 超限 → 413；
    - 缺 environment → 400/403（按顺序）；
    - 凭证失败（unauthenticated/originForbidden/environmentForbidden）→ 401/403；
    - authorizer `temporarilyUnavailable` → 503；
    - admission `temporarilyRejected` → 429 + Retry-After；
    - `persistBatch` 抛稳定错误 → 503，不返回 accepted；
    - duplicate 请求 → `duplicate_accepted`；
    - 混合批次 → 200 + 逐事件混合结果；
    - 响应可通过 event-schema 解析器与 OpenAPI Schema；
    - request ID 全响应；Retry-After 仅 retryable；错误不泄露内部信息。
  - 用 fake authorizer/admission 与 fake persistBatch（注入）。

- [ ] **Step 2: 最小实现**
  - `routes/ingestion-batches.ts`：handler 实现固定处理顺序；调用 `buildIngestionApi` 注入的依赖。
  - `app.ts`：`buildIngestionApi(deps: IngestionApiDependencies): FastifyInstance`（注册路由、OPTIONS、request ID、CORS、error handler）。

- [ ] **Step 3: 确认通过**
  - `pnpm --filter @aurora/ingestion-api test`（routes-inject）通过；
  - typecheck/lint 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-inbox test`（ingestion-inbox 未受影响）。

- [ ] **Step 5: 建议提交边界**
  - `src/app.ts`、`src/routes/ingestion-batches.ts`、`test/routes-inject.test.ts`。

---

## Task 7: OpenAPI 漂移测试 [ENV-INDEPENDENT]

**目标：** 断言服务路由与 approved OpenAPI 一致：路径/方法/operationId/Header/状态码集合/security scheme。

- Consumes: `docs/api/ingestion.openapi.yaml`、规格 §20.6、`tooling/ingestion-openapi-contract`（YAML 解析）。
- Produces: `test/openapi-drift.test.ts`。

- [ ] **Step 1: 失败测试**
  - 解析 `docs/api/ingestion.openapi.yaml`（用 `yaml` 或既有 tooling 模式）：
    - 存在 `POST /v1/batches`、operationId `ingestionSubmitBatch`；
    - 请求 Header `X-Aurora-Client-Key`（security scheme apiKey/header）、`X-Aurora-Environment`（必填）存在；
    - 响应状态码集合 ⊇ `200/400/401/403/413/415/429/500/503`；
    - 200 响应 schema 引用 `IngestionRequestReceipt`。
  - 同时断言服务 inject 实际返回结构不出现 OpenAPI 未声明的响应（对比状态码集合）。

- [ ] **Step 2: 最小实现**
  - `openapi-drift.test.ts` 用 `yaml` 解析 OpenAPI 并断言；服务实际状态码来自 `routes-inject.test.ts` 覆盖。

- [ ] **Step 3: 确认通过**
  - 漂移测试通过；`pnpm openapi:lint` 仍 exit 0（未改 OpenAPI）。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-openapi-contract test`（既有漂移门禁不受影响）。

- [ ] **Step 5: 建议提交边界**
  - `test/openapi-drift.test.ts`。

---

## Task 8: 生命周期、graceful shutdown 与 Pool 释放 [ENV-INDEPENDENT]

**目标：** `startIngestionApi` composition root：创建 Pool、构建应用、启动、注册关闭（停止接收 → 等待进行中 → 关闭 Fastify → 释放 Pool 一次）、启动失败回滚、重复关闭安全。

- Consumes: 规格 §7/§19、ADR-011 §4.7。
- Produces: `src/start.ts`。

- [ ] **Step 1: 失败测试**
  - `test/lifecycle.test.ts`：
    - 用 fake Pool（记录 `end()` 调用次数）：
      - `startIngestionApi` 构建并 listen（port 0）后 close → Pool `end()` 恰好一次；
      - 重复 close → Pool 不重复关闭；
      - 启动失败（listen 抛错）→ 已创建 Pool 被关闭（回滚）；
      - `onClose` 在 Fastify close 时触发。

- [ ] **Step 2: 最小实现**
  - `start.ts`：`startIngestionApi(options: { config, requestIdProvider?, ... }): Promise<{ app, close }>` 或等价——用 `pg.Pool` 创建、`persistBatch` 包装、`buildIngestionApi`、listen、`onClose` 关闭 Pool；失败 catch 关闭 Pool 后重抛。

- [ ] **Step 3: 确认通过**
  - lifecycle 测试通过；typecheck/lint 通过。

- [ ] **Step 4: 相关回归**
  - `pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `src/start.ts`、`test/lifecycle.test.ts`。

---

## Task 9: 安全负例与包入口 [ENV-INDEPENDENT]

**目标：** 包入口/私有路径负例、敏感字段与 SQL/body 日志扫描。

- Consumes: 规格 §18、Workspace Policy。
- Produces: `test/package-entry.test.ts` 扩展、`test/security-negative.test.ts`。

- [ ] **Step 1: 失败测试**
  - `security-negative.test.ts`：
    - `src/` 不含 `X-Aurora-Client-Key` 的日志/明文、`clientKey` 记录、`SQLSTATE`、`constraint`、`.sql` 文本；
    - CORS 不含 `Access-Control-Allow-Credentials: true`、`*`；
    - 不读取 `process.env` 在 src/（除 start.ts 的 env adapter）；
    - 不记录 `request.body`/`envelope`/`databaseUrl`。

- [ ] **Step 2: 最小实现**
  - 完善 `package-entry.test.ts`（私有路径负例、依赖方向）；`security-negative.test.ts`。

- [ ] **Step 3: 确认通过**
  - 安全负例通过；`pnpm check:boundaries` exit 0；`pnpm lint` exit 0。

- [ ] **Step 4: 相关回归**
  - 全包 typecheck。

- [ ] **Step 5: 建议提交边界**
  - `test/package-entry.test.ts`、`test/security-negative.test.ts`。

---

## Task 10: 真实 PostgreSQL 集成测试与 loopback 冒烟 [PG-GATED]

**目标：** 用真实 PostgreSQL 17 验证 HTTP accepted 后 Inbox 记录、duplicate 不新增、不同 project 同 eventId、混合批次、事务失败 503、服务关闭释放连接；loopback 随机端口冒烟。

- Consumes: 规格 §20.5/§21、`@aurora/ingestion-inbox`（migrations + persistBatch）、`AURORA_TEST_DATABASE_URL`。
- Produces: `test/integration/helpers.ts`、`test/integration/real-postgres.test.ts`、`test/integration/loopback.test.ts`。

- [ ] **Step 1: 失败测试**
  - `real-postgres.test.ts`（`describe.skipIf(!process.env.AURORA_TEST_DATABASE_URL)`）：
    - 应用 Migration（用 `node-pg-migrate` runner）；
    - 用 fake authorizer（授权 projectId）+ 真实 `persistBatch` Pool：
      - HTTP accepted → Inbox 有对应记录；
      - 重复请求 → `duplicate_accepted`，Inbox 不新增；
      - 不同 project 同 eventId → 两条记录；
      - 混合批次 → 逐事件 accepted/duplicate；
      - 让 `persistBatch` 抛稳定错误 → HTTP 503，无 accepted；
      - 服务 close → Pool 释放。
  - `loopback.test.ts`：host `127.0.0.1`、port `0`，真实 fetch，close 后 Pool 释放。

- [ ] **Step 2: 最小实现**
  - `integration/helpers.ts`：`testDatabaseUrl()`、`assertIsTestDatabase()`、`createTestPool()`、`queryRows()`（复用 ingestion-inbox 模式）。
  - 复用 `buildIngestionApi`（注入真实 Pool + fake authorizer）与 `startIngestionApi`（真实 Pool）。

- [ ] **Step 3: 确认通过**
  - `AURORA_TEST_DATABASE_URL` 存在时全部集成测试通过；环境不可用时明确记录未执行。

- [ ] **Step 4: 相关回归**
  - `pnpm --filter @aurora/ingestion-api test`（单元）不受影响；`pnpm check:boundaries`。

- [ ] **Step 5: 建议提交边界**
  - `test/integration/helpers.ts`、`real-postgres.test.ts`、`loopback.test.ts`。

---

## Task 11: README、文档、ADR 证据与根级门禁 [ENV-INDEPENDENT / 结果门控]

**目标：** README、formalization-readiness、ADR-011 证据；根级完整质量门禁；依据真实 PostgreSQL 可用性决定实施状态标记。

- Consumes: 全部 Task 产物、规格、ADR-008/011。
- Produces: `apps/ingestion-api/README.md`、`docs/architecture/formalization-readiness.md` 更新、ADR-011 追加记录。

- [ ] **Step 1: 失败测试（文档契约先行）**
  - `test/documentation-contract.test.ts`：README 含 `## 模块定位`、`## 职责`、`## 非职责`、`## 命令`、`AURORA_TEST_DATABASE_URL`；不宣称真实凭证模块/Worker 已实现。

- [ ] **Step 2: 最小实现文档**
  - 创建 `apps/ingestion-api/README.md`；
  - 更新 `docs/architecture/formalization-readiness.md`（数据接入链路状态）；
  - 真实实现并验证后，ADR-011 追加实施证据、实施状态更新 `in-progress`；ADR-008 追加 HTTP 服务证据。

- [ ] **Step 3: 确认通过**
  - 文档契约测试通过；`pnpm format:check`、`git diff --check`。

- [ ] **Step 4: 相关回归**
  - 全仓 `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:coverage`、`pnpm check:boundaries`、`pnpm build`、`pnpm check:ci`、`git diff --check`（真实 PG 可用时再加 `test:integration`）。

- [ ] **Step 5: 建议提交边界**
  - README、formalization-readiness、ADR 追加记录（若真实实现）。

---

## 完成报告要求

实施完成并全部门禁通过后，报告必须包含：完成的 Task（ENV-INDEPENDENT vs PG-GATED 区分）；创建和修改的文件；`buildIngestionApi`/`startIngestionApi` 公共边界；`IngestionRequestAuthorizer`/`IngestionAdmissionPolicy` 端口；请求处理顺序；CORS/预检语义；OpenAPI 与 HTTP 映射（200/400/401/403/413/415/429/500/503）；request ID 与 Retry-After；Inbox/ACK 边界；Fastify inject 测试；真实 PostgreSQL 17 测试结果（accepted/duplicate/rollback、服务关闭释放 Pool）**或明确声明未验证**；loopback 冒烟；覆盖率与全仓门禁退出码；实际依赖版本（fastify 5.10.0）；与计划的偏差；ADR 状态（ADR-011 更新 in-progress，ADR-008 in-progress，ADR-009 in-progress，ADR-010 implemented，ADR-005 in-progress）；Git 状态；剩余模块统计；建议提交边界；并明确说明：未实现真实凭证数据库、Worker、采样、真实限流、CI/RDS/IaC，未规划或实施下一模块，未提交或推送。
