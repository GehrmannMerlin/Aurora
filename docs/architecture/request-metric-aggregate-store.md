---
title: Aurora 请求指标聚合存储第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-03
last-reviewed: 2026-08-03
applies-to: packages/processing-store（@aurora/processing-store）的请求指标聚合存储（request_metric_buckets 表、request_metric_event_applications 表、persistRequestMetricContribution Repository、幂等、同事务应用登记与桶更新）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../adr/ADR-012-ingestion-worker-runtime.md
  - ../adr/ADR-018-error-event-occurrence-processing-storage.md
  - ../adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md
  - ../adr/ADR-020-idempotent-request-metric-bucket-aggregation.md
  - ../architecture/request-event-sample-processing-store.md
  - ../protocol/request-event-contract.md
  - ../architecture/formalization-readiness.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: request-metric-store-schema-or-contract-change
---

# Aurora 请求指标聚合存储第一增量

## 1. 定位、效力与当前状态

本文冻结请求指标聚合存储第一增量，实施为 `packages/processing-store`（`@aurora/processing-store`）的 `request_metric_buckets` 表、`request_metric_event_applications` 表与 `persistRequestMetricContribution` Repository。它承载 accepted ADR-020 的"幂等请求指标桶聚合"：为未来 Request Processor 提供事务性、幂等的请求指标贡献存储（UTC 一分钟桶 + 最小事件应用登记 + 同事务 UPSERT）。本模块只实现指标聚合存储能力，**不**实现 Request Processor、样本选择、Query、percentile、Performance、路由、production composition root 或数据删除任务。

**批准状态**：本文由用户于 2026-08-03 预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-03 更新为 `implemented`：`packages/processing-store` 的请求指标聚合能力已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁。本文由 accepted ADR-004/005/006/008/010/012/018/019/020、approved 请求事件协议契约、C5 请求监控 UX 语义、既有错误/请求样本存储规格无歧义派生；自动审批依据见规格自检节。

**声明边界**：本模块存储的是**请求指标聚合桶**（计数/求和/最大值 + 低基数维度），不是完整请求 occurrence 历史；不保存请求明细；指标桶只记录实际观察到并由未来 Processor 提交的贡献，不按采样率外推。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：`packages/processing-store` 的请求指标聚合能力：`request_metric_buckets`/`request_metric_event_applications` 表、Migration、`persistRequestMetricContribution` Repository、UTC 一分钟桶、`(project_id, event_id)` 幂等、同事务原子性、单元测试、真实 PostgreSQL 17 集成测试、隐私负例、Workspace Policy、README、正式规格与 ADR-020 证据。
- **明确非职责**：
  - Request Processor、样本选择策略执行器、isFailure/isSlow 分类判断；
  - Request Metric Query、查询 API、分页、过滤；
  - percentile（p50/p75/p90/p95/p99）、Histogram、t-digest、HLL、动态基线、异常检测、采样外推；
  - Performance Store、Performance Processor、Event Processor Router、production composition root；
  - 调用 `persistRequestEventSample`；Issue 分组、fingerprint、告警；
  - 数据保留任务；
  - 修改 request-event-contract、ingestion-api、POST /v1/batches、Worker、Error store、Error processor、request_event_samples、retry/backoff/replay。

## 3. 模块选择依据

- accepted ADR-020 决定方案 B（最小事件应用登记＋同事务 UPSERT 指标桶），其决定细节 1-20 冻结桶粒度/幂等/事务/DDL/维度；
- `@aurora/processing-store` 已实施错误 occurrence 与请求安全样本存储，本模块复用同一工具链与稳定 Repository 模式，但表/Repository/类型完全独立；
- C5 请求监控要求"失败率、请求量、耗时统计、慢请求数量和时间序列必须由 Request Metric Query 返回"，指标桶存储是其数据基础；
- 用户已批准 ADR-020 技术方向（提示词第一节）。

## 4. 存储技术

第一增量继续使用（accepted ADR-010/018/019/020）：

- PostgreSQL 17；
- SQL-first；
- `pg`（node-postgres）；
- `node-pg-migrate`；
- 参数化 SQL；
- 真实 PostgreSQL 17 集成测试（`AURORA_TEST_DATABASE_URL`，目标必须是测试数据库）。

禁止引入：OpenSearch、Elasticsearch、ClickHouse、MongoDB、Redis、对象存储、新队列、ORM、Query Builder。

## 5. 包位置与包结构

- 在现有 `packages/processing-store`（`@aurora/processing-store`，`aurora.layer: data`）内新增请求指标聚合能力，不新建包；
- 新增文件：`src/request-metric-types.ts`、`src/request-metric-contribution.ts`、`src/request-metric-repository.ts`；
- 新增 Migration：`migrations/`（时间戳晚于 `1722500000004_request-event-samples.ts`）；
- 包根 `index.ts` 追加导出请求指标 API；
- 不创建 `utils`/`helpers`/`common`/`base-repository`/`generic-store`/`universal-event-table`。

## 6. 数据边界

本模块存储：

> "由未来 Request Processor 提交的、通过校验的请求指标贡献，聚合为 UTC 一分钟桶 + 最小事件应用登记"。

不是：

- 完整请求 occurrence 历史；
- 请求明细/正文/URL/Header/Cookie/Authorization；
- percentile 或直方图；
- 采样外推总量；
- 完整 `RequestEventEnvelope`；
- 逐请求日志。

一个贡献对应一个 `(projectId, eventId)`。

## 7. 职责

- `request_metric_buckets` 与 `request_metric_event_applications` 表与 Migration（追加式，可 up/down，应用启动不自动执行）；
- `(project_id, event_id)` 事件应用唯一幂等；
- `persistRequestMetricContribution` Repository：同事务内 应用登记 → duplicate 跳过 → 首次登记更新桶 → COMMIT；
- UTC 一分钟桶算法（`bucket_start = occurredAt 向下取整到 UTC 分钟`）；
- 可加法合并指标（observed_count/failure_count/slow_count/duration_sum_ms/duration_max_ms）；
- `isFailure`/`isSlow`/`durationMs` 类型校验（不判断业务分类）；
- 数据库暂时失败映射为稳定 `temporarily_unavailable`；
- 单元测试、真实 PostgreSQL 17 集成测试、隐私负例、包入口与安全负例。

## 8. 非职责

- 不判断某请求是否失败或慢（`isFailure`/`isSlow` 由未来 Request Processor 提供）；
- 不硬编码慢请求阈值（3000ms）、HTTP 429、HTTP 500—599 或额外状态码；
- 不实现 percentile/Histogram/采样外推/样本选择/Request Processor/Query；
- 不调用 `persistRequestEventSample`；
- 不实现 Performance、路由、production composition root、Issue、告警；
- 不实现数据保留任务；
- 本轮不把请求指标存储接入 Worker（`apps/ingestion-worker` 不新增依赖）；
- 不修改 request-event-contract、ingestion-api、POST /v1/batches、Error store、Error processor、request_event_samples。

## 9. 输入契约

包根导出最小公共 API（命名遵循仓库风格；语义冻结）：

```ts
export interface RequestMetricContributionInput {
  readonly projectId: string;
  readonly eventId: string;
  readonly occurredAt: number;        // Unix epoch ms，来自 RequestEventEnvelope.occurredAt
  readonly method: RequestMethod;     // @aurora/event-schema 类型
  readonly outcome: RequestOutcome;   // @aurora/event-schema 类型
  readonly statusCode?: number;       // 可选；缺省映射为 0 哨兵
  readonly durationMs: number;        // 非负安全整数
  readonly isFailure: boolean;        // 由未来 Request Processor 提供
  readonly isSlow: boolean;           // 由未来 Request Processor 提供
}

export type PersistRequestMetricContributionResult =
  | { readonly status: 'applied' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

export function persistRequestMetricContribution(
  pool: Pool,
  input: unknown,
): Promise<PersistRequestMetricContributionResult>;
```

公共边界接收 `unknown`；显式验证顶层 input；不使用 `any`；不暴露 pg Result；不暴露 SQL/SQLSTATE/constraint；不修改输入；返回稳定可判别结果；不创建或关闭调用方 Pool；不写日志；不访问 `process.env`。

## 10. 运行时验证

持久化流程固定执行：

1. 校验顶层 `input` 为非空对象；
2. 校验 `projectId` 为非空字符串、`eventId` 为非空字符串；
3. 校验 `occurredAt` 为正安全整数、`durationMs` 为非负安全整数；
4. 校验 `method`/`outcome` 为 `@aurora/event-schema` 的合法枚举值（导入 `RequestMethod`/`RequestOutcome`）；
5. 校验 `statusCode` 若存在为 `100..599` 安全整数（缺省 → 0 哨兵）；
6. 校验 `isFailure`/`isSlow` 为布尔值；
7. 计算 `bucket_start = new Date(Math.floor(occurredAt / 60000) * 60000)`；
8. 同事务执行应用登记 + 桶 UPSERT（见第 15 节）；
9. 首次应用 → `applied`；duplicate → `duplicate`；数据库暂时失败 → `temporarily_unavailable`。

禁止：先查询再插入作为唯一幂等机制；动态拼接 SQL；保存请求明细/正文/URL/Header/Cookie/Authorization；将 `isFailure`/`isSlow` 判断委托给 Store；硬编码慢请求阈值。

## 11. 指标贡献身份

- 一个贡献对应一个 `(projectId, eventId)`；
- `request_metric_event_applications` 以 `(project_id, event_id)` 为主键（即唯一幂等键）；
- 同一 projectId/eventId 的后续投递（Worker retry、lease recovery、人工 replay）返回 `duplicate`，不更新指标桶（first-wins）。

## 12. PostgreSQL 表（request_metric_buckets）

创建聚合桶表，最终名称在本 ADR 与规格冻结：

```text
request_metric_buckets
```

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | bigserial | primary key（内部主键） |
| `project_id` | uuid | not null |
| `bucket_start` | timestamptz | not null（UTC 分钟向下取整） |
| `method` | varchar(16) | not null |
| `outcome` | varchar(32) | not null |
| `status_code` | integer | not null（0 哨兵，CHECK 0..599） |
| `observed_count` | bigint | not null default 0 |
| `failure_count` | bigint | not null default 0 |
| `slow_count` | bigint | not null default 0 |
| `duration_sum_ms` | numeric | not null default 0 |
| `duration_max_ms` | numeric | not null default 0 |
| `created_at` | timestamptz | not null default now() |
| `updated_at` | timestamptz | not null default now() |

约束（CHECK）：

- `observed_count >= 0`；
- `failure_count >= 0` 且 `failure_count <= observed_count`；
- `slow_count >= 0` 且 `slow_count <= observed_count`；
- `duration_sum_ms >= 0` 且 `duration_max_ms >= 0` 且 `duration_max_ms <= duration_sum_ms`；
- `status_code BETWEEN 0 AND 599`。

唯一约束：`UNIQUE(project_id, bucket_start, method, outcome, status_code)`。

索引：唯一约束自动建立 btree 索引，前缀 `project_id` 覆盖未来 C5 时间序列范围查询；当前无查询 API，最小索引原则。

## 13. PostgreSQL 表（request_metric_event_applications）

创建最小事件应用登记表：

```text
request_metric_event_applications
```

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `project_id` | uuid | not null |
| `event_id` | varchar(128) | not null |
| `applied_at` | timestamptz | not null default now() |

主键：`PRIMARY KEY(project_id, event_id)`（即唯一幂等键）。

不保存：Request body、Response body、Header、Cookie、Authorization、sample_body、完整事件 JSON、完整 URL、用户输入。

## 14. 聚合维度（冻结）

第一增量只使用 approved Request Event/Envelope 已存在的安全字段与 accepted ADR 批准的稳定标识：

| 维度 | 权威来源 | 基数 |
| --- | --- | --- |
| `project_id` | 既有项目表 | 低（项目数） |
| `bucket_start` | 信封 `occurredAt` 向下取整到 UTC 分钟 | 随事件分布 |
| `method` | `RequestEventBody.method`（七值） | 低（7） |
| `outcome` | `RequestEventBody.outcome`（五值） | 低（5） |
| `status_code` | `RequestEventBody.statusCode`（可选，缺省 0） | 低（100..599 有限） |

C5 的**环境/发布版本/来源/路径/页面**维度在现有 request-event-contract 中不存在 → 记录为**后续契约缺口**，不得自行扩展 event-schema。

## 15. 事务边界（冻结）

同一 PoolClient 事务内固定顺序：

```text
BEGIN
→ INSERT INTO request_metric_event_applications (project_id, event_id)
   ON CONFLICT (project_id, event_id) DO NOTHING RETURNING project_id
→ 若 rows.length === 0：duplicate，跳过桶更新，COMMIT
→ 若 rows.length === 1：首次登记
   INSERT INTO request_metric_buckets
     (project_id, bucket_start, method, outcome, status_code,
      observed_count, failure_count, slow_count, duration_sum_ms, duration_max_ms)
   VALUES ($1..$10, 1, CASE WHEN isFailure THEN 1 ELSE 0 END,
           CASE WHEN isSlow THEN 1 ELSE 0 END, durationMs, durationMs)
   ON CONFLICT (project_id, bucket_start, method, outcome, status_code)
   DO UPDATE SET
     observed_count = request_metric_buckets.observed_count + 1,
     failure_count = request_metric_buckets.failure_count + (CASE WHEN $isFailure THEN 1 ELSE 0 END),
     slow_count = request_metric_buckets.slow_count + (CASE WHEN $isSlow THEN 1 ELSE 0 END),
     duration_sum_ms = request_metric_buckets.duration_sum_ms + $durationMs,
     duration_max_ms = GREATEST(request_metric_buckets.duration_max_ms, $durationMs),
     updated_at = now()
→ COMMIT
```

任一步失败 ROLLBACK（登记与桶更新同事务，桶更新失败时登记一并回滚）。禁止先查后插。

## 16. 幂等

- `request_metric_event_applications` 以 `(project_id, event_id)` 为主键；
- 同一 projectId/eventId 后续投递 → `duplicate`，不更新桶（first-wins）；
- 不同 eventId 即使进入相同桶，也必须分别登记并分别增加指标；
- duplicate 不暴露 PostgreSQL constraint 或 SQLSTATE。

## 17. duplicate

- `duplicate` 是稳定公共结果，不携带数据库错误信息；
- 不与 `applied` 混淆；
- 不把 SQLSTATE、约束名或 SQL 文本暴露给调用方。

## 18. 并发行为

- 两个并发调用同一 `(projectId, eventId)`：唯一主键仲裁，只有一个执行应用登记，另一个 `duplicate`；
- 两个并发调用不同 `eventId` 同桶：各自登记，桶 `observed_count` 增加 2 次；
- 桶 UPSERT 的 `ON CONFLICT DO UPDATE` 在并发下原子（PostgreSQL 行锁）。

## 19. 错误映射

- 数据库错误映射为稳定内部错误：连接失败（`ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND`）→ `temporarily_unavailable`；语句失败 → `temporarily_unavailable`；
- 不暴露 SQLSTATE、约束名、表名、SQL 文本或完整数据库 URL；
- 内部验证错误（`invalid_input`）不在正常控制流抛出。

## 20. 公共 API

包根导出最小公共能力：

- `persistRequestMetricContribution`（函数）；
- `RequestMetricContributionInput`、`PersistRequestMetricContributionResult`（类型）。

禁止导出：私有桶算法、SQL、查询 Repository、样本选择、percentile、测试专用查询。

## 21. 隐私与敏感信息

- 不记录请求体、响应体、Header、Cookie、Authorization、敏感查询、完整 URL、DOM/文本、IP、指纹；
- 事件应用登记只存 `project_id`/`event_id`/`applied_at`；
- 聚合桶只存低基数维度计数/求和/最大值，无身份字段；
- 指标桶与应用登记为项目作用域业务事实，不含 user_id/session_id 等直接身份字段（落实 A5 匿名化语义）；
- 解析失败 issue 不回显输入值；
- 包根不写日志。

## 22. 数据保留边界

- 本轮不冻结新的保留天数；
- 指标桶与应用登记遵守未来数据生命周期规则（PRD 分钟级聚合保留、A5 之外保留）；
- 不自动删除；
- 不创建定时清理任务；
- 不声称永久保留；
- 不复用 Inbox 35 天备份淘汰语义冒充在线数据保留规则。

## 23. Migration

新增追加 Migration（不编辑任何既有 Migration，不修改 `error_event_occurrences`/`request_event_samples`/`event_inbox`）：

- 创建 `request_metric_buckets` 表（列与约束见第 12 节）；
- 创建 `request_metric_event_applications` 表（列与约束见第 13 节）；
- 可 up；可 down；up/down/up 测试；不在应用启动时自动运行；使用真实 PostgreSQL 17；隔离 Schema；完整清理（`beforeAll` 同步 DROP 新表）。

不得添加：GIN、全文索引、trigram、分区、TTL、自动清理触发器、fingerprint 索引、Issue 外键。

## 24. 回滚

- Migration 发布前缺陷：可直接修改未发布 Migration；
- Migration 发布后：向前修复与 expand/contract；destructive down 不作为生产默认回滚；
- Repository 实现与 Worker 主循环/样本存储/Error store 解耦，可替换而不影响既有公共接口。

## 25. 单元测试

至少覆盖：

- 非对象 input；
- projectId/eventId 缺失或类型错误；
- occurredAt/durationMs 非法（非正/非安全整数/负数/NaN/Infinity）；
- method/outcome 非法枚举；
- statusCode 非法（<100 或 >599 或非整数）；
- isFailure/isSlow 非布尔；
- UTC 分钟桶边界：`12:34:00.000 → 12:34:00`、`12:34:59.999 → 12:34:00`、`12:35:00.000 → 12:35:00`；
- 首次贡献 → `applied`；
- 输入不变；
- 稳定结果；
- 不泄露数据库错误；
- 不使用 `any`/`console`/`process.env`。

## 26. 真实 PostgreSQL 集成测试

必须使用真实 PostgreSQL 17 验证（`AURORA_TEST_DATABASE_URL`；隔离/清理）：

- 首次贡献 → `applied`，`observed_count` +1；
- failure 贡献 → `failure_count` +1；
- slow 贡献 → `slow_count` +1；
- 同时 failure+slow → 两项分别 +1；
- duration → `duration_sum_ms` 累加、`duration_max_ms` 取最大值；
- duplicate → 所有指标不变；
- 并发 duplicate → 最多应用一次；
- 两个不同 eventId 同桶 → `observed_count` +2；
- 不同 project → 不写入同一桶；
- 不同 method/outcome/status_code → 不同桶；
- 跨 UTC 分钟 → 不同桶；
- 非法 duration/时间 → 不写登记、不写桶；
- 桶更新异常 → 事件应用登记回滚；
- 数据库暂时不可用 → `temporarily_unavailable`；
- **error_event_occurrences 回归**（Error store 不变）；
- **request_event_samples 回归**（Sample store 不变）；
- Migration up/down/up；
- Schema/Pool 完整清理。

## 27. 包入口

- 包根导出最小公共能力（第 20 节）；
- 私有路径拒绝测试：`@aurora/processing-store/request-metric-repository` 等私有路径以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝；
- 只从 `@aurora/event-schema` 包根导入（`RequestMethod`/`RequestOutcome`/类型）；
- 不访问 `@aurora/event-schema/src`/`internal`；
- `aurora.layer: data`（Workspace Policy 允许 `data → {protocol}`）。

## 28. 后续 Request Processor 衔接

- 未来 Request Processor 通过 `persistRequestMetricContribution` 包根提交贡献，显式提供 `isFailure`/`isSlow`；
- 桶时间基准 `occurredAt` 与 request_event_samples 的 `occurred_at` 口径一致；
- 本轮不把请求指标存储接入 Worker；
- `apps/ingestion-worker` 的 `package.json` 不新增请求指标相关依赖。

## 29. 后续查询衔接

- Request Metric Query、时间序列、分页、过滤为后续独立模块；
- 本模块不导出查询 Repository；
- 不允许从聚合桶反推个体请求（指标桶无身份字段）。

## 30. 排除范围

- Request Processor、样本选择策略、isFailure/isSlow 分类；
- Request Metric Query、percentile、Histogram、采样外推、查询 API；
- Performance Store/Processor、路由、production composition root；
- Issue 分组、fingerprint、Source Map、告警；
- 数据保留任务；
- 修改 request-event-contract、ingestion-api、POST /v1/batches、Worker、Error store、Error processor、request_event_samples、retry/backoff/replay；
- CI、RDS、IaC、容量基准。

## 31. 覆盖率与质量门禁

- `@aurora/processing-store` 维持 TypeScript strict；
- 覆盖率不低于 lines 85%、branches 80%、functions 85%、statements 85%；
- 单元测试 + 真实 PostgreSQL 17 集成测试 + 包入口/私有路径负例 + 隐私负例；
- 安全负例：src 不含请求体/Header/Cookie/Authorization/数据库 URL/`console`/`process.env`/`Math.random`；
- 回归：event-schema、Error store、Request Sample store、ingestion-worker、ingestion-api 全部测试通过；OpenAPI 无变化；benchmark smoke 通过；
- 全仓门禁：`pnpm install --frozen-lockfile`、`format:check`、`lint`、`typecheck`、`test`、`test:coverage`、`check:boundaries`、`build`、`check:ci`、`git diff --check`。

## 32. 规格自检

- **权威一致性**：指标字段与维度完全来自 event-schema 请求契约/信封与 accepted ADR-020；不创建第二套 Schema；不改变 Inbox/Worker/Error store/Error processor/request_event_samples/retry/replay/OpenAPI；不实现样本选择/Request Processor/Query/percentile；不硬编码慢请求阈值；
- **兼容性**：新文件只通过 event-schema 包根依赖；无循环依赖；无私有深导入；Migration 为追加式；已完成模块回归通过；Worker 未接入请求指标；未来 Request Processor 可以通过包根使用；
- **计划质量**：规格每项要求都有 Task；表名、列名、类型、常量和结果全文一致；每个 Task 有真实 TDD；无占位；无第二模块；零上下文实施者可直接执行；
- **安全和数据**：不存请求明细/正文/Header/Cookie/Authorization/敏感查询/完整 URL/DOM/文本/IP/指纹；事件应用登记只存最小幂等事实；SQL 全参数化；不暴露数据库错误；测试 Schema 隔离并清理；无自动保留或删除规则；
- **事务与幂等**：应用登记与桶更新同事务；duplicate 不更新桶；禁止先查后插；并发由唯一主键仲裁；
- **范围控制**：只实现请求指标聚合存储；不实现聚合外的模块；production composition root 不接入；不扩大到 Performance/percentile/Query。

自动审批依据：本文全部语义由 accepted ADR-004/005/006/008/010/012/018/019/020、approved 请求事件协议契约、C5 请求监控 UX 语义与既有 Error/Sample store 规格无歧义派生；无新增产品/架构/安全/隐私决策（isFailure/isSlow 分类由未来 Request Processor 负责，不在本模块内决策；C5 环境/发布/来源/路径维度记录为契约缺口）；用户已预先批准 ADR-020 技术方向；三域独立评审通过；自检全部通过。
