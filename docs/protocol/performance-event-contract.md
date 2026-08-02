---
title: Aurora 性能事件协议契约第一增量
status: approved
implementation-status: implemented
owner: protocol
created: 2026-07-31
last-reviewed: 2026-07-31
applies-to: packages/event-schema 的性能事件正文、性能信封窄化、运行时校验、契约样本与公共出口
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
  - request-event-contract.md
  - ../testing/test-strategy.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../adr/ADR-007-workspace-package-and-task-tooling.md
supersedes: none
review-cycle: performance-protocol-field-or-compatibility-change
---

# Aurora 性能事件协议契约第一增量

## 1. 定位、效力与当前状态

本文冻结 `packages/event-schema` 的性能事件协议契约第一增量。该增量在既有公共 `EventEnvelope`、协议版本 `1`、有界正文校验和稳定 issue 之上，增加基础页面性能监控链路的最小安全正文、性能信封解析器及共享契约样本。

**实施证据（2026-07-31）**：本增量已实施为 `@aurora/event-schema` 的真实协议增量，并通过以下新鲜验证：

- `pnpm --filter @aurora/event-schema test`：28 个测试文件、167 个测试全部通过（含既有错误/请求契约回归）；
- `pnpm --filter @aurora/event-schema test:coverage`：statements 89.62%、branches 88.1%、functions 95.18%、lines 91.2%（门禁 85/80/85/85）；
- `pnpm --filter @aurora/event-schema test:package`：构建根入口含 `PerformanceMetricCategory`、`PerformanceMetricName`、`PerformanceMetricUnit`、`PERFORMANCE_EVENT_LIMITS`、`parsePerformanceEventBody`、`parsePerformanceEventEnvelope`，私有路径 `performance-event-body`/`performance-event-envelope`/`performance-event-types` 全部返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
- 三类性能消费者契约（SDK/接入/处理）全部通过；
- `pnpm --filter @aurora/event-schema typecheck` 与根 `pnpm check:boundaries` 均无诊断；根 `pnpm check:ci` 通过。

本文只从 approved PRD（页面性能 5.1.9）、approved 长期规范、现有 approved 协议/SDK 规格，以及 accepted ADR-003、ADR-005、ADR-006、ADR-007 推导。字段组织、私有验证函数、文件拆分和限制数值属于用户已授权收口的普通、可回滚实施细节，因此本文状态为 `approved`。

**指标范围严格限定**：本文只纳入 PRD 5.1.9 明确批准的四项页面性能指标——LCP、INP、CLS、页面加载耗时。性能事件协议**不包含**任何其他 Web Vitals（FCP、TTFB、FID、TBT 等）、自定义业务指标、资源计时明细或未批准的性能能力。后续任何新增指标必须由独立 approved 规格批准，不得在本增量内自行扩展。

截至 2026-07-31，仓库已有错误事件协议契约与请求事件协议契约第一增量，但没有性能事件正文类型、性能正文解析器或性能专用样本。`EventType.Performance` 已在公共信封规格中批准。本文批准只允许生成一份实施计划，不表示本增量已经实施，也不修改任何 ADR 状态。

## 2. 模块职责与明确非职责

### 2.1 职责

- 在 `@aurora/event-schema` 中定义唯一的性能指标类别、性能指标名称、指标单位和性能正文限制常量；
- 定义基础页面性能事件的最小安全正文：指标类别、指标名称、指标数值、指标单位、测量开始时间和可选持续时间；
- 使用现有 `EventEnvelope`、`EventType.Performance`、`CURRENT_PROTOCOL_VERSION` 和 `EventSchemaIssue`；
- 从 `unknown` 同步解析性能正文和完整性能信封；
- 返回稳定、有限、不包含输入值的校验 issue；
- 生成新的输出对象，不修改输入；
- 提供合法、非法和边界样本，供 SDK、数据接入和数据处理契约测试复用；
- 从包根导出运行时契约，从既有 `contract-testkit` 子路径导出测试样本；
- 复用既有中立字段校验助手（`field-validation.ts`、`value-boundaries.ts`），不复制逻辑；
- 同步模块 README、协议文档、架构追踪和 ADR 实施证据。

### 2.2 明确非职责

- 不注册或触发任何浏览器监听器、`PerformanceObserver` 或性能 API；
- 不读取浏览器性能对象（`performance`、`performance.getEntriesByType`、`navigation`、`paint`、`largest-contentful-paint` 等）；
- 不采集资源计时明细、网络计时字段、重定向/连接/TTFB 分解或长任务明细；
- 不采集发生页面、运行环境、发布版本等上下文（与错误/请求正文一致，属于 SDK 上下文层）；
- 不采集完整资源 URL、路径动态段、查询参数或片段；
- 不采集 DOM 节点、页面文本、用户输入、指纹或设备信息；
- 不实现采样（PRD 默认采样率 10% 属于 SDK 采集层）、去重、聚合、指标统计或问题识别；
- 不实现 `packages/browser` 性能事实观测能力、`packages/plugin-performance` 或任何 Core 插件；
- 不实现网络传输、队列、批量、重试或持久化；
- 不实现数据接入、数据处理、服务端、数据库、管理平台、CI、发布、容器、IaC 或云资源；
- 不建立通用 Schema DSL、注册器、事件总线、转换框架、`utils`、`helpers`、`common` 或 `misc`。

## 3. 与公共事件信封的关系

### 3.1 单一信封和版本来源

性能事件不创建第二套信封或协议版本。所有性能事件必须满足：

```ts
export type PerformanceEventEnvelope = EventEnvelope & {
  readonly eventType: typeof EventType.Performance;
  readonly body: PerformanceEventBody;
};
```

`protocolVersion`、`eventId`、`eventType`、`occurredAt` 和通用正文资源边界继续由现有 `parseEventEnvelope(input: unknown)` 校验。`occurredAt` 继续表示大于 `0` 且不超过 `Number.MAX_SAFE_INTEGER` 的 Unix epoch 毫秒安全整数；性能正文不得复制协议版本或事件 ID。

`EventType.Performance` 表示性能事件类别，与错误正文中的 `category` 无关。性能正文与 `error`、`request` 或 `resource` 信封组合时必须返回 `event_type_mismatch`。

### 3.2 解析层次

- `parseEventEnvelope` 继续只证明公共信封和通用资源边界有效，成功结果的 `body` 保持 `unknown`；
- `parsePerformanceEventBody` 证明一个值符合本文的精确性能正文；
- `parsePerformanceEventEnvelope` 先复用 `parseEventEnvelope`，再校验 `EventType.Performance` 和精确性能正文；
- 消费者只有在 `parsePerformanceEventEnvelope` 成功后，才能把 `body` 视为 `PerformanceEventBody`。

## 4. 完整公共 TypeScript 契约

### 4.1 常量、枚举和限制

```ts
export const PerformanceMetricCategory = Object.freeze({
  readonly Page: 'page',
} as const);
export type PerformanceMetricCategory =
  (typeof PerformanceMetricCategory)[keyof typeof PerformanceMetricCategory];

export const PerformanceMetricName = Object.freeze({
  readonly Lcp: 'lcp',
  readonly Inp: 'inp',
  readonly Cls: 'cls',
  readonly PageLoad: 'page_load',
} as const);
export type PerformanceMetricName =
  (typeof PerformanceMetricName)[keyof typeof PerformanceMetricName];

export const PerformanceMetricUnit = Object.freeze({
  readonly Millisecond: 'millisecond',
  readonly Ratio: 'ratio',
} as const);
export type PerformanceMetricUnit =
  (typeof PerformanceMetricUnit)[keyof typeof PerformanceMetricUnit];

export const PERFORMANCE_EVENT_LIMITS = Object.freeze({
  readonly maxMetricNameLength: 64,
  readonly maxValueSafeInteger: 2147483647,
  readonly maxRatioValue: 1,
  readonly maxDurationMs: 86400000,
} as const);
```

枚举值只在上述常量中定义。实现、样本和消费者使用常量，不散落大小写不同或同义的魔法字符串。

### 4.2 性能正文

```ts
export interface PerformanceEventBody {
  readonly metricCategory: PerformanceMetricCategory;
  readonly metricName: PerformanceMetricName;
  readonly value: number;
  readonly unit: PerformanceMetricUnit;
  readonly startedAt: number;
  readonly durationMs?: number;
}

export interface PerformanceEventBodyParseSuccess {
  readonly success: true;
  readonly data: PerformanceEventBody;
}

export type PerformanceEventBodyParseFailure = EventEnvelopeParseFailure;
export type PerformanceEventBodyParseResult =
  PerformanceEventBodyParseSuccess | PerformanceEventBodyParseFailure;

export interface PerformanceEventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: PerformanceEventEnvelope;
}

export type PerformanceEventEnvelopeParseFailure = EventEnvelopeParseFailure;
export type PerformanceEventEnvelopeParseResult =
  PerformanceEventEnvelopeParseSuccess | PerformanceEventEnvelopeParseFailure;
```

### 4.3 解析函数

```ts
export function parsePerformanceEventBody(input: unknown): PerformanceEventBodyParseResult;
export function parsePerformanceEventEnvelope(input: unknown): PerformanceEventEnvelopeParseResult;
```

两个函数均为同步、确定性、非抛出解析入口。它们不记录输入，不修改输入，不调用浏览器或 Node 专属 API。普通非法输入返回 `success: false`；只有程序缺陷或运行时自身不可恢复错误可以抛出。

成功结果由解析器新建。调用方在解析后修改原输入不会改变成功结果。

### 4.4 共享样本

以下内容只从 `@aurora/event-schema/contract-testkit` 导出：

```ts
export interface ValidPerformanceEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: PerformanceEventEnvelope;
}

export interface InvalidPerformanceEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

export interface BoundaryPerformanceEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: PerformanceEventEnvelope;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

export const validPerformanceEventSamples: readonly ValidPerformanceEventSample[];
export const invalidPerformanceEventSamples: readonly InvalidPerformanceEventSample[];
export const boundaryPerformanceEventSamples: readonly BoundaryPerformanceEventSample[];
```

样本使用固定合成域名、编号和文本，不含真实 Cookie、Token、Authorization、密码、请求/响应正文、表单、DOM、页面文本、用户输入、Storage、IP 或个人信息。

## 5. 字段语义

最小合法正文为：

```json
{
  "metricCategory": "page",
  "metricName": "lcp",
  "value": 2500,
  "unit": "millisecond",
  "startedAt": 1800000005000
}
```

### 5.1 metricCategory

- 必填，只允许 `page`；
- 大小写敏感；小写或未知类别返回 `invalid_enum`；
- 表示指标所属的性能类别。PRD 5.1.9 定义的是"页面性能"，因此第一版只批准 `page` 类别；`resource`、`navigation`、`custom` 等类别不被本增量支持。

### 5.2 metricName

- 必填，只允许 PRD 5.1.9 明确批准的四个指标名：
  - `lcp`：Largest Contentful Paint，最大内容绘制时间（毫秒）；
  - `inp`：Interaction to Next Paint，交互到下一次绘制（毫秒）；
  - `cls`：Cumulative Layout Shift，累积布局偏移（无单位比率）；
  - `page_load`：页面加载耗时（毫秒）；
- 大小写敏感；未知或未批准指标名返回 `invalid_enum`；
- 任何其他 Web Vitals 或自定义指标名不得进入本增量。

### 5.3 value

- 必填，有限数值；
- `unit === 'millisecond'` 时：必须是 `0..PERFORMANCE_EVENT_LIMITS.maxValueSafeInteger` 的安全整数（非负毫秒）；
- `unit === 'ratio'` 时：必须是 `0..PERFORMANCE_EVENT_LIMITS.maxRatioValue` 的有限非负数（CLS 比率，不要求整数）；
- `NaN`、`Infinity`、负数或越界数值返回 `invalid_number`；
- `0` 是合法值（零耗时/零偏移仍可表达）。

### 5.4 unit

- 必填，只允许 `millisecond` 或 `ratio`；
- 大小写敏感；未知单位返回 `invalid_enum`；
- `unit` 与 `value` 独立校验，不做跨字段一致性判断（生产者按 PRD 指标语义提供一致的单位与数值）。

### 5.5 startedAt

- 必填，正安全整数，Unix epoch 毫秒；
- 表示被监控性能测量周期的开始时间，与 `occurredAt`（事件产生时间）独立；批次延迟不应改变 `startedAt`；
- 非正数、非安全整数或非数字返回 `invalid_timestamp`。

### 5.6 durationMs

- 可选；存在时必须是 `0..PERFORMANCE_EVENT_LIMITS.maxDurationMs` 的安全整数毫秒；
- 表示测量周期的持续时间；第一版可由生产者省略（如单点测量）；
- 非数字、非有限、负数、非安全整数或超出上限返回 `invalid_number`。

### 5.7 指标-单位-数值的语义映射

| metricName | unit 语义          | value 语义                                    | startedAt 语义                 | durationMs 语义       |
| ---------- | ------------------ | --------------------------------------------- | ------------------------------ | --------------------- |
| `lcp`      | `millisecond`      | 最大内容绘制时间（安全整数毫秒）              | LCP 记录开始时间               | 可选，通常省略        |
| `inp`      | `millisecond`      | 交互到下一次绘制（安全整数毫秒）              | 交互测量开始时间               | 可选，通常省略        |
| `cls`      | `ratio`            | 累积布局偏移（0..1 有限非负比率）             | CLS 观测开始时间               | 可选，通常省略        |
| `page_load`| `millisecond`      | 页面加载耗时（安全整数毫秒）                  | 页面导航开始时间               | 可选，通常省略        |

第一版不强制 `metricName` 与 `unit` 的跨字段一致性（例如 `lcp` 配 `ratio` 由生产者在 SDK 采集层负责正确性），但样本和文档只展示 PRD 批准的正确组合。

<!-- contract-example:valid-performance-spec -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-spec-performance-valid",
  "eventType": "performance",
  "occurredAt": 1800000005100,
  "body": {
    "metricCategory": "page",
    "metricName": "lcp",
    "value": 2500,
    "unit": "millisecond",
    "startedAt": 1800000005000
  }
}
```

<!-- contract-example:invalid-performance-spec -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-spec-performance-invalid",
  "eventType": "performance",
  "occurredAt": 1800000005101,
  "body": {
    "metricCategory": "page",
    "metricName": "fcp",
    "value": 1000,
    "unit": "millisecond",
    "startedAt": 1800000005001
  }
}
```

该输入返回 `invalid_enum`，issue 不包含指标值。

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
- 完整资源 URL、查询参数或片段；
- 完整表单、完整 DOM、页面文本或用户输入；
- 浏览器 Storage；
- 用户指纹、设备信息或原始 IP；
- 任意无限递归对象。

既有通用正文校验继续按 ASCII 小写拒绝 `authorization`、`cookie`、`password`、`requestbody`、`responsebody`、`formdata`、`dom`、`consolelog` 和 `ipaddress` 字段。性能正文采用精确字段允许列表，因此其他未声明上下文字段也被拒绝。

校验 issue 只包含稳定 code、字段路径和固定消息，不回显非法字段值。实现不输出生产路径控制台日志。

## 8. 稳定校验错误

本文不增加新的 `EventSchemaIssueCode`。性能正文复用现有稳定 code：

- `missing_required_field`：必填字段缺失；
- `invalid_type`：字段类型错误、非普通对象；
- `unknown_field`：未知正文字段；
- `invalid_enum`：未知指标类别、未知指标名或未知单位；
- `string_empty`：必填字符串为空；
- `invalid_number`：`value` 非有限/负数/越界，或 `durationMs` 非法；
- `invalid_timestamp`：`startedAt` 非正安全整数；
- `event_type_mismatch`：精确性能正文与非 `EventType.Performance` 信封组合。

issue 按稳定遍历顺序返回，最多 `EVENT_SCHEMA_LIMITS.maxIssues` 条。issue 的 `path` 对正文从 `['body']` 开始；独立调用 `parsePerformanceEventBody` 和调用完整性能信封解析器时使用相同路径。

## 9. 运行时校验顺序

`parsePerformanceEventEnvelope` 固定执行：

1. 调用现有 `parseEventEnvelope(input)`；
2. 原信封失败时原样返回稳定 issue；
3. 校验 `eventType === EventType.Performance`；
4. 调用 `parsePerformanceEventBody(envelope.body)`；
5. 执行精确字段允许列表和字段校验；
6. 返回新建的 `PerformanceEventEnvelope`。

该顺序保证协议版本、时间戳、通用限制和禁止字段仍只有一个来源。性能解析器不复制 `parseEventEnvelope` 的协议版本或时间校验。

## 10. 兼容规则

- 当前仍只支持协议版本 `1`；
- 本增量是对现有信封 API 的加法：`parseEventEnvelope` 的签名、`EventEnvelope.body: unknown` 和既有样本入口保持不变；
- `parsePerformanceEventEnvelope` 对正文使用严格字段允许列表；
- 增加新的可选字段只有在旧解析器也能接受时才是同版本兼容；当前严格解析器不会接受未知字段，因此不能把任意新字段描述为无条件兼容；
- 删除字段、改变含义或类型、把可选字段改为必填、增加旧解析器不认识的必填字段、改变现有枚举含义均不兼容；
- 增加性能指标类别、指标名或单位会被旧解析器拒绝，必须先完成兼容评估；需要不兼容变化时创建 accepted ADR、迁移说明和旧版本处理方案；
- 不创建版本 `0` 转换器，也不对版本 `2` 猜测降级。

## 11. 公共出口和依赖边界

### 11.1 根出口

`@aurora/event-schema` 根入口新增导出：

- `PerformanceMetricCategory`、`PerformanceMetricName`、`PerformanceMetricUnit`、`PERFORMANCE_EVENT_LIMITS`；
- 本文全部公共正文、信封和解析结果类型；
- `parsePerformanceEventBody` 和 `parsePerformanceEventEnvelope`。

根入口不导出私有字段解析器、单位映射函数或样本。

### 11.2 测试入口

`@aurora/event-schema/contract-testkit` 在保留既有信封、错误与请求样本的同时增加本文三组性能样本和对应样本类型。不增加第三个子路径出口。

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
│   ├── index.ts                      # 根出口新增性能导出
│   ├── performance-event-body.ts     # parsePerformanceEventBody
│   ├── performance-event-envelope.ts # parsePerformanceEventEnvelope
│   ├── performance-event-types.ts    # 常量、限制、正文/信封/结果类型
│   └── contract-testkit/
│       ├── boundary-performance-event-samples.ts
│       ├── invalid-performance-event-samples.ts
│       ├── valid-performance-event-samples.ts
│       └── index.ts                  # 新增性能样本导出
└── test/
    ├── performance-event-body.test.ts
    ├── performance-event-envelope.test.ts
    ├── performance-event-types.test.ts
    ├── package-entry.test.ts          # 扩展根入口断言
    ├── architecture-boundary.test.ts  # 扩展禁止项
    └── consumers/
        ├── ingestion-performance-event.contract.test.ts
        ├── processing-performance-event.contract.test.ts
        └── sdk-performance-event.contract.test.ts
```

现有文件继续保留原职责。新增文件各自只处理名称所示的单一协议职责，不创建杂物目录或通用 Schema 框架。

## 13. 测试范围

### 13.1 公共类型与出口

- 运行时常量和解析器可从包根导入；
- 全部公共类型由只使用包根的 TypeScript 消费者编译证明；
- 样本只从 `contract-testkit` 导入；
- 私有路径不可导入；
- 构建产物只暴露声明的两个入口，不泄露内部解析器；
- 性能解析器、单位映射函数和样本不进入根出口。

### 13.2 指标类别、名称和单位

- `page` 类别；
- 四个批准指标名（`lcp`、`inp`、`cls`、`page_load`）；
- 两个单位（`millisecond`、`ratio`）；
- 小写、未知值、空值、显式 `null`；
- 未批准指标名（如 `fcp`、`ttfb`、`custom_metric`）返回 `invalid_enum`。

### 13.3 数值与时间

- `millisecond` 合法值（含 `0`、`maxValueSafeInteger`）；
- `millisecond` 越界、负数、非整数、`NaN`、`Infinity`；
- `ratio` 合法值（含 `0`、`1`）；
- `ratio` 越界（`> 1`）、负数、`NaN`、`Infinity`；
- 合法 `startedAt`；
- `startedAt` 非数字、零、负数、非整数、非安全整数；
- 合法 `durationMs`（含 `0`、`maxDurationMs`）；
- `durationMs` 非法、负数、非安全整数、超出上限、显式 `null`；
- 缺失 `durationMs` 合法。

### 13.4 正文形状与信封组合

- 缺失每个必填字段；
- 未知正文字段；
- 性能正文与 `EventType.Error`、`EventType.Request`、`EventType.Resource` 不匹配；
- 错误/请求正文与 `EventType.Performance` 不匹配；
- 版本 `0`、`2` 和非法时间戳；
- 通用信封 issue 原样保留；
- 解析结果不保留输入对象引用；
- 输入不被修改。

### 13.5 契约样本与消费者

- 每类字段均有合法、非法和边界样本；
- SDK 消费者验证所有合法性能样本；
- 数据接入消费者验证所有非法性能样本和稳定 code；
- 数据处理消费者验证全部边界性能样本；
- README 和正式协议文档中的 JSON 示例由测试提取并执行；
- 测试只验证公共行为，不断言私有函数调用次数。

## 14. 覆盖率与质量门禁

`packages/event-schema` 是关键核心包，维持：

- lines 不低于 `85%`；
- branches 不低于 `80%`；
- functions 不低于 `85%`；
- statements 不低于 `85%`。

阈值继续由 `packages/event-schema/vitest.config.ts` 固定。不得排除具有分支逻辑的新文件，不得降低门槛，不得删除或弱化失败测试。

实施必须新鲜运行受影响单测、三类性能消费者契约、既有错误与请求契约回归、严格类型检查、Lint、覆盖率、构建、包入口、Workspace 边界、文档示例、根 `check:ci` 和 `git diff --check`。本协议包不需要真实浏览器测试，因为它没有 DOM、监听器或宿主副作用；Browser 的 Chromium 门禁不因本增量重复执行。

## 15. 代码规范落实

- 继承根 TypeScript `strict`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 和其他严格选项；
- 所有外部输入为 `unknown`，所有公共函数显式声明参数和返回类型；
- 禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore` 和静默 catch；
- 文件使用 `kebab-case`，类型/接口使用 `PascalCase`，函数/变量使用 `camelCase`；
- 布尔变量使用 `is`、`has`、`can` 或 `should` 前缀；
- 文件和函数保持单一职责，不创建 `utils`、`helpers`、`common` 或 `misc`；
- 公共 API 保持最小，私有单位和数值解析函数不导出；
- 不跨包访问 `src`、`internal` 或未导出路径；
- 指标类别、名称和单位使用唯一常量；
- 校验失败返回稳定 issue，不静默吞掉，不记录输入；
- 样本和文档不包含真实敏感数据；
- 不修改调用方输入，不污染宿主页面；
- 不复制错误/请求契约的字段校验或 URL 校验逻辑，只复用中立助手；
- 不增加当前需求未使用的抽象。

宿主监听器释放、多实例状态、浏览器原生对象恢复、Core 插件生命周期、队列重试和生产日志级别规则不适用，因为本模块没有监听器、实例、宿主对象、插件、队列、重试或日志器。计划必须保持这些能力不存在。

## 16. 文档与 ADR 同步

实施计划必须同步：

- `packages/event-schema/README.md`：从"只有错误与请求事件契约"更新为"错误、请求与性能事件契约第一增量"，列出性能 API、指标范围、限制、隐私、错误、样本和排除范围；
- `docs/protocol/event-envelope-v1.md`：链接本文并明确 `parseEventEnvelope` 与精确性能解析器的层次；
- `docs/README.md`：加入本文并保持其他具体事件、批次和消费者实现缺失；
- `docs/architecture/system-overview.md` 与 `docs/architecture/sdk-architecture.md`：只记录性能事件机器契约已存在，性能事实观测能力、性能插件和传输仍不存在；
- `docs/architecture/formalization-readiness.md`：把 A1 更新为信封基础加错误、请求与性能正文第一增量，其他正文、批次、兼容转换和真实系统消费者仍受阻；
- ADR-005：只追加单一来源、性能 Schema、样本和消费者契约实施证据，保持 `accepted / in-progress`；
- ADR-006：只追加协议层零本地依赖、无 DOM/Node 运行时依赖、公开入口和私有路径负例证据，保持 `accepted / in-progress`；
- ADR-003：性能协议不是性能观测或性能插件，只在实施记录中澄清插件前置契约已具备，保持 `accepted / in-progress`；
- ADR-007：工具和命令不变，保持 `accepted / implemented`；
- `AGENTS.md` 与 `AURORA_RULES.md`：只有代码和完整门禁实际通过后才更新阶段快照；
- 根 README：只有当前实现状态描述受影响时才更新，不声称性能观测、性能插件、CI、发布或服务端存在。

本文和实施计划本身不得写入实施证据，不得修改 ADR 决策结论或实施状态。

## 17. 明确排除范围

- 浏览器性能事实观测、`PerformanceObserver`、任何性能 API 读取；
- `packages/browser` 性能事实源、`packages/plugin-performance`；
- 性能去重、聚合、指标统计、采样率和问题识别；
- 资源计时明细、导航计时分解、长任务、网络计时、TTFB/FCP/FID/TBT 等未批准指标；
- 完整资源 URL、路径动态段、查询参数、片段、DOM、页面文本、用户输入；
- 发生页面、运行环境、发布版本和用户上下文；
- breadcrumb、Session、用户、项目或 release 上下文；
- 请求/响应正文、请求头、响应头、Cookie、凭据和尺寸；
- 性能、通用资源或行为事件正文之外的任何新正文；
- 批次、接收、传输、采样、队列、重试和持久化；
- 接入、处理、服务端、数据库、管理平台；
- CI、发布、容器、IaC 和云资源。

## 18. 后续模块衔接边界

`@aurora/browser` 性能事实观测能力（`docs/sdk/browser-performance-source.md`）只有在本文契约实际实施并通过包入口与契约测试后，才可在独立规格中规划。该能力可以：

- 使用 approved 浏览器性能 API（如 `PerformanceObserver`）读取或订阅 PRD 5.1.9 批准的四项页面性能事实；
- 从 `@aurora/event-schema` 根入口导入本文常量、类型和解析器；
- 把最小性能事实交给性能采集插件转换并提交。

性能采集插件（`docs/sdk/performance-capture-plugin.md`）只消费 Browser 性能事实，只使用本文性能契约，只通过 Core 草稿入口提交，不直接读取性能 API，不复制指标枚举或数值校验。本文不定义性能观测生命周期、监听器、诊断、采样策略或 Core 扩展。若浏览器性能观测涉及尚未 accepted 的长期架构决策，性能观测规格必须先建立 proposed ADR，并在 accepted 前停止正式实施。

## 19. ADR 判断

本增量执行 accepted ADR-005 的协议单一来源、运行时校验、兼容规则和共享样本，执行 accepted ADR-006 的底层依赖和自动边界约束，并复用 accepted/implemented ADR-007 的现有工具入口。它为 accepted ADR-003 的性能插件分层提供前置协议，但不实施性能观测或性能插件。

四个性能指标名、一个类别、两个单位、字段组织、限制数值和私有解析函数没有改变五系统边界、依赖方向或长期兼容策略，不创建新 ADR。若要改变协议版本策略、允许协议依赖业务包、删除或重释公共字段、放宽隐私默认值，或把未批准性能指标、采样率或聚合逻辑移入协议层，必须先有新的 accepted ADR。

## 20. 规格自检

- 指标类别、名称、单位、数值、时间和持续时间均有精确正文、成功、失败和边界语义；
- 所有公共运行时值、类型、函数和样本均有完整签名；
- `EventEnvelope`、`EventType.Performance`、协议版本和通用限制没有复制来源；
- 指标范围严格限定为 PRD 5.1.9 批准的 LCP、INP、CLS、页面加载耗时，未纳入任何未批准指标；
- 采样率（PRD 默认 10%）没有进入协议层；
- 解析不修改输入，也不保留输入可变对象引用；
- 错误契约与请求契约共用中立助手，性能契约只复用，不复制；
- 没有 Core、Browser、插件、DOM、Performance API 或 Node 运行时依赖；
- 没有无界值、敏感示例、占位表达或未定义接口；
- 没有性能观测、采样、聚合、网络、队列、服务端或基础设施能力；
- 覆盖率、消费者契约、包入口、Workspace 边界和文档同步均有明确门禁；
- 现有 ADR 决策和状态没有因本文改变。
