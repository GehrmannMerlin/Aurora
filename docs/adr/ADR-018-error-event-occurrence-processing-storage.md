---
title: ADR-018：错误事件 occurrence 处理存储
status: accepted
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
date: 2026-08-02
last-reviewed: 2026-08-02
applies-to: packages/processing-store（@aurora/processing-store）的错误事件 occurrence 明细处理存储（error_event_occurrences 表、持久化 Repository、幂等、稳定结果）
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
  - ../../docs/adr/ADR-005-event-schema-source-of-truth.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../docs/adr/ADR-012-ingestion-worker-runtime.md
  - ../../docs/protocol/error-event-contract.md
supersedes: none
superseded-by: none
---

# ADR-018：错误事件 occurrence 处理存储

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：not-started
- 审批状态：approved
- 日期：2026-08-02
- Owner：ingestion/backend
- 适用范围：`packages/processing-store`（`@aurora/processing-store`）的错误事件 occurrence 明细处理存储：`error_event_occurrences` 表、持久化 Repository、`(project_id, event_id)` 幂等、稳定结果
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 7 章
- 关联协议：[错误事件协议契约](../../docs/protocol/error-event-contract.md)（approved / implemented）、[ADR-005](../../docs/adr/ADR-005-event-schema-source-of-truth.md)（accepted / in-progress）
- 关联 Inbox：[Inbox 数据模型正式规格](../../docs/architecture/ingestion-inbox-data-model.md)、[Inbox 处理侧 Repository 正式规格](../../docs/architecture/ingestion-inbox-processing-repository.md)
- 关联 Worker：[Worker 运行时正式规格](../../docs/architecture/ingestion-worker-runtime.md)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-02 由用户批准（`decision-status: accepted`、`implementation-status: not-started`、`approval-status: approved`）。批准授权错误事件 occurrence 处理存储的最终决定；批准不代表 `error_event_occurrences` 表、Migration、Repository、具体错误事件 processor、查询 API、CI、RDS 或 IaC 已经实现。

## 背景

Aurora 已接受 ADR-005（event-schema 单一来源）、ADR-008（PostgreSQL 事务性 Inbox）、ADR-010（PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first）、ADR-012（Worker 运行时）与 ADR-015/016/017（retry budget、退避、人工重放）。`@aurora/event-schema` 已实现错误事件协议契约第一增量（JavaScript 运行时错误、未处理 Promise 拒绝和资源加载错误）；`@aurora/ingestion-inbox` 已实现 `event_inbox` 写侧与处理侧 Repository；`apps/ingestion-worker` 已实现 Worker 运行时与 `IngestionEventProcessor` 端口。

当前真实缺口：Worker 的 processor 端口只有抽象输入（`ProcessIngestionEventInput`），**没有可写入的处理存储**。具体错误事件 processor 需要一个稳定的数据存储边界来持久化"已通过 event-schema 错误事件契约验证的错误事件明细 occurrence"；当前仓库不存在任何处理结果数据库、错误 occurrence 表、错误事件持久化 Repository、`(project_id, event_id)` 处理结果幂等或真实 PostgreSQL 错误事件存储测试。

错误事件处理存储的物理技术、表形态和搜索迁移路径属于需要长期保留取舍依据的高迁移成本决策，按 ADR 规范 7.2 需创建独立 ADR。本 ADR 于 2026-08-02 由用户直接审批批准。

## 决策驱动因素

- **稳定处理存储边界**：为未来具体错误事件 processor 提供确定、可验证的持久化目标；
- **与现有工具链一致**：复用 ADR-010 已批准的 PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first，不引入未经批准基础设施；
- **幂等**：同一 `(project_id, event_id)` 经 Worker 重试或人工重放后不得创建多个 occurrence；
- **不提前抽象**：本模块只做错误事件 occurrence 能力，不创建通用事件存储框架；
- **数据边界**：存储"已通过错误事件契约验证的 occurrence"，不存储原始 HTTP 请求、Inbox 原始副本、通用 EventEnvelope 仓库、Issue、分组、聚合、搜索索引或告警事件；
- **不决定下游**：Issue 分组、fingerprint、Source Map、查询 API、搜索和分析存储均不属于本 ADR。

## 现有约束

- ADR-005：外部输入按不可信数据运行时校验；`event-schema` 是事件 Schema 唯一来源；数据库模型不得反向成为事件协议权威；
- ADR-008：`(project_id, event_id)` 租户作用域幂等键；已可靠接收不表示问题已生成；
- ADR-010：PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first；SQL 参数化；禁止 ORM/Query Builder；Migration 追加式、可 up/down、应用启动不自动执行；
- ADR-012：`apps/ingestion-worker` 只从 `@aurora/ingestion-inbox` 与 `@aurora/event-schema` 包根消费；Worker 不直接访问数据库内部；
- 错误事件协议契约：`ErrorCategory` 三值（`javascript`/`unhandled_rejection`/`resource`）、`ErrorEventEnvelope`、`parseErrorEventEnvelope`、`ERROR_EVENT_LIMITS`；
- 代码规范：严格 TypeScript、参数化 SQL、稳定结果、不暴露 SQLSTATE/约束名/SQL、敏感信息不入日志。

## 候选方案

### 方案 A：PostgreSQL 独立错误 occurrence 表，正文使用受协议约束的 jsonb（推荐）

**行为**：新建 `packages/processing-store`（`@aurora/processing-store`，`data` 层）包，创建 `error_event_occurrences` 表；存储 `(project_id, event_id)`、`protocol_version`、`occurred_at`、`error_category`、`normalized_body`（jsonb）、`created_at`（数据库 now()）；`(project_id, event_id)` 唯一约束实现幂等；Repository 使用 `ON CONFLICT DO NOTHING`，区分 `inserted`/`duplicate`；`normalized_body` 只保存通过 `parseErrorEventEnvelope` 验证后的规范化正文（不含 EventEnvelope 壳）。

**优点**：

- 与当前 PostgreSQL 工具链（ADR-010）完全一致，第一增量成本最低；
- 保留清晰错误事件边界：明确、单一职责的表，约束强；
- 幂等由数据库唯一约束保证，与 Inbox 的 `persistBatch` 模式一致；
- 可平滑增加索引、分区和查询能力。

**缺点**：

- 需要新增 Migration 与 Repository；
- 需要与 Inbox 数据生命周期独立管理。

**选择结论**：采用。

### 方案 B：单一通用 processed_events JSONB 表（被拒绝）

**行为**：建一张通用 `processed_events` 表，用宽泛 `jsonb` 正文承载所有事件家族。

**被拒绝理由**：

- 容易形成"万能表"：弱约束、事件家族耦合，正文内容难以用 CHECK 约束治理；
- 无法表达错误事件特有的 `error_category` CHECK、`(project_id, event_id)` 语义清晰的唯一约束；
- 与 ADR-005"数据库模型不得反向成为事件协议权威"边界冲突；
- 未来按事件家族扩展会演化为反模式。

### 方案 C：立即使用 OpenSearch/ClickHouse 等独立分析存储（被拒绝）

**行为**：本轮直接引入外部分析/搜索数据库。

**被拒绝理由**：

- 尚无真实生产容量证据，引入高迁移成本基础设施缺乏依据；
- 需要新的 approved ADR 才能引入（6.1 禁止未批准基础设施）；
- 与 ADR-008 的"复用 RDS PostgreSQL 与 Worker、运维负担最小"第一版目标不符；
- 后续可以通过异步投影增加搜索或分析存储，不阻塞当前持久化。

### 候选比较

| 维度 | A：独立错误 occurrence 表 | B：通用 processed_events 表 | C：外部分析存储 |
| --- | --- | --- | --- |
| 与现有工具链一致 | 高（ADR-010） | 中 | 低（新基础设施） |
| 错误事件边界 | 清晰 | 弱（万能表） | 中 |
| 幂等唯一约束 | 原生 | 弱 | 需配置 |
| 第一增量成本 | 最低 | 低 | 高 |
| 运维复杂度 | 最小 | 中 | 高 |
| 未来搜索迁移 | 异步投影可加 | 需迁移 | 已具备 |

## 最终决策

**最终选择方案 A：PostgreSQL 独立错误 occurrence 表，正文使用受协议约束的 jsonb。**

### 决定细节（全部在本 ADR 冻结）

1. **存储技术**：第一增量继续使用 PostgreSQL 17；SQL-first；`pg`；`node-pg-migrate`；参数化 SQL；真实 PostgreSQL 17 集成测试。不得引入 OpenSearch、Elasticsearch、ClickHouse、MongoDB、Redis、对象存储、新队列、ORM 或 Query Builder；这些未来技术如有需要，必须独立 ADR。
2. **包位置**：内部 Workspace 数据包 `packages/processing-store`（包名 `@aurora/processing-store`，`aurora.layer: data`）。只实现错误事件 occurrence 能力；不得为未来请求/性能/行为事件预先创建通用 Repository 泛型框架；不得创建 `utils`/`helpers`/`common`/`base-repository`/`generic-store`/`universal-event-table`。包内使用明确错误事件命名（如 `error-occurrence-types.ts`、`error-occurrence-input.ts`、`error-occurrence-repository.ts`）。
3. **数据边界**：本模块存储"已通过 event-schema 错误事件契约验证的错误事件明细 occurrence"；不是原始 HTTP 请求、Inbox 原始副本、通用 EventEnvelope 仓库、Issue、分组结果、聚合结果、搜索索引或告警事件。一个 occurrence 对应一个 `(projectId, eventId)`。
4. **幂等**：数据库建立 `(project_id, event_id)` 唯一约束；使用 `ON CONFLICT DO NOTHING`（或等价可证明安全的 PostgreSQL 语义）；首次写入 → `inserted`；同一 projectId/eventId 再次写入 → `duplicate`；duplicate 不更新原 occurrence、不增加第二条记录、不覆盖原正文、不暴露 PostgreSQL constraint 或 SQLSTATE。不得通过"先查询再插入"作为唯一幂等机制。
5. **错误事件来源**：输入必须通过 `@aurora/event-schema` 包根能力验证；使用真实 `ErrorEventEnvelope` 类型/解析器、错误事件 category、协议版本、eventId、timestamp 与已有正文允许列表；不得复制第二套错误事件类型、从 event-schema 私有路径导入、使用宽泛 `Record<string, unknown>` 代替正式契约、接受未验证正文直接写库、重新解释或放宽 error-event-contract。
6. **存储模型**：创建单一明细表 `error_event_occurrences`（最终名称在本 ADR 与规格冻结），至少保存内部主键、`project_id`、`event_id`、`protocol_version`、`occurred_at`、`error_category`、`normalized_body`、`created_at`。可选 `source_inbox_id` 只有在真实 Worker 输入已稳定提供且确实用于追踪时才允许增加（本第一增量不增加）。不得为未来需求新增 `issue_id`/`fingerprint`/`group_id`/`source_map_id`/`release_id`/`user_id`/`session_id`/`assigned_user_id`/`resolved_at`/`search_document`/`arbitrary tags`/`extra metadata JSON`。
7. **normalized_body**：PostgreSQL 类型 `jsonb`；只保存错误事件协议解析成功后的规范化正文；不保存完整 EventEnvelope、HTTP Header、客户端凭证、Origin/environment、SQL、Worker lease、原始异常对象或 event-schema 未批准字段；添加 `jsonb_typeof(normalized_body) = 'object'` CHECK；第一增量不添加 GIN 索引；不得在数据库中重新解析或转换正文。
8. **error_category**：来自现有错误事件协议的真实分类（`ErrorCategory`：`javascript`/`unhandled_rejection`/`resource`），禁止自行新增类别；数据库 CHECK 或等价约束与公共协议保持一致，但不得创建第二套手工漂移枚举；计划必须包含漂移检测测试。
9. **时间语义**：`occurred_at` 来自 EventEnvelope 正式事件时间；`created_at` 使用 PostgreSQL 当前时间；不使用调用方传入的 createdAt；不使用数据库时间替换 occurredAt；不使用 Worker 主机时间作为持久化时间；Date/时间字符串按现有协议解析和验证。
10. **查询边界**：第一增量不提供产品查询 API；包根只导出持久化所需最小能力；测试可使用私有 SQL 验证落库，但不得为了测试导出通用查询 Repository；后续查询、分页、过滤、Issue 聚合和搜索必须独立规划。
11. **数据保留**：本轮不冻结新的保留天数；记录该表属于未来处理数据保留策略；不自动删除；不创建定时清理任务；不声称永久保留；不复用 Inbox 35 天备份淘汰语义冒充在线数据保留规则。

## 结果与影响

### 正面影响

- 未来具体错误事件 processor 获得确定、可验证的处理存储边界；
- 复用已批准 PostgreSQL 工具链，第一增量成本最低；
- 数据库唯一约束提供强幂等；
- 清晰错误事件边界，为未来分组、指纹、Source Map 和查询提供基础；
- 可通过异步投影平滑增加搜索或分析存储。

### 负面影响与代价

- 需要新增包、Migration 与 Repository；
- 需要与 Inbox 数据生命周期独立管理；
- 第一版为简单明细存储，不提供查询/聚合能力。

### 未解决问题

- 具体错误事件 processor（后续独立模块）；
- 错误问题分组、fingerprint、Source Map（后续独立模块）；
- 错误事件查询 API、分页、过滤（后续独立模块）；
- 搜索/分析存储（后续独立 ADR）；
- 处理数据保留天数（后续数据生命周期规则）。

## 实施约束

- 完全遵守 ADR-005/008/010/012；不修改 `@aurora/ingestion-inbox`、`@aurora/event-schema`、`apps/ingestion-worker`、`apps/ingestion-api` 或 OpenAPI；
- 本轮不把 processing-store 接入 Worker：`apps/ingestion-worker` 的 `package.json` 不新增该依赖；
- 不实现具体错误事件 processor；不实现查询、Issue、fingerprint、Source Map；
- Migration 为追加式，可 up/down，不自动执行于应用启动；
- SQL 全参数化；不暴露 SQLSTATE/约束名/SQL；
- 不记录 EventEnvelope 完整正文、客户端密钥、HTTP Header、数据库 URL；
- Workspace Policy：`data → {protocol}`（现有允许矩阵已支持）；`processing-store → event-schema` 允许；`ingestion-inbox → processing-store` 禁止；`processing-store → ingestion-inbox` 禁止；SDK/Browser/plugins → processing-store 禁止；production 包依赖 benchmark 禁止。

## 迁移方案

本 ADR accepted 后：编写错误 occurrence 处理存储正式规格 → writing-plans → 实施 `packages/processing-store`（`error_event_occurrences` Migration + 持久化 Repository + 幂等）→ 真实 PostgreSQL 17 集成验证。

## 回滚方案

- Migration 发布前缺陷：可直接修改未发布 Migration；
- Migration 发布后：向前修复与 expand/contract；destructive down 不作为生产默认回滚；
- Repository 实现与 Worker 主循环解耦，可替换而不影响 Inbox/Worker/event-schema 公共接口。

## 验证方式

- 单元测试：顶层 input 校验、projectId 校验、非错误事件、协议版本、正文非法、三类错误类别、输入不变、稳定结果、不泄露数据库错误；
- 真实 PostgreSQL 17：三类错误事件 occurrence 写入、protocolVersion/occurredAt/createdAt 正确、normalizedBody 与解析结果一致、不存完整 Envelope/Header/凭证、同 project/eventId 返回 duplicate、duplicate 不更新原记录、跨项目可分别写入、数据库错误映射、unique/category/jsonb-object 约束、Migration up/down/up、Schema 与 Pool 清理；
- 协议漂移测试：`error_category` 来自 event-schema 公共常量、包不复制独立漂移枚举、event-schema 包入口变更导致测试明确失败；
- 回归：event-schema、ingestion-inbox、ingestion-worker、ingestion-api 全部测试通过；OpenAPI 无变化；benchmark smoke 通过；
- 全仓质量门禁与覆盖率 85/80/85/85。

## 重新评估条件

- 需要搜索/分析能力且 PostgreSQL 无法满足；
- 真实容量基准显示明细表需要分区或独立存储；
- 需要 Issue 分组、fingerprint 或 Source Map 存储语义；
- 处理数据保留规则落地后需要同步生命周期。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-02：独立非作者审查（真实审查结论）

- 独立审查 subagent（只读，未修改任何文件）完成非作者审查；
- 审查确认：与 approved 规范及 accepted ADR-005/008/010/012/015/016/017 无冲突；不修改 Inbox、Worker、retry budget、backoff、OpenAPI、event-schema 公共契约；三个候选（A 独立错误 occurrence 表、B 通用 processed_events JSONB 表、C 立即引入 OpenSearch/ClickHouse）真实且比较矩阵公平；`error_category` 三值与 event-schema 真实 `ErrorCategory` 常量一致；`project_id` uuid/`event_id` varchar(128) 与 event_inbox Migration 一致；`ON CONFLICT DO NOTHING` 幂等与现有 persist-batch 模式一致；workspace-policy `data → {protocol}` 允许矩阵已存在；
- 审查结论：**可接受进入 writing-plans 与正式代码实施**；
- 审查提出的中等问题已在正式规格落实：`error_category` 列与 `normalized_body.category` 增加一致性 CHECK（`error_category = normalized_body->>'category'`），并配套真实 PostgreSQL 断言；`occurred_at` ms → timestamptz 转换在规格冻结（`new Date(occurredAt).toISOString()`）；数据保留显式挂接未来处理数据保留策略；
- 审查提出的次要建议（方案 B 论证措辞、processor 接入时 ADR-012 约束扩展前瞻）不改变决策方向，在正式规格与计划中记录。

### 2026-08-02：用户批准与最终决定

- 决策状态更新为 `accepted`，实施状态保持 `not-started`，审批状态 `approved`；
- 用户批准方案 A，批准内容以用户 2026-08-02 消息的精确决定为准；
- 最终决定：PostgreSQL 独立错误 occurrence 表（`error_event_occurrences`）+ 受协议约束的 jsonb 正文；`@aurora/processing-store`（`data` 层）包；`(project_id, event_id)` 唯一幂等；输入经 event-schema 根入口验证；`normalized_body` 只存规范化正文；`error_category` 来自 `ErrorCategory` 公共常量；`occurred_at` 来自信封、`created_at` 为数据库 now；第一增量无查询 API、无保留规则；不实现具体 processor；
- 本 ADR 不决定 Issue 分组、fingerprint、Source Map、查询 API 或搜索/分析存储；
- 本 ADR 不修改 Inbox；本 ADR 不实现 processor；
- 本次批准不代表 `error_event_occurrences` 表、Migration、Repository、具体错误事件 processor、查询 API、CI、RDS 或 IaC 已经实现。

### 2026-08-02：错误事件 occurrence 处理存储第一增量实施证据

- 实施状态更新为 `implemented`：`packages/processing-store` 错误事件 occurrence 处理存储第一增量已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试、协议漂移测试与全仓质量门禁；具体错误事件 processor、查询 API、Issue 分组、fingerprint、Source Map 与搜索仍未实现，故不扩大范围；
- 实施内容：`src/errors.ts`（`ProcessingStoreError` + kind）、`src/error-occurrence-types.ts`（`PersistErrorEventOccurrenceInput`/`PersistErrorEventOccurrenceResult` 可判别联合类型/私有 `ErrorOccurrenceDbParams`）、`src/error-occurrence-input.ts`（`parsePersistErrorEventOccurrenceInput`：顶层 unknown 校验 + `parseErrorEventEnvelope` 映射）、`src/error-occurrence-repository.ts`（`persistErrorEventOccurrence`：事务内 `INSERT ... ON CONFLICT DO NOTHING RETURNING id`，区分 `inserted`/`duplicate`/`temporarily_unavailable`）、Migration `1722500000003_error-event-occurrences.ts`（`error_event_occurrences` 表 + `(project_id, event_id)` 唯一 + category CHECK + jsonb object CHECK + category 与正文一致 CHECK）；包根 `index.ts` 导出最小公共 API；
- 语义：`occurred_at` 来自 EventEnvelope 正式事件时间；`created_at` 为数据库 `now()`；`normalized_body` 只存协议规范化正文（`ErrorEventEnvelope.body`），不存完整 Envelope/Header/凭证；`error_category` 三值来自 `ErrorCategory` 公共常量（`javascript`/`unhandled_rejection`/`resource`）；输入经 `@aurora/event-schema` 根入口验证；SQL 全参数化；不暴露 SQL/数据库错误码/约束名；
- 未修改 Inbox、Worker、event-schema、ingestion-api、OpenAPI；`apps/ingestion-worker` 的 `package.json` 未新增 `@aurora/processing-store` 依赖；未实现具体 processor/查询/Issue/fingerprint/Source Map；未冻结数据保留天数；
- 测试：23 个单元测试（输入解析/Repository 错误映射/包入口/安全负例/协议漂移）+ 17 个真实 PostgreSQL 17.10 集成测试（三类错误事件写入、protocolVersion/occurredAt/createdAt、normalizedBody 与解析结果一致、不存完整 Envelope/Header/凭证、duplicate 不创建新行/不覆盖原正文、跨项目写入、category/jsonb/category-matches-body/unique 约束、Migration up/down/up、Schema 与 Pool 清理）；
- 覆盖率：lines / statements / branches / functions 均满足 85/80/85/85 门槛；
- 验证命令：`pnpm --filter @aurora/processing-store typecheck/test/test:integration/test:coverage/test:package/build`、`pnpm check:boundaries`、`pnpm check:ci` 全部 exit 0；`pnpm benchmark:ingestion:smoke` exit 0；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：具体错误事件 processor、错误查询 API、Issue 分组、fingerprint、Source Map、搜索、请求/性能 occurrence 存储、数据保留规则、CI、RDS、IaC。

### 2026-08-03：错误事件 Processor 核心能力衔接证据

- 决策状态保持 `accepted`，实施状态保持 `implemented`；本 ADR 的"后续 processor 衔接"（规格第 31 节）由 `@aurora/ingestion-worker` 的 `createErrorEventProcessor` 核心能力承接；
- 处理器只处理 `EventType.Error`，通过 `@aurora/processing-store` 包根调用 `persistErrorEventOccurrence`，映射 `inserted`/`duplicate`/`invalid_input`/`temporarily_unavailable` 到既有 Worker 结果；`(project_id, event_id)` 唯一幂等继续由本 ADR 的 occurrence 表约束保证；
- **不修改本 ADR 表结构或稳定结果**；不修改 Inbox/Worker runtime/OpenAPI；不实现 processor 之外的请求/性能 occurrence 存储；不把处理器接入生产 composition root（Request/Performance 事件路由仍 blocked）；
- 状态记录：error event processor core implemented；production worker composition not-started / blocked；request/performance event processor not-started；event processor routing not-started / blocked。
