# @aurora/sdk

Aurora SDK 公共控制面：环境无关的配置模型、统一隐私过滤、`beforeSend`、确定性采样与请求分类，以及控制面工厂 `createSdkControlPlane`。

本包位于 `aurora.layer: sdk-core`，唯一运行时依赖 `@aurora/event-schema`；源码不引用 DOM、`URL`、Node 运行时全局，保证无 DOM 编译与多实例隔离。

## 职责

- **配置**：`parseSdkConfig` 把 `SdkConfigInput` 规范化为冻结的 `SdkConfigSnapshot`，缺失/非法字段回退安全默认值并记录 `SdkConfigFix`；`clientKey` 必填。
- **统一隐私过滤**：`applySdkPrivacyFilter` 对有界正文做禁止字段拒绝与 URL 查询/片段剥离，绝不修改输入。
- **beforeSend**：`applySdkBeforeSend` 顺序执行用户回调，返回空值丢弃、非法返回丢弃、回调异常隔离且不影响宿主。
- **确定性采样**：`decideEventSample`/`decideSdkSample` 基于 FNV-1a 64 位稳定键，同一事件重试/多实例判定一致，无采样外推。
- **请求分类**：`classifyRequestEvent` 落实 PRD §5.1.2—5.1.8——allowlist 判断、路径归一化（动态段/开发者模板）与 error/slow/normal 分类，不采集 body/凭据/未批准查询参数。
- **控制面**：`createSdkControlPlane` 按 `隐私过滤 → beforeSend → 请求分类 → 采样` 顺序处理草稿，`processEvent`/`submit` 返回稳定结果。

## 明确非职责

- 不实现队列、批处理、去重、传输、重试、持久化（G06）；
- 不实现 Vue/React 适配（G07）；
- 不改变 `@aurora/core` 公共 API 或 wire 协议（ADR-005）；
- 不保存请求/响应体、Cookie、Authorization、Token、表单、完整 DOM/文本或指纹。

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

相关规格：[SDK 公共配置上下文与 composition](../docs/sdk/sdk-public-configuration-context-composition.md)、[请求 allowlist/路径归一化/分类](../docs/sdk/request-allowlist-path-normalization-classification.md)、[统一隐私过滤与 beforeSend](../docs/sdk/unified-privacy-filtering-and-beforesend.md)、[SDK 采样策略](../docs/sdk/sdk-sampling-policy.md)、[安全操作轨迹与有界缓冲](../docs/sdk/safe-activity-trail-and-bounded-buffer.md)。
