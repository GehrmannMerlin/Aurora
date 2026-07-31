---
title: Aurora 第一版测试策略与质量门禁
status: approved
owner: quality
last-reviewed: 2026-07-29
applies-to: Aurora Monorepo、协议、SDK、接入、处理、管理平台、部署和发布验证
related:
  - ../../AURORA_RULES.md
  - ../../Aurora 测试规范.md
  - ../architecture/system-overview.md
  - ../architecture/sdk-architecture.md
  - ../architecture/platform-frontend.md
  - ../architecture/platform-backend.md
  - ../architecture/deployment.md
  - ../releases/release-migration-and-rollback.md
  - ../operations/backup-and-recovery.md
  - ../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
supersedes: none
review-cycle: release-or-quality-policy-change
---

# Aurora 第一版测试策略与质量门禁

## 1. 定位

本文是 approved 测试/部署/发布设计中测试分层、CI 阶段、兼容性、性能和可靠性门禁的长期正式承载。[测试规范](<../../Aurora 测试规范.md>)继续定义通用测试原则。本文不提供不存在的命令、工作流、测试文件或通过结果。

当前测试工程、参考应用、浏览器设备、CI 和预发布环境均不存在。门禁是批准目标；实际结果必须在真实制品上重新执行。

## 2. 风险分层

| 范围             | 必需验证                                                                       |
| ---------------- | ------------------------------------------------------------------------------ |
| Monorepo/依赖    | 公开 exports、私有路径、循环/反向/未声明依赖、受影响构建、独立制品             |
| 公共协议         | 合法/非法/边界样本、版本兼容、生产者/消费者共享契约、文档一致性                |
| SDK Core/Browser | 无 DOM Core、生命周期、多实例、资源恢复、包装语义、队列/重试、宿主异常隔离     |
| 采集插件/框架    | 信号捕获、隐私、重复安装/释放、真实浏览器、Vue/React 示例和兼容组合            |
| 数据接入         | 鉴权、来源/环境、大小、Schema、限流、逐项结果、可靠确认和 SDK 重试语义         |
| 异步处理         | 重复投递、幂等事实、问题聚合、代表样本、指标、Source Map、告警、积压/死信/恢复 |
| 平台后端         | 权限、事务不变量、幂等、版本冲突、Operation、Session/CSRF、Outbox、删除与审计  |
| 平台前端         | 路由/权限、URL 状态、Query 全状态、Command 不确定结果、秘密、可访问性和小屏    |
| 部署/恢复        | Migration、回滚、制品追溯、备份恢复、删除重放、故障注入和 Runbook              |

单元测试不能替代契约、集成、真实浏览器、端到端、性能或恢复验证；按风险选择最小充分组合。

## 3. CI 分级门禁

| 阶段         | 必需门禁                                                                                                                 | 当前状态                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Pull Request | 文档/ADR、架构、类型/Lint/构建、受影响单元/集成/契约、SDK exports/体积/Chromium、关键 Playwright、Migration/IaC 静态检查 | `deferred`：无工程和工作流 |
| main         | 同一提交生成不可变候选制品、部署预发布、运行核心 E2E、Migration 与恢复烟雾；失败不晋级                                   | `deferred`                 |
| nightly      | Firefox/WebKit、完整 E2E、正式示例、稳定性/内存、依赖/镜像安全、协议组合、积压恢复和较长故障注入                         | `deferred`                 |
| release      | 完整浏览器/框架/运行时矩阵、性能/负载/积压、备份恢复、Migration/回滚、SBOM/来源证明、人工可访问性                        | `deferred`                 |

Flaky 重跑只采集证据，不能覆盖首次失败；豁免必须有 Owner、原因、风险、到期日和清理任务。安全、协议兼容、Migration、备份恢复和数据丢失风险不得长期豁免。

## 4. 兼容矩阵

- 桌面：Chrome、Edge、Firefox 最近两个稳定主版本，Safari 最近两个主版本；不支持 IE；
- 移动：iOS Safari 最近两个主版本，Android Chrome 当前与前一稳定主版本；
- 自动化：Playwright Chromium/Firefox/WebKit；WebKit 结果不能单独证明 Safari/iOS；
- 框架：Vue/React 适配与 Core/Browser 的版本组合必须通过正式示例和契约测试；
- 可访问性：WCAG 2.2 AA，axe 加人工键盘、焦点、缩放和屏幕阅读器。

精确版本表、真实 Safari/移动设备提供方和结果为 `requires-benchmark`；没有证据时不得扩大公开支持承诺。

## 5. 性能预算

| 对象                   | 批准预算                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| Core 基础包            | gzip ≤ 10 KiB                                                            |
| Browser＋Core 最小接入 | gzip ≤ 30 KiB                                                            |
| 单个可选插件           | gzip 增量 ≤ 8 KiB                                                        |
| 单个 Vue/React 适配    | gzip 增量 ≤ 5 KiB                                                        |
| SDK 初始化             | 桌面 p95 ≤ 20 ms；中档移动 p95 ≤ 50 ms                                   |
| SDK 宿主开销           | 无 SDK 归因 >50 ms Long Task；稳态附加 Heap ≤ 5 MiB；包装调用 p95 ≤ 1 ms |
| SPA 初始非图表路由     | gzip ≤ 300 KiB                                                           |
| ECharts 路由增量       | gzip ≤ 250 KiB，必须懒加载                                               |
| Lighthouse CI          | Performance ≥ 85；LCP ≤ 2.5s；CLS ≤ 0.1；TBT ≤ 200ms                     |
| 真实用户 INP           | 样本充分后核心页面 p75 ≤ 200ms                                           |

参考工程、设备/网络档位、采样方法和首次基线均为 `requires-benchmark`。预算不是当前通过结果。

## 6. SLO 与恢复目标验证

批准目标：数据接入与 `platform-api` 各自月度可用性 99.9%；简单平台 Query 服务端 p95 500 ms、Command p95 1 s；跨处理组合读取 p95 1.5 s 且允许明确部分/陈旧；正常容量下已接收事件 95% 在 60 秒内、99% 在 5 分钟内可查询；PostgreSQL 单区域多 AZ `RPO ≤ 5 分钟`、`RTO ≤ 60 分钟`，区域级第一版 `RPO ≤ 24 小时`、`RTO ≤ 8 小时`。

这些目标需要版本化负载、容量、故障和恢复测试。当前无服务或指标，状态为 `requires-benchmark`。

## 7. 发布阻断原则

- 协议生产者/消费者组合不兼容、SDK 宿主回归、迁移不可回滚、备份恢复失败、秘密泄露、删除数据复活或必要来源证明缺失时阻止发布；
- 不删除、跳过或弱化失败测试以恢复 CI；
- 每个关键失败模式必须链接业务/架构规则和对应测试；
- 测试通过只能基于本次制品的新鲜输出，不能沿用旧会话或不同版本结果。

## 8. 已实施模块门禁

`@aurora/browser` 因直接管理宿主监听器与异常隔离，采用 lines 85%、branches 80%、functions 85%、statements 85%；单元测试之外必须通过本地 Chromium 生命周期、释放、宿主身份与多实例门禁。该门禁只覆盖浏览器环境能力与页面生命周期基础第一增量，不修改全仓长期最低基线，也不表示错误、请求、性能、资源或行为采集插件已经存在。
