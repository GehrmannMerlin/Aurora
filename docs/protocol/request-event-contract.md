---
title: Aurora 请求事件协议契约第一增量
status: approved
implementation-status: not-started
owner: protocol
created: 2026-07-31
last-reviewed: 2026-07-31
applies-to: packages/event-schema 的请求事件正文、请求信封窄化、运行时校验、契约样本与公共出口
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
  - event-schema-foundation.md
  - event-envelope-v1.md
  - error-event-contract.md
  - ../sdk/sdk-core-foundation.md
  - ../sdk/browser-environment-foundation.md
  - ../sdk/browser-request-source.md
  - ../testing/test-strategy.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../adr/ADR-007-workspace-package-and-task-tooling.md
supersedes: none
review-cycle: request-protocol-field-or-compatibility-change
---

# Aurora 请求事件协议契约第一增量

## 1. 定位、效力与当前状态

本文冻结 `packages/event-schema` 的请求事件协议契约第一增量。该增量在既有公共 `EventEnvelope`、协议版本 `1`、有界正文校验和稳定 issue 之上，增加请求监控链路的最小安全正文、请求信封解析器及共享契约样本。

本文只从 approved PRD（请求监控 5.1.1—5.1.8、14.2）、approved 长期规范、现有 approved 协议/SDK 规格，以及 accepted ADR-003、ADR-005、ADR-006、ADR-007 推导。字段组织、私有验证函数、文件拆分和限制数值属于用户已授权收口的普通、可回滚实施细节，因此本文状态为 `approved`。

截至 2026-07-31，仓库已有错误事件协议契约第一增量，但没有请求事件正文类型、请求正文解析器或请求专用样本。`EventType.Request` 已在公共信封规格中批准。本文批准只允许生成一份实施计划，不表示本增量已经实施，也不修改任何 ADR 状态。

## 2. 模块职责与明确非职责

### 2.1 职责

- 在 `@aurora/event-schema` 中定义唯一的请求方法类别、请求结果类别和请求正文限制常量；
- 定义请求事件的最小安全正文：方法、安全 URL、开始时间、持续时间、结果类别和可选 HTTP 状态码；
- 使用现有 `EventEnvelope`、`EventType.Request`、`CURRENT_PROTOCOL_VERSION` 和 `EventSchemaIssue`；
- 从 `unknown` 同步解析请求正文和完整请求信封；
- 对请求 URL 移除全部查询参数与片段，并校验为安全 HTTP(S) 绝对地址；
- 返回稳定、有限、不包含输入值的校验 issue；
- 生成新的输出对象，不修改输入；
- 提供合法、非法和边界样本，供 SDK、数据接入和数据处理契约测试复用；
- 从包根导出运行时契约，从既有 `contract-testkit` 子路径导出测试样本；
- 抽取错误契约与请求契约共享的字段校验与安全 URL 校验为中立模块，保持错误契约行为不变；
- 同步模块 README、协议文档、架构追踪和 ADR 实施证据。

### 2.2 明确非职责

- 不注册或触发浏览器监听器；
- 不代理 `fetch` 或 `XMLHttpRequest`；
- 不采集请求、响应或上报正文；
- 不采集 Cookie、Authorization、Token 或任何凭据；
- 不采集请求头或响应头；
- 不保留完整 URL 查询参数或片段；
- 不实现 URL 路径动态段归一化、开发者路径模板、允许来源判断或同源判断（这些属于 SDK 配置与处理层）；
- 不采集发生页面、运行环境、发布版本等上下文（与错误正文一致，属于 SDK 上下文层）；
- 不采集请求或响应尺寸信息（PRD 未批准请求监控正文尺寸字段；接入层请求大小限制属于上报请求，不是被监控请求）；
- 不实现请求去重、问题分组、指纹、代表样本或问题聚合；
- 不实现 `packages/browser` 请求观测能力、`packages/plugin-request` 或任何 Core 插件；
- 不实现网络传输、采样、队列、批量、重试或持久化；
- 不实现数据接入、数据处理、服务端、数据库、管理平台、CI、发布、容器、IaC 或云资源；
- 不建立通用 Schema DSL、注册器、事件总线、转换框架、`utils`、`helpers`、`common` 或 `misc`。

## 3. 与公共事件信封的关系

### 3.1 单一信封和版本来源

请求事件不创建第二套信封或协议版本。所有请求事件必须满足：

```ts
export type RequestEventEnvelope = EventEnvelope & {
  readonly eventType: typeof EventType.Request;
  readonly body: RequestEventBody;
};
```

`protocolVersion`、`eventId`、`eventType`、`occurredAt` 和通用正文资源边界继续由现有 `parseEventEnvelope(input: unknown)` 校验。`occurredAt` 继续表示大于 `0` 且不超过 `Number.MAX_SAFE_INTEGER` 的 Unix epoch 毫秒安全整数；请求正文不得复制协议版本或事件 ID。

`EventType.Request` 表示请求事件类别，与错误正文中的 `category` 无关。请求正文与 `error`、`performance` 或 `resource` 信封组合时必须返回 `event_type_mismatch`。

### 3.2 解析层次

- `parseEventEnvelope` 继续只证明公共信封和通用资源边界有效，成功结果的 `body` 保持 `unknown`；
- `parseRequestEventBody` 证明一个值符合本文的精确请求正文；
- `parseRequestEventEnvelope` 先复用 `parseEventEnvelope`，再校验 `EventType.Request` 和精确请求正文；
- 消费者只有在 `parseRequestEventEnvelope` 成功后，才能把 `body` 视为 `RequestEventBody`。

## 4. 完整公共 TypeScript 契约

### 4.1 常量、枚举和限制

```ts
export const RequestMethod = Object.freeze({
  readonly Get: 'GET';
  readonly Post: 'POST';
  readonly Put: 'PUT';
  readonly Patch: 'PATCH';
  readonly Delete: 'DELETE';
  readonly Head: 'HEAD';
  readonly Options: 'OPTIONS';
});
export type RequestMethod = (typeof RequestMethod)[keyof typeof RequestMethod];

export const RequestOutcome = Object.freeze({
  readonly Success: 'success';
  readonly HttpError: 'http_error';
  readonly NetworkError: 'network_error';
  readonly Timeout: 'timeout';
  readonly Canceled: 'canceled';
});
export type RequestOutcome = (typeof RequestOutcome)[keyof typeof RequestOutcome];

export const REQUEST_EVENT_LIMITS = Object.freeze({
  readonly maxRequestUrlLength: 2048;
  readonly maxStatusCode: 599;
  readonly minStatusCode: 100;
});
```

枚举值只在上述常量中定义。实现、样本和消费者使用常量，不散落大小写不同或同义的魔法字符串。

### 4.2 请求正文

```ts
export interface RequestEventBody {
  readonly method: RequestMethod;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: RequestOutcome;
  readonly statusCode?: number;
}

export interface RequestEventBodyParseSuccess {
  readonly success: true;
  readonly data: RequestEventBody;
}

export type RequestEventBodyParseFailure = EventEnvelopeParseFailure;
export type RequestEventBodyParseResult =
  RequestEventBodyParseSuccess | RequestEventBodyParseFailure;

export interface RequestEventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: RequestEventEnvelope;
}

export type RequestEventEnvelopeParseFailure = EventEnvelopeParseFailure;
export type RequestEventEnvelopeParseResult =
  RequestEventEnvelopeParseSuccess | RequestEventEnvelopeParseFailure;
```

### 4.3 解析函数

```ts
export function parseRequestEventBody(input: unknown): RequestEventBodyParseResult;
export function parseRequestEventEnvelope(input: unknown): RequestEventEnvelopeParseResult;
```

两个函数均为同步、确定性、非抛出解析入口。它们不记录输入，不修改输入，不调用浏览器或 Node 专属 API。普通非法输入返回 `success: false`；只有程序缺陷或运行时自身不可恢复错误可以抛出。

成功结果由解析器新建。调用方在解析后修改原输入不会改变成功结果。

### 4.4 共享样本

以下内容只从 `@aurora/event-schema/contract-testkit` 导出：

```ts
export interface ValidRequestEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: RequestEventEnvelope;
}

export interface InvalidRequestEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

export interface BoundaryRequestEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: RequestEventEnvelope;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

export const validRequestEventSamples: readonly ValidRequestEventSample[];
export const invalidRequestEventSamples: readonly InvalidRequestEventSample[];
export const boundaryRequestEventSamples: readonly BoundaryRequestEventSample[];
```

样本使用固定合成域名、编号和文本，不含真实 Cookie、Token、Authorization、密码、请求/响应正文、表单、DOM、页面文本、用户输入、Storage、IP 或个人信息。

## 5. 字段语义

最小合法正文为：

```json
{
  "method": "GET",
  "url": "https://api.example.test/orders",
  "startedAt": 1800000005000,
  "durationMs": 120,
  "outcome": "success",
  "statusCode": 200
}
```

### 5.1 method

- 必填，只允许 `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`；
- 大小写敏感；小写或未知方法返回 `invalid_enum`；
- 覆盖浏览器 `fetch` 和 `XMLHttpRequest` 第一版支持的常见方法；`CONNECT` 和 `TRACE` 不在浏览器请求能力中，不进入枚举。

### 5.2 url

- 必填，原始输入长度为 `1..2048`，只接受小写 `http://` 或 `https://` 绝对地址；
- 解析器以最先出现的 `?` 或 `#` 截断，移除全部查询参数和片段，不保留参数名或值；
- authority 只允许 ASCII 域名/IPv4/`localhost` 或方括号 IPv6，可带 `0..65535` 端口；拒绝空 authority、用户名/密码形式的 `@`、反斜线、空白和控制字符；
- 返回保留 scheme、authority、port 和 path 的安全 URL；
- 对 `data:`、`blob:`、`file:`、相对地址和其他 scheme 返回 `invalid_url`；
- 路径动态段归一化、允许来源判断、同源判断和开发者路径模板不属于协议层，属于 SDK 配置与处理层。

### 5.3 startedAt

- 必填，正安全整数，Unix epoch 毫秒；
- 表示被监控请求的真实开始时间，与 `occurredAt`（事件产生时间）独立；批次延迟不应改变 `startedAt`；
- 非正数、非安全整数或非数字返回 `invalid_timestamp`。

### 5.4 durationMs

- 必填，非负有限安全整数毫秒；
- 表示请求从 `startedAt` 到完成的持续时间；PRD 请求耗时统计的最小字段；
- 非数字、非有限、负数或非安全整数返回 `invalid_number`；
- `0` 是合法值（接近零耗时的响应仍可表达）；
- 不设置独立的上限，自然上限为 `Number.MAX_SAFE_INTEGER`，与 `occurredAt`/`startedAt` 一致。

### 5.5 outcome

- 必填，只允许 `success`、`http_error`、`network_error`、`timeout`、`canceled`；
- 对应 PRD 的结果类别：正常成功、HTTP 错误区间（4xx/5xx 等）、网络失败、请求超时、用户主动取消；
- 未知结果类别返回 `invalid_enum`；
- `outcome` 与 `statusCode` 独立校验，不做跨字段一致性判断；类别由生产者按 PRD 规则计算。

### 5.6 statusCode

- 可选；存在时必须是 `100..599` 的安全整数；
- 表示被监控请求观察到的 HTTP 响应状态码；仅在生产者实际观察到状态时提供；
- 网络失败、超时和取消通常不提供状态码；
- 超出 `100..599` 返回 `invalid_number`。

<!-- contract-example:valid-request-spec -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-spec-request-valid",
  "eventType": "request",
  "occurredAt": 1800000005100,
  "body": {
    "method": "GET",
    "url": "https://api.example.test/search?token=private#fragment",
    "startedAt": 1800000005000,
    "durationMs": 120,
    "outcome": "success",
    "statusCode": 200
  }
}
```

该输入成功后，输出 `body.url` 必须是 `https://api.example.test/search`。

<!-- contract-example:invalid-request-spec -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-spec-request-invalid",
  "eventType": "request",
  "occurredAt": 1800000005101,
  "body": {
    "method": "GET",
    "url": "file:///synthetic/report.csv",
    "startedAt": 1800000005001,
    "durationMs": 120,
    "outcome": "success"
  }
}
```

该输入返回 `invalid_url`，issue 不包含 URL 值。

## 6. 空值、缺失值和未知值

- 必填字段缺失返回 `missing_required_field`；
- 可选字段只允许缺失，不接受显式 `null` 或 `undefined`；
- 必填非空字符串为空返回 `string_empty`；
- 字段类型错误返回 `invalid_type`；
- 未知对象字段返回 `unknown_field`；
- 未知枚举值返回 `invalid_enum`；
- `undefined` 无法进入协议正文，返回 `invalid_type`；
- 正文拒绝未知字段，包括任何上下文、尺寸、Header、正文或凭据字段。

## 7. 隐私与禁止字段

本文不允许默认写入：

- Cookie、Token、Authorization 或其他凭据；
- 请求头、请求体、响应头或响应体；
- 请求或响应尺寸；
- 完整表单、完整 DOM、页面文本或用户输入；
- 浏览器 Storage；
- 完整 URL 查询参数或片段；
- 用户指纹或原始 IP；
- 任意无限递归对象。

既有通用正文校验继续按 ASCII 小写拒绝 `authorization`、`cookie`、`password`、`requestbody`、`responsebody`、`formdata`、`dom`、`consolelog` 和 `ipaddress` 字段。请求正文采用精确字段允许列表，因此其他未声明上下文字段也被拒绝。

校验 issue 只包含稳定 code、字段路径和固定消息，不回显非法字段值。实现不输出生产路径控制台日志。URL 查询与片段在读取任何查询值前被截断，敏感参数值不会进入成功结果。

## 8. 稳定校验错误

本文不增加新的 `EventSchemaIssueCode`。请求正文复用现有稳定 code：

- `missing_required_field`：必填字段缺失；
- `invalid_type`：字段类型错误、非普通对象；
- `unknown_field`：未知正文字段；
- `invalid_enum`：未知请求方法或未知结果类别；
- `string_empty`：必填字符串为空；
- `string_too_long`：URL 超过 `maxRequestUrlLength`；
- `invalid_url`：请求 URL 不是安全 HTTP(S) 形态；
- `invalid_number`：`durationMs` 非有限/负数/非安全整数，或 `statusCode` 超出范围；
- `invalid_timestamp`：`startedAt` 非正安全整数；
- `event_type_mismatch`：精确请求正文与非 `EventType.Request` 信封组合。

issue 按稳定遍历顺序返回，最多 `EVENT_SCHEMA_LIMITS.maxIssues` 条。issue 的 `path` 对正文从 `['body']` 开始；独立调用 `parseRequestEventBody` 和调用完整请求信封解析器时使用相同路径。

## 9. 运行时校验顺序

`parseRequestEventEnvelope` 固定执行：

1. 调用现有 `parseEventEnvelope(input)`；
2. 原信封失败时原样返回稳定 issue；
3. 校验 `eventType === EventType.Request`；
4. 调用 `parseRequestEventBody(envelope.body)`；
5. 执行精确字段允许列表和字段校验；
6. 请求 URL 生成脱敏字符串；
7. 返回新建的 `RequestEventEnvelope`。

该顺序保证协议版本、时间戳、通用限制和禁止字段仍只有一个来源。请求解析器不复制 `parseEventEnvelope` 的协议版本或时间校验。

## 10. 兼容规则

- 当前仍只支持协议版本 `1`；
- 本增量是对现有信封 API 的加法：`parseEventEnvelope` 的签名、`EventEnvelope.body: unknown` 和既有样本入口保持不变；
- `parseRequestEventEnvelope` 对正文使用严格字段允许列表；
- 增加新的可选字段只有在旧解析器也能接受时才是同版本兼容；当前严格解析器不会接受未知字段，因此不能把任意新字段描述为无条件兼容；
- 删除字段、改变含义或类型、把可选字段改为必填、增加旧解析器不认识的必填字段、改变现有枚举含义均不兼容；
- 增加请求方法或结果类别会被旧解析器拒绝，必须先完成兼容评估；需要不兼容变化时创建 accepted ADR、迁移说明和旧版本处理方案；
- 不创建版本 `0` 转换器，也不对版本 `2` 猜测降级。

## 11. 公共出口和依赖边界

### 11.1 根出口

`@aurora/event-schema` 根入口新增导出：

- `RequestMethod`、`RequestOutcome`、`REQUEST_EVENT_LIMITS`；
- 本文全部公共正文、信封和解析结果类型；
- `parseRequestEventBody` 和 `parseRequestEventEnvelope`。

根入口不导出私有字段解析器、URL 处理函数或样本。

### 11.2 测试入口

`@aurora/event-schema/contract-testkit` 在保留既有信封与错误样本的同时增加本文三组请求样本和对应样本类型。不增加第三个子路径出口。

### 11.3 依赖约束

- `event-schema` 保持零运行时依赖和零本地 Workspace 依赖；
- 不依赖 Core、Browser、具体插件、React、Vue、接入、处理或平台；
- 源码不依赖 DOM，也不依赖 Node 专属运行时 API；
- 跨包消费者只能从包根或 `contract-testkit` 导入；
- 禁止 `src`、`internal`、测试文件和未导出深路径；
- 禁止循环依赖；
- 不复制公共信封、协议版本或事件类型来源。

严格 TypeScript 构建、ESLint、Workspace Policy、包入口测试、私有路径负例、依赖负例和消费者契约测试共同证明这些约束。

## 12. 文件职责

```text
packages/event-schema/
├── src/
│   ├── constants.ts
│   ├── error-descriptor.ts
│   ├── error-event-body.ts
│   ├── error-event-envelope.ts
│   ├── error-event-types.ts
│   ├── error-event-validation.ts   # 从 field-validation 再导出，行为不变
│   ├── event-envelope.ts
│   ├── event-types.ts
│   ├── field-validation.ts         # 中立字段校验助手（新增，错误与请求共享）
│   ├── index.ts
│   ├── javascript-error-event.ts
│   ├── promise-rejection-error-event.ts
│   ├── request-event-body.ts
│   ├── request-event-envelope.ts
│   ├── request-event-types.ts
│   ├── resource-error-event.ts     # 改用共享 safe-url
│   ├── safe-url.ts                 # 中立安全 HTTP URL 校验（新增，错误与请求共享）
│   ├── validation-issues.ts
│   ├── value-boundaries.ts
│   └── contract-testkit/
│       ├── boundary-error-event-samples.ts
│       ├── boundary-request-event-samples.ts
│       ├── boundary-samples.ts
│       ├── index.ts
│       ├── invalid-error-event-samples.ts
│       ├── invalid-request-event-samples.ts
│       ├── invalid-samples.ts
│       ├── valid-error-event-samples.ts
│       ├── valid-request-event-samples.ts
│       └── valid-samples.ts
└── test/
    ├── architecture-boundary.test.ts
    ├── error-event-envelope.test.ts
    ├── error-event-types.test.ts
    ├── javascript-error-event.test.ts
    ├── package-entry.test.ts
    ├── promise-rejection-error-event.test.ts
    ├── request-event-body.test.ts
    ├── request-event-envelope.test.ts
    ├── request-event-types.test.ts
    ├── resource-error-event.test.ts
    └── consumers/
        ├── ingestion-error-event.contract.test.ts
        ├── ingestion-request-event.contract.test.ts
        ├── processing-error-event.contract.test.ts
        ├── processing-request-event.contract.test.ts
        ├── sdk-error-event.contract.test.ts
        └── sdk-request-event.contract.test.ts
```

现有文件继续保留原职责。`error-event-validation.ts` 与 `resource-error-event.ts` 只改为复用中立助手，不改变任何公共或可观测行为。新增文件各自只处理名称所示的单一协议职责，不创建杂物目录或通用 Schema 框架。

## 13. 测试范围

### 13.1 公共类型与出口

- 运行时常量和解析器可从包根导入；
- 全部公共类型由只使用包根的 TypeScript 消费者编译证明；
- 样本只从 `contract-testkit` 导入；
- 私有路径不可导入；
- 构建产物只暴露声明的两个入口，不泄露内部解析器；
- 请求解析器、URL 处理函数和样本不进入根出口。

### 13.2 请求方法

- 七个合法方法；
- 小写、未知方法、空方法和显式 `null`；
- 未知枚举值返回 `invalid_enum`。

### 13.3 请求 URL

- 无查询的合法安全 URL；
- 带查询参数和片段的 URL 输出中完全移除查询与片段；
- URL 最大值和超长值；
- `data:`、`blob:`、`file:`、相对地址、空 authority、凭据、反斜线、空白和控制字符；
- 缺失 URL、空 URL、显式 `null`；
- 正文未知字段。

### 13.4 时间与持续时间

- 合法 `startedAt`；
- `startedAt` 非数字、零、负数、非整数、非安全整数；
- 合法 `durationMs`（含 `0`）；
- `durationMs` 非数字、负数、非有限、非安全整数。

### 13.5 结果与状态码

- 五个合法结果类别；
- 未知结果类别；
- 合法 `statusCode`（含 `100`、`599`）；
- `statusCode` 低于 `100`、高于 `599`、非整数、显式 `null`；
- 缺失 `statusCode` 合法；
- `outcome` 与 `statusCode` 不要求跨字段一致。

### 13.6 信封组合

- 当前协议版本和合法请求正文；
- 请求正文与 `EventType.Error`、`EventType.Performance`、`EventType.Resource` 不匹配；
- 错误正文与 `EventType.Request` 不匹配；
- 版本 `0`、`2` 和非法时间戳；
- 通用信封 issue 原样保留；
- 解析结果不保留输入对象引用。

### 13.7 中立助手抽取回归

- 错误契约全部既有测试保持通过（含 JavaScript、Promise、资源正文与信封）；
- 资源 URL 脱敏行为与之前完全一致（含 `invalid_url` 的 `data:`/`blob:`/`file:`/相对地址/凭据/反斜线/空 authority）；
- 错误 issue code 与路径保持稳定。

### 13.8 契约样本与消费者

- 每类字段均有合法、非法和边界样本；
- SDK 消费者验证所有合法请求样本；
- 数据接入消费者验证所有非法请求样本和稳定 code；
- 数据处理消费者验证全部边界请求样本和脱敏后的期望输出；
- README 和正式协议文档中的 JSON 示例由测试提取并执行；
- 测试只验证公共行为，不断言私有函数调用次数。

## 14. 覆盖率与质量门禁

`packages/event-schema` 是关键核心包，维持：

- lines 不低于 `85%`；
- branches 不低于 `80%`；
- functions 不低于 `85%`；
- statements 不低于 `85%`。

阈值继续由 `packages/event-schema/vitest.config.ts` 固定。不得排除具有分支逻辑的新文件，不得降低门槛，不得删除或弱化失败测试。

实施必须新鲜运行受影响单测、三类请求消费者契约、既有错误契约回归、严格类型检查、Lint、覆盖率、构建、包入口、Workspace 边界、文档示例、根 `check:ci` 和 `git diff --check`。本协议包不需要真实浏览器测试，因为它没有 DOM、监听器或宿主副作用；Browser 的 Chromium 门禁不因本增量重复执行。

## 15. 代码规范落实

- 继承根 TypeScript `strict`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 和其他严格选项；
- 所有外部输入为 `unknown`，所有公共函数显式声明参数和返回类型；
- 禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore` 和静默 catch；
- 文件使用 `kebab-case`，类型/接口使用 `PascalCase`，函数/变量使用 `camelCase`；
- 布尔变量使用 `is`、`has`、`can` 或 `should` 前缀；
- 文件和函数保持单一职责，不创建 `utils`、`helpers`、`common` 或 `misc`；
- 公共 API 保持最小，私有 URL 和字段解析函数不导出；
- 不跨包访问 `src`、`internal` 或未导出路径；
- 请求方法、结果类别和事件类型使用唯一常量；
- 校验失败返回稳定 issue，不静默吞掉，不记录输入；
- 样本和文档不包含真实敏感数据；
- 不修改调用方输入，不污染宿主页面；
- 不复制错误契约的 URL 校验或字段校验逻辑，只复用中立助手；
- 不增加当前需求未使用的抽象。

宿主监听器释放、多实例状态、浏览器原生对象恢复、Core 插件生命周期、队列重试和生产日志级别规则不适用，因为本模块没有监听器、实例、宿主对象、插件、队列、重试或日志器。计划必须保持这些能力不存在。

## 16. 文档与 ADR 同步

实施计划必须同步：

- `packages/event-schema/README.md`：从“只有错误事件契约”更新为“错误事件契约加请求事件契约第一增量”，列出请求 API、限制、隐私、错误、样本和排除范围；
- `docs/protocol/event-envelope-v1.md`：链接本文并明确 `parseEventEnvelope` 与精确请求解析器的层次；
- `docs/README.md`：加入本文并保持其他具体事件、批次和消费者实现缺失；
- `docs/architecture/system-overview.md` 与 `docs/architecture/sdk-architecture.md`：只记录请求事件机器契约已存在，请求观测能力、请求插件和传输仍不存在；
- `docs/architecture/formalization-readiness.md`：把 A1 更新为信封基础加错误与请求正文第一增量，其他正文、批次、兼容转换和真实系统消费者仍受阻；
- ADR-005：只追加单一来源、请求 Schema、样本和消费者契约实施证据，保持 `accepted / in-progress`；
- ADR-006：只追加协议层零本地依赖、无 DOM/Node 运行时依赖、公开入口和私有路径负例证据，保持 `accepted / in-progress`；
- ADR-003：请求协议不是请求观测或请求插件，只在实施记录中澄清插件前置契约已具备，保持 `accepted / in-progress`；
- ADR-007：工具和命令不变，保持 `accepted / implemented`；
- `AGENTS.md` 与 `AURORA_RULES.md`：只有代码和完整门禁实际通过后才更新阶段快照；
- 根 README：只有当前实现状态描述受影响时才更新，不声称请求观测、请求插件、CI、发布或服务端存在。

本文和实施计划本身不得写入实施证据，不得修改 ADR 决策结论或实施状态。

## 17. 明确排除范围

- 浏览器请求观测、代理 `fetch`、代理 `XMLHttpRequest`；
- `packages/browser` 请求观测能力、`packages/plugin-request`；
- 请求去重、分组、指纹、代表样本和问题聚合；
- 允许来源判断、同源判断、跨域允许列表、路径动态段归一化和开发者路径模板；
- 请求/响应正文、请求头、响应头、Cookie、凭据和尺寸；
- 发生页面、运行环境、发布版本和用户上下文；
- breadcrumb、Session、用户、项目或 release 上下文；
- 完整 URL 查询参数和片段；
- 性能、通用资源或行为事件正文；
- 批次、接收、传输、采样、队列、重试和持久化；
- 接入、处理、服务端、数据库、管理平台；
- CI、发布、容器、IaC 和云资源。

## 18. 后续模块衔接边界

`@aurora/browser` 请求观测能力（`docs/sdk/browser-request-source.md`）只有在本文契约实际实施并通过包入口与契约测试后，才可在独立规格中规划。该能力可以：

- 安全观测 `fetch` 和 `XMLHttpRequest` 的开始、完成、失败、超时和取消事实；
- 从 `@aurora/event-schema` 根入口导入本文常量、类型和解析器；
- 把最小请求事实交给请求采集插件转换并提交。

请求采集插件（`docs/sdk/request-capture-plugin.md`）只消费 Browser 请求事实，只使用本文请求契约，只通过 Core 草稿入口提交，不直接代理 `fetch`/XHR，不复制 URL 脱敏和协议校验。本文不定义请求观测生命周期、监听器、诊断、代理策略或 Core 扩展。如果安全代理 fetch/XHR 属于尚未 accepted 的长期架构决策，Browser 请求观测规格必须先建立 proposed ADR，并在 accepted 前停止正式实施。

## 19. ADR 判断

本增量执行 accepted ADR-005 的协议单一来源、运行时校验、兼容规则和共享样本，执行 accepted ADR-006 的底层依赖和自动边界约束，并复用 accepted/implemented ADR-007 的现有工具入口。它为 accepted ADR-003 的请求插件分层提供前置协议，但不实施请求观测或请求插件。

七个请求方法、五个结果类别、字段组织、限制数值和私有解析函数没有改变五系统边界、依赖方向或长期兼容策略，不创建新 ADR。若要改变协议版本策略、允许协议依赖业务包、删除或重释公共字段、放宽隐私默认值，或把请求监控的允许来源/同源/路径归一化判断移入协议层，必须先有新的 accepted ADR。

## 20. 规格自检

- 请求方法、结果类别、URL、时间、持续时间和状态码均有精确正文、成功、失败和边界语义；
- 所有公共运行时值、类型、函数和样本均有完整签名；
- `EventEnvelope`、`EventType.Request`、协议版本和通用限制没有复制来源；
- 请求监控的允许来源、同源、跨域和路径归一化判断没有进入协议层；
- URL 查询和片段不会进入成功结果；
- 解析不修改输入，也不保留输入可变对象引用；
- 错误契约与请求契约共享中立助手，错误契约行为保持完全一致；
- 没有 Core、Browser、插件、DOM 或 Node 运行时依赖；
- 没有无界值、敏感示例、占位表达或未定义接口；
- 没有请求观测、代理、网络、队列、服务端或基础设施能力；
- 覆盖率、消费者契约、包入口、Workspace 边界和文档同步均有明确门禁；
- 现有 ADR 决策和状态没有因本文改变。
