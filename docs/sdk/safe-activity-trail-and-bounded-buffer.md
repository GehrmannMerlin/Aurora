---
title: 安全操作轨迹与有界缓冲（SDK-14 第一增量）
status: approved
owner: sdk
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: @aurora/sdk 的安全操作轨迹契约、有界缓冲与控制面轨迹集成
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora ADR 规范.md'
  - ../architecture/sdk-architecture.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../protocol/event-schema-foundation.md
  - ../sdk/sdk-core-foundation.md
  - sdk-public-configuration-context-composition.md
  - unified-privacy-filtering-and-beforesend.md
supersedes: none
review-cycle: sdk-public-api-or-privacy-change
---

# 安全操作轨迹与有界缓冲（SDK-14 第一增量）

## 1. 定位与批准来源

本文把 G05 叶子 SDK-14「安全操作轨迹与有界缓冲」正式化为第一增量。它把 approved PRD §5.1.10、§5.1.13—5.1.14、§14 的安全事实边界落实为 `@aurora/sdk` 的轨迹条目契约与有界缓冲。

批准来源：G05_APPROVAL_PACKAGE 缺口 6，用户 2026-08-10 批准全部推荐方案。**轨迹作为 SDK 侧有界诊断，不进 wire 事件**（wire 集成 deferred，待独立协议规格另行批准）。

## 2. 用途与边界（PRD §5.1.10）

- 轨迹只用于解释错误发生前发生了什么，**不用于用户行为分析**；
- 错误事件默认附带最近最多 30 条安全操作轨迹（本增量提供缓冲能力；wire 附加 deferred）；
- 默认记录：页面进入与路由变化、请求开始/完成/失败摘要、静态资源加载失败、SDK 主动上报动作、前一个已捕获错误的摘要；
- 默认不记录：表单输入内容、页面文本、鼠标坐标轨迹、完整点击行为、剪贴板内容、`console.log` 正文、请求体和响应体；
- 禁止：Session Replay、完整行为轨迹、完整 DOM、密码、token、Cookie、Authorization、用户敏感内容、完整 IP 或指纹。

## 3. 轨迹条目契约（`@aurora/sdk`）

```ts
export type SafeActivityEntryKind =
  | 'page_enter'
  | 'route_change'
  | 'request_summary'
  | 'resource_error'
  | 'sdk_report'
  | 'prior_error';

export interface SafeActivityEntryBase {
  readonly kind: SafeActivityEntryKind;
  readonly occurredAt: number;              // Unix epoch 毫秒安全整数（合成，非真实时间敏感字段）
  readonly sequence: number;                // 实例内自增序号（从 1 起）
}

export interface SafePageEnterEntry extends SafeActivityEntryBase {
  readonly kind: 'page_enter';
  readonly origin: string;
  readonly pathname: string;
}

export interface SafeRouteChangeEntry extends SafeActivityEntryBase {
  readonly kind: 'route_change';
  readonly pathname: string;
}

export interface SafeRequestSummaryEntry extends SafeActivityEntryBase {
  readonly kind: 'request_summary';
  readonly method: string;
  readonly normalizedUrl: string;           // 路径归一化后的安全 URL
  readonly outcome: string;                 // RequestOutcome 值
  readonly statusCode?: number;
  readonly durationMs: number;
}

export interface SafeResourceErrorEntry extends SafeActivityEntryBase {
  readonly kind: 'resource_error';
  readonly normalizedUrl: string;           // 去除查询/片段的资源 URL
}

export interface SafeSdkReportEntry extends SafeActivityEntryBase {
  readonly kind: 'sdk_report';
  readonly action: string;                  // 稳定动作码（如 event_submitted / sample_dropped）
}

export interface SafePriorErrorEntry extends SafeActivityEntryBase {
  readonly kind: 'prior_error';
  readonly errorClass: string;              // 稳定错误类别（ErrorCategory 值），不含消息/堆栈
  readonly normalizedUrl?: string;          // 与错误关联的页面/资源 URL（去除查询/片段）
}

export type SafeActivityEntry =
  | SafePageEnterEntry
  | SafeRouteChangeEntry
  | SafeRequestSummaryEntry
  | SafeResourceErrorEntry
  | SafeSdkReportEntry
  | SafePriorErrorEntry;
```

所有条目只含上述安全字段；不含消息文本、堆栈、表单值、DOM 文本、凭据、请求/响应正文、完整 IP 或指纹。

## 4. 有界缓冲（`@aurora/sdk`）

```ts
export type SdkRecordActivityCode = 'recorded' | 'invalid_entry' | 'disabled' | 'destroyed';

export interface SdkRecordActivityResult {
  readonly ok: boolean;
  readonly code: SdkRecordActivityCode;
  readonly sequence: number;               // recorded 时分配的序号
  readonly droppedOldest: number;          // 本次因容量丢弃的旧条目数（0..n）
}

export interface SdkActivityTrail {
  readonly capacity: number;               // 上限（默认 30）
  readonly entries: readonly SafeActivityEntry[];
  readonly record: (entry: unknown) => SdkRecordActivityResult;
  readonly destroy: () => void;
}

export function createSdkActivityTrail(options?: {
  readonly capacity?: number;              // 1..1000，默认 30
  readonly enabled?: boolean;              // 默认 true（PRD 默认记录）
}): SdkActivityTrail;
```

- 容量固定为 `capacity`；达到上限时**丢弃最旧**条目，保持确定性容量行为；
- `sequence` 实例内从 1 自增，容量收缩只移除旧条目，不重置序号；
- 非法条目（非安全对象、未知 kind、字段类型错误）→ `invalid_entry`，不记录；
- `enabled === false` → `disabled`（PRD「是否启用用户交互轨迹」配置门控）；
- `destroy()` 清空条目并置为 `destroyed`，之后 `record` 返回 `destroyed`；
- 每次返回新冻结数组与新冻结条目，调用方不能修改内部记录；
- 多实例隔离：每次 `createSdkActivityTrail` 独立持有状态，无模块级可变容器。

## 5. 控制面集成

`SdkControlPlane` 持有 `SdkActivityTrail` 实例：

- 暴露 `recordActivity(entry)` 与 `getActivityTrail()`；
- 在处理请求草稿时记录 `request_summary`（method、归一化 URL、outcome、statusCode、durationMs）；
- 在处理错误草稿时记录 `prior_error`（errorClass、关联安全 URL）；
- 事件提交成功记录 `sdk_report { action:'event_submitted' }`，采样丢弃记录 `sdk_report { action:'sample_dropped' }`；
- 轨迹记录发生在隐私过滤之后，只记录已通过隐私过滤的安全事实；
- composition 在 SDK 启动时用浏览器环境安全页面快照（origin+pathname）记录 `page_enter`；
- `route_change` 的生产依赖路由适配（G07 框架适配或后续导航源），本增量不实现；`resource_error` 生产复用错误源资源错误事实，本增量仅定义条目类型，不在插件中新增采集。

## 6. 测试与门禁

- 缓冲：容量固定、超限丢最旧、确定性容量行为、sequence 自增、destroy 清理、多实例隔离；
- 条目契约：每类条目只接受批准字段、非法条目拒绝、字段类型错误拒绝、结果冻结；
- 隐私负例：不记录消息/堆栈/表单值/DOM 文本/凭据/正文/完整 IP；输入不变；
- 控制面集成：request/error 摘要记录、event_submitted/sample_dropped 记录、`enabled=false` 禁用、destroy 后拒绝；
- 包入口、无 DOM 编译、覆盖率门槛（行 85/分支 80/函数 85/语句 85）；
- 既有 `@aurora/core`/插件测试无回归；不新增 Browser/Chromium 测试（本增量无新浏览器运行时行为）。

## 7. 文档与 ADR 同步

- `packages/sdk/README.md`：记录轨迹契约、缓冲语义、隐私边界、不进 wire；
- `docs/README.md`：索引本规格；
- `docs/architecture/sdk-architecture.md`：把安全操作轨迹从未实现更新为 SDK-14 已实现（wire 附加仍 blocked）；
- `AGENTS.md`/`AURORA_RULES.md`：同步 G05 状态（SDK-14 关闭后计数）。

## 8. deferred 与边界

- 轨迹**进入 wire 事件**：deferred（待独立协议规格 + ADR-005 门禁），本增量只提供 SDK 侧有界诊断；
- `route_change` 生产（框架导航适配）归 G07；
- 错误问题聚合（把轨迹用于 Issue 上下文）归 G03/G11；
- 完整行为轨迹、Session Replay、行为分析永不进入第一版。
