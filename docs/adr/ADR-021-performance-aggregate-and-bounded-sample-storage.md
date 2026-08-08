---
title: ADR-021：性能指标聚合与有界诊断样本存储
status: accepted
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
date: 2026-08-03
last-reviewed: 2026-08-05
applies-to: packages/processing-store（@aurora/processing-store）的性能指标聚合存储（performance_metric_buckets 表、performance_metric_event_applications 表、persistPerformanceMetricContribution Repository）与有限性能诊断样本存储（performance_event_samples 表、persistPerformanceEventSample Repository）
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
  - ../../docs/architecture/request-metric-aggregate-store.md
  - ../../docs/architecture/performance-metric-aggregate-and-bounded-sample-store.md
  - ../../docs/adr/ADR-005-event-schema-source-of-truth.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../docs/adr/ADR-012-ingestion-worker-runtime.md
  - ../../docs/adr/ADR-018-error-event-occurrence-processing-storage.md
  - ../../docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md
  - ../../docs/adr/ADR-020-idempotent-request-metric-bucket-aggregation.md
  - ../../docs/protocol/performance-event-contract.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
superseded-by: none
---

# ADR-021：性能指标聚合与有界诊断样本存储

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-user-approval
- 日期：2026-08-03
- Owner：ingestion/backend
- 适用范围：`packages/processing-store`（`@aurora/processing-store`）的性能指标聚合存储（`performance_metric_buckets` 表、`performance_metric_event_applications` 表、`persistPerformanceMetricContribution` Repository）与有限性能诊断样本存储（`performance_event_samples` 表、`persistPerformanceEventSample` Repository）
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 5.1.9、12、14、15、16 节
- 关联协议：[性能事件协议契约](../../docs/protocol/performance-event-contract.md)（approved / implemented）
- 关联 Inbox：[Inbox 数据模型正式规格](../../docs/architecture/ingestion-inbox-data-model.md)、[Inbox 处理侧 Repository 正式规格](../../docs/architecture/ingestion-inbox-processing-repository.md)
- 关联 Worker：[Worker 运行时正式规格](../../docs/architecture/ingestion-worker-runtime.md)
- 关联 Error store：[错误事件 occurrence 处理存储正式规格](../../docs/architecture/error-event-occurrence-processing-store.md)
- 关联 Request store：[请求事件安全样本存储正式规格](../../docs/architecture/request-event-sample-processing-store.md)、[请求指标聚合存储正式规格](../../docs/architecture/request-metric-aggregate-store.md)
- 关联 DAT-08 规格：[性能指标聚合与有界诊断样本存储正式规格](../../docs/architecture/performance-metric-aggregate-and-bounded-sample-store.md)（draft）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-03 创建为 `proposed`。创建依据：DAT-08 分组基线明确"独立 ADR 缺失"；ADR 规范 7.2 触发（新增核心处理表、迁移/回滚成本高、存在多个合理存储方案需长期保留取舍依据）。本 ADR 处于 `proposed / not-started / awaiting-user-approval`。它需要独立非作者架构/后端评审、数据库领域评审与隐私/数据治理评审（可派发 reviewer subagent），但评审意见不代替用户正式批准。**在用户批准（accepted）前，不得创建正式 Migration、实现代码，不得进入 writing-plans。**

## 背景

Aurora 已接受 ADR-004（可靠接收与异步处理）、ADR-005（event-schema 单一来源）、ADR-008（PostgreSQL 事务性 Inbox）、ADR-010（PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first）、ADR-012（Worker 运行时）、ADR-018（错误 occurrence 存储）、ADR-019（请求聚合主路径＋有限样本）、ADR-020（幂等请求指标桶聚合）。`@aurora/event-schema` 已实现性能事件协议契约第一增量（`PerformanceEventBody` 六字段：metricCategory/metricName/value/unit/startedAt/可选 durationMs；`PerformanceMetricName` 四项：lcp/inp/cls/page_load；`PerformanceMetricUnit` 两单位：millisecond/ratio；`PERFORMANCE_EVENT_LIMITS`）。`@aurora/processing-store` 已实现错误 occurrence 存储、请求安全样本存储、请求指标聚合存储。

当前真实缺口：性能事件进入 Inbox 后，**没有任何处理存储**。PRD 5.1.9 定义基础页面性能默认开启、默认采样率 10%、主要进入聚合指标、不为每次普通性能数据生成问题。C6 UX §7.21 定义 LCP/INP/CLS/页面加载耗时、百分位、超标比例和时间序列必须由 Performance Metric Query 返回；前端不得从有限性能样本计算总体；页面必须展示采样/水位/额度影响。PRD §16 定义分钟级聚合 30 天、完整事件详情 30 天。但 PRD 未明确"性能数据如何物理存储"的长期存储边界（聚合粒度、维度、聚合统计量、样本容量、样本保留、percentile 原材料）。性能存储的物理模型属于需要长期保留取舍依据的高迁移成本决策，按 ADR 规范 7.2 需创建独立 ADR。

## 决策驱动因素

- **性能数据量大**：即使 10% 采样，性能事件量仍远大于错误量；完整逐条明细存储/索引/删除成本高；
- **聚合主路径**：PRD 5.1.9"页面性能主要进入聚合指标，不为每一次普通性能数据生成问题"；
- **诊断需求**：性能退化需要有限安全样本供问题定位；
- **UX 数据语义**：C6 采用服务端指标查询，页面只读取聚合性能数据，不提供逐次访问记录；
- **隐私与配额**：页面地址、参数可能含敏感信息，完整明细扩大隐私与配额风险；
- **复用已批准工具链**：与 Error/Request store 一致使用 PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first；
- **不建逐条性能历史**：第一版不构建完整性能 occurrence 历史产品。

## 现有约束

- ADR-005：外部输入按不可信数据运行时校验；event-schema 是事件 Schema 唯一来源；
- ADR-008：`(project_id, event_id)` 租户作用域幂等键；
- ADR-010：PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first；禁止 ORM/Query Builder；Migration 追加式；
- ADR-012：Worker 只从包根消费；不直接访问数据库内部；
- ADR-018/019/020：错误/请求存储先例；只作事务/幂等/隐私/稳定错误模式参考，不自动授权性能表/维度/公式；
- 性能事件协议契约：`PerformanceEventBody` 六字段、`parsePerformanceEventEnvelope`、`PerformanceMetricName` 四项、`PerformanceMetricUnit` 两单位、`PERFORMANCE_EVENT_LIMITS`；性能正文**不含**页面/环境/发布版本字段；
- PRD 5.1.9、§12、§14、§15、§16 与 C6 UX §7.21；
- 代码规范：严格 TypeScript、参数化 SQL、稳定结果、不暴露 SQLSTATE/约束名/SQL、敏感信息不入日志。

## 候选方案

### 方案 A：逐条性能 occurrence 明细表（不采用）

**行为**：对每条合法性能事件逐条持久化完整 occurrence 明细到明细表。

**优点**：实现直接；replay/调试容易；聚合可从明细重算。

**缺点**：与"主要进入聚合指标、不为每次性能数据生成问题"冲突；性能量远大于错误量；存储/索引/删除成本高；容易形成完整性能历史产品；隐私与配额风险扩大。

**选择结论**：不采用。

### 方案 B：聚合主路径＋有界安全诊断样本（推荐）

**行为**：合法性能事件 → 性能指标与分钟桶聚合（主路径）→ 仅在满足未来样本选择策略时保存有限安全样本。详细记录是"有限诊断样本"，不是完整性能历史。

**优点**：符合 PRD 5.1.9 与 C6 UX 数据语义；支持性能时间序列/趋势；保留必要诊断证据；控制存储、隐私和删除成本；不构建逐条性能历史产品。

**缺点**：需要聚合与样本两个存储边界；无法从样本重算全部指标；需要明确样本资格判定（未来 DAT-09 + 样本选择策略）。

**选择结论**：采用。

### 方案 C：只保留聚合，不保存任何性能详细样本（不采用）

**行为**：性能事件只参与聚合，不保存任何详细样本。

**优点**：数据量和隐私风险最低；数据模型简单。

**缺点**：性能退化缺少必要诊断证据；C6 无法查看代表样本；不利于问题定位。

**选择结论**：不采用。

### 候选比较

| 维度 | A：逐条明细 | B：聚合＋有限样本 | C：只聚合 |
| --- | --- | --- | --- |
| 与"主要进入聚合指标"一致 | 否 | 是 | 是 |
| 诊断证据 | 完整 | 必要 | 无 |
| 存储/索引/删除成本 | 高 | 可控 | 最低 |
| 隐私与配额风险 | 高 | 可控 | 最低 |
| 从样本重算指标 | 可 | 不可 | 不适用 |
| 形成逐条性能历史产品 | 风险高 | 明确不构建 | 否 |
| 第一版成本 | 高 | 中低 | 低 |

## 最终决策

**最终选择方案 B：聚合主路径＋有界安全诊断样本。**

### 决定细节（全部在本 ADR 冻结）

1. **存储边界**：合法性能事件 → 性能指标与 UTC 一分钟桶聚合（主路径）→ 仅在满足未来样本选择策略时保存有限安全样本。本 ADR 不决定 Performance Processor 的事务边界（DAT-09），不决定 Performance Query 投影（DAT-17）。
2. **存储能力**：本模块实现 `@aurora/processing-store` 内的 `performance_metric_buckets`/`performance_metric_event_applications` 表 + `persistPerformanceMetricContribution` Repository + `performance_event_samples` 表 + `persistPerformanceEventSample` Repository + 幂等 + 稳定结果；不实现 Performance Processor、样本选择策略执行器、Query、路由、production composition root、Issue、告警、数据删除任务。
3. **只存四项批准指标**：只接受 `PerformanceMetricName` 的 `lcp`/`inp`/`cls`/`page_load`；不纳入未批准指标（fcp/ttfb/custom 等）；输入经 `@aurora/event-schema` 包根 `parsePerformanceEventEnvelope` 校验。
4. **聚合桶粒度**：UTC 一分钟固定桶：`bucket_start = occurredAt 向下取整到 UTC 分钟`；底层时间始终是 UTC 真实时间；组织业务时区只在未来 Query 中解释查询和展示边界，不改变桶内时间。
5. **聚合维度**：`(project_id, bucket_start, metric_name, unit)` 唯一键。**第一版不加入 page/environment/release 维度**——性能事件协议层无这些字段（与 ADR-020 记录 C5 环境/发布/来源维度为契约缺口同理）；不得自行扩展 event-schema 或凭空造字段。
6. **聚合统计量**：`observed_count`、`value_sum`、`value_max`；不实现 `value_min`（无 UI 依据）；不实现 percentile/直方图/t-digest/HLL（第一版无可加合并基础指标之外的承诺，与 ADR-020 决定细节 2 一致）。
7. **数值精度**：`value_sum`/`value_max` 用 `numeric`；CLS（ratio，0..1 可小数）与毫秒类指标统一为数值和/最大值，`unit` 列区分语义；`numeric` 避免浮点误差与整数溢出（协议 `maxValueSafeInteger` 为 32 位，但求和会超）。
8. **样本白名单投影**：`performance_event_samples.sample_body` 为受协议约束 jsonb，只存性能正文安全字段白名单（`metricName`/`value`/`unit`/`startedAt`/可选 `durationMs`）；CHECK `jsonb_typeof(sample_body) = 'object'`；不存完整信封、页面/环境/发布字段、URL、DOM、用户信息；不添加 GIN/全文索引。
9. **幂等**：聚合 `(project_id, event_id)` 应用登记唯一（`performance_metric_event_applications`）；样本 `(project_id, event_id)` 唯一；`ON CONFLICT DO NOTHING`；duplicate 不更新原记录。
10. **原子事务**：聚合同事务 `BEGIN → 登记 → duplicate 跳过 → 首次登记 UPSERT 桶 → COMMIT`；任一步失败 ROLLBACK；禁止先查后插。样本独立事务 `INSERT ... ON CONFLICT DO NOTHING RETURNING id`。
11. **无跨 Store 事务**：聚合与样本是两次独立持久化调用；收敛通过 retry + 各自幂等实现，不引入 Store 间事务协调（与请求 metric/sample 跨 Store 收敛一致）。
12. **样本容量**：第一版不实现随机采样/容量水位；"有限"由未来样本选择策略（DAT-09 + 性能样本选择策略）判定 store 才保存保证；本 Repository 只持久化"已由上游选中的合法性能事件"。
13. **数据保留**：PRD §16 分钟级聚合 30 天、完整事件详情 30 天；本 ADR 不实现清理任务；表中不预置 `expires_at` 列。
14. **不修改**：performance-event-contract、ingestion-api、POST /v1/batches、Worker、Error store、Error processor、Request store、retry/backoff/replay、event-schema。
15. **包边界**：扩展现有 `packages/processing-store`（`aurora.layer: data`），不新建包；新增 Migration 时间戳晚于 `1722500000005_request-metric-aggregation.ts`；`@aurora/processing-store` 不新增运行时依赖（`pg` 已存在；`@aurora/event-schema` 为 devDependency/vitest alias）。
16. **Repository 稳定错误**：`invalid_input`（顶层非法/协议解析失败/未知指标/越界）、`temporarily_unavailable`（数据库暂时失败）、`applied`/`inserted`/`duplicate`（成功/幂等）；不暴露 SQLSTATE/约束名/SQL。
17. **隐私**：禁止请求/响应体、Header、Cookie、Authorization、完整 URL、查询参数、DOM、页面文本、用户标识、session、IP、设备指纹；Repository 不写日志。
18. **真实 PostgreSQL 门禁**：集成测试必须使用真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL`（目标必须是测试数据库）；禁止 SQLite/mock/PGlite 证明数据库约束。
19. **未来 DAT-17 边界**：DAT-17 Query 只能依赖未来公开 Query/投影接口，不得直接复用写侧 Repository 或直接执行 SQL。

## 结果与影响

### 正面影响

- 符合 PRD 5.1.9 与 C6 UX 数据语义；
- 支持性能时间序列/趋势；
- 保留必要诊断证据；
- 控制存储、隐私和删除成本；
- 不构建逐条性能历史产品；
- 与 Error/Request store 复用同一工具链。

### 负面影响与代价

- 需要聚合与样本两个存储边界；
- 无法从样本重算全部指标；
- 需要明确样本资格判定（未来 DAT-09 + 样本选择策略）；
- 页面/环境/发布维度缺字段，C6 页面列表能力依赖未来协议扩展。

### 未解决问题

- 样本选择策略的精确规则（未来 DAT-09 + 性能样本选择策略）；
- 页面/环境/发布维度的协议扩展（契约缺口）；
- percentile/直方图原材料（未来 histogram/t-digest ADR；**C6 百分位展示超出第一版**）；
- 采样/水位/额度信任元数据（前向依赖平台用量/额度模块，经 DAT-17 呈现）；
- 性能数据保留期限的清理任务（数据生命周期规则）；
- 生产容量/成本基准（requires-benchmark）。

## 实施约束

- 完全遵守 ADR-005/008/010/012/018/019/020；不修改 `@aurora/ingestion-inbox`、`@aurora/event-schema`、`apps/ingestion-worker`、`apps/ingestion-api`、OpenAPI；
- `@aurora/processing-store` 新增 `performance_metric_buckets`/`performance_metric_event_applications`/`performance_event_samples` Migration 与 `persistPerformanceMetricContribution`/`persistPerformanceEventSample` Repository；不创建通用 Repository 泛型框架；
- 输入经 `@aurora/event-schema` 根入口 `parsePerformanceEventEnvelope`/`parsePerformanceEventBody` 验证；只保存安全投影字段；
- SQL 全参数化；不暴露 SQLSTATE/约束名/SQL；
- 不记录请求体/响应体/Header/Cookie/Authorization/敏感查询/完整 URL/DOM/文本/IP/指纹；
- Workspace Policy：`data → {protocol}`（现有允许矩阵已支持）。

## 迁移方案

本 ADR accepted 后：DAT-08 正式规格从 draft 更新为 approved → writing-plans → 实施 `performance_metric_buckets`/`performance_metric_event_applications`/`performance_event_samples` Migration + 两个 Repository → 真实 PostgreSQL 17 集成验证。

## 回滚方案

- Migration 发布前缺陷：可直接修改未发布 Migration；
- Migration 发布后：向前修复与 expand/contract；destructive down 不作为生产默认回滚；
- Repository 实现与 Worker 主循环/Error/Request store 解耦，可替换而不影响既有公共接口。

## 验证方式

- 单元测试：UTC 分钟桶算法、指标字段校验、未知指标/单位拒绝、数值越界/非有限拒绝、样本白名单投影、输入不变、稳定结果、不泄露数据库错误；
- 真实 PostgreSQL 17：首次应用、duplicate 不更新桶、并发幂等、不同 eventId 同桶分别计数、样本插入/重复/first-wins、桶更新异常整体回滚、样本非法不写入、Migration up/down/up、Schema/Pool 清理；
- 回归：event-schema、Error store、Request Sample store、Request Metric store、Worker、ingestion-api 全部测试通过；OpenAPI 无变化；
- 全仓质量门禁与覆盖率 85/80/85/85。

## 重新评估条件

- 性能量变化使一分钟桶粒度不满足 C6 时间序列；
- 需要 percentile 或更高分辨率桶；
- 需要页面/环境/发布维度且协议字段已批准；
- 数据生命周期规则要求同步性能表保留；
- 需要样本支持重算聚合。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-03：创建（proposed）

- 状态 `proposed / not-started / awaiting-user-approval`；
- 由 2026-08-03 DAT-08 实施就绪审计创建；
- 审计确认：DAT-07 真实可用（implemented-in-working-tree）；remaining=45；无既有 DAT-08 规格/ADR；ADR-018—020 只作先例不授权性能模型；ADR-010 只授权工具链；性能事件协议层无页面/环境/发布字段；
- DAT-08 正式规格（draft）已同步创建：[performance-metric-aggregate-and-bounded-sample-store.md](../../docs/architecture/performance-metric-aggregate-and-bounded-sample-store.md)；
- 未调用 writing-plans、未创建 Migration、未实施代码；
- 等待独立非作者与隐私/数据治理评审 + 用户正式批准，不自动批准、不实施。

### 2026-08-03：独立评审（reviewer subagent，记录用，不代替正式批准）

> 本节点记录 reviewer subagent 意见。意见只用于改进决策材料，不改变 ADR 状态。正式接受必须由用户完成。

- **架构/后端 + 数据库领域评审**：`ACCEPT-WITH-REVISIONS`（无正确性或并发阻断）。设计忠实镜像 accepted ADR-018/019/020 同一工具链先例；`(project_id, bucket_start, metric_name, unit)` 唯一键无 NULL 陷阱；`numeric` 求和/最大值适合 CLS ratio 与毫秒指标；`ON CONFLICT` 原子 upsert 正确，无需行锁；Migration 追加无冲突；扩展 `@aurora/processing-store` 边界正确；DAT-09/17 边界正确。
  - **Load-bearing finding F1**：C6 §7.21 的"百分位必须由 Performance Metric Query 返回"在该 store（count/sum/max）上结构性不可满足；percentile 原材料（histogram/t-digest）被显式 defer。该 deferral 未出现在用户批准清单中。修正：在"等待用户批准"清单显式加入"percentile/直方图原材料 deferred → C6 百分位展示超出第一版，需要未来 histogram/t-digest ADR 才能由 Performance Metric Query 返回百分位"，并在 DAT-08 §58 加匹配说明。
  - 非阻断观察：N1 metricCategory 从样本白名单省略（v1 只有 page，无害，建议加一句说明）；N2 `performance_event_samples` 无 `protocol_version` 列（v1 单版本可接受，建议记录前向兼容假设）；N3 规格 §46 "不修改既有 Migration（0001—0005）"措辞不精确（processing-store 实为 `1722500000003`—`1722500000005`，0000—0002 在 ingestion-inbox）；N4 聚合 UPSERT 的 INSERT VALUES 未完全冻结（实施计划应钉死 `observed_count = 1, value_sum = $v, value_max = $v`）；N5 "有界"样本保证完全依赖未来性能样本选择策略（DAT-09 门禁应显式含容量上限）；N6 metricCategory 不在桶键（v1 只有 page 无歧义，未来第二类别需重评）；N7（正面）`unit` 入桶键正确隔离单位。
- **隐私/数据治理评审**：`ACCEPT-WITH-REVISIONS`（无泄露向量、A5 友好）。样本白名单符合性能协议 §7；聚合已充分匿名；无字段可泄露 body/Cookie/Authorization/敏感查询。
  - **Load-bearing finding F2**：C6 §7.21 的采样/水位/额度影响展示在该 store 内无数据源；采样率（PRD §15.2，SDK 侧）与额度/用量（PRD §15.9，平台用量模块）是前向依赖，DAT-17 不能从桶推导。修正：ADR-021 决定细节 12 与 DAT-08 §33 加一行"采样/水位/额度信任元数据是本 store 无法满足的前向依赖，由未来平台用量/额度模块经 DAT-17 呈现，本 store 第一版不含此类列"。
  - **Load-bearing finding F3**：DAT-08 §58 的 `privacy review: pass` 应改为"作者自检 pass，独立评审 pending"，避免被误读为独立评审已完成。
  - 非阻断观察：N3 丢弃 metricCategory 可接受（建议加一句说明 + 未来第二类别需同时入样本白名单与聚合键）；N4 defer 保留清理与 ADR-019/020 先例一致（表会增长至未来 SEC-02，属生产前置非 v1 交付）；N5 设计支持项目删除/A5 传播（无用户维度；未来删除任务需显式枚举全部 project-scoped processing-store 表，或待 projects 表出现后引入 FK CASCADE）；N6 无泄露向量；N7 再识别风险可忽略（与 ADR-020 隐私评审接受口径一致）。

**评审落实（F1/F2/F3）**：已在本 ADR 决定细节 12、13 与"等待用户批准"清单、DAT-08 §33、§58 落实。详见各节修订。

### 2026-08-03：状态——等待用户批准

- 本 ADR 保持 `proposed / not-started / awaiting-user-approval`；
- 用户需批准的具体事项：方案 B（聚合主路径＋有界安全诊断样本）、UTC 一分钟桶、`(project_id, bucket_start, metric_name, unit)` 聚合键、`observed_count`/`value_sum`/`value_max` 统计量、样本白名单投影、`(project_id, event_id)` 幂等、不建逐条性能历史、页面/环境/发布维度为契约缺口、扩展 processing-store 不新建包；
- **percentile/直方图原材料 deferred**：C6 百分位展示超出第一版，需要未来 histogram/t-digest ADR 才能由 Performance Metric Query 返回百分位；
- **采样/水位/额度信任元数据前向依赖**：C6 的采样/水位/额度影响展示由未来平台用量/额度模块（PRD §15.9）经 DAT-17 呈现，本 store 第一版不含此类列；
- 用户批准前：不创建正式 Migration、不实现代码、不进入 writing-plans。

### 2026-08-03：用户正式批准（accepted）

- 用户已于 2026-08-03 对本 ADR 作出明确正式批准，批准范围（逐条）：
  1. 方案 B：性能聚合主路径＋有界安全诊断样本；
  2. UTC 一分钟 bucket；
  3. 聚合唯一键 `(project_id, bucket_start, metric_name, unit)`；
  4. 第一版聚合统计量 `observed_count`、`value_sum`、`value_max`；
  5. 性能诊断样本只保存规格中冻结的安全白名单投影，并以 `(project_id, event_id)` 保证幂等；
  6. 不直接对历史性能事件执行重新聚合；
  7. 扩展现有 `@aurora/processing-store`，不新建独立 processing-store 包；
  8. percentile、直方图及其原材料在第一版 DAT-08 中 deferred，不得借 DAT-08 实现 C6 百分位能力；
  9. 采样、水位、额度及展示可信度元数据继续依赖后续用量/额度模块，并由 DAT-17 的安全 Query 投影呈现；
  10. 本 ADR 从 proposed 转为 accepted。
- 批准范围仅适用于本 ADR 已记录并经过修订的决策范围；不得扩大到 DAT-09、DAT-17、平台 UI、百分位、直方图、新基础设施、事件协议修改或未列出的性能字段；
- 状态更新：`status: accepted`、`decision-status: accepted`、`approval-status: approved`、`implementation-status: not-started`；
- 原 proposed 历史记录完整保留（上文"创建（proposed）"、"独立评审"、"状态——等待用户批准"各节均未删除或覆盖）；
- 实施状态保持 `not-started`，直到 DAT-08 正式实施开始；本 ADR 不得在此时标记为 implemented 或 in-progress。

### 2026-08-05：DAT-08 性能聚合与有界样本存储第一增量实施证据

- 实施状态更新为 `implemented`：`packages/processing-store` 性能聚合与有界样本存储能力已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试、隐私负例与全仓质量门禁；Performance Processor（DAT-09）、Performance Query（DAT-17）、路由与生产接线仍未实现，故不扩大范围；
- 实施内容：Migration `1722500000006_performance-aggregate-and-sample.ts`（`performance_metric_buckets` + `performance_metric_event_applications` + `performance_event_samples`，唯一键/CHECK/幂等约束）；`src/performance-metric-types.ts`/`performance-metric-contribution.ts`/`performance-metric-repository.ts`（`computeBucketStart` UTC 一分钟桶、`parsePerformanceMetricContributionInput` unknown 校验、`persistPerformanceMetricContribution` 同事务 登记→duplicate 跳过→UPSERT 桶）；`src/performance-sample-types.ts`/`performance-sample-input.ts`/`performance-sample-repository.ts`（白名单投影 `metricName/value/unit/startedAt/可选 durationMs`、`persistPerformanceEventSample` 事务 INSERT ON CONFLICT DO NOTHING）；包根导出追加；
- 语义（决定细节 1—19 落实）：聚合键 `(project_id, bucket_start, metric_name, unit)`；统计量 `observed_count`/`value_sum`/`value_max`（`numeric`）；样本 `(project_id, event_id)` 幂等；无跨 Store 事务；percentile/直方图/超标比例 deferred；页面/环境/发布维度为契约缺口；
- 未修改：performance-event-contract/ingestion-api/Worker 运行时/processing-store 既有表（error/request）/Error processor/Request Processor/retry/backoff/replay/event-schema；未增加新包；
- 测试：单元测试（输入/桶算法/Repository）+ 真实 PostgreSQL 17.10 集成测试（migrations 7 + performance-metric 10 + performance-sample 5 + 既有 error/request 回归 38，共 6 文件 60 集成测试），覆盖率达 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%，全仓质量门禁通过；
- 正式规格：[performance-metric-aggregate-and-bounded-sample-store.md](../architecture/performance-metric-aggregate-and-bounded-sample-store.md)（approved + implemented）；
- 状态记录：performance aggregate and bounded sample store implemented；performance event processor not-started（DAT-09）；event processor routing not-started / blocked（DAT-10）；production worker composition not-started / blocked（DAT-11）；performance query projection not-started（DAT-17）；本 ADR 实施状态更新为 implemented；CI/RDS/IaC not-started。

### 2026-08-07：性能事件 Processor 核心第一增量（DAT-09）实施证据

- 实施状态更新：性能事件 Processor 核心能力已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁；Event Processor Router（DAT-10）、production composition（DAT-11）、Performance Query（DAT-17）仍未实现，故不扩大范围；
- 用户 2026-08-07 明确批准 DAT-09 产品/实现边界："DAT-09 V1 aggregates every valid received Performance Event and does not persist bounded performance diagnostic samples"（方案 2，解除样本选择策略阻塞；不创建 ADR-022；不删除/废弃本 ADR 批准的 sample Store，仅当前未激活）；
- 实施内容：`apps/ingestion-worker` 内部 `src/performance-event-processor.ts`（`PerformanceEventProcessorDiagnostic(s)` 诊断端口、`PersistPerformanceMetricFn` 注入类型、`mapPerformanceMetricResultToWorkerResult` 结果映射、`createPerformanceEventProcessor` 工厂：只处理 `EventType.Performance`、经 event-schema 包根 `parsePerformanceEventEnvelope` 解析、构建 `PerformanceMetricContributionInput` 并调用 `persistPerformanceMetricContribution` 聚合主路径、把 `applied`/`duplicate`/`invalid_input`/`temporarily_unavailable` 映射到既有 Worker 结果、复用 ADR-016 backoff；**V1 不调用 `persistPerformanceEventSample`**；无服务器侧二次采样，SDK 10% 采样与本处理器服务端聚合是分离关注点），正式规格 [performance-event-processor.md](../architecture/performance-event-processor.md)（approved + implemented）；
- 未修改：performance-event-contract/ingestion-api/Worker 运行时/processing-store 表/Error store/Request store/retry/backoff/replay/event-schema；未增加 Migration；`@aurora/ingestion-worker` 未新增依赖；
- 测试：单元测试（15 个：解析/聚合/映射/幂等/unknown 异常/backoff 非法/no-sample spy/no-sampling 确定性/输入不变/诊断）+ 真实 PostgreSQL 17.10 集成测试（7 个：lcp 聚合、cls ratio 桶、replay 幂等、不写样本、temporarily_unavailable 收敛、非 Performance 拒绝、清理），覆盖率达 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%，全仓质量门禁通过；
- 状态记录：performance event processor core implemented；performance aggregate and bounded sample store implemented；event processor routing not-started / blocked（DAT-10）；production worker composition not-started / blocked（DAT-11）；performance query projection not-started（DAT-17）；本 ADR 保持 `accepted / implemented`；CI/RDS/IaC not-started。
