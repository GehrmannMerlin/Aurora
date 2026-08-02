---
title: Aurora 数据接入 OpenAPI 机器契约第一增量
status: approved
implementation-status: not-started
approval-status: approved
owner: ingestion
created: 2026-08-01
last-reviewed: 2026-08-01
applies-to: docs/api/ingestion.openapi.yaml（OpenAPI 3.1.0）、SDK 与数据接入服务共用的 HTTP 传输投影、event-schema 漂移门禁
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-004-asynchronous-event-processing.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../security/ingestion-transport-and-client-credential.md
  - ../protocol/ingestion-batch-and-receipt-contract.md
  - ../architecture/deployment.md
  - ../architecture/system-overview.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: ingestion-openapi-field-or-compatibility-change
---

# Aurora 数据接入 OpenAPI 机器契约第一增量

## 1. 定位、效力与当前状态

本文冻结数据接入公开 HTTP 传输的机器契约投影。机器文件为 `docs/api/ingestion.openapi.yaml`（OpenAPI `3.1.0`），是 `@aurora/event-schema` 数据接入批次与接收结果协议（[批次与接收结果协议](../protocol/ingestion-batch-and-receipt-contract.md)）在 HTTP 传输层的投影；本文是人类说明与漂移门禁的权威来源。

**批准状态**：本文于 2026-08-01 由用户批准（`status: approved`、`implementation-status: not-started`、`approval-status: approved`）。本规格由 approved PRD、accepted ADR-004/005/008/009 和已实施批次/接收结果协议无歧义推导；自动审批依据见规格自检节。

**OpenAPI 是 HTTP 传输投影，不是第二套协议来源**：批次请求正文、请求级/逐事件接收结果、稳定状态枚举、稳定错误码、`retryable`/`retryAfterMs` 的全部机器语义唯一来源是 `@aurora/event-schema`。OpenAPI 只把这些语义表达为 HTTP 请求/响应 Schema，不得重新定义不同的状态、错误码或字段限制。

**"已可靠接收"唯一边界**：OpenAPI 中 `200` 响应的 `perEventResults[].state === 'accepted'`（或 `duplicate_accepted`）严格对应 ADR-008 的 `event_inbox` 事务提交成功。OpenAPI 层不写入 Inbox、不访问数据库、不生成事件 ID、不执行采样或限流。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion
- **适用范围**：SDK → 数据接入服务的 HTTP 上报；数据接入服务按此契约实现同步接收路径与逐事件结果返回。
- **明确非职责**：
  - 不定义 Inbox 数据模型、数据库 Schema、Migration；
  - 不实现 Fastify 路由、接入服务、密钥数据库、密钥生成/轮换、CORS 中间件；
  - 不实现 SDK transport、队列、采样、限流、Worker；
  - 不定义请求字节上限数值（`requires-benchmark`）、精确凭证随机位数与摘要算法（凭证数据模型规格）。

## 3. 权威来源与映射原则

| 权威来源                                                                                            | 在本 OpenAPI 中的角色                                                                                             |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [批次与接收结果协议](../protocol/ingestion-batch-and-receipt-contract.md)（`@aurora/event-schema`） | 批次请求正文、请求级/逐事件接收结果、状态枚举、错误码、`retryable`/`retryAfterMs`、限制数值的唯一机器来源         |
| [ADR-008](../adr/ADR-008-ingestion-durable-buffering.md)                                            | "已可靠接收" = `event_inbox` 事务提交成功                                                                         |
| [ADR-009](../adr/ADR-009-ingestion-transport-and-client-credential.md)                              | 公开主机/路径/版本、凭证传递、来源匹配、环境标识、HTTP 状态映射、CORS、Retry-After、请求 ID、OpenAPI 版本与工具链 |
| [event-envelope-v1.md](../protocol/event-envelope-v1.md) 与 `@aurora/event-schema` 公共信封         | 单个 `EventEnvelope` 字段与限制                                                                                   |

**映射规则**：

- OpenAPI `components.schemas` 的 property 名、`required`、`enum`、数组/字符串限制必须与 event-schema 完全一致；
- OpenAPI 不得导入 `@aurora/event-schema` 私有路径（`src/`、`internal/`、未导出深路径）；
- 合法样本必须同时通过 event-schema 解析器和 OpenAPI Schema；非法样本不能因 OpenAPI 过宽而被接受；边界样本在两个契约中一致；
- 示例不得包含真实客户端密钥；Query 参数中不得出现任何凭证；`X-Aurora-Client-Key` 不得出现在日志示例或普通响应；
- OpenAPI 不重新定义 Inbox 或数据库字段。

## 4. API v1 与 protocolVersion 的独立关系

- HTTP API 主版本与事件 `protocolVersion` 是两个独立的兼容维度；
- API v1 第一增量只接受当前支持的事件协议版本 1（`CURRENT_PROTOCOL_VERSION = 1`）；
- 未来事件协议升级不要求同步提升 HTTP API 主版本；`POST /v1/batches` 可继续承载新协议版本，只要接收服务支持对应解析；
- OpenAPI 的 `components.schemas.EventEnvelope` 中 `protocolVersion` 为 `const: 1`，反映当前第一增量只接受协议版本 1 的事实，不把 API 版本与协议版本绑定。

## 5. `POST /v1/batches`

- **路径**：`/v1/batches`
- **方法**：`POST`
- **operationId**：`ingestionSubmitBatch`
- **主机**：独立公开主机；主机名由部署环境配置，不写死在 OpenAPI `servers` 中（不设置 `servers`）。
- **请求 Content-Type**：`application/json`（`415` 当 Content-Type 不是 `application/json`）
- **响应 Content-Type**：`application/json`
- **压缩**：第一版不承诺请求压缩格式；压缩支持 deferred。
- **请求级 Header**：
  - `X-Aurora-Client-Key`（必填，`apiKey` security scheme）
  - `X-Aurora-Environment`（必填，环境标识）
  - `Content-Type: application/json`（必填）

## 6. 客户端上报密钥 security scheme

- **security scheme 名**：`ClientIngestionKey`
- **类型**：`apiKey`
- **传递位置**：`in: header`
- **Header 名**：`X-Aurora-Client-Key`
- **格式**：`aurora_ingest_<keyId>_<secret>`；OpenAPI 把完整值视为 `opaque string`（`type: string`），不解析组成部分；
- **禁止**：Query、URL、Cookie 或请求正文传递；
- **隔离**：与管理平台 Session、Bearer Token 和用户身份认证完全隔离；
- **能力**：密钥只授予数据上报能力，不授予读取、查询、管理、Source Map 或平台访问能力；
- **状态语义**：disabled、revoked、expired 或轮换后的旧密钥立即失效；无效或缺失密钥返回 `401`；客户端不得自动把认证失败当成临时故障重试。

## 7. `X-Aurora-Environment`

- Header 名：`X-Aurora-Environment`；
- 必填；
- 类型：`string`；
- 值是项目环境目录中的稳定环境标识；
- 密钥可以限制允许的环境集合；请求环境不在密钥允许集合时返回 `403`（永久拒绝）；
- 环境不授予额外权限，只用于数据分域、策略校验和诊断；
- 不把 environment 加入每个 EventEnvelope；
- OpenAPI 中用 `string` 表达，不自行发明新的环境枚举；精确环境名称集合由项目配置决定。

## 8. Origin 与非浏览器语义

- 浏览器请求使用 `Origin` 作为来源匹配输入；不使用 `Referer` 作为认证或安全回退；Referer 最多可用于不含路径和查询信息的有界诊断，但第一增量默认不采集；
- Origin 必须与项目 allowlist 完整 origin 精确匹配；禁止 `*`；
- 来源匹配是防误用和额度滥用保护，不宣称是强认证边界；
- Origin 缺失默认拒绝；只有客户端密钥策略明确设置 `allowNonBrowser=true` 时才允许；非浏览器客户端仍必须提供有效密钥和环境 Header；`allowNonBrowser` 默认 false；
- 来源不允许或非浏览器策略不允许 → `403` 永久拒绝，`retryable: false`；
- 本轮只冻结语义，不实现密钥策略数据库；OpenAPI 不声明 `Origin`/`allowNonBrowser` 为请求 Schema 字段（它们由服务端根据请求上下文评估，不属于 JSON body）。

## 9. CORS 投影

CORS 不是 JSON Schema 的一部分，但 OpenAPI 的人类说明必须记录：

- 只允许项目 allowlist 中的精确 Origin；不允许 `Access-Control-Allow-Origin: *`；
- 成功时回显经过校验的单一 Origin；返回 `Vary: Origin`；
- 不启用 Cookie 或浏览器凭证模式；不返回 `Access-Control-Allow-Credentials: true`；
- 允许方法：`POST`、`OPTIONS`；
- 允许请求 Header：`Content-Type`、`X-Aurora-Client-Key`、`X-Aurora-Environment`；
- 暴露响应 Header：`X-Aurora-Request-Id`、`Retry-After`；
- 预检（`OPTIONS`）不要求发送真实客户端密钥；只校验 Origin、请求方法和请求 Header；预检成功不代表实际 POST 已通过认证；
- CORS 中间件实现不属于本轮 OpenAPI 机器契约实现（接入服务模块）。

## 10. 批次请求 Schema

映射 [IngestionBatchRequest](../protocol/ingestion-batch-and-receipt-contract.md#42-批次请求正文)：

| OpenAPI Schema 名       | 对应 event-schema 类型  | 字段与限制                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IngestionBatchRequest` | `IngestionBatchRequest` | `protocolVersion`（required，`const: 1`）、`events`（required，`minItems: 1`、`maxItems: 50`）、`receivedAt`（optional，正安全整数 Unix epoch 毫秒）                                                                                        |
| `EventEnvelope`         | `EventEnvelope`         | `protocolVersion`（required，`const: 1`）、`eventId`（required，`minLength: 1`、`maxLength: 128`）、`eventType`（required，`enum`）、`occurredAt`（required，正安全整数）、`body`（required，`type: object`，`additionalProperties: true`） |
| `EventType`             | `EventType` 值          | `enum`: `error`、`request`、`performance`                                                                                                                                                                                                   |

`maxItems: 50` 直接引用 `BATCH_EVENT_LIMITS.maxEventsPerBatch = 50`；`eventId` 长度引用 `EVENT_SCHEMA_LIMITS.maxEventIdLength = 128`；`protocolVersion` 引用 `CURRENT_PROTOCOL_VERSION = 1`。OpenAPI 不建立第二套限制值。

## 11. 请求级 receipt

映射 [IngestionRequestReceipt](../protocol/ingestion-batch-and-receipt-contract.md#43-请求级接收结果)：

| OpenAPI Schema 名         | 对应 event-schema 类型     | 字段与限制                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IngestionRequestReceipt` | `IngestionRequestReceipt`  | `batchState`（required，`enum`）、`errorCode`（optional，`enum`）、`retryable`（required，boolean）、`retryAfterMs`（optional，`0..86400000`）、`perEventResults`（required，`type: array`）                                                                                                                                     |
| `IngestionReceiptState`   | `IngestionReceiptState` 值 | `enum`: `accepted`、`duplicate_accepted`、`permanently_rejected`、`temporarily_failed`                                                                                                                                                                                                                                           |
| `IngestionErrorCode`      | `IngestionErrorCode` 值    | `enum`: `batch_accepted`、`event_accepted`、`duplicate_accepted`、`unsupported_protocol_version`、`invalid_schema`、`field_exceeds_limit`、`forbidden_field`、`invalid_event_type`、`project_permanently_not_allowed`、`source_permanently_not_allowed`、`service_temporarily_unavailable`、`rate_limited`、`capacity_protected` |

`retryAfterMs` 上限引用 `BATCH_EVENT_LIMITS.maxRetryAfterMs = 86400000`。

## 12. 逐事件 receipt

映射 [IngestionEventReceipt](../protocol/ingestion-batch-and-receipt-contract.md#44-逐事件接收结果)：

| OpenAPI Schema 名       | 对应 event-schema 类型  | 字段与限制                                                                                                                                                                                         |
| ----------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IngestionEventReceipt` | `IngestionEventReceipt` | `eventId`（required，`minLength: 1`、`maxLength: 128`）、`state`（required，`enum`）、`errorCode`（optional，`enum`）、`retryable`（required，boolean）、`retryAfterMs`（optional，`0..86400000`） |

## 13. HTTP 状态码映射

| 状态码 | 语义                                                                                                                                                                                                                                   | body                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | JSON 可解析、批次结构可解析、密钥/来源/环境通过请求级校验、每个事件有明确 receipt。全部 accepted、混合、全部永久拒绝、duplicate_accepted、部分暂时失败均返回 200。逐事件语义以 `perEventResults` 为准，HTTP 200 不代表每条事件均成功。 | 完整 `IngestionRequestReceipt`                                                                                                   |
| `400`  | malformed JSON；无法解析的批次结构；缺少必填字段；无法建立逐事件结果的请求级永久错误                                                                                                                                                   | `IngestionRequestReceipt`（或最小错误 body，见 §14）                                                                             |
| `401`  | 缺少客户端密钥；密钥格式非法；密钥不存在；disabled/revoked/expired；轮换后旧密钥                                                                                                                                                       | `IngestionRequestReceipt`（`errorCode` 可为请求级永久错误）或最小错误 body                                                       |
| `403`  | Origin 不允许；缺失 Origin 且密钥未允许非浏览器；environment 不允许；项目或密钥策略永久禁止                                                                                                                                            | `IngestionRequestReceipt`（永久拒绝，`retryable: false`）                                                                        |
| `413`  | 请求体超过服务端保护阈值。本轮不冻结字节数；`maxEventsPerBatch` 仍是唯一机器限制；字节上限 `requires-benchmark`                                                                                                                        | 最小错误 body                                                                                                                    |
| `415`  | Content-Type 不是 `application/json`                                                                                                                                                                                                   | 最小错误 body                                                                                                                    |
| `429`  | 请求级限流或容量保护；`retryable: true`；可提供 `Retry-After`；不得返回已可靠接收假结果                                                                                                                                                | `IngestionRequestReceipt`（`batchState: temporarily_failed`，`errorCode: rate_limited`/`capacity_protected`，`retryable: true`） |
| `503`  | PostgreSQL/Inbox 暂时不可用、容量保护、无法完成可靠持久化边界；不得映射为 accepted                                                                                                                                                     | `IngestionRequestReceipt`（`batchState: temporarily_failed`，`errorCode: service_temporarily_unavailable`，`retryable: true`）   |
| `500`  | 未分类内部错误；不泄露内部服务/SQL/约束名/堆栈；默认可重试；能明确映射 503 时优先 503                                                                                                                                                  | 最小错误 body                                                                                                                    |

**响应模型约束**：200 响应必须包含完整请求级 receipt；逐事件结果使用现有 `perEventResults`；4xx/5xx 优先映射为现有请求级 receipt，不建立第二套业务错误码。若现有请求级 receipt 无法表达 malformed JSON 等请求前错误，采用 OpenAPI 最小错误 body（`ErrorResponse`，见 §14），字段是传输层诊断而非业务错误码，仍不引入第二套业务错误码。

## 14. 错误响应 body

为请求级错误（400/401/403/413/415/500）提供最小 `ErrorResponse`：

| 字段        | 类型             | 说明                                                    |
| ----------- | ---------------- | ------------------------------------------------------- |
| `requestId` | string（opaque） | 对应 `X-Aurora-Request-Id` 响应 Header                  |
| `message`   | string           | 固定、稳定、不含输入值的错误消息                        |
| `errorCode` | string           | 可选；使用现有 `IngestionErrorCode`，不发明新业务错误码 |

`ErrorResponse` 是传输层诊断结构，不属于 event-schema 协议正文；它不承载 `perEventResults`（请求前错误没有逐事件结果）。

## 15. `Retry-After`

- HTTP 使用标准 `Retry-After` Header；
- 第一版只使用整数秒形式，不使用 HTTP-date；
- 由 body 中 `retryAfterMs` 向上取整转换为秒（`Math.ceil(retryAfterMs / 1000)`）；
- 只允许出现在 retryable 请求级响应（`batchState: temporarily_failed` 或 `retryable: true`）；
- 主要用于 `429` 和 `503`；
- body 中继续保留机器协议定义的 `retryAfterMs`；
- Header 与 body 不一致时视为契约测试失败。

## 16. `X-Aurora-Request-Id`

- 每个 HTTP 请求均生成服务端请求 ID；
- 响应 Header 固定为 `X-Aurora-Request-Id`；
- 请求 ID 用于日志、诊断和支持关联；
- 不等同于 eventId；不由客户端控制；
- 不包含项目、用户、来源或时间等可推断信息；
- OpenAPI 将其声明为 opaque string（`type: string`，无 format）；
- 精确生成算法由接入服务实现规格冻结。

## 17. 部分成功

- 一个批次允许部分 `accepted`、部分 `permanently_rejected`、部分 `temporarily_failed`（ADR-008 校正 3）；
- 单条永久拒绝不回滚其他已持久化合法事件；单条暂时失败不改变其他事件结果；
- 每个事件都有独立结果（`perEventResults`）；
- 请求级结果（`batchState`）反映批次整体，不能掩盖逐事件结果；
- HTTP 状态始终为 `200`（请求级校验通过时），无论逐事件结果如何。

## 18. duplicate_accepted

- 同一 `(project_id, event_id)` 幂等键已在 Inbox 时返回 `duplicate_accepted`；
- `retryable: false`；
- OpenAPI 映射 `IngestionReceiptState.duplicate_accepted` 为 `perEventResults[].state` 的合法值；
- 不暴露数据库约束名称或错误。

## 19. 永久拒绝

- `permanently_rejected` 包括：`unsupported_protocol_version`、`invalid_schema`、`field_exceeds_limit`、`forbidden_field`、`invalid_event_type`、`project_permanently_not_allowed`、`source_permanently_not_allowed`；
- `retryable: false`；
- SDK 不重试永久拒绝（PRD 6.1、ADR-004）；
- 请求级来源/环境/项目策略永久禁止 → `403`；事件级 Schema/字段/事件类型 → `200` 且 `perEventResults[].state === 'permanently_rejected'`。

## 20. 暂时失败

- `temporarily_failed` 包括：`service_temporarily_unavailable`、`rate_limited`、`capacity_protected`；
- `retryable: true`，可给出可选 `retryAfterMs`；
- 请求级暂时失败 → `429` 或 `503` + `Retry-After`；
- 事件级暂时失败 → `200` 且 `perEventResults[].state === 'temporarily_failed'`；
- 不得把未知服务端错误伪装为已可靠接收。

## 21. 字节上限 deferred

- `BATCH_EVENT_LIMITS.maxEventsPerBatch = 50` 是批次数量唯一机器限制；
- 请求字节上限保持 `requires-benchmark`；
- OpenAPI 记录可能返回 `413`，但**不声明虚假的精确大小**；
- 不在 OpenAPI 中设置 `maxLength` 到请求 body 的字节级约束。

## 22. OpenAPI 3.1

- 使用 OpenAPI `3.1.0`（`openapi: 3.1.0`）；
- 支持 `type: const`、数字格式表达；
- 机器文件唯一位置：`docs/api/ingestion.openapi.yaml`；
- 不允许再创建第二份 ingestion OpenAPI YAML/JSON；
- OpenAPI 工具只作为 devDependency，不进入生产运行时；
- 工具链：`@redocly/cli`（`redocly lint` 验证 3.1、解析 `$ref`、运行 lint）；`yaml` 用于漂移测试解析；两者均为根 devDependency。

## 23. event-schema 漂移门禁

必须实现自动漂移测试（工具包 `tooling/ingestion-openapi-contract`）：

- **枚举漂移**：`IngestionReceiptState`、`IngestionErrorCode` 的 OpenAPI `enum` 值与 `@aurora/event-schema` 常量逐值一致；
- **required 漂移**：`IngestionBatchRequest`、`IngestionRequestReceipt`、`IngestionEventReceipt`、`EventEnvelope` 的 OpenAPI `required` 字段与 event-schema 解析器要求一致；
- **限制漂移**：`maxEventsPerBatch`（50）、`maxEventIdLength`（128）、`maxRetryAfterMs`（86400000）、`minItems`/`maxItems`/`minLength`/`maxLength` 与 `@aurora/event-schema` 常量一致；
- **样本漂移**：合法批次/请求级/逐事件样本必须通过对应 OpenAPI Schema；非法样本不能因 OpenAPI 过宽而被接受；边界样本在两个契约中一致；
- **`retryable`/`retryAfterMs` 语义**：OpenAPI 字段类型与 event-schema 一致；
- 漂移测试只从 `@aurora/event-schema` 包根消费样本、枚举和解析器；不导入私有路径；
- 若 OpenAPI 工具无法直接验证某些 event-schema 运行时限制，编写明确漂移测试，不通过人工声明代替自动证据，不修改 event-schema 来迁就工具。

## 24. 隐私和安全

- Query 中不得出现任何凭证；
- 示例不得包含真实客户端密钥；
- `X-Aurora-Client-Key` 不得出现在日志示例或普通响应；
- 错误响应不泄露 SQL、内部服务、堆栈或约束名；
- 不启用 Cookie credential；CORS 不使用 `*`；
- Origin 缺失语义一致；
- environment 不授予权限；
- request ID 不包含可推断信息；
- 事件正文继续遵守 event-schema 禁止字段（Cookie、Authorization、请求/响应体、表单、DOM、IP 等）。

## 25. 兼容策略

- OpenAPI 是公共机器契约；字段、枚举、限制、Header、状态码变化需先完成兼容评估；
- 不兼容变化需要 accepted ADR；
- 增加新状态或错误码会被旧解析器拒绝，必须先完成兼容评估；
- OpenAPI 只做加法新增；不修改 event-schema 公共 API；
- SDK、Core、Browser 和插件不受本 OpenAPI 影响（它们不依赖 OpenAPI 文件）。

## 26. 排除范围

- Inbox 数据模型、数据库 Schema、Migration；
- Fastify 路由、接入服务、密钥数据库、密钥生成/轮换、CORS 中间件；
- SDK transport、队列、采样、限流算法、Worker；
- 请求字节上限数值（`requires-benchmark`）；
- 精确凭证随机位数与摘要算法（凭证数据模型规格）；
- request ID 精确生成算法（接入服务实现规格）；
- CORS 中间件实现。

## 27. 后续接入服务和 Inbox 衔接

数据接入服务同步接收路径（ADR-008 后续依赖链第 4 项）必须按本 OpenAPI 实现：`POST /v1/batches` 路由、`X-Aurora-Client-Key`/`X-Aurora-Environment` 校验、Origin 匹配、HTTP 状态映射、`Retry-After`、`X-Aurora-Request-Id`，并把合法事件写入 `event_inbox` 事务后返回请求级 receipt。CORS 中间件在接入服务实现。SDK transport 按本 OpenAPI 发送批次并处理状态映射。

## 28. 测试和漂移门禁（实施门禁）

- `redocly lint docs/api/ingestion.openapi.yaml` 通过（OpenAPI 3.1 解析、`$ref` 完整、operationId 唯一、lint 规则通过）；
- 漂移测试全部通过（枚举/required/限制/样本/`retryable`/`retryAfterMs`）；
- 合法、非法和边界样本通过对应 OpenAPI Schema；
- 文档示例可被 event-schema 公共解析器接受；
- 敏感信息扫描：无真实客户端密钥、无 Query 凭证、错误响应无内部泄露；
- 上述测试纳入 `check:ci`（新增 `redocly lint` 与 `ingestion-openapi-contract` 测试命令）。

## 29. 规格自检

- 所有路径、Header、状态码和安全语义来自 ADR-009 批准的最终决定；
- 所有 body、receipt、状态和错误码来自 `@aurora/event-schema`；
- "已可靠接收"严格对应 ADR-008 Inbox 事务提交成功；
- 没有第二套机器协议；
- 没有修改 ADR-004/005/008/009 的语义；
- event-schema 公共 API 不被破坏；SDK、Core、Browser 和插件不受影响；
- OpenAPI 只做加法新增；无私有路径；无生产运行时依赖；新工具只属于 devDependency；
- 每个规格项映射到实施计划 Task；operationId、Schema、Header、状态码全文一致；
- 没有占位、没有未定义 `$ref`、没有夹带接入服务/数据库/Migration；
- Query 无凭证；示例无真实密钥；错误响应不泄露内部信息；不启用 Cookie credential；CORS 不使用 `*`；Origin 缺失语义一致；environment 不授予权限；request ID 不包含可推断信息。

自动审批依据：本规格全部内容由 approved PRD、accepted ADR-004/005/008/009、已实施 `@aurora/event-schema` 批次/接收结果协议无歧义推导，无新增产品/架构/安全/隐私决策；自检全部通过。
