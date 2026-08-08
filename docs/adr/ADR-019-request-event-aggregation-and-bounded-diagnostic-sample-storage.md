---
title: ADR-019：请求事件聚合与有界诊断样本存储
status: accepted
implementation-status: in-progress
approval-status: approved
owner: ingestion/backend
date: 2026-08-03
last-reviewed: 2026-08-03
applies-to: packages/processing-store（@aurora/processing-store）的请求事件安全样本存储（request_event_samples 表、持久化 Repository、幂等、稳定结果），以及请求聚合主路径与有限安全样本的长期处理/存储边界
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
  - ../../docs/adr/ADR-005-event-schema-source-of-truth.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../docs/adr/ADR-012-ingestion-worker-runtime.md
  - ../../docs/adr/ADR-018-error-event-occurrence-processing-storage.md
  - ../../docs/protocol/request-event-contract.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
superseded-by: none
---

# ADR-019：请求事件聚合与有界诊断样本存储

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：proposed
- 日期：2026-08-03
- Owner：ingestion/backend
- 适用范围：`packages/processing-store`（`@aurora/processing-store`）的请求事件安全样本存储（`request_event_samples` 表、持久化 Repository、幂等、稳定结果），以及请求聚合主路径与有限安全样本的长期处理/存储边界
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 5.1.2/5.1.3/5.1.5/5.1.6 节、[RULE-REQUEST-PERSISTENCE-20260803-002](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联协议：[请求事件协议契约](../../docs/protocol/request-event-contract.md)（approved / implemented）
- 关联 Inbox：[Inbox 数据模型正式规格](../../docs/architecture/ingestion-inbox-data-model.md)、[Inbox 处理侧 Repository 正式规格](../../docs/architecture/ingestion-inbox-processing-repository.md)
- 关联 Worker：[Worker 运行时正式规格](../../docs/architecture/ingestion-worker-runtime.md)
- 关联 Error store：[错误事件 occurrence 处理存储正式规格](../../docs/architecture/error-event-occurrence-processing-store.md)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-03 创建为 `proposed`。用户已在本提示词第一节明确批准"聚合主路径＋有限安全诊断样本"的产品方向（方案 B），该批准证据记录于 [RULE-REQUEST-PERSISTENCE-20260803-002](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)。本 ADR 于 2026-08-03 完成独立非作者架构/后端评审、隐私/数据治理评审与数据库领域评审，且数据库评审提出的修正项（冻结样本正向存储形态与 `occurred_at` 语义）已在决定细节 11/12 落实。评审无 load-bearing finding，本 ADR 更新为 `accepted / not-started / approved`。

## 背景

Aurora 已接受 ADR-004（可靠接收与异步处理）、ADR-005（event-schema 单一来源）、ADR-008（PostgreSQL 事务性 Inbox）、ADR-010（PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first）、ADR-012（Worker 运行时）与 ADR-015/016/017/018。`@aurora/event-schema` 已实现请求事件协议契约第一增量（`RequestEventBody` 六字段：method/url/startedAt/durationMs/outcome/statusCode；URL 已由协议层移除查询参数和片段）；`@aurora/processing-store` 已实现错误事件 occurrence 存储。

当前真实缺口：请求事件进入 Inbox 后，**没有任何处理存储**。PRD 第 5.1.2 节定义默认不创建请求问题的结果类别，第 5.1.3 节定义慢请求只保存定位最小信息且进入接口耗时统计，第 5.1.5 节定义 URL 归一化，第 5.1.6 节定义跨域安全摘要。但 PRD 未明确"请求事件是否逐条持久化"的长期存储边界。用户已于 2026-08-03 明确批准产品方向：**不建立完整逐请求历史；聚合是主路径；详细记录只保存有限诊断样本**。

请求持久化策略（聚合主路径 vs 完整明细 vs 只聚合）属于需要长期保留取舍依据的高迁移成本决策，按 ADR 规范 7.2 需创建独立 ADR。

## 决策驱动因素

- **请求量远大于错误量**：完整逐条明细的存储、索引和删除成本高；
- **隐私与配额**：请求 URL、参数和上下文可能包含敏感信息，完整明细扩大隐私与配额风险；
- **诊断需求**：请求失败和慢请求需要有限代表样本供问题定位，不能只留聚合；
- **UX 数据语义**：C5 请求监控采用服务端指标查询，列表/详情/时间序列来自聚合；"有效事件更新聚合、完整事件只保存有限代表样本"；
- **不建设逐请求日志产品**：第一版不构建完整请求历史；
- **与 Error store 一致**：复用已批准 PostgreSQL 工具链与稳定 Repository 模式；
- **不阻塞错误事件处理**：请求存储与错误存储隔离，不相互阻塞。

## 现有约束

- ADR-005：外部输入按不可信数据运行时校验；event-schema 是事件 Schema 唯一来源；
- ADR-008：`(project_id, event_id)` 租户作用域幂等键；
- ADR-010：PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first；禁止 ORM/Query Builder；Migration 追加式；
- ADR-012：Worker 只从包根消费；不直接访问数据库内部；
- ADR-018：错误事件 occurrence 处理存储；明确排除请求/性能 occurrence 存储；
- 请求事件协议契约：`RequestEventBody` 六字段、`parseRequestEventEnvelope`、`RequestMethod` 七值、`RequestOutcome` 五值、`REQUEST_EVENT_LIMITS`；
- PRD 5.1.2/5.1.3/5.1.5/5.1.6 与 RULE-REQUEST-PERSISTENCE-20260803-002；
- 代码规范：严格 TypeScript、参数化 SQL、稳定结果、不暴露 SQLSTATE/约束名/SQL、敏感信息不入日志。

## 候选方案

### 方案 A：所有合法 Request 事件逐条写入 occurrence 明细

**行为**：对每条进入处理的合法 Request 事件，逐条持久化完整 occurrence 明细到明细表。

**优点**：
- 实现直接；
- replay 和调试容易；
- 聚合可从明细重算。

**缺点**：
- 与"完整详情只保存有限代表样本"冲突；
- 请求量远大于错误量；
- 存储、索引和删除成本高；
- 容易形成完整请求历史产品；
- 隐私和配额风险扩大。

**选择结论**：不采用。

### 方案 B：聚合主路径＋有限安全诊断样本（推荐）

**行为**：合法 Request 事件 → 请求指标与时间桶聚合（主路径）→ 仅在满足样本策略时保存有限安全明细。详细记录是"有限诊断样本"，不是完整请求历史。

**优点**：
- 符合 approved UX 数据语义；
- 支持请求指标；
- 保留必要诊断证据；
- 控制存储、隐私和删除成本；
- 不构建逐请求日志产品。

**缺点**：
- 需要聚合与样本两个存储边界；
- 无法从样本重算全部指标；
- 需要明确采样、水位和完整性。

**选择结论**：采用。

### 方案 C：只保留聚合，不保存任何请求详细样本

**行为**：请求事件只参与聚合，不保存任何详细样本。

**优点**：
- 数据量和隐私风险最低；
- 数据模型简单。

**缺点**：
- 请求失败和慢请求缺少必要诊断证据；
- 用户无法查看有限代表样本；
- 不利于问题定位。

**选择结论**：不采用。

### 候选比较

| 维度 | A：逐条明细 | B：聚合＋有限样本 | C：只聚合 |
| --- | --- | --- | --- |
| 与"有限代表样本"一致 | 否 | 是 | 是 |
| 诊断证据 | 完整 | 必要 | 无 |
| 存储/索引/删除成本 | 高 | 可控 | 最低 |
| 隐私与配额风险 | 高 | 可控 | 最低 |
| 从样本重算指标 | 可 | 不可 | 不适用 |
| 形成逐请求日志产品 | 风险高 | 明确不构建 | 否 |
| 第一版成本 | 高 | 中低 | 低 |

## 最终决策

**最终选择方案 B：聚合主路径＋有限安全诊断样本。**

### 决定细节（全部在本 ADR 冻结）

1. **请求处理边界**：合法 Request 事件 → 请求指标与时间桶聚合（主路径）→ 仅在满足样本策略时保存有限安全明细。本 ADR 不决定 Request Metric Store 的精确桶模型，不决定 Request Processor 的事务边界。
2. **样本存储能力**：本模块实现"安全请求样本存储能力"（`@aurora/processing-store` 内的 `request_event_samples` 表 + `persistRequestEventSample` Repository + 幂等 + 稳定结果）；不实现 Request Metric Store、样本选择策略执行器、Request Processor、Performance、路由、production composition root、Issue 分组、查询 API、数据删除任务。
3. **允许保存详细安全样本的类别**（由未来样本选择策略判断，本存储模块只持久化"已由上游选中的合法 Request 事件"）：网络失败、请求超时、HTTP 429、HTTP 500—599、项目配置明确纳入请求问题的额外 HTTP 状态码、已经通过 SDK 和服务端采样规则的慢请求。
4. **默认不保存逐条详细样本**：普通成功请求、用户主动取消的请求、PRD 默认不作为请求问题的普通 HTTP 400—428、PRD 默认不作为请求问题的普通 HTTP 430—499。这些事件是否参与指标聚合由后续规格负责。
5. **安全字段边界**：请求详细样本只能保存当前 approved PRD 和 request-event-contract 已经批准的安全字段；禁止保存请求体、响应体、请求头、响应头、Cookie、Authorization、原始敏感查询参数值、未经规范化的完整敏感 URL、表单内容、页面 DOM 或页面文本、完整 IP、设备或浏览器指纹。
6. **存储分离**：请求样本存储能力必须与请求聚合存储分离；`request_event_samples` 不得命名为完整请求 occurrence 历史，不得被用作逐请求日志。
7. **幂等**：`(project_id, event_id)` 数据库唯一约束；`ON CONFLICT DO NOTHING`；duplicate 不更新原记录。
8. **数据保留**：安全样本的默认完整详情保留边界遵守当前批准的数据生命周期规则，但本 ADR 不实现清理任务。
9. **不允许从有限样本反推完整指标**；不允许将样本表变成完整请求日志。
10. **不修改**：request-event-contract、ingestion-api、POST /v1/batches、Worker、Error store、Error processor、retry/backoff/replay。
11. **样本存储形态（冻结）**：`request_event_samples` 采用与 error store 一致的**受协议约束 jsonb** 投影，而非逐字段明确列。理由：请求契约字段（method/url/startedAt/durationMs/outcome/statusCode）作为一组最小安全样本投影整体持久化，与错误 occurrence 的 `normalized_body` jsonb 模式一致；但必须有严格白名单约束。精确冻结：
    - `sample_body` 为 `jsonb` not null，只允许协议解析后的六字段白名单（`method`、`url`、`startedAt`、`durationMs`、`outcome`、可选 `statusCode`），URL 已由协议层移除查询参数与片段；
    - CHECK：`jsonb_typeof(sample_body) = 'object'`；
    - CHECK：不允许未知键写入（运行时由 `parseRequestEventEnvelope` 保证，只有解析成功的六字段白名单对象才进入投影）；
    - 不得通过 jsonb 保存完整 `RequestEventEnvelope`、信封字段（protocolVersion/eventId/eventType/occurredAt）或任何未批准字段；
    - 不添加 GIN、全文、trigram 索引；当前无查询 API，最小索引原则。
12. **时间语义（冻结）**：`occurred_at` 列使用信封 `occurredAt`（事件产生时间，由 `parseEventEnvelope` 校验）；请求 `body.startedAt`（请求真实开始时间）作为契约字段保存在 `sample_body.startedAt` 中，不单独建列。`created_at` 使用 PostgreSQL `now()`。不使用调用方传入 createdAt，不使用数据库时间替换 occurredAt。
13. **约束与防范围蔓延**：不得为未来需求新增 `issue_id`/`fingerprint`/`group_id`/`source_map_id`/`release_id`/`user_id`/`session_id`/`assigned_user_id`/`resolved_at`/`search_document`/`arbitrary tags`/`extra metadata JSON`。不得先查询再插入作为唯一幂等机制。duplicate 不暴露 constraint/SQLSTATE。样本为项目作用域业务事实，不含直接身份字段（user_id/session_id），落实 A5 匿名化语义。
14. **评审落实项（2026-08-03 三域评审）**：
    - 样本 `url` 是协议层去查询/片段、但保留路径动态段的 URL；PRD 5.1.5 路径归一化属后续 SDK/处理层。本存储模块只保存契约解析后的安全 URL；样本可查询/展示前的路径归一化由后续 Request Processor/查询模块负责，不在本模块内重算。
    - 样本类别（网络失败/超时/429/5xx/慢请求）有界性由未来"样本选择策略执行器"强制；本 Repository 只持久化"已由上游选中的合法 Request 事件"，不自行判断类别。
    - 本轮不把请求样本存储接入 Worker（`apps/ingestion-worker` 不新增依赖、不接 production composition root）。
    - 集成测试 `beforeAll` 需同步 DROP `request_event_samples` 以维持 fresh-up 语义。
    - Migration 文件名/时间戳在实施计划冻结。

## 结果与影响

### 正面影响

- 符合 approved UX 数据语义；
- 支持请求指标；
- 保留必要诊断证据；
- 控制存储、隐私和删除成本；
- 不构建逐请求日志产品；
- 与 Error store 复用同一工具链。

### 负面影响与代价

- 需要聚合与样本两个存储边界；
- 无法从样本重算全部指标；
- 需要明确采样、水位和完整性（后续模块）。

### 未解决问题

- Request Metric Store 的精确桶模型（后续独立模块）；
- 样本选择策略的精确规则（网络失败/超时/429/5xx/慢请求的采样与水位的精确数值）；
- Request Processor 的事务边界；
- 请求样本保留期限（数据生命周期规则）。

## 实施约束

- 完全遵守 ADR-005/008/010/012/018；不修改 `@aurora/ingestion-inbox`、`@aurora/event-schema`、`apps/ingestion-worker`、`apps/ingestion-api`、OpenAPI；
- `@aurora/processing-store` 新增 `request_event_samples` Migration 与 `persistRequestEventSample` Repository；不创建通用 Repository 泛型框架；
- 输入经 `@aurora/event-schema` 根入口 `parseRequestEventEnvelope` 验证；只保存安全投影字段；
- Migration 为追加式，可 up/down，不自动执行于应用启动；
- SQL 全参数化；不暴露 SQLSTATE/约束名/SQL；
- 不记录请求体/响应体/Header/Cookie/Authorization/敏感查询/完整 URL/DOM/文本/IP/指纹；
- Workspace Policy：`data → {protocol}`（现有允许矩阵已支持）。

## 迁移方案

本 ADR accepted 后：编写请求安全样本存储正式规格 → writing-plans → 实施 `@aurora/processing-store` 的 `request_event_samples` Migration + `persistRequestEventSample` Repository → 真实 PostgreSQL 17 集成验证。

## 回滚方案

- Migration 发布前缺陷：可直接修改未发布 Migration；
- Migration 发布后：向前修复与 expand/contract；destructive down 不作为生产默认回滚；
- Repository 实现与 Worker 主循环解耦，可替换而不影响 Inbox/Worker/Error store 公共接口。

## 验证方式

- 单元测试：顶层 input 校验、Request 事件解析、非 Request 拒绝、安全投影、输入不变、稳定结果、不泄露数据库错误；
- 真实 PostgreSQL 17：Request 样本写入、duplicate、并发幂等、非 Request 不写入、隐私负例、Migration up/down/up、Schema/Pool 清理；
- 回归：event-schema、Error store、Worker、ingestion-api 全部测试通过；OpenAPI 无变化；
- 全仓质量门禁与覆盖率 85/80/85/85。

## 重新评估条件

- 请求量变化使有限样本不足以支撑诊断；
- 需要完整请求历史或 replay；
- 数据生命周期规则要求同步样本保留；
- 聚合桶模型需要样本支持重算。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-03：创建（proposed）

- 状态 `proposed / not-started / proposed`；
- 由 2026-08-03 请求事件持久化门禁创建；
- 门禁确认：ADR-018 只适用于错误事件 occurrence；request-event-contract 明确不实现持久化；PRD 5.1.2/5.1.3/5.1.5/5.1.6 定义了请求问题/慢请求/URL 归一化/跨域摘要，但未明确"请求事件是否逐条持久化"的长期存储边界；用户已明确批准方案 B（聚合主路径＋有限安全诊断样本）；
- 用户批准证据记录于 [RULE-REQUEST-PERSISTENCE-20260803-002](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)；
- 未调用 writing-plans、未创建规格、未实施代码；
- 等待独立非作者与隐私/数据治理评审，不自动批准、不实施。

### 2026-08-03：独立非作者与隐私/数据治理评审

- 独立非作者架构/后端评审：**可接受进入 accepted 与正式代码实施**（无 load-bearing finding）。确认与 PRD 5.1.2/5.1.3/5.1.5/5.1.6、UX C5 服务端指标语义、accepted ADR-004/005/006/008/010/012/018 无冲突；三个候选真实、矩阵公平；方案 B 边界清楚；`request_event_samples` + `(project_id, event_id)` 幂等与 processing-store 既有模式一致。中等项：样本 URL 路径归一化口径、ADR 接受门禁依赖全部评审完成——已在决定细节 14 落实。
- 隐私/数据治理评审：**可接受进入 accepted 与正式代码实施**（无阻断）。确认敏感字段边界与 request-event-contract/PRD 14.1 一致；安全投影只存契约六字段；方案 B 符合数据最小化；不实现清理任务、保留遵守未来生命周期规则；与 Error 存储隔离。中等项：冻结精确列/JSONB CHECK、URL 路径归一化、category 门禁由上游执行——已在决定细节 11/14 落实。
- 数据库领域评审：初评 **需修正后才能进入**（1 项中等问题：ADR 未冻结 `request_event_samples` 正向存储形态、`occurred_at` 语义未定）。修正已落实：决定细节 11 冻结"受协议约束 jsonb + 六字段白名单 + `jsonb_typeof = 'object'` CHECK + 禁止完整信封/未批准字段 + 无 GIN/全文"；决定细节 12 冻结 `occurred_at` 用信封 `occurredAt`、`startedAt` 存于 `sample_body`。其余项（Migration 追加、并发幂等、最小索引、与既有模式一致）无 load-bearing 问题。
- 结论：三域评审全部通过且无 load-bearing finding，用户批准证据 + 独立评审证据齐备，本 ADR 更新为 `accepted / not-started / approved`。

### 2026-08-03：请求事件安全样本存储第一增量实施证据

- 实施状态更新为 `implemented`：`packages/processing-store` 请求事件安全样本能力已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试、隐私负例与全仓质量门禁；Request Metric Store、样本选择策略执行器、Request Processor、Performance、路由与查询仍未实现，故不扩大范围；
- 实施内容：`src/request-sample-types.ts`（`PersistRequestEventSampleInput`/`PersistRequestEventSampleResult` 可判别联合类型/私有 `RequestSampleDbParams`）、`src/request-sample-input.ts`（`parsePersistRequestEventSampleInput`：顶层 unknown 校验 + `parseRequestEventEnvelope` 映射）、`src/request-sample-repository.ts`（`persistRequestEventSample`：事务内 `INSERT ... ON CONFLICT DO NOTHING RETURNING id`，区分 `inserted`/`duplicate`/`temporarily_unavailable`）、Migration `1722500000004_request-event-samples.ts`（`request_event_samples` 表 + `(project_id, event_id)` 唯一 + `jsonb_typeof(sample_body) = 'object'` CHECK）；包根 `index.ts` 追加导出；
- 语义：`sample_body` 只保存协议解析后的六字段白名单（method/url/startedAt/durationMs/outcome/可选 statusCode），URL 已由协议层移除查询参数与片段；`occurred_at` 用信封 `occurredAt`、`startedAt` 存于 `sample_body`；`created_at` 为数据库 `now()`；输入经 `@aurora/event-schema` 根入口验证；SQL 全参数化；不暴露 SQL/数据库错误码/约束名；
- 未修改 `error_event_occurrences`/`persistErrorEventOccurrence`/Error processor/request-event-contract/ingestion-api/Worker/OpenAPI；未实现聚合、样本选择、Request Processor、路由、production composition root；`apps/ingestion-worker` 未接入请求样本；
- 测试：8 个输入单测 + 7 个 Repository 单测 + 3 个协议漂移测试 + 安全/隐私负例（不存请求体/响应体/Header/Cookie/Authorization/敏感查询/完整 URL）+ 12 个真实 PostgreSQL 17.10 集成测试（写入/duplicate/跨项目/非 Request 不写入/CHECK/unique/并发单行/Error store 回归/Migration up/down/up/Schema/Pool 清理）；
- 覆盖率：lines / statements / branches / functions 均满足 85/80/85/85 门槛；
- 验证命令：`pnpm --filter @aurora/processing-store typecheck/test/test:integration/test:coverage/test:package/build`、`pnpm check:boundaries`、全仓门禁全部 exit 0；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 状态记录：request persistence strategy approved/accepted；request event sample store implemented；request metric aggregate store not-started；request sample selection policy not-started；request event processor not-started；performance aggregate/sample store not-started；performance event processor not-started；event processor routing not-started / blocked；production worker composition not-started / blocked；CI/RDS/IaC not-started。

### 2026-08-03：实施状态校正（in-progress）

- 本 ADR 的 `implementation-status` 从 `implemented` 校正为 `in-progress`：本 ADR 覆盖"聚合主路径＋有限安全诊断样本"总体策略，但当前只实施请求事件安全样本存储（request_event_samples）部分；请求指标聚合存储（request metric aggregate store）、样本选择策略、Request Processor、事件路由与生产接线均未实现；
- **已完成**：用户产品决定（RULE-REQUEST-PERSISTENCE-20260803-002）、聚合与有限样本总体策略、request_event_samples 表、persistRequestEventSample Repository、相关测试与文档；
- **未完成**：request metric aggregate store、sample selection policy、Request Processor、event routing、production worker composition、Query、retention cleanup；
- 本 ADR 的最终决策（决定细节 1-14）不变；本校正只同步真实实施状态与证据；
- 请求指标聚合存储的精确物理模型（UTC 一分钟桶、最小事件应用登记、同事务 UPSERT、指标字段边界）由独立 ADR-020 决定（本 ADR 决定细节 1 明确"不决定 Request Metric Store 的精确桶模型"）。

### 2026-08-03：请求样本选择策略第一增量实施证据

- 实施状态更新：请求样本选择策略核心能力已实施并通过单元测试、安全负例与全仓质量门禁；Request Processor、样本持久化执行器、指标贡献提交、Event Router 与 production composition root 仍未实现，故不扩大范围；
- 实施内容：`apps/ingestion-worker` 内部 `src/request-sample-selection-policy.ts`（`RequestSampleSelectionInput` 最小内部事实 + `RequestSampleSelectionDecision` 判别联合 + `decideRequestSampleSelection` 确定性纯函数），测试 `test/request-sample-selection-policy.test.ts`；
- 语义：固定优先级 `cancelled → network failure → timeout → HTTP 429 → HTTP 500—599 → configured status → slow request → skip`；`canceled` 永远 `skip/cancelled`；`network_error`→`store/network_failure`、`timeout`→`store/timeout`、429→`store/http_429`、500—599→`store/http_5xx`、`isAdditionalMonitoredStatus`→`store/configured_status`、`isSlow`→`store/slow_request`、成功且不慢→`skip/successful_not_slow`、普通未监控 4xx→`skip/unmonitored_status`；非法输入返回稳定 `invalid` 结果；
- 边界：`outcome` 五值来自 `@aurora/event-schema` 包根 `RequestOutcome`；`statusCode` 用事件领域真实可空状态码（`100..599` 安全整数，来自 `REQUEST_EVENT_LIMITS`），不使用数据库 `status_code = 0` 哨兵；`isSlow`/`isAdditionalMonitoredStatus` 由未来 Request Processor 提供，本策略不读取项目配置、不计算慢请求阈值、不判断自定义状态码命中；
- 无副作用：不写数据库、不调用 `persistRequestEventSample`/`persistRequestMetricContribution`、不写日志、不读取 `Date`/`process.env`、不访问网络/文件系统、不修改输入、输出 `Object.freeze`；同一输入任意次数结果一致（确定性）；
- 未修改：`error_event_occurrences`/`request_event_samples`/`request_metric_buckets`/`request_metric_event_applications`/`persistErrorEventOccurrence`/`persistRequestEventSample`/`persistRequestMetricContribution`/Error processor/request-event-contract/ingestion-api/Worker 运行时/retry/backoff/replay；未实现 Request Processor、随机采样、样本持久化执行器、指标提交、Query、Router、production composition root；
- 测试：决策矩阵/优先级/确定性/输入不变/非法输入/outcome 穷尽单元测试，`apps/ingestion-worker` 单元测试 17 文件 151 测试通过，覆盖率达 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%，全仓质量门禁通过；
- 正式规格：[request-sample-selection-policy.md](../architecture/request-sample-selection-policy.md)（approved + implemented）；
- 状态记录：request sample selection policy implemented；request event processor not-started；request metric query not-started；performance aggregate/sample store not-started；performance event processor not-started；event processor routing not-started / blocked；production worker composition not-started / blocked；issue grouping/fingerprint not-started；alert calculation not-started；retention cleanup not-started；ADR-019 保持 `accepted / in-progress`、ADR-020 保持 `accepted / implemented`；CI/RDS/IaC not-started。

### 2026-08-03：请求事件 Processor 核心第一增量实施证据

- 实施状态更新：请求事件 Processor 核心能力已实施并通过单元测试、Store fake 集成测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁；Request Event Router、真实配置 adapter、Request Metric Query、Performance、production worker composition 仍未实现，故不扩大范围；
- 实施内容：`apps/ingestion-worker` 内部 `src/request-event-processor.ts`（`RequestEventClassification`/`ClassifyRequestEvent`/`RequestEventClassificationInput` 分类端口 + `RequestEventProcessorDiagnostics` + `mapMetricResultToContinuation`/`mapSampleResultToWorkerResult` 结果映射 + `createRequestEventProcessor` 工厂），测试 `test/request-event-processor.test.ts`（fake store + 分类 fake）与 `test/integration/request-event-processor.test.ts`（真实 PostgreSQL 17.10）；
- 编排语义：非 Request Event → `dead-letter{invalid_event_type}`（局部前置条件）；经 `@aurora/event-schema` 包根 `parseRequestEventEnvelope` 解析；分类端口注入 `isFailure`/`isSlow`/`isAdditionalMonitoredStatus`；每个合法 Request Event 先 `persistRequestMetricContribution`（applied/duplicate → 继续、invalid_input → dead-letter、temporarily_unavailable → retry）→ `decideRequestSampleSelection`（skip → processed、store → `persistRequestEventSample`）→ sample inserted/duplicate → processed、invalid_input → dead-letter、temporarily_unavailable → retry；
- 跨 Store 收敛：metric applied + sample temporarily_unavailable → retry（`availableAt` 复用 ADR-016 `calculateRetryBackoffSchedule`）；下一次 metric duplicate（不重复计数）+ sample inserted → processed；无跨 Store 事务，依赖两 Store 各自 `(project_id, event_id)` 数据库幂等；
- 边界：不硬编码 slowRequestThreshold=3000/额外状态码/采样率；不读取项目配置/环境变量/数据库设置；不读取 `Date.now`/`Math.random`；不修改输入；未知异常传播给 Worker runtime；backoff 非法抛稳定 Error 不静默降级；
- 未修改：`request_metric_event_applications`/`request_metric_buckets`/`request_event_samples`/`error_event_occurrences`/`event_inbox`/`persistRequestEventSample`/`persistRequestMetricContribution`/`decideRequestSampleSelection`/Error processor/request-event-contract/ingestion-api/Worker 运行时/retry/backoff/replay；未增加 Migration；未接生产 composition root、未创建生产 bin/start、未实现总事件路由器；
- 测试：`apps/ingestion-worker` 单元测试 18 文件 172 测试通过、集成测试 9 文件 38 测试通过（真实 PostgreSQL 17.10：metric applied+skip、metric applied+sample inserted、replay 幂等、sample 暂时失败收敛、非 Request 拒绝、清理），覆盖率达 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%，全仓质量门禁通过；
- 正式规格：[request-event-processor.md](../architecture/request-event-processor.md)（approved + implemented）；
- 状态记录：request event processor core implemented；request processing rules/config adapter not-started；request metric query not-started；performance aggregate/sample store not-started；performance event processor not-started；event processor routing not-started / blocked；production worker composition not-started / blocked；issue grouping/fingerprint not-started；query/safe projection not-started；source map processing not-started；alert calculation not-started；retention cleanup not-started；ADR-019 保持 `accepted / in-progress`、ADR-020 保持 `accepted / implemented`；CI/RDS/IaC not-started。

### 2026-08-03：请求处理规则/配置 adapter 第一增量实施证据

- 实施状态更新：请求处理规则/配置 adapter 核心能力已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁；真实配置存储/Repository、配置管理 API、Request Metric Query、Performance、Router、生产接线仍未实现，故不扩大范围；
- 实施内容：`apps/ingestion-worker` 内部 `src/request-processing-rules-adapter.ts`（`RequestProcessingRules` 配置模型：slowRequestThresholdMs/failureStatusCodes/slowStatusCodes/additionalMonitoredStatusCodes；`DEFAULT_REQUEST_PROCESSING_RULES` 默认慢阈值 3000ms、失败状态码 429+500—599、额外监控状态码默认空；`createRequestProcessingRulesAdapter` 工厂实现 `ClassifyRequestEvent` 端口：`isFailure` = network_error/timeout/http_error 命中 failureStatusCodes，`isSlow` = 非 canceled 且 durationMs ≥ 阈值 或 http_error 命中 slowStatusCodes，`isAdditionalMonitoredStatus` = http_error 命中 additionalMonitoredStatusCodes；不可变冻结快照；非法配置抛稳定 `RequestProcessingRulesAdapterError{invalid_rules}`），正式规格 [request-processing-rules-configuration-adapter.md](../architecture/request-processing-rules-configuration-adapter.md)（approved + implemented）；
- 语义：默认规则逐条来自 PRD 5.1.2/5.1.3 与本 ADR 决定细节 3/4（额外监控状态码默认空、普通 4xx 默认不监控、慢阈值 3000 可覆盖、失败状态码 429+500—599）；样本类别有界性仍由样本选择策略执行器强制，adapter 只提供布尔分类不决策；
- 未修改：request-event-contract/ingestion-api/Worker 运行时/processing-store/Error processor/Request Processor 核心/样本选择策略/retry/backoff/replay；未增加 Migration；未接生产 composition root、未创建生产 bin/start、未实现总事件路由器；`@aurora/ingestion-worker` 未新增依赖；
- 测试：`apps/ingestion-worker` 单元测试 19 文件 191 测试通过、集成测试 10 文件 44 测试通过（真实 PostgreSQL 17.10：fast success 不失败不慢不存样本、3200ms slow 存样本、503 failure 存样本、404 覆盖额外监控状态存样本、replay 幂等、清理），覆盖率达 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%，全仓质量门禁通过；
- 状态记录：request processing rules/config adapter implemented；request event processor core implemented；request metric query not-started；performance aggregate/sample store not-started；performance event processor not-started；event processor routing not-started / blocked；production worker composition not-started / blocked；issue grouping/fingerprint not-started；query/safe projection not-started；source map processing not-started；alert calculation not-started；retention cleanup not-started；本 ADR 保持 `accepted / in-progress`、ADR-020 保持 `accepted / implemented`；CI/RDS/IaC not-started。


