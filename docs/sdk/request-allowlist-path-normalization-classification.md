---
title: 请求 allowlist、路径归一化与分类（SDK-11 第一增量）
status: approved
owner: sdk
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: @aurora/sdk 的请求分类模块（allowlist 判断、路径归一化、结果分类）与控制面请求处理路径
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
  - ../sdk/browser-request-source.md
  - ../sdk/request-capture-plugin.md
  - ../protocol/request-event-contract.md
  - sdk-public-configuration-context-composition.md
  - sdk-sampling-policy.md
supersedes: none
review-cycle: sdk-public-api-or-request-behavior-change
---

# 请求 allowlist、路径归一化与分类（SDK-11 第一增量）

## 1. 定位与批准来源

本文把 G05 叶子 SDK-11「请求 allowlist、路径归一化和分类」正式化为第一增量。它把 approved PRD §5.1.2—5.1.8、§5.1.14—5.1.15 的请求监控规则落实为 `@aurora/sdk` 的确定性机器行为；`url` 语义以 approved [request-event-contract.md](../protocol/request-event-contract.md) 为准。

批准来源：G05_APPROVAL_PACKAGE 缺口 3，用户 2026-08-10 批准全部推荐方案。允许来源/同源/跨域/路径归一化判断属 SDK 配置与处理层，不进入协议层。

## 2. 与协议层的边界

- 请求事件正文 `url` = 去除全部查询参数与片段的安全 HTTP(S) 绝对地址（协议层已强制）；
- 路径动态段归一化、开发者路径模板、allowlist/同源判断**不属于协议层**，由本模块在 SDK 层对已验证草稿应用；
- 本模块只读取已验证 `RequestEventBody`（经 `parseRequestEventBody`），不自行定义协议字段。

## 3. 公共 TypeScript 契约（`@aurora/sdk`）

```ts
export interface SdkRequestClassificationContext {
  readonly pageOrigin: string | null;          // 当前页面 origin，null 表示未知
  readonly sdkReportUrls?: readonly string[];  // SDK 自身上报地址（G06 提供前为空），默认排除
}

export type SdkRequestClass = 'error' | 'slow' | 'normal';

export interface SdkRequestClassificationResult {
  readonly ok: true;
  readonly class: SdkRequestClass;
  readonly normalizedUrl: string;              // 路径归一化后的安全绝对 URL
  readonly isError: boolean;
  readonly isSlow: boolean;
}

export interface SdkRequestDisallowed {
  readonly ok: false;
  readonly code: 'disallowed_request';
  readonly reason: 'not_allowed_origin' | 'ignored_url' | 'sdk_report_url';
}

export type SdkRequestDecision = SdkRequestClassificationResult | SdkRequestDisallowed;

export function classifyRequestEvent(
  draft: SdkEventDraft,
  config: SdkConfigSnapshot,
  context: SdkRequestClassificationContext,
): SdkRequestDecision;
```

## 4. 行为规则

### 4.1 allowlist 判断（决定是否成为请求事件）

按 PRD §5.1.4 顺序执行，任一命中即返回 `{ ok:false, code:'disallowed_request' }`：

1. **SDK 自身上报排除**：URL 命中 `sdkReportUrls`（G06 提供前为空，规则先落地）→ 拒绝；
2. **忽略 URL**：URL 匹配 `ignoredRequestUrls` 中任一条（大小写不敏感子串或精确来源）→ 拒绝；
3. **同源默认允许**：请求 origin 等于 `pageOrigin`，且 `excludeSameOriginRequests` 为 false → 允许；
4. **显式允许来源**：请求 origin 命中 `allowedRequestOrigins` 规范化条目 → 允许；
5. 其余跨域来源 → 拒绝（第三方分析/广告/地图/支付默认不监控，PRD §5.1.4）。

origin 解析规则：

- 从 URL 提取 `scheme + host + port` 三元组；host 小写、去除默认端口（http:80、https:443）；
- `allowedRequestOrigins` 只接受完整来源（含 scheme、host、可选端口），不接受包含路径的条目；非法条目在配置解析阶段已被丢弃；
- 受限通配符仅支持一层子域形式 `https://*.example.com`（匹配该域任意一层子域），不允许裸 `*` 或跨层通配；
- 请求来源为 `data:`、`blob:`、`file:` 或浏览器扩展协议 → 直接拒绝（不进入请求监控）。

### 4.2 路径归一化（生成接口标识）

处理顺序（PRD §5.1.5）：

1. 协议层已移除查询与片段（读取到的 `url` 即为安全地址）；
2. **开发者路径模板优先**：顺序匹配 `requestPathRules` 的 `pattern`；命中则用模板路径作为归一化结果（`pattern` 中 `:segment` 保持为占位形式，模板名不进入 wire url）；
3. **高置信度动态段识别**：对未命中模板的路径，将满足以下任一形式的路径段替换为稳定占位符：
   - 纯数字 → `:number`；
   - UUID（8-4-4-4-12 hex）→ `:uuid`；
   - 32 位以上十六进制哈希 → `:hash`；
   - 其他形式（普通英文单词、短编号、业务缩写）**不替换**，避免把真实路由名误判为动态参数（PRD §5.1.5）；
4. 无法确定时保持原样，不猜测。

归一化结果仍是安全 HTTP(S) 绝对 URL，必须继续通过 `parseRequestEventBody` 校验；本模块不把请求正文当作原始完整 URL 长期保存。

### 4.3 结果分类

基于 `RequestEventBody` 的 `outcome`、可选 `statusCode` 与 `durationMs` 与配置：

- **error**（网络失败/429/5xx 或配置扩展状态码）：
  - `outcome` 为网络失败；
  - `statusCode` 为 `429` 或 `500..599`；
  - `statusCode` 命中 `extraErrorStatusCodes`（PRD §5.1.2「项目可以明确开启状态码范围」）；
  - 其余 4xx 默认不作为 error（大部分 4xx 属业务校验/未登录/输入问题，PRD §5.1.2）。
- **slow**：`durationMs >= slowRequestThreshold`（默认 3000，PRD §5.1.3）；
- **normal**：其余。

`isError` 与 `isSlow` 分别独立判定；error 且 slow 同时为 true 时，采样按 error 优先（见 [sdk-sampling-policy.md](sdk-sampling-policy.md)）。

### 4.4 隐私负例

- 不采集请求体、响应体、请求头、响应头、Cookie、Authorization、Token；
- 不保留 URL 查询参数值、敏感参数名或片段；
- 归一化过程不读取或保存原始敏感路径值；
- `classifyRequestEvent` 不修改输入草稿（返回新对象），不记录 URL 到实例外状态。

## 5. 测试与门禁

- 单元测试（Node 无 DOM）覆盖：同源默认允许/关闭、跨域默认拒绝、`allowedRequestOrigins` 精确与通配、`ignoredRequestUrls`、SDK 自身上报排除、非 http(s)/data:/blob:/file: 拒绝；
- 路径归一化：数字/UUID/hex → 占位符、英文单词/短编号不替换、开发者模板优先、模板不命中自动识别、无法确定原样保留、结果通过 `parseRequestEventBody`；
- 分类：网络失败/429/5xx/`extraErrorStatusCodes` → error；`durationMs >= 阈值` → slow；其余 → normal；error 优先采样语义；
- 隐私负例：请求正文不泄露 body/凭据/敏感参数；输入不变；
- 包入口、无 DOM 编译、覆盖率门槛（行 85/分支 80/函数 85/语句 85）；
- 既有 `@aurora/plugin-request` 与 `@aurora/browser` 测试无回归。

## 6. 文档与 ADR 同步

- `packages/sdk/README.md`：记录请求分类公共入口与规则摘要；
- `docs/README.md`：索引本规格；
- `docs/architecture/sdk-architecture.md`：把「允许来源/同源/跨域/路径归一化判断」从未实现更新为 SDK-11 已实现；
- `AGENTS.md`/`AURORA_RULES.md`：同步 G05 状态（SDK-11 关闭后计数）。

## 7. deferred 与边界

- `safeQueryParamNames` 安全参数名保留：wire 请求契约移除全部查询参数，该特性需要协议变更，**deferred**（记录为协议变更候选）；
- 通配符仅一层子域；多级/裸 `*` 不支持；
- 请求问题聚合、指纹、代表样本、告警（G03/G04）不提前实现。
