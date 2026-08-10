# Event Schema

`@aurora/event-schema` 是 Aurora 公共协议系统的首个真实包。当前协议版本：`1`。包目前保持私有，不代表已经发布到 npm。

## 模块定位

本包位于依赖图底层，为未来 SDK、数据接入和数据处理提供同一个事件信封、版本识别、运行时边界校验和共享契约样本。

## 职责

- 定义协议版本 `1` 和 `error`、`request`、`performance`、`resource` 四类事件标识；
- 校验稳定事件编号、真实发生时间和公共信封；
- 有界扫描不可信事件正文，限制字符串、数组、对象键数和对象深度；
- 拒绝非 JSON 值、循环引用和明确禁止字段；
- 返回稳定、可判别且不含输入数据的验证 issue；
- 从独立测试入口共享合法、非法和边界样本；
- 定义错误、请求、性能事件正文以及数据接入批次与接收结果协议。

## 非职责

- 不定义通用资源或行为事件正文；
- 不实现上报批次的实际网络传输、HTTP、鉴权、接收服务、可靠缓冲或 Inbox 写入；
- 不采集、发送、存储、查询或展示事件；
- 不提供历史版本转换、JSON Schema、OpenAPI、代码生成或发布编排。

## 对外接口

运行时入口：

```ts
import {
  CURRENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_LIMITS,
  EventType,
  negotiateProtocolVersion,
  parseEventEnvelope,
  type EventEnvelope,
  type EventEnvelopeParseResult,
  type EventSchemaIssue,
  type EventSchemaIssueCode,
  type ProtocolVersion,
} from '@aurora/event-schema';
```

契约测试入口：

```ts
import {
  boundaryEventEnvelopeSamples,
  invalidEventEnvelopeSamples,
  validEventEnvelopeSamples,
} from '@aurora/event-schema/contract-testkit';
```

禁止导入 `src`、`internal`、测试文件或未导出的子路径。

## 输入与输出

`parseEventEnvelope(input: unknown)` 接收不可信输入。成功返回只读公共信封；失败返回稳定 issue 数组。`body` 保持 `unknown`，调用方必须等待后续具体事件 Schema 才能读取业务字段。

<!-- contract-example:valid-readme -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-synthetic-valid",
  "eventType": "error",
  "occurredAt": 1800000000300,
  "body": {}
}
```

<!-- contract-example:invalid-readme -->

```json
{
  "protocolVersion": 2,
  "eventId": "evt-readme-synthetic-invalid",
  "eventType": "error",
  "occurredAt": 1800000000301,
  "body": {}
}
```

## 错误事件契约

本包已实现错误事件协议契约第一增量。它只定义 JavaScript 运行时错误、未处理 Promise 拒绝和资源加载错误的机器正文，不实现错误采集插件。

```ts
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  PromiseRejectionReasonKind,
  parseErrorEventBody,
  parseErrorEventEnvelope,
  type ErrorEventBody,
  type ErrorEventEnvelope,
} from '@aurora/event-schema';
```

`parseErrorEventBody(input: unknown)` 同步校验精确正文。`parseErrorEventEnvelope(input: unknown)` 先复用公共信封校验，再要求 `eventType: "error"`。成功结果是新对象；解析器不修改输入。

- JavaScript 运行时错误：必填有限 `message`，可选有限 `name` 和原始 `stack`；
- 未处理 Promise 拒绝：使用 `error`、`string` 或有界 `non_standard` 原因；
- 资源加载错误：只允许 `script`、`stylesheet`、`image`、`font`，并从 HTTP(S) URL 中移除全部查询和片段。

自由文本必须在进入协议前完成隐私过滤。协议拒绝未知字段、已知禁止字段、无限对象、循环、超界值和非 JSON Promise 值；issue 不回显输入。

<!-- contract-example:valid-error-readme -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-error-valid",
  "eventType": "error",
  "occurredAt": 1800000004001,
  "body": {
    "category": "javascript",
    "error": {
      "name": "TypeError",
      "message": "Synthetic runtime failure"
    }
  }
}
```

<!-- contract-example:invalid-error-readme -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-error-invalid",
  "eventType": "error",
  "occurredAt": 1800000004002,
  "body": {
    "category": "resource",
    "resource": {
      "type": "image",
      "url": "data:image/png,synthetic"
    }
  }
}
```

错误协议不包含浏览器监听器、错误规范化、去重、分组、指纹、Source Map、传输、采样、队列、重试、持久化、服务端或管理平台。

## 请求事件契约

本包已实现请求事件协议契约第一增量。它定义请求监控链路的最小安全正文，不实现请求观测能力或请求采集插件。

```ts
import {
  REQUEST_EVENT_LIMITS,
  RequestMethod,
  RequestOutcome,
  parseRequestEventBody,
  parseRequestEventEnvelope,
  type RequestEventBody,
  type RequestEventEnvelope,
} from '@aurora/event-schema';
```

`parseRequestEventBody(input: unknown)` 同步校验精确正文。`parseRequestEventEnvelope(input: unknown)` 先复用公共信封校验，再要求 `eventType: "request"`。成功结果是新对象；解析器不修改输入。

- 请求方法：`GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`；
- 安全 URL：只允许小写 HTTP(S) 绝对地址，移除全部查询参数和片段，拒绝 `data:`/`blob:`/`file:`/相对地址；
- 开始时间：正安全整数 Unix epoch 毫秒；
- 持续时间：非负安全整数毫秒；
- 结果类别：`success`、`http_error`、`network_error`、`timeout`、`canceled`；
- 可选 HTTP 状态码：`100..599`。

请求监控的允许来源、同源判断、跨域允许列表、路径动态段归一化和开发者路径模板不属于协议层。协议不采集请求/响应正文、请求头、响应头、Cookie、凭据或尺寸；URL 查询与片段不会进入成功结果。

<!-- contract-example:valid-request-readme -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-request-valid",
  "eventType": "request",
  "occurredAt": 1800000005000,
  "body": {
    "method": "GET",
    "url": "https://api.example.test/search?token=private#fragment",
    "startedAt": 1800000004000,
    "durationMs": 120,
    "outcome": "success",
    "statusCode": 200
  }
}
```

<!-- contract-example:invalid-request-readme -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-request-invalid",
  "eventType": "request",
  "occurredAt": 1800000005001,
  "body": {
    "method": "GET",
    "url": "data:text/plain,synthetic",
    "startedAt": 1800000004001,
    "durationMs": 120,
    "outcome": "success"
  }
}
```

请求协议不实现请求观测，不实现请求采集插件，也不代理 fetch/XHR，不包含去重、分组、指纹、传输、采样、队列、重试、持久化、服务端或管理平台。

## 性能事件契约

本包已实现性能事件协议契约第一增量。它只定义 PRD 5.1.9 批准的四项页面性能指标的最小安全正文，不实现性能事实观测、`PerformanceObserver`，不实现性能采集插件，也不实现采样。

```ts
import {
  PERFORMANCE_EVENT_LIMITS,
  PerformanceMetricCategory,
  PerformanceMetricName,
  PerformanceMetricUnit,
  parsePerformanceEventBody,
  parsePerformanceEventEnvelope,
  type PerformanceEventBody,
  type PerformanceEventEnvelope,
} from '@aurora/event-schema';
```

`parsePerformanceEventBody(input: unknown)` 同步校验精确正文。`parsePerformanceEventEnvelope(input: unknown)` 先复用公共信封校验，再要求 `eventType: "performance"`。成功结果是新对象；解析器不修改输入。

- 指标类别：`page`；
- 指标名称：只允许 PRD 5.1.9 批准的 `lcp`、`inp`、`cls`、`page_load`；
- 指标单位：`millisecond`（整数毫秒）或 `ratio`（0..1 有限非负 CLS 比率）；
- 开始时间：正安全整数 Unix epoch 毫秒；
- 可选持续时间：`0..86400000` 安全整数毫秒。

性能协议不实现性能事实观测、`PerformanceObserver`、采样（PRD 默认采样率 10% 属于 SDK 采集层）、聚合、指标统计、问题识别、传输、队列、重试、持久化、服务端或管理平台。未批准的 Web Vitals（FCP、TTFB、FID、TBT 等）、自定义业务指标、完整资源 URL、DOM、页面文本和用户输入不进入协议。

<!-- contract-example:valid-performance-readme -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-performance-valid",
  "eventType": "performance",
  "occurredAt": 1800000005000,
  "body": {
    "metricCategory": "page",
    "metricName": "lcp",
    "value": 2500,
    "unit": "millisecond",
    "startedAt": 1800000004000
  }
}
```

<!-- contract-example:invalid-performance-readme -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-performance-invalid",
  "eventType": "performance",
  "occurredAt": 1800000005001,
  "body": {
    "metricCategory": "page",
    "metricName": "fcp",
    "value": 1000,
    "unit": "millisecond",
    "startedAt": 1800000004001
  }
}
```

## 数据接入批次与接收结果协议

本包已实现数据接入批次与接收结果协议第一增量。它定义 SDK 数据接入的批次请求正文、请求级与逐事件接收结果、稳定状态枚举和稳定错误码，不实现 Inbox 写入、数据库、OpenAPI、采样、限流、队列或 Worker。

```ts
import {
  BATCH_EVENT_LIMITS,
  IngestionErrorCode,
  IngestionReceiptState,
  parseIngestionBatchRequest,
  parseIngestionRequestReceipt,
  parseIngestionEventReceipt,
  type IngestionBatchRequest,
  type IngestionRequestReceipt,
  type IngestionEventReceipt,
} from '@aurora/event-schema';
```

`parseIngestionBatchRequest(input: unknown)` 同步校验批次请求正文。`parseIngestionRequestReceipt(input: unknown)` 与 `parseIngestionEventReceipt(input: unknown)` 校验请求级与逐事件接收结果。成功结果是新对象；解析器不修改输入。

- 批次请求：必填 `protocolVersion`（字面量 `1`）与 `events` 数组（长度 `1..50`），可选 `receivedAt` 正安全整数毫秒；
- 接收状态：`accepted`（已可靠接收，严格等于 Inbox 事务提交成功）、`duplicate_accepted`（重复事件幂等结果）、`permanently_rejected`（`retryable: false`）、`temporarily_failed`（`retryable: true` + 可选 `retryAfterMs`）；
- 稳定错误码：`unsupported_protocol_version`、`invalid_schema`、`field_exceeds_limit`、`forbidden_field`、`invalid_event_type`、`project_permanently_not_allowed`、`source_permanently_not_allowed`、`service_temporarily_unavailable`、`rate_limited`、`capacity_protected` 等；
- 批次部分成功：逐事件独立结果，请求级结果不掩盖逐事件结果；重复事件返回 `duplicate_accepted`，不暴露数据库约束或错误。

批次协议不实现 Inbox 写入、数据库/Migration、OpenAPI、HTTP 路径/Header/状态码映射、采样、限流、去重窗口、队列、重试、死信、重放、Worker、服务端或管理平台。

## 依赖边界

本包没有运行时依赖，也不得依赖任何 Aurora 本地业务包。SDK、接入和处理只能依赖本包公开入口；本包不能反向依赖消费者。

## 错误与兼容性

普通非法输入不抛异常、不记录正文，返回 `success: false` 和最多 50 个 issue。仅精确版本 `1` 受支持；版本 `0`、`2` 和其他未知值明确拒绝。同版本新增可选正文数据保持信封兼容，但具体正文兼容性必须由后续事件 Schema 定义。不兼容公共协议变化需要 accepted ADR、迁移和旧版本处理方案。

协议版本协商：根入口导出 `negotiateProtocolVersion(input)`，返回稳定的 `supported` / `unsupported_version` 判别结果。SDK 始终只产生 `CURRENT_PROTOCOL_VERSION` 事件，不改变公共 wire contract。当前不存在历史协议版本，因此本包不导出任何 `convert*`/`upgrade*`/`downgrade*` 转换函数（空转换边界）；任何兼容转换需求必须先经 ADR-005 门禁。

## 开发与测试

```bash
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema test
pnpm --filter @aurora/event-schema test:coverage
pnpm --filter @aurora/event-schema build
pnpm --filter @aurora/event-schema test:package
pnpm check:ci
```

覆盖率门槛为行 85%、分支 80%、函数 85%、语句 85%。样本全部为合成数据，不包含真实凭据或用户数据。

## 关联文档

- [协议基础规格](../../docs/protocol/event-schema-foundation.md)
- [事件信封版本 1](../../docs/protocol/event-envelope-v1.md)
- [错误事件协议契约](../../docs/protocol/error-event-contract.md)
- [请求事件协议契约](../../docs/protocol/request-event-contract.md)
- [性能事件协议契约](../../docs/protocol/performance-event-contract.md)
- [数据接入批次与接收结果协议](../../docs/protocol/ingestion-batch-and-receipt-contract.md)
- [ADR-005](../../docs/adr/ADR-005-event-schema-source-of-truth.md)
- [ADR-006](../../docs/adr/ADR-006-one-way-dependencies.md)
- [ADR-008](../../docs/adr/ADR-008-ingestion-durable-buffering.md)
- [测试策略](../../docs/testing/test-strategy.md)
