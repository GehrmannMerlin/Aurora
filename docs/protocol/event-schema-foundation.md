---
title: Aurora event-schema 协议基础第一增量
status: approved
owner: protocol
created: 2026-07-30
last-reviewed: 2026-07-30
applies-to: packages/event-schema 的首个可独立验收增量、事件公共信封、版本识别、运行时边界校验与共享契约样本
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - ../architecture/system-overview.md
  - ../architecture/sdk-architecture.md
  - ../architecture/monorepo-and-build.md
  - ../architecture/formalization-readiness.md
  - ../testing/test-strategy.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../adr/ADR-007-workspace-package-and-task-tooling.md
supersedes: none
review-cycle: protocol-or-public-api-change
---

# Aurora event-schema 协议基础第一增量

## 1. 定位与状态

本文冻结 `packages/event-schema` 的首个可独立实现、测试和评审的协议增量。该增量只建立公共包、协议版本、公共事件信封、运行时边界校验、稳定错误结果和共享契约样本；它不定义任何具体错误、请求、性能或资源事件正文。

本文从 approved PRD、架构/代码/测试/文档规范和 accepted ADR-005/006/007 推导。用户已授权在 approved 范围内采用最小、保守、类型安全且可回滚的普通实现细节，因此本文状态为 `approved`。批准表示可以生成一份实施计划，不表示包、Schema、样本或测试已经存在。

## 2. 方案比较与选择

### 2.1 方案 A：一次完成全部事件类型

该方案会同时定义错误、请求、性能、资源及未来行为事件的全部正文。现有资料只批准了采集范围、隐私边界和高层语义，没有提供每类事件的完整机器字段、精确限制和兼容迁移，因此该方案会虚构产品字段并扩大模块范围，不采用。

### 2.2 方案 B：只创建空包和构建配置

该方案不产生可被 SDK、接入和处理共同消费的协议行为，也无法满足 ADR-005 的运行时校验和共享契约样本要求，不具备独立验收价值，不采用。

### 2.3 方案 C：公共事件信封基础第一增量

该方案建立可发布形态但暂时私有的 `@aurora/event-schema` 包，定义版本 `1`、四个已有 PRD 依据的事件类别、稳定事件编号、真实发生时间、保持为 `unknown` 的事件正文、资源边界扫描、稳定解析结果和共享样本。具体事件正文必须在后续独立规格中收口。

采用方案 C。它先提供消费者可以共同使用的最小机器边界，同时不把通用正文容器伪装成完整事件 Schema。

## 3. 模块职责与非职责

### 3.1 职责

- 建立私有 Workspace 包 `@aurora/event-schema` 和唯一根公开入口；
- 定义当前协议主版本、受支持版本集合和版本识别函数；
- 定义 `error`、`request`、`performance`、`resource` 四个已批准事件类别；
- 定义并运行时校验公共事件信封；
- 对不可信正文执行字符串、数组、对象键数、对象深度、非法值、循环引用和明确禁止字段的有界扫描；
- 以稳定可判别联合返回成功或失败，不因输入不合法抛出异常；
- 提供合法、非法和边界样本，供 SDK、数据接入和数据处理的契约测试复用；
- 提供 README、协议文档、文档示例验证、包入口测试、覆盖率和架构边界负例。

### 3.2 非职责

- 不定义错误、请求、性能或资源事件的具体正文属性；
- 不定义上报批次、压缩、HTTP 路径、鉴权、接收结果、错误码或重试协议；
- 不实现 SDK 采集、脱敏、采样、队列或网络发送；
- 不实现接入、处理、数据库、队列、对象存储、管理平台或公开 API；
- 不提供事件兼容转换，因为当前不存在可迁移的历史协议版本；
- 不生成 JSON Schema、OpenAPI 或文档站点；
- 不发布 npm 制品，不引入版本发布工具、CI 工作流、云资源或基础设施；
- 不提前建立通用 Schema 抽象、注册器、插件机制、`utils`、`helpers` 或 `common` 目录。

## 4. Consumes 与 Produces

### 4.1 Consumes

- 已实现的 pnpm Workspace、严格 TypeScript、Vitest、ESLint、Prettier 和 `@aurora/workspace-policy`；
- accepted ADR-005 的协议单一来源、运行时校验和共享契约样本约束；
- accepted ADR-006 的公共协议位于依赖底层、禁止私有深导入和自动边界约束；
- accepted/implemented ADR-007 的根命令名称、冻结安装和原生 pnpm task 入口；
- PRD 中事件稳定编号、真实发生时间、四类监控数据、安全默认采集和禁止字段边界；
- 测试规范中关键核心包 85% 行覆盖率、80% 分支覆盖率及合法/非法/边界契约要求。

### 4.2 Produces

- 私有包 `@aurora/event-schema`；
- 根入口 `@aurora/event-schema` 和测试入口 `@aurora/event-schema/contract-testkit`；
- 可构建的 ESM JavaScript 与 `.d.ts`；
- 公共事件信封、版本/事件类型常量、解析函数和稳定错误类型；
- 跨消费者共享的合法、非法和边界样本；
- 协议基础文档、模块 README 和可执行文档示例；
- 对协议层零本地依赖、根出口和私有路径的自动验证。

## 5. 输入、输出与公共导出

### 5.1 公共常量与类型

```ts
export const CURRENT_PROTOCOL_VERSION: 1;
export const SUPPORTED_PROTOCOL_VERSIONS: readonly [1];
export type ProtocolVersion = 1;

export const EventType: {
  readonly Error: 'error';
  readonly Request: 'request';
  readonly Performance: 'performance';
  readonly Resource: 'resource';
};
export type EventType = (typeof EventType)[keyof typeof EventType];

export const EVENT_SCHEMA_LIMITS: {
  readonly maxEventIdLength: 128;
  readonly maxStringLength: 4096;
  readonly maxArrayLength: 100;
  readonly maxObjectKeys: 100;
  readonly maxObjectDepth: 8;
  readonly maxIssues: 50;
};

export interface EventEnvelope {
  readonly protocolVersion: ProtocolVersion;
  readonly eventId: string;
  readonly eventType: EventType;
  readonly occurredAt: number;
  readonly body: unknown;
}
```

`occurredAt` 是 Unix epoch 毫秒整数，必须大于 `0` 且不超过 `Number.MAX_SAFE_INTEGER`。本增量不根据当前系统时钟拒绝未来时间，因为 PRD 已声明客户端时钟可能异常，服务端校正语义属于后续接入/处理协议。

`body` 保持 `unknown`。通过信封校验只证明公共头字段、整体资源上限和禁止字段符合本规格，不证明具体事件正文语义有效；SDK、接入或处理不得把该结果冒充完整事件校验。

### 5.2 解析结果

```ts
export type EventSchemaIssueCode =
  | 'missing_required_field'
  | 'invalid_type'
  | 'unknown_field'
  | 'invalid_enum'
  | 'string_too_long'
  | 'array_too_large'
  | 'object_too_large'
  | 'object_too_deep'
  | 'cyclic_reference'
  | 'invalid_number'
  | 'invalid_timestamp'
  | 'unknown_event_type'
  | 'unsupported_protocol_version'
  | 'forbidden_field';

export interface EventSchemaIssue {
  readonly code: EventSchemaIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export interface EventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: EventEnvelope;
}

export interface EventEnvelopeParseFailure {
  readonly success: false;
  readonly issues: readonly EventSchemaIssue[];
}

export type EventEnvelopeParseResult = EventEnvelopeParseSuccess | EventEnvelopeParseFailure;

export function isSupportedProtocolVersion(input: unknown): input is ProtocolVersion;
export function isEventType(input: unknown): input is EventType;
export function parseEventEnvelope(input: unknown): EventEnvelopeParseResult;
```

验证失败返回一个或多个按遍历顺序稳定排列的 issue，最多 `50` 个。函数不得记录输入、不得输出秘密、不得静默返回 `null`，也不得因普通非法输入抛出异常。

### 5.3 契约测试入口

```ts
export interface InvalidEventEnvelopeSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

export interface BoundaryEventEnvelopeSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

export const validEventEnvelopeSamples: readonly EventEnvelope[];
export const invalidEventEnvelopeSamples: readonly InvalidEventEnvelopeSample[];
export const boundaryEventEnvelopeSamples: readonly BoundaryEventEnvelopeSample[];
```

样本只使用合成标识和值，不含真实用户数据、Token、Cookie、密码、请求/响应正文或其他敏感信息。测试入口只供契约测试使用，不在根入口重复导出。

## 6. 依赖和文件边界

- `@aurora/event-schema` 不得依赖任何本地 Workspace 包或业务模块；
- 首增量不增加运行时依赖，验证器使用包内小型、职责明确的 TypeScript 实现；
- 只允许现有 TypeScript/Vitest 工具和精确匹配 Vitest 的 `@vitest/coverage-v8` 作为开发依赖；
- 消费者只能导入 `@aurora/event-schema` 或 `@aurora/event-schema/contract-testkit`；
- 禁止跨包导入 `src`、`internal`、测试文件或未导出的子路径；
- `@aurora/workspace-policy` 必须新增协议层零本地依赖规则和对应负例，不能只依靠人工评审；
- 包保持 `private: true`、版本 `0.0.0`，直到版本/发布策略另行 approved；公开导出是代码边界，不表示已经公开发布。

## 7. 协议版本与兼容性

- 当前且唯一受支持的协议版本是数字字面量 `1`；
- 解析器只接受 `SUPPORTED_PROTOCOL_VERSIONS` 中的精确值，不对未知版本猜测或降级；
- 同一版本内新增可选字段通常兼容，删除字段、改变含义/类型、把可选改必填或改变枚举含义均不兼容；
- 不兼容变化必须创建新 ADR、迁移说明和旧版本处理方案，不得静默修改版本 `1`；
- 当前没有历史协议版本，因此不得虚构 `v0` 转换器。兼容测试使用两组版本 `1` 信封：旧形态只含必填字段，新形态在 `body` 中增加受允许的可选数据，两者均通过公共头与资源边界；版本 `0` 和 `2` 均明确拒绝；
- 未来增加受支持版本时，必须同时更新版本常量、解析、共享样本、协议文档、迁移/发布文档和消费者组合测试。

## 8. 运行时校验边界

### 8.1 信封字段

- 输入首先作为 `unknown`；
- 顶层必须是普通对象，且只允许 `protocolVersion`、`eventId`、`eventType`、`occurredAt`、`body`；
- 五个字段全部必填；
- `eventId` 必须是长度 `1..128` 的字符串，不在本增量强制 UUID 格式；
- `eventType` 必须是四个公共常量之一，其他字符串返回 `unknown_event_type`；
- `protocolVersion` 非数字返回 `invalid_type`，数字但不支持返回 `unsupported_protocol_version`；
- `occurredAt` 类型错误返回 `invalid_type`，非有限/非整数/非安全整数/小于等于零返回 `invalid_timestamp`；
- 顶层多余字段返回 `unknown_field`。

### 8.2 正文资源边界

- `body` 可以是 JSON 可表达的 `null`、布尔值、有限数字、字符串、数组或普通对象；
- 字符串最长 `4096` 个 UTF-16 code units；
- 数组最多 `100` 项；
- 单个对象最多 `100` 个自有可枚举键；
- 根 `body` 深度为 `0`，向数组项或对象属性进入一层加 `1`，最大深度 `8`；
- `NaN`、正负 Infinity、`bigint`、`symbol`、函数、`undefined`、Date、Map、Set、类实例和其他非普通对象均拒绝；
- 循环引用返回 `cyclic_reference`；
- 超大数组或对象只报告上限问题，不继续遍历超出允许范围的内容；达到 `maxIssues` 后停止收集，防止恶意输入制造无界错误列表。

### 8.3 禁止字段

正文任意层级的字段名按 ASCII 小写比较，以下名称直接返回 `forbidden_field`：

```text
authorization
cookie
password
requestbody
responsebody
formdata
dom
consolelog
ipaddress
```

该列表只落实 PRD 已明确默认禁止的高风险原始内容，不是完整脱敏器。未来具体事件 Schema 仍需使用允许列表定义字段，SDK 和服务端隐私过滤也不能被本检查替代。

## 9. 文件与包结构

```text
packages/event-schema/
├── README.md
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── src/
│   ├── constants.ts
│   ├── event-envelope.ts
│   ├── event-types.ts
│   ├── index.ts
│   ├── validation-issues.ts
│   ├── value-boundaries.ts
│   └── contract-testkit/
│       ├── boundary-samples.ts
│       ├── index.ts
│       ├── invalid-samples.ts
│       └── valid-samples.ts
└── test/
    ├── consumers/
    │   ├── ingestion-consumer.contract.test.ts
    │   ├── processing-consumer.contract.test.ts
    │   └── sdk-consumer.contract.test.ts
    ├── documentation-contract.test.ts
    ├── event-envelope.test.ts
    ├── package-entry.test.ts
    ├── value-boundaries.test.ts
    └── version-and-event-type.test.ts
```

每个文件只承担表中名称对应的单一职责。不得创建 `utils`、`helpers`、`common` 或提前抽象的通用 Schema 注册框架。

## 10. 测试和质量门禁

### 10.1 必测行为

- 所有四类合法信封样本；
- 必填字段缺失、类型错误、非法枚举、未知事件类型和不支持协议版本；
- 空/最大/超长 `eventId` 与字符串；
- 最大/超大数组和对象键数；
- 深度 `8` 合法、深度 `9` 拒绝；
- 非法时间戳，包括零、负数、小数、Infinity 和超过安全整数；
- 非 JSON 值、非普通对象和循环引用；
- 每个禁止字段在嵌套正文中被拒绝；
- 顶层未知字段；
- 同版本旧/新形态兼容和版本 `0`/`2` 拒绝；
- 根入口与 `contract-testkit` 入口、构建产物和未导出私有路径；
- SDK、接入和处理三个测试消费者使用同一组公开样本；
- `event-schema` 依赖业务包的架构负例；
- README 和协议文档中的 JSON 示例由测试提取并通过解析器验证；
- 验证对外结果和 issue，不以内部函数调用次数作为断言。

### 10.2 覆盖率

- `src/**/*.ts` 行覆盖率不低于 `85%`；
- 分支覆盖率不低于 `80%`；
- 函数和语句覆盖率同时不低于 `85%`，作为本包保守的可执行补充门槛；
- 阈值由 `packages/event-schema/vitest.config.ts` 固定并由包级 `test:coverage` 和根 `check:ci` 执行；
- 不得排除包含分支逻辑的文件来制造通过结果。

### 10.3 全量门禁

实施完成前必须新鲜运行：冻结安装、格式、Lint、严格类型检查、全部测试、覆盖率、架构边界、构建、包入口、文档示例和 `git diff --check`。任何失败都必须停止完成声明。

## 11. 代码规范逐项落实

- TypeScript 继承根 `strict`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 和其他严格选项；
- 禁止无说明 `any`；所有解析输入和样本输入先声明为 `unknown`；
- 所有公共函数显式声明参数和返回类型；
- 不使用 `Object`、`Function`、`Record<string, any>`、宽泛断言、双重断言、非空断言或 `@ts-ignore`；
- 普通文件全部 `kebab-case`；类型/接口使用 `PascalCase`；函数/变量使用 `camelCase`；全局不可变限制使用 `UPPER_SNAKE_CASE` 或语义明确的导出对象；
- 文件和函数保持单一职责；超过规范预警线时先按协议职责拆分；
- 不创建杂物型目录或提前通用抽象；
- 根公共 API 只导出消费者运行时所需内容，测试样本只从独立测试入口导出；
- 跨包只从包公开入口导入，禁止访问其他包的 `src`、`internal` 和私有路径；
- 事件类别和协议版本只来自导出常量，不使用魔法字符串；
- 非法输入以稳定 issue 返回，不能静默吞掉；测试失败和构建异常仍正常抛出并使命令非零；
- 实现不记录任何事件正文；README、协议示例和测试样本不含敏感数据；
- 不设计未获批准的事件注册器、转换框架、Schema DSL 或消费者适配抽象。

SDK 宿主生命周期、浏览器代理、插件释放、队列/重试和日志级别规则不适用于本协议基础包，因为本模块没有宿主副作用、浏览器 API、插件、队列、重试或日志实现；计划必须明确保持这些能力不存在，而不是伪造对应代码。

## 12. 文档同步

实施计划必须同步：

- `packages/event-schema/README.md`：定位、职责/非职责、公共入口、输入输出、依赖、错误、开发测试、当前协议版本、支持事件类别、校验方式、样本位置和变更流程；
- `docs/protocol/event-envelope-v1.md`：版本、信封字段、限制、禁止字段、合法/非法示例、错误语义和兼容规则；
- `docs/README.md`：在真实实现完成后链接模块 README 和协议文档；
- `docs/architecture/formalization-readiness.md`：只把 A1 的基础第一增量标记 implemented，完整具体事件 Schema、批次和消费者实现继续 blocked；
- ADR-005：实施后只能更新为 `in-progress`，因为完整事件类型、批次、兼容转换和真实消费者尚未实现；
- ADR-006：补充协议层零本地依赖的真实负例证据，状态仍为 `in-progress`；
- `AGENTS.md` 与 `AURORA_RULES.md`：仅在实施完成和全量验证后同步阶段与决策队列；
- 根 README：只在命令职责发生真实变化后更新，不能声称 CI 或业务消费者存在。

本规格和实施计划本身不修改 ADR 实施状态，也不把任何模块写成 implemented。

## 13. 当前明确排除范围

- 具体错误、Promise、框架、请求、资源、性能或行为事件正文；
- 用户上下文、匿名浏览器编号、breadcrumb、页面、浏览器、操作系统、release、environment、project、来源或采样字段；
- 批次、部分成功、接收状态、HTTP、鉴权、限流、重试、去重窗口和可靠缓冲；
- 兼容转换器、历史版本解析和跨主版本降级；
- JSON Schema/OpenAPI 生成、文档站点和代码生成；
- SDK Core、Browser、插件、React/Vue、数据接入、数据处理、服务端、数据库、队列、对象存储、管理平台、CI、发布、容器、IaC 和云基础设施。

## 14. ADR 判断

本增量执行 accepted ADR-005 的单一来源和兼容原则、accepted ADR-006 的底层依赖方向，以及 accepted ADR-007 的工程入口，不改变系统边界、模块职责、依赖方向或兼容策略。零运行时依赖、文件布局、私有函数和限制数值均为可回滚的普通实施细节，因此不创建新 ADR。

若后续要改变协议兼容策略、删除/重释公共字段、允许协议包依赖业务模块或进行公共不兼容变更，必须先按 ADR 规范创建并接受新的 ADR。

## 15. 规格自检

- 没有未决标记、伪代码或未决定字段；
- 所有公共类型、函数、常量和限制均有精确签名或数值；
- `body: unknown` 明确阻止消费者把本增量冒充完整事件 Schema；
- 每项职责、错误、边界、覆盖率和文档同步都有实施计划输入；
- 方案没有进入后续具体事件、SDK、接入、处理、服务端、CI 或基础设施；
- 现有 accepted ADR 的最终决策和实施状态均未改变。
