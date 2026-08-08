---
title: Aurora 请求处理规则/配置 Adapter（Request Processing Rules/Configuration Adapter）
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-03
last-reviewed: 2026-08-03
applies-to: apps/ingestion-worker（@aurora/ingestion-worker）的请求分类、慢请求阈值与安全配置 adapter（createRequestProcessingRulesAdapter 工厂、RequestProcessingRules 配置模型、确定性分类决策、配置读取失败语义）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-004-asynchronous-event-processing.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../adr/ADR-012-ingestion-worker-runtime.md
  - ../adr/ADR-015-ingestion-worker-retry-budget-policy.md
  - ../adr/ADR-016-ingestion-worker-retry-backoff-schedule.md
  - ../adr/ADR-017-ingestion-dead-letter-manual-replay.md
  - ../adr/ADR-018-error-event-occurrence-processing-storage.md
  - ../adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md
  - ../adr/ADR-020-idempotent-request-metric-bucket-aggregation.md
  - ../protocol/request-event-contract.md
  - ../architecture/request-event-sample-processing-store.md
  - ../architecture/request-metric-aggregate-store.md
  - ../architecture/request-sample-selection-policy.md
  - ../architecture/request-event-processor.md
  - ../architecture/error-event-processor.md
  - ../architecture/formalization-readiness.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: request-processing-rules-contract-or-release
---

# Aurora 请求处理规则/配置 Adapter（DAT-07）

## 1. 定位、效力与当前状态

本文冻结请求处理规则/配置 adapter 第一增量，实施为 `apps/ingestion-worker`（包名 `@aurora/ingestion-worker`）内的 `createRequestProcessingRulesAdapter` 工厂。它实现既有 `ClassifyRequestEvent` 分类端口，接收 `RequestEventClassificationInput` 最小内部事实（`outcome`/`statusCode?`/`durationMs`/`method`），依据**不可变请求处理规则快照**（`RequestProcessingRules`：默认慢请求阈值 3000ms、项目覆盖阈值、`isFailure` 状态码集合、`isSlow` 状态码集合、`isAdditionalMonitoredStatus` 状态码集合），输出 `RequestEventClassification`（`isFailure`/`isSlow`/`isAdditionalMonitoredStatus`），使 Request Processor（`createRequestEventProcessor`）从"注入确定 fake 分类"升级为"注入真实规则分类"。

**批准状态**：本文由用户于 2026-08-03 预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-03 更新为 `implemented`：`apps/ingestion-worker` 的请求处理规则/配置 adapter 已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁。本文由 accepted ADR-004/005/006/012/015/016/017/018/019/020、approved 请求事件协议契约、请求处理器规格、请求样本选择策略规格与 PRD 5.1.2/5.1.3/5.1.5/5.1.6 无歧义派生；自动审批依据见规格自检节。

**声明边界（阻塞记录）**：本模块实现**配置 adapter 核心能力**，但**不接入生产 composition root 与真实配置存储**。配置来源边界（配置读取端口 `RequestProcessingRulesProvider`）与"配置来自已批准存储"由未来模块决定。本增量提供进程内注入的 rules adapter，并把配置读取失败语义冻结为**显式失败结果**（不允许静默回退任意默认）。生产 `startIngestionWorker` 仍不接线；总事件路由仍 blocked。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：`apps/ingestion-worker` 的请求处理规则/配置 adapter：`RequestProcessingRules` 配置模型、`createRequestProcessingRulesAdapter` 工厂、确定性分类决策、配置读取失败语义、单元测试、真实 PostgreSQL 17 集成测试、README、正式规格、ADR-019/020 实施证据。
- **明确非职责**：
  - 真实配置存储（数据库/Redis/配置文件）与配置管理 HTTP API、平台 UI；
  - 生产 composition root 接线、生产 bin/start、总事件路由器；
  - SDK 请求 allowlist、路径归一化、同源/跨域判断（这些属于 SDK 配置与处理层）；
  - Request Metric Query、percentile、采样外推；
  - Performance Processor、Performance Store；
  - Issue 分组、fingerprint、Source Map、告警；
  - 数据保留与清理；
  - 修改 request-event-contract、ingestion-api、POST /v1/batches、Error processor、processing-store、Inbox、retry/backoff/replay。

## 3. 模块选择依据

- 请求事件 Processor 规格第 30 节明确"真实项目配置 Repository / production 分类 adapter：not-started（后续独立模块）"——本模块即该后续独立模块；
- `createRequestEventProcessor` 已实现 `ClassifyRequestEvent` 分类端口（§9），处理器不硬编码 `slowRequestThreshold = 3000`、额外状态码、采样率、环境或发布规则；`isFailure`/`isSlow`/`isAdditionalMonitoredStatus` 全部来自注入端口——本模块为该端口提供真实规则实现；
- accepted ADR-020 决定细节 5 明确"`isFailure`/`isSlow` 由未来 Request Processor 依据 approved 产品规则、项目配置和有效慢请求阈值产生；Store 只验证并应用该内部指标贡献，不硬编码 3000ms、HTTP 429、HTTP 500—599 或额外状态码"——本模块即"依据项目配置和有效慢请求阈值产生"的执行器；
- accepted ADR-019 决定细节 3/4 明确样本类别（网络失败/超时/429/5xx/项目配置明确纳入请求问题的额外状态码/慢请求）——`isAdditionalMonitoredStatus`/`isSlow` 由本模块依据项目配置产生；
- 请求样本选择策略规格第 11/12 节明确"`isSlow` 由未来 Request Processor 按项目慢请求阈值判定""`isAdditionalMonitoredStatus` 由未来 Request Processor 解析项目配置后传入"——本模块即该判定/解析能力的第一个真实实现；
- PRD 5.1.3 明确默认慢请求阈值 3000ms、可配置；5.1.2 明确"项目需要监控特定 4xx 时，可以通过 SDK 配置明确开启状态码范围"——本模块把该产品语义落为进程内规则模型。

## 4. 系统与模块位置

- 本模块位于 `apps/ingestion-worker`（`@aurora/ingestion-worker`，`aurora.layer: service`）；
- 新文件：`src/request-processing-rules-adapter.ts`、`test/request-processing-rules-adapter.test.ts`、`test/integration/request-processing-rules-adapter.test.ts`；
- 遵循 `createRequestEventProcessor`/`createErrorEventProcessor` 的工厂组织与命名模式；不创建新 processor framework、base class 或通用 orchestration package；
- `@aurora/ingestion-worker` 已作为 worker 包根导出 `createRequestEventProcessor`/`ClassifyRequestEvent` 等，README 将 Processor Factory 视为公共组合入口 → 按同一最小模式从包根导出 `createRequestProcessingRulesAdapter` 与配置/结果类型；
- **不**导出私有配置校验 helper、仅测试使用的类型；
- **不**扩大 `@aurora/processing-store`/`@aurora/event-schema` 公共 API；**不**修改 request-event-contract。

## 5. 依赖方向

`request-processing-rules-adapter.ts` → `@aurora/event-schema` 包根（`RequestOutcome` 类型与常量、`REQUEST_EVENT_LIMITS`）、`./request-event-processor.ts`（`ClassifyRequestEvent`/`RequestEventClassification`/`RequestEventClassificationInput` 端口类型）。

adapter **不**创建或关闭 Pool；**不**直接执行 SQL；**不**访问 `process.env`；**不**调用 `Date.now`/`Math.random`；**不**读取网络或文件系统；**不**修改输入对象。

## 6. 输入

adapter 工厂输入（完整 TypeScript 接口）：

```ts
export interface RequestProcessingRules {
  /** 慢请求判定阈值（毫秒）。PRD 5.1.3 默认 3000，项目可覆盖。 */
  readonly slowRequestThresholdMs: number;
  /** 判定 isFailure 的状态码集合（默认含 500—599 与 429）。 */
  readonly failureStatusCodes: ReadonlySet<number>;
  /** 判定 isSlow 的状态码集合（默认空）。 */
  readonly slowStatusCodes: ReadonlySet<number>;
  /** 判定 isAdditionalMonitoredStatus 的状态码集合（项目配置明确纳入请求问题监控的额外状态码）。 */
  readonly additionalMonitoredStatusCodes: ReadonlySet<number>;
}

export interface CreateRequestProcessingRulesAdapterInput {
  /** 不可变配置快照；工厂创建时冻结。 */
  readonly rules: RequestProcessingRules;
}
```

## 7. 输出

adapter 工厂返回：

```ts
export interface RequestProcessingRulesAdapter {
  /** 实现既有 ClassifyRequestEvent 端口；同步分类并返回稳定结果。 */
  classify(input: RequestEventClassificationInput): Promise<RequestEventClassification>;
}
```

- `classify` 输出 `RequestEventClassification`（`isFailure`/`isSlow`/`isAdditionalMonitoredStatus`，均为 boolean）；
- `classify` 是**同步确定性**函数，但仍返回 `Promise`（遵守 `ClassifyRequestEvent` 端口签名，供未来配置 adapter 异步读取配置复用）；
- `classify` 对同一输入任意次数调用返回完全一致结果。

## 8. 配置来源的权威边界

- 本模块只定义**进程内规则模型**（`RequestProcessingRules`）与**注入端口**；不定义配置存储格式、不读取数据库、不读取文件、不读取环境变量；
- 配置快照在工厂创建时由调用方提供，adapter 持有后**冻结**（`Object.freeze` 递归冻结），处理期间不可变；
- 配置读取失败语义：本模块本身不读取配置，因此不存在"本模块读取失败"；未来配置 provider 端口若读取失败，必须返回**显式失败结果**（见 §11），**不得**静默回退任意默认值或把配置缺失当作默认规则；
- PRD 5.1.15"项目服务端设置不能远程强制浏览器采集开发者没有开启的数据"不适用：本模块只处理已由 SDK 上报的合法 Request 事件的安全分类，不扩大采集范围。

## 9. 分类语义

给定 `RequestEventClassificationInput`，`classify` 按以下确定性规则输出：

### 9.1 isFailure

满足以下任一条件的请求判定为失败：

- `outcome === RequestOutcome.NetworkError`；
- `outcome === RequestOutcome.Timeout`；
- `outcome === RequestOutcome.HttpError` 且 `statusCode !== undefined` 且 `statusCode ∈ failureStatusCodes`。

`outcome === RequestOutcome.Success` 或 `Canceled` 的请求永不判定失败；`outcome === HttpError` 但 statusCode 未命中 `failureStatusCodes` 的请求不判定失败（即使 `isAdditionalMonitoredStatus = true`，因为该语义是"监控"而非"失败"，与 ADR-020 决定细节 5"Store 不硬编码 429/5xx"一致，isFailure 只按配置状态码集合计算）。

### 9.2 isSlow

满足以下任一条件的请求判定为慢：

- `durationMs >= slowRequestThresholdMs` 且 `outcome !== RequestOutcome.Canceled`；
- `outcome === RequestOutcome.HttpError` 且 `statusCode !== undefined` 且 `statusCode ∈ slowStatusCodes`（项目显式把某状态码整体标记为慢）。

`outcome === RequestOutcome.Canceled` 的请求永不判定慢（用户主动取消的请求不进入慢请求统计，PRD 5.1.2）。

### 9.3 isAdditionalMonitoredStatus

满足以下条件的请求判定为额外监控状态：

- `outcome === RequestOutcome.HttpError` 且 `statusCode !== undefined` 且 `statusCode ∈ additionalMonitoredStatusCodes`。

只有 `HttpError` outcome 才可能命中额外监控状态码。

## 10. 优先级与确定性

- 分类规则是**独立布尔判定**，不按固定优先级短路；`isFailure`/`isSlow`/`isAdditionalMonitoredStatus` 各自独立计算，可能同时为 true（例如 503 且慢：`isFailure=true`、`isSlow=true`、`isAdditionalMonitoredStatus=false`）；
- 与请求样本选择策略的**决策优先级**（cancelled → network failure → timeout → 429 → 5xx → configured status → slow → skip）互不冲突：adapter 输出分类布尔，样本选择策略消费布尔事实并按自身固定优先级决策；adapter 不调用样本选择策略，不输出决策；
- 同一输入任意次数调用返回完全一致结果；无随机、无隐藏状态、无时钟依赖。

## 11. 配置缺失、无效、过期或读取失败时的确定性行为

- **配置缺失**（调用方未提供 `rules`）：工厂创建参数类型强制必填，TS 编译期拒绝；运行时若被绕过（`undefined` 传入），工厂抛稳定 `RequestProcessingRulesAdapterError`（`invalid_rules`），不静默使用默认；
- **配置无效**（`slowRequestThresholdMs` 非有限/非正整数、任一状态码集合含非 `100..599` 安全整数或含非整数）：工厂创建时抛稳定 `RequestProcessingRulesAdapterError`（`invalid_rules`），不静默修正；
- **配置过期**：adapter 在创建时冻结快照；处理期间配置不会变化（不可变快照语义）。若未来配置 provider 需要动态刷新，必须创建新的 adapter 实例，不得修改已冻结实例；
- **配置读取失败**（未来 provider）：必须由 provider 返回显式失败（reject/返回失败结果），Request Processor 已定义的未知异常传播规则（processor §16）处理；adapter 不吞失败、不把读取失败静默解释为任意默认规则。

## 12. 不可变配置快照

- adapter 工厂创建时对 `rules` 执行**浅层复制 + 递归冻结**（`Object.freeze`），保存为私有 `frozenRules`；
- `classify` 每次读取 `frozenRules`，不读取任何外部可变状态；
- 调用方在工厂创建后修改原 `rules` 对象不影响 adapter 行为（复制语义）；调用方修改冻结对象的子 `Set` 不影响 adapter（复制 Set）；
- 保证请求处理开始时的配置快照一致性：同一请求事件在 retry/replay 时使用**同一规则快照**（如果复用同一 adapter 实例），避免重试时分类漂移。

## 13. 网络失败、超时、429、5xx、普通 4xx、主动取消和慢请求的分类语义

| 输入事实 | isFailure | isSlow | isAdditionalMonitoredStatus |
| --- | --- | --- | --- |
| `outcome=network_error` | true | 按 durationMs（≥阈值且非 canceled → true） | false |
| `outcome=timeout` | true | 按 durationMs | false |
| `outcome=canceled` | false | false | false |
| `outcome=success` | false | 按 durationMs（≥阈值 → true） | false |
| `outcome=http_error, statusCode=429`（默认 failureStatusCodes 含 429） | true | 按 durationMs | false（除非 429 在 additionalMonitoredStatusCodes） |
| `outcome=http_error, statusCode∈500..599`（默认 failureStatusCodes 含） | true | 按 durationMs | false（除非配置） |
| `outcome=http_error, statusCode=404`（普通 4xx） | false | 按 durationMs（≥阈值 → true）；若 404 ∈ slowStatusCodes → true | 404 ∈ additionalMonitoredStatusCodes → true |
| `outcome=http_error, statusCode∈additionalMonitoredStatusCodes` | false（除非也在 failureStatusCodes） | 按 durationMs | true |

## 14. 默认慢请求阈值与慢请求采样语义如何保持 PRD 规定

- 默认阈值 `slowRequestThresholdMs = 3000`（PRD 5.1.3：第一版默认把超过 3 秒的 `fetch` 或 `XMLHttpRequest` 视为慢请求）作为**工厂层默认值**：`DEFAULT_REQUEST_PROCESSING_RULES` 常量导出；调用方不传 `slowRequestThresholdMs` 时使用默认，传入时用项目覆盖值；
- 慢请求**采样率 20%**（PRD 5.1.3、15.2）：**不属于本模块**——adapter 只做 `isSlow` 布尔分类，不做随机采样、不按概率丢弃、不实现采样水位；采样语义由 SDK 端与未来采样模块负责，本模块不实现、不假装实现；
- 慢请求只保存最小定位信息（PRD 5.1.3：方法/去查询 URL/耗时/状态码/页面/环境/版本）：由 Request Processor + Sample Store 的 `sample_body` 六字段白名单保证，本模块不额外保存任何字段；
- 请求同时网络失败或 5xx 时仍按请求错误完整采集（PRD 5.1.3）：`isFailure` 与 `isSlow` 独立计算，网络失败/5xx 既可能 `isFailure=true` 也可能 `isSlow=true`（若同时慢），Sample Selection Policy 的固定优先级保证失败类优先保存样本。

## 15. 请求错误完整处理与慢请求有限样本之间的优先级

- adapter 不直接决定"保存样本"或"不保存样本"；它只产生分类布尔；
- 样本保存决策由 Request Processor 调用 `decideRequestSampleSelection`（固定优先级：cancelled → network failure → timeout → 429 → 5xx → configured status → slow request → skip）完成；
- adapter 的分类使网络失败/超时/429/5xx 的请求同时获得 `isFailure=true`（正确计入失败指标 `failure_count`）与样本选择 `store`（正确保存诊断样本）；慢请求获得 `isSlow=true`（正确计入 `slow_count`）与样本选择 `store/slow_request`（正确保存有限样本）；
- 错误优先于慢样本的语义（PRD 5.1.3"请求同时发生网络失败或 5xx 时，仍按照请求错误完整采集"）由样本选择策略的固定优先级保证，不由 adapter 重复实现。

## 16. 分类结果如何进入既有 Request Processor

- 调用方创建 adapter：`const adapter = createRequestProcessingRulesAdapter({ rules })`；
- 把 `adapter.classify` 作为 `ClassifyRequestEvent` 注入 `createRequestEventProcessor`：
  ```ts
  const processor = createRequestEventProcessor({
    persistMetric,
    persistSample,
    classify: adapter.classify,
    backoff,
  });
  ```
- `adapter.classify` 的方法签名与 `ClassifyRequestEvent` 完全一致（`(input: RequestEventClassificationInput) => Promise<RequestEventClassification>`），可直接传入；
- Request Processor 内部不再需要 fake 分类；处理器其余行为（解析、指标、样本、retry、结果映射）完全不变；
- 既有单元/集成测试中的 `classify: () => Promise.resolve({...})` fake 继续可用（注入端口不变），新增真实 adapter 测试验证 adapter → processor 组合。

## 17. 隐私与禁止字段

- adapter 只接收 `RequestEventClassificationInput`（`outcome`/`statusCode?`/`durationMs`/`method`），该类型已在 Request Processor 中冻结为"安全最小事实"，不含请求体、响应体、Header、Cookie、Authorization、完整 URL、查询参数、页面文本、用户信息、完整事件 JSON、数据库行；
- adapter 不保存、不记录、不输出任何输入值；
- 输出 `RequestEventClassification` 只含三个布尔；
- adapter 不写日志；不写数据库；不访问网络/文件系统/环境变量；
- 诊断中允许记录的字段：无（adapter 不产生诊断）；禁止记录的字段：任何输入值、任何配置集合内容（配置集合本身属于项目业务配置，不进入诊断/日志）。

## 18. 不允许重新读取请求体、响应体、Cookie、Authorization 或被移除的查询参数值

- adapter 输入类型 `RequestEventClassificationInput` 是强类型白名单，编译期不可能携带请求体/响应体/Header/Cookie/Authorization/查询参数值；
- adapter 不接触 `EventEnvelope.body` 之外的任何事件字段；URL 查询参数与片段已由协议层在解析时移除，adapter 拿不到、也不需要；
- security-negative 测试断言 `request-processing-rules-adapter.ts` 源码不包含 `event.body`、`.headers`、`.cookies`、`Authorization`、`clientKey`、`token`、`password`、`INSERT INTO`、`SELECT` 等模式。

## 19. 不允许 adapter 修改 event-schema 事件

- adapter 不接收完整事件、不解析/修改事件、不返回事件；
- adapter 只消费 `RequestEventClassificationInput` 并返回 `RequestEventClassification`；
- 不修改 `@aurora/event-schema`、request-event-contract、任何协议常量或类型。

## 20. 幂等、重试和重复消费下的行为

- adapter 是确定性纯函数式工厂 + 分类方法；同一输入任意次数调用结果一致；
- 不维护可变状态（除冻结快照外），不递增计数器，不产生副作用；
- 同一 `(projectId, eventId)` 事件在 retry/replay 时：若复用同一 adapter 实例，使用同一规则快照，分类结果一致；若使用新实例但同一配置，结果仍一致（配置相同 → 分类相同）；
- 配置集合顺序不影响分类（`Set` 语义）；集合内容变化仅在创建新 adapter 时生效。

## 21. 诊断与日志中允许记录和禁止记录的字段

- adapter 不写日志、不产生诊断事件；
- 允许记录：无；
- 禁止记录：输入事实、配置集合内容、任何事件字段、任何请求/响应/凭据字段；
- 若未来配置 provider 需要诊断，必须遵守"稳定 code + 最小标识（如 projectId 哈希/类别），不含配置值/事件正文"约束，由对应模块规格另行冻结。

## 22. 依赖方向与公共出口

- 依赖 `@aurora/event-schema` 包根（仅类型与常量 `RequestOutcome`/`REQUEST_EVENT_LIMITS`）；禁止深层导入；
- 依赖 worker 内部 `./request-event-processor.ts`（端口类型 `ClassifyRequestEvent`/`RequestEventClassification`/`RequestEventClassificationInput`）；禁止循环依赖；
- `apps/ingestion-worker` 为 `aurora.layer: service`；本模块不新增任何跨包依赖；
- 包根新增导出：`createRequestProcessingRulesAdapter`、`DEFAULT_REQUEST_PROCESSING_RULES`、`RequestProcessingRules`（类型）、`RequestProcessingRulesAdapter`（类型）、`CreateRequestProcessingRulesAdapterInput`（类型）、`RequestProcessingRulesAdapterError`（类）、`RequestProcessingRulesAdapterErrorKind`（类型）；
- **不**导出私有配置校验 helper、仅测试使用的 fixture；
- `package.json` **不新增**依赖；`package-entry.test.ts` 追加断言。

## 23. 单元测试

直接调用 `createRequestProcessingRulesAdapter({ rules })` 工厂并调用 `classify`，覆盖：

- 默认规则（`DEFAULT_REQUEST_PROCESSING_RULES`）下各类输入分类正确：
  - `network_error` → `isFailure=true`；
  - `timeout` → `isFailure=true`；
  - `http_error` + 429 → `isFailure=true`；
  - `http_error` + 500/503/599 → `isFailure=true`；
  - `http_error` + 404（默认未配置）→ `isFailure=false`；
  - `success` → `isFailure=false`；`canceled` → `isFailure=false`；
  - `success` + durationMs≥3000 → `isSlow=true`；`success` + durationMs<3000 → `isSlow=false`；
  - `canceled` + durationMs≥3000 → `isSlow=false`；
  - `http_error` + 404 且 404∈additionalMonitoredStatusCodes → `isAdditionalMonitoredStatus=true`；
  - `http_error` + 404 且 404∉additionalMonitoredStatusCodes → `isAdditionalMonitoredStatus=false`；
  - `network_error`/`timeout`/`success`/`canceled` → `isAdditionalMonitoredStatus=false`；
- 项目覆盖规则：
  - `slowRequestThresholdMs=1000` 时 durationMs≥1000 → `isSlow=true`；
  - `failureStatusCodes` 含 404 → `http_error`+404 → `isFailure=true`；
  - `slowStatusCodes` 含 404 → `http_error`+404 → `isSlow=true`（即使 durationMs<阈值）；
  - `additionalMonitoredStatusCodes` 含 400 → `http_error`+400 → `isAdditionalMonitoredStatus=true`；
- 同时命中：503 且 durationMs≥阈值 → `isFailure=true` + `isSlow=true`；404 且 404∈failure 且 404∈additional → `isFailure=true` + `isAdditionalMonitoredStatus=true`；
- 确定性：同一输入调用 100 次结果一致；输入对象不被修改；
- 非法配置：`slowRequestThresholdMs` 非正数/非有限/非整数 → 抛 `RequestProcessingRulesAdapterError`（`invalid_rules`）；状态码集合含 <100、>599、非整数 → 抛 `invalid_rules`；
- 配置缺失（`rules` 未定义，类型断言绕过）→ 抛 `invalid_rules`；
- 冻结语义：工厂创建后修改原 `rules` 对象的集合/阈值不影响 `classify` 结果；
- 返回 `Promise` 且结果稳定；不调用 `Date.now`/`Math.random`/`process.env`；
- 不修改输入对象。

## 24. 真实 PostgreSQL 测试

在真实 PostgreSQL 17.10 上验证 adapter 与 Request Processor 组合（`AURORA_TEST_DATABASE_URL`；隔离/清理）：

- 使用真实 adapter（默认规则）注入 `createRequestEventProcessor`：
  - `success` + durationMs=200 → metric `applied`、`isFailure=false`、`isSlow=false` → 样本跳过 → `request_metric_buckets` 的 failure_count=0、slow_count=0；
  - `success` + durationMs=3200 → `isSlow=true` → 样本保存 → bucket slow_count=1、`request_event_samples` 一行；
  - `http_error` + 503 → `isFailure=true` → bucket failure_count=1、样本保存；
  - `network_error` → `isFailure=true` → bucket failure_count=1、样本保存；
  - replay 幂等：同一事件二次处理 → bucket 计数不重复、样本一行；
- 使用项目覆盖规则（`slowRequestThresholdMs=1000`、`additionalMonitoredStatusCodes` 含 404）：
  - 404 + durationMs=500 → `isAdditionalMonitoredStatus=true`、`isSlow=false` → 样本按 configured_status 保存；
  - `success` + durationMs=1200 → `isSlow=true` → slow_count 增加；
- Error Processor 回归、Request Sample Store 回归、Request Metric Store 回归；
- Inbox/Schema/Pool 完整隔离与清理。

## 25. Migration、回滚和兼容性影响

- **无 Migration**：本模块不新增数据库表、不修改任何表结构；
- **回滚**：adapter 是 `apps/ingestion-worker` 内部独立模块，回滚只需移除 `request-processing-rules-adapter.ts` 及其导出、测试与 README 条目，不影响 Request Processor 核心、processing-store、Inbox、Worker runtime 任何既有行为（processor 的分类端口仍可注入 fake 或任意实现）；
- **兼容性**：`ClassifyRequestEvent` 端口签名不变；`createRequestEventProcessor` 公共签名不变；`@aurora/event-schema`/`@aurora/processing-store` 公共 API 不变；request-event-contract 不变。

## 26. 与 PRD、ADR-019、ADR-020、Request Processor 的追踪矩阵

| 权威来源 | 条款 | 本模块落实 |
| --- | --- | --- |
| PRD 5.1.2 | 普通 4xx 默认不创建请求问题；项目可配置监控特定 4xx | `additionalMonitoredStatusCodes` 默认空；配置后 `isAdditionalMonitoredStatus=true`；`failureStatusCodes` 默认不含普通 4xx |
| PRD 5.1.3 | 慢请求默认阈值 3000ms、可配置；只保存最小信息；同时失败按错误采集 | `slowRequestThresholdMs` 默认 3000 可覆盖；adapter 只输出布尔不保存字段；isFailure/isSlow 独立 |
| PRD 5.1.5 | URL 归一化不改变实际请求；敏感查询值不保存 | 不适用（URL 已由协议层去查询/片段；adapter 不接触 URL） |
| PRD 5.1.6 | 跨域请求只保存安全摘要 | 不适用（跨域判断属 SDK 层；adapter 只分类已解析事件） |
| ADR-019 决定细节 3 | 允许保存样本的类别含"项目配置明确纳入请求问题的额外 HTTP 状态码""已通过 SDK 和服务端采样规则的慢请求" | `isAdditionalMonitoredStatus`/`isSlow` 由配置产生，供样本选择 `configured_status`/`slow_request` 使用 |
| ADR-019 决定细节 4 | 普通 400—428、430—499 默认不保存 | 默认 `additionalMonitoredStatusCodes`/`failureStatusCodes` 不含普通 4xx |
| ADR-019 决定细节 14 | 样本类别有界性由样本选择策略执行器强制 | adapter 不替代样本选择策略；只提供布尔分类 |
| ADR-020 决定细节 5 | Store 不承担分类；isFailure/isSlow 由未来 Processor 依据 approved 规则、项目配置和有效慢请求阈值产生 | adapter 即该产生器；Store 不硬编码阈值 |
| ADR-020 决定细节 20 | `persistRequestMetricContribution` 接收调用方显式 isFailure/isSlow | adapter 输出被 Processor 传入 metric 贡献 |
| Request Processor §9 | 分类端口只接收安全最小事实；本轮只用确定 fake | 本模块实现该端口的真实规则版本 |
| Request Processor §30 | 真实项目配置 Repository / production 分类 adapter not-started | 本模块（配置 adapter 核心能力）已实现；真实配置 Repository/生产接线仍后续 |

## 27. deferred 与 out-of-scope

- 真实配置存储（数据库/Redis/文件）、配置管理 HTTP API、管理平台 UI：deferred / 未来模块；
- 动态配置刷新与配置版本：deferred（本模块只支持创建时冻结快照）；
- 慢请求采样率（20%）与性能采样率（10%）执行：out-of-scope（SDK 端 + 未来采样模块）；
- SDK 请求 allowlist、路径归一化、同源/跨域判断：out-of-scope（SDK 配置与处理层）；
- 项目级覆盖规则的持久化与版本控制：deferred；
- 配置变更审计：deferred（属于管理平台审计域）。

## 28. 完成标准

- `createRequestProcessingRulesAdapter` 工厂与 `DEFAULT_REQUEST_PROCESSING_RULES` 实现并导出；
- `classify` 满足 §9 全部分类语义与 §10 确定性；
- 非法配置/缺失配置抛稳定 `RequestProcessingRulesAdapterError`（不静默降级）；
- 不可变快照与冻结语义有测试；
- 单元测试覆盖 §23 全部场景；
- 真实 PostgreSQL 集成测试覆盖 §24 全部场景并通过；
- 既有 Request Processor/Error Processor/Sample Selection/Metric/Sample 测试全部回归通过；
- `package-entry.test.ts`、`documentation-contract.test.ts`、`security-negative.test.ts` 同步；
- README、正式规格、formalization-readiness、docs/README、ADR-019/020 实施证据同步；
- 全仓质量门禁（typecheck/lint/unit/integration/coverage/boundaries/build/package/format/文档示例）通过；关键核心模块覆盖率 lines ≥ 85%、branches ≥ 80%。

## 29. ADR 判断

**不需要新 ADR**。理由：

- 本模块是既有 `ClassifyRequestEvent` 端口边界内的**普通配置 adapter 实现**：不改变五大系统边界、依赖方向、模块职责或公共协议；
- 不新增数据库、缓存、队列、基础设施或长期配置存储模型（配置为进程内注入，存储形式 deferred 到未来模块，届时由对应 ADR 决定）；
- 不扩大公共事件协议、不修改 request-event-contract、不改变 `@aurora/processing-store`/`@aurora/event-schema` 公共 API；
- 不改变隐私、采集或默认产品行为：默认规则逐条来自 approved PRD 5.1.2/5.1.3 与 accepted ADR-019/020，`additionalMonitoredStatusCodes`/`failureStatusCodes`/`slowStatusCodes` 默认为空（不扩大监控范围）；
- 分类语义全部由既有 accepted ADR-019/020 与 approved Request Processor 规格 §9 无歧义派生；
- 按架构规范 §2.11，本模块不属于必须创建 ADR 的变更类型。

## 30. 规格自检

- **权威一致性**：默认阈值 3000、失败状态码 429+500—599、额外状态码默认空、慢阈值可覆盖逐条映射 PRD 5.1.2/5.1.3 与 ADR-019 决定细节 3/4、ADR-020 决定细节 5/20；分类输入类型与 Request Processor §9 完全一致；不复制 processor/processing-store/sample-policy 逻辑；
- **兼容性**：不新增跨包依赖；无循环依赖；无私有深导入；worker 包根新增最小导出；`ClassifyRequestEvent`/`createRequestEventProcessor` 公共签名不变；既有 fake 分类继续可用；
- **安全与数据**：不接收/记录请求体、响应体、Header、Cookie、Authorization、完整 URL、查询参数、页面文本、用户信息；不写数据库；不写日志；不读取时间/环境变量；测试数据使用合成项目 ID 与合成状态码；
- **确定性**：同一输入结果一致；无随机、无隐藏状态、无时钟依赖；冻结快照；
- **范围控制**：只实现分类 adapter 核心能力；不实现真实配置存储、采样率执行、SDK allowlist/路径归一化、Request/Performance processor、Router、生产接线；
- **ADR 门禁**：无需新 ADR；ADR-019 保持 `accepted / in-progress`、ADR-020 保持 `accepted / implemented`。

## 31. 本轮联合模式审批记录

- **审批依据**：用户本轮联合模式指令明确授权 DAT-07 规格化 → 自检 → 受限自审批 → writing-plans → 自检 → 自动执行 → verification-before-completion 全流程；指令明确"不得因为需要普通确认而停在计划完成处，也不得询问选择哪一种执行方式"；
- **自检结果**：占位符扫描 pass；内部矛盾扫描 pass；单模块范围扫描 pass（未设计 DAT-08—11）；歧义扫描 pass（每条分类语义显式冻结）；PRD §5.1.2/5.1.3/5.1.5/5.1.6/§15 逐条覆盖；ADR-019/020 一致性 pass；Request Processor 接口一致性 pass；隐私字段审计 pass；依赖方向审计 pass；元数据/相对链接/文档命名检查 pass；
- **不需要 ADR 的依据**：见 §29——仅为既有分类端口边界内的配置 adapter 实现，不改变长期架构、公共协议、公共 API、安全或数据模型；
- **本轮用户自动继续授权**：规格满足"所有行为可追溯 approved PRD/长期规范/accepted ADR/approved Request Processor 规格；无新增产品/架构/安全/隐私/兼容/高迁移成本决策；不需要新 accepted ADR；无未解决歧义；无现有代码/公共接口冲突"，据此进入 `writing-plans`；
- **不代表任何 ADR 被 Agent 自行批准**：本记录只表示规格可进入计划阶段，ADR-019/020 状态不变，未创建、未接受任何新 ADR。
