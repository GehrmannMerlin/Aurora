---
title: 数据接入传输与客户端上报密钥安全决策包
status: approved
approval-status: approved
implementation-status: in-progress
owner: ingestion/security
created: 2026-08-01
last-reviewed: 2026-08-01
applies-to: 数据接入 OpenAPI 机器契约、SDK transport、数据接入服务同步接收路径、客户端上报密钥物理格式与传递语义
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - '../../Aurora 架构规范.md'
  - '../../Aurora 安全规范.md'
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../adr/ADR-004-asynchronous-event-processing.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../protocol/ingestion-batch-and-receipt-contract.md
  - ../architecture/deployment.md
  - ../architecture/platform-backend.md
  - ../architecture/formalization-readiness.md
  - ../superpowers/specs/2026-07-29-aurora-topic-discussion-summary.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
supersedes: none
superseded-by: none
---

# 数据接入传输与客户端上报密钥安全决策包

## 1. 状态与效力

- 决策状态：`approved`
- 实施状态：`in-progress`
- 审批状态：`approved`

本文是**数据接入 OpenAPI 机器契约第一增量（ADR-008 后续依赖链第 2 项）的前置决策包**。2026-08-01 用户批准 [ADR-009](../adr/ADR-009-ingestion-transport-and-client-credential.md) 的最终决定，本文由 `proposed / awaiting-user-approval` 更新为 `approved / approved`，作为最终决定的详细威胁模型和影响分析来源。

本文不修改任何 ADR 的决策结论。最终决定以 ADR-009 为准；本文登记门禁证据、安全威胁和影响分析，供后续 SDK transport、接入服务和凭证实现参考。

## 2. 为什么需要先决策：门禁证据

以下缺口曾因缺失 approved 来源而阻塞 OpenAPI 设计。2026-08-01 用户批准 ADR-009 后，这些语义已全部形成最终决定（见 ADR-009）：

| 缺口           | 已 approved 的内容                                                                                                                                                                   | 缺失的公开/安全语义                                                                                                                                         | 来源                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 传输入口       | 数据接入使用**独立公开主机**和客户端上报密钥，不共享浏览器 Session                                                                                                                   | HTTP 路径、方法、API 主版本表达、请求/响应 Content-Type、是否允许压缩、编码格式                                                                             | TDR §19 行 119、deployment.md §3；六专题总结 §5.4"正式 HTTPS 接收路径…API 主版本…兼容期限"未确认；批次/接收结果协议 §18 明确排除 HTTPS 路径与 Header                                                                                                                                            |
| 客户端身份     | 客户端上报密钥可公开放入前端、只能上报、不能读数据、可多密钥/轮换/启停/失效、与私密管理令牌彻底分离                                                                                  | 密钥物理格式与摘要、传递位置（Header 名？）、安全方案类型（apiKey？）、是否允许 Query、项目↔密钥绑定、失效/禁用/轮换后行为、是否与管理平台 Session 完全隔离 | PRD 5.3；平台后端 design C14；六专题 §5.4"客户端密钥物理格式/摘要…未确认"；ADR-008 Deferred"客户端上报密钥物理格式…独立决策"；formalization-readiness 缺口 #11"客户端上报密钥的交付/重显/轮换语义 security contract missing"；总体 OpenAPI 设计 §381"客户端上报密钥的交付/重显仍需独立安全契约" |
| 来源匹配       | 允许来源域名 allowlist；来源不允许→永久拒绝；不自动放行候选来源；`allowedRequestOrigins` 只接受完整来源、禁止 `*`、页面当前来源默认允许                                              | 来源匹配的输入（HTTP Header？）、Origin 缺失时行为、非浏览器客户端是否允许、对应稳定接收错误码、CORS 允许来源与失败边界                                     | PRD 7.2、5.3、6.2；六专题 §5.4"来源匹配规范…未确认"                                                                                                                                                                                                                                             |
| 环境标识       | `environment` 是 SDK 配置字段；环境校验"运行环境不允许→永久拒绝"；C15 环境是稳定项目维度                                                                                             | 环境标识来自请求、事件还是服务端配置；Header 或正文字段名；与逐密钥允许环境的映射                                                                           | PRD 5.2/7.2、SDK 配置；六专题 §5.4"环境标识…未确认"                                                                                                                                                                                                                                             |
| HTTP 状态映射  | 稳定错误码与接收状态枚举已机器冻结（`accepted`/`duplicate_accepted`/`permanently_rejected`/`temporarily_failed`，13 个 `IngestionErrorCode`）；`retryable`/`retryAfterMs` 语义已冻结 | HTTP 状态码业务含义、部分成功状态、malformed JSON、超限、限流、服务不可用、Retry-After 表达、request ID/trace ID                                            | 批次/接收结果协议 §4.4、§18"HTTP 状态码映射、OpenAPI security scheme"明确排除；六专题 §5.4 未确认                                                                                                                                                                                               |
| 请求限制       | `BATCH_EVENT_LIMITS.maxEventsPerBatch = 50`、`maxEventIdLength`、`maxErrorCodeLength`、`maxRetryAfterMs` 已机器冻结                                                                  | 请求级大小上限、超时、是否引用 event-schema 常量或另建数值                                                                                                  | 批次/接收结果协议 §4.1（明确"请求大小"未定义）                                                                                                                                                                                                                                                  |
| OpenAPI 工具链 | —                                                                                                                                                                                    | 仓库无任何 OpenAPI 解析/校验工具（根 package.json 无 redocly/swagger-parser/openapi-types 等）；`docs/api` 目录不存在；OpenAPI 版本（3.0/3.1）未选          | 根 package.json scripts；formalization-readiness §5 `docs/api/ingestion-openapi.*` `machine/blocked`"Schema 工具…阻塞"                                                                                                                                                                          |

## 3. 最终决定摘要

以下由用户于 2026-08-01 批准，完整决定以 [ADR-009](../adr/ADR-009-ingestion-transport-and-client-credential.md) 为准。

### 3.1 公开主机、路径和版本

- 独立公开主机；主机名由部署配置，不写死在 OpenAPI `servers` 中；
- 第一版稳定端点 `POST /v1/batches`；
- 不使用管理平台 `/api/platform/v1`；
- API 主版本与事件 `protocolVersion` 独立；API v1 第一增量只接受当前支持的事件协议版本 1；未来事件协议升级不要求同步提升 HTTP API 主版本；
- 请求和响应只使用 `application/json`；
- 第一版不承诺请求压缩格式（deferred）。

### 3.2 客户端凭证传递

- OpenAPI security scheme `apiKey`（`in: header`）；
- Header 名固定为 `X-Aurora-Client-Key`；
- 禁止 Query、URL、Cookie 或请求正文传递；
- 与管理平台 Session、Bearer Token 和用户身份认证完全隔离；
- 密钥只授予数据上报能力，不授予读取、查询、管理、Source Map 或平台访问能力。

密钥物理格式冻结为 `aurora_ingest_<keyId>_<secret>`：

- `keyId` 是非敏感记录标识；`secret` 是高熵不透明值；
- OpenAPI 只把完整值视为 opaque string，不解析组成部分；
- 完整密钥只在创建或轮换成功时显示一次；后续不可重新显示原 secret；
- 服务端保存 keyId、单向校验摘要和策略元数据；需要新值时执行轮换或重置；
- **禁止"仅存摘要但可以随时重显"的矛盾表述**；
- 精确随机位数和摘要算法由后续凭证数据模型与安全实现规格冻结，不属于 OpenAPI。

密钥状态语义：disabled、revoked、expired 或轮换后的旧密钥立即失效；无效或缺失密钥返回认证失败；客户端不得自动把认证失败当成临时故障重试。

### 3.3 来源匹配与环境标识

- 浏览器请求使用 `Origin` 作为来源匹配输入；不使用 `Referer` 作为认证或安全回退；Referer 最多可用于不含路径和查询信息的有界诊断，但第一增量默认不采集；
- Origin 必须与项目 allowlist 完整精确匹配；禁止 `*`；
- 来源匹配是防误用和额度滥用保护，不宣称是强认证边界；
- Origin 缺失默认拒绝；只有密钥策略 `allowNonBrowser=true` 时才允许；非浏览器客户端仍必须提供有效密钥和环境 Header；`allowNonBrowser` 默认 false；本轮只冻结语义，不实现密钥策略数据库；
- 来源不允许或非浏览器策略不允许 → 永久拒绝，`retryable: false`。

环境标识：

- Header 传递，Header 名固定为 `X-Aurora-Environment`；必填；
- 值是项目环境目录中的稳定环境标识；密钥可限制允许环境集合；请求环境不在允许集合时永久拒绝；
- 环境不授予额外权限，只用于数据分域、策略校验和诊断；
- 不把 environment 加入每个 EventEnvelope；OpenAPI 中用 string 表达，不发明新枚举；精确环境名称集合由项目配置决定。

### 3.4 CORS

- 只允许项目 allowlist 中的精确 Origin；不允许 `Access-Control-Allow-Origin: *`；
- 成功时回显经过校验的单一 Origin；返回 `Vary: Origin`；
- 不启用 Cookie 或浏览器凭证模式；不返回 `Access-Control-Allow-Credentials: true`；
- 允许方法 `POST`、`OPTIONS`；
- 允许请求 Header `Content-Type`、`X-Aurora-Client-Key`、`X-Aurora-Environment`；
- 暴露响应 Header `X-Aurora-Request-Id`、`Retry-After`；
- 预检不要求真实密钥，只校验 Origin、方法、Header；预检成功不代表实际 POST 已通过认证；
- CORS 中间件实现不属于本轮 OpenAPI 机器契约实现。

### 3.5 HTTP 状态映射

- `200`：JSON 可解析、批次结构可解析、请求级校验通过、每个事件有明确 receipt；全部 accepted / 混合 / 全部永久拒绝 / duplicate_accepted / 部分暂时失败均返回 200；逐事件语义以 `perEventResults` 为准；
- `400`：malformed JSON、无法解析的批次结构、缺少必填字段、无法建立逐事件结果的请求级永久错误；
- `401`：缺少密钥、密钥格式非法、密钥不存在、disabled/revoked/expired、轮换后旧密钥；
- `403`：Origin 不允许、缺失 Origin 且未允许非浏览器、environment 不允许、项目或密钥策略永久禁止；
- `413`：请求体超过服务端保护阈值；本轮不冻结字节数，`maxEventsPerBatch` 仍是唯一机器限制，字节上限 `requires-benchmark`；
- `415`：Content-Type 不是 `application/json`；
- `429`：请求级限流/容量保护；`retryable: true`，可提供 `Retry-After`；不得返回已可靠接收假结果；
- `503`：PostgreSQL/Inbox 暂时不可用、容量保护、无法完成可靠持久化边界；不得映射为 accepted；
- `500`：未分类内部错误；不泄露内部服务/SQL/约束名/堆栈；默认可重试；能明确映射 503 时优先 503。

### 3.6 Retry-After 与请求 ID

- `Retry-After`：标准 Header；第一版只使用整数秒，不用 HTTP-date；由 body `retryAfterMs` 向上取整转秒；只出现在 retryable 请求级响应（主要用于 429/503）；body 保留 `retryAfterMs`；Header 与 body 不一致视为契约测试失败。
- `X-Aurora-Request-Id`：每个 HTTP 请求生成服务端请求 ID；响应 Header 固定名；用于日志/诊断/支持关联；不等同于 eventId；不由客户端控制；不包含项目/用户/来源/时间等可推断信息；OpenAPI 声明为 opaque string；精确生成算法由接入服务实现规格冻结。

### 3.7 OpenAPI 版本和工具链

- OpenAPI `3.1.0`；机器文件唯一位置 `docs/api/ingestion.openapi.yaml`；人类说明文件 `docs/api/ingestion-openapi.md`；
- OpenAPI 是 HTTP 投影，`@aurora/event-schema` 仍是批次和 receipt 唯一语义来源；不允许第二份 ingestion OpenAPI YAML/JSON；
- OpenAPI 工具只作为 devDependency，不进入生产运行时；
- 选择并固定一个维护中的 OpenAPI 3.1 解析/校验工具（验证 3.1、解析 `$ref`、lint、纳入 `check:ci`）；不同时引入多套重复工具；具体版本在实施时根据当前 registry 和 Node 版本验证并锁定。

## 4. 安全威胁与浏览器暴露凭证风险

- **浏览器公开密钥**：客户端上报密钥可被任何加载页面的人读取，因此它**只能**授权上报与最小接收状态查询，绝不能读取项目数据（PRD 5.3）；泄露风险由能力边界而非保密性控制；
- **凭证入 URL**：Query 传参会把密钥泄露给代理、日志、Referer、CDN、浏览器历史——必须禁止（ADR-009 已定禁止）；
- **Header 注入/日志**：凭证 Header 不得进入日志、审计、错误响应或普通缓存；
- **来源伪造**：Origin 可由非浏览器客户端伪造，来源匹配是防误用而非强安全边界；但仍须对来源不允许返回稳定错误（403 永久拒绝）；
- **CSRF/CORS 组合**：浏览器 CORS 失败边界须与跨系统边界一致；不得让恶意页面借 SDK 通道滥用上报额度；
- **重放/轮换**：密钥可轮换；停用/重置后旧密钥立即失效（PRD 6.1、C14）；上报路径不得缓存旧凭证；
- **环境混淆**：环境标识不得由浏览器自由伪造进入生产数据处理（仅影响分域与诊断，不授予数据读取）。

## 5. 对 OpenAPI、SDK transport 与数据接入服务的影响

- **数据接入 OpenAPI**：直接采用 ADR-009 最终决定作为 HTTP 机器契约的投影输入；
- **SDK transport**：尚无 transport 模块；路径 `/v1/batches`、Header `X-Aurora-Client-Key`/`X-Aurora-Environment`、错误重试映射决定 SDK 队列/发送实现；
- **数据接入服务同步接收路径**（ADR-008 后续依赖链第 4 项）：路径、鉴权、来源/环境校验、状态码、Inbox 写入与逐事件返回均采用本包与 ADR-009 决定。

## 6. 审批记录

### 2026-08-01：创建

- 由 2026-08-01 联合模式前置门禁创建；门禁确认全部关键公开/安全语义缺失 approved 来源；
- 未创建 OpenAPI 文件、未运行 writing-plans、未实施代码；
- 状态保持 `proposed / not-started / awaiting-user-approval`；
- 配套 [ADR-009](../adr/ADR-009-ingestion-transport-and-client-credential.md)（proposed）承载高迁移成本决策候选。

### 2026-08-01：用户批准

- 用户批准 [ADR-009](../adr/ADR-009-ingestion-transport-and-client-credential.md) 的最终决定；
- 状态更新为 `approved / approved / not-started`；
- 本包第 3 节登记最终决定摘要；完整决定以 ADR-009 为准；
- 批准不代表 OpenAPI、SDK transport、密钥数据库、接入服务、Inbox 或 CORS 中间件已经实现。
