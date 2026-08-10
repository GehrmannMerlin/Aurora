---
title: Aurora 监控工作区 — Issue、请求与性能工作区（PLT-06）
status: approved
implementation-status: implemented
approval-status: approved
owner: console/frontend
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: apps/console（`@aurora/console` C3—C6 页面）、packages/platform-contract（仅消费已存在 Query/Command 操作）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../superpowers/specs/2026-07-30-aurora-console-visual-language-design.md
  - ../architecture/issue-query-projection.md
  - ../architecture/issue-lifecycle-commands.md
  - ../architecture/request-metric-query-projection.md
  - ../architecture/performance-query-projection.md
  - ../prd/platform-product-domains.md
supersedes: none
review-cycle: platform-monitoring-console-schema-or-contract-change
---

# Aurora 监控工作区（PLT-06）

## 1. 定位、效力与当前状态

本文是 PLT-06（C3 Issue 列表 / C4 Issue 详情 / C5 请求工作区 / C6 性能工作区）的**最小正式化规格**。它只把已经 approved 的产品行为（核心 PRD §5、§9—10、§12 与完整前端 UX/UI §7.18—7.21、§8.16—8.19、§9.16—9.19）整理为可实施的 `apps/console` 页面约束，并且**只消费已经存在的公开 Query 与 Command**（`issuesListIssues`/`issuesGetIssueDetail`=DAT-15、`requestsListEndpoints`=DAT-16、`performanceListPages`=DAT-17、Issue 生命周期 Command=G03 DAT-14）。

本文不创造新的产品规则、权限规则、导航规则、公共 API 或长期架构决策。后端能力缺口一律以页面 `empty`/`partial`/`unavailable` 诚实表达，**不伪造数据、不直连数据库、不导入 processing 私有 Repository、不以 MSW 作为完成证据**。C4 的写操作复用既有 Command，前端**不依赖按钮隐藏做权限判断**（每次 Command 由服务端重新鉴权，`read_only` → 403）。

**批准状态**：本文由用户于 2026-08-10 按 G11 精简联合执行流程预先批准（`status: approved`），随 PLT-06 实施同步更新 `implementation-status`。

## 2. 页面、路由与数据来源

| 页面          | Route Target           | 公开 Query/Command                                                                                                                             | 后端缺口（诚实 unavailable/empty）                                                                    |
| ------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| C3 Issue 列表 | `project.issues`       | `issuesListIssues`                                                                                                                             | 环境/发布维度恒 `unavailable`（契约缺口）、保存视图/跨页选择（GAP）、页面/环境/发布过滤 deferred      |
| C4 Issue 详情 | `project.issue-detail` | `issuesGetIssueDetail` + `issuesUpdateState`/`issuesUpdateAssignee`/`issuesUpdatePriority`/`issuesCreateNote`/`issuesDeleteNote`/`issuesMerge` | 完整事件时间线/无限事件浏览/附件/回复/提及（非第一版）；`by_version` 重开 deferred                    |
| C5 请求工作区 | `project.requests`     | `requestsListEndpoints`                                                                                                                        | `percentiles` 恒 `unavailable`（percentile 原材料 deferred，ADR-021）；逐请求日志不存在               |
| C6 性能工作区 | `project.performance`  | `performanceListPages`                                                                                                                         | `pages`/`percentiles` 恒 `unavailable`（页面维度无数据、percentile deferred）；逐次性能访问记录不存在 |

四个页面共用同一诚实状态语义：`queryResponse` 内各区块按 `sectionResult` 渲染，缺失一律 `empty`/`unavailable` 不以零值或“正常”代替；`pagination.totalCountStatus`/`isPartial`/`dataThrough` 如实展示。

## 3. 页面约束

### 3.1 共同约束（C3—C6）

- URL 是当前查询/筛选/分页的权威来源（UX C3 §9.16）；非法/未知参数不得静默扩权，`structural_error` 就地显示；
- 时间范围：C3/C5 的 `issuesListIssues`/`requestsListEndpoints` 契约**必填** `timeRange`（RFC 3339 UTC，最多 90 天），页面按加载时刻生成一次确定性默认窗口（最近 24h）并保持稳定；C6 `performanceListPages` 的 `timeRange` 可选（服务端默认 24h）；
- 分页：`nextCursor` 驱动“加载更多”；无 `nextCursor` 即无更多；`totalCountStatus: 'unavailable'` 时不以零值代替；
- 授权：页面只显示服务端返回的 `navigationTargets`/`allowedActions`（纯展示投影）；403/404 按 `ApiError` 映射为明确错误状态，不泄露存在性；
- 隐私：样本只显示契约安全投影 `sampleBody`（无原始 PII/URL/Header/正文）；`url` 为脱敏归一化接口 URL；不显示完整载荷/密钥/堆栈原文；
- 使用已批准控制台视觉语言，复用既有 Aurora UI 组件与设计令牌；语义 HTML + 可访问标签/焦点（WCAG 2.2 AA 基线，复用壳层 axe 门禁），Command/筛选控件有明确 label 与 aria 标注。

### 3.2 C3 Issue 列表（`project.issues`）

- 查询条件写入 URL：`status`/`priority`/`assigneeAccountId`/`cursor`/`limit` 与 `timeRange`；改变筛选回到第一页并清空选择；
- 列表展示 `issues.items`（`title`/`status`/`occurrenceCount`/`sampleCount`/`firstSeenAt`/`lastSeenAt`/`assigneeAccountId?`/`priority?`/`version`）；`pagination.totalCount` + `totalCountStatus` 如实展示；
- `environments`/`releases` 恒 `unavailable`（契约缺口）；`filters`/`summary` 按返回状态渲染；
- 空窗口 → `empty`；部分缺失 → `partial`/`unavailable`，不用样本反推总量；
- 行点击进入 C4 并保留返回上下文（当前查询意图）。

### 3.3 C4 Issue 详情（`project.issue-detail`）

- 只读区：`issue`（聚合事实、生命周期、`version`、`mergedIntoIssueId?`）、`samples`（有界代表样本 ≤100，`sampleBody` 安全投影）、`activity`（活动时间线 + 备注，已删除备注不返回 `content`）；
- 写操作区（服务端强制鉴权，前端不隐藏按钮）：
  - 状态：`open`/`in_progress`/`resolved`/`ignored`/`reopened`（closed 转移表服务端强制，非法 → 422 `field_validation`）；开始处理自动分配由服务端执行；
  - 优先级：`urgent`/`high`/`medium`/`low`/清空；
  - 负责人：分配/转派/清空；
  - 备注：新增（Markdown ≤4096）、作者软删自己的备注；
  - 合并 UI **deferred**（需问题选择交互；`issuesMerge` Command client 已构建并测试，UI 接线属后续增量）；
- 每次 Command 携带 `version`（乐观并发）与 `idempotencyKey` + `X-Aurora-CSRF`；`conflict`（409）→ 提示刷新并重读；403 → 显示无处理权限；成功 → 就地更新权威详情并刷新活动；
- 支持附件/回复/提及/无限事件浏览/后台批量一律不支持。

### 3.4 C5 请求工作区（`project.requests`）

- `summary`：方法聚合（`observedCount`/`failureCount`/`slowCount`/`durationSumMs`/`durationMaxMs`/`outcomes`）+ `dataThrough`/`isPartial`；不显示伪精确比率（分母/采样未知时）；
- `endpoints`：分页接口列表（`method`/`url`/`sampleCount`/`outcomeCounts`/`dataThrough`/`isPartial`/`completeness`）；`nextCursor` 加载更多；
- `percentiles` 恒 `unavailable`；原始 URL/参数值/请求响应体不返回；
- 环境/发布筛选 deferred → 不显示筛选器或恒 `unavailable`。

### 3.5 C6 性能工作区（`project.performance`）

- `metrics`：LCP/INP/CLS/page_load 聚合（`observedCount`/`valueSum`/`valueMax`/`mean`、`unit`）+ `dataThrough`/`isPartial`；`mean` 为真实聚合非采样外推；
- `pages`/`percentiles` 恒 `unavailable`（页面维度无数据、percentile deferred，不伪造页面列表或百分位）；
- 不建设网站地图/页面目录管理/逐次访问记录/Session Replay。

## 4. 非目标与回归约束

- 不修改任何后端包、Migration、公共契约或平台 API；不新增操作；
- 不实现 C8—C16（G12）；不建立“大而全 monitoring framework”；
- 不新增依赖；不建设持久化、本地缓存或跨页全局状态；
- 无新 ADR：本叶仅消费已 accepted/implemented 的公开 Query/Command，是前端消费者。

## 5. 测试策略（局部）

- 单元测试：C3—C6 的 view-model（筛选/分页/状态适配、Command 输入构造、诚实状态映射）；
- 组件/路由测试：route-registry 条目换真实视图、reachability 更新；
- Console typecheck、targeted lint、`git diff --check`；
- 浏览器验收（Chromium，最多两条 flow）：Flow A 真实项目 → Issue 列表 → Issue 详情 → 生命周期动作按权限工作；Flow B 真实项目 → 请求/性能工作区消费真实 Query，loading/empty/data/unavailable 正确；
- 禁止把 MSW 作为完成证据；禁止全量测试（G02/G03/G10 后端测试不在此叶重跑）。
