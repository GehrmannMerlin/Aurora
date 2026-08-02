---
title: Aurora 数据接入同步 HTTP 服务第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion
created: 2026-08-01
last-reviewed: 2026-08-01
applies-to: apps/ingestion-api（Fastify 5.10.0，POST /v1/batches + OPTIONS/CORS + 凭证/准入端口 + Inbox 集成）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-004-asynchronous-event-processing.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../adr/ADR-011-ingestion-http-service-runtime.md
  - ../api/ingestion-openapi.md
  - ../protocol/ingestion-batch-and-receipt-contract.md
  - ../architecture/ingestion-inbox-data-model.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: ingestion-http-service-contract-or-release
---

# Aurora 数据接入同步 HTTP 服务第一增量

## 1. 定位、效力与当前状态

本文冻结数据接入同步 HTTP 服务第一增量，实施为 `apps/ingestion-api`（Fastify 5.10.0）。它承载 ADR-008 后续依赖链第 4 项（数据接入服务同步接收路径）的 HTTP 编排：`POST /v1/batches` 路由、OPTIONS/CORS、请求 ID、凭证/准入端口、event-schema 解析、Inbox `persistBatch` 调用、receipt 映射与 HTTP 状态映射。

**批准状态**：本文于 2026-08-01 由用户预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-01 更新为 `implemented`：`apps/ingestion-api` 已实施（`buildIngestionApi`/`startIngestionApi`、`POST /v1/batches`、OPTIONS/CORS、请求授权/准入端口、receipt 映射）并通过真实 PostgreSQL 17.10 集成测试与全仓质量门禁。本文由 accepted ADR-004/005/008/009/010/011 与 approved OpenAPI/批次协议/Inbox 规格无歧义派生；自动审批依据见规格自检节。

**ACK 唯一边界**：只有 `@aurora/ingestion-inbox` 的 `persistBatch` 事务 COMMIT 成功返回 `inserted`（或 `duplicate`），服务才映射为 `accepted`（或 `duplicate_accepted`）。服务不重新实现 Inbox 写入、不读取 Migration 内部表、不捕获约束名做业务判断。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion
- **适用范围**：`apps/ingestion-api` 应用工厂、启动入口、路由、CORS、请求授权端口、请求准入端口、receipt/HTTP 映射、生命周期。
- **明确非职责**：
  - 真实客户端密钥表、密钥摘要/创建/轮换/撤销、管理 API；
  - Worker、租约消费、重试调度、死信重放、采样、真实限流系统；
  - SDK transport、Redis/BullMQ、SQS/Kinesis；
  - CI、RDS、容器、IaC、管理平台。

## 3. Fastify 与 Node 24 兼容证据门禁

- 运行时：Fastify 5.10.0（`apps/ingestion-api` 生产依赖）；
- Node 24 兼容门禁必须新鲜验证：安装、TypeScript 编译、`ready()`、`inject()`、JSON 请求/响应、error handler、`listen({ host: '127.0.0.1', port: 0 })`、`close()`、重复关闭、`onClose`；
- 门禁结果作为项目自身的 Node 24 兼容证据记录，不描述为 Fastify 官方承诺 Node 24；
- 任一关键测试失败：不降低 Node 版本、不静默切换 Fastify 版本、停止并报告兼容缺口。

## 4. 职责与非职责

### 4.1 职责

- Fastify 应用工厂 `buildIngestionApi` 与启动入口 `startIngestionApi`；
- `POST /v1/batches` 与 OPTIONS/CORS adapter；
- 请求 ID（`globalThis.crypto.randomUUID()`，不接受客户端权威值）；
- Header/Content-Type/请求体上限；
- 调用凭证/访问策略端口（`IngestionRequestAuthorizer`）；
- 调用 Inbox `persistBatch`；receipt 与 HTTP 映射；Retry-After；
- 稳定错误处理；启动/关闭与 Pool 释放；
- 单元、inject、loopback 冒烟、真实 PostgreSQL 集成、OpenAPI 漂移测试。

### 4.2 非职责

- 不实现真实凭证持久化、密钥创建/轮换/撤销、管理 API；
- 不实现 Worker、租约、重试、死信、采样、真实限流；
- 不实现 SDK transport、队列、CI、RDS、IaC。

## 5. 应用目录与 Workspace 边界

- 目录 `apps/ingestion-api`，包名 `@aurora/ingestion-api`，`"private": true`，不作为公共 npm 包发布；
- 应用入口与可测试应用工厂分离（`start.ts` vs `app.ts`）；
- Workspace Policy 新增 `service` 层：
  - 允许 `service → protocol`、`service → data`、`service → tooling`（仅构建和测试允许的公共入口）；
  - 禁止 `protocol/data/sdk-*/→ service`、`service → SDK Core/Browser/插件`、`service → event-schema 或 ingestion-inbox 私有路径`、OpenAPI tooling 进入生产运行时；
- `apps/ingestion-api` 只能从 `@aurora/event-schema` 与 `@aurora/ingestion-inbox` 包根消费。

## 6. 配置

采用"两阶段配置"：

1. `start.ts` 从环境变量读取不可信字符串；
2. `configuration.ts` 一次性校验并生成冻结的 typed config；
3. `buildIngestionApi` 只接受已验证配置和显式依赖；
4. 路由和业务模块不得直接访问 `process.env`。

第一增量不使用 dotenv 生产运行时加载、YAML/JSON 配置文件、远程配置中心、模块导入时读取环境变量。

必要配置项：

| 配置项                      | 类型           | 说明                                                                |
| --------------------------- | -------------- | ------------------------------------------------------------------- |
| `host`                      | string         | 监听地址                                                            |
| `port`                      | number         | 监听端口                                                            |
| `requestBodyLimitBytes`     | number         | 请求体字节上限（启动必填，非产品承诺；不写入 OpenAPI 固定业务限制） |
| `gracefulShutdownTimeoutMs` | number         | 优雅关闭超时                                                        |
| `databaseUrl` 或外部 Pool   | string \| Pool | 外部注入或 composition root 创建                                    |
| `logEnabled`                | boolean        | 日志启用                                                            |
| `logLevel`                  | string         | 日志级别                                                            |

请求体字节上限缺失或非法时启动失败；不使用隐式超大默认值；不得在配置中放入客户端密钥。

## 7. build/start 两层与 Pool 所有权

- **`buildIngestionApi`**：接受外部依赖（已验证 config、`IngestionRequestAuthorizer`、`IngestionAdmissionPolicy`、可选 Pool）；不创建 Pool；不关闭调用方提供的 Pool；适合 `inject`、单元和集成测试。
- **`startIngestionApi`**：composition root；根据已验证配置创建 Pool；构建应用；启动监听；注册关闭处理；明确拥有它创建的 Pool；Fastify 停止接收新请求并完成进行中请求后关闭 Pool；Pool 只能关闭一次；启动失败必须回滚并关闭已创建资源。
- 不得在普通 route handler 中创建或关闭 Pool。

## 8. 请求授权端口

```ts
export interface IngestionRequestAuthorizer {
  authorize(input: AuthorizeIngestionRequestInput): Promise<AuthorizeIngestionRequestResult>;
}
```

输入只包含 `clientKey`、`environment`、`origin` 或 origin 缺失、`requestId`。

结果稳定表达：

- `authorized` + `projectId` + `allowedOrigin`；
- `unauthenticated`；
- `originForbidden`；
- `environmentForbidden`；
- `temporarilyUnavailable`。

要求：不返回数据库行；不返回 secret 摘要；不记录原始 key；不暴露 Session；不赋予读取或管理权限；允许测试显式注入 fake；后续真实凭证模块实现该端口。生产启动缺少 authorizer 实现时必须拒绝启动；测试必须显式注入。

## 9. 请求准入端口（429 预留）

```ts
export interface IngestionAdmissionPolicy {
  check(input: CheckIngestionAdmissionInput): Promise<CheckIngestionAdmissionResult>;
}
```

结果：`allow`、`temporarilyRejected`、`retryAfterMs`。第一增量提供显式 allowAll 测试实现；生产启动必须显式配置。不实现真实限流器、Redis 计数器或配额系统。

## 10. 请求处理顺序

固定顺序：

1. 生成服务端 request ID；
2. 检查方法、媒体类型和请求体上限；
3. 读取但不记录客户端密钥；
4. 读取 environment；
5. 读取 Origin；
6. 调用 `IngestionRequestAuthorizer.authorize`（凭证 + 项目策略 + Origin allowlist + environment 校验）；
7. 调用 `IngestionAdmissionPolicy.check`（准入）；
8. 解析批次 JSON；
9. 调用 `parseIngestionBatchRequest`；
10. 对合法事件调用 `persistBatch`；
11. 事务 COMMIT 成功后形成 accepted；
12. 组合请求级和逐事件 receipt；
13. 映射 HTTP 状态和响应 Header；
14. 返回响应。

**凭证验证先于 JSON 解析**：先认证与授权，再解析 body，避免未认证请求消耗解析/数据库资源，且认证失败不泄露事件校验细节。不得在日志中记录原始 body；不得在认证失败时返回事件校验细节；不得在 COMMIT 前返回 accepted；不得捕获数据库异常后返回伪成功。

## 11. POST 路由

严格实现 approved OpenAPI `POST /v1/batches`（operationId `ingestionSubmitBatch`，`application/json`）：

- Header：`X-Aurora-Client-Key`（必填）、`X-Aurora-Environment`（必填）、`Content-Type: application/json`（必填）；
- 请求体字节上限触发 413；
- Content-Type 非 `application/json` 触发 415；
- 凭证/Origin/environment 失败映射 401/403；
- 合法批次：`persistBatch` 返回 `inserted`→`accepted`、`duplicate`→`duplicate_accepted`；暂时数据库失败→请求级 503；
- 逐事件结果在 `perEventResults`，HTTP 200 不代表所有事件成功。

## 12. OPTIONS/CORS

第一增量**不安装 `@fastify/cors`**。显式 CORS adapter：

- 明确 OPTIONS 路由与 POST 响应 Header；不注册全局 wildcard CORS；不使用正则 Origin；不使用动态代码执行；不创建无限缓存；不允许 `*`；不允许 Cookie credential；不返回 `Access-Control-Allow-Credentials: true`。

预检语义：

1. OPTIONS 不携带真实客户端密钥；
2. 验证 Origin 存在且是规范化 HTTP(S) origin；
3. 拒绝 `null`、带路径、查询、fragment、userinfo 的值；
4. 验证请求方法必须是 POST；
5. 验证请求 Header 只能是 `Content-Type`、`X-Aurora-Client-Key`、`X-Aurora-Environment`；
6. 成功返回 204；
7. 回显规范化后的单一 Origin；
8. 返回 `Vary: Origin`；
9. 预检成功只表示传输格式可尝试，不代表项目认证或 allowlist 已通过；
10. 不访问 Inbox，不产生 receipt，不构成可靠接收。

实际 POST 的项目级 Origin allowlist 由 `IngestionRequestAuthorizer` 根据客户端密钥对应的项目策略校验。只有授权端口明确返回允许 Origin 时，POST 响应才设置 `Access-Control-Allow-Origin`、`Vary: Origin`、`Access-Control-Expose-Headers: X-Aurora-Request-Id, Retry-After`。未获授权的 Origin 不得由服务自行放行。

## 13. event-schema 解析

- 服务用 `parseIngestionBatchRequest`（`@aurora/event-schema` 包根）解析批次；
- 不重新定义第二套事件 Schema；`body` 保持 `unknown`；
- 合法事件进入 `persistBatch`；非法批次返回 400。

## 14. Inbox 集成

- 服务只使用 `@aurora/ingestion-inbox` 包根的 `persistBatch`；
- 传入可信 `projectId`（来自授权端口）与已通过 event-schema 解析的批次；
- 用 Repository 稳定结果映射：`inserted`→`accepted`、`duplicate`→`duplicate_accepted`、稳定临时错误→`temporarily_failed` 或请求级 503；
- 不依赖 PostgreSQL 行结构；不读取 Migration 内部表；不捕获 constraint 名做业务判断；不在服务中重新实现 ON CONFLICT。

## 15. receipt 与 HTTP 映射

| 场景                                                    | HTTP | body                                                           |
| ------------------------------------------------------- | ---- | -------------------------------------------------------------- |
| 全部/部分 accepted、混合、全部拒绝、部分暂时失败        | 200  | 完整 `IngestionRequestReceipt`（逐事件在 `perEventResults`）   |
| malformed JSON / 无法解析批次 / 请求级必填缺失          | 400  | `ErrorResponse`                                                |
| 缺失/非法/disabled/revoked/expired 密钥                 | 401  | `ErrorResponse`                                                |
| Origin 不允许 / environment 不允许 / 策略拒绝           | 403  | `ErrorResponse`                                                |
| 请求体超限                                              | 413  | `ErrorResponse`                                                |
| Content-Type 非 json                                    | 415  | `ErrorResponse`                                                |
| 请求级限流/容量保护（准入端口）                         | 429  | `IngestionRequestReceipt` + Retry-After                        |
| Inbox/PostgreSQL 暂时不可用、凭证服务临时失败、容量保护 | 503  | `IngestionRequestReceipt`（`temporarily_failed`）+ Retry-After |
| 未分类内部错误                                          | 500  | `ErrorResponse`（含 request ID，不泄露 SQL/堆栈/约束名）       |

- `Retry-After`：整数秒，由 body `retryAfterMs` 向上取整，仅 retryable 响应（429/503）；
- `X-Aurora-Request-Id`：全响应；
- 200 响应符合 OpenAPI `IngestionRequestReceipt`；`perEventResults[].state` 用 event-schema 稳定枚举。

## 16. 请求 ID

- 默认 `globalThis.crypto.randomUUID()`；
- 不接受客户端传入 request ID 作为权威值；
- 不包含 project、用户、Origin 或时间；
- 生成失败必须安全返回内部错误；
- 响应和结构化诊断中使用同一个 request ID；
- 不把 request ID 当作 eventId；
- 允许测试注入 provider。

## 17. Retry-After

- HTTP 标准 `Retry-After` Header，第一版只用整数秒；
- 由 body `retryAfterMs` 向上取整（`Math.ceil(retryAfterMs / 1000)`）；
- 只允许出现在 retryable 请求级响应（429/503）；
- body 保留 `retryAfterMs`；Header 与 body 不一致视为契约测试失败。

## 18. 日志和隐私

允许记录：request ID、稳定错误类别、HTTP 状态、处理耗时、事件数量、非敏感内部 project ID（仅安全规范允许时）。

禁止记录：`X-Aurora-Client-Key`、secret/摘要、完整数据库 URL、EventEnvelope 正文、请求 body、Origin 路径/查询、SQL、SQL 参数、SQLSTATE、约束名、堆栈到普通响应、Cookie/Authorization。日志结构有界。

## 19. 生命周期

定义：

- 创建应用；
- 启动监听；
- 重复启动；
- graceful shutdown：停止接收新请求、等待进行中请求、关闭 Fastify、释放 PostgreSQL Pool、释放其他注入资源；
- 重复关闭；
- 启动失败回滚（关闭已创建资源）；
- SIGTERM/SIGINT 边界。

第一增量提供 `buildIngestionApi` 与 `startIngestionApi`。测试不得占用固定生产端口；优先 Fastify `inject` 或随机端口。

## 20. 测试要求

覆盖率不低于 lines 85%、branches 80%、functions 85%、statements 85%。

### 20.1 路由和协议

正确 POST；malformed JSON；invalid batch；Content-Type 错误；body 超限；缺少 environment；不支持协议版本；accepted；duplicate_accepted；permanently_rejected；temporarily_failed；混合部分成功；response 通过 event-schema 解析器；response 符合 OpenAPI。

### 20.2 凭证和策略

缺少 key；非法 key；disabled；revoked；expired；Origin 允许/拒绝；Origin 缺失且不允许非浏览器；Origin 缺失且允许非浏览器；environment 允许/拒绝；验证服务临时失败；原始 key 不进入日志或错误。

### 20.3 CORS

允许的预检；未允许 Origin；未允许方法；未允许 Header；不要求真实 key；POST 成功回显 Origin；`Vary: Origin`；无 `Access-Control-Allow-Credentials`；无通配符。

### 20.4 HTTP 映射

200/400/401/403/413/415/429/500/503 全部状态；Inbox 失败不返回 accepted；Retry-After 只出现在 retryable；毫秒向整数秒向上取整；request ID 始终存在；错误不泄露内部信息。

### 20.5 真实 PostgreSQL

Migration 已应用；HTTP accepted 后 Inbox 存在对应记录；duplicate 请求不新增记录；不同 project 相同 eventId 可接收；混合新事件和重复事件；事务失败返回 503 不返回 accepted；服务关闭释放连接；测试 Schema 完整清理。

### 20.6 OpenAPI 漂移

路径/方法、operationId、Header、security scheme、状态码集合、receipt 状态和错误码、合法响应符合 OpenAPI；不允许 OpenAPI 未声明的响应结构。

## 21. loopback 冒烟测试

- host `127.0.0.1`、port `0`、不使用固定端口；
- 验证 listen、请求、close 和 Pool 释放；
- 不向公网接口发请求；不依赖测试执行顺序；不使用 mock 数据库替代 PostgreSQL 集成证据。

## 22. 覆盖率与质量门禁

- 应用维持 TypeScript strict；
- 单元、inject、loopback、PostgreSQL 集成、OpenAPI 漂移测试全绿；
- 包入口/应用入口、私有路径负例、Workspace Policy `service` 层负例、ESLint 危险模式检查。

## 23. 文档与 ADR

- `apps/ingestion-api/README.md`；
- `docs/architecture/ingestion-http-service.md`（本文）；
- `docs/architecture/formalization-readiness.md`：数据接入链路状态更新；
- ADR-011：追加 HTTP 服务实施证据（真实实现后）。

## 24. 排除范围

- 真实客户端密钥表、密钥摘要/创建/轮换/撤销、管理 API；
- Worker、租约、重试调度、死信重放、采样、真实限流；
- SDK transport、Redis/BullMQ、SQS/Kinesis；
- CI、RDS、容器、IaC、管理平台。

## 25. 凭证模块和 Worker 后续衔接

- 真实凭证模块（后续）：实现 `IngestionRequestAuthorizer`，从凭证数据模型读取密钥策略与项目 allowlist；
- Worker（后续）：消费 Inbox 记录，按 `(state, available_at)` 领取、租约、重试、死信；服务不涉及 Worker 逻辑。

## 26. 规格自检

- 路径/方法/Header/状态码完全符合 OpenAPI；body 和 receipt 完全来自 event-schema；accepted 只来自 Inbox COMMIT；不改变 ADR-008/009/010；没有第二套协议；不自行定义凭证存储；
- event-schema/OpenAPI/ingestion-inbox 公共 API 不变；SDK 包不依赖服务；无私有路径/循环依赖；Fastify 仅存在于 service 应用；
- 每项规格映射到计划 Task；类型、路径、Header、状态全文一致；无占位；无凭证数据库/Worker/CI/IaC 内容；
- 密钥不进入日志；CORS 无 `*`；无 Cookie credential；预检不构成认证；未授权 POST 不调用 Inbox；request ID 不接受客户端权威值；COMMIT 前不返回 accepted。

自动审批依据：本文全部语义由 accepted ADR-004/005/008/009/010/011 与 approved OpenAPI、批次/接收结果协议、Inbox 规格无歧义派生；无新增产品/架构/安全/隐私决策；自检全部通过。
