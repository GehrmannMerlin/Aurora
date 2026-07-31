---
title: Aurora SDK 架构、生命周期与插件边界
status: approved
owner: sdk
last-reviewed: 2026-07-29
applies-to: Aurora SDK Core、Browser、采集插件、Vue/React 适配和公共行为
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../../Aurora 架构规范.md
  - ../../Aurora 代码规范.md
  - ../../Aurora 测试规范.md
  - system-overview.md
  - ../testing/test-strategy.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../superpowers/specs/2026-07-28-aurora-foundation-topic-approval-baseline.md
  - ../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
supersedes: none
review-cycle: sdk-api-or-release
---

# Aurora SDK 架构、生命周期与插件边界

## 1. 权威范围

本文维护 SDK 的稳定职责、层次、生命周期和宿主安全行为。具体公共 TypeScript API、配置 Schema、事件 Schema、包名和安装示例除已实施部分外尚不存在，状态为 `deferred`；不得从本文推导虚假签名。ADR-003、ADR-005 和 ADR-006 已成为 `accepted`：`@aurora/event-schema` 协议基础第一增量（版本化公共信封、运行时边界校验、稳定错误和共享契约样本）和 `@aurora/core` 生命周期与插件编排基础第一增量（环境无关 Core、显式 `created/initialized/started/stopped/destroyed` 生命周期、最小冻结配置、插件注册与顺序编排、异常隔离、`submitEvent` 事件入口和多实例隔离）已实施为真实私有包，`@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量（安全环境与能力探测、脱敏页面快照、`visibilitychange`/`pagehide`/`pageshow` 生命周期订阅、幂等释放、异常隔离和多实例隔离）已实施为真实私有包，ADR-003/005/006 均为 `in-progress`。错误、请求、性能、资源和行为插件仍不存在，传输与框架适配仍不存在；采样、队列、传输、持久化、完整 SDK 公共 API、具体事件正文和兼容/性能证据仍不存在，状态为 `deferred`、`requires-benchmark` 或 `requires-accepted-adr`。Core 根公开入口与排除范围见 [packages/core/README.md](../../packages/core/README.md)，Browser 根公开入口与排除范围见 [packages/browser/README.md](../../packages/browser/README.md)，批准规格见 [SDK Core 基础规格](../sdk/sdk-core-foundation.md)与 [Browser 环境基础规格](../sdk/browser-environment-foundation.md)。

## 2. 分层职责

| 层       | 职责                                                                     | 可以依赖                  | 禁止                                                |
| -------- | ------------------------------------------------------------------------ | ------------------------- | --------------------------------------------------- |
| Core     | 配置快照、生命周期、事件管道、隐私/采样、队列/重试、传输抽象和多实例隔离 | 公共协议、注入端口        | DOM、浏览器全局、具体插件/框架、直接宿主副作用      |
| Browser  | 环境能力检测、原生 API 安全包装、监听/代理注册与恢复                     | Core 公开接口、公共协议   | 业务聚合、独立上报、绕过生命周期                    |
| 采集插件 | 错误、请求、性能和有限行为信号的监听、转换与释放                         | Core/Browser/协议公开接口 | 独立队列/发送、访问私有状态、依赖其他插件内部实现   |
| 框架适配 | Vue/React 的安装入口、框架错误衔接和上下文转换                           | 已公开 SDK 接口           | 复制 Core/Browser、维护另一条上报通道、改变事件协议 |

分层不等于强制每个能力成为独立包；真实包边界由 accepted ADR 与包体/构建证据决定。

## 3. 生命周期语义

- 初始化必须创建不可变或版本化配置快照；外部传入对象后续变化不能静默改变运行行为；
- 重复初始化必须有明确结果，不能重复安装监听、代理、定时器或队列；
- `start` 只激活已配置能力，`stop` 停止新采集但保留可安全处理的内部状态，`destroy` 释放监听、代理、计时器、缓存和实例引用；
- 原生 API 包装必须保存原引用，并在最后一个使用者释放时恢复；多实例不能提前恢复或覆盖其他实例包装；
- 插件安装、启动、停止和销毁失败必须被隔离并可观测，不能抛向宿主或阻止其他插件释放；
- 页面卸载、网络不可用和重试不能形成无界资源占用；队列、批次、重试、退避和内存均有上限。

上述方法名只是行为类别；实际公开签名属于 `deferred` 机器契约。

## 4. 统一事件管道

所有插件和框架适配产生的候选事件必须进入同一顺序：能力检查与启用判断 → 规范化 → 隐私过滤 → Schema/限制 → 采样 → 队列/批次 → 传输。任何层都不能在管道外发送数据。

公共事件结构、枚举和限制只能来自未来 `event-schema` 机器来源。SDK 本地类型、服务端模型和文档不得复制协议权威；在 Schema 不存在前，本节只固定职责与失败边界。

## 5. 宿主安全与隐私

- SDK 自身错误不冒泡到宿主，不修改业务返回值或异常语义；
- 包装 `fetch`、XHR、History、事件监听或性能观察器时保持原语义、`this`、参数、返回值和异常；
- 默认不采集请求/响应体、Cookie、Authorization、表单内容、密码/验证码、完整 DOM/文本、完整行为轨迹、控制台正文、完整 IP 或指纹；
- URL、Header、堆栈和上下文必须在入队前完成允许列表与去敏；秘密不得进入 SDK 日志；
- 资源保护触发时优先丢弃低优先级遥测并记录安全统计，不得阻塞主线程或无限重试。

## 6. 公共失败行为

SDK 必须区分永久拒绝和可重试失败；不对鉴权、来源、Schema、大小或不支持版本等永久拒绝盲目重试。批次部分结果按单条结果处理，不能因一条失败重复发送已确认事件。接收成功不代表异步处理完成，C1/C7 的状态由服务端权威返回。

传输错误、队列溢出、插件异常和配置拒绝必须使用稳定、去敏且不影响宿主的可观测方式；具体错误类型和回调属于公共 API 机器契约。

## 7. 兼容与性能预算

批准设计预算包括：Core 基础包 gzip 不超过 10 KiB，Browser＋Core 最小接入不超过 30 KiB，单插件增量不超过 8 KiB，单框架适配增量不超过 5 KiB；初始化桌面 p95 不超过 20 ms、中档移动 p95 不超过 50 ms；不产生 SDK 归因的单次大于 50 ms 长任务，稳态附加 Heap 不超过 5 MiB，包装调用 p95 不超过 1 ms。

这些是发布门槛，不是已测结果。精确浏览器/框架版本、参考工程、设备和网络档位属于 `requires-benchmark`，真实支持承诺必须由测试证据支撑。

## 8. 验证门禁

未来实现至少需要：无 DOM Core 编译/单测；重复初始化和多实例；监听/代理完整恢复；插件异常隔离；批次部分失败和有界重试；隐私禁止字段；真实 Chromium/Firefox/WebKit 及关键 Safari/移动设备；Vue/React 示例；包 exports/tree-shaking/体积；长任务、内存和宿主语义回归。

截至 2026-07-30，`@aurora/core` 基础第一增量已通过无 DOM 编译、ESLint 浏览器全局禁用、Workspace 依赖层级（`sdk-core → protocol`）、私有入口拒绝、循环依赖检查、模块级可变状态禁用、生命周期/配置/插件/事件/诊断/多实例单元测试和 85/80/85/85 覆盖率门禁。`@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量已通过 strict DOM 类型编译、`sdk-browser → sdk-core | protocol` 依赖层级与反向/插件/框架/私有路径/循环/模块可变状态/宿主修改负例、私有入口拒绝、能力/快照/生命周期/宿主安全/多实例单元测试、85/80/85/85 覆盖率门禁和本地 Chromium 生命周期/释放/宿主身份/异常/多实例真实浏览器门禁。`submitEvent` 的 `accepted` 只表示 Core 已启动且信封通过 `@aurora/event-schema` 校验，不构成采样、排队、传输或持久化。错误、请求、性能、资源和行为插件仍不存在；适配器、采样、队列、传输、持久化、包体测量和性能基准仍无实现或证据，不能声称上述门禁已经通过。
