---
title: Aurora 错误事件 occurrence 处理存储第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-02
last-reviewed: 2026-08-02
applies-to: packages/processing-store（@aurora/processing-store）的错误事件 occurrence 明细处理存储（error_event_occurrences 表、持久化 Repository、(project_id, event_id) 幂等、稳定结果）
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
  - ../architecture/ingestion-inbox-data-model.md
  - ../architecture/ingestion-inbox-processing-repository.md
  - ../architecture/ingestion-worker-runtime.md
  - ../protocol/error-event-contract.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: processing-store-schema-or-contract-change
---

# Aurora 错误事件 occurrence 处理存储第一增量

## 1. 定位、效力与当前状态

本文冻结错误事件 occurrence 处理存储第一增量，实施为 `packages/processing-store`（包名 `@aurora/processing-store`，`aurora.layer: data`）。它为未来具体错误事件 processor 提供稳定数据存储边界：持久化"已通过 `@aurora/event-schema` 错误事件协议契约验证的错误事件明细 occurrence"。本模块只实现处理存储，**不**实现具体错误事件 processor、查询 API、Issue 分组、fingerprint、Source Map 或搜索。

**批准状态**：本文由用户于 2026-08-02 预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-02 更新为 `implemented`：`packages/processing-store` 已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁。本文由 accepted ADR-005/008/010/012/018 与 approved 错误事件协议契约、Inbox 数据模型、处理侧 Repository、Worker 规格无歧义派生；自动审批依据见规格自检节。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：`packages/processing-store` 的错误事件 occurrence 能力：`error_event_occurrences` 表、`error_event_occurrences` Migration、持久化 Repository（`persistErrorEventOccurrence`）、`(project_id, event_id)` 幂等、稳定结果、单元测试、真实 PostgreSQL 17 集成测试、协议漂移测试、Workspace Policy、README、正式规格与 ADR-018 证据。
- **明确非职责**：
  - 具体错误事件 processor、请求/性能事件 occurrence 存储；
  - 错误查询 API、分页、过滤、Issue 分组、fingerprint、Source Map、搜索索引、告警事件；
  - 数据保留规则、自动清理、定时任务；
  - 修改 Inbox、Worker、event-schema、ingestion-api、OpenAPI；
  - CI、RDS、IaC、容量基准。

## 3. 模块选择依据

- 真实仓库核验：不存在任何处理结果数据库、`error_event_occurrences` 表、错误事件持久化 Repository、`(project_id, event_id)` 处理结果幂等或真实 PostgreSQL 错误事件存储测试；
- `apps/ingestion-worker` 的 `IngestionEventProcessor` 端口只有抽象输入，没有可写入的处理存储；
- 处理存储物理技术与表形态由 accepted ADR-018 收口（PostgreSQL 独立错误 occurrence 表，正文受协议约束 jsonb）；
- 本模块只做错误事件 occurrence 存储，不做具体 processor 或查询。

## 4. 存储技术

第一增量继续使用（accepted ADR-010/018）：

- PostgreSQL 17；
- SQL-first；
- `pg`（node-postgres）；
- `node-pg-migrate`；
- 参数化 SQL；
- 真实 PostgreSQL 17 集成测试（`AURORA_TEST_DATABASE_URL`，目标必须是测试数据库）。

禁止引入：OpenSearch、Elasticsearch、ClickHouse、MongoDB、Redis、对象存储、新队列、ORM、Query Builder。这些未来技术如有需要，必须独立 ADR。

## 5. 包位置与包结构

- 内部 Workspace 数据包目录：`packages/processing-store`；
- 包名：`@aurora/processing-store`；
- `"private": true`；`"type": "module"`；Node.js 24（`engines` `">=24.18.0 <25"`）；
- Migration 目录：`packages/processing-store/migrations`；
- 包内结构：`src/`、`migrations/`、`test/`、`test/integration/`、`README.md`；
- Workspace Policy：`aurora.layer: data`；允许 `data → {protocol}`（现有允许矩阵已支持）；
- 只实现错误事件 occurrence 能力；不得创建 `utils`/`helpers`/`common`/`base-repository`/`generic-store`/`universal-event-table`；
- 包内使用明确错误事件命名：`error-occurrence-types.ts`、`error-occurrence-input.ts`、`error-occurrence-repository.ts`。

## 6. 数据边界

本模块存储：

> "已通过 event-schema 错误事件契约验证的错误事件明细 occurrence"。

不是：

- 原始 HTTP 请求；
- Inbox 原始副本；
- 通用 EventEnvelope 仓库；
- 问题 Issue；
- 分组结果；
- 聚合结果；
- 搜索索引；
- 告警事件。

一个 occurrence 对应一个 `(projectId, eventId)`。同一事件经 Worker 重试或人工重放后，不得创建多个 occurrence。

## 7. 职责

- `error_event_occurrences` 表与 Migration（追加式，可 up/down，应用启动不自动执行）；
- `(project_id, event_id)` 唯一幂等约束；
- `persistErrorEventOccurrence` 持久化 Repository：事务内 `ON CONFLICT DO NOTHING`，区分 `inserted`/`duplicate`；
- 顶层 unknown 输入校验；
- 通过 `@aurora/event-schema` 根入口 `parseErrorEventEnvelope` 验证错误事件；
- 从已验证数据生成数据库参数（不复制第二套错误事件类型）；
- 数据库暂时失败映射为稳定 `temporarily_unavailable`；
- 单元测试、真实 PostgreSQL 17 集成测试、协议漂移测试、包入口与安全负例。

## 8. 非职责

- 不实现具体错误事件 processor；
- 不实现查询、分页、过滤、Issue、分组、fingerprint、Source Map；
- 不实现搜索/分析存储；
- 不冻结数据保留天数、不自动删除、不创建定时清理任务；
- 不修改 Inbox/Worker/event-schema/ingestion-api/OpenAPI；
- 本轮不把 processing-store 接入 Worker（`apps/ingestion-worker` 的 `package.json` 不新增该依赖）；
- 不创建 CI、RDS、IaC、容量基准。

## 9. 输入契约

包根导出最小公共 API（命名遵循仓库风格；精确签名可微调，但语义冻结）：

```ts
export interface PersistErrorEventOccurrenceInput {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
}

export type PersistErrorEventOccurrenceResult =
  | {
      readonly status: 'inserted';
      readonly occurrenceId: string;
    }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

export function persistErrorEventOccurrence(
  pool: Pool,
  input: unknown,
): Promise<PersistErrorEventOccurrenceResult>;
```

公共边界接收 `unknown`；显式验证顶层 input；使用 event-schema 根入口解析错误事件；不使用 `any`；不使用不安全类型断言；不暴露 pg Result；不暴露 SQL、SQLSTATE 或 constraint；不修改输入；返回稳定可判别结果；不创建或关闭调用方 Pool；不写日志；不访问 `process.env`。

## 10. 运行时验证

持久化流程固定执行：

1. 校验顶层 `input` 为非空对象；
2. 校验 `projectId` 为非空字符串；
3. 从 `input.eventEnvelope` 读取 `unknown` 值；
4. 调用 `@aurora/event-schema` 根入口 `parseErrorEventEnvelope`；
5. 解析失败 → 返回 `invalid_input`（code 使用稳定 issue code 的聚合/首个稳定 code，不回显输入值）；
6. 校验 `eventType === EventType.Error`（`parseErrorEventEnvelope` 已保证）；
7. 从已解析 `ErrorEventEnvelope` 提取 `eventId`、`protocolVersion`、`occurredAt`、`body.category`、`body`（规范化正文）；
8. 进行参数化 INSERT；
9. 使用唯一约束实现幂等；
10. 首次写入映射为 `inserted`；冲突映射为 `duplicate`；数据库暂时失败映射为 `temporarily_unavailable`。

禁止：在 INSERT 前自行查询判断重复；动态拼接 SQL；将完整 EventEnvelope 写入正文列；对正文执行 `JSON.stringify` 后再手工拼 SQL；自动更新旧 occurrence；在重复时比较或覆盖正文；把数据库错误文本放进公共结果。

## 11. occurrence 身份

- 一个 occurrence 对应一个 `(projectId, eventId)`；
- `(project_id, event_id)` 为数据库唯一约束；
- 同一 projectId/eventId 的后续写入（Worker 重试、人工重放后再次处理）返回 `duplicate`，不创建新记录。

## 12. PostgreSQL 表

创建单一明细表，最终名称在本 ADR 与规格冻结：

```text
error_event_occurrences
```

## 13. 列和类型

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | bigserial | primary key（内部主键） |
| `project_id` | uuid | not null；与 `event_inbox.project_id` 类型一致 |
| `event_id` | varchar(128) | not null；与 `event_inbox.event_id` 类型/长度一致 |
| `protocol_version` | integer | not null；来自 ErrorEventEnvelope 正式协议版本 |
| `occurred_at` | timestamptz | not null；来自 ErrorEventEnvelope 正式事件时间 |
| `error_category` | varchar(64) | not null；来自 `ErrorCategory` 公共常量（CHECK 约束） |
| `normalized_body` | jsonb | not null；只保存协议解析成功后的规范化正文（CHECK 约束） |
| `created_at` | timestamptz | not null；default `now()`（数据库当前时间） |

不增加：`issue_id`/`fingerprint`/`group_id`/`source_map_id`/`release_id`/`user_id`/`session_id`/`assigned_user_id`/`resolved_at`/`search_document`/`arbitrary tags`/`extra metadata JSON`。

## 14. error_category

- 必须来自 `@aurora/event-schema` 根入口 `ErrorCategory` 公共常量；
- 真实允许值（与 event-schema 一致）：`javascript`、`unhandled_rejection`、`resource`；
- 禁止自行新增类别；
- 数据库 CHECK 或等价约束与公共协议保持一致（列出三值，不创建第二套手工漂移枚举）；
- 计划必须包含漂移检测测试：从 `@aurora/event-schema` 根入口读取 `ErrorCategory` 值，与数据库 CHECK 允许值比对；event-schema 包入口变更导致测试明确失败。

## 15. normalized_body

- PostgreSQL 类型 `jsonb`；
- 只保存错误事件协议解析成功后的规范化正文（`ErrorEventEnvelope.body`）；
- 不保存完整 EventEnvelope、HTTP Header、客户端凭证、Origin/environment、SQL、Worker lease、原始异常对象、event-schema 未批准字段；
- 必须添加 CHECK：`jsonb_typeof(normalized_body) = 'object'`；
- 添加 CHECK：`error_category = normalized_body->>'category'`（保证列与正文不漂移，落实独立审查建议）；
- 第一增量不添加 GIN 索引；
- 不得在数据库中重新解析或转换正文。

## 16. occurred_at / created_at

- `occurred_at` 来自 EventEnvelope 的正式事件时间（`ErrorEventEnvelope.occurredAt`，Unix epoch 毫秒安全整数）；
- `created_at` 使用 PostgreSQL `now()`；
- 不使用调用方传入的 createdAt；
- 不使用数据库时间替换 occurredAt；
- 不使用 Worker 主机时间作为持久化时间；
- Date/时间字符串按现有协议解析和验证。

## 17. 幂等

- 数据库建立 `(project_id, event_id)` 唯一约束；
- 使用 `ON CONFLICT DO NOTHING`（或等价可证明安全的 PostgreSQL 语义）；
- 首次写入 → `inserted`；
- 同一 projectId/eventId 再次写入 → `duplicate`；
- duplicate 不更新原 occurrence；
- duplicate 不增加第二条记录；
- duplicate 不覆盖原正文；
- duplicate 不暴露 PostgreSQL constraint 或 SQLSTATE。

不得通过"先查询再插入"作为唯一幂等机制。

## 18. duplicate

- `duplicate` 是稳定公共结果，不携带数据库错误信息；
- 不与 `inserted` 混淆；
- 不把 SQLSTATE、约束名或 SQL 文本暴露给调用方。

## 19. 数据库事务

- `persistErrorEventOccurrence` 在一个 PostgreSQL 事务内完成（从 Pool 获取同一 client 显式 BEGIN/COMMIT/ROLLBACK）；
- 成功时 COMMIT 后才返回 `inserted`；回滚/连接中断不产生 inserted 记录；
- 任一失败整体回滚；
- client 在 finally 中释放。

## 20. 稳定结果

`PersistErrorEventOccurrenceResult` 是显式可判别联合类型：

- `inserted`：成功，含 `occurrenceId`（内部主键）；
- `duplicate`：同一 `(projectId, eventId)` 已存在，幂等结果；
- `invalid_input`：顶层输入、projectId 或错误事件信封解析失败，含稳定 `code`（不回显输入值）；
- `temporarily_unavailable`：数据库暂时失败（连接失败/语句失败），不泄露数据库细节。

## 21. 错误映射

- 数据库错误映射为稳定内部错误：连接失败（`ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND`）→ `temporarily_unavailable`；语句失败 → `temporarily_unavailable`；
- 不暴露 SQLSTATE、约束名、表名、SQL 文本或完整数据库 URL；
- 内部验证错误（`invalid_input`）不在正常控制流抛出。

## 22. 公共 API

包根导出最小公共能力：

- `persistErrorEventOccurrence`（函数）；
- `PersistErrorEventOccurrenceInput`、`PersistErrorEventOccurrenceResult`（类型）；
- `ProcessingStoreError`（或等价稳定错误类型，含 `kind`：`invalid_input`/`database_unavailable`/`statement_failed`）。

禁止导出：私有字段解析器、SQL、查询 Repository、通用事件存储框架、测试专用查询。

## 23. 隐私与敏感信息

- 不记录 EventEnvelope 完整正文、SQL、SQLSTATE、约束名、数据库 URL、客户端密钥、HTTP Header、Origin/environment；
- `normalized_body` 只存协议规范化正文，不含凭据/Header/完整 URL 查询（协议层已移除）；
- 解析失败 issue 不回显输入值；
- 包根不写日志。

## 24. 数据保留边界

- 本轮不冻结新的保留天数；
- 记录该表属于未来处理数据保留策略；
- 不自动删除；
- 不创建定时清理任务；
- 不声称永久保留；
- 不复用 Inbox 35 天备份淘汰语义冒充在线数据保留规则。

## 25. Migration

新增追加 Migration（不编辑任何既有 Migration）：

- 创建 `error_event_occurrences` 表（列与约束见第 12—15 节）；
- `id` bigserial 主键；
- `project_id` uuid（与 event_inbox 一致）；
- `event_id` varchar(128)（与 event-schema/Inbox 一致）；
- `protocol_version` integer；
- `occurred_at` timestamptz；
- `error_category` varchar(64) + CHECK（三值来自 `ErrorCategory`）；
- `normalized_body` jsonb + CHECK（`jsonb_typeof = 'object'` + `error_category = normalized_body->>'category'`）；
- `created_at` timestamptz default `now()`；
- `unique(project_id, event_id)`；
- 必要的 created_at/project_id 查询基础索引仅在有当前查询依据时创建（第一增量不创建无依据索引）。

不得添加：GIN、全文索引、trigram、分区、TTL、自动清理触发器、fingerprint 索引、Issue 外键。

Migration 必须：可 up；可 down；up/down/up 测试；不在应用启动时自动运行；使用真实 PostgreSQL 17；隔离 Schema；完整清理。

## 26. 回滚

- Migration 发布前缺陷：可直接修改未发布 Migration；
- Migration 发布后：向前修复与 expand/contract；destructive down 不作为生产默认回滚；
- Repository 实现与 Worker 主循环解耦，可替换而不影响 Inbox/Worker/event-schema 公共接口。

## 27. 单元测试

至少覆盖：

- 非对象 input；
- projectId 缺失；
- projectId 类型错误；
- envelope 缺失；
- 非错误事件；
- 错误协议版本；
- 错误正文非法；
- 三种当前正式错误类别；
- 输入不变；
- 稳定结果；
- 不泄露 event-schema 内部异常；
- 不使用 `any`；
- 不使用 `console`；
- 不访问 `process.env`。

## 28. 真实 PostgreSQL 集成测试

必须使用真实 PostgreSQL 17 验证（`AURORA_TEST_DATABASE_URL`；测试确认目标是测试数据库；独立 Schema/命名空间隔离；清理失败显式报错）：

- JavaScript 错误 occurrence 写入；
- Promise rejection occurrence 写入；
- 资源错误 occurrence 写入；
- `protocolVersion` 正确；
- `occurredAt` 正确；
- `createdAt` 来自数据库（非调用方）；
- `normalizedBody` 与解析结果一致；
- 不存完整 EventEnvelope；
- 不存 HTTP Header；
- 不存凭证；
- 同 project/eventId 返回 duplicate；
- duplicate 不更新原记录；
- 相同 eventId 不同 project 可以分别写入；
- 数据库错误映射；
- unique constraint；
- category constraint（含列与正文一致 CHECK）；
- jsonb object constraint；
- Migration up/down/up；
- Schema 清理；
- Pool 清理。

## 29. 协议漂移测试

必须证明：

- `error_category` 来自 `@aurora/event-schema` 公共常量（`ErrorCategory`）；
- package 不复制独立的漂移枚举；
- event-schema 包入口变更会导致测试明确失败（测试从 `@aurora/event-schema` 根入口读取 `ErrorCategory` 值，与数据库 CHECK 允许值比对）。

## 30. 包入口

- 包根导出最小公共能力（第 22 节）；
- 私有路径拒绝测试：`@aurora/processing-store/error-occurrence-repository`、`/error-occurrence-input` 等私有路径以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝；
- 只从 `@aurora/event-schema` 包根导入（`parseErrorEventEnvelope`、`ErrorCategory`、`EventType`、`ErrorEventEnvelope` 类型）；
- 不访问 `@aurora/event-schema/src`/`internal`；
- `aurora.layer: data`（Workspace Policy 允许 `data → {protocol}`）。

## 31. 后续 processor 衔接

- 未来具体错误事件 processor 实现 `IngestionEventProcessor` 端口；
- processor 从 `ProcessIngestionEventInput.event`（`EventEnvelope`）读取错误事件，通过 `persistErrorEventOccurrence` 包根写 occurrence；
- 本轮不把 processing-store 接入 Worker；
- `apps/ingestion-worker` 的 `package.json` 不新增 `@aurora/processing-store` 依赖；
- Worker 通过 `@aurora/ingestion-inbox` 包根公共接口保持现状。

## 32. 后续查询/聚合衔接

- 查询、分页、过滤、Issue 聚合和搜索必须独立规划；
- 本模块不导出查询 Repository；
- 测试使用私有 SQL 验证落库，但不得为了测试导出通用查询 Repository；
- 第一增量不提供产品查询 API。

## 33. 排除范围

- 具体错误事件 processor、请求/性能事件 occurrence 存储；
- 错误查询 API、分页、过滤、Issue 分组、fingerprint、Source Map、搜索、告警；
- 数据保留规则、自动清理、定时任务；
- 修改 Inbox、Worker、event-schema、ingestion-api、OpenAPI；
- 管理平台、HTTP 路由、客户端凭证；
- Redis/BullMQ、SQS/Kinesis、OpenSearch/ClickHouse/MongoDB、CI、RDS、IaC、容量基准。

## 34. 覆盖率与质量门禁

- `packages/processing-store` 维持 TypeScript strict；
- 覆盖率不低于 lines 85%、branches 80%、functions 85%、statements 85%；
- 单元测试 + 真实 PostgreSQL 17 集成测试 + 协议漂移测试 + 包入口/私有路径负例；
- 安全负例：src 不含 SQLSTATE/constraint/SQL 文本、数据库 URL、clientKey/secret/Authorization、`console.log`、`process.env`、`Math.random`；
- 回归：event-schema、ingestion-inbox、ingestion-worker、ingestion-api 全部测试通过；OpenAPI 无变化；benchmark smoke 通过；
- 全仓门禁：`pnpm install --frozen-lockfile`、`format:check`、`lint`、`typecheck`、`test`、`test:coverage`、`check:boundaries`、`build`、`check:ci`、`git diff --check`。

## 35. 规格自检

- **权威一致性**：错误事件字段完全来自 event-schema；不创建第二套 Schema；不改变 Inbox；不改变 Worker；不改变 retry/replay；不改变 OpenAPI；不创建 Issue/fingerprint；不决定搜索技术；
- **兼容性**：新包只通过 event-schema 包根依赖；无循环依赖；无私有深导入；Migration 为追加式；已完成模块回归通过；Worker 尚未接入该包；未来 processor 可以通过包根使用；
- **计划质量**：规格每项要求都有 Task；表名、列名、类型、常量和结果全文一致；每个 Task 有真实 TDD；无占位；无第二模块；零上下文实施者可直接执行；
- **安全和数据**：不存客户端密钥；不存 Header；不存数据库 URL；不存完整 Envelope；不存未批准字段；SQL 全参数化；不暴露数据库错误；测试 Schema 隔离并清理；无自动保留或删除规则。

自动审批依据：本文全部语义由 accepted ADR-005/008/010/012/018 与 approved 错误事件协议契约、Inbox 数据模型、处理侧 Repository、Worker 规格无歧义派生；无新增产品/架构/安全/隐私决策；不修改 Inbox/Worker/event-schema/OpenAPI；不实现 processor/查询/Issue；用户已预先批准本消息中的精确架构决策（6.1—6.11）；自检全部通过。
