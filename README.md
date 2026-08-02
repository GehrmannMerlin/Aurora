---
title: Aurora 仓库入口
status: approved
owner: documentation
last-reviewed: 2026-07-30
applies-to: Aurora 仓库文档、未来代码模块与贡献入口
related:
  - AGENTS.md
  - AURORA_RULES.md
  - docs/README.md
  - docs/architecture/system-overview.md
  - docs/architecture/formalization-readiness.md
  - docs/adr/README.md
supersedes: none
review-cycle: milestone-or-release
---

# Aurora

Aurora 是面向前端应用的监控 SDK 与管理平台。第一版业务范围和设计已经形成批准基线，ADR-001—ADR-009 已完成正式审批（ADR-009 于 2026-08-01 批准数据接入公开传输与客户端上报密钥语义）；首个私有 Monorepo 根 Workspace 与最小本地工程工具模块已实施，`@aurora/event-schema` 协议基础第一增量（版本化公共信封、运行时边界校验、稳定错误和共享契约样本）及其错误事件协议契约第一增量（JavaScript 运行时错误、未处理 Promise 拒绝和资源加载错误正文、错误信封解析器与错误契约样本）、请求事件协议契约第一增量（请求方法/结果常量、安全请求正文、请求信封解析器与请求契约样本）、性能事件协议契约第一增量（PRD 5.1.9 批准的 LCP/INP/CLS/页面加载耗时指标）与数据接入批次/接收结果协议第一增量（批次请求正文、请求级/逐事件接收结果、稳定状态枚举与稳定错误码）已实施为第二个真实内部包，`@aurora/core` SDK Core 生命周期与插件编排基础第一增量（环境无关 Core、显式生命周期、最小配置、插件注册与顺序编排、异常隔离、事件入口和多实例隔离）已实施为第三个真实内部包，`@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量（安全环境与能力探测、脱敏页面快照、`visibilitychange`/`pagehide`/`pageshow` 生命周期订阅、幂等释放、异常隔离和多实例隔离）、错误源订阅能力第一增量、请求观测能力第一增量（安全 fetch/XHR 观测、请求事实投影、共享代理 + 引用计数与宿主恢复）与性能事实观测能力第一增量（原生 `PerformanceObserver` 观测 PRD 5.1.9 批准的四项页面性能事实、冻结最小只读投影、页面隐藏收尾）已实施为第四个真实内部包，`@aurora/plugin-error` 浏览器错误采集插件第一增量（JavaScript、未处理 Promise 拒绝和资源加载错误采集，经 event-schema 校验后以最小草稿提交 Core）已实施为第五个真实内部包和首个具体采集插件，`@aurora/plugin-request` 浏览器请求采集插件第一增量（fetch 与 XMLHttpRequest 请求事实采集，经 event-schema 请求正文解析器校验后以最小草稿提交 Core）已实施为第六个真实内部包和第二个具体采集插件，`@aurora/plugin-performance` 浏览器性能采集插件第一增量（LCP/INP/CLS/页面加载耗时性能事实采集，经 event-schema 性能正文解析器校验后以最小草稿提交 Core）已实施为第七个真实内部包和第三个具体采集插件，数据接入 OpenAPI 机器契约第一增量（`POST /v1/batches`、`ClientIngestionKey` security scheme、完整 HTTP 状态映射）已实施为第八个真实内部包 `@aurora/ingestion-openapi-contract` 的漂移门禁。

真实 SDK 包现包括 `@aurora/core`、`@aurora/browser`、`@aurora/plugin-error`、`@aurora/plugin-request` 与 `@aurora/plugin-performance`：Browser 的浏览器环境能力、页面生命周期基础、错误源订阅能力、请求观测能力第一增量（安全 fetch/XHR 观测、请求事实投影、共享代理 + 引用计数与宿主恢复）与性能事实观测能力第一增量（原生 PerformanceObserver 观测 PRD 5.1.9 批准的四项页面性能事实）已经实现，错误插件通过公开错误源、错误正文解析器和 Core 草稿入口组合采集三类错误，请求插件通过公开请求源、请求正文解析器和 Core 草稿入口组合采集 fetch 与 XMLHttpRequest 请求事实，性能插件通过公开性能源、性能正文解析器和 Core 草稿入口组合采集四项性能事实；`@aurora/event-schema` 已具备公共信封、版本、运行时边界校验、共享契约样本、错误事件协议契约第一增量、请求事件协议契约第一增量、性能事件协议契约第一增量与数据接入批次/接收结果协议第一增量（批次请求正文、请求级/逐事件接收结果、稳定状态枚举与稳定错误码），但通用资源、行为事件正文仍不存在；行为采集插件与框架适配仍不存在。数据接入 OpenAPI 机器契约第一增量已实施（`docs/api/ingestion.openapi.yaml` OpenAPI 3.1 + `tooling/ingestion-openapi-contract` 漂移门禁，`POST /v1/batches` + `ClientIngestionKey`）。仓库目前有 `@aurora/workspace-policy`、`@aurora/event-schema`（协议基础加错误、请求、性能事件契约与批次/接收结果协议第一增量）、`@aurora/core` 基础增量、`@aurora/browser` 基础增量（浏览器环境、生命周期、错误源、请求观测与性能观测）、`@aurora/plugin-error` 错误插件第一增量、`@aurora/plugin-request` 请求插件第一增量、`@aurora/plugin-performance` 性能插件第一增量与 `@aurora/ingestion-openapi-contract` 契约漂移 tooling 八个真实内部包；没有行为采集插件、框架适配、错误去重、分组、指纹、Source Map、采样算法、队列、传输、持久化、SDK 发布、服务端、管理平台代码、Inbox 数据模型、机器 Platform OpenAPI、可执行数据模型、CI 工作流、IaC、云资源或部署。文档中的模块名、Query、Command、路径和技术方向不得被描述为已有实现。

## 阅读入口

- Agent 固定入口：[AGENTS.md](AGENTS.md) 与 [AURORA_RULES.md](AURORA_RULES.md)；
- 正式文档及权威映射：[docs/README.md](docs/README.md)；
- 第一版范围：[核心业务 PRD](Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)；
- 系统边界：[系统架构与模块边界](docs/architecture/system-overview.md)；
- ADR 状态：[ADR 索引](docs/adr/README.md)；
- 正式化与阻塞：[实施就绪追踪](docs/architecture/formalization-readiness.md)。

## 本地工程命令

首次设置：

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
```

质量命令（全部非交互、跨平台）：

| 命令                    | 职责                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`     | 检查受管文件的格式                                                                                                            |
| `pnpm lint`             | ESLint 类型化规则                                                                                                             |
| `pnpm typecheck`        | 严格 TypeScript 编译检查                                                                                                      |
| `pnpm test`             | 运行全部包测试                                                                                                                |
| `pnpm test:coverage`    | 运行 `@aurora/event-schema`、`@aurora/core`、`@aurora/browser`、`@aurora/plugin-error` 与 `@aurora/plugin-request` 覆盖率门禁 |
| `pnpm check:boundaries` | 执行 Workspace 依赖边界检查                                                                                                   |
| `pnpm build`            | 构建内部包                                                                                                                    |
| `pnpm check`            | 依次执行格式、Lint、类型、测试、边界和构建                                                                                    |
| `pnpm check:ci`         | 复用 `check` 的非交互语义，供未来 CI 调用                                                                                     |

当前没有 CI 工作流，`check:ci` 只是未来 CI 复用的本地非交互入口。

包级执行使用 `pnpm --filter <package-name> <script>`。

## 当前门禁

ADR-001 与 ADR-006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-005 现为 `accepted / in-progress`（信封基础、错误事件契约、请求事件契约与性能事件契约第一增量已实施），ADR-003 现为 `accepted / in-progress`（Core 基础第一增量、Browser 浏览器环境能力与页面生命周期基础第一增量、错误源订阅能力第一增量、请求观测能力第一增量、性能事实观测能力第一增量、浏览器错误采集插件第一增量、浏览器请求采集插件第一增量及浏览器性能采集插件第一增量已实施，其他具体插件与传输仍未实现），ADR-002、ADR-004 仍为 `accepted / not-started`。真实内部包为 `@aurora/workspace-policy`、`@aurora/event-schema`（协议基础加错误、请求与性能事件契约第一增量）、`@aurora/core`（仅 Core 基础增量）、`@aurora/browser`（浏览器环境、生命周期、错误源、请求观测与性能观测基础增量）、`@aurora/plugin-error`（错误采集插件第一增量）、`@aurora/plugin-request`（请求采集插件第一增量）与 `@aurora/plugin-performance`（性能采集插件第一增量）。行为采集插件、机器契约、其余业务模块、运行角色、IaC 和云资源仍缺失并继续阻塞各自下游模块。
