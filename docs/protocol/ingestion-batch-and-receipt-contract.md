---
title: Aurora 数据接入批次与接收结果协议第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: protocol
created: 2026-08-01
last-reviewed: 2026-08-01
applies-to: packages/event-schema 的数据接入批次请求、请求级与逐事件接收结果、稳定状态枚举、稳定错误码、重试语义与契约样本
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../architecture/system-overview.md
  - ../architecture/sdk-architecture.md
  - ../architecture/monorepo-and-build.md
  - ../architecture/formalization-readiness.md
  - ../testing/test-strategy.md
  - event-schema-foundation.md
  - event-envelope-v1.md
  - error-event-contract.md
  - request-event-contract.md
  - performance-event-contract.md
  - ../adr/ADR-004-asynchronous-event-processing.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-008-ingestion-durable-buffering.md
supersedes: none
review-cycle: ingestion-protocol-field-or-compatibility-change
---

# Aurora 数据接入批次与接收结果协议第一增量

## 1. 定位、效力与当前状态

本文冻结 `packages/event-schema` 的数据接入批次与接收结果协议第一增量。该增量在既有公共 `EventEnvelope`、协议版本 `1`、有界正文校验和稳定 issue 之上，增加 SDK 数据接入的最小安全批次请求正文、请求级与逐事件接收结果、稳定状态枚举、稳定错误码和重试语义，以及共享契约样本。

**批准状态**：本文于 2026-08-01 由用户批准（`status: approved`、`implementation-status: implemented`、`approval-status: approved`），并已实施为 `@aurora/event-schema` 的真实协议增量。本记录不修改任何 ADR 状态。

本文从 approved PRD（第 6、7 章）、approved 长期规范、现有 approved 协议/SDK 规格，以及 accepted ADR-004（可靠接收与异步处理）、accepted ADR-005（event-schema 单一来源）、accepted ADR-008（数据接入可靠缓冲物理技术 = PostgreSQL 事务性 Inbox）推导。字段组织、私有验证函数、文件拆分和限制数值属于用户已授权收口的普通、可回滚实施细节；本协议是新的公共机器契约，已于 2026-08-01 由用户批准并实施。

**"已可靠接收"唯一边界**：本协议中的 `accepted`（已可靠接收）状态严格对应 ADR-008 的 `event_inbox` 事务提交成功。本协议层不写入 Inbox、不访问数据库、不生成事件 ID、不执行采样或限流；它只定义 SDK、数据接入和数据处理共同遵守的公共批次与接收结果机器契约。

截至 2026-08-01，`@aurora/event-schema` 已实施错误、请求、性能事件契约与数据接入批次与接收结果协议第一增量。本协议作为 ADR-008 后续依赖链第 1 项实施；数据接入 OpenAPI 必须引用或映射本协议，不得成为第二套批次 Schema 权威来源。

## 2. 模块职责与明确非职责

### 2.1 职责

- 定义数据接入批次请求的最小安全正文：协议版本、批次内事件数组和批次级已批准元数据；
- 定义请求级接收结果与逐事件接收结果，覆盖已可靠接收、永久拒绝、暂时失败和重复事件幂等结果；
- 定义稳定的接收状态枚举与稳定错误码；
- 定义 `retryable` 与可选 `retryAfterMs` 的精确语义；
- 定义批次部分成功、逐事件独立结果、请求级结果不掩盖逐事件结果的语义；
- 使用现有 `EventEnvelope`、`CURRENT_PROTOCOL_VERSION`、`EVENT_SCHEMA_LIMITS` 和 `EventSchemaIssue`；
- 从 `unknown` 同步解析批次请求正文、请求级结果和逐事件结果；
- 返回稳定、有限、不包含输入值的校验 issue；
- 生成新的输出对象，不修改输入；
- 提供合法、非法和边界样本，供 SDK、数据接入和数据处理契约测试复用；
- 从包根导出运行时契约，从既有 `contract-testkit` 子路径导出测试样本；
- 复用既有中立字段校验助手（`field-validation.ts`、`value-boundaries.ts`），不复制逻辑；
- 同步模块 README、协议文档、架构追踪和 ADR 实施证据。

### 2.2 明确非职责

- 不依赖数据库、PostgreSQL、Fastify、Browser、Core 或具体插件；
- 不创建 OpenAPI 路由或 OpenAPI security scheme；
- 不生成事件 ID、协议版本或事件时间；
- 不执行 Inbox 写入、采样、限流、去重窗口检查或队列/Worker；
- 不包含数据库错误文本、约束名称或内部异常；
- 不定义客户端上报密钥物理格式、HTTP Header 名称、HTTPS 路径或 HTTP 状态码映射；
- 不定义精确批次数量、请求大小、重试次数、采样率/算法、租约、死信和保留期限；
- 不实现数据接入服务、处理系统、服务端、数据库、管理平台、CI、发布、容器、IaC 或云资源；
- 不建立通用 Schema DSL、注册器、事件总线、转换框架、`utils`、`helpers`、`common` 或 `misc`。

## 3. 与公共事件信封的关系

### 3.1 单一协议来源

本协议不创建第二套信封或协议版本。批次请求与接收结果全部使用现有 `EventEnvelope`、`CURRENT_PROTOCOL_VERSION` 和 `EventSchemaIssue`。接收结果中的事件正文继续由各具体事件契约（错误/请求/性能）的解析器负责；本协议不重新定义事件正文。

### 3.2 解析层次

- `parseEventEnvelope` 继续只证明公共信封和通用资源边界有效；
- 各具体事件正文解析器（`parseErrorEventBody` 等）继续证明单个事件正文有效；
- 本协议新增的解析器证明批次请求正文和接收结果结构有效；
- 消费者只有在接收结果解析成功后，才能把事件结果视为权威接收状态。

## 4. 完整公共 TypeScript 契约

### 4.1 常量、枚举和限制

```ts
export const BATCH_EVENT_LIMITS = Object.freeze({
  readonly maxEventsPerBatch: 50,
  readonly maxEventIdLength: 128,
  readonly maxErrorCodeLength: 64,
  readonly maxRetryAfterMs: 86400000,
} as const);

export const IngestionReceiptState = Object.freeze({
  readonly Accepted: 'accepted',
  readonly DuplicateAccepted: 'duplicate_accepted',
  readonly PermanentlyRejected: 'permanently_rejected',
  readonly TemporarilyFailed: 'temporarily_failed',
} as const);
export type IngestionReceiptState =
  (typeof IngestionReceiptState)[keyof typeof IngestionReceiptState];

export const IngestionErrorCode = Object.freeze({
  readonly BatchAccepted: 'batch_accepted',
  readonly EventAccepted: 'event_accepted',
  readonly DuplicateAccepted: 'duplicate_accepted',
  readonly UnsupportedProtocolVersion: 'unsupported_protocol_version',
  readonly InvalidSchema: 'invalid_schema',
  readonly FieldExceedsLimit: 'field_exceeds_limit',
  readonly ForbiddenField: 'forbidden_field',
  readonly InvalidEventType: 'invalid_event_type',
  readonly ProjectPermanentlyNotAllowed: 'project_permanently_not_allowed',
  readonly SourcePermanentlyNotAllowed: 'source_permanently_not_allowed',
  readonly ServiceTemporarilyUnavailable: 'service_temporarily_unavailable',
  readonly RateLimited: 'rate_limited',
  readonly CapacityProtected: 'capacity_protected',
} as const);
export type IngestionErrorCode =
  (typeof IngestionErrorCode)[keyof typeof IngestionErrorCode];
```

**限制说明**：`maxEventsPerBatch` 为 `50`，与 `EVENT_SCHEMA_LIMITS.maxArrayLength = 100` 保持一致并留有余量，且不超过六专题"批次数量未锁定"的约束——本数值是可在实施时由数据模型/容量基准调整的普通实施细节。`maxEventIdLength` 与 `EVENT_SCHEMA_LIMITS.maxEventIdLength` 一致，引用唯一来源。`maxRetryAfterMs` 为 `86400000`（24 小时），普通实施细节。

### 4.2 批次请求正文

```ts
export interface IngestionBatchRequest {
  readonly protocolVersion: ProtocolVersion;
  readonly events: readonly EventEnvelope[];
  readonly receivedAt?: number;
}
```

- `protocolVersion` 必填，只允许 `CURRENT_PROTOCOL_VERSION`；
- `events` 必填，数组长度 `1..maxEventsPerBatch`，每个元素必须是已通过 `parseEventEnvelope` 的 `EventEnvelope`；
- `receivedAt` 可选，正安全整数 Unix epoch 毫秒，表示 SDK 本地批次准备时间；批次延迟不应改变事件 `occurredAt`。

### 4.3 请求级接收结果

```ts
export interface IngestionRequestReceipt {
  readonly batchState: IngestionReceiptState;
  readonly errorCode?: IngestionErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly perEventResults: readonly IngestionEventReceipt[];
}
```

- `batchState` 必填，只允许四个状态之一；
- `errorCode` 可选，当批次未整体成功时给出稳定错误码；
- `retryable` 必填，布尔值；
- `retryAfterMs` 可选，当 `retryable` 为 `true` 且服务端提供等待时间时给出；
- `perEventResults` 必填，数组；长度必须与请求 `events` 一一对应（解析器上下文校验），允许为空数组——仅当请求级结果已覆盖全部事件时（如协议版本不支持导致整批在事件级处理前拒绝），否则每个事件必须有独立结果。

### 4.4 逐事件接收结果

```ts
export interface IngestionEventReceipt {
  readonly eventId: string;
  readonly state: IngestionReceiptState;
  readonly errorCode?: IngestionErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}
```

- `eventId` 必填，长度 `1..maxEventIdLength`，必须与请求 `events` 中的事件一一对应；
- `state` 必填，四个状态之一；
- `errorCode` 可选；
- `retryable` 必填；
- `retryAfterMs` 可选。

### 4.5 解析结果类型与函数

```ts
export type IngestionBatchRequestParseFailure = EventEnvelopeParseFailure;
export type IngestionBatchRequestParseResult =
  | { readonly success: true; readonly data: IngestionBatchRequest }
  | IngestionBatchRequestParseFailure;

export type IngestionRequestReceiptParseFailure = EventEnvelopeParseFailure;
export type IngestionRequestReceiptParseResult =
  | { readonly success: true; readonly data: IngestionRequestReceipt }
  | IngestionRequestReceiptParseFailure;

export type IngestionEventReceiptParseFailure = EventEnvelopeParseFailure;
export type IngestionEventReceiptParseResult =
  | { readonly success: true; readonly data: IngestionEventReceipt }
  | IngestionEventReceiptParseFailure;

export function parseIngestionBatchRequest(input: unknown): IngestionBatchRequestParseResult;
export function parseIngestionRequestReceipt(input: unknown): IngestionRequestReceiptParseResult;
export function parseIngestionEventReceipt(input: unknown): IngestionEventReceiptParseResult;
```

三个函数均为同步、确定性、非抛出解析入口。它们不记录输入，不修改输入，不调用浏览器或 Node 专属 API。普通非法输入返回 `success: false`；只有程序缺陷或运行时自身不可恢复错误可以抛出。成功结果由解析器新建，调用方在解析后修改原输入不会改变成功结果。

### 4.6 共享样本

以下内容只从 `@aurora/event-schema/contract-testkit` 导出：

```ts
export interface ValidIngestionBatchRequestSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: IngestionBatchRequest;
}
export interface InvalidIngestionBatchRequestSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}
export interface BoundaryIngestionBatchRequestSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: IngestionBatchRequest;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

export interface ValidIngestionRequestReceiptSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: IngestionRequestReceipt;
}
export interface InvalidIngestionRequestReceiptSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}
export interface BoundaryIngestionRequestReceiptSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: IngestionRequestReceipt;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

export const validIngestionBatchRequestSamples: readonly ValidIngestionBatchRequestSample[];
export const invalidIngestionBatchRequestSamples: readonly InvalidIngestionBatchRequestSample[];
export const boundaryIngestionBatchRequestSamples: readonly BoundaryIngestionBatchRequestSample[];
export const validIngestionRequestReceiptSamples: readonly ValidIngestionRequestReceiptSample[];
export const invalidIngestionRequestReceiptSamples: readonly InvalidIngestionRequestReceiptSample[];
export const boundaryIngestionRequestReceiptSamples: readonly BoundaryIngestionRequestReceiptSample[];
```

样本使用固定合成域名、编号和文本，不含真实 Cookie、Token、Authorization、密码、请求/响应正文、表单、DOM、页面文本、用户输入、Storage、IP 或个人信息。

## 5. 字段语义

### 5.1 IngestionBatchRequest

最小合法批次请求：

<!-- contract-example:valid-ingestion-batch -->

```json
{
  "protocolVersion": 1,
  "events": [
    {
      "protocolVersion": 1,
      "eventId": "evt-batch-valid-001",
      "eventType": "error",
      "occurredAt": 1800000005100,
      "body": {}
    }
  ]
}
```

<!-- contract-example:invalid-ingestion-batch -->

```json
{
  "protocolVersion": 2,
  "events": []
}
```

- `protocolVersion`：必填，只允许 `CURRENT_PROTOCOL_VERSION`（字面量 `1`）；类型错误返回 `invalid_type`，不支持版本返回 `unsupported_protocol_version`；
- `events`：必填，数组；空数组返回 `missing_required_field`（视为缺少必需事件），超过 `maxEventsPerBatch` 返回 `array_too_large`，数组元素类型错误返回 `invalid_type`；
- 每个 `events` 元素必须是普通对象且通过 `parseEventEnvelope`；元素非法则逐项返回对应 issue；
- `receivedAt`：可选；存在时必须是正安全整数 Unix epoch 毫秒，非法返回 `invalid_timestamp`。

### 5.2 IngestionRequestReceipt

- `batchState`：必填，四个状态之一；未知值返回 `invalid_enum`；
- `errorCode`：可选；必须是 `IngestionErrorCode` 之一，未知值返回 `invalid_enum`；
- `retryable`：必填，必须是布尔值，类型错误返回 `invalid_type`；
- `retryAfterMs`：可选；存在时必须是 `0..BATCH_EVENT_LIMITS.maxRetryAfterMs` 的安全整数毫秒（本增量冻结为 `86400000` = 24 小时），非法返回 `invalid_number`；
- `perEventResults`：必填，数组；长度必须等于请求事件数（由解析器上下文或独立校验保证），元素必须是合法 `IngestionEventReceipt`。

### 5.3 IngestionEventReceipt

- `eventId`：必填，长度 `1..maxEventIdLength` 的字符串；
- `state`：必填，四个状态之一；
- `errorCode`：可选；
- `retryable`：必填，布尔值；
- `retryAfterMs`：可选。

## 6. 接收状态语义

| 状态                   | 含义                                                           | retryable | errorCode 示例                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted`             | 事件已可靠接收（Inbox 事务提交成功）                           | false     | `event_accepted`                                                                                                                                                                      |
| `duplicate_accepted`   | 同一 `(project_id, event_id)` 幂等键已在 Inbox，结果与首次一致 | false     | `duplicate_accepted`                                                                                                                                                                  |
| `permanently_rejected` | 事件永久拒绝，SDK 不得重试                                     | false     | `unsupported_protocol_version`、`invalid_schema`、`field_exceeds_limit`、`forbidden_field`、`invalid_event_type`、`project_permanently_not_allowed`、`source_permanently_not_allowed` |
| `temporarily_failed`   | 服务暂时无法接收，SDK 可按 `retryAfterMs` 有上限退避重试       | true      | `service_temporarily_unavailable`、`rate_limited`、`capacity_protected`                                                                                                               |

### 6.1 已可靠接收（accepted）

严格等于 ADR-008 的 `event_inbox` 事务提交成功。协议层只定义该状态的机器表示，不执行 Inbox 写入。

### 6.2 重复事件（duplicate_accepted）

重复事件必须设计幂等语义，而不是把数据库唯一冲突暴露给 SDK。候选语义：

- **方案 1：返回 `duplicate_accepted`**——明确告知 SDK 该事件已存在且已被接受，`retryable: false`，SDK 不应重试；
- **方案 2：返回与首次提交一致的 `accepted` 结果**——对 SDK 完全透明，不区分首次与重复；
- **方案 3：`duplicate` 独立状态**——增加语义复杂度，第一版不采用。

**推荐方案 1**：返回 `duplicate_accepted`，`retryable: false`。理由：SDK 需要区分"首次被接受"与"已被接受"，从而正确管理其内存队列（已接受的重复事件应从队列移除，不再次发送）；`duplicate_accepted` 与 `accepted` 的 SDK 行为一致（都不重试），但提供更明确的诊断。本协议不暴露数据库约束名称或错误。

### 6.3 永久拒绝（permanently_rejected）

包括 approved 规则支持的类别：

- `unsupported_protocol_version`：协议版本不支持；
- `invalid_schema`：事件 Schema 非法；
- `field_exceeds_limit`：字段超限；
- `forbidden_field`：命中禁止字段；
- `invalid_event_type`：事件类型不支持；
- `project_permanently_not_allowed`：项目或来源永久不允许。

永久拒绝必须明确 `retryable: false`。SDK 不重试永久拒绝（PRD 6.1、ADR-004）。

### 6.4 暂时失败（temporarily_failed）

包括 approved 规则支持的类别：

- `service_temporarily_unavailable`：服务暂时不可用；
- `rate_limited`：限流；
- `capacity_protected`：容量保护。

必须明确 `retryable: true`，并给出可选的 `retryAfterMs`。不得把未知服务端错误伪装为已可靠接收。

### 6.5 批次部分成功

- 所有事件先独立完成同步校验；合法事件才进入 Inbox 写入集合（ADR-008 校正 3）；
- 一个批次允许部分 `accepted`、部分 `permanently_rejected`、部分 `temporarily_failed`；
- 单条永久拒绝不回滚其他已持久化合法事件；
- 单条暂时失败不改变其他事件结果；
- 每个事件都有独立结果；
- 请求级结果不能掩盖逐事件结果——请求级 `batchState` 反映批次整体，`perEventResults` 反映逐事件细节。

## 7. 空值、缺失值和未知值

- 必填字段缺失返回 `missing_required_field`；
- 可选字段只允许缺失，不接受显式 `null` 或 `undefined`；
- 必填非空字符串为空返回 `string_empty`；
- 字段类型错误返回 `invalid_type`；
- 未知对象字段返回 `unknown_field`；
- 未知枚举值返回 `invalid_enum`；
- `undefined` 无法进入协议正文，返回 `invalid_type`；
- 正文拒绝未知字段。

## 8. 隐私与禁止字段

本文不允许默认写入：

- Cookie、Token、Authorization 或其他凭据；
- 请求头、请求体、响应头或响应体；
- 完整资源 URL、查询参数或片段（由具体事件契约负责移除）；
- 完整表单、完整 DOM、页面文本或用户输入；
- 浏览器 Storage；
- 用户指纹、设备信息或原始 IP；
- 任意无限递归对象。

既有通用正文校验继续按 ASCII 小写拒绝 `authorization`、`cookie`、`password`、`requestbody`、`responsebody`、`formdata`、`dom`、`consolelog` 和 `ipaddress` 字段。校验 issue 只包含稳定 code、字段路径和固定消息，不回显非法字段值。实现不输出生产路径控制台日志。

## 9. 稳定校验错误

本文不增加新的 `EventSchemaIssueCode`，复用现有稳定 code：

- `missing_required_field`：必填字段缺失；
- `invalid_type`：字段类型错误、非普通对象；
- `unknown_field`：未知字段；
- `invalid_enum`：未知状态或未知错误码；
- `string_empty`：必填字符串为空；
- `string_too_long`：`eventId` 或 `errorCode` 超长；
- `array_too_large`：`events` 或 `perEventResults` 超过上限；
- `invalid_number`：数值非法；
- `invalid_timestamp`：`receivedAt` 非正安全整数；
- `invalid_url`、`event_type_mismatch`：由具体事件契约沿用；
- `unsupported_protocol_version`：批次协议版本不支持。

issue 按稳定遍历顺序返回，最多 `EVENT_SCHEMA_LIMITS.maxIssues` 条。

## 10. 运行时校验顺序

`parseIngestionBatchRequest` 固定执行：

1. 顶层必须是普通对象；
2. 执行精确字段允许列表校验（`protocolVersion`、`events`、`receivedAt`）；
3. 校验 `protocolVersion`；
4. 校验 `events` 数组长度与每个元素（对每个元素调用 `parseEventEnvelope`）；
5. 校验可选 `receivedAt`；
6. 返回新建的 `IngestionBatchRequest`。

`parseIngestionRequestReceipt` 固定执行：

1. 顶层必须是普通对象；
2. 执行精确字段允许列表校验（`batchState`、`errorCode`、`retryable`、`retryAfterMs`、`perEventResults`）；
3. 校验 `batchState`、`errorCode`、`retryable`、`retryAfterMs`；
4. 校验 `perEventResults` 数组及每个元素（复用 `parseIngestionEventReceipt`）；
5. 返回新建的 `IngestionRequestReceipt`。

本协议不复制 `parseEventEnvelope` 的协议版本或时间校验。

## 11. 兼容规则

- 当前仍只支持协议版本 `1`；
- 本增量是对现有信封 API 的加法：`parseEventEnvelope` 签名、`EventEnvelope.body: unknown` 和既有样本入口保持不变；
- 接收结果使用严格字段允许列表；
- 增加新状态或错误码会被旧解析器拒绝，必须先完成兼容评估；需要不兼容变化时创建 accepted ADR、迁移说明和旧版本处理方案；
- 不创建版本 `0` 转换器，也不对版本 `2` 猜测降级。

## 12. 公共出口和依赖边界

### 12.1 根出口

`@aurora/event-schema` 根入口新增导出：

- `BATCH_EVENT_LIMITS`、`IngestionReceiptState`、`IngestionErrorCode`；
- 本文全部公共批次、接收结果和事件结果类型；
- `parseIngestionBatchRequest`、`parseIngestionRequestReceipt`、`parseIngestionEventReceipt`。

根入口不导出私有字段解析器或样本。

### 12.2 测试入口

`@aurora/event-schema/contract-testkit` 在保留既有信封、错误、请求与性能样本的同时增加本协议三组样本（批次请求 + 请求级结果）和对应样本类型。不增加第三个子路径出口。

### 12.3 依赖约束

- `event-schema` 保持零运行时依赖和零本地 Workspace 依赖；
- 不依赖 Core、Browser、具体插件、Fastify、PostgreSQL、React、Vue、接入、处理或平台；
- 源码不依赖 DOM，也不依赖 Node 专属运行时 API；
- 跨包消费者只能从包根或 `contract-testkit` 导入；
- 禁止 `src`、`internal`、测试文件和未导出深路径；
- 禁止循环依赖；
- 不复制公共信封、协议版本或事件类型来源。

## 13. 文件职责

```text
packages/event-schema/
├── src/
│   ├── index.ts                            # 根出口新增批次/接收结果导出
│   ├── ingestion-batch-request.ts          # parseIngestionBatchRequest
│   ├── ingestion-request-receipt.ts        # parseIngestionRequestReceipt + parseIngestionEventReceipt
│   ├── ingestion-types.ts                  # 常量、限制、批次/接收结果/事件结果/状态/错误码类型
│   └── contract-testkit/
│       ├── valid-ingestion-samples.ts
│       ├── invalid-ingestion-samples.ts
│       ├── boundary-ingestion-samples.ts
│       └── index.ts                        # 新增批次/接收结果样本导出
└── test/
    ├── ingestion-batch-request.test.ts
    ├── ingestion-request-receipt.test.ts
    ├── ingestion-types.test.ts
    ├── package-entry.test.ts               # 扩展根入口断言
    ├── architecture-boundary.test.ts       # 扩展禁止项
    └── consumers/
        ├── ingestion-ingestion.contract.test.ts
        ├── processing-ingestion.contract.test.ts
        └── sdk-ingestion.contract.test.ts
```

现有文件继续保留原职责。新增文件各自只处理名称所示的单一协议职责，不创建杂物目录或通用 Schema 框架。

## 14. 测试范围

### 14.1 公共类型与出口

- 运行时常量和解析器可从包根导入；
- 全部公共类型由只使用包根的 TypeScript 消费者编译证明；
- 样本只从 `contract-testkit` 导入；
- 私有路径不可导入；
- 构建产物只暴露声明的两个入口，不泄露内部解析器；
- 解析器、样本不进入根出口。

### 14.2 状态与错误码

- 四个状态值（`accepted`、`duplicate_accepted`、`permanently_rejected`、`temporarily_failed`）；
- 每个状态与 `retryable` 组合合法；
- 未知状态、未知错误码返回 `invalid_enum`；
- 大小写敏感；`null`、空字符串、显式 `undefined`。

### 14.3 批次请求

- 最小合法批次（单事件）；
- 完整合法批次（多个事件 + 可选 `receivedAt`）；
- 空数组、超上限数组（>50）；
- 非数组、数组元素非普通对象、元素不是合法 `EventEnvelope`；
- 不支持协议版本；
- `receivedAt` 非法（零、负数、小数、非安全整数）；
- 未知字段。

### 14.4 接收结果

- 合法批次级/事件级结果（四种状态各至少一例）；
- 缺失必填字段；
- `retryable` 非布尔；
- `retryAfterMs` 非法（负数、越界、非整数）；
- `perEventResults` 长度与 `events` 不匹配（由解析器上下文校验）；
- 未知字段。

### 14.5 隐私与输入不可变

- 禁止字段在任何层级被拒绝；
- 解析不修改输入；
- 成功结果不保留输入对象引用；
- issue 不回显输入值。

### 14.6 契约样本与消费者

- 每类字段均有合法、非法和边界样本；
- SDK 消费者验证所有合法样本；
- 数据接入消费者验证所有非法样本和稳定 code；
- 数据处理消费者验证全部边界样本；
- README 和正式协议文档中的 JSON 示例由测试提取并执行；
- 测试只验证公共行为，不断言私有函数调用次数。

## 15. 覆盖率与质量门禁

`packages/event-schema` 是关键核心包，维持：

- lines 不低于 `85%`；
- branches 不低于 `80%`；
- functions 不低于 `85%`；
- statements 不低于 `85%`。

阈值继续由 `packages/event-schema/vitest.config.ts` 固定。不得排除具有分支逻辑的新文件，不得降低门槛，不得删除或弱化失败测试。

实施必须新鲜运行受影响单测、三类批次/接收结果消费者契约、既有错误/请求/性能契约回归、严格类型检查、Lint、覆盖率、构建、包入口、Workspace 边界、文档示例、根 `check:ci` 和 `git diff --check`。本协议包不需要真实浏览器测试，因为它没有 DOM、监听器或宿主副作用。

## 16. 代码规范落实

- 继承根 TypeScript `strict`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 和其他严格选项；
- 所有外部输入为 `unknown`，所有公共函数显式声明参数和返回类型；
- 禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore` 和静默 catch；
- 文件使用 `kebab-case`，类型/接口使用 `PascalCase`，函数/变量使用 `camelCase`；
- 布尔变量使用 `is`、`has`、`can` 或 `should` 前缀；
- 文件和函数保持单一职责，不创建 `utils`、`helpers`、`common` 或 `misc`；
- 公共 API 保持最小，私有状态/错误码映射函数不导出；
- 不跨包访问 `src`、`internal` 或未导出路径；
- 状态和错误码使用唯一常量；
- 校验失败返回稳定 issue，不静默吞掉，不记录输入；
- 样本和文档不包含真实敏感数据；
- 不修改调用方输入，不污染宿主页面；
- 不复制错误/请求/性能契约的字段校验或 URL 校验逻辑，只复用中立助手；
- 不增加当前需求未使用的抽象。

## 17. 文档与 ADR 同步

实施计划必须同步：

- `packages/event-schema/README.md`：从"只有错误、请求与性能事件契约"更新为"加数据接入批次与接收结果协议第一增量"；
- `docs/protocol/ingestion-batch-and-receipt-contract.md`：本文；
- `docs/README.md`：加入本文并保持批次/接收协议实现缺失；
- `docs/architecture/formalization-readiness.md`：把 A1 更新为信封基础加错误、请求、性能正文与批次/接收结果协议第一增量；
- ADR-005：只追加批次/接收结果协议单一来源、Schema、样本和消费者契约实施证据，保持 `accepted / in-progress`；
- ADR-008：只追加批次/接收结果协议作为其后续依赖链第 1 项的实施证据，保持 `accepted / not-started`；
- ADR-006：只追加协议层零本地依赖、无 DOM/Node 运行时依赖、公开入口和私有路径负例证据，保持 `accepted / in-progress`；
- ADR-003：批次协议不是采集插件，只在实施记录中澄清，保持 `accepted / in-progress`；
- `AGENTS.md` 与 `AURORA_RULES.md`：只有代码和完整门禁实际通过后才更新阶段快照；
- 根 README：只有当前实现状态描述受影响时才更新。

本文和实施计划本身不得写入实施证据，不得修改 ADR 决策结论或实施状态。

## 18. 明确排除范围

- 数据接入服务同步接收路径、Inbox 写入、`event_inbox` 表与 Migration；
- Worker 租约消费、重试、死信和重放；
- 采样算法、采样配置、采样率；
- 限流算法、限流配置和容量保护策略；
- 客户端上报密钥物理格式、来源匹配规范、环境标识；
- HTTP Header 名称、HTTPS 路径、HTTP 状态码映射、OpenAPI security scheme；
- OpenAPI 文件、Schema 生成、文档站点；
- 数据库错误文本、约束名称或内部异常；
- 批次数量、请求大小、重试次数、租约、死信和保留期限的精确数值（除本规格已冻结的普通实施细节外）；
- 精确 Inbox 数据模型、列名、分区键和索引；
- 数据接入 OpenAPI 本身（后续依赖链第 2 项）；
- 接入、处理、服务端、数据库、管理平台；
- CI、发布、容器、IaC 和云资源。

## 19. 与 OpenAPI 的后续映射

数据接入 OpenAPI 必须引用或映射本协议已批准的批次请求、请求级/逐事件接收结果、稳定状态枚举和稳定错误码；OpenAPI 不得成为第二套批次 Schema 权威来源（ADR-008 后续依赖链第 2 项）。HTTP 路径、Header、状态码映射和 security scheme 属于 OpenAPI 规格的后续决策，不由本协议冻结。

## 20. 后续模块衔接边界

`event-schema` 批次与接收结果协议第一增量是 ADR-008 后续依赖链第 1 项。数据接入 OpenAPI（第 2 项）只有在本文契约实际实施并通过包入口与契约测试后，才可在独立规格中规划。数据接入服务同步接收路径（第 4 项）和 Worker 租约消费（第 5 项）依赖 OpenAPI 与 Inbox 数据模型，不在本增量内。

## 21. ADR 判断

本增量执行 accepted ADR-005 的协议单一来源、运行时校验、兼容规则和共享样本，执行 accepted ADR-008 的 Inbox 接收边界和后续依赖链第 1 项，执行 accepted ADR-004 的可靠接收行为语义，并复用 accepted ADR-006 的底层依赖和自动边界约束。状态枚举、错误码、字段组织、限制数值和私有解析函数没有改变五系统边界、依赖方向或长期兼容策略，不创建新 ADR。若要改变协议版本策略、允许协议依赖业务包、删除或重释公共字段、放宽隐私默认值，或把 Inbox 写入、采样、限流、队列/Worker 逻辑移入协议层，必须先有新的 accepted ADR。

## 22. 规格自检

- 批次请求、请求级/逐事件接收结果、状态、错误码、`retryable`/`retryAfterMs` 均有精确正文、成功、失败和边界语义；
- 所有公共运行时值、类型、函数和样本均有完整签名；
- `EventEnvelope`、`CURRENT_PROTOCOL_VERSION`、`EVENT_SCHEMA_LIMITS` 和通用限制没有复制来源；
- "已可靠接收"严格等于 ADR-008 的 Inbox 事务提交成功；
- 重复事件使用 `duplicate_accepted` 幂等语义，不暴露数据库冲突；
- 永久拒绝 `retryable: false`，暂时失败 `retryable: true` + 可选 `retryAfterMs`；
- 批次部分成功逐事件独立，请求级结果不掩盖逐事件结果；
- 没有 HTTP 路径/Header/状态码映射、OpenAPI security scheme、采样、限流、Inbox 写入、数据库或 Worker 依赖；
- 解析不修改输入，也不保留输入可变对象引用；
- 错误/请求/性能契约共用中立助手，本协议只复用，不复制；
- 没有 Core、Browser、插件、Fastify、PostgreSQL、DOM、Node 运行时依赖；
- 没有无界值、敏感示例、占位表达或未定义接口；
- 覆盖率、消费者契约、包入口、Workspace 边界和文档同步均有明确门禁；
- 现有 ADR 决策和状态没有因本文改变。
