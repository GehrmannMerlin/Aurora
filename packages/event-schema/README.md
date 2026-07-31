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
- 从独立测试入口共享合法、非法和边界样本。

## 非职责

- 不定义具体错误、请求、性能或资源事件正文；
- 不定义上报批次、HTTP、鉴权、接收结果、重试或可靠缓冲；
- 不采集、发送、存储、查询或展示事件；
- 不提供历史版本转换、JSON Schema、OpenAPI、代码生成或发布编排。

## 对外接口

运行时入口：

```ts
import {
  CURRENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_LIMITS,
  EventType,
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

## 依赖边界

本包没有运行时依赖，也不得依赖任何 Aurora 本地业务包。SDK、接入和处理只能依赖本包公开入口；本包不能反向依赖消费者。

## 错误与兼容性

普通非法输入不抛异常、不记录正文，返回 `success: false` 和最多 50 个 issue。仅精确版本 `1` 受支持；版本 `0`、`2` 和其他未知值明确拒绝。同版本新增可选正文数据保持信封兼容，但具体正文兼容性必须由后续事件 Schema 定义。不兼容公共协议变化需要 accepted ADR、迁移和旧版本处理方案。

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
- [ADR-005](../../docs/adr/ADR-005-event-schema-source-of-truth.md)
- [ADR-006](../../docs/adr/ADR-006-one-way-dependencies.md)
- [测试策略](../../docs/testing/test-strategy.md)
