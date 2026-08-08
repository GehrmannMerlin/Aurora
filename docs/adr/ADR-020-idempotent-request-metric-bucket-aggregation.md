---
title: ADR-020：幂等请求指标桶聚合
status: accepted
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
date: 2026-08-03
last-reviewed: 2026-08-03
applies-to: packages/processing-store（@aurora/processing-store）的请求指标聚合存储（request_metric_buckets 表、request_metric_event_applications 表、persistRequestMetricContribution Repository、幂等、同事务应用登记与桶更新）
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/platform-backend.md
  - ../../docs/architecture/deployment.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/architecture/system-overview.md
  - ../../docs/architecture/ingestion-inbox-data-model.md
  - ../../docs/architecture/ingestion-inbox-processing-repository.md
  - ../../docs/architecture/ingestion-worker-runtime.md
  - ../../docs/architecture/error-event-occurrence-processing-store.md
  - ../../docs/architecture/error-event-processor.md
  - ../../docs/architecture/request-event-sample-processing-store.md
  - ../../docs/adr/ADR-005-event-schema-source-of-truth.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../docs/adr/ADR-012-ingestion-worker-runtime.md
  - ../../docs/adr/ADR-018-error-event-occurrence-processing-storage.md
  - ../../docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md
  - ../../docs/protocol/request-event-contract.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
superseded-by: none
---

# ADR-020：幂等请求指标桶聚合

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：proposed
- 日期：2026-08-03
- Owner：ingestion/backend
- 适用范围：`packages/processing-store`（`@aurora/processing-store`）的请求指标聚合存储：`request_metric_buckets` 表、`request_metric_event_applications` 表、`persistRequestMetricContribution` Repository、幂等、同事务应用登记与桶更新
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 5.1.2/5.1.3 节、[RULE-REQUEST-PERSISTENCE-20260803-002](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联协议：[请求事件协议契约](../../docs/protocol/request-event-contract.md)（approved / implemented）
- 关联 ADR：[ADR-019 请求事件聚合与有界诊断样本存储](../../docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md)（accepted / in-progress）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-03 创建为 `proposed`。用户已在本提示词第一节明确批准请求指标聚合技术方向（UTC 一分钟桶、最小事件应用登记、同事务 UPSERT、观察值不外推、指标字段边界、Store 不承担 failure/slow 分类）。本 ADR 于 2026-08-03 完成独立非作者架构/后端评审、数据库领域评审与隐私/数据治理评审。数据库评审提出的阻断项（可空 status_code 在 PostgreSQL 唯一约束下 NULL 互不相等、破坏失败类事件幂等合并）已在决定细节 12 落实（`status_code` 非空 + 0 哨兵 + CHECK 0..599），其余中/次要项（桶时间基准、first-wins、登记表保留、精确 DDL）已在决定细节 13/14/15/19 落实。评审无 load-bearing finding，本 ADR 更新为 `accepted / not-started / approved`。

## 背景

Aurora 已接受 ADR-019（请求事件聚合主路径＋有限安全诊断样本），其决定细节 1 明确"请求指标与时间桶聚合（主路径）"、"本 ADR 不决定 Request Metric Store 的精确桶模型"。`@aurora/processing-store` 已实现错误事件 occurrence 存储与请求事件安全样本存储；`request_event_samples` 只保存有限安全样本，不承担指标聚合。

当前真实缺口：请求指标聚合存储不存在。C5 请求监控要求"失败率、请求量、耗时统计、慢请求数量和时间序列必须由 Request Metric Query 返回"，而指标桶存储是这些查询的数据基础。请求指标聚合的物理模型（桶粒度、幂等机制、事务边界、指标字段）属于需要长期保留取舍依据的高迁移成本决策，按 ADR 规范 7.2 需创建独立 ADR。

## 决策驱动因素

- **聚合主路径**：ADR-019 决定请求数据以指标聚合为主路径，样本为有限诊断；
- **幂等**：Worker retry、lease recovery 和人工 replay 会重复投递同一 event；指标计数必须幂等；
- **不建逐请求日志**：指标桶只存聚合与最小幂等事实，不存请求明细；
- **无采样外推**：指标桶只记录实际观察到并由未来 Processor 提交的贡献，不按采样率推算未观察到的事件；
- **数据最小化**：事件应用登记只存 project_id/event_id/applied_at 及事务正确性所需最小字段；
- **C5 查询基础**：为未来 Request Metric Query 提供失败率/请求量/耗时/慢请求/时间序列的基础桶数据；
- **与样本存储分离**：`request_metric_buckets` 与 `request_event_samples` 职责分离。

## 现有约束

- ADR-005：外部输入按不可信数据运行时校验；event-schema 是事件 Schema 唯一来源；
- ADR-008：`(project_id, event_id)` 租户作用域幂等键；
- ADR-010：PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first；禁止 ORM/Query Builder；Migration 追加式；
- ADR-012：Worker 只从包根消费；
- ADR-019：聚合主路径＋有限样本；样本存储与聚合存储分离；不决定指标桶精确模型；
- 请求事件协议契约：`RequestEventBody` 六字段（method/url/startedAt/durationMs/outcome/statusCode）、`RequestMethod` 七值、`RequestOutcome` 五值、`REQUEST_EVENT_LIMITS`；URL 路径动态段归一化属处理层；
- C5 请求监控：失败率/请求量/耗时/慢请求/时间序列来自服务端指标查询；查询条件含环境/发布版本/时间范围/页面来源（这些维度在现有事件协议中不存在，需记录为契约缺口）；
- 代码规范：严格 TypeScript、参数化 SQL、稳定结果、不暴露 SQLSTATE/约束名/SQL、敏感信息不入日志。

## 候选方案

### 方案 A：直接 UPSERT 指标桶，不建立事件应用登记

**行为**：对每条指标贡献直接 `UPSERT` 指标桶（`observed_count = observed_count + 1` 等），不记录哪个 event 已应用。

**优点**：
- 表少；
- 写入路径短；
- 实现简单。

**缺点**：
- Worker retry、lease recovery 和 replay 会重复增加指标；
- 无法可靠判断一个 event 是否已经应用；
- 应用层先查后写存在竞态。

**选择结论**：不采用。

### 方案 B：最小事件应用登记＋同事务 UPSERT 指标桶（推荐）

**行为**：同一 PostgreSQL 事务内：尝试登记 `request_metric_event_applications(project_id, event_id)` → 若 duplicate（该 event 已应用），禁止更新指标桶 → 若首次登记，更新对应指标桶 → COMMIT。任一步失败 ROLLBACK。

**优点**：
- 数据库级幂等；
- retry/replay 不重复计数；
- 不需要保存完整请求明细；
- 与 ADR-019 的数据最小化一致；
- 可明确回滚半完成状态。

**缺点**：
- 多一张最小登记表；
- 每个事件增加一次唯一索引写入；
- 需要事务和并发测试；
- 登记数据也需要后续保留策略。

**选择结论**：采用。

### 方案 C：先保存全部 Request 明细，再异步批量生成指标

**行为**：先持久化全部 Request 明细，再由异步任务批量聚合生成指标桶。

**优点**：
- 可以重新计算；
- 聚合算法可延后；
- 调试直接。

**缺点**：
- 重新建立完整请求日志；
- 与 ADR-019 有限样本原则冲突；
- 存储、隐私和删除成本高；
- 增加额外异步任务与一致性边界。

**选择结论**：不采用。

### 候选比较

| 维度 | A：直接 UPSERT | B：应用登记＋同事务 UPSERT | C：明细＋异步聚合 |
| --- | --- | --- | --- |
| retry/replay 幂等 | 否 | 是（数据库级） | 需去重 |
| 表数量 | 1 | 2 | 2+ |
| 完整请求明细 | 否 | 否 | 是（冲突） |
| 写入路径 | 短 | 中 | 长（异步） |
| 事务原子性 | 部分 | 完整 | 弱 |
| 数据最小化 | 中 | 高 | 低 |
| 与 ADR-019 一致 | 部分 | 是 | 否 |

## 最终决策

**最终选择方案 B：最小事件应用登记＋同事务 UPSERT 指标桶。**

### 决定细节（全部在本 ADR 冻结）

1. **桶粒度**：第一增量采用 UTC 一分钟固定桶：`bucket_start = occurredAt 向下取整到 UTC 分钟`。底层时间始终是 UTC 真实时间；组织业务时区只在未来 Query 中解释查询和展示边界，不改变桶内时间。UTC 一分钟桶理由：与请求事件高频特征匹配、支持 C5 分钟级时间序列、存储与索引成本可控、第一版无需更高分辨率。
2. **不承诺 percentile**：第一增量只实现可加法合并的基础指标；p50/p75/p90/p95/p99、Histogram、t-digest、HLL、动态基线、异常检测、未采样总量外推均不实现（后续独立模块）。
3. **无采样外推**：指标桶只记录实际观察到并由未来 Processor 提交的贡献，不按采样率推算未观察到的事件。
4. **指标字段**：`observed_count`、`failure_count`、`slow_count`、`duration_sum_ms`、`duration_max_ms`。
5. **Store 不承担分类**：`isFailure`/`isSlow` 由未来 Request Processor 依据 approved 产品规则、项目配置和有效慢请求阈值产生；Store 只验证并应用该内部指标贡献，不硬编码 3000ms、HTTP 429、HTTP 500—599 或额外状态码。
6. **事件应用登记**：`request_metric_event_applications` 只保存 `project_id`、`event_id`、`applied_at` 及事务正确性绝对必要的最小字段；不得保存 Request body、Response body、Header、Cookie、Authorization、sample_body、完整事件 JSON、完整 URL、用户输入。
7. **同事务**：`BEGIN → 尝试登记 project_id+event_id → 若 duplicate 禁止更新指标 → 若首次登记更新对应指标桶 → COMMIT`；任一步失败 ROLLBACK。
8. **幂等**：同一 `(project_id, event_id)` 最多应用一次；duplicate 不更新指标桶；不同 event_id 即使进入相同桶也必须分别增加指标。
9. **聚合维度**：第一增量只使用 approved Request Event/Envelope 已存在的安全字段（`RequestEventBody.method`、`outcome`、可选 `statusCode`、信封 `occurredAt`）与 accepted ADR 批准的稳定标识（project_id）。不得为了方便自行增加 URL、用户、IP、Header 或设备维度。C5 的环境/发布版本/来源/路径维度在现有事件协议中不存在，记录为后续契约缺口（不得自行扩展 event-schema）。
10. **基数分析**：`method` 七值、`outcome` 五值、`statusCode` 有限整数、project_id 由既有项目表约束——均为低基数；不引入高基数维度。
11. **存储分离**：`request_metric_buckets` 与 `request_event_samples`、`error_event_occurrences` 完全分离；本 Repository 不调用 `persistRequestEventSample`。
12. **桶键与 statusCode NULL 语义（冻结）**：`status_code` 列采用**非空 + 0 哨兵**（`0` 表示"无状态码"；协议合法事件中 `statusCode` 为可选，缺失映射为 `0`；CHECK `status_code BETWEEN 0 AND 599`）。理由：PostgreSQL 唯一约束下 NULL 互不相等，若允许 NULL，网络失败/超时/取消事件（合法且无 statusCode）会在同一桶键下各自插入新行，`ON CONFLICT` 永不触发，幂等合并对失败类事件失效。桶复合主键 `(project_id, bucket_start, method, outcome, status_code)` 因此全程非空、语义确定。
13. **指标桶精确 DDL（冻结）**：`request_metric_buckets` 字段——`id` bigserial PK、`project_id` uuid not null、`bucket_start` timestamptz not null（UTC 分钟向下取整）、`method` varchar(16) not null、`outcome` varchar(32) not null、`status_code` integer not null（0 哨兵）、`observed_count` bigint not null default 0、`failure_count` bigint not null default 0、`slow_count` bigint not null default 0、`duration_sum_ms` numeric not null default 0、`duration_max_ms` numeric not null default 0、`created_at` timestamptz not null default now()、`updated_at` timestamptz not null default now()；CHECK：`observed_count >= 0`、`failure_count >= 0`、`failure_count <= observed_count`、`slow_count >= 0`、`slow_count <= observed_count`、`duration_sum_ms >= 0`、`duration_max_ms >= 0`、`duration_max_ms <= duration_sum_ms`；`UNIQUE(project_id, bucket_start, method, outcome, status_code)`。`duration` 相关列用 `numeric`（协议 `durationMs` 为安全整数，numeric 避免行和溢出与截断）。
14. **事件应用登记精确 DDL（冻结）**：`request_metric_event_applications` 字段——`project_id` uuid not null、`event_id` varchar(128) not null、`applied_at` timestamptz not null（数据库 now()）；`PRIMARY KEY(project_id, event_id)`（复合主键即唯一幂等键）。不保存 Request body、Response body、Header、Cookie、Authorization、sample_body、完整事件 JSON、完整 URL、用户输入。
15. **同事务实现细节（冻结）**：同一 PoolClient 事务内——`INSERT INTO request_metric_event_applications ... ON CONFLICT (project_id, event_id) DO NOTHING RETURNING project_id`；`rows.length === 0` ⇒ duplicate，跳过桶更新，COMMIT；`rows.length === 1` ⇒ 首次登记，`INSERT INTO request_metric_buckets ... ON CONFLICT (project_id, bucket_start, method, outcome, status_code) DO UPDATE SET observed_count = observed_count + 1, failure_count = failure_count + CASE WHEN isFailure THEN 1 ELSE 0 END, slow_count = slow_count + CASE WHEN isSlow THEN 1 ELSE 0 END, duration_sum_ms = duration_sum_ms + $x, duration_max_ms = GREATEST(duration_max_ms, $x), updated_at = now()`；COMMIT。任一步失败 ROLLBACK。禁止先查后插。
16. **Migration**：新增 `request_metric_buckets` 与 `request_metric_event_applications` 两张表；追加式，可 up/down，应用启动不自动执行；不修改既有 Migration；集成测试 `beforeAll` 同步 DROP 新表。
17. **数据保留**：指标桶与应用登记遵守未来数据生命周期规则；本 ADR 不实现清理任务。
18. **不修改**：request-event-contract、ingestion-api、POST /v1/batches、Worker、Error store、Error processor、request_event_samples、retry/backoff/replay。
19. **桶时间基准与 first-wins 语义（冻结）**：桶 `bucket_start` 使用信封 `occurredAt`（事件产生时间）向下取整到 UTC 分钟，与 request_event_samples 的 `occurred_at` 口径一致（ADR-019 决定细节 12）；`body.startedAt`（请求真实开始时间）不作为桶时间基准——理由：指标桶与样本存储共享统一时间口径，且 SDK 批量上传延迟下 `occurredAt` 与 `startedAt` 的差异在分钟级桶内可接受；若未来 C5 需要按请求真实开始时间聚合，作为重新评估条件记录。重复事件（同 project_id+event_id 再次投递）采用 **first-wins**：首次登记的正文/贡献生效，后续 duplicate 不更新桶（不覆盖、不比较）。
20. **isFailure/isSlow 输入边界（冻结）**：`persistRequestMetricContribution` 接收调用方（未来 Request Processor）显式提供的 `isFailure: boolean`/`isSlow: boolean` 与 `durationMs`；Store 校验其类型合法性但不判断业务分类，不硬编码慢请求阈值（3000ms）、HTTP 429、HTTP 500—599 或额外状态码。

## 结果与影响

### 正面影响

- 数据库级幂等，retry/replay 不重复计数；
- 支持 C5 请求指标查询基础；
- 数据最小化（登记表只存幂等事实）；
- 与 ADR-019 聚合主路径一致；
- 可明确回滚半完成状态。

### 负面影响与代价

- 多一张最小登记表；
- 每个事件增加一次唯一索引写入；
- 需要事务和并发测试；
- 登记数据也需要后续保留策略。

### 未解决问题

- 精确慢请求阈值、失败分类（后续 Request Processor/Policy）；
- C5 的环境/发布版本/来源/路径维度（后续契约缺口）；
- percentile/Histogram（后续独立模块）；
- 指标桶与应用登记的保留期限（数据生命周期规则）。

## 实施约束

- 完全遵守 ADR-005/008/010/012/018/019；不修改 `@aurora/ingestion-inbox`、`@aurora/event-schema`、`apps/ingestion-worker`、`apps/ingestion-api`、OpenAPI；
- `@aurora/processing-store` 新增 `request_metric_buckets` 与 `request_metric_event_applications` Migration + `persistRequestMetricContribution` Repository；不创建通用 Repository 泛型框架；
- 输入经 `@aurora/event-schema` 根入口验证；`isFailure`/`isSlow` 由调用方（未来 Processor）显式提供；
- SQL 全参数化；不暴露 SQLSTATE/约束名/SQL；
- 不记录请求体/响应体/Header/Cookie/Authorization/敏感查询/完整 URL/DOM/文本/IP/指纹；
- Workspace Policy：`data → {protocol}`（现有允许矩阵已支持）。

## 迁移方案

本 ADR accepted 后：编写请求指标聚合存储正式规格 → writing-plans → 实施 `request_metric_buckets`/`request_metric_event_applications` Migration + `persistRequestMetricContribution` Repository → 真实 PostgreSQL 17 集成验证。

## 回滚方案

- Migration 发布前缺陷：可直接修改未发布 Migration；
- Migration 发布后：向前修复与 expand/contract；destructive down 不作为生产默认回滚；
- Repository 实现与 Worker 主循环/样本存储/Error store 解耦，可替换而不影响既有公共接口。

## 验证方式

- 单元测试：UTC 分钟桶算法、指标字段校验、isFailure/isSlow 应用、输入不变、稳定结果；
- 真实 PostgreSQL 17：首次应用、duplicate 不更新桶、并发幂等、不同 eventId 同桶分别计数、桶更新异常整体回滚、Migration up/down/up、Schema/Pool 清理；
- 回归：event-schema、Error store、Request Sample store、Worker、ingestion-api 全部测试通过；OpenAPI 无变化；
- 全仓质量门禁与覆盖率 85/80/85/85。

## 重新评估条件

- 请求量变化使一分钟桶粒度不满足 C5 时间序列；
- 需要 percentile 或更高分辨率桶；
- 需要更多聚合维度且契约字段已批准；
- 数据生命周期规则要求同步桶与应用登记保留。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-03：创建（proposed）

- 状态 `proposed / not-started / proposed`；
- 由 2026-08-03 请求指标聚合门禁创建；
- 门禁确认：ADR-019 决定细节 1 明确"不决定 Request Metric Store 的精确桶模型"；C5 请求监控要求服务端指标查询；请求指标聚合物理模型（桶粒度、幂等机制、事务边界、指标字段）无 approved 来源；
- 用户批准证据：本提示词第一节（UTC 一分钟桶、最小事件应用登记、同事务 UPSERT、无采样外推、指标字段边界、Store 不承担分类）；
- 未调用 writing-plans、未创建规格、未实施代码；
- 等待独立非作者、数据库领域与隐私/数据治理评审，不自动批准、不实施。

### 2026-08-03：独立非作者、数据库领域与隐私/数据治理评审

- 独立非作者架构/后端评审：**可接受进入 accepted 与正式代码实施**（无 load-bearing）。确认与 ADR-019 决定细节 1/6/9 无冲突；三方案真实、矩阵公平；`BEGIN → 登记 → duplicate 跳过 → 首次更新桶 → COMMIT` 同 client 同事务原子正确；`(project_id, event_id)` 唯一约束保证 retry/replay/并发最多一次；第一增量维度（method/outcome/statusCode/occurredAt）符合"不自行扩展 event-schema"、C5 环境/发布/来源/路径如实记录为契约缺口。中等项（桶时间基准、first-wins、登记表保留）已在决定细节 19 落实。
- 数据库领域评审：初评 **需修正后才能进入**（1 项阻断：可空 `status_code` 在 PostgreSQL 唯一约束下 NULL 互不相等，网络失败/超时/取消事件各自插入新桶行、`ON CONFLICT` 永不触发，幂等合并对失败类事件失效）。修正已落实：决定细节 12 冻结 `status_code` 非空 + 0 哨兵（NULL 映射 0、CHECK 0..599、桶复合主键全程非空）；决定细节 13/14 冻结两表精确 DDL 与 CHECK（counts≥0、failure≤observed、slow≤observed、duration_max≤duration_sum、duration 用 numeric）；决定细节 15 冻结同事务 UPSERT SQL。其余项（Migration 追加、最小索引、与既有模式一致）无 load-bearing 问题。
- 隐私/数据治理评审：**可接受进入 accepted 与正式代码实施**（无阻断）。确认事件应用登记只存 project_id/event_id/applied_at（不含 body/Header/Cookie/Authorization/sample_body/完整事件 JSON/完整 URL/用户输入）；聚合桶只存低基数维度计数/求和/最大值，无身份字段、不可还原逐请求、与样本存储分离、天然匿名符合 A5；保留边界明确"不实现清理任务、遵守未来生命周期规则"、非永久。中项建议（保留口径收紧、schema 漂移负例）已在规格/实施计划落实。
- 结论：三域评审全部通过且无 load-bearing finding，用户批准证据 + 独立评审证据齐备，本 ADR 更新为 `accepted / not-started / approved`。

### 2026-08-03：请求指标聚合存储第一增量实施证据

- 实施状态更新为 `implemented`：`packages/processing-store` 请求指标聚合能力已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试、隐私负例与全仓质量门禁；Request Processor、样本选择策略、Request Metric Query、percentile、Performance、路由与查询仍未实现，故不扩大范围；
- 实施内容：`src/request-metric-types.ts`（`RequestMetricContributionInput`/`PersistRequestMetricContributionResult` 可判别联合类型/私有 `RequestMetricBucketParams`）、`src/request-metric-contribution.ts`（`parseRequestMetricContributionInput` 顶层校验 + `computeBucketStart` UTC 分钟桶算法）、`src/request-metric-repository.ts`（`persistRequestMetricContribution`：同事务内 应用登记 `ON CONFLICT DO NOTHING` → duplicate 跳过 → 桶 UPSERT `ON CONFLICT DO UPDATE` → COMMIT/ROLLBACK）、Migration `1722500000005_request-metric-aggregation.ts`（`request_metric_buckets` + `request_metric_event_applications` 表 + 唯一/CHECK 约束）；包根 `index.ts` 追加导出；
- 语义：UTC 一分钟桶 `bucket_start = occurredAt 向下取整`；`status_code` 非空 + 0 哨兵；五指标字段（observed_count/failure_count/slow_count/duration_sum_ms/duration_max_ms）；`isFailure`/`isSlow` 由调用方（未来 Request Processor）显式提供、Store 只校验类型不判断分类；不硬编码慢请求阈值；同事务原子性保证半完成状态回滚；SQL 全参数化；不暴露 SQL/数据库错误码/约束名；
- 未修改 `error_event_occurrences`/`request_event_samples`/`persistErrorEventOccurrence`/`persistRequestEventSample`/Error processor/request-event-contract/ingestion-api/Worker/OpenAPI；未实现 Request Processor、样本选择、percentile、采样外推、Query、路由、production composition root；
- 测试：14 个输入/桶算法单测 + 6 个 Repository 单测 + 隐私负例（不存请求明细/Header/Cookie/Authorization、不硬编码阈值、不引用 sampleBody/persistRequestEventSample）+ 13 个真实 PostgreSQL 17.10 集成测试（首次/duplicate/并发/桶维度/跨分钟/回滚/Error+Sample 回归/Migration up/down/up/Schema/Pool 清理）；
- 覆盖率：lines / statements / branches / functions 均满足 85/80/85/85 门槛；
- 验证命令：`pnpm --filter @aurora/processing-store typecheck/test/test:integration/test:coverage/test:package/build`、`pnpm check:boundaries`、全仓门禁全部 exit 0；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 状态记录：request metric aggregate store implemented；request sample selection policy not-started；request event processor not-started；request query projection not-started；performance aggregate/sample store not-started；performance event processor not-started；event processor routing not-started / blocked；production worker composition not-started / blocked；issue grouping/fingerprint not-started；alert calculation not-started；retention cleanup not-started；CI/RDS/IaC not-started。

### 2026-08-03：请求处理规则/配置 adapter 第一增量实施证据

- 实施状态更新：请求处理规则/配置 adapter 核心能力已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁；真实配置存储/Repository、配置管理 API、Request Metric Query、Performance、Router、生产接线仍未实现，故不扩大范围；
- 实施内容：`apps/ingestion-worker` 内部 `src/request-processing-rules-adapter.ts`（`RequestProcessingRules` 配置模型 + `DEFAULT_REQUEST_PROCESSING_RULES` 默认慢阈值 3000ms/失败 429+500—599/额外状态码默认空 + `createRequestProcessingRulesAdapter` 工厂实现 `ClassifyRequestEvent` 端口 + 不可变冻结快照 + 非法配置抛稳定 `RequestProcessingRulesAdapterError{invalid_rules}`），正式规格 [request-processing-rules-configuration-adapter.md](../architecture/request-processing-rules-configuration-adapter.md)（approved + implemented）；
- 语义（本 ADR 决定细节 5/20 落实）：`isFailure`/`isSlow` 由 adapter 依据 approved 产品规则（PRD 5.1.2/5.1.3）、项目配置（failureStatusCodes/slowStatusCodes/slowRequestThresholdMs）和有效慢请求阈值产生；`persistRequestMetricContribution` Store 仍只验证并应用该内部指标贡献，不硬编码慢请求阈值、HTTP 429、HTTP 500—599 或额外状态码；`isAdditionalMonitoredStatus` 由 adapter 依据项目 additionalMonitoredStatusCodes 产生（ADR-019 决定细节 3）；
- 未修改：request-event-contract/ingestion-api/Worker 运行时/processing-store/Error processor/Request Processor 核心/样本选择策略/retry/backoff/replay；未增加 Migration；未接生产 composition root；`@aurora/ingestion-worker` 未新增依赖；
- 测试：`apps/ingestion-worker` 单元测试 19 文件 191 测试通过、集成测试 10 文件 44 测试通过（真实 PostgreSQL 17.10），覆盖率达 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%，全仓质量门禁通过；
- 状态记录：request processing rules/config adapter implemented；request event processor core implemented；request metric aggregate store implemented；request sample selection policy implemented；request query projection not-started；performance aggregate/sample store not-started；performance event processor not-started；event processor routing not-started / blocked；production worker composition not-started / blocked；issue grouping/fingerprint not-started；alert calculation not-started；retention cleanup not-started；本 ADR 保持 `accepted / implemented`、ADR-019 保持 `accepted / in-progress`；CI/RDS/IaC not-started。
