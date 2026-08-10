---
title: 统一隐私过滤与 beforeSend（SDK-12 第一增量）
status: approved
owner: sdk
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: @aurora/sdk 的统一隐私过滤器与 beforeSend 包装器，控制面处理路径中的隐私与宿主安全
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
  - ../sdk/sdk-core-foundation.md
  - ../sdk/browser-error-source.md
  - ../sdk/browser-request-source.md
  - ../protocol/event-schema-foundation.md
  - ../protocol/error-event-contract.md
  - sdk-public-configuration-context-composition.md
supersedes: none
review-cycle: sdk-public-api-or-privacy-change
---

# 统一隐私过滤与 beforeSend（SDK-12 第一增量）

## 1. 定位与批准来源

本文把 G05 叶子 SDK-12「统一隐私过滤与 `beforeSend`」正式化为第一增量。它把 approved PRD §5.1.13—5.1.14、§14.3 的隐私与回调语义落实为 `@aurora/sdk` 的确定性机器行为，并保证用户 `beforeSend` 回调异常**不影响宿主页面**。

批准来源：G05_APPROVAL_PACKAGE 缺口 4，用户 2026-08-10 批准全部推荐方案。

## 2. 处理顺序（PRD §5.1.14，控制面强制）

```text
捕获事件 → 规范化字段 → 默认敏感信息过滤 → 执行 beforeSend → 应用采样规则 → 进入内存发送队列
```

本增量实现「默认敏感信息过滤」与「执行 beforeSend」两个阶段；采样见 [sdk-sampling-policy.md](sdk-sampling-policy.md)，队列（G06）不在本增量。

## 3. 公共 TypeScript 契约（`@aurora/sdk`）

### 3.1 统一隐私过滤

```ts
export type SdkPrivacyFilterCode = 'ok' | 'forbidden_field' | 'invalid_draft';

export interface SdkPrivacyFilterResult {
  readonly ok: boolean;
  readonly code: SdkPrivacyFilterCode;
  readonly event?: SdkEventDraft;              // ok 时的净化草稿（新对象，输入不变）
}

export function applySdkPrivacyFilter(draft: SdkEventDraft): SdkPrivacyFilterResult;
```

- 对草稿正文递归做有界扫描（复用 `@aurora/event-schema` 的字段名归一化规则：ASCII 小写、去除 `_`/`-`），命中禁止字段（`authorization`、`cookie`、`password`、`requestbody`、`responsebody`、`formdata`、`dom`、`consolelog`、`ipaddress`、`token`、`access_token`/`accessToken`、`refresh_token`/`refreshToken`）→ `{ ok:false, code:'forbidden_field' }`；
- 对 URL 类型字符串字段，移除查询参数与片段（请求 URL 已由协议层处理；本过滤作为纵深防御同样适用于错误资源 URL 等字段）；
- 扫描深度与数量有界（沿用 `EVENT_SCHEMA_LIMITS`：字符串 4096、数组 100、对象键 100、深度 8、issue 50），遇循环引用 → `invalid_draft`；
- 返回新对象，不修改输入，不记录输入值；
- 过滤结果不替代服务端强制过滤（PRD §14.3：客户端配置不能绕过服务端禁止规则）。

### 3.2 beforeSend 包装器

```ts
export type SdkBeforeSend =
  | SdkBeforeSendFunction
  | readonly SdkBeforeSendFunction[];          // 顺序执行，返回空值即丢弃

export type SdkBeforeSendFunction = (
  event: Readonly<SdkEventDraft>,
) => unknown;                                   // 返回草稿则继续；返回 null/undefined 则丢弃；返回非法值则丢弃

export type SdkBeforeSendCode = 'kept' | 'dropped' | 'invalid_return' | 'callback_threw';

export interface SdkBeforeSendResult {
  readonly code: SdkBeforeSendCode;
  readonly event?: SdkEventDraft;              // kept 时的草稿（可被回调修改）
}

export function applySdkBeforeSend(
  draft: SdkEventDraft,
  beforeSend: SdkBeforeSend,
): SdkBeforeSendResult;
```

语义（PRD §14.3 + 宿主安全）：

- 允许开发者删除字段、修改字段、丢弃事件、进一步脱敏；
- `beforeSend` **不能重新加回**已被隐私过滤移除的数据：返回值必须再次通过 `applySdkPrivacyFilter`，否则按 `invalid_return` 丢弃；
- 回调**同步抛错**或返回 Promise 拒绝 → 捕获并返回 `callback_threw`，事件**丢弃**，绝不向宿主冒泡；诊断只记录稳定码，不记录异常消息/堆栈/事件内容；
- 返回 `null`/`undefined` → `dropped`（PRD §5.1.14：返回空值即丢弃）；
- 返回非法形状（非 `{ eventType, body }` 对象、`eventType` 不在 `EventType`、正文非法）→ `invalid_return` 丢弃；
- 多个回调顺序执行，任一返回丢弃/异常即终止。

### 3.3 控制面集成

`SdkControlPlane.processEvent` 在采样前固定执行：`applySdkPrivacyFilter` → `applySdkBeforeSend`（若配置了 `beforeSend`）。过滤/回调失败对应 `SdkDroppedEvent`（`invalid_draft`/`dropped_by_before_send`）。

## 4. 隐私负例与边界

- 不采集请求/响应体、Cookie、Authorization、Token、表单内容、完整 DOM/文本、控制台正文、完整 IP 或设备/浏览器指纹；
- SDK 不默认读取页面登录账号、Cookie、localStorage 中的用户资料（PRD §5.1.11）；
- 用户回调异常不改变宿主页面异常处理，不调用宿主 console（SDK 诊断为私有有界存储）；
- 过滤与 beforeSend 均在采样前执行，与 PRD §5.1.14 顺序一致。

## 5. 测试与门禁

- 隐私过滤：每类禁止字段在嵌套正文中拒绝、URL 字段去查询/片段、深度/数量有界、循环引用、输入不变、结果冻结；
- beforeSend：返回草稿继续、返回空丢弃、返回非法丢弃、抛错/拒绝丢弃且不冒泡、多回调顺序、**不可 re-add 过滤数据**；
- 控制面集成：过滤失败/回调失败对应丢弃码；采样前顺序固定；
- 多实例隔离、包入口、无 DOM 编译、覆盖率门槛（行 85/分支 80/函数 85/语句 85）；
- 既有 `@aurora/event-schema`、`@aurora/core`、插件测试无回归。

## 6. 文档与 ADR 同步

- `packages/sdk/README.md`：记录隐私过滤与 beforeSend 公共入口、丢弃语义、宿主安全保证；
- `docs/README.md`：索引本规格；
- `docs/architecture/sdk-architecture.md`：把统一隐私/采样管道从未实现更新为 SDK-12 已实现；
- ADR-003：追加 SDK-12 实施证据，保持 `in-progress`；
- `AGENTS.md`/`AURORA_RULES.md`：同步 G05 状态（SDK-12 关闭后计数）。

## 7. deferred 与边界

- 服务端强制过滤（接入层）仍由接入/处理层负责，不在 SDK；
- 用户上下文/业务用户编号采集归用户上下文模块，不在本增量；
- 完整脱敏器（自动识别所有业务敏感字段）不实现（PRD §5.1.16）。
