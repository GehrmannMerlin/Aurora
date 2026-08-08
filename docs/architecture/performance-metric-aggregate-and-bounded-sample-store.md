---
title: Aurora 性能指标聚合与有限诊断样本存储（Performance Aggregate and Bounded Sample Store）
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-03
last-reviewed: 2026-08-05
applies-to: packages/processing-store（@aurora/processing-store）的性能指标聚合存储（performance_metric_buckets 表）与有限性能诊断样本存储（performance_event_samples 表）第一增量
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
  - ../adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md
  - ../protocol/performance-event-contract.md
  - ../architecture/error-event-occurrence-processing-store.md
  - ../architecture/request-event-sample-processing-store.md
  - ../architecture/request-metric-aggregate-store.md
  - ../architecture/formalization-readiness.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
supersedes: none
review-cycle: performance-store-schema-or-contract-change
---

# Aurora 性能指标聚合与有限诊断样本存储（DAT-08）

## 1. 定位、效力与当前状态

本文冻结性能指标聚合与有限诊断样本存储第一增量（DAT-08），实施为 `packages/processing-store`（`@aurora/processing-store`）的 `performance_metric_buckets` 表、`performance_event_samples` 表与对应 Repository。它承载 accepted ADR-021 的"聚合主路径＋有限安全诊断样本"物理模型：为未来 Performance Processor（DAT-09）提供事务性、幂等的性能指标聚合桶存储与有限安全样本存储。本模块只实现存储能力，**不**实现 Performance Processor、Performance Query、事件路由、production composition root 或数据删除任务。

**批准状态**：本文于 2026-08-03 以 `draft` 创建，完成规格化与两份独立评审（架构/数据库 + 隐私/数据治理，均为 ACCEPT-WITH-REVISIONS，revisions 已落实）。用户于 2026-08-05 正式批准 ADR-021（accepted / approved），本规格作为 ADR-021 的实施规范于同日更新为 `status: approved`。`implementation-status` 于 2026-08-05 更新为 `implemented`：`packages/processing-store` 的 `performance_metric_buckets`/`performance_metric_event_applications`/`performance_event_samples` Migration（`1722500000006`）+ `persistPerformanceMetricContribution`/`persistPerformanceEventSample` Repository 已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁。规格化内容在 ADR-021 accepted 前不用于创建正式 Migration 或实现代码（该门禁现已解除）。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：`packages/processing-store` 的性能指标聚合与有限样本能力：`performance_metric_buckets`/`performance_event_samples` 表、Migration、`persistPerformanceMetricContribution` Repository、`persistPerformanceEventSample` Repository、幂等、原子事务、单元测试、真实 PostgreSQL 17 集成测试、隐私负例、README、正式规格与 ADR-021 证据。
- **明确非职责**：
  - Performance Processor（DAT-09）、事件解析、调用存储、retry/lease 失败语义；
  - Performance Query 投影（DAT-17）、分页、时间序列渲染、percentile 计算、超标比例；
  - Event Processor Router（DAT-10）、production composition root（DAT-11）；
  - 页面身份解析（safe page identity 归一化/过滤）、环境/发布版本注入（协议层无这些字段）；
  - 采样率执行（PRD 默认 10% 属 SDK 采集层）、采样外推；
  - 数据保留/清理任务、项目/账号删除传播；
  - Issue 创建、告警计算；
  - 修改 performance-event-contract、ingestion-api、POST /v1/batches、Worker、Error store、Request store、retry/backoff/replay。

## 3. 模块选择依据

- 分组基线 [aurora-v1-remaining-module-batches.md](aurora-v1-remaining-module-batches.md) L142：DAT-08 为"性能聚合与有限样本数据模型"，前置为 PRD §5.1.9、§12、§14—16 与 Performance Contract §4—10、§17—18；ADR-018—020 只作先例，独立 ADR 缺失；
- approved 性能事件协议契约：冻结 `PerformanceMetricName` 四项（`lcp`/`inp`/`cls`/`page_load`）、`PerformanceMetricUnit` 两单位（`millisecond`/`ratio`）、`PERFORMANCE_EVENT_LIMITS`；性能正文**不含**页面/环境/发布版本字段；
- PRD 5.1.9：基础页面性能默认开启，默认采样率 10%，"页面性能主要进入聚合指标，不为每一次普通性能数据生成问题"；
- PRD §16：分钟级聚合 30 天、小时级聚合 90 天、天级聚合 1 年、完整事件详情 30 天；
- C6 UX §7.21：页面身份由后端返回稳定标识和安全投影；LCP/INP/CLS/页面加载耗时、百分位、超标比例和时间序列必须由 Performance Metric Query 返回；前端不得从有限样本计算总体；页面必须展示采样/水位/额度影响；
- `@aurora/processing-store` 已实施错误 occurrence、请求安全样本、请求指标聚合三 Store，复用同一工具链与稳定 Repository 模式。

## 4. 存储技术

继续使用（accepted ADR-010/018/019/020）：

- PostgreSQL 17；
- SQL-first；
- `pg`（node-postgres）；
- `node-pg-migrate`；
- 参数化 SQL；
- 真实 PostgreSQL 17 集成测试（`AURORA_TEST_DATABASE_URL`，目标必须是测试数据库）。

禁止引入：OpenSearch、Elasticsearch、ClickHouse、MongoDB、Redis、对象存储、新队列、ORM、Query Builder。

## 5. 包位置与包结构

- 在现有 `packages/processing-store`（`@aurora/processing-store`，`aurora.layer: data`）内新增性能聚合与样本能力，**不新建包**；
- 新增文件：`src/performance-metric-types.ts`、`src/performance-metric-contribution.ts`、`src/performance-metric-repository.ts`、`src/performance-sample-types.ts`、`src/performance-sample-input.ts`、`src/performance-sample-repository.ts`；
- 新增 Migration：`migrations/`（时间戳晚于 `1722500000005_request-metric-aggregation.ts`）；
- 包根 `index.ts` 追加导出性能 API；
- 不创建 `utils`/`helpers`/`common`/`base-repository`/`generic-store`/`universal-event-table`。

## 6. 数据边界

本模块存储：

> "由未来 Performance Processor 提交的、通过 `@aurora/event-schema` 性能解析器校验的性能指标贡献（聚合为 UTC 一分钟桶 + 最小事件应用登记）与有限安全诊断样本"。

不是：

- 完整性能事件 occurrence 历史；
- 逐次访问记录、Session Replay、完整行为分析；
- 页面/环境/发布版本维度（协议层无这些字段）；
- percentile/直方图/超标比例原材料（第一版只存可加合聚合与有限样本）；
- 采样外推总量；
- 完整 `PerformanceEventEnvelope` 的 jsonb 副本（样本只存安全投影白名单）；
- 资源计时明细、网络计时、长任务、TTFB/FCP/FID/TBT。

一个贡献对应一个 `(projectId, eventId)`；一个样本对应一个 `(projectId, eventId)`。

## 7. 职责

- `performance_metric_buckets` 与 `performance_event_samples` 表与 Migration（追加式，可 up/down，应用启动不自动执行）；
- `(project_id, event_id)` 事件应用唯一幂等；
- `persistPerformanceMetricContribution` Repository：同事务内 应用登记 → duplicate 跳过 → 首次登记更新桶 → COMMIT；
- UTC 一分钟桶算法（`bucket_start = occurredAt 向下取整到 UTC 分钟`）；
- 可加合并指标（`observed_count`/`value_sum`/`value_max`）；CLS 与毫秒类指标的精度差异由 `unit` 区分存储；
- `metricName`/`unit`/`value`/`startedAt`/`durationMs?` 类型校验（不判断业务分类）；
- `persistPerformanceEventSample` Repository：事务内 `INSERT ... ON CONFLICT DO NOTHING`，区分 `inserted`/`duplicate`/`temporarily_unavailable`；
- 数据库暂时失败映射为稳定 `temporarily_unavailable`；
- 单元测试、真实 PostgreSQL 17 集成测试、隐私负例、包入口与安全负例。

## 8. 非职责

- 不判断性能好坏、不计算超标、不实现采样率执行；
- 不实现 percentile/Histogram/采样外推/页面归一化/Performance Processor/Query；
- 不调用 `persistPerformanceEventSample` 之外的任何 Store；
- 不实现 Performance Processor、路由、production composition root、Issue、告警；
- 不实现数据保留任务；
- 本轮不把性能存储接入 Worker（`apps/ingestion-worker` 不新增依赖）；
- 不修改 performance-event-contract、ingestion-api、POST /v1/batches、Error store、Request store、error/request processor、retry/backoff/replay。

## 9. 数据输入的最小结构

`persistPerformanceMetricContribution` 接收：

```ts
export interface PerformanceMetricContributionInput {
  readonly projectId: string;
  readonly eventId: string;
  readonly occurredAt: number;       // 信封 occurredAt
  readonly metricName: PerformanceMetricName;
  readonly unit: PerformanceMetricUnit;
  readonly value: number;            // 已由协议校验的数值
  readonly startedAt: number;        // 协议 startedAt
  readonly durationMs?: number;      // 协议可选 durationMs
}
```

`persistPerformanceEventSample` 接收：

```ts
export interface PersistPerformanceEventSampleInput {
  readonly projectId: string;
  readonly eventEnvelope: unknown;   // 经 parsePerformanceEventEnvelope 校验
}
```

## 10. 只接受四项已批准性能指标

- 输入校验复用 `@aurora/event-schema` 包根 `parsePerformanceEventEnvelope`/`parsePerformanceEventBody`，只接受 `PerformanceMetricName` 的 `lcp`/`inp`/`cls`/`page_load` 四项；
- Repository 不复制协议枚举，从包根导入真实常量；
- 未知/未批准指标（`fcp`/`ttfb`/`custom` 等）由协议解析器返回 `invalid_enum`，Repository 映射为 `invalid_input`；
- 不因未来 UI 猜测新增指标。

## 11. 外部数据已经由 event-schema 校验，但 Repository 边界仍需严格类型

- 即使事件已由协议解析，Repository 入口仍从 `unknown` 开始做顶层结构校验（`isPlainRecord` + 必填字段存在性 + 字段类型），与请求/错误 Repository 的 `parse*Input` 模式一致；
- Repository 不信任调用方类型断言；所有来自外部/持久化的值经运行时校验后再构造数据库参数。

## 12. 性能聚合对象

`performance_metric_buckets` 聚合对象：

| 列 | 类型 | 语义 |
| --- | --- | --- |
| `id` | bigserial PK | 内部标识 |
| `project_id` | uuid not null | 项目作用域 |
| `bucket_start` | timestamptz not null | UTC 一分钟桶起点 |
| `metric_name` | varchar(64) not null | `lcp`/`inp`/`cls`/`page_load` |
| `unit` | varchar(16) not null | `millisecond`/`ratio` |
| `observed_count` | bigint not null default 0 | 观测次数 |
| `value_sum` | numeric not null default 0 | 数值和（CLS 与毫秒统一为数值和，单位列区分语义） |
| `value_max` | numeric not null default 0 | 数值最大值 |
| `created_at`/`updated_at` | timestamptz not null default now() | 审计 |

- 聚合键：`(project_id, bucket_start, metric_name, unit)` 唯一；
- 第一版**不**加入 `page`/`environment`/`release` 维度（协议层无这些字段，与 ADR-020 记录 C5 维度缺口同理，作为契约缺口）；
- `value_sum`/`value_max` 用 `numeric` 避免整数溢出（协议 `maxValueSafeInteger` 为 32 位上限，但求和会超）；
- 不存储 percentile/直方图原材料。

## 13. 有限诊断样本对象

`performance_event_samples` 有限样本对象：

| 列 | 类型 | 语义 |
| --- | --- | --- |
| `id` | bigserial PK | 内部标识 |
| `project_id` | uuid not null | 项目作用域 |
| `event_id` | varchar(128) not null | 事件 ID |
| `occurred_at` | timestamptz not null | 信封 occurredAt |
| `sample_body` | jsonb not null | 受协议约束白名单投影 |

- `(project_id, event_id)` 唯一幂等；
- `sample_body` 只存协议解析后性能正文的**安全字段白名单**：`metricName`、`value`、`unit`、`startedAt`、可选 `durationMs`；
  - `metricCategory` 在 v1 中省略：协议 §5.1 只批准 `page` 类别，且四项指标均为 page 类别，无信息丢失；未来若出现共享指标名的第二类别，需同时把 `metricCategory` 加入样本白名单与聚合键；
- CHECK：`jsonb_typeof(sample_body) = 'object'`；
- 不存完整信封、信封字段（protocolVersion/eventId/eventType/occurredAt）、页面/环境/发布版本、URL、DOM、用户信息；
- 不添加 GIN/全文/trigram 索引（当前无查询 API，最小索引原则）。

## 14. 为什么聚合和有限样本不能合并为无限事件明细表

- PRD 5.1.9："页面性能主要进入聚合指标，不为每一次普通性能数据生成问题"；
- 性能事件量大（10% 采样仍远超错误量），逐条明细的存储/索引/删除成本高；
- C6 UX："只读取聚合性能数据，不提供逐次访问记录"；
- 聚合主路径支持时间序列/趋势；有限样本支持必要诊断；二者职责分离，避免形成完整性能历史产品；
- 与 ADR-019 请求"聚合主路径＋有限样本"、ADR-020 请求指标桶一致。

## 15. bucket identity

- 聚合桶唯一键：`(project_id, bucket_start, metric_name, unit)`；
- 所有键列非空；无 NULL 哨兵问题（性能无 statusCode 这类可空字段）；
- `bucket_start = occurredAt 向下取整到 UTC 分钟`（与 ADR-020 决定细节 19 口径一致）。

## 16. project、environment、page、metric、time bucket 等维度是否进入唯一键

| 维度 | 是否进入唯一键 | 依据 |
| --- | --- | --- |
| project | 是 | 项目作用域 |
| metric_name | 是 | 四项指标各自成桶 |
| unit | 是 | millisecond/ratio 数值语义不同 |
| bucket_start | 是 | UTC 一分钟桶 |
| environment | 否 | 协议层无该字段，契约缺口 |
| page | 否 | 协议层无该字段，契约缺口 |
| release | 否 | 协议层无该字段，契约缺口 |

## 17. release 是否是聚合维度、样本字段或完全排除

- **完全排除**：性能事件正文无 release 字段；协议层不采集 release（错误/请求正文同样无 release，release 属 SDK 上下文层未来能力）；
- 不把 release 加入聚合键或样本投影；
- 未来若批准 release 维度，需新协议字段 + 新 ADR（同 ADR-020 记录 C5 维度缺口）。

## 18. safe page identity 的来源

- **本模块不实现 page identity**：协议层无页面字段，safe page/route 归一化与过滤属未来 DAT-09/DAT-17 + 未来协议字段；
- 未来 C6 页面列表的页面身份由后端返回稳定标识和安全投影（C6 UX §7.21），但该能力依赖未来协议扩展，不在 DAT-08 范围；
- 本模块只按 `(project_id, event_id)` 作用域存储聚合与样本，不产生页面身份。

## 19. 禁止保存的页面和 URL 数据

禁止进入聚合键、样本投影或任何列：

- 完整 URL、路径动态段、查询参数值、片段；
- 页面标题、DOM、页面文本；
- 页面身份猜测/归并/保存；
- 环境、发布版本、用户标识、session、IP、设备指纹。

## 20. 聚合时间粒度

- 第一增量：UTC 一分钟桶（`bucket_start`）；
- PRD §16 的分钟级聚合 30 天、小时级 90 天、天级 1 年属于**保留层**，本模块只存分钟级桶；小时/天级下采样属未来保留任务（不在 DAT-08）；
- 不因未来 UI 预先创建小时/天级表。

## 21. 聚合值的数学语义

- `observed_count`：进入桶的合法事件数（经幂等去重后）；
- `value_sum`：所有合法事件的 `value` 求和（CLS 比率与毫秒统一为数值和，`unit` 列区分语义）；
- `value_max`：所有合法事件的 `value` 最大值；
- 不计算平均值（Query 层按 sum/count 计算）；不存 min（第一版不需要）；
- 第一版不支持 percentile/直方图；若未来需要，作为新 ADR 决策（重新评估条件）。

## 22. count、sum、min、max 或其他统计量是否需要

- 需要：`observed_count`、`value_sum`、`value_max`；
- 不需要：`value_min`（无 UI 依据）；
- 不实现：percentile、Histogram、t-digest、HLL。

## 23. 是否需要分布、直方图、分位数原材料

- **不需要**（第一版）：C6 UX 要求百分位必须由 Performance Metric Query 返回，但 PRD §15.2 明确"错误总量只能基于实际收到的数据估算"，第一版无采样外推、无 percentile 承诺（与 ADR-020 决定细节 2 一致，性能同源）；
- 若未来批准 percentile，需新 ADR 决定原材料存储（Histogram/t-digest），不在 DAT-08。

## 24. 不得因未来 UI 猜测 p50/p75/p95

- 本模块不存任何 percentile 原材料；
- 不创建 p50/p75/p90/p95/p99 列；
- 不创建 Histogram/t-digest 表；
- C6 的百分位能力属未来 ADR + DAT-17；
- **明确 defer 声明**：C6 §7.21"百分位必须由 Performance Metric Query 返回"在该 store（count/sum/max）上结构性不可满足；percentile 原材料（histogram/t-digest）属未来 histogram ADR，届时才可由 Performance Metric Query 返回百分位。第一版不承诺 C6 百分位展示。

## 25. 浮点数和 decimal 精度

- `value`：协议层已校验（millisecond 为安全整数；ratio 为 `0..1` 有限非负，可小数）；
- 存储用 `numeric`（`value_sum`/`value_max`），避免浮点误差与整数溢出；
- `ratio` 的 CLS 值以 `numeric` 原样存储（不转浮点）；
- 求和用 `numeric` 精确累加；查询层再按需格式化。

## 26. CLS 与毫秒类指标单位差异

- `unit` 列区分 `millisecond`（lcp/inp/page_load）与 `ratio`（cls）；
- 聚合列统一为 `value_sum`/`value_max`（数值语义），不因单位分列；
- 查询层（DAT-17）按 `unit` 展示单位与精度；本模块不格式化。

## 27. 非有限值、负值、超限值的行为

- 由协议解析器拦截：`NaN`/`Infinity`/负值/越界返回 `invalid_number`；
- Repository 把协议 `invalid` 结果映射为 `invalid_input`（稳定 code，不回显输入）；
- `temporarily_unavailable`：数据库暂时失败；
- 非有限/负值/超限**不写入**聚合或样本；测试覆盖。

## 28. event occurredAt 与 processing time 的使用边界

- 聚合桶时间基准：信封 `occurredAt`（事件产生时间），与 ADR-019/020 口径一致；
- `startedAt`（性能测量开始时间）作为样本投影字段保存，不作为桶时间基准；
- `created_at`/`applied_at` 用数据库 `now()`（处理时间），只作审计，不作聚合时间；
- 批次延迟不影响桶归属。

## 29. 幂等键

- 聚合：`(project_id, event_id)` 事件应用登记唯一（`performance_metric_event_applications` 表）；
- 样本：`(project_id, event_id)` 唯一（`performance_event_samples` 表）；
- 事件应用登记只存 `project_id`/`event_id`/`applied_at` 最小字段。

## 30. 重复消费行为

- 同一 `(project_id, event_id)` 再次投递：聚合登记 `ON CONFLICT DO NOTHING` → duplicate → 不更新桶；
- 样本 `ON CONFLICT DO NOTHING` → duplicate → 不重复占容量；
- retry/replay/lease recovery 下幂等（与 ADR-018/019/020 一致）。

## 31. aggregate upsert 的原子性

- 同事务：`BEGIN → 登记事件应用 → duplicate 跳过 → 首次登记 UPSERT 桶 → COMMIT`；
- 任一步失败 `ROLLBACK`；禁止先查后插；
- `ON CONFLICT (project_id, bucket_start, metric_name, unit) DO UPDATE SET observed_count = observed_count + 1, value_sum = value_sum + $v, value_max = GREATEST(value_max, $v), updated_at = now()`。

## 32. 样本插入与聚合更新的事务边界

- **不跨 Store 事务**：聚合与样本是两个独立持久化调用，各自原子（与请求 metric/sample 跨 Store retry 收敛一致）；
- 收敛通过 retry + 各自幂等实现，不引入 Store 间事务协调；
- 样本插入失败（`temporarily_unavailable`）不阻塞聚合已提交；下次执行聚合 duplicate + 样本重试。

## 33. 有限样本容量

- 第一版**不实现随机采样/容量水位**：本模块只提供确定性样本资格判断所需的存储；"有限"由"只有经未来样本选择策略判定 store 的事件才调用 `persistPerformanceEventSample`"保证；
- 不设置数据库层容量上限列；
- 容量/水位管理属未来采样与额度模块（PRD §15），不在 DAT-08。

## 34. 样本选择策略

- **不实现**：样本是否保存的判定属未来 Performance Processor（DAT-09）与未来性能样本选择策略；
- 本模块 Repository 只持久化"已由上游选中的合法性能事件"；
- `persistPerformanceEventSample` 不判断类别，只校验协议合法性与幂等。

## 35. 相同事件重放不得重复占用容量

- `(project_id, event_id)` 唯一约束保证重放最多一行样本；
- 重复调用返回 `duplicate`，不新增行、不覆盖原行（first-wins）。

## 36. 样本替换语义

- 第一版：**不替换**。已有样本保持 first-wins；
- 未来"样本替换原则"（PRD §9.3.5 属错误样本域）不适用于性能样本；性能样本无代表性替换需求（性能诊断样本按时间/指标有限保留）；
- 若未来需要替换策略，由新规格决定。

## 37. 样本保留原因

- 性能样本用于诊断"某页面/指标在特定时间段的性能退化证据"；
- 样本是聚合的补充（聚合给出趋势，样本给出单次观测的安全投影）；
- 保留期遵守 PRD §16（完整事件详情 30 天）；本模块不实现清理任务；
- **采样/水位/额度信任元数据前向依赖**：C6 §7.21 的采样/水位/额度影响展示在本 store 内无数据源；采样率（PRD §15.2，SDK 侧）与额度/用量（PRD §15.9，平台用量/额度模块）是前向依赖，由未来平台用量/额度模块经 DAT-17 呈现，本 store 第一版不含此类列。

## 38. 并发 Worker 下的正确性

- 多个 Worker 并发处理同一事件：应用登记唯一约束保证最多一次聚合与一行样本；
- 并发不同事件：各自事务独立，桶 UPSERT 原子；
- `SELECT ... FOR UPDATE` 不需要（唯一约束 + `ON CONFLICT` 已保证，与 ADR-018/019/020 一致）。

## 39. 行锁、唯一约束或原子 SQL 策略

- 采用**唯一约束 + 原子 SQL**（`ON CONFLICT DO NOTHING`/`DO UPDATE`），不使用显式行锁；
- 同 client 同事务保证原子性；
- 与错误/请求存储完全一致。

## 40. 数据保留

- PRD §16：分钟级聚合 30 天；样本属"完整事件详情"范畴 30 天；
- 本模块**不实现**保留/清理任务（属未来 SEC-02/保留任务）；
- 表中不预置 `expires_at` 列（保留策略由未来任务决定）。

## 41. 项目删除和账号删除传播

- 本模块不实现删除传播（属 SEC-02/A5）；
- 表结构不引入指向用户/账号的外键（性能存储无用户维度）；
- 项目删除时性能表随项目清理属未来数据生命周期任务。

## 42. 备份淘汰关系

- 性能表参与数据库备份；保留/淘汰由备份策略（OPS-07）决定；
- 本模块不建独立备份逻辑。

## 43. 敏感字段限制

禁止保存：

- 请求/响应体、Header、Cookie、Authorization、Token；
- 完整 URL、路径动态段、查询参数值、片段；
- DOM、页面文本、用户输入、Storage；
- 用户标识、session、IP、设备指纹；
- 未批准的性能指标/单位/上下文。

## 44. 日志和诊断禁止字段

- Repository 不写日志；
- 错误结果不回显输入值、不暴露 SQL/SQLSTATE/约束名/数据库错误码；
- 诊断（如未来 Processor 使用）不得含事件正文、指标值、project_id 明文或任何敏感字段。

## 45. PostgreSQL 表、约束和索引职责

`performance_metric_buckets`：
- `UNIQUE(project_id, bucket_start, metric_name, unit)`；
- CHECK：`observed_count >= 0`、`value_sum >= 0`、`value_max >= 0`、`value_max <= value_sum`（当 count>0 时语义上成立）。

`performance_metric_event_applications`：
- `PRIMARY KEY(project_id, event_id)`。

`performance_event_samples`：
- `UNIQUE(project_id, event_id)`；
- CHECK：`jsonb_typeof(sample_body) = 'object'`。

## 46. Migration forward compatibility

- Migration 追加式；可 up/down；
- 不修改 processing-store 既有 Migration（`1722500000003`—`1722500000005`；`0000—0002` 属 ingestion-inbox，本模块不触碰）；
- 新 Migration 时间戳晚于 `1722500000005_request-metric-aggregation.ts`；
- 前向兼容：旧版本代码不读取新表；新表不与既有表冲突；
- 集成测试 `beforeAll` 需同步 DROP 新表以维持 fresh-up 语义。

## 47. 回滚边界

- Migration 发布前缺陷：直接修改未发布 Migration；
- Migration 发布后：向前修复与 expand/contract；destructive down 不作为生产默认回滚；
- Repository 与 Worker/Error/Request Store 解耦，可替换而不影响既有公共接口。

## 48. Repository 公共接口

包根新增导出：

```ts
export function persistPerformanceMetricContribution(
  pool: Pool,
  input: unknown,
): Promise<PersistPerformanceMetricContributionResult>;

export type PersistPerformanceMetricContributionResult =
  | { readonly status: 'applied' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

export function persistPerformanceEventSample(
  pool: Pool,
  input: unknown,
): Promise<PersistPerformanceEventSampleResult>;

export type PersistPerformanceEventSampleResult =
  | { readonly status: 'inserted'; readonly sampleId: string }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };
```

## 49. 稳定错误类别

- `invalid_input`：顶层结构非法、协议解析失败、字段越界、未知指标/单位；
- `temporarily_unavailable`：数据库暂时失败；
- `applied`/`inserted`/`duplicate`：成功/幂等成功；
- 不暴露 SQLSTATE/约束名/SQL/数据库错误码。

## 50. 真实 PostgreSQL 测试

覆盖适用的：

- Migration up/down/up；
- 表和约束存在；
- 唯一键；
- 同一事件重复（聚合 duplicate + 样本 duplicate）；
- 并发 upsert；
- 样本容量；
- 样本重复；
- 样本 first-wins；
- transaction rollback；
- 非法 metric（未知指标/单位）→ invalid_input；
- 非有限/负值/越界值 → invalid_input；
- 精度（CLS ratio、毫秒求和不溢出）；
- 跨项目隔离；
- Repository 稳定错误；
- 无敏感字段；
- 后续 Migration 前向兼容。

## 51. 容量和性能假设

- 性能事件 10% 采样（PRD 5.1.9）假设下，分钟级桶 + `(project_id, event_id)` 幂等索引可支撑第一版；
- 不假设生产容量（requires-benchmark 属未来）；
- 不创建 GIN/全文索引。

## 52. 未来 DAT-09 的消费契约

- DAT-09 Performance Processor 通过 `@aurora/processing-store` 包根调用 `persistPerformanceMetricContribution`（先）→ 样本资格判断（未来策略）→ `persistPerformanceEventSample`（后）；
- Processor 必须显式提供 `metricName`/`unit`/`value`/`startedAt`/`durationMs?`（Store 校验类型不判断分类）；
- Store 结果映射到 Worker 结果（applied/inserted/duplicate → processed；invalid_input → dead-letter；temporarily_unavailable → retry）由 DAT-09 负责。

## 53. 未来 DAT-17 只能依赖安全 Query，不得直接复用 Repository

- DAT-17 Performance Query 只能通过未来公开 Query/投影接口读取聚合，不得导入 `persist*` Repository 私有实现或直接执行 SQL；
- 本模块 Repository 是写侧接口，不承担读侧投影；
- 未来 DAT-17 规格不得把写侧 Repository 当作 Query 公共接口。

## 54. deferred

- 页面/环境/发布版本维度（协议层缺字段，契约缺口）；
- percentile/直方图/超标比例原材料；
- 采样率执行与采样外推；
- 数据保留/清理任务；
- 项目/账号删除传播；
- 小时/天级聚合下采样；
- 样本替换/容量水位；
- safe page identity 归一化。

## 55. out-of-scope

- DAT-09 Performance Processor；
- DAT-10 Event Processor Router；
- DAT-11 production composition root；
- DAT-17 Performance Query projection；
- 管理平台 C6 页面、Platform OpenAPI；
- 告警计算、Issue 创建；
- SDK 性能采样算法、transport、队列、上报；
- 通用 Resource Event、Resource Timing、资源尺寸、缓存状态、initiatorType；
- 原始完整 URL、查询参数值、页面文本、DOM；
- 请求体、响应体、Cookie、Authorization；
- Redis、BullMQ、对象存储、搜索引擎、新云资源。

## 56. 完成标准

- `performance_metric_buckets` + `performance_metric_event_applications` + `performance_event_samples` Migration 存在并可 up/down/up；
- `persistPerformanceMetricContribution`/`persistPerformanceEventSample` Repository 实现并导出；
- 幂等、原子事务、稳定错误、隐私负例全部有测试；
- 真实 PostgreSQL 17.10 集成测试覆盖 §50 场景并通过；
- 包根导出、README、正式规格、ADR-021 证据、formalization-readiness、remaining-module-batches 同步；
- 全仓质量门禁（typecheck/lint/unit/integration/coverage/boundaries/build/package/format）通过；关键核心包覆盖率 lines ≥ 85%、branches ≥ 80%。

## 57. PRD、协议、ADR 和测试追踪矩阵

| 权威来源 | 条款 | 本模块落实 |
| --- | --- | --- |
| PRD 5.1.9 | 基础页面性能默认开启；默认采样 10%；主要进入聚合指标；不为每次性能数据生成问题 | 聚合主路径 + 有限样本；采样率不实现（SDK 层） |
| PRD §16 | 分钟级聚合 30 天；完整事件详情 30 天 | 保留策略记录；清理任务 deferred |
| PRD §12 | 环境/发布/时间通用筛选 | 环境/发布维度记录为契约缺口 |
| PRD §15 | 采样、限流、额度、降级 | 采样/额度不实现；不硬编码阈值 |
| Performance Contract §4—10 | 四项指标、两单位、限制、解析 | 复用包根解析与枚举；只存四项 |
| Performance Contract §17 | 排除性能聚合、采样、页面/URL | 本模块只存聚合/样本；页面/URL 禁止 |
| C6 UX §7.21 | 页面身份服务端返回；百分位/趋势必须 Query 返回；前端不得从样本计算 | 页面身份 deferred；percentile deferred；样本只存安全投影 |
| ADR-010 | PostgreSQL 17 + pg + node-pg-migrate + SQL-first | 全模块遵守 |
| ADR-018—020 | 幂等/事务/隐私/稳定错误先例 | 复用模式；不复制表/公式 |
| ADR-021（accepted，用户 2026-08-05 正式批准） | 性能聚合与样本存储物理模型 | 本规格为其实施规范 |

## 58. 实施记录（2026-08-05）

- **Migration**：`packages/processing-store/migrations/1722500000006_performance-aggregate-and-sample.ts` —— 创建 `performance_metric_buckets`（唯一键 `(project_id, bucket_start, metric_name, unit)`、CHECK `observed_count >= 0 AND value_sum >= 0 AND value_max >= 0 AND value_max <= value_sum`）、`performance_metric_event_applications`（PK `(project_id, event_id)`）、`performance_event_samples`（唯一 `(project_id, event_id)`、CHECK `jsonb_typeof(sample_body) = 'object'`）；可 up/down；
- **Repository**：`src/performance-metric-types.ts`/`performance-metric-contribution.ts`（`computeBucketStart` + `parsePerformanceMetricContributionInput` unknown 校验）/`performance-metric-repository.ts`（同事务 登记→duplicate 跳过→UPSERT 桶→COMMIT）；`src/performance-sample-types.ts`/`performance-sample-input.ts`（白名单投影）/`performance-sample-repository.ts`（事务 INSERT ON CONFLICT DO NOTHING）；
- **包根导出**：`persistPerformanceMetricContribution`/`persistPerformanceEventSample` 及类型；
- **测试**：单元测试（14 输入/桶算法 + 4 聚合 Repository + 6 样本输入 + 4 样本 Repository）、真实 PostgreSQL 17.10 集成测试（migrations 7 + performance-metric 10 + performance-sample 5 + 既有 error/request 回归 38），全仓质量门禁通过；覆盖率满足 85/80/85/85；
- **状态**：`implementation-status: implemented`；ADR-021 实施状态于同日更新为 implemented（见 ADR 追加记录）；`implemented-in-working-tree`（未提交、未合并、未发布、未生产部署）。

## 59. 联合模式规格审批记录

- PRD coverage: pass
- protocol consistency: pass（四项指标/两单位/限制逐条来自 performance-event-contract）
- accepted ADR coverage: **pass**（ADR-021 已于 2026-08-05 由用户正式批准为 accepted / approved）
- storage boundary: pass
- idempotency review: pass（作者自检）
- privacy review: pass（作者自检）；**独立隐私/数据治理评审完成**（ADR-021 追加记录，ACCEPT-WITH-REVISIONS，revisions 已落实）
- migration review: pass
- DAT-09 exclusion: pass（无 processor 逻辑）
- DAT-17 exclusion: pass（无读侧投影）
- unresolved decisions: **none**（ADR-021 全部决策要点已由用户逐条批准；percentile/直方图原材料、采样/水位/额度信任元数据已记录为明确 deferred/前向依赖）
- user continuation authorization: current joint-mode instruction
- note: this approval does not accept or modify any ADR

**门禁说明**：required ADR-021 已 accepted（用户 2026-08-05 正式批准）。本规格批准用于创建实施计划与正式实施；percentile/直方图、平台 UI、DAT-09/17、事件协议修改、新基础设施均不在批准范围。
