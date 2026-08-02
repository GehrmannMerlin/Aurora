---
title: Browser 错误采集插件第一增量
status: approved
implementation-status: implemented
owner: sdk
created: 2026-07-31
last-reviewed: 2026-07-31
applies-to:
  - packages/plugin-error
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../protocol/error-event-contract.md
  - browser-error-source.md
  - core-event-creation.md
  - sdk-core-foundation.md
  - ../architecture/sdk-architecture.md
  - ../testing/test-strategy.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
supersedes: none
review-cycle: error-plugin-public-api-or-host-safety-change
---

# Browser 错误采集插件第一增量

## 0. 实施证据（2026-07-31）

本增量已实施为真实私有包 `@aurora/plugin-error`，并通过以下新鲜验证：

- `pnpm --filter @aurora/plugin-error test`：10 个测试文件、38 个测试全部通过；
- `pnpm --filter @aurora/plugin-error test:coverage`：statements 94.57%、branches 91.95%、functions 100%、lines 94.91%（门禁 85/80/85/85）；
- `pnpm --filter @aurora/plugin-error test:package`：构建根入口只暴露 `ERROR_CAPTURE_PLUGIN_NAME`、`ErrorCaptureDiagnosticCode`、`ErrorCaptureDiagnosticOperation`、`createErrorCapturePlugin` 四个运行时值，私有子路径全部返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
- `pnpm --filter @aurora/plugin-error test:browser`：Playwright 5 个 Chromium 场景全部通过（三类错误各提交一次、宿主 handler 身份与事件默认行为不变、stop/destroy 释放、多实例隔离、内部失败隔离）；
- `pnpm --filter @aurora/plugin-error typecheck`（含 `tsconfig.no-dom.json`）与 `pnpm check:boundaries` 均无诊断；
- 体积近似：dist 运行时 JS 原始 12915 字节、gzip 2707 字节；该值是多文件 TypeScript 拼接的近似，非最终 tree-shaken 发布结果，标记 `requires-benchmark`。

## 1. 状态、范围与权威来源

本文冻结 `packages/plugin-error` 的浏览器错误采集插件第一增量。用户在本轮明确授权了模块职责、排除范围、上游接口和质量门禁，并授权普通接口名称、文件布局与私有实现采用最小、保守、类型安全、可测试和可回滚方案；本文没有增加产品配置或改变长期架构决策，因此状态为 `approved`。

本文只依赖以下已批准或已实施事实：

- `docs/protocol/error-event-contract.md` 已实施三类错误正文、公共限制与同步解析器；
- `docs/sdk/browser-error-source.md` 已实施三类只读错误源事实、原子订阅、取消和销毁；
- `docs/sdk/core-event-creation.md` 已实施最小事件草稿和由 Core 生成系统字段的提交边界；
- `docs/sdk/sdk-core-foundation.md` 已实施 `CorePlugin` 生命周期和异常隔离；
- ADR-003、ADR-005、ADR-006 为 `accepted / in-progress`；
- ADR-007 为 `accepted / implemented`，继续使用 pnpm Workspace 与现有根任务入口。

截至本文创建时，三个上游包的定向包入口和行为测试均通过，但 `packages/plugin-error` 尚不存在。本文和实施计划不构成代码实施证据；真实实施证据见第 0 节。

## 2. 问题与方案选择

Browser 已能安全捕获 JavaScript、Promise 和资源错误的最小事实，event-schema 已能校验三类错误正文，Core 已能接收 `{ eventType, body }` 草稿并统一生成协议版本、事件 ID 和时间。缺失的唯一边界是将三者组合为一个可独立启停、不会破坏宿主且不会旁路 Core 的具体插件。

采用的方案是：

1. 调用方显式创建并传入一个现有 `BrowserEnvironment`；
2. 工厂返回一个实现 `CorePlugin` 的 `ErrorCapturePlugin`；
3. 插件在 `start()` 中通过 Browser 根入口订阅，在 `stop()` 和 `destroy()` 中只取消自己拥有的订阅；
4. 插件同步把 Browser 事实转换为错误正文候选，调用 `parseErrorEventBody()` 获得新的安全正文；
5. 插件只调用 `CorePluginContext.submitEvent({ eventType: EventType.Error, body })`；
6. 插件使用每实例固定容量诊断表达局部失败，不向宿主抛出。

不采用“插件内部创建并销毁 BrowserEnvironment”，因为 Browser 实例可能被页面生命周期能力或其他插件共享，插件无权销毁调用方资源。不采用原始监听器适配器，因为这会形成第二套 Browser 抽象和监听器管理。不采用全局单例或全局事件总线，因为它们破坏多实例隔离。

## 3. 职责

本增量负责：

- 提供私有包 `@aurora/plugin-error` 和唯一根公开出口；
- 实现固定名称的 `CorePlugin`；
- 通过 `@aurora/browser` 根入口订阅三类错误源；
- 把 JavaScript 运行时错误转换为 `JavaScriptErrorEventBody`；
- 把未处理 Promise 拒绝转换为 `UnhandledPromiseRejectionErrorEventBody`；
- 把资源加载错误转换为 `ResourceLoadErrorEventBody`；
- 使用 `@aurora/event-schema` 根入口的常量、限制、类型和 `parseErrorEventBody()`；
- 使用 Core 插件上下文提交最小草稿；
- 定义同步、幂等且可释放的初始化、启动、停止和销毁行为；
- 处理 Browser 原子订阅失败、取消诊断、单次转换失败和 Core 提交失败；
- 通过实例级重入门禁阻止插件处理路径形成同步递归采集；
- 不保留原生 Event、DOM 节点、Error 或 Promise reason 引用；
- 提供固定容量、冻结、脱敏的插件诊断；
- 证明多实例、宿主 handler、事件控制、输入不可变和监听器释放；
- 提供单元、包入口、依赖负例和 Chromium 真实浏览器证据；
- 同步 README、正式文档和现有 ADR 的真实实施证据。

## 4. 非职责与排除范围

本增量不实现：

- 错误去重、分组、指纹、代表样本或问题聚合；
- Source Map、Stack Frame 解析或源码映射；
- 采样或任何用户可配置采集比例；
- 队列、批量、网络传输、重试、退避或持久化；
- 请求、性能、行为或框架插件；
- React、Vue 或开发者主动上报 API；
- 用户上下文、Session、breadcrumb、release、environment、projectId、endpoint 或密钥；
- 服务端、数据库、管理平台、CI、发布、容器、IaC 或云资源；
- 第二套 EventEnvelope、协议版本、错误协议、Browser 环境检测或监听器体系；
- 通用插件框架、通用转换框架、事件总线、`utils`、`helpers`、`common` 或 `misc`。

本增量不修改 Core、Browser 或 event-schema 的公共接口。

## 5. 分层和依赖边界

依赖方向固定为：

```text
@aurora/plugin-error
├── @aurora/core
├── @aurora/browser
└── @aurora/event-schema
```

- plugin-error 只从三个包的根公开出口导入；
- Core、Browser 和 event-schema 不反向依赖 plugin-error；
- plugin-error 不访问任何跨包 `src`、`internal`、测试入口或未导出子路径；
- Core 继续不依赖 Browser；
- event-schema 继续不依赖任何消费者；
- plugin-error 不依赖其他插件、框架、Node 专属运行时模块或网络包；
- `package.json` 使用 `aurora.layer: "sdk-plugin"` 和 `workspace:*` 本地依赖；
- Workspace Policy 增加 `sdk-plugin -> sdk-core | sdk-browser | protocol` 允许矩阵，并拒绝其他目标、循环、未声明依赖和私有路径；
- TypeScript、ESLint 和 Workspace Policy 共同拒绝插件源码直接访问 DOM/宿主全局、Node 运行时、模块级可变状态、宿主修改和事件控制方法。

## 6. 公共 TypeScript 契约

以下符号全部从 `@aurora/plugin-error` 根入口导出。包不提供第二个子路径出口。

```ts
import type { BrowserEnvironment, BrowserErrorSourceEventType } from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';

export const ERROR_CAPTURE_PLUGIN_NAME = 'error-capture' as const;

export const ErrorCaptureDiagnosticCode = Object.freeze({
  InvalidLifecycleCall: 'invalid_lifecycle_call',
  InvalidPluginContext: 'invalid_plugin_context',
  BrowserSubscriptionFailed: 'browser_subscription_failed',
  BrowserUnsubscribeFailed: 'browser_unsubscribe_failed',
  UnsupportedSource: 'unsupported_source',
  ErrorBodyRejected: 'error_body_rejected',
  EventSubmissionFailed: 'event_submission_failed',
  RecursiveCaptureBlocked: 'recursive_capture_blocked',
  InternalError: 'internal_error',
} as const);

export type ErrorCaptureDiagnosticCode =
  (typeof ErrorCaptureDiagnosticCode)[keyof typeof ErrorCaptureDiagnosticCode];

export const ErrorCaptureDiagnosticOperation = Object.freeze({
  Initialize: 'initialize',
  Start: 'start',
  Stop: 'stop',
  Destroy: 'destroy',
  Convert: 'convert',
  Submit: 'submit',
  Notify: 'notify',
} as const);

export type ErrorCaptureDiagnosticOperation =
  (typeof ErrorCaptureDiagnosticOperation)[keyof typeof ErrorCaptureDiagnosticOperation];

export interface ErrorCaptureDiagnostic {
  readonly sequence: number;
  readonly code: ErrorCaptureDiagnosticCode;
  readonly operation: ErrorCaptureDiagnosticOperation;
  readonly sourceType?: BrowserErrorSourceEventType;
}

export interface ErrorCapturePlugin extends CorePlugin {
  readonly name: typeof ERROR_CAPTURE_PLUGIN_NAME;
  initialize(context: CorePluginContext): void;
  start(): void;
  stop(): void;
  destroy(): void;
  getDiagnostics(): readonly ErrorCaptureDiagnostic[];
}

export function createErrorCapturePlugin(browser: BrowserEnvironment): ErrorCapturePlugin;
```

`createErrorCapturePlugin()` 是同步且非副作用导入后的显式工厂。正常的精确类型调用不抛出；实现对运行时恶意 getter 做防御性读取，即使 JavaScript 调用方绕过类型传入异常对象，也返回一个可诊断为 Browser 不可用的插件实例，不把异常抛给宿主。

不公开转换函数、诊断存储、订阅端口、文本读取函数或内部生命周期状态。

## 7. BrowserEnvironment 所有权

传入的 `BrowserEnvironment` 由调用方拥有。插件可以保存该公开环境对象或在工厂内快照其公开 `subscribeErrorSources` 方法，但不得：

- 调用 `browser.destroy()`；
- 读取 Browser 私有状态；
- 从 Browser 诊断中复制异常内容；
- 移除其他订阅；
- 在模块导入或插件创建时订阅。

插件只拥有 `start()` 成功返回的 `BrowserSubscription`。停止或销毁时先把本实例标记为不再接收事件，再调用该订阅的 `unsubscribe()`，随后清除引用。Browser 的原子注册与回滚仍是唯一监听器实现。

## 8. 精确生命周期

所有插件钩子为同步 `void`，符合 Core 允许的 `void | Promise<void>` 上界。

### 8.1 initialize

- 第一次收到合法 `CorePluginContext` 时安全快照其 `submitEvent` 方法，并进入 initialized；
- 重复初始化为幂等空操作，不替换第一次成功快照；
- 非法上下文记录 `invalid_plugin_context / initialize`，保持未初始化；
- 销毁后初始化记录 `invalid_lifecycle_call / initialize`，不得恢复；
- 初始化不订阅、不提交事件。

### 8.2 start

- 未初始化或已销毁时记录 `invalid_lifecycle_call / start`，不订阅；
- 已有活动订阅时为幂等空操作；
- 调用 Browser 根公开接口订阅一个实例级 Listener；
- 订阅失败时 Browser 已负责部分注册回滚；插件记录 `browser_subscription_failed / start` 并保持未启动；
- 订阅成功后保存唯一 `BrowserSubscription` 并开始接收事件；
- Browser 订阅的预期失败不抛出，因此不会错误地使 Core 永久隔离插件；下一轮 Core `stop()`/`start()` 可以重试。

### 8.3 stop

- 未启动时为幂等空操作；
- 先逻辑停用并清除活动订阅引用，再调用 `unsubscribe()`；
- `diagnosticsAdded > 0` 表示物理移除存在 Browser 诊断，插件追加 `browser_unsubscribe_failed / stop`；
- `unsubscribe()` 的意外抛出被捕获并转换为同一插件诊断；
- 停止后残留的宿主回调不能提交事件。

### 8.4 destroy

- 首次销毁执行与 stop 相同的释放语义，随后清除 Core 提交方法并永久标记 destroyed；
- 从未初始化或未启动状态销毁同样成功；
- 重复销毁为幂等空操作；
- 销毁后 initialize/start 不会恢复插件，任何残留回调均为空操作；
- Core 从 started 销毁时会先调用 stop 再调用 destroy，插件必须允许这两个调用连续发生且只取消一次。

## 9. 错误源到协议正文的映射

全部转换都发生在 Browser Listener 的同步调用栈内。插件从不保存 `BrowserErrorSourceEvent`。

### 9.1 ErrorDescriptor 读取

插件只从 Error 候选安全读取 `name`、`message` 和 `stack`。读取失败不抛出。字符串按 `ERROR_EVENT_LIMITS` 对应上限截断；空字符串视为缺失。`message` 缺失时使用不含宿主数据的稳定回退：

- JavaScript：`"Unknown JavaScript error"`；
- Promise Error：`"Unhandled promise rejection"`。

自由文本只做生产者职责内的最小过滤：明显的 `authorization`、`cookie`、`token`、`access_token`、`refresh_token`、`password` 和 `session` 键值替换为 `[redacted]`，HTTP(S) URL 中的查询与片段整体移除。该过滤不复制 event-schema 的字段结构、URL authority 校验或递归边界；最终合法性仍只由公共解析器决定。

### 9.2 JavaScript 错误

- 若 `event.error` 是当前 realm 的 `Error`，生成 ErrorDescriptor 候选；
- 否则使用 `event.message` 的安全有限文本；
- `sourceUrl` 不进入正文，因为现有错误协议没有该字段；
- 候选固定为 `{ category: ErrorCategory.JavaScript, error }`；
- ErrorEvent 不含 Error 且消息缺失时仍使用稳定回退，不伪造名称或堆栈。

### 9.3 Promise 拒绝

- `reason instanceof Error`：使用 `PromiseRejectionReasonKind.Error` 和 ErrorDescriptor；
- 字符串：使用 `PromiseRejectionReasonKind.String` 和安全有限字符串；空字符串使用稳定回退；
- 其他值：使用 `PromiseRejectionReasonKind.NonStandard`，把原始 `unknown` 只作为同步解析候选交给 `parseErrorEventBody()`；
- 循环、超深、超大、非 JSON、禁止字段和非法数字全部由 event-schema 公共解析器有限拒绝；
- 解析成功使用解析器新建的 `data`，不保存或提交原始 reason；
- 插件不实现第二套递归复制、循环检测、对象深度、对象大小或禁止字段逻辑。

### 9.4 资源错误

映射只使用 Browser 已复制的小写事实：

| Browser 事实                                                         | `ErrorResourceType` |
| -------------------------------------------------------------------- | ------------------- |
| `tagName === "script"` 或 `as === "script"`                          | `Script`            |
| `tagName === "link"` 且 `rel` 包含 `stylesheet`，或 `as === "style"` | `Stylesheet`        |
| `tagName === "img"` 或 `as === "image"`                              | `Image`             |
| `as === "font"`                                                      | `Font`              |

其他类型返回 `unsupported_source / convert`，不猜测为 `other`。候选 URL 直接使用 Browser 的 `sourceUrl`；`parseErrorEventBody()` 仍执行唯一的协议 URL 校验与查询/片段移除。URL 为空或非法时记录 `error_body_rejected / convert`，不提交事件。

## 10. 协议校验与 Core 提交

每个候选正文固定执行：

```ts
const parsed = parseErrorEventBody(candidate);
if (parsed.success) {
  context.submitEvent({
    eventType: EventType.Error,
    body: parsed.data,
  });
}
```

- 插件不创建、导入或缓存 `EventEnvelope`；
- 插件不读取 `CURRENT_PROTOCOL_VERSION`；
- 插件不生成事件 ID 或时间；
- 插件不能向草稿加入 `protocolVersion`、`eventId` 或 `occurredAt`；
- 解析失败记录 `error_body_rejected / convert`，诊断不复制 issue、路径、消息或输入；
- Core 返回 `ok: false` 时记录 `event_submission_failed / submit`；
- Core 返回 `accepted` 只表示草稿已由 Core 创建为合法信封并通过现有入口，不表示排队、发送或持久化；
- 单次解析或提交失败不会停止订阅，也不会阻止下一事件。

## 11. 递归防护与异常隔离

每个插件实例拥有独立的 `isHandlingSource` 布尔状态。Listener 处理顺序固定为：

1. 检查插件仍活动；
2. 若 `isHandlingSource` 已为 true，记录 `recursive_capture_blocked / notify` 并返回；
3. 设为 true；
4. 转换、解析和提交；
5. 捕获所有意外异常，记录 `internal_error`；
6. 在 `finally` 中恢复 false。

该门禁只阻止同一实例在一次同步处理路径中的重入，不执行去重或跨事件抑制。所有内部错误都在 Browser Listener 返回前被捕获，因此不会制造新的未捕获错误或拒绝，也不会递归触发 Aurora。Browser 自身的回调异常隔离仍作为第二道宿主保护。

## 12. 输入不可变与引用释放

- 不写入 Browser 事件视图、原生 Error、reason、DOM 或任何嵌套对象；
- 不调用 `preventDefault()`、`stopPropagation()` 或 `stopImmediatePropagation()`；
- 不修改 `window.onerror`、`window.onunhandledrejection` 或任何宿主 handler；
- 不保留原生 Event、DOM 节点、Error、reason 或候选正文引用；
- Error 字符串被复制为新字符串；非标准 reason 只在同步解析期间传入 event-schema；
- 只有解析成功后的新正文被同步提交；
- Core 草稿入口不修改正文，插件不在提交后保存正文；
- 停止或销毁后只保留有界诊断，不保留事件数据。

## 13. 诊断

每实例最多保留最新 100 条 `ErrorCaptureDiagnostic`。`sequence` 从 1 独立递增。`getDiagnostics()` 返回冻结的新数组，条目冻结且不能反向修改内部状态。

诊断只包含：

- 递增序号；
- 稳定 code；
- 稳定 operation；
- 可选的 Browser 错误源类型。

诊断禁止包含异常对象、异常消息、堆栈、事件正文、Error、reason、DOM、URL、Cookie、Token、Authorization、Storage、请求/响应数据、表单、页面文本、用户输入、配置或 Core 结果详情。生产代码不使用 `console`。预期的重复 start/stop/destroy 不增加诊断；非法生命周期调用、实际失败和递归阻断必须可见。

## 14. 多实例与共享 Browser

每次 `createErrorCapturePlugin()` 拥有独立的：

- 生命周期状态；
- Core 提交方法快照；
- BrowserSubscription 引用；
- 重入布尔值；
- 诊断序列和容量。

不得存在模块级可变注册表、计数器、Set、Map、数组或缓存。两个插件可以共享一个 BrowserEnvironment，也可以使用不同 BrowserEnvironment；一个插件停止或销毁只取消自己的订阅。一个实例的转换、提交、诊断或销毁失败不能改变另一个实例。

## 15. 宿主安全与隐私

实现和测试必须证明：

- 模块导入与工厂创建均不注册监听器；
- 只通过 Browser 公开接口订阅，不直接访问 DOM 或浏览器全局；
- 不覆盖 handler、不控制事件默认行为或传播、不修改原生对象；
- 回调异常不影响宿主脚本；
- 一个事件失败后下一事件仍可提交；
- 停止和销毁后监听器完整释放或至少逻辑失效；
- 多实例不交叉移除；
- 插件内部失败不产生未捕获错误或 Promise 拒绝；
- 没有原生引用跨出同步回调；
- 诊断和测试样本不含真实敏感信息。

不得采集或记录 Cookie、Token、Authorization、Storage、请求/响应正文、表单、DOM、页面文本、用户输入、完整 URL 查询或片段、指纹、原始 IP 或错误协议未允许的上下文。

## 16. 包、文件与代码规范

最终包使用：

```text
packages/plugin-error/
├── README.md
├── package.json
├── playwright.config.ts
├── tsconfig.build.json
├── tsconfig.json
├── tsconfig.no-dom.json
├── vitest.config.ts
├── src/
│   ├── diagnostics.ts
│   ├── error-capture-plugin.ts
│   ├── error-descriptor.ts
│   ├── index.ts
│   ├── javascript-error-converter.ts
│   ├── promise-rejection-converter.ts
│   ├── resource-error-converter.ts
│   └── source-event-handler.ts
├── test/
│   ├── architecture-boundary.test.ts
│   ├── contract.test.ts
│   ├── documentation-contract.test.ts
│   ├── host-safety.test.ts
│   ├── javascript-error-converter.test.ts
│   ├── lifecycle.test.ts
│   ├── multi-instance.test.ts
│   ├── no-dom-consumer.ts
│   ├── package-entry.test.ts
│   ├── promise-rejection-converter.test.ts
│   ├── resource-error-converter.test.ts
│   └── submission.test.ts
└── test-browser/
    ├── error-capture-plugin.spec.ts
    └── fixture-server.ts
```

- TypeScript 使用根 `strict`、`exactOptionalPropertyTypes` 和 `noUncheckedIndexedAccess`；
- 不可信运行时值保持 `unknown`，精确 Browser 联合类型按判别字段穷尽处理；
- 禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言和错误抑制；
- 公共函数显式声明参数和返回类型；
- 文件名 `kebab-case`，类型/接口 `PascalCase`，函数/变量 `camelCase`，布尔值使用 `is`、`has`、`can`、`should` 前缀；
- 文件和函数单一职责，不创建杂物目录；
- 不复制 Browser 监听器、event-schema 校验或 Core 信封创建；
- 不随意使用类型断言；必要的局部断言必须紧邻已完成的运行时检查并解释原因；
- `sideEffects: false`，只导出第 6 节 API；
- 不使用生产 `console`。

Node 服务端目录和日志字段规范不适用，因为本包不是服务端。Core 无 DOM Provider 规则不直接约束插件运行环境，但本包额外使用 no-DOM 编译证明生产源码没有绕过 Browser 公共接口。

## 17. 自动架构门禁

实施必须建立以下可执行证据：

1. `sdk-plugin` 只允许依赖 `sdk-core`、`sdk-browser` 和 `protocol`；
2. Core、Browser、protocol 依赖 plugin 时返回 `forbidden-layer-dependency`；
3. plugin 依赖 plugin、framework 或 tooling 时返回 `forbidden-layer-dependency`；
4. 插件跨包导入 `src`、`internal` 或未导出路径返回 `private-path-import`；
5. 依赖图循环、未声明依赖均失败；
6. 插件源码直接访问 DOM/宿主全局、Node 运行时、模块级可变状态、宿主修改或事件控制均失败；
7. `tsc -p packages/plugin-error/tsconfig.no-dom.json --noEmit` 通过；
8. 包根可加载，私有转换器路径返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
9. 构建产物只暴露一个根入口和第 6 节批准符号；
10. 多实例测试证明无全局可变状态。

## 18. 测试与覆盖率

覆盖率固定为：

- lines ≥ 85%；
- branches ≥ 80%；
- functions ≥ 85%；
- statements ≥ 85%。

测试通过公开行为断言，不只验证内部函数调用次数。

### 18.1 生命周期和 Browser

- 工厂创建、零导入副作用、initialize/start/stop/destroy；
- 重复初始化、启动、停止和销毁；
- 未初始化启动、销毁后启动；
- Browser 订阅成功、失败和部分注册回滚的公开结果；
- 取消诊断、意外取消抛错和残留回调逻辑失效；
- 停止后重新启动创建新订阅；
- 插件不调用 BrowserEnvironment.destroy。

### 18.2 三类错误

- JavaScript Error、跨字段读取失败、ErrorEvent 不含 Error、空消息；
- Promise 以 Error、字符串、null、有限对象拒绝；
- Promise 循环、超深、超大、禁止字段和不支持值；
- script、stylesheet、image、font 资源；
- 未知资源类型、缺失 URL、非法 URL；
- URL 查询和片段不进入成功正文；
- 输入事件、Error 和 reason 不被修改。

### 18.3 Core、协议和失败隔离

- 每类 Browser 事实都经 `parseErrorEventBody()` 成功后提交；
- 草稿只有 `eventType` 和 `body`；
- 插件不产生 ID、时间或协议版本；
- schema 拒绝时不提交；
- Core 返回 `invalid_event_draft`、`event_creation_failed`、`invalid_event`、`not_started`、`destroyed` 或 `internal_error` 时形成单一脱敏诊断；
- 一个失败不阻止后续成功；
- 重入事件只记录阻断且不递归；
- 诊断容量、冻结和多实例序列独立。

### 18.4 宿主和引用安全

- 不调用事件控制方法；
- 不修改宿主 handler 或原生 API；
- 回调和 getter 异常不冒泡；
- 可撤销 Proxy 在回调后不再被读取；
- 提交正文不等于原始 Error/reason/事件对象；
- 一个实例销毁不影响另一个。

## 19. Chromium 真实浏览器门禁

Playwright 使用现有版本和单 Chromium 项目，加载构建后的三个上游包与 plugin-error 根入口。fixture 使用 import map 映射包根，不访问私有源码。

至少验证：

- 同步 JavaScript 错误、未处理 Promise 拒绝和资源加载错误各提交一次；
- 提交草稿通过 `parseErrorEventBody()`，并由真实 `createCore()` 的 `submitEventDraft()` 返回 `accepted`；
- `window.onerror` 与 `window.onunhandledrejection` 身份和行为不变；
- `defaultPrevented` 为 false，传播不被阻断；
- 停止后不再提交，销毁后监听器逻辑失效；
- 两实例各接收一次，一个销毁后另一个继续；
- 插件内部 schema/Core 失败不破坏页面脚本且下一事件仍成功；
- 没有递归收集；
- 资源正文 URL 不含查询或片段。

模拟 DOM 不能替代这些证据。

## 20. 体积、构建和根任务

包继续使用现有 TypeScript 库构建，不新增 bundler 或发布系统。实施记录：

- `dist` 中运行时 JavaScript 的原始总字节数；
- 对固定文件顺序拼接后的 gzip 字节数；
- `package.json` 保持 `sideEffects: false`。

批准的单插件 gzip 增量预算为 8 KiB，但 TypeScript 多文件拼接不是最终 tree-shaking/bundler 结果，因此本轮只记录可重复的近似数据并标记 `requires-benchmark`；不得把该值描述为发布包体结论，也不得为此增加构建依赖。

根 `format:check`、`lint`、`typecheck`、`test`、`test:coverage`、`check:boundaries`、`build`、各包入口、plugin-error Chromium 和 `check:ci` 必须纳入新包。

## 21. 文档和 ADR 实施证据

只有代码实施且完整新鲜门禁通过后，才同步：

- `packages/plugin-error/README.md`：职责、安装组合、公开 API、生命周期、诊断、隐私和排除范围；
- 根 `README.md` 与 `docs/README.md`：记录错误插件第一增量真实存在；
- `docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md` 和 `docs/testing/test-strategy.md`：记录插件层、边界和 Chromium 证据；
- `AGENTS.md` 与 `AURORA_RULES.md`：更新当前真实包和决策顺序；
- ADR-003：追加具体错误插件、生命周期、释放、宿主安全和多实例证据，保持 `accepted / in-progress`；
- ADR-005：追加真实插件只消费 event-schema 根入口并调用公共解析器的证据，保持 `accepted / in-progress`；
- ADR-006：追加 `sdk-plugin` 依赖矩阵、环境负例、私有入口和循环负例证据，保持 `accepted / in-progress`；
- ADR-007 保持 `accepted / implemented`，除非实施发现既有工具事实错误。

规格和计划本身不得修改 ADR 决策状态或实施状态。本增量不需要新 ADR。

## 22. 完成定义

只有当：

- 第 6 节公共 API 与构建出口一致；
- 三类转换、生命周期、回滚、释放、失败隔离和重入门禁全部通过；
- 诊断有界、冻结且无敏感内容；
- 覆盖率达到 85/80/85/85；
- Workspace Policy、ESLint、TypeScript、no-DOM、包入口和依赖负例通过；
- Chromium 门禁全部通过；
- 文档和 ADR 只追加真实新鲜证据；
- 没有排除范围中的实现；

才能把本文 `implementation-status` 改为 `implemented`。本文当前 `implementation-status` 已按第 0 节证据更新为 `implemented`。
