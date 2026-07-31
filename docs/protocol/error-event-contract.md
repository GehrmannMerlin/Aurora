---
title: Aurora 错误事件协议契约第一增量
status: approved
owner: protocol
created: 2026-07-30
last-reviewed: 2026-07-30
applies-to: packages/event-schema 的错误事件正文、错误信封窄化、运行时校验、契约样本与公共出口
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
  - ../sdk/sdk-core-foundation.md
  - ../sdk/browser-environment-foundation.md
  - ../testing/test-strategy.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../adr/ADR-007-workspace-package-and-task-tooling.md
supersedes: none
review-cycle: error-protocol-field-or-compatibility-change
---

# Aurora 错误事件协议契约第一增量

## 1. 定位、效力与当前状态

本文冻结 `packages/event-schema` 的错误事件协议契约第一增量。该增量在既有公共 `EventEnvelope`、协议版本 `1`、有界正文校验和稳定 issue 之上，增加 JavaScript 运行时错误、未处理 Promise 拒绝和静态资源加载错误的精确正文、错误信封解析器及共享契约样本。

本文只从 approved PRD、approved 长期规范、现有 approved 协议/SDK 规格，以及 accepted ADR-003、ADR-005、ADR-006、ADR-007 推导。字段组织、私有验证函数、文件拆分和限制数值属于用户已授权收口的普通、可回滚实施细节，因此本文状态为 `approved`。

截至 2026-07-30，仓库只有信封级 `body: unknown` 校验，没有本文定义的错误正文类型、错误正文解析器或错误专用样本。本文批准只允许生成一份实施计划，不表示本增量已经实施，也不修改任何 ADR 状态。

## 2. 模块职责与明确非职责

### 2.1 职责

- 在 `@aurora/event-schema` 中定义唯一的错误类别、Promise 拒绝原因类别和资源类型常量；
- 定义 JavaScript 运行时错误、未处理 Promise 拒绝和资源加载错误的最小正文；
- 定义错误名称、错误消息、原始堆栈、Promise 非标准值和资源 URL 的精确限制；
- 使用现有 `EventEnvelope`、`EventType.Error`、`CURRENT_PROTOCOL_VERSION` 和 `EventSchemaIssue`；
- 从 `unknown` 同步解析错误正文和完整错误信封；
- 对资源 URL 移除全部查询参数与片段；
- 对 Promise 非标准 JSON 值执行既有字符串、数组、对象、深度、循环和禁止字段边界；
- 返回稳定、有限、不包含输入值的校验 issue；
- 生成新的输出对象，不修改输入，也不保留输入中的数组或普通对象引用；
- 提供合法、非法和边界样本，供 SDK、数据接入和数据处理契约测试复用；
- 从包根导出运行时契约，从既有 `contract-testkit` 子路径导出测试样本；
- 同步模块 README、协议文档、架构追踪和 ADR 实施证据。

### 2.2 明确非职责

- 不注册或触发浏览器监听器；
- 不采集 `window.error`、`unhandledrejection` 或资源错误；
- 不实现错误标准化、`packages/plugin-error` 或任何具体 Core 插件；
- 不实现错误去重、问题分组、指纹、Source Map 解析或 Stack Frame 源码映射；
- 不定义 React/Vue 框架错误或开发者主动上报错误的专用来源字段；
- 不采集用户行为上下文、请求/响应正文、完整 DOM、页面文本或用户输入；
- 不保留完整 URL 查询参数；
- 不实现网络传输、采样、队列、批量、重试或持久化；
- 不实现数据接入、数据处理、服务端、数据库、管理平台、CI、发布、容器、IaC 或云资源；
- 不建立通用 Schema DSL、注册器、事件总线、转换框架、`utils`、`helpers`、`common` 或 `misc`。

## 3. 与公共事件信封的关系

### 3.1 单一信封和版本来源

错误事件不创建第二套信封或协议版本。所有错误事件必须满足：

```ts
export type ErrorEventEnvelope = EventEnvelope & {
  readonly eventType: typeof EventType.Error;
  readonly body: ErrorEventBody;
};
```

`protocolVersion`、`eventId`、`eventType`、`occurredAt` 和通用正文资源边界继续由现有 `parseEventEnvelope(input: unknown)` 校验。`occurredAt` 继续表示大于 `0` 且不超过 `Number.MAX_SAFE_INTEGER` 的 Unix epoch 毫秒安全整数；错误正文不得复制时间戳。

`EventType.Resource` 保留给既有公共事件类别，不表示资源加载错误。本文的资源加载错误是 `EventType.Error` 信封中 `category: 'resource'` 的正文。错误正文与 `request`、`performance` 或 `resource` 信封组合时必须返回 `event_type_mismatch`。

### 3.2 解析层次

- `parseEventEnvelope` 继续只证明公共信封和通用资源边界有效，成功结果的 `body` 保持 `unknown`；
- `parseErrorEventBody` 证明一个值符合本文的精确错误正文；
- `parseErrorEventEnvelope` 先复用 `parseEventEnvelope`，再校验 `EventType.Error` 和精确错误正文；
- 消费者只有在 `parseErrorEventEnvelope` 成功后，才能把 `body` 视为 `ErrorEventBody`。

## 4. 完整公共 TypeScript 契约

### 4.1 常量、枚举和限制

```ts
export const ErrorCategory: {
  readonly JavaScript: 'javascript';
  readonly UnhandledRejection: 'unhandled_rejection';
  readonly Resource: 'resource';
};
export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

export const PromiseRejectionReasonKind: {
  readonly Error: 'error';
  readonly String: 'string';
  readonly NonStandard: 'non_standard';
};
export type PromiseRejectionReasonKind =
  (typeof PromiseRejectionReasonKind)[keyof typeof PromiseRejectionReasonKind];

export const ErrorResourceType: {
  readonly Script: 'script';
  readonly Stylesheet: 'stylesheet';
  readonly Image: 'image';
  readonly Font: 'font';
};
export type ErrorResourceType = (typeof ErrorResourceType)[keyof typeof ErrorResourceType];

export const ERROR_EVENT_LIMITS: {
  readonly maxErrorNameLength: 128;
  readonly maxErrorMessageLength: 2048;
  readonly maxStackLength: 4096;
  readonly maxResourceUrlLength: 2048;
  readonly maxRejectionStringLength: 2048;
};
```

枚举值只在上述常量中定义。实现、样本和消费者使用常量，不散落大小写不同或同义的魔法字符串。

### 4.2 错误描述和三类正文

```ts
export interface ErrorDescriptor {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
}

export interface JavaScriptErrorEventBody {
  readonly category: typeof ErrorCategory.JavaScript;
  readonly error: ErrorDescriptor;
}

export interface ErrorPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.Error;
  readonly error: ErrorDescriptor;
}

export interface StringPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.String;
  readonly value: string;
}

export type SafeErrorObject = {
  readonly [key: string]: SafeErrorValue;
};

export type SafeErrorValue =
  null | boolean | number | string | readonly SafeErrorValue[] | SafeErrorObject;

export interface NonStandardPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.NonStandard;
  readonly value: SafeErrorValue;
}

export type PromiseRejectionReason =
  ErrorPromiseRejectionReason | StringPromiseRejectionReason | NonStandardPromiseRejectionReason;

export interface UnhandledPromiseRejectionErrorEventBody {
  readonly category: typeof ErrorCategory.UnhandledRejection;
  readonly reason: PromiseRejectionReason;
}

export interface ResourceLoadError {
  readonly type: ErrorResourceType;
  readonly url: string;
}

export interface ResourceLoadErrorEventBody {
  readonly category: typeof ErrorCategory.Resource;
  readonly resource: ResourceLoadError;
}

export type ErrorEventBody =
  JavaScriptErrorEventBody | UnhandledPromiseRejectionErrorEventBody | ResourceLoadErrorEventBody;
```

### 4.3 解析结果和函数

```ts
export interface ErrorEventBodyParseSuccess {
  readonly success: true;
  readonly data: ErrorEventBody;
}

export type ErrorEventBodyParseFailure = EventEnvelopeParseFailure;
export type ErrorEventBodyParseResult = ErrorEventBodyParseSuccess | ErrorEventBodyParseFailure;

export interface ErrorEventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: ErrorEventEnvelope;
}

export type ErrorEventEnvelopeParseFailure = EventEnvelopeParseFailure;
export type ErrorEventEnvelopeParseResult =
  ErrorEventEnvelopeParseSuccess | ErrorEventEnvelopeParseFailure;

export function parseErrorEventBody(input: unknown): ErrorEventBodyParseResult;
export function parseErrorEventEnvelope(input: unknown): ErrorEventEnvelopeParseResult;
```

两个函数均为同步、确定性、非抛出解析入口。它们不记录输入，不修改输入，不调用浏览器或 Node 专属 API。普通非法输入返回 `success: false`；只有程序缺陷或运行时自身不可恢复错误可以抛出。

成功结果由解析器新建。嵌套错误描述、资源对象、Promise 原因、数组和普通对象均被复制；调用方在解析后修改原输入不会改变成功结果。

### 4.4 共享样本

以下内容只从 `@aurora/event-schema/contract-testkit` 导出：

```ts
export interface ValidErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: ErrorEventEnvelope;
}

export interface InvalidErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

export interface BoundaryErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: ErrorEventEnvelope;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

export const validErrorEventSamples: readonly ValidErrorEventSample[];
export const invalidErrorEventSamples: readonly InvalidErrorEventSample[];
export const boundaryErrorEventSamples: readonly BoundaryErrorEventSample[];
```

样本使用固定合成域名、编号和文本，不含真实 Cookie、Token、Authorization、密码、请求/响应正文、表单、DOM、页面文本、用户输入、Storage、IP 或个人信息。

## 5. 字段语义

### 5.1 JavaScript 运行时错误

最小合法正文为：

```json
{
  "category": "javascript",
  "error": {
    "message": "Synthetic runtime failure"
  }
}
```

- `category` 必须精确为 `javascript`；
- `error.message` 必填，长度为 `1..2048`；
- `error.name` 可选；存在时长度为 `1..128`；
- `error.stack` 可选；存在时长度为 `1..4096`；
- `null` 不等于缺失，三个字符串字段均不接受 `null`；
- 正文和 `error` 对象都拒绝未知字段。

错误名称表示运行时错误类型；消息表示经过调用方隐私过滤的有限错误信息；`stack` 是有限原始堆栈字符串，不解析 Stack Frame，也不执行 Source Map。

### 5.2 未处理 Promise 拒绝

`category` 必须精确为 `unhandled_rejection`，`reason` 必填，并使用 `kind` 区分三种安全表达：

1. `kind: 'error'`：原因已经规范化为 `ErrorDescriptor`；
2. `kind: 'string'`：原因是长度 `1..2048` 的安全字符串；
3. `kind: 'non_standard'`：原因是有限 JSON 值。

`non_standard.value` 允许 `null`、布尔值、有限数字、字符串、数组和普通对象。它复用 `EVENT_SCHEMA_LIMITS`：

- 任意字符串最长 `4096`；
- 任意数组最多 `100` 项；
- 任意对象最多 `100` 个自有可枚举键；
- 整个错误 `body` 根深度为 `0`，最大深度为 `8`；
- 循环引用、`undefined`、`bigint`、`symbol`、函数、非有限数字、Symbol 属性、Date、Map、Set、类实例和其他非普通对象拒绝；
- 任意层级继续拒绝现有禁止字段；
- 解析成功后递归复制该值，不执行 `JSON.stringify`，因此循环和超界输入不会造成无界序列化。

顶层字符串原因必须使用 `kind: 'string'`；`kind: 'non_standard'` 的直接 `value` 不接受字符串，以避免同一语义出现两种协议形态。嵌套对象或数组中的字符串仍允许。

### 5.3 资源加载错误

`category` 必须精确为 `resource`。`resource.type` 只允许：

- `script`：JavaScript 资源；
- `stylesheet`：CSS 资源；
- `image`：图片资源；
- `font`：字体资源。

未知资源类型拒绝，不使用 `other` 吞并未批准类别。

`resource.url` 必填，原始输入长度为 `1..2048`，只接受小写 `http://` 或 `https://` 绝对地址。解析器：

1. 在读取任何查询值前，以最先出现的 `?` 或 `#` 截断；
2. 移除全部查询参数和片段，不保留参数名或值；
3. authority 只允许 ASCII 域名/IPv4/`localhost` 或方括号 IPv6，可带 `0..65535` 端口；拒绝空 authority、用户名/密码形式的 `@`、反斜线、空白和控制字符；
4. 返回保留 scheme、authority、port 和 path 的安全 URL；
5. 对 `data:`、`blob:`、`file:`、相对地址和其他 scheme 返回 `invalid_url`。

解析器不修改输入字符串或输入对象。资源路径中的动态段归一化、CDN 允许列表和高频样本策略不属于本文。

<!-- contract-example:valid-error-spec -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-spec-error-valid",
  "eventType": "error",
  "occurredAt": 1800000004101,
  "body": {
    "category": "resource",
    "resource": {
      "type": "script",
      "url": "https://static.example.test/app.js?cache=synthetic#fragment"
    }
  }
}
```

该输入成功后，输出 `body.resource.url` 必须是 `https://static.example.test/app.js`。

<!-- contract-example:invalid-error-spec -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-spec-error-invalid",
  "eventType": "error",
  "occurredAt": 1800000004102,
  "body": {
    "category": "resource",
    "resource": {
      "type": "font",
      "url": "file:///synthetic/font.woff2"
    }
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
- 未知错误类别不会降级到默认类别；
- Promise 的 `non_standard.value: null` 是明确合法值，不等于缺失；
- `undefined` 无法进入协议正文，返回 `invalid_type`。

## 7. 隐私与禁止字段

本文不允许默认写入：

- Cookie、Token、Authorization 或其他凭据；
- 请求头、请求体、响应头或响应体；
- 完整表单、完整 DOM、页面文本或用户输入；
- 浏览器 Storage；
- 完整 URL 查询参数；
- 用户指纹或原始 IP；
- 任意无限递归对象。

既有通用正文校验继续按 ASCII 小写拒绝 `authorization`、`cookie`、`password`、`requestbody`、`responsebody`、`formdata`、`dom`、`consolelog` 和 `ipaddress` 字段。Promise 非标准对象另外按移除 `_` 与 `-` 后的 ASCII 小写名称拒绝 `token`、`accessToken` 和 `refreshToken`。错误正文采用精确字段允许列表，因此其他未声明上下文字段也被拒绝。

错误消息和原始堆栈是自由文本，协议层无法可靠推断其中所有秘密。生产者在调用解析器前必须完成允许列表、明显个人信息替换、URL 查询移除和隐私过滤；解析器负责限制长度、结构和已知禁止字段，不把自己描述为完整脱敏器。校验 issue 只包含稳定 code、字段路径和固定消息，不回显非法字段值。实现不输出生产路径控制台日志。

## 8. 稳定校验错误

本文向现有 `EventSchemaIssueCode` 增加：

```ts
export type EventSchemaIssueCode =
  | 'missing_required_field'
  | 'invalid_type'
  | 'unknown_field'
  | 'invalid_enum'
  | 'string_empty'
  | 'string_too_long'
  | 'array_too_large'
  | 'object_too_large'
  | 'object_too_deep'
  | 'cyclic_reference'
  | 'invalid_number'
  | 'invalid_timestamp'
  | 'invalid_url'
  | 'event_type_mismatch'
  | 'unknown_event_type'
  | 'unsupported_protocol_version'
  | 'forbidden_field';
```

- `string_empty`：必填或已提供的字符串为空；
- `invalid_url`：资源 URL 不是本文允许的安全 HTTP(S) 形态；
- `event_type_mismatch`：精确错误正文与非 `EventType.Error` 信封组合。

现有 `missing_required_field`、`invalid_type`、`unknown_field`、`invalid_enum`、`string_too_long`、`array_too_large`、`object_too_large`、`object_too_deep`、`cyclic_reference`、`invalid_number`、`invalid_timestamp`、`unknown_event_type`、`unsupported_protocol_version` 和 `forbidden_field` 保持语义。

issue 按稳定遍历顺序返回，最多 `EVENT_SCHEMA_LIMITS.maxIssues` 条。issue 的 `path` 对正文从 `['body']` 开始；独立调用 `parseErrorEventBody` 和调用完整错误信封解析器时使用相同路径。

## 9. 运行时校验顺序

`parseErrorEventEnvelope` 固定执行：

1. 调用现有 `parseEventEnvelope(input)`；
2. 原信封失败时原样返回稳定 issue；
3. 校验 `eventType === EventType.Error`；
4. 调用 `parseErrorEventBody(envelope.body)`；
5. 根据类别执行精确允许列表和字段校验；
6. 资源 URL 生成脱敏字符串；Promise 非标准值生成有界深复制；
7. 返回新建的 `ErrorEventEnvelope`。

该顺序保证协议版本、时间戳、通用限制和禁止字段仍只有一个来源。错误解析器不复制 `parseEventEnvelope` 的协议版本或时间校验。

## 10. 兼容规则

- 当前仍只支持协议版本 `1`；
- 本增量是对现有信封 API 的加法：`parseEventEnvelope` 的签名、`EventEnvelope.body: unknown` 和既有样本入口保持不变；
- 既有信封级 `error` 样本只证明通用信封合法，不自动成为精确错误正文样本；
- `parseErrorEventEnvelope` 对正文使用严格字段允许列表；
- 增加新的可选字段只有在旧解析器也能接受时才是同版本兼容；当前严格解析器不会接受未知字段，因此不能把任意新字段描述为无条件兼容；
- 删除字段、改变含义或类型、把可选字段改为必填、增加旧解析器不认识的必填字段、改变现有枚举含义均不兼容；
- 增加错误类别、Promise 原因类别或资源类型会被旧解析器拒绝，必须先完成兼容评估；需要不兼容变化时创建 accepted ADR、迁移说明和旧版本处理方案；
- 不创建版本 `0` 转换器，也不对版本 `2` 猜测降级。

## 11. 公共出口和依赖边界

### 11.1 根出口

`@aurora/event-schema` 根入口导出：

- `ErrorCategory`、`PromiseRejectionReasonKind`、`ErrorResourceType`、`ERROR_EVENT_LIMITS`；
- 本文全部公共正文、原因、资源、错误信封和解析结果类型；
- `parseErrorEventBody` 和 `parseErrorEventEnvelope`；
- 新增的稳定 issue code 通过既有 `EventSchemaIssueCode` 导出。

根入口不导出私有字段解析器、URL 处理函数、递归复制函数或样本。

### 11.2 测试入口

`@aurora/event-schema/contract-testkit` 在保留既有信封样本的同时增加本文三组错误样本和对应样本类型。不增加第三个子路径出口。

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
│   ├── error-event-validation.ts
│   ├── event-envelope.ts
│   ├── event-types.ts
│   ├── index.ts
│   ├── javascript-error-event.ts
│   ├── promise-rejection-error-event.ts
│   ├── resource-error-event.ts
│   ├── validation-issues.ts
│   ├── value-boundaries.ts
│   └── contract-testkit/
│       ├── boundary-error-event-samples.ts
│       ├── index.ts
│       ├── invalid-error-event-samples.ts
│       └── valid-error-event-samples.ts
└── test/
    ├── architecture-boundary.test.ts
    ├── error-event-envelope.test.ts
    ├── error-event-types.test.ts
    ├── javascript-error-event.test.ts
    ├── package-entry.test.ts
    ├── promise-rejection-error-event.test.ts
    ├── resource-error-event.test.ts
    └── consumers/
        ├── ingestion-error-event.contract.test.ts
        ├── processing-error-event.contract.test.ts
        └── sdk-error-event.contract.test.ts
```

现有文件继续保留原职责。新增文件各自只处理名称所示的单一协议职责，不创建杂物目录或通用 Schema 框架。

## 13. 测试范围

### 13.1 公共类型与出口

- 运行时常量和解析器可从包根导入；
- 全部公共类型由只使用包根的 TypeScript 消费者编译证明；
- 样本只从 `contract-testkit` 导入；
- 私有路径不可导入；
- 构建产物只暴露声明的两个入口，不泄露内部解析器。

### 13.2 JavaScript 运行时错误

- 最小合法错误；
- 带名称、消息和堆栈；
- 缺失 `category`、`error` 或 `message`；
- 字段类型错误、显式 `null`、空消息；
- 名称、消息和堆栈的精确最大值与超长值；
- 正文和描述对象的未知字段；
- 非法错误类别。

### 13.3 Promise 拒绝错误

- Error 风格原因；
- 字符串风格安全表示；
- `null`、布尔、有限数字、数组和普通对象的非标准有限表示；
- 直接非标准字符串的非规范形态拒绝；
- `undefined`、`bigint`、`symbol`、函数、非有限数字和非普通对象拒绝；
- 循环对象、深度 `8/9` 边界、数组 `100/101` 边界、对象键数 `100/101` 边界；
- 禁止字段；
- 解析成功后的递归复制和原输入不变。

### 13.4 资源加载错误

- 四种合法资源类型；
- 无查询的合法安全 URL；
- 带查询参数和片段的 URL 输出中完全移除查询与片段；
- 未知资源类型；
- URL 最大值和超长值；
- `data:`、`blob:`、`file:`、相对地址、空 authority、凭据和空 URL；
- 缺失 URL；
- 正文和资源对象未知字段；
- 原输入不被修改。

### 13.5 信封组合

- 当前协议版本和合法错误正文；
- 三种正文均与 `EventType.Error` 匹配；
- 三种正文分别与 `request`、`performance`、`resource` 不匹配；
- 版本 `0`、`2` 和非法时间戳；
- 通用信封 issue 原样保留；
- 解析结果不保留输入对象、嵌套数组或普通对象引用。

### 13.6 契约样本与消费者

- 每种类别均有合法、非法和边界样本；
- SDK 消费者验证所有合法样本；
- 数据接入消费者验证所有非法样本和稳定 code；
- 数据处理消费者验证全部边界样本和脱敏后的期望输出；
- README 和正式协议文档中的 JSON 示例由测试提取并执行；
- 测试只验证公共行为，不断言私有函数调用次数。

## 14. 覆盖率与质量门禁

`packages/event-schema` 是关键核心包，维持：

- lines 不低于 `85%`；
- branches 不低于 `80%`；
- functions 不低于 `85%`；
- statements 不低于 `85%`。

阈值继续由 `packages/event-schema/vitest.config.ts` 固定。不得排除具有分支逻辑的新文件，不得降低门槛，不得删除或弱化失败测试。

实施必须新鲜运行受影响单测、三类消费者契约、严格类型检查、Lint、覆盖率、构建、包入口、Workspace 边界、文档示例、根 `check:ci` 和 `git diff --check`。本协议包不需要真实浏览器测试，因为它没有 DOM、监听器或宿主副作用；Browser 的 Chromium 门禁不因本增量重复执行。

## 15. 代码规范落实

- 继承根 TypeScript `strict`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 和其他严格选项；
- 所有外部输入为 `unknown`，所有公共函数显式声明参数和返回类型；
- 禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore` 和静默 catch；
- 递归安全值通过窄化和新建数组/普通对象产生，不使用 `JSON.stringify` 或类型断言绕过验证；
- 文件使用 `kebab-case`，类型/接口使用 `PascalCase`，函数/变量使用 `camelCase`；
- 布尔变量使用 `is`、`has`、`can` 或 `should` 前缀；
- 文件和函数保持单一职责，不创建 `utils`、`helpers`、`common` 或 `misc`；
- 公共 API 保持最小，私有 URL 和字段解析函数不导出；
- 不跨包访问 `src`、`internal` 或未导出路径；
- 错误类别、原因类别、资源类型和事件类型使用唯一常量；
- 校验失败返回稳定 issue，不静默吞掉，不记录输入；
- 样本和文档不包含真实敏感数据；
- 不修改调用方输入，不污染宿主页面；
- 不增加当前需求未使用的抽象。

宿主监听器释放、多实例状态、浏览器原生对象恢复、Core 插件生命周期、队列重试和生产日志级别规则不适用，因为本模块没有监听器、实例、宿主对象、插件、队列、重试或日志器。计划必须保持这些能力不存在。

## 16. 文档与 ADR 同步

实施计划必须同步：

- `packages/event-schema/README.md`：从“没有具体正文”更新为“只有错误事件契约第一增量”，列出 API、限制、隐私、错误、样本和排除范围；
- `docs/protocol/event-envelope-v1.md`：链接本文并明确 `parseEventEnvelope` 与精确错误解析器的层次；
- `docs/README.md`：加入本文并保持其他具体事件、批次和消费者实现缺失；
- `docs/architecture/system-overview.md` 与 `docs/architecture/sdk-architecture.md`：只记录错误事件机器契约已存在，错误采集插件仍不存在；
- `docs/architecture/formalization-readiness.md`：把 A1 更新为信封基础加错误正文第一增量，其他正文、批次、兼容转换和真实系统消费者仍受阻；
- ADR-005：只追加单一来源、错误 Schema、样本和消费者契约实施证据，保持 `accepted / in-progress`；
- ADR-006：只追加协议层零本地依赖、无 DOM/Node 运行时依赖、公开入口和私有路径负例证据，保持 `accepted / in-progress`；
- ADR-003：错误协议不是错误插件，只在实施记录中澄清插件前置契约已具备，保持 `accepted / in-progress`；
- ADR-007：工具和命令不变，保持 `accepted / implemented`；
- `AGENTS.md` 与 `AURORA_RULES.md`：只有代码和完整门禁实际通过后才更新阶段快照；
- 根 README：只有当前实现状态描述受影响时才更新，不声称插件、CI、发布或服务端存在。

本文和实施计划本身不得写入实施证据，不得修改 ADR 决策结论或实施状态。

## 17. 明确排除范围

- 浏览器错误、Promise 或资源监听器；
- 错误捕获、规范化或上报插件；
- `packages/plugin-error`；
- React/Vue 框架错误专用契约；
- 开发者主动捕获 API；
- 去重、分组、指纹、代表样本和问题聚合；
- Source Map 和 Stack Frame 映射；
- breadcrumb、用户、页面、浏览器、操作系统、release、environment 或 project 上下文；
- 请求/响应数据、完整 URL 查询、完整 DOM/文本、Storage、用户输入、指纹和 IP；
- 请求、性能、通用资源或行为事件正文；
- 批次、接收、传输、采样、队列、重试和持久化；
- 接入、处理、服务端、数据库、管理平台；
- CI、发布、容器、IaC 和云资源。

## 18. 错误插件衔接边界

错误采集插件只有在本文契约实际实施并通过包入口与契约测试后，才可在独立规格中规划。该插件可以：

- 通过 Browser 公开能力注册和释放监听器；
- 把浏览器异常窄化、脱敏并转换为本文三类正文；
- 从 `@aurora/event-schema` 根入口导入本文常量、类型和解析器；
- 把完整 `ErrorEventEnvelope` 交给 Core 公开事件入口。

该插件不得复制本文类型、枚举、限制或校验器，不得访问 `event-schema/src`，不得绕过 Core 建立独立传输。本文不定义插件生命周期、监听器、诊断或 Core 扩展。

## 19. ADR 判断

本增量执行 accepted ADR-005 的协议单一来源、运行时校验、兼容规则和共享样本，执行 accepted ADR-006 的底层依赖和自动边界约束，并复用 accepted/implemented ADR-007 的现有工具入口。它为 accepted ADR-003 的错误插件分层提供前置协议，但不实施插件。

三类最小错误正文、四个资源类型、字段组织、限制数值和私有解析函数没有改变五系统边界、依赖方向或长期兼容策略，不创建新 ADR。若要改变协议版本策略、允许协议依赖业务包、删除或重释公共字段、放宽隐私默认值，必须先有新的 accepted ADR。

## 20. 规格自检

- 三种错误类别都有精确正文、成功、失败和边界语义；
- 所有公共运行时值、类型、函数和样本均有完整签名；
- `EventEnvelope`、`EventType.Error`、协议版本和通用限制没有复制来源；
- 资源错误没有误用 `EventType.Resource`；
- Promise 循环、超深、超大和非 JSON 值均有限失败；
- URL 查询和片段不会进入成功结果；
- 解析不修改输入，也不保留输入可变对象引用；
- 没有 Core、Browser、插件、DOM 或 Node 运行时依赖；
- 没有无界值、敏感示例、占位表达或未定义接口；
- 没有错误采集、网络、队列、服务端或基础设施能力；
- 覆盖率、消费者契约、包入口、Workspace 边界和文档同步均有明确门禁；
- 现有 ADR 决策和状态没有因本文改变。
