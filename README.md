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

Aurora 是面向前端应用的监控 SDK 与管理平台。第一版业务范围和设计已经形成批准基线，ADR-001—ADR-007 已完成正式审批；首个私有 Monorepo 根 Workspace 与最小本地工程工具模块已实施，`@aurora/event-schema` 协议基础第一增量（版本化公共信封、运行时边界校验、稳定错误和共享契约样本）已实施为第二个真实内部包，`@aurora/core` SDK Core 生命周期与插件编排基础第一增量（环境无关 Core、显式生命周期、最小配置、插件注册与顺序编排、异常隔离、事件入口和多实例隔离）已实施为第三个真实内部包，`@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量（安全环境与能力探测、脱敏页面快照、`visibilitychange`/`pagehide`/`pageshow` 生命周期订阅、幂等释放、异常隔离和多实例隔离）已实施为第四个真实内部包。

真实 SDK 包现包括 `@aurora/core` 与 `@aurora/browser`：Browser 的浏览器环境能力与页面生命周期基础第一增量已经实现；错误、请求、性能、资源和行为插件仍不存在，传输与框架适配仍不存在。仓库目前只有 `@aurora/workspace-policy`、`@aurora/event-schema` 协议基础增量、`@aurora/core` 基础增量与 `@aurora/browser` 基础增量四个真实内部包；没有具体采集插件、框架适配、采样、队列、传输、持久化、SDK 发布、服务端、管理平台代码、具体事件正文、批次/接收协议、机器 OpenAPI、可执行数据模型、CI 工作流、IaC、云资源或部署。文档中的模块名、Query、Command、路径和技术方向不得被描述为已有实现。

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

| 命令                    | 职责                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| `pnpm format:check`     | 检查受管文件的格式                                                          |
| `pnpm lint`             | ESLint 类型化规则                                                           |
| `pnpm typecheck`        | 严格 TypeScript 编译检查                                                    |
| `pnpm test`             | 运行全部包测试                                                              |
| `pnpm test:coverage`    | 运行 `@aurora/event-schema`、`@aurora/core` 与 `@aurora/browser` 覆盖率门禁 |
| `pnpm check:boundaries` | 执行 Workspace 依赖边界检查                                                 |
| `pnpm build`            | 构建内部包                                                                  |
| `pnpm check`            | 依次执行格式、Lint、类型、测试、边界和构建                                  |
| `pnpm check:ci`         | 复用 `check` 的非交互语义，供未来 CI 调用                                   |

当前没有 CI 工作流，`check:ci` 只是未来 CI 复用的本地非交互入口。

包级执行使用 `pnpm --filter <package-name> <script>`。

## 当前门禁

ADR-001 与 ADR-006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-005 现为 `accepted / in-progress`，ADR-003 现为 `accepted / in-progress`（Core 基础第一增量与 Browser 浏览器环境能力与页面生命周期基础第一增量已实施，具体插件与传输仍未实现），ADR-002、ADR-004 仍为 `accepted / not-started`。真实内部包为 `@aurora/workspace-policy`、`@aurora/event-schema`（仅协议基础增量）、`@aurora/core`（仅 Core 基础增量）与 `@aurora/browser`（仅浏览器环境与生命周期基础增量）。机器契约、其余业务模块、运行角色、IaC 和云资源仍缺失并继续阻塞各自下游模块。
