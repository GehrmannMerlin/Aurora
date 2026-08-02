---
title: ADR-009：数据接入公开传输与客户端上报密钥安全语义
status: accepted
implementation-status: in-progress
approval-status: approved
owner: ingestion/security
date: 2026-08-01
last-reviewed: 2026-08-01
applies-to: 数据接入公开 HTTP 传输、客户端上报密钥物理格式与传递位置、来源匹配与环境标识、HTTP 状态码映射、CORS 边界和请求限制来源
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora ADR 规范.md'
  - ../../docs/security/ingestion-transport-and-client-credential.md
  - ../../docs/protocol/ingestion-batch-and-receipt-contract.md
  - ../../docs/architecture/deployment.md
  - ../../docs/architecture/system-overview.md
  - ../../docs/architecture/formalization-readiness.md
  - ADR-002-five-system-boundaries.md
  - ADR-004-asynchronous-event-processing.md
  - ADR-005-event-schema-source-of-truth.md
  - ADR-008-ingestion-durable-buffering.md
supersedes: none
superseded-by: none
---

# ADR-009：数据接入公开传输与客户端上报密钥安全语义

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：in-progress
- 审批状态：approved
- 日期：2026-08-01
- Owner：ingestion/security
- 适用范围：数据接入公开 HTTP 传输、客户端上报密钥物理格式与传递位置、来源匹配与环境标识、HTTP 状态码映射、CORS 边界和请求限制来源
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 5、6、7 章
- 关联决策包：[数据接入传输与客户端上报密钥安全决策包](../security/ingestion-transport-and-client-credential.md)
- 关联协议：[数据接入批次与接收结果协议](../protocol/ingestion-batch-and-receipt-contract.md)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-01 由用户批准（`decision-status: accepted`、`approval-status: approved`），实施状态保持 `not-started`。批准授权数据接入公开传输与客户端上报密钥安全语义的最终决定；批准不代表 OpenAPI、SDK transport、密钥数据库、接入服务、Inbox 或 CORS 中间件已经实现。

## 背景

Aurora 已接受 ADR-002（五大系统边界）、ADR-004（可靠接收与异步处理）、ADR-005（event-schema 单一来源）和 ADR-008（数据接入可靠缓冲 = PostgreSQL 事务性 Inbox）。`@aurora/event-schema` 数据接入批次与接收结果协议第一增量已实施：批次请求正文、请求级/逐事件接收结果、稳定状态枚举（`accepted`/`duplicate_accepted`/`permanently_rejected`/`temporarily_failed`）、稳定错误码和 `retryable`/`retryAfterMs` 语义已机器冻结。

批次/接收结果协议**明确排除**：HTTP Header 名称、HTTPS 路径、HTTP 状态码映射、OpenAPI security scheme、客户端上报密钥物理格式、来源匹配规范、环境标识（协议 §2.2、§18；ADR-008 Deferred decisions；六专题总结 §5.4 未确认清单）。部署与测试/部署/发布设计只确认"数据接入使用独立公开主机和客户端上报密钥认证，不共享浏览器 Session"（deployment.md §3、TDR §19 行 119），未定义路径、版本、凭证传递、Header 或 CORS。

数据接入 OpenAPI（后续依赖链第 2 项）必须引用或映射已批准的批次/接收结果协议，不得成为第二套批次 Schema 权威来源；而 OpenAPI 需要把协议语义投影到 HTTP 传输，这要求先决策公开路径、版本、凭证方案、来源/环境、状态码映射和 CORS。这些语义全部属于公共 API 与安全/隐私原则，按 ADR 规范 7.2 属高迁移成本决策。本 ADR 于 2026-08-01 由用户直接审批批准。

## 决策驱动因素

- **浏览器可见凭证威胁模型**：客户端上报密钥可放前端代码（PRD 5.3），泄露风险靠能力边界而非保密控制；但它绝不能授权数据读取、管理或 Source Map 访问；
- **公开路径与版本稳定**：SDK 与接入服务长期依赖路径、API 主版本和兼容期限，改变成本高；
- **不共享浏览器 Session**：数据接入独立主机 + 独立凭证，与管理平台 Session 完全隔离（TDR、deployment）；
- **凭证不入 URL/日志**：Query 传参会泄露给代理、日志、Referer、CDN、浏览器历史，禁止；
- **来源匹配是防误用而非强边界**：Origin 可被非浏览器伪造，须返回稳定错误但不宣称强认证；
- **环境标识一致**：SDK `environment`、C15 环境目录、逐密钥允许环境与服务端接收校验必须同源；
- **HTTP 状态不引入第二套错误码**：`IngestionErrorCode` 与接收状态枚举是唯一机器来源，HTTP 只作传输投影；
- **OpenAPI 工具链就绪**：创建机器 OpenAPI 前必须先引入并纳入质量门禁。

## 现有约束

- ADR-002：数据接入只做鉴权、限制、校验、过滤和可靠接收；五个逻辑系统不等于五个部署单元，但代码边界不能合并；
- ADR-004：已接收只表示可靠缓冲；一批单条失败不整批回滚；SDK 不重试永久拒绝；重试、退避、死信有上限；不静默丢失；
- ADR-005：所有外部输入视为不可信并运行时校验；事件类型、限制、版本、运行时 Schema 唯一来源是 `event-schema`；
- ADR-008：`event_inbox` 事务提交成功 = "已可靠接收"；数据接入 OpenAPI 为后续依赖链第 2 项；客户端上报密钥物理格式、来源匹配规范、环境标识是本 ADR 决策范围；
- 批次/接收结果协议：批次请求、请求级/逐事件接收结果、状态枚举、稳定错误码、`retryable`/`retryAfterMs` 已机器冻结；明确排除 HTTP 路径/Header/状态码/security scheme；
- 部署/测试部署发布设计：数据接入独立公开主机 + 客户端上报密钥，不共享浏览器 Session；
- 管理平台 `/api/platform/v1` 仅适用于浏览器公开 API，不适用于数据接入。

## 最终决策

### 4.1 公开主机、路径和版本

- 数据接入使用独立公开主机；
- 主机名由部署环境配置，不写死在 OpenAPI `servers` 中；
- 第一版稳定端点为：`POST /v1/batches`；
- 不使用管理平台 `/api/platform/v1`；
- API 主版本与事件 `protocolVersion` 是两个独立的兼容维度；
- API v1 第一增量只接受当前支持的事件协议版本 1；
- 未来事件协议升级不要求同步提升 HTTP API 主版本；
- 请求和响应只使用 `application/json`；
- 第一版不承诺请求压缩格式，压缩支持保持 deferred。

### 4.2 客户端上报密钥

- OpenAPI security scheme 使用 `apiKey`；
- 传递位置为 Header；
- Header 名固定为 `X-Aurora-Client-Key`；
- 禁止通过 Query、URL、Cookie 或请求正文传递；
- 与管理平台 Session、Bearer Token 和用户身份认证完全隔离；
- 密钥只授予数据上报能力，不授予读取、查询、管理、Source Map 或平台访问能力。

密钥物理格式冻结为 `aurora_ingest_<keyId>_<secret>`：

- `keyId` 是非敏感记录标识；
- `secret` 是高熵不透明值；
- OpenAPI 只把完整值视为 opaque string，不解析组成部分；
- 完整密钥只在创建或轮换成功时显示一次；
- 后续不可重新显示原 secret；
- 服务端保存 keyId、单向校验摘要和策略元数据；
- 用户需要新值时执行轮换或重置；
- 禁止保留"仅存摘要但可以随时重显"的矛盾表述；
- 精确随机位数和摘要算法由后续凭证数据模型与安全实现规格冻结，不属于 OpenAPI。

密钥状态语义：

- disabled、revoked、expired 或轮换后的旧密钥立即失效；
- 无效或缺失密钥返回认证失败；
- 客户端不得自动把认证失败当成临时故障重试。

### 4.3 环境标识

- 环境通过 Header 传递；
- Header 名固定为 `X-Aurora-Environment`；
- Header 必填；
- 值是项目环境目录中的稳定环境标识；
- 密钥可以限制允许的环境集合；
- 请求环境不在密钥允许集合时永久拒绝；
- 环境不授予额外权限，只用于数据分域、策略校验和诊断；
- 不把 environment 加入每个 EventEnvelope；
- OpenAPI 中使用 string 表达，不自行发明新的环境枚举；
- 精确环境名称集合由项目配置决定。

### 4.4 来源匹配与非浏览器客户端

- 浏览器请求使用 `Origin` 作为来源匹配输入；
- 不使用 `Referer` 作为认证或安全回退；
- Referer 最多可用于不含路径和查询信息的有界诊断，但第一增量默认不采集；
- Origin 必须与项目 allowlist 做完整 origin 精确匹配；
- 禁止 `*`；
- 来源匹配是防误用和额度滥用保护，不宣称是强认证边界。

Origin 缺失时：

- 默认拒绝；
- 只有客户端密钥策略明确设置 `allowNonBrowser=true` 时才允许；
- 非浏览器客户端仍必须提供有效密钥和环境 Header；
- `allowNonBrowser` 默认 false；
- 本轮只冻结语义，不实现密钥策略数据库。

来源不允许或非浏览器策略不允许：

- 返回永久拒绝；
- `retryable: false`。

### 4.5 CORS

- CORS 只允许项目 allowlist 中的精确 Origin；
- 不允许 `Access-Control-Allow-Origin: *`；
- 成功时回显经过校验的单一 Origin；
- 返回 `Vary: Origin`；
- 不启用 Cookie 或浏览器凭证模式；
- 不返回 `Access-Control-Allow-Credentials: true`；
- 允许方法：`POST`、`OPTIONS`；
- 允许请求 Header：`Content-Type`、`X-Aurora-Client-Key`、`X-Aurora-Environment`；
- 暴露响应 Header：`X-Aurora-Request-Id`、`Retry-After`。

预检请求：

- 不要求发送真实客户端密钥；
- 只校验 Origin、请求方法和请求 Header；
- 预检成功不代表实际 POST 已通过认证；
- CORS 中间件实现不属于本 ADR 范围（本轮不实现）。

### 4.6 HTTP 状态码映射

**200 OK**：只要满足以下条件，就返回 200 和完整请求级 receipt：

- JSON 可解析；
- 批次结构可解析；
- 密钥、来源和环境通过请求级校验；
- 服务已对每个事件形成明确 receipt。

以下情况仍返回 200：

- 全部 accepted；
- accepted 与 rejected 混合；
- 全部 permanently_rejected；
- duplicate_accepted；
- 部分 temporarily_failed。

逐事件语义必须以 `perEventResults` 为准，HTTP 200 不代表每条事件均成功。

**400 Bad Request**：

- malformed JSON；
- 无法解析的批次结构；
- 缺少批次必填字段；
- 无法建立逐事件结果的请求级永久错误。

**401 Unauthorized**：

- 缺少客户端上报密钥；
- 密钥格式非法；
- 密钥不存在；
- 密钥 disabled、revoked、expired；
- 轮换后的旧密钥。

**403 Forbidden**：

- Origin 不允许；
- 缺失 Origin 且密钥未允许非浏览器客户端；
- environment 不允许；
- 项目或密钥策略永久禁止该请求。

**413 Payload Too Large**：

- 请求体超过服务端保护阈值。
- 本轮不冻结具体字节数：`BATCH_EVENT_LIMITS.maxEventsPerBatch` 仍是批次数量唯一机器限制；请求字节上限保持 `requires-benchmark`；OpenAPI 记录可能返回 413，但不声明虚假的精确大小。

**415 Unsupported Media Type**：

- Content-Type 不是 `application/json`。

**429 Too Many Requests**：

- 请求级限流或容量保护；
- `retryable: true`；
- 可以提供 `Retry-After`；
- 不得返回任何已可靠接收的假结果。

**503 Service Unavailable**：

- PostgreSQL/Inbox 暂时不可用；
- 服务进入容量保护；
- 无法完成 ADR-008 的可靠持久化边界。
- 不得把 503 映射为 accepted。

**500 Internal Server Error**：

- 只用于未分类的内部错误；
- 不泄露内部服务、SQL、约束名或堆栈；
- 默认视为可重试；
- 若已经可以明确映射为 503，则优先使用 503。

### 4.7 Retry-After

- HTTP 使用标准 `Retry-After` Header；
- 第一版只使用整数秒形式，不使用 HTTP-date；
- 由 body 中 `retryAfterMs` 向上取整转换为秒；
- 只允许出现在 retryable 请求级响应；
- 主要用于 429 和 503；
- body 中继续保留机器协议定义的 `retryAfterMs`；
- Header 与 body 不一致时视为契约测试失败。

### 4.8 请求 ID

- 每个 HTTP 请求均生成服务端请求 ID；
- 响应 Header 固定为 `X-Aurora-Request-Id`；
- 请求 ID 用于日志、诊断和支持关联；
- 不等同于 eventId；
- 不由客户端控制；
- 不包含项目、用户、来源或时间等可推断信息；
- OpenAPI 将其声明为 opaque string；
- 精确生成算法由接入服务实现规格冻结。

### 4.9 OpenAPI 版本和工具链

- 使用 OpenAPI `3.1.0`；
- 机器文件唯一位置：`docs/api/ingestion.openapi.yaml`；
- 人类说明文件：`docs/api/ingestion-openapi.md`；
- OpenAPI 是 HTTP 投影，`@aurora/event-schema` 仍是批次和 receipt 唯一语义来源；
- 不允许再创建第二份 ingestion OpenAPI YAML/JSON；
- OpenAPI 工具只作为 devDependency，不进入生产运行时；
- 选择并固定一个维护中的 OpenAPI 3.1 解析/校验工具，可以验证 3.1、解析 `$ref`、运行 lint 并适合纳入 `check:ci`；
- 不同时引入多套重复工具；
- 具体版本在实施时根据当前 registry 和现有 Node 版本验证并锁定。

## 结果与影响

### 正面影响

- 为数据接入 OpenAPI 提供干净、稳定的公开传输投影；
- 凭证边界清楚，浏览器可见凭证不会意外获得读取能力；
- 与管理平台 Session/`/api/platform/v1` 完全隔离；
- 状态/错误码唯一来源保持，HTTP 只是传输层；
- API 主版本与 protocolVersion 解耦，事件协议升级不阻塞 HTTP 接口。

### 负面影响与代价

- 自定义 Header 与 `apiKey` scheme 需要 SDK transport、接入服务与 OpenAPI 三处一致维护；
- 来源匹配不能阻止非浏览器伪造，安全边界有限；
- OpenAPI 工具链引入增加工程面；
- 主机名仍由部署配置，不写死；请求字节上限需 `requires-benchmark`。

### 未解决问题

- 精确主机名（`deferred`，部署配置）；
- 请求级字节上限与超时数值（`requires-benchmark`）；
- 精确凭证随机位数和摘要算法（后续凭证数据模型与安全实现规格）；
- request ID 精确生成算法（接入服务实现规格）；
- OpenAPI 解析/校验工具具体版本（实施时验证并锁定）。

## 实施约束

- OpenAPI 只投影批次/接收结果协议，不重新定义状态、错误码或字段限制；
- "已可靠接收"严格对应 ADR-008 Inbox 事务提交成功；
- 凭证不出现在 Query、日志、审计、错误响应或普通缓存；
- 数据接入与管理平台 Session、`/api/platform/v1` 隔离；
- 来源不允许返回稳定错误（403 永久拒绝，`retryable: false`）；环境标识与 SDK/C15/逐密钥一致；
- OpenAPI Schema 与 event-schema 漂移必须有自动测试。

## 迁移方案

ADR accepted 后：引入 OpenAPI 工具链 → 生成数据接入 OpenAPI 正式规格 → writing-plans → 实施机器契约与漂移测试。本 ADR 批准即授权本轮实施数据接入 OpenAPI 机器契约第一增量；接入服务、Inbox、Worker、SDK transport 仍由各自模块推进。

## 回滚方案

若传输语义在 OpenAPI/接入实现中发现缺陷，可先停止接受新路径、保留既有解析器，再修订本 ADR 追加记录或新建 ADR；不得通过返回成功后丢弃数据降级。

## 验证方式

- OpenAPI 文档可解析、`$ref` 完整、operationId 唯一、Schema 名称稳定；
- event-schema 漂移测试覆盖合法/非法/边界样本与全部状态/错误码；
- 敏感信息扫描确认凭证不泄漏；
- 工具链纳入 `check:ci`。

## 重新评估条件

- 凭证泄露路径出现新的浏览器威胁；
- 非浏览器客户端占比需要改变来源匹配策略；
- 主机/路径/网关要求调整版本表达；
- OpenAPI 工具链不可用或产生第二套权威来源。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-01：创建（proposed）

- 状态 `proposed / not-started / awaiting-user-approval`；
- 由 2026-08-01 联合模式前置门禁创建，配套[决策包](../security/ingestion-transport-and-client-credential.md)承载详细候选与威胁模型；
- 门禁确认全部关键公开/安全语义缺失 approved 来源：路径、API 版本、凭证物理格式与传递位置、来源匹配、环境标识、HTTP 状态映射、CORS、request ID；
- 未创建 OpenAPI 文件、未运行 writing-plans、未实施代码；
- 等待用户审批，不自动批准、不实施。

### 2026-08-01：用户批准与最终决定

- 决策状态更新为 `accepted`，实施状态保持 `not-started`，审批状态 `approved`；
- 用户批准方案 A（独立版本化路径 + 自定义 Header 凭证），批准内容以用户 2026-08-01 消息的精确决定为准；
- 最终决定：`POST /v1/batches`、API v1 与 protocolVersion 独立、`application/json`、`apiKey` security scheme、`X-Aurora-Client-Key`、`X-Aurora-Environment`、Origin 匹配（缺失默认拒绝 + `allowNonBrowser`）、CORS 边界、完整 HTTP 状态映射（200/400/401/403/413/415/429/500/503）、`Retry-After` 整数秒、`X-Aurora-Request-Id`、OpenAPI 3.1.0、密钥格式 `aurora_ingest_<keyId>_<secret>` 仅显示一次；
- 主机名由部署配置，不写死；请求字节上限保持 `requires-benchmark`；
- 本次批准不代表 OpenAPI、SDK transport、密钥数据库、接入服务、Inbox 或 CORS 中间件已经实现。

### 2026-08-01：数据接入 OpenAPI 机器契约第一增量实施证据

- 实施状态更新为 `in-progress`：数据接入 OpenAPI 公开机器契约第一增量已实施，凭证、接入服务与 CORS 中间件仍未实现；
- 实施范围：`docs/api/ingestion.openapi.yaml`（OpenAPI 3.1.0，唯一机器文件）、`docs/api/ingestion-openapi.md`（正式规格，approved）、`.redocly.yaml`（lint 配置）、新 tooling 包 `tooling/ingestion-openapi-contract`（event-schema 漂移门禁）；
- 公开契约：`POST /v1/batches`、operationId `ingestionSubmitBatch`、`apiKey` security scheme `ClientIngestionKey`（`in: header`，Header `X-Aurora-Client-Key`）、Header `X-Aurora-Environment`（必填）、请求/响应 `application/json`、不设置 `servers`（主机由部署配置）；
- 响应映射：200/400/401/403/413/415/429/500/503；`Retry-After` 整数秒仅出现在 429/503；`X-Aurora-Request-Id` 全响应；200/429/503 用 `IngestionRequestReceipt`，请求前错误用 `ErrorResponse`；
- Schema 全部映射 `@aurora/event-schema`：`IngestionBatchRequest`、`EventEnvelope`、`EventType`、`IngestionRequestReceipt`、`IngestionEventReceipt`、`IngestionReceiptState`、`IngestionErrorCode`、`ErrorResponse`；枚举/required/限制/样本/`retryable`/`retryAfterMs` 由 `tooling/ingestion-openapi-contract` 40 个漂移测试自动比对；
- 工具链：`@redocly/cli` 2.43.1（`redocly lint` 验证 3.1、解析 `$ref`、lint）与 `yaml` 2.9.0，均为根 devDependency，不进入生产运行时；
- 验证命令：`pnpm openapi:lint`、`pnpm --filter @aurora/ingestion-openapi-contract test/typecheck/build`、`pnpm check:boundaries`、`pnpm lint` 全部 exit 0；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：Fastify 路由、接入服务、密钥数据库/生成/轮换、CORS 中间件、Inbox 数据模型、Migration、SDK transport、Worker。
