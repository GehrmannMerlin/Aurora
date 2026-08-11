# @aurora/sdk

Aurora SDK 公共控制面与可靠发送链：环境无关的配置模型、统一隐私过滤、`beforeSend`、确定性采样与请求分类、有界内存发送队列、批次构造、去重、重试分类、有界退避与交付链编排。

本包位于 `aurora.layer: sdk-core`，唯一运行时依赖 `@aurora/event-schema`；源码不引用 DOM、`URL`、Node 运行时全局（宿主调度器 `schedule` 由 composition 注入），保证无 DOM 编译与多实例隔离。

## 职责

- **配置**：`parseSdkConfig` 把 `SdkConfigInput` 规范化为冻结的 `SdkConfigSnapshot`，缺失/非法字段回退安全默认值并记录 `SdkConfigFix`；`clientKey` 必填。
- **统一隐私过滤**：`applySdkPrivacyFilter` 对有界正文做禁止字段拒绝与 URL 查询/片段剥离，绝不修改输入。
- **beforeSend**：`applySdkBeforeSend` 顺序执行用户回调，返回空值丢弃、非法返回丢弃、回调异常隔离且不影响宿主。
- **确定性采样**：`decideEventSample`/`decideSdkSample` 基于 FNV-1a 64 位稳定键，同一事件重试/多实例判定一致，无采样外推。
- **请求分类**：`classifyRequestEvent` 落实 PRD §5.1.2—5.1.8——allowlist 判断、路径归一化（动态段/开发者模板）与 error/slow/normal 分类，不采集 body/凭据/未批准查询参数。
- **控制面**：`createSdkControlPlane` 按 `隐私过滤 → beforeSend → 请求分类 → 采样` 顺序处理草稿，`processEvent`/`submit` 返回稳定结果。
- **安全操作轨迹**：`createSdkActivityTrail` 提供有界缓冲（默认 30、丢最旧、多实例隔离）；控制面暴露 `recordActivity`/`getActivityTrail` 并自动记录 `request_summary`/`prior_error`/`sdk_report` 安全事实；轨迹**不进 wire 事件**（SDK-14）。
- **内存发送队列**（SDK-15）：`createSdkDeliveryQueue` 有界容量（默认 256）、error-first 优先级、溢出丢最低优先级或拒绝入队、eventId 去重、`reenqueue` 保留同一 `EventEnvelope`（重试 ID 稳定）、clear/destroy 生命周期与多实例隔离。
- **批次构造**（SDK-15）：`buildDeliveryBatch` 把信封数组构造为 `IngestionBatchRequest`，引用 `BATCH_EVENT_LIMITS.maxEventsPerBatch=50` 与 `CURRENT_PROTOCOL_VERSION`。
- **传输端口与重试分类**（SDK-16）：`SdkBatchTransport` 注入端口；`classifySdkHttpStatus`/`classifySdkReceiptState`/`classifySdkTransportReason` 落实 PRD §6.3——400/401/403/413/415/0 永久拒绝，408/429/5xx/网络/超时/`temporarily_failed` 可重试（尊重 `retryAfterMs`）。
- **有界退避**（SDK-16）：`calculateSdkRetryDelay` capped exponential backoff + equal jitter，服务端 `retryAfterMs` 封顶 `maxDelayMs`。
- **交付链**（SDK-16）：`createSdkDeliveryChain` 编排 enqueue→queue→batch→transport→receipt——成功/`duplicate_accepted` 移除、`permanently_rejected` 丢弃不重试、`temporarily_failed` 有界重试；`flush({bestEffort})` 可控可结束；partial receipt 逐事件处理不整批失败；transport 异常隔离不破坏宿主；有界诊断与多实例隔离。

## 明确非职责

- 不实现浏览器持久化离线队列（PRD §6.2 明确不做）；
- 不实现 Vue/React 适配（G07）；
- 不改变 `@aurora/core` 公共 API 或 wire 协议（ADR-005）；
- 不保存请求/响应体、Cookie、Authorization、Token、表单、完整 DOM/文本或指纹；
- 不创建第二套信封或协议版本（事件 ID/时间/版本由 `@aurora/core` 生成）。

## 处理顺序（PRD §5.1.14）

```text
捕获草稿 → 统一隐私过滤 → beforeSend → 请求分类（仅 request）→ 采样判定 → 轨迹记录（SDK-14）
```

## 开发与测试

```bash
pnpm --filter @aurora/sdk typecheck
pnpm --filter @aurora/sdk test
pnpm --filter @aurora/sdk test:coverage
pnpm --filter @aurora/sdk test:package
```

覆盖率门槛：行 85% / 分支 80% / 函数 85% / 语句 85%（本包 `vitest.config.ts` 固定）。

相关规格：[SDK 公共配置上下文与 composition](../docs/sdk/sdk-public-configuration-context-composition.md)、[请求 allowlist/路径归一化/分类](../docs/sdk/request-allowlist-path-normalization-classification.md)、[统一隐私过滤与 beforeSend](../docs/sdk/unified-privacy-filtering-and-beforesend.md)、[SDK 采样策略](../docs/sdk/sdk-sampling-policy.md)、[安全操作轨迹与有界缓冲](../docs/sdk/safe-activity-trail-and-bounded-buffer.md)、[SDK 可靠发送链（SDK-15/16）](../docs/sdk/sdk-reliable-delivery-chain.md)。
