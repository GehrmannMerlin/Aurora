# Aurora Ingestion OpenAPI Contract

## 模块定位

本包是数据接入 OpenAPI 与 `@aurora/event-schema` 之间的自动漂移门禁。它解析 `docs/api/ingestion.openapi.yaml`（OpenAPI 3.1.0），断言其与 `@aurora/event-schema` 数据接入批次与接收结果协议保持机器级一致，防止 HTTP 传输投影成为第二套协议权威来源。

## 职责

- 校验 `IngestionReceiptState`、`IngestionErrorCode`、`EventType` 枚举与 event-schema 常量逐值一致；
- 校验 `IngestionBatchRequest`、`IngestionRequestReceipt`、`IngestionEventReceipt`、`EventEnvelope` 的 required 字段与 event-schema 解析器要求一致；
- 校验数组/字符串/数值限制（`maxEventsPerBatch`、`maxEventIdLength`、`maxRetryAfterMs` 等）引用 event-schema 机器常量；
- 校验合法批次/请求级/逐事件样本满足 OpenAPI Schema 形状，边界样本两个契约一致；
- 校验 `retryable`/`retryAfterMs` 的 OpenAPI 类型表达与协议语义一致；
- 校验安全与隐私约束：Query 无凭证、示例无真实客户端密钥、CORS 不启用 Cookie credential、`Origin`/`allowNonBrowser`/`environment` 不进入 JSON body Schema；
- 校验结构稳定性：`operationId` 唯一、`$ref` 完整、Schema 名称稳定、状态码集合完整。

## 非职责

- 不实现 Fastify 路由、接入服务、密钥数据库/生成/轮换、CORS 中间件；
- 不实现 Inbox 数据模型、数据库 Schema、Migration；
- 不实现 SDK transport、队列、采样、限流、Worker；
- 不定义请求字节上限数值（`requires-benchmark`）或精确凭证随机位数/摘要算法；
- 不修改 `@aurora/event-schema` 公共 API。

## 对外接口

包根导出 `loadOpenApiDocument`、`componentSchema`、`schemaEnum`、`schemaRequired`、`operationResponses`、`assertEnumMatches`、`assertRequiredFields`、`assertNumberLimit`、`assertConst`、`assertType`、`collectDrifts`。

## 输入与输出

- 输入：`docs/api/ingestion.openapi.yaml`、`@aurora/event-schema` 根公共常量与 `contract-testkit` 样本；
- 输出：漂移断言失败（抛错）或通过；测试由根 `openapi:check` 与 `check:ci` 覆盖。

## 依赖边界

- `@aurora/event-schema`（devDependency，`workspace:*`）：只从包根与 `contract-testkit` 导入，不导入 `src`/`internal`；
- `yaml`（devDependency）：解析 OpenAPI 机器文件；
- 零运行时依赖；`aurora.layer: tooling`。

## 命令

```bash
pnpm --filter @aurora/ingestion-openapi-contract test
pnpm openapi:lint        # redocly lint docs/api/ingestion.openapi.yaml
pnpm openapi:check       # lint + 本包漂移测试
```

## 错误与兼容性

漂移断言失败以 `OpenAPI drift detected:` 前缀抛错，列出缺失/额外枚举值、缺失/多余 required 字段、限制数值不一致等。新增枚举值、字段或限制必须先在 `@aurora/event-schema` 冻结，再同步 OpenAPI 与样本。

## 关联文档

- [数据接入 OpenAPI 正式规格](../../docs/api/ingestion-openapi.md)
- [数据接入批次与接收结果协议](../../docs/protocol/ingestion-batch-and-receipt-contract.md)
- [ADR-009 数据接入公开传输与客户端上报密钥安全语义](../../docs/adr/ADR-009-ingestion-transport-and-client-credential.md)
