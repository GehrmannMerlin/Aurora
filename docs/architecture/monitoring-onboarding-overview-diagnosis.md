---
title: Aurora 监控工作区主入口 — 接入、概览与诊断页面（PLT-05）
status: approved
implementation-status: implemented
approval-status: approved
owner: console/frontend
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: apps/console（`@aurora/console` C1/C2/C7 页面）、packages/platform-contract（仅消费已存在 Query 操作）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../superpowers/specs/2026-07-30-aurora-console-visual-language-design.md
  - ../architecture/ingestion-diagnostics-status-query.md
  - ../architecture/issue-query-projection.md
  - ../architecture/request-metric-query-projection.md
  - ../architecture/performance-query-projection.md
  - ../prd/platform-product-domains.md
supersedes: none
review-cycle: platform-monitoring-console-schema-or-contract-change
---

# Aurora 监控工作区主入口（PLT-05）

## 1. 定位、效力与当前状态

本文是 PLT-05（C1 项目接入 / C2 项目概览 / C7 数据接收诊断）的**最小正式化规格**。它只把已经 approved 的产品行为（核心 PRD §4.4、§7.3、§12.4 与完整前端 UX/UI §7.16—7.17、§7.22、§8.14—8.15、§8.20、§9.14—9.15、§9.20）整理为可实施的 `apps/console` 页面约束，并且**只消费已经存在的公开 Query**（`diagnosticsGetDataStatus`，即 DAT-20；C2 概览另消费 `issuesListIssues`/`requestsListEndpoints`/`performanceListPages`，即 DAT-15/16/17）。

本文不创造新的产品规则、权限规则、导航规则、公共 API 或长期架构决策。后端能力缺口一律以页面 `unavailable`/`capability-not-provided` 诚实表达，**不伪造数据、不直连数据库、不导入 processing 私有 Repository、不以 MSW 作为完成证据**。

**批准状态**：本文由用户于 2026-08-10 按 G11 精简联合执行流程预先批准（`status: approved`），随 PLT-05 实施同步更新 `implementation-status`。

## 2. 页面、路由与数据来源

| 页面            | Route Target          | 主要公开 Query                                                                                     | 后端缺口（诚实 unavailable）                                                                                                                                                         |
| --------------- | --------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1 项目接入     | `project.onboarding`  | `diagnosticsGetDataStatus`                                                                         | ProjectOnboarding Query/Progress Command、SDK Installation Template Contract、Test Event Status Query、ClientKey/Environment 安全投影、测试问题链接、ClearOnboardingTestData Command |
| C2 项目概览     | `project.overview`    | `diagnosticsGetDataStatus` + `issuesListIssues` + `requestsListEndpoints` + `performanceListPages` | Overview Filter Contract、Overview Status/Reason Projection（正常/异常/无数据）、Active Alert Summary、Affected User Estimate、Data Receipt/Completeness Projection、环境/发布维度   |
| C7 数据接收诊断 | `project.data-status` | `diagnosticsGetDataStatus`                                                                         | 被拒绝批次记录、环境/来源维度、逐事件处理轨迹、密钥摘要/origin/environment 值、自动修复、无限轮询                                                                                    |

三个页面共享同一“接收状态 ≠ 处理状态 ≠ 可查询状态”语义，全部来自 `diagnosticsGetDataStatus` 的 `stages`/`queryable` 区（`received_at` 行 ≠ `state='processed'` 行 ≠ processing-store 中已写入的证据行）。**HTTP accepted 绝不显示为处理完成。**

## 3. 页面约束

### 3.1 共同约束（C1/C2/C7）

- 每个数据区按 `sectionResult` 状态渲染：`available` 显示 `data`；`empty` 显示 reason；`partial` 显示 `data` 并标注缺失；`stale` 显示 `data` 与 `freshAt`/`staleReason`；`unavailable`/`forbidden` 显示原因，不显示伪数据、不显示零值代替“缺失”；
- 页面必须覆盖 `loading`、`empty`、`unavailable`、`error`、`success`（及契约支持的 `partial`/`stale`）状态；查询失败显示明确错误与重试，不中断导航；
- 数据只来自公开 Platform API（`executeQuery` → 生成 client `buildRequest`/`parseResponse`）；禁止直连 PostgreSQL、禁止导入 processing 私有 Repository、禁止硬编码生产数据；
- 时间显示服务端返回的 UTC 时间戳，标注时区；不计算本地业务状态；
- 使用已批准控制台视觉语言（浅色内容区、深石墨顶栏、纯色琥珀橙侧栏、深色前景、中高信息密度、禁渐变），复用既有 Aurora UI 组件与设计令牌。

### 3.2 C1 项目接入（`project.onboarding`）

- 单页呈现 PRD §4.4.5 的三步接入引导结构（安装 SDK / 初始化 SDK / 发送测试错误），但**只把已 approved 的 PRD 代码片段作为说明性内容**展示，不声明版本化安装模板契约存在；
- 页面第一层展示真实接入链状态：`diagnosticsGetDataStatus` 的 `summary`（服务端组合投影）+ `stages`（received/processing/processed/deadLetter）+ `credential` + `queryable` + `actionTargets`；
- “我已经发送测试事件”只读取最新 `diagnosticsGetDataStatus`，就地显示真实阶段，明确区分 已接收/处理中/已处理/可查询；**不声称 `connected`**（该状态依赖 Test Event Status Query 与测试问题聚合，后端未提供 → 该步以 `capability-not-provided` 诚实标注）；
- PRD §4.4.6 的 `not_started`/`waiting_for_data`/`connected`/`connection_error` 等接入状态枚举依赖未提供的后端能力，不得由前端从 DAT-20 数据重算或映射伪造；
- 生成的项目级 `clientKey`/`environment` 安全投影未提供时，初始化代码中的 `clientKey` 以说明性占位符展示，并注明真实密钥投影能力未提供；
- 不建设包管理器自动识别、自动修改代码、代码仓库连接、CI/CD 生成、远程发送测试事件或无限轮询。

### 3.3 C2 项目概览（`project.overview`）

- 第一层为权威状态与原因：使用 `diagnosticsGetDataStatus` 的 `summary`（服务端组合的 `receiving/processing/blocked/not_receiving/unknown` + `primaryCause`）作为权威数据接收状态；**不**由前端从数量或时间戳重算业务状态；
- PRD §12.4 的 `正常/异常/无数据` 概览状态依赖 Overview Status/Reason Projection 与 Active Alert Summary（后端未提供），本文不伪造该枚举；`no_data` 等价证据以 DAT-20 `not_receiving` + 原因诚实表达；
- 第二层最小证据：
  - 问题数量：`issuesListIssues` 的 `pagination.totalCount`（过滤感知；`totalCountStatus` 明确标注口径）；
  - 请求证据：`requestsListEndpoints` 的 `summary`（方法聚合、`dataThrough`、`isPartial`）；
  - 性能证据：`performanceListPages` 的 `metrics`（LCP/INP/CLS/page_load、`mean`、`dataThrough`、`isPartial`）；
  - 最近数据与可信度：`diagnosticsGetDataStatus` 的 `recent`/`queryable`/`stages`；
- 环境/发布/时间筛选：环境与发布维度后端 deferred → 不显示筛选器或恒 `unavailable`；时间范围只在契约支持处透传；
- 告警摘要、影响用户估算、Overview 复合状态等未提供能力 → 对应区块 `unavailable`，不以零值或“正常”代替；
- 入口只显示 `actionTargets`（DAT-20 返回的获授权目标）与已存在页面的安全导航；C1/C3/C5/C6/C7 目标按获授权显示。

### 3.4 C7 数据接收诊断（`project.data-status`）

- 完整呈现 `diagnosticsGetDataStatus` 六个区：`summary`、`stages`（received/processing/processed/deadLetter，含 `lastErrorCode`）、`recent`、`rejection`（契约恒 `unavailable`，诚实显示原因）、`credential`（仅安全计数，无密钥值）、`queryable`；
- `actionTargets` 按返回目标渲染为真实导航（`project.client-keys`/`project.onboarding`/`project.requests`/`project.performance` 等），无权目标不显示；
- 不建设原始请求日志、逐事件轨迹、完整载荷、密钥查看、内部队列浏览/重放、自动修复或无限轮询。

## 4. 授权与隐私

- 页面只显示当前会话有权限查看的数据：`queryResponse.allowedActions` 与 `navigationTargets` 由服务端按权限返回；403/404 按 `ApiError` 映射为明确的错误状态，不泄露存在性；
- 隐私硬边界：不显示 `event_inbox.envelope` 原文、request_id、batch_id、密钥摘要/keyId/origin/environment 值、内部堆栈或日志；`lastErrorCode` 为服务端稳定错误码，直接显示；
- 任何命令（本叶不含）与页面刷新均经公开 API 与 CSRF 边界。

## 5. 非目标与回归约束

- 不修改任何后端包、Migration、公共契约或平台 API；不新增操作；
- 不实现 PLT-06 范围（C3—C6）与 G12 范围（C8—C16）；
- 不建立“大而全 monitoring framework”，不做通用监控组件库；
- 不新增依赖；不建设持久化、本地缓存或跨页全局状态；
- 无新 ADR：本叶仅消费已 accepted/implemented 的公开 Query，是前端消费者。

## 6. 测试策略（局部）

- 单元测试：C1/C2/C7 的 view-model 适配（`sectionResult` → 页面状态映射、`summary` 状态文案、actionTargets 渲染）、错误映射；
- 组件测试：关键状态渲染（loading/empty/unavailable/error/success/partial/stale）与隐私负例（不渲染密钥值/原文）；
- Console typecheck、targeted lint、`git diff --check`；
- 浏览器验收（Chromium 关键链）：登录测试账号 → 选择真实项目 → 进入 C1/C2/C7 → 页面调用真实 Platform API → 断言 `accepted`/`processing`/`queryable` 未被混为同一状态；
- 禁止把 MSW 作为完成证据；禁止全量测试（G02/G03/G10 后端测试不在此叶重跑）。
