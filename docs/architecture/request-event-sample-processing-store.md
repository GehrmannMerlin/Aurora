---
title: Aurora 请求事件安全样本处理存储第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-03
last-reviewed: 2026-08-03
applies-to: packages/processing-store（@aurora/processing-store）的请求事件安全样本处理存储（request_event_samples 表、持久化 Repository、幂等、稳定结果）
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
  - ../architecture/error-event-occurrence-processing-store.md
  - ../architecture/error-event-processor.md
  - ../protocol/request-event-contract.md
  - ../architecture/formalization-readiness.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: request-sample-store-schema-or-contract-change
---

# Aurora 请求事件安全样本处理存储第一增量

## 1. 定位、效力与当前状态

本文冻结请求事件安全样本处理存储第一增量，实施为 `packages/processing-store`（`@aurora/processing-store`）的 `request_event_samples` 表、`persistRequestEventSample` Repository 与稳定结果。它承载 accepted ADR-019 的"聚合主路径＋有限安全诊断样本"边界中**样本存储能力**部分：持久化"已由上游样本策略选中的合法 Request 事件"的安全投影。本模块只实现样本存储能力，**不**实现 Request Metric Store、样本选择策略执行器、Request Processor、Performance、路由、production composition root、Issue 分组、查询 API 或数据删除任务。

**批准状态**：本文由用户于 2026-08-03 预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-03 更新为 `implemented`：`packages/processing-store` 的请求事件安全样本能力已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁。本文由 accepted ADR-004/005/006/008/010/012/018/019、approved 请求事件协议契约、PRD 5.1.2/5.1.3/5.1.5/5.1.6 与 RULE-REQUEST-PERSISTENCE-20260803-002、既有错误事件 occurrence 处理存储规格无歧义派生；自动审批依据见规格自检节。

**声明边界**：本模块存储的是"安全请求样本"，**不是**完整请求 occurrence 历史；不保存所有 Request 事件；聚合是主路径。请求样本的类别判断（网络失败/超时/429/5xx/慢请求）由未来样本选择策略执行器负责，本 Repository 只持久化已由上游选中的合法 Request 事件。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：`packages/processing-store` 的请求事件安全样本能力：`request_event_samples` 表、Migration、`persistRequestEventSample` Repository、`(project_id, event_id)` 幂等、稳定结果、单元测试、真实 PostgreSQL 17 集成测试、隐私负例、Workspace Policy、README、正式规格与 ADR-019 证据。
- **明确非职责**：
  - Request Metric Store、聚合、时间桶；
  - 样本选择策略执行器、Request Processor；
  - Performance Store、Performance Processor；
  - Event Processor Router、production composition root；
  - Issue 分组、fingerprint、查询 API、搜索、告警；
  - 数据保留任务；
  - 修改 request-event-contract、ingestion-api、POST /v1/batches、Worker、Error store、Error processor、retry/backoff/replay。

## 3. 模块选择依据

- accepted ADR-019 决定方案 B（聚合主路径＋有限安全诊断样本），其决定细节 2 明确"本模块实现安全请求样本存储能力"；
- `@aurora/processing-store` 已实施错误事件 occurrence 存储（`error_event_occurrences` + `persistErrorEventOccurrence`），本模块复用同一工具链与稳定 Repository 模式，但表/Repository/类型完全独立，不与 Error 合并；
- 请求事件协议契约已实施（`RequestEventBody` 六字段、`parseRequestEventEnvelope`、URL 已由协议层移除查询参数与片段）；
- 用户已批准 RULE-REQUEST-PERSISTENCE-20260803-002 产品决定。

## 4. 存储技术

第一增量继续使用（accepted ADR-010/018/019）：

- PostgreSQL 17；
- SQL-first；
- `pg`（node-postgres）；
- `node-pg-migrate`；
- 参数化 SQL；
- 真实 PostgreSQL 17 集成测试（`AURORA_TEST_DATABASE_URL`，目标必须是测试数据库）。

禁止引入：OpenSearch、Elasticsearch、ClickHouse、MongoDB、Redis、对象存储、新队列、ORM、Query Builder。

## 5. 包位置与包结构

- 在现有 `packages/processing-store`（`@aurora/processing-store`，`aurora.layer: data`）内新增请求样本能力，不新建包；
- 新增文件：`src/request-sample-types.ts`、`src/request-sample-input.ts`、`src/request-sample-repository.ts`；
- 新增 Migration：`migrations/`（时间戳晚于 `1722500000003_error-event-occurrences.ts`）；
- 包根 `index.ts` 追加导出请求样本 API；
- 不创建 `utils`/`helpers`/`common`/`base-repository`/`generic-store`/`universal-event-table`。

## 6. 数据边界

本模块存储：

> "已由上游样本策略选中的、通过 `@aurora/event-schema` 请求事件协议契约验证的 Request 事件安全样本投影"。

不是：

- 完整请求 occurrence 历史；
- 所有 Request 事件逐条记录；
- 聚合或指标；
- 请求/响应体、Header、Cookie、Authorization、敏感查询、未规范化完整 URL、DOM/文本、IP、指纹；
- 完整 `RequestEventEnvelope`。

一个样本对应一个 `(projectId, eventId)`。

## 7. 职责

- `request_event_samples` 表与 Migration（追加式，可 up/down，应用启动不自动执行）；
- `(project_id, event_id)` 唯一幂等约束；
- `persistRequestEventSample` Repository：事务内 `ON CONFLICT DO NOTHING`，区分 `inserted`/`duplicate`；
- 顶层 unknown 输入校验；
- 通过 `@aurora/event-schema` 根入口 `parseRequestEventEnvelope` 验证 Request 事件；
- 从已验证数据生成安全投影（六字段白名单）；
- 数据库暂时失败映射为稳定 `temporarily_unavailable`；
- 单元测试、真实 PostgreSQL 17 集成测试、隐私负例、协议漂移测试、包入口与安全负例。

## 8. 非职责

- 不判断某事件是否应该成为样本（类别选择由上游执行器负责）；
- 不实现聚合、指标、时间桶、Request Processor；
- 不实现 Performance、路由、production composition root、Issue、查询、告警；
- 不实现数据保留任务；
- 本轮不把请求样本存储接入 Worker（`apps/ingestion-worker` 不新增依赖）；
- 不修改 request-event-contract、ingestion-api、POST /v1/batches、Error store、Error processor。

## 9. 输入契约

包根导出最小公共 API（命名遵循仓库风格；语义冻结）：

```ts
export interface PersistRequestEventSampleInput {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
}

export type PersistRequestEventSampleResult =
  | {
      readonly status: 'inserted';
      readonly sampleId: string;
    }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

export function persistRequestEventSample(
  pool: Pool,
  input: unknown,
): Promise<PersistRequestEventSampleResult>;
```

公共边界接收 `unknown`；显式验证顶层 input；使用 event-schema 根入口解析 Request 事件；不使用 `any`；不暴露 pg Result；不暴露 SQL/SQLSTATE/constraint；不修改输入；返回稳定可判别结果；不创建或关闭调用方 Pool；不写日志；不访问 `process.env`。

## 10. 运行时验证

持久化流程固定执行：

1. 校验顶层 `input` 为非空对象；
2. 校验 `projectId` 为非空字符串；
3. 从 `input.eventEnvelope` 读取 `unknown` 值；
4. 调用 `@aurora/event-schema` 根入口 `parseRequestEventEnvelope`；
5. 解析失败 → 返回 `invalid_input`（code 使用稳定 code，不回显输入值）；
6. 校验 `eventType === EventType.Request`（`parseRequestEventEnvelope` 已保证）；
7. 从已解析 `RequestEventEnvelope` 提取 `eventId`、`protocolVersion`、`occurredAt`、`body`（六字段白名单安全投影）；
8. 进行参数化 INSERT；
9. 使用唯一约束实现幂等；
10. 首次写入映射为 `inserted`；冲突映射为 `duplicate`；数据库暂时失败映射为 `temporarily_unavailable`。

禁止：在 INSERT 前自行查询判断重复；动态拼接 SQL；将完整 `RequestEventEnvelope` 或信封字段写入投影；对正文执行 `JSON.stringify` 后再手工拼 SQL；自动更新旧样本；在重复时比较或覆盖正文；把数据库错误文本放进公共结果；自行判断样本类别。

## 11. occurrence/样本身份

- 一个样本对应一个 `(projectId, eventId)`；
- `(project_id, event_id)` 为数据库唯一约束；
- 同一 projectId/eventId 的后续写入（Worker 重试、人工重放后再次处理）返回 `duplicate`，不创建新记录。

## 12. PostgreSQL 表

创建单一表，最终名称在本 ADR 与规格冻结：

```text
request_event_samples
```

## 13. 列和类型

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | bigserial | primary key（内部主键） |
| `project_id` | uuid | not null；与 `event_inbox.project_id` 类型一致 |
| `event_id` | varchar(128) | not null；与 `event_inbox.event_id` 类型/长度一致 |
| `protocol_version` | integer | not null；来自 RequestEventEnvelope 正式协议版本 |
| `occurred_at` | timestamptz | not null；来自 RequestEventEnvelope 信封 `occurredAt`（事件产生时间） |
| `sample_body` | jsonb | not null；受协议约束的安全投影（六字段白名单） |
| `created_at` | timestamptz | not null；default `now()`（数据库当前时间） |

`sample_body` 是受协议约束 jsonb（ADR-019 决定细节 11 冻结）：只允许协议解析后的六字段白名单（`method`、`url`、`startedAt`、`durationMs`、`outcome`、可选 `statusCode`）；URL 已由协议层移除查询参数与片段；不允许未知键、完整信封字段或未批准字段。

不增加：`issue_id`/`fingerprint`/`group_id`/`source_map_id`/`release_id`/`user_id`/`session_id`/`assigned_user_id`/`resolved_at`/`search_document`/`arbitrary tags`/`extra metadata JSON`。

## 14. sample_body 白名单

- 只保存 `RequestEventBody` 六字段：`method`（七值）、`url`（安全规范化 URL）、`startedAt`（请求真实开始时间）、`durationMs`、`outcome`（五值）、可选 `statusCode`；
- `parseRequestEventEnvelope` 成功结果已保证这些字段精确、有界；
- 不保存 `protocolVersion`/`eventId`/`eventType`/`occurredAt` 信封字段（作为独立列保存的部分除外）；
- 不保存请求体、响应体、Header、Cookie、Authorization、敏感查询、完整 URL、DOM/文本、IP、指纹。

## 15. 时间语义

- `occurred_at` 使用信封 `occurredAt`（事件产生时间，由 `parseEventEnvelope` 校验）；
- `sample_body.startedAt`（请求真实开始时间）作为契约字段保存在 jsonb 中，不单独建列；
- `created_at` 使用 PostgreSQL `now()`；
- 不使用调用方传入 createdAt；
- 不使用数据库时间替换 occurredAt；
- 不使用 Worker 主机时间作为持久化时间；
- Date/时间字符串按现有协议解析和验证。

## 16. 幂等

- 数据库建立 `(project_id, event_id)` 唯一约束；
- 使用 `ON CONFLICT DO NOTHING`（或等价可证明安全的 PostgreSQL 语义）；
- 首次写入 → `inserted`；
- 同一 projectId/eventId 再次写入 → `duplicate`；
- duplicate 不更新原样本；
- duplicate 不增加第二条记录；
- duplicate 不覆盖原正文；
- duplicate 不暴露 PostgreSQL constraint 或 SQLSTATE。

不得通过"先查询再插入"作为唯一幂等机制。

## 17. duplicate

- `duplicate` 是稳定公共结果，不携带数据库错误信息；
- 不与 `inserted` 混淆；
- 不把 SQLSTATE、约束名或 SQL 文本暴露给调用方。

## 18. 数据库事务

- `persistRequestEventSample` 在一个 PostgreSQL 事务内完成（从 Pool 获取同一 client 显式 BEGIN/COMMIT/ROLLBACK）；
- 成功时 COMMIT 后才返回 `inserted`；回滚/连接中断不产生 inserted 记录；
- 任一失败整体回滚；
- client 在 finally 中释放。

## 19. 稳定结果

`PersistRequestEventSampleResult` 是显式可判别联合类型：

- `inserted`：成功，含 `sampleId`（内部主键）；
- `duplicate`：同一 `(projectId, eventId)` 已存在，幂等结果；
- `invalid_input`：顶层输入、projectId 或 Request 事件信封解析失败，含稳定 `code`（不回显输入值）；
- `temporarily_unavailable`：数据库暂时失败（连接失败/语句失败），不泄露数据库细节。

## 20. 错误映射

- 数据库错误映射为稳定内部错误：连接失败（`ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND`）→ `temporarily_unavailable`；语句失败 → `temporarily_unavailable`；
- 不暴露 SQLSTATE、约束名、表名、SQL 文本或完整数据库 URL；
- 内部验证错误（`invalid_input`）不在正常控制流抛出。

## 21. 公共 API

包根导出最小公共能力：

- `persistRequestEventSample`（函数）；
- `PersistRequestEventSampleInput`、`PersistRequestEventSampleResult`（类型）。

禁止导出：私有字段解析器、SQL、查询 Repository、通用事件存储框架、测试专用查询、样本类别判断。

## 22. 隐私与敏感信息

- 不记录请求体、响应体、请求头、响应头、Cookie、Authorization、原始敏感查询参数值、未经规范化的完整敏感 URL、表单、页面 DOM/文本、完整 IP、设备/浏览器指纹；
- `sample_body` 只保存协议规范化安全投影（六字段白名单）；
- 解析失败 issue 不回显输入值；
- 包根不写日志；
- 样本为项目作用域业务事实，不含 user_id/session_id 等直接身份字段（落实 A5 匿名化语义）。

## 23. 数据保留边界

- 本轮不冻结新的保留天数；
- 安全样本的默认完整详情保留边界遵守当前批准的数据生命周期规则；
- 不自动删除；
- 不创建定时清理任务；
- 不声称永久保留；
- 不复用 Inbox 35 天备份淘汰语义冒充在线数据保留规则。

## 24. Migration

新增追加 Migration（不编辑任何既有 Migration，不修改 `error_event_occurrences`/`event_inbox`）：

- 创建 `request_event_samples` 表（列与约束见第 12—15 节）；
- `id` bigserial 主键；
- `project_id` uuid（与 event_inbox 一致）；
- `event_id` varchar(128)（与 event-schema/Inbox 一致）；
- `protocol_version` integer；
- `occurred_at` timestamptz；
- `sample_body` jsonb + CHECK（`jsonb_typeof = 'object'`）；
- `created_at` timestamptz default `now()`；
- `unique(project_id, event_id)`；
- 必要的 created_at/project_id 查询基础索引仅在有当前查询依据时创建（第一增量不创建无依据索引）。

不得添加：GIN、全文索引、trigram、分区、TTL、自动清理触发器、fingerprint 索引、Issue 外键。

Migration 必须：可 up；可 down；up/down/up 测试；不在应用启动时自动运行；使用真实 PostgreSQL 17；隔离 Schema；完整清理（`beforeAll` 同步 DROP `request_event_samples`）。

## 25. 回滚

- Migration 发布前缺陷：可直接修改未发布 Migration；
- Migration 发布后：向前修复与 expand/contract；destructive down 不作为生产默认回滚；
- Repository 实现与 Worker 主循环/Error store 解耦，可替换而不影响既有公共接口。

## 26. 单元测试

至少覆盖：

- 非对象 input；
- projectId 缺失/类型错误；
- envelope 缺失；
- 非 Request 事件（error/performance/resource/未知）；
- 不支持的 protocolVersion；
- 请求正文非法（非法方法/URL/时间戳/超长）；
- 缺失必填字段；
- 合法 Request 事件（五类 outcome 枚举 + 各 HTTP 方法）；
- 输入不变；
- 稳定结果；
- 不泄露 event-schema 内部异常；
- 不使用 `any`；
- 不使用 `console`；
- 不访问 `process.env`。

## 27. 真实 PostgreSQL 集成测试

必须使用真实 PostgreSQL 17 验证（`AURORA_TEST_DATABASE_URL`；测试确认目标是测试数据库；隔离/清理）：

- 合法 Request 事件样本写入（inserted）；
- duplicate 幂等（零新增、不覆盖）；
- 并发相同事件最多一行；
- 非 Request 事件不写入；
- 非法输入不写入；
- 数据库暂时不可用 → `temporarily_unavailable`；
- `protocolVersion`/`occurredAt` 正确；
- `createdAt` 来自数据库；
- `sampleBody` 与解析结果一致；
- 不存完整 Envelope/请求体/Header/凭证；
- Migration up/down/up；
- Schema 清理；
- Pool 清理；
- **error_event_occurrences 回归**（Error store 行为不变）。

## 28. 协议漂移测试

必须证明：

- `request_event_samples.sample_body` 白名单来自 `@aurora/event-schema` 根入口 `RequestEventBody` 字段；
- 不复制独立枚举；
- event-schema 请求契约入口变更会导致测试明确失败。

## 29. 包入口

- 包根导出最小公共能力（第 21 节）；
- 私有路径拒绝测试：`@aurora/processing-store/request-sample-repository` 等私有路径以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝；
- 只从 `@aurora/event-schema` 包根导入（`parseRequestEventEnvelope`、`EventType`、`RequestEventEnvelope` 类型）；
- 不访问 `@aurora/event-schema/src`/`internal`；
- `aurora.layer: data`（Workspace Policy 允许 `data → {protocol}`）。

## 30. 后续 Request Processor 衔接

- 未来 Request Processor 通过 `persistRequestEventSample` 包根写样本；
- 样本类别判断由未来样本选择策略执行器负责，本模块不判断；
- 本轮不把请求样本存储接入 Worker；
- `apps/ingestion-worker` 的 `package.json` 不新增 `@aurora/processing-store` 相关依赖（已有该依赖用于 Error processor，不额外接入请求样本到生产）。

## 31. 后续聚合/查询衔接

- Request Metric Store、时间桶聚合、查询、分页、过滤为后续独立模块；
- 本模块不导出查询 Repository；
- 测试使用私有 SQL 验证落库，但不得为了测试导出通用查询 Repository；
- 不允许从有限样本反推完整指标（ADR-019）。

## 32. 排除范围

- Request Metric Store、聚合、时间桶、样本选择策略执行器、Request Processor；
- Performance Store、Performance Processor、路由、production composition root；
- Issue 分组、fingerprint、Source Map、查询、搜索、告警；
- 数据保留任务；
- 修改 request-event-contract、ingestion-api、POST /v1/batches、Worker、Error store、Error processor、retry/backoff/replay；
- CI、RDS、IaC、容量基准。

## 33. 覆盖率与质量门禁

- `@aurora/processing-store` 维持 TypeScript strict；
- 覆盖率不低于 lines 85%、branches 80%、functions 85%、statements 85%；
- 单元测试 + 真实 PostgreSQL 17 集成测试 + 协议漂移测试 + 包入口/私有路径负例；
- 安全负例：src 不含请求体/Header/Cookie/Authorization/数据库 URL/`console`/`process.env`/`Math.random`；
- 回归：event-schema、Error store、ingestion-worker、ingestion-api 全部测试通过；OpenAPI 无变化；benchmark smoke 通过；
- 全仓门禁：`pnpm install --frozen-lockfile`、`format:check`、`lint`、`typecheck`、`test`、`test:coverage`、`check:boundaries`、`build`、`check:ci`、`git diff --check`。

## 34. 规格自检

- **权威一致性**：请求样本字段完全来自 event-schema 请求契约；不创建第二套 Schema；不改变 Inbox/Worker/Error store/Error processor/retry/replay/OpenAPI；不创建 Issue/fingerprint；不实现聚合或样本选择；不决定请求指标桶模型；
- **兼容性**：新文件只通过 event-schema 包根依赖；无循环依赖；无私有深导入；Migration 为追加式；已完成模块回归通过；Worker 未接入请求样本；未来 Request Processor 可以通过包根使用；
- **计划质量**：规格每项要求都有 Task；表名、列名、类型、常量和结果全文一致；每个 Task 有真实 TDD；无占位；无第二模块；零上下文实施者可直接执行；
- **安全和数据**：不存请求/响应体、Header、Cookie、Authorization、敏感查询、完整 URL、DOM/文本、IP、指纹；不存完整 Envelope；不存未批准字段；SQL 全参数化；不暴露数据库错误；测试 Schema 隔离并清理；无自动保留或删除规则；
- **范围控制**：只实现请求样本存储能力；不实现聚合/样本选择/Request Processor/路由；production composition root 不接入；不扩大到 Performance。

自动审批依据：本文全部语义由 accepted ADR-004/005/006/008/010/012/018/019、approved 请求事件协议契约、PRD 5.1.2/5.1.3/5.1.5/5.1.6、RULE-REQUEST-PERSISTENCE-20260803-002 与既有 Error store 规格无歧义派生；无新增产品/架构/安全/隐私决策（样本类别判断由未来策略执行器负责，不在本模块内决策）；用户已预先批准 ADR-019 方案 B 与产品决定；三域独立评审通过；自检全部通过。
