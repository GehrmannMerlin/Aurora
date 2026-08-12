---
title: Aurora ADR 索引
status: approved
owner: architecture
last-reviewed: 2026-07-30
applies-to: Aurora 全部重大技术决策
related:
  - ../../AURORA_RULES.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora ADR 规范.md'
  - ../README.md
  - ../architecture/formalization-readiness.md
  - ../architecture/system-overview.md
supersedes: none
maintenance: append-only
---

# Aurora ADR 索引

## 状态说明

本目录保存 Aurora 的架构决策记录。

只有状态为 accepted 的 ADR 才是正式决策。proposed ADR 只用于讨论和评审，不得约束正式实现。决策状态与实施状态分开管理，accepted 不代表 implemented。

ADR-001—ADR-006 从已批准架构规范中的 ARCH-001—ARCH-006 提取，ADR-007 只决定首个私有 Workspace 的包管理与任务入口。2026-07-29 已完成独立非作者和所需领域评审，七份决策均为 `accepted / not-started`；接受只授权决策，不表示代码、工具、Schema、CI、基础设施或测试证据已经存在。

## 当前 ADR

| 编号                                                                                  | 标题                                                   | 决策状态 | 实施状态    | 关联规则                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------- | ----------- | --------------------------------------------- |
| [ADR-001](ADR-001-use-monorepo.md)                                                    | 使用统一 Monorepo                                      | accepted | in-progress | ARCH-001                                      |
| [ADR-002](ADR-002-five-system-boundaries.md)                                          | 划分五大系统边界                                       | accepted | not-started | ARCH-002                                      |
| [ADR-003](ADR-003-sdk-plugin-architecture.md)                                         | SDK 分层插件架构                                       | accepted | in-progress | ARCH-003                                      |
| [ADR-004](ADR-004-asynchronous-event-processing.md)                                   | 可靠接收与异步处理                                     | accepted | not-started | ARCH-004                                      |
| [ADR-005](ADR-005-event-schema-source-of-truth.md)                                    | event-schema 单一来源                                  | accepted | in-progress | ARCH-005                                      |
| [ADR-006](ADR-006-one-way-dependencies.md)                                            | 单向依赖与自动约束                                     | accepted | in-progress | ARCH-006                                      |
| [ADR-007](ADR-007-workspace-package-and-task-tooling.md)                              | pnpm Workspace 与原生任务入口                          | accepted | implemented | 首模块工程工具                                |
| [ADR-008](ADR-008-ingestion-durable-buffering.md)                                     | 数据接入可靠缓冲与异步处理的物理技术                   | accepted | in-progress | 数据接入物理缓冲                              |
| [ADR-009](ADR-009-ingestion-transport-and-client-credential.md)                       | 数据接入公开传输与客户端上报密钥安全语义               | accepted | in-progress | 数据接入传输/凭证                             |
| [ADR-010](ADR-010-postgresql-access-and-migration-tooling.md)                         | 数据接入数据库访问与 Migration 工具链                  | accepted | implemented | 数据接入数据库工具                            |
| [ADR-011](ADR-011-ingestion-http-service-runtime.md)                                  | 数据接入同步 HTTP 服务的运行时与应用边界               | accepted | in-progress | 数据接入 HTTP 服务                            |
| [ADR-012](ADR-012-ingestion-worker-runtime.md)                                        | 数据接入 Worker 应用的运行时与应用边界                 | accepted | in-progress | 数据接入 Worker 运行时                        |
| [ADR-013](ADR-013-ingestion-client-credential-storage-and-verification.md)            | 客户端上报凭证存储与验证                               | accepted | implemented | 数据接入凭证存储/验证                         |
| [ADR-014](ADR-014-ingestion-client-credential-lifecycle.md)                           | 客户端上报凭证生命周期服务                             | accepted | implemented | 数据接入凭证生命周期                          |
| [ADR-015](ADR-015-ingestion-worker-retry-budget-policy.md)                            | Worker 重试预算与自动死信策略                          | accepted | implemented | Worker retry policy                           |
| [ADR-016](ADR-016-ingestion-worker-retry-backoff-schedule.md)                         | Worker 重试退避调度策略                                | accepted | implemented | Worker retry backoff                          |
| [ADR-017](ADR-017-ingestion-dead-letter-manual-replay.md)                             | Worker 死信人工重放核心                                | accepted | implemented | Inbox dead-letter replay                      |
| [ADR-018](ADR-018-error-event-occurrence-processing-storage.md)                       | 错误事件 occurrence 处理存储                           | accepted | implemented | processing-store occurrence                   |
| [ADR-019](ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md) | 请求事件聚合与有界诊断样本存储                         | accepted | in-progress | processing-store request sample               |
| [ADR-020](ADR-020-idempotent-request-metric-bucket-aggregation.md)                    | 幂等请求指标桶聚合                                     | accepted | implemented | processing-store request metric               |
| [ADR-021](ADR-021-performance-aggregate-and-bounded-sample-storage.md)                | 性能指标聚合与有界诊断样本存储                         | accepted | implemented | processing-store performance aggregate/sample |
| [ADR-022](ADR-022-aws-account-region-network-and-iac.md)                              | AWS 账号、区域、网络与 IaC 基础设施基础                | accepted | in-progress | OPS-04 云基础设施基础                         |
| [ADR-023](ADR-023-managed-compute-and-managed-data-services.md)                       | 托管计算与托管数据服务（ECS/Fargate、RDS、Redis 边界） | accepted | in-progress | OPS-04 托管计算/数据服务                      |
| [ADR-024](ADR-024-edge-dns-tls-secrets-and-encryption.md)                             | 边缘、DNS、TLS、秘密与加密                             | accepted | in-progress | OPS-04 边缘/安全基础                          |
| [ADR-025](ADR-025-platform-frontend-technology-stack.md)                              | 管理平台前端技术栈                                     | accepted | not-started | PLT-02 前端工程基线                           |
| [ADR-026](ADR-026-platform-backend-runtime-and-contract-chain.md)                     | 管理平台后端运行时与契约链                             | accepted | not-started | PLT-01/后续平台后端基线                       |
| [ADR-027](ADR-027-platform-contract-codegen-tooling.md)                               | 管理平台契约生成工具链                                 | accepted | not-started | PLT-01 契约生成/漂移/兼容门禁                 |
| [ADR-028](ADR-028-platform-session-csrf-security.md)                                  | 管理平台 Session、CSRF 与认证传输契约                 | accepted | not-started | PLT-01/PLT-02 Session/CSRF 传输契约形状       |
| [ADR-029](ADR-029-platform-database-access-and-migration.md)                          | 管理平台数据库访问与 Migration 工具链                 | accepted | not-started | G10 平台数据模型/Migration 工具链            |
| [ADR-030](ADR-030-platform-session-csrf-password-physical-parameters.md)              | 管理平台 Session、CSRF 与密码物理安全参数             | accepted | not-started | G10 身份/认证物理参数                         |
| [ADR-031](ADR-031-platform-email-delivery.md)                                         | 管理平台邮件发送责任、端口与供应商                    | accepted | not-started | G10 邮箱验证/密码重置/邀请                    |
| [ADR-032](ADR-032-platform-outbox-tasks-cache-objects.md)                             | 管理平台 Outbox、任务、缓存与对象存储基础设施         | accepted | not-started | G10 异步边界（邮件/删除交接）                 |
| [ADR-033](ADR-033-issue-aggregate-data-model.md)                                      | Issue 聚合与有界代表样本数据模型                     | accepted | not-started | G03 Issue 主链（DAT-13 数据模型）             |
| [ADR-034](ADR-034-platform-admin-and-platform-audit.md)                              | 平台管理员身份、授权与平台级审计                    | proposed | not-started | G13 PLT-10（D2 前置身份/审计）                 |
| [ADR-035](ADR-035-platform-resource-policy-data-model.md)                           | 平台资源策略数据模型（最小分层策略）               | proposed | not-started | G13 PLT-10（D2 策略数据模型）                  |

> 状态说明：ADR-034/035 于 2026-08-12 由 G13 PLT-10 正式化创建为 `proposed / not-started / awaiting-user-approval`。用户已于 2026-08-12 整体批准 `G13_PLT10_APPROVAL_PACKAGE` 六项推荐（即两份 ADR 记录的产品/安全决策）；ADR 仍需独立非作者评审后由用户正式批准转 `accepted / not-started / approved`，`implementation-status` 保持 not-started。

> 状态说明：ADR-029—032 于 2026-08-08 由 G10（PLT-03/PLT-04/SEC-01）实施门禁创建为 `proposed / not-started / awaiting-review`；2026-08-09 完成独立评审（security/backend-ops/architecture 三路，ADR-030 初审 REJECT 后修复为最终 ACCEPT 版本）并由用户明确正式批准（`accepted / not-started / approved`）。ADR-032 附带用户 YAGNI 实施约束：只有当前 approved 叶子规格确实需要、存在真实 consumer、且 ADR 明确要求该资源时才实际 provision Redis/cache/object storage/background infrastructure；不得因 ADR 定义了未来基础设施边界就提前创建没有 consumer 的付费资源。批准仅覆盖各 ADR 已记录并经过评审修订的决策内容；`implementation-status` 保持 `not-started`，对应代码实施开始前不得标记 implemented。
>
> 状态说明：ADR-033 于 2026-08-10 由 G03 正式化扫掠创建为 `proposed / not-started / awaiting-user-approval`。用户 G03 readiness 规则明确 DAT-13 Issue 数据模型必须有 accepted ADR；评审（architecture/backend、database domain、privacy/data-governance 三路，记录用）见 ADR-033 追加记录。2026-08-10 用户对 G03 APPROVAL PACKAGE 整体批准，ADR-033 转为 `accepted / not-started / approved`；`implementation-status` 保持 not-started，直到 DAT-13 正式实施开始。



> 状态说明：ADR-008 于 2026-08-01 由用户批准（`accepted / in-progress / approved`），推荐方案 A（PostgreSQL 事务性 Inbox），批准以六项校正为准。批次/接收结果协议、数据接入 OpenAPI 与 Inbox 数据模型已实施；接入服务、Worker 与容量证据未实现。

> 状态说明：ADR-009 于 2026-08-01 由用户批准（`accepted / in-progress / approved`）。最终决定：独立公开主机 + `POST /v1/batches`、API v1 与 protocolVersion 独立、`apiKey` security scheme + `X-Aurora-Client-Key`、`X-Aurora-Environment`、Origin 匹配、CORS 边界、完整 HTTP 状态映射、`Retry-After`、`X-Aurora-Request-Id`、OpenAPI 3.1.0、密钥格式 `aurora_ingest_<keyId>_<secret>` 仅显示一次。配套威胁模型见[数据接入传输与客户端上报密钥安全决策包](../security/ingestion-transport-and-client-credential.md)。数据接入 OpenAPI 机器契约第一增量已实施（`docs/api/ingestion.openapi.yaml` + `tooling/ingestion-openapi-contract` 漂移门禁）；凭证数据库、接入服务与 CORS 中间件仍未实现。

> 状态说明：ADR-010 于 2026-08-01 由用户批准（`accepted / implemented / approved`）。最终工具链：PostgreSQL 17 + `pg`（node-postgres）+ `node-pg-migrate` + SQL-first。`@aurora/ingestion-inbox` 已实施（`event_inbox` Migration + `persistBatch` Repository）并通过真实 PostgreSQL 17.10 集成测试；接入服务、Worker、CI、RDS 与 IaC 未实现。

> 状态说明：ADR-011 于 2026-08-01 由用户批准（`accepted / in-progress / approved`）。最终决定：Fastify 5.10.0；Node 24 本地兼容门禁；不使用 `@fastify/cors`，显式 CORS adapter（OPTIONS 仅验证传输资格、POST 执行项目级授权）；`apps/ingestion-api`（包名 `@aurora/ingestion-api`，private）；Workspace Policy `service` 层；两阶段配置；`buildIngestionApi`/`startIngestionApi` Pool 所有权分离；`inject()` + 随机端口 loopback 冒烟测试。HTTP 服务第一增量已实施并通过真实 PostgreSQL 17.10 集成测试；真实凭证模块、Worker、CI、RDS 与 IaC 未实现。

> 状态说明：ADR-012 于 2026-08-01 由用户批准（`accepted / not-started / approved`）。最终决定：Node.js 24 原生异步运行时；`AbortController`/`AbortSignal` 控制停止；可注入 sleeper/timer 端口；不使用 `setInterval` 驱动重叠轮询；并发由显式配置控制；不创建无界 Promise/数组/任务队列；不把 Worker 运行时做成通用任务框架；`apps/ingestion-worker`（包名 `@aurora/ingestion-worker`，private）；两阶段配置；`buildIngestionWorker`/`startIngestionWorker` Pool 所有权分离。实施状态更新为 `in-progress`：Worker 运行时与处理器编排第一增量已实施并通过真实 PostgreSQL 17.10 并发/续租/关闭/双 Worker 集成测试；具体事件处理器、Worker retry/dead-letter policy、人工重放、CI、RDS 与 IaC 未实现。

> 状态说明：ADR-013 于 2026-08-02 由用户批准（`accepted / implemented / approved`）。最终决定：PostgreSQL 17、SQL-first、`pg`、`node-pg-migrate`、独立凭证数据包 `@aurora/ingestion-credentials`、16-byte keyId、32-byte secret、SHA-256 digest、timing-safe comparison、active/disabled/revoked、expires_at 动态失效、effective Origin/environment policy snapshot、ingestion-api 请求授权 adapter、不实现管理 API。凭证存储与验证第一增量已实施并通过真实 PostgreSQL 17.10 与 HTTP 集成验证；凭证创建/轮换/撤销管理 API、平台页面、CI、RDS 与 IaC 未实现。

> 状态说明：ADR-014 于 2026-08-02 由用户批准（`accepted / implemented / approved`）。最终决定：扩展现有 `@aurora/ingestion-credentials` 包；创建、轮换、停用、启用、撤销；disabled 可恢复；revoked 永久终态；expired 动态推导；create/rotate 一次性返回完整密钥；secret 永不持久化；rotate 原子创建新凭证并立即撤销旧凭证；rotate 原样继承策略和 expiresAt；无 grace period；PostgreSQL 行锁和事务并发保护；不实现管理 HTTP API、平台身份或完整审计。凭证生命周期服务第一增量已实施并通过真实 PostgreSQL 17.10 创建/轮换/状态/并发验证；管理 HTTP API、平台 UI、管理员授权、完整审计、CI、RDS 与 IaC 未实现。

> 状态说明：ADR-015 于 2026-08-02 由用户批准（`accepted / implemented / approved`）。最终决定：策略位于 ingestion-worker；不创建新包；processor 结果保持 processed/retry/dead-letter；`maxProcessingAttempts` 为必填运行配置；attemptCount 使用 Inbox 既有语义；budget 未耗尽时沿用 processor availableAt；budget 耗尽时自动 dead-letter；最终错误码 `retry_budget_exhausted`；processor 异常不自动 retry/dead-letter；不实现退避算法；不实现人工重放；不新增 Inbox 状态或 Schema。Worker 重试预算与自动死信策略第一增量已实施并通过真实 PostgreSQL 17.10 集成验证；人工重放、具体 processor、容量 benchmark、CI、RDS 与 IaC 未实现。

> 状态说明：ADR-022、ADR-023、ADR-024 于 2026-08-07 由 G16/OPS-04 前置门禁创建为 `proposed / not-started / awaiting-user-approval`。门禁确认：AWS 主云方向已 approved，但主区域、账号/环境细化、网络模型、IaC 工具、托管计算/数据服务、边缘/DNS/TLS/秘密/加密均无 accepted 决策（deployment.md 标为 `deferred`/`requires-accepted-adr`）。三者只用于讨论和评审，**不得约束任何正式实现**；不创建 IaC、不创建 AWS 资源、不运行 `writing-plans`。独立评审（架构/安全/运维/成本/测试五域）已完成，结论为 PASS-WITH-CONCERNS（无 blocking）；评审只是决策材料，**不等同于 accepted ADR，也不等同用户批准**。**2026-08-11 用户正式批准 G16/OPS-04 Cloud Decision Package（D1—D11 全部推荐方案），三份 ADR 决策状态由 `proposed` 更新为 `accepted`、审批状态 `approved`、实施状态 `in-progress`（OPS-04 IaC 基础工程已创建，实际 AWS 资源与 OPS-05 部署仍 not-started）**。批准内容：双 AWS 账号、主区域 `ap-southeast-1`（OPS-04 默认，provisioning 前可重新评估）、CDK TypeScript；ECS/Fargate + RDS Multi-AZ + ElastiCache defer；CloudFront/ALB + Route 53 + ACM + KMS/Secrets + GitHub OIDC，生产域名值由用户提供。

> **临时部署路径（2026-08-08）**：用户选择先使用阿里云单主机公网预览桥接（`public-preview`，见 [public-preview-single-host-deployment.md](../operations/public-preview-single-host-deployment.md)），以获得当前已实现应用的公网运行环境。这**不表示接受或拒绝 AWS 生产 ADR**；G16 状态只记录为 `started / temporary-preview-bridge-active`，OPS-04 不因本桥接标记 completed。**2026-08-11 追加**：用户已正式批准 ADR-022/023/024（`accepted`），正式 G16 基础设施方向确定为 AWS（双账号、`ap-southeast-1`、CDK TS）；阿里云 Preview 桥接保持 `temporary-operational-snapshot`，作为现状/迁移输入，在 OPS-05 建立 approved 部署流水线后替换/重新评估。

> 状态说明：ADR-025、ADR-026、ADR-027、ADR-028 于 2026-08-08 由 G09（PLT-01/PLT-02）实施门禁创建为 `proposed`，完成独立非作者评审（架构/前端/后端/安全/测试兼容）并写回全部修订后，于 2026-08-08 经用户明确正式批准（`accepted / not-started / approved`）。批准仅覆盖各 ADR 已记录并经过评审修订的决策内容；不得借批准扩大 Platform Admin 权限模型、提前实现 G13、发明未批准 Query/Command、改变 G10 范围、修改 event-schema、绕过 Session/CSRF 安全约束或修改已批准 ADR 核心决策。四份 ADR 作为 PLT-01/PLT-02 正式实施依据；`implementation-status` 保持 `not-started`，代码/机器 OpenAPI/console 实现开始前不得标记 implemented。

## 评审门禁

ADR 从 proposed 变为 accepted 前必须：

- 至少一名非作者批准；
- 涉及领域的必要评审者完成评审；
- 候选方案真实可行；
- 正负影响、迁移、回滚、验证和重新评估条件完整；
- 与 PRD、架构规范和其他 ADR 不冲突；
- 实施任务、测试和文档影响已经明确。

状态变化通过 ADR 自身的追加记录维护，不删除历史状态。

## 新 ADR 候选入口

未编号候选的唯一详细队列维护在[正式化与实施就绪追踪](../architecture/formalization-readiness.md#7-新-adr-候选队列)。Workspace、包管理器和首期任务策略已经由 ADR-007 收口；版本发布、前后端栈、数据库、任务/缓存/对象存储、Session、安全、接入缓冲、处理存储、AWS/IaC、制品晋级与公共兼容仍按直接模块依赖建立，不批量编号。

候选项在形成独立 ADR 文件前不分配 ADR 编号；不得把该队列当成已接受决定，也不得合并成大一统技术栈 ADR。

## 关联文档

- [项目规则总入口](../../AURORA_RULES.md)
- [核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- [架构规范](<../../Aurora 架构规范.md>)
- [ADR 规范](<../../Aurora ADR 规范.md>)
- [正式文档索引](../README.md)
- [系统架构与模块边界](../architecture/system-overview.md)
- [正式化与实施就绪追踪](../architecture/formalization-readiness.md)

## 维护记录

### ADR-INDEX-BASELINE-20260727：初始 ADR 索引

- 状态：approved
- 生效日期：2026-07-27
- Owner：architecture
- 维护方式：append-only
- 说明：创建 ARCH-001—ARCH-006 对应的六份 proposed、not-started ADR 提案。
- 历史保护：后续不得删除历史 ADR 条目；状态和替代关系必须追加记录。

### ADR-INDEX-RULE-20260727-001：决策与实施双状态

- 状态：approved
- 生效日期：2026-07-27
- Owner：architecture
- supersedes：none
- 新增规则：决策状态和实施状态分别记录。not-started 表示正式实施尚未开始，可与 proposed 或 accepted 组合。
- 当时解释（已由 `ADR-INDEX-ACCEPTANCE-20260729` 追加记录更新）：本索引中的 proposed / not-started 表示六项决策仍在评审，且没有开始正式实施。
- 验证方式：分别校验两列，不把 proposed / not-started 视为状态冲突。

### ADR-INDEX-FORMALIZATION-20260729：正式化追踪入口

- 状态：approved
- 生效日期：2026-07-29
- Owner：architecture
- 关联：[正式化与实施就绪追踪](../architecture/formalization-readiness.md)
- 当时解释（已由 `ADR-INDEX-ACCEPTANCE-20260729` 追加记录更新）：ADR-001—ADR-006 的决策状态保持 `proposed`，实施状态保持 `not-started`；本次只增加正式化与实施就绪追踪入口，不构成评审通过、接受或实施授权。

### ADR-INDEX-REVIEW-INPUT-20260729：六份提案复审输入完成

- 状态：approved
- 生效日期：2026-07-29
- Owner：architecture
- 关联：[正式化与实施就绪追踪](../architecture/formalization-readiness.md#6-adr-001adr-006-复审清单)
- 当时解释（已由 `ADR-INDEX-ACCEPTANCE-20260729` 追加记录更新）：ADR-001—ADR-006 已分别补充批准设计和正式文档证据、候选边界、实施约束、验证输入与所需评审角色；六份 ADR 仍全部为 `proposed / not-started`。
- 审批边界：下一步可以进入非作者和领域正式审批；在所需评审完成并按 ADR 规范记录前，不得把任何提案标为 `accepted`。
- 候选治理：新 ADR 候选只在正式化追踪中维护无编号队列，形成独立提案时再分配编号。

### ADR-INDEX-ACCEPTANCE-20260729：ADR-001—ADR-007 完成正式审批

- 状态：approved
- 生效日期：2026-07-29
- Owner：architecture
- 独立评审证据：`adr_001_003_review` 完成 ADR-001—003 与 ADR-007 的非作者/领域评审；`adr_004_006_review` 完成 ADR-004—006 的非作者/领域评审，并在 ADR-004、ADR-006 修正后复审；
- 当前解释：ADR-001—ADR-007 均为 `accepted / not-started`，各自追加记录列出评审角色、结论与不存在的实现证据；
- 修正记录：ADR-004 不再把平台 BullMQ 外推到接入/处理，ADR-006 把本地/CI 负例结果归入 `implemented` 门禁；
- 实施边界：当前没有 Workspace、事件 Schema、SDK、服务端、平台、CI、基础设施、Issue、实现 PR 或测试结果；任何 ADR 都不得标为 `implemented`。

### ADR-INDEX-EVENT-SCHEMA-20260730：ADR-005 进入 in-progress

- 状态：approved
- 生效日期：2026-07-30
- Owner：architecture
- 关联：[ADR-005](ADR-005-event-schema-source-of-truth.md)、[ADR-006](ADR-006-one-way-dependencies.md)、[协议基础第一增量规格](../protocol/event-schema-foundation.md)
- 当前解释：ADR-005 实施状态由 `not-started` 更新为 `in-progress`；`@aurora/event-schema` 协议基础第一增量（版本化公共信封、运行时边界校验、稳定错误和共享契约样本）已实施并通过新鲜验证，但具体事件正文、批次/接收协议、兼容转换和真实消费者仍不存在，ADR-005 未进入 `implemented`。ADR-006 保持 `in-progress`，补齐协议层零本地依赖与公共/私有入口证据。
- 实施边界：ADR-001/006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-002—005 中 ADR-005 现为 `in-progress`、ADR-002—004 仍为 `not-started`；`@aurora/event-schema` 是继 `@aurora/workspace-policy` 之后的第二个真实内部包。

### ADR-INDEX-CORE-FOUNDATION-20260730：ADR-003 进入 in-progress

- 状态：approved
- 生效日期：2026-07-30
- Owner：architecture
- 关联：[ADR-003](ADR-003-sdk-plugin-architecture.md)、[ADR-005](ADR-005-event-schema-source-of-truth.md)、[ADR-006](ADR-006-one-way-dependencies.md)、[SDK Core 基础规格](../sdk/sdk-core-foundation.md)
- 当前解释：ADR-003 实施状态由 `not-started` 更新为 `in-progress`；`@aurora/core` SDK Core 生命周期与插件编排基础第一增量（环境无关 Core、显式生命周期、最小配置、插件注册与顺序编排、异常隔离、事件入口和多实例隔离）已实施并通过新鲜验证。ADR-005 追加首个真实 SDK 消费者证据，保持 `in-progress`；ADR-006 修正过时元数据并追加 `sdk-core → protocol`、无 DOM、浏览器全局与模块级可变状态证据，保持 `in-progress`。Browser、具体采集插件、框架适配、采样、队列、传输、持久化、具体事件正文、CI 和发布仍不存在，ADR-003 未进入 `implemented`。
- 实施边界：ADR-001/006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-005/003 为 `in-progress`，ADR-002、ADR-004 仍为 `not-started`；`@aurora/core` 是继 `@aurora/workspace-policy`、`@aurora/event-schema` 之后的第三个真实内部包，仅 Core 基础增量存在。

### ADR-INDEX-ERROR-CONTRACT-20260731：错误事件协议契约第一增量证据

- 状态：approved
- 生效日期：2026-07-31
- Owner：architecture
- 关联：[ADR-003](ADR-003-sdk-plugin-architecture.md)、[ADR-005](ADR-005-event-schema-source-of-truth.md)、[ADR-006](ADR-006-one-way-dependencies.md)、[错误事件协议契约](../protocol/error-event-contract.md)
- 当前解释：`@aurora/event-schema` 在协议基础第一增量之上实施错误事件协议契约第一增量（JavaScript、未处理 Promise 拒绝和资源加载错误正文、错误信封解析器与错误契约样本），并通过新鲜验证；ADR-005/006 追加协议错误契约与 DOM/Node 运行时边界证据，ADR-003 追加错误采集插件前置契约澄清。各 ADR 决策状态与实施状态均不变：ADR-001/003/005/006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-002、ADR-004 仍为 `not-started`。
- 实施边界：错误协议不是错误插件；`packages/plugin-error`、浏览器监听器、错误规范化、传输、采样、队列、持久化、CI 与服务端仍不存在；`@aurora/event-schema` 仍是协议基础加错误契约第一增量，请求/性能/通用资源/行为事件正文与批次/接收协议仍 absent。

### ADR-INDEX-REQUEST-PLUGIN-20260731：请求采集插件第一增量证据

- 状态：approved
- 生效日期：2026-07-31
- Owner：architecture
- 关联：[ADR-003](ADR-003-sdk-plugin-architecture.md)、[ADR-005](ADR-005-event-schema-source-of-truth.md)、[ADR-006](ADR-006-one-way-dependencies.md)、[请求采集插件规格](../sdk/request-capture-plugin.md)
- 当前解释：`@aurora/plugin-request` 请求采集插件第一增量已实施（通过 Browser 公开请求源订阅 fetch 与 XMLHttpRequest 事实，经 `parseRequestEventBody` 校验后以最小草稿提交 Core，同步生命周期、重入门禁、有界诊断、宿主安全与多实例隔离），并通过新鲜验证（含 9 个真实 Chromium 场景）；ADR-003/005/006 追加请求插件分层、协议消费者与 sdk-plugin 依赖边界证据。各 ADR 决策状态与实施状态均不变：ADR-001/003/005/006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-002、ADR-004 仍为 `not-started`。
- 实施边界：请求插件不是性能/行为插件；性能/通用资源/行为事件正文、性能/行为插件、框架适配、采样、队列、传输、持久化、CI、服务端与平台仍不存在；`@aurora/plugin-request` 是继 `@aurora/plugin-error` 之后的第六个真实内部包和第二个具体采集插件。

### ADR-INDEX-INGESTION-TRANSPORT-20260801：ADR-009 创建（proposed）

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion/security
- 关联：[ADR-009](ADR-009-ingestion-transport-and-client-credential.md)、[数据接入传输与客户端上报密钥安全决策包](../security/ingestion-transport-and-client-credential.md)、[数据接入批次与接收结果协议](../protocol/ingestion-batch-and-receipt-contract.md)
- 当前解释：ADR-009 由 2026-08-01 数据接入 OpenAPI 前置门禁创建为 `proposed / not-started / awaiting-user-approval`。门禁确认数据接入公开路径、API 版本、客户端凭证物理格式与传递位置、来源匹配、环境标识、HTTP 状态映射、CORS、request ID 均无 approved 权威来源（批次/接收结果协议明确排除 HTTP 层，六专题总结 §5.4 与 ADR-008 Deferred 均列为未决）。配套决策包登记候选方案、威胁模型与影响分析。
- 决策边界：ADR-009 当前为 `proposed`，只用于讨论和评审，不得约束正式实现；不创建 OpenAPI 文件、不运行 writing-plans、不实施代码。各既有 ADR 决策状态与实施状态均不变。

### ADR-INDEX-INGESTION-TRANSPORT-ACCEPTED-20260801：ADR-009 用户批准

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion/security
- 关联：[ADR-009](ADR-009-ingestion-transport-and-client-credential.md)、[数据接入传输与客户端上报密钥安全决策包](../security/ingestion-transport-and-client-credential.md)、[数据接入批次与接收结果协议](../protocol/ingestion-batch-and-receipt-contract.md)
- 当前解释：ADR-009 决策状态由 `proposed` 更新为 `accepted`，审批状态 `approved`，实施状态保持 `not-started`。用户批准最终决定：`POST /v1/batches`、API v1 与 protocolVersion 独立、`application/json`、`apiKey` security scheme + `X-Aurora-Client-Key`、`X-Aurora-Environment`、Origin 精确匹配（缺失默认拒绝 + `allowNonBrowser`）、CORS 边界、完整 HTTP 状态映射（200/400/401/403/413/415/429/500/503）、`Retry-After` 整数秒、`X-Aurora-Request-Id`、OpenAPI 3.1.0、密钥格式 `aurora_ingest_<keyId>_<secret>` 仅显示一次。主机名由部署配置不写死；请求字节上限 `requires-benchmark`。
- 决策边界：批准不代表 OpenAPI、SDK transport、密钥数据库、接入服务、Inbox 或 CORS 中间件已经实现；ADR-009 实施状态待 OpenAPI 机器契约实施后更新。各既有 ADR 决策状态与实施状态均不变。

### ADR-INDEX-INGESTION-OPENAPI-20260801：数据接入 OpenAPI 机器契约第一增量实施证据

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion
- 关联：[ADR-009](ADR-009-ingestion-transport-and-client-credential.md)、[数据接入 OpenAPI 正式规格](../api/ingestion-openapi.md)、[tooling/ingestion-openapi-contract](../../tooling/ingestion-openapi-contract/README.md)
- 当前解释：ADR-009 实施状态更新为 `in-progress`。`docs/api/ingestion.openapi.yaml`（OpenAPI 3.1.0）与 `docs/api/ingestion-openapi.md`（approved 规格）已创建；`tooling/ingestion-openapi-contract` 漂移门禁（40 个测试）自动比对 `@aurora/event-schema` 枚举/required/限制/样本/`retryable`/`retryAfterMs`/安全。凭证数据库、接入服务与 CORS 中间件仍未实现，ADR-009 不进入 `implemented`。各既有 ADR 决策状态不变：ADR-005 `accepted / in-progress`、ADR-008 `accepted / not-started`、ADR-004 原状态。

### ADR-INDEX-INGESTION-DB-TOOLING-20260801：ADR-010 创建（proposed）

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion/data
- 关联：[ADR-010](ADR-010-postgresql-access-and-migration-tooling.md)、[ADR-008](ADR-008-ingestion-durable-buffering.md)、[release-migration-and-rollback](../releases/release-migration-and-rollback.md)
- 当前解释：ADR-010 由 2026-08-01 数据接入 Inbox 数据模型前置门禁创建为 `proposed / not-started / awaiting-user-approval`。门禁确认数据库访问方式、Migration 工具、PostgreSQL 主版本、SQL-first/QueryBuilder/ORM 边界、数据库包位置、测试数据库启动、CI 真实 PostgreSQL 测试均无 accepted 来源；直接阻塞依据为 release-migration 规范第 46 行"数据库 ADR accepted 前不能创建权威脚本"。
- 决策边界：ADR-010 当前为 `proposed`，只用于讨论和评审，不得约束正式实现；不创建数据库包、不创建 Migration、不安装任何数据库工具。各既有 ADR 决策状态与实施状态均不变：ADR-008 `accepted / not-started`、ADR-009 `accepted / in-progress`。

### ADR-INDEX-INGESTION-DB-TOOLING-ACCEPTED-20260801：ADR-010 用户批准

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion/data
- 关联：[ADR-010](ADR-010-postgresql-access-and-migration-tooling.md)、[ADR-008](ADR-008-ingestion-durable-buffering.md)、[release-migration-and-rollback](../releases/release-migration-and-rollback.md)
- 当前解释：ADR-010 决策状态由 `proposed` 更新为 `accepted`，审批状态 `approved`，实施状态保持 `not-started`。最终工具链：PostgreSQL 17 + `pg`（node-postgres）+ `node-pg-migrate` + SQL-first；包目录 `packages/ingestion-inbox`、包名 `@aurora/ingestion-inbox`、Migration 目录 `migrations/`；集成测试变量 `AURORA_TEST_DATABASE_URL`；未来 CI 使用 PostgreSQL 17 service container；第一增量不引入独立 SQL linter。
- 决策边界：批准不代表 Inbox Schema、Migration、Repository、接入服务、Worker、RDS 或 CI 已经实现；真实 PostgreSQL 17 验证可用前不得把 Inbox 实现标为 implemented。各既有 ADR 决策状态与实施状态均不变：ADR-008 `accepted / not-started`、ADR-009 `accepted / in-progress`、ADR-005 `accepted / in-progress`。

### ADR-INDEX-INGESTION-INBOX-20260801：Inbox 数据模型第一增量实施证据

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion
- 关联：[ADR-008](ADR-008-ingestion-durable-buffering.md)、[ADR-010](ADR-010-postgresql-access-and-migration-tooling.md)、[Inbox 数据模型正式规格](../architecture/ingestion-inbox-data-model.md)、[packages/ingestion-inbox](../../packages/ingestion-inbox/README.md)
- 当前解释：ADR-010 实施状态更新为 `implemented`，ADR-008 实施状态更新为 `in-progress`。`@aurora/ingestion-inbox` 已实施（`event_inbox` Migration + `persistBatch` Repository + 状态/租约 helper）并通过真实 PostgreSQL 17.10 集成测试（21 个）与全仓质量门禁；实际依赖 `pg` 8.22.0、`node-pg-migrate` 9.0.0、`@types/pg` 8.20.0。
- 决策边界：接入服务、Worker、CI、RDS 与 IaC 未实现；ADR-009 `accepted / in-progress`、ADR-005 `accepted / in-progress` 不变。

### ADR-INDEX-INGESTION-HTTP-SERVICE-20260801：ADR-011 创建（proposed）

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion/backend
- 关联：[ADR-011](ADR-011-ingestion-http-service-runtime.md)、[ADR-008](ADR-008-ingestion-durable-buffering.md)、[ADR-009](ADR-009-ingestion-transport-and-client-credential.md)、[ADR-010](ADR-010-postgresql-access-and-migration-tooling.md)
- 当前解释：ADR-011 由 2026-08-01 数据接入同步 HTTP 服务前置门禁创建为 `proposed / not-started / awaiting-user-approval`。门禁确认 Fastify、服务应用目录、`@fastify/cors`、配置来源、测试方式、依赖方向均无 accepted 来源；平台 Fastify 决定只适用管理平台域且 `requires-accepted-adr`；ADR-008/009/010 追加记录均把 "Fastify 路由/接入服务" 列为未实现。
- 决策边界：ADR-011 当前为 `proposed`，只用于讨论和评审，不得约束正式实现；不安装服务框架、不创建应用、不编写 HTTP 服务规格。各既有 ADR 决策状态与实施状态均不变：ADR-008 `accepted / in-progress`、ADR-009 `accepted / in-progress`、ADR-010 `accepted / implemented`。

### ADR-INDEX-INGESTION-HTTP-SERVICE-ACCEPTED-20260801：ADR-011 用户批准

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion/backend
- 关联：[ADR-011](ADR-011-ingestion-http-service-runtime.md)、[ADR-008](ADR-008-ingestion-durable-buffering.md)、[ADR-009](ADR-009-ingestion-transport-and-client-credential.md)、[ADR-010](ADR-010-postgresql-access-and-migration-tooling.md)
- 当前解释：ADR-011 决策状态由 `proposed` 更新为 `accepted`，审批状态 `approved`，实施状态保持 `not-started`。最终决定：Fastify 5.10.0；Node 24 本地兼容门禁；不使用 `@fastify/cors`，显式 CORS adapter；`apps/ingestion-api`（包名 `@aurora/ingestion-api`，private）；Workspace Policy `service` 层；两阶段配置（env adapter + typed config injection）；`buildIngestionApi`/`startIngestionApi` Pool 所有权分离；`inject()` + 随机端口 loopback 冒烟测试。
- 决策边界：批准不代表 HTTP 服务、真实凭证模块、Worker、CI、RDS 或 IaC 已经实现；实施状态待 HTTP 服务实施后更新。各既有 ADR 决策状态与实施状态均不变：ADR-008 `accepted / in-progress`、ADR-009 `accepted / in-progress`、ADR-010 `accepted / implemented`。

### ADR-INDEX-INGESTION-HTTP-SERVICE-IMPL-20260801：HTTP 服务第一增量实施证据

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion/backend
- 关联：[ADR-011](ADR-011-ingestion-http-service-runtime.md)、[HTTP 服务正式规格](../architecture/ingestion-http-service.md)、[apps/ingestion-api](../../apps/ingestion-api/README.md)
- 当前解释：ADR-011 实施状态更新为 `in-progress`。`apps/ingestion-api` 数据接入同步 HTTP 服务第一增量已实施（`buildIngestionApi`/`startIngestionApi`、`POST /v1/batches`、OPTIONS/CORS、请求授权/准入端口、receipt 映射），通过 Fastify 5.10.0/Node 24 兼容门禁、55 个单元/inject/OpenAPI 漂移测试与 5 个真实 PostgreSQL 17.10 集成测试。
- 决策边界：真实凭证模块、Worker、CI、RDS 与 IaC 未实现；ADR-008 `accepted / in-progress`、ADR-009 `accepted / in-progress`、ADR-010 `accepted / implemented` 不变。

### ADR-INDEX-INGESTION-WORKER-20260801：ADR-012 创建（proposed）

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion/backend
- 关联：[ADR-012](ADR-012-ingestion-worker-runtime.md)、[ADR-008](ADR-008-ingestion-durable-buffering.md)、[ADR-011](ADR-011-ingestion-http-service-runtime.md)、[Inbox 处理侧 Repository 正式规格](../architecture/ingestion-inbox-processing-repository.md)
- 当前解释：ADR-012 由 2026-08-01 Worker 运行时前置门禁创建为 `proposed / not-started / awaiting-user-approval`。门禁确认 Worker 消费进程的运行时技术（Node 原生异步 vs BullMQ/cron/调度框架）、应用目录、并发控制、停止控制、定时方式均无 accepted 来源；ADR-004/008 明确 BullMQ 只适用管理平台任务，ADR-011 只授权接入 HTTP 服务运行时。
- 决策边界：ADR-012 当前为 `proposed`，只用于讨论和评审，不得约束正式实现；不创建 Worker 应用、不运行 writing-plans、不实施代码。各既有 ADR 决策状态与实施状态均不变。

### ADR-INDEX-INGESTION-WORKER-ACCEPTED-20260801：ADR-012 用户批准

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion/backend
- 关联：[ADR-012](ADR-012-ingestion-worker-runtime.md)、[Worker 运行时正式规格](../architecture/ingestion-worker-runtime.md)
- 当前解释：ADR-012 决策状态由 `proposed` 更新为 `accepted`，审批状态 `approved`，实施状态保持 `not-started`。用户批准最终决定：Node.js 24 原生异步运行时；`AbortController`/`AbortSignal` 控制停止；可注入 sleeper/timer 端口；不使用 `setInterval` 驱动重叠轮询；一次 claim 循环结束后再开始下一轮；并发由显式配置控制；不创建无界 Promise/数组/任务队列；不把 Worker 运行时做成通用任务框架；`apps/ingestion-worker` + 包名 `@aurora/ingestion-worker`（private）；两阶段配置；`buildIngestionWorker`/`startIngestionWorker` Pool 所有权分离。
- 决策边界：批准不代表 Worker 应用、运行循环、处理器、CI、RDS 或 IaC 已经实现；实施状态待 Worker 运行时实施后更新。各既有 ADR 决策状态与实施状态均不变。

### ADR-INDEX-INGESTION-WORKER-IMPL-20260801：Worker 运行时与处理器编排第一增量实施证据

- 状态：approved
- 生效日期：2026-08-01
- Owner：ingestion/backend
- 关联：[ADR-012](ADR-012-ingestion-worker-runtime.md)、[Worker 运行时正式规格](../architecture/ingestion-worker-runtime.md)、[apps/ingestion-worker](../../apps/ingestion-worker/README.md)
- 当前解释：ADR-012 实施状态更新为 `in-progress`。`apps/ingestion-worker` 数据接入 Worker 运行时与处理器编排第一增量已实施（`buildIngestionWorker`/`startIngestionWorker`、typed 配置、生命周期、claim 循环、显式并发上限、`IngestionEventProcessor` 端口与编排、lease 自动续期、lease lost、graceful shutdown、Pool/Repository 组合、有界诊断），通过真实 PostgreSQL 17.10 并发/续租/关闭/双 Worker 集成测试与全仓质量门禁；ADR-008 实施状态保持 `in-progress`、ADR-010 `accepted / implemented`、ADR-011 `accepted / in-progress`。
- 决策边界：具体事件处理器、Worker retry/dead-letter policy、人工重放、CI、RDS 与 IaC 未实现；不进入 `implemented`。

### ADR-INDEX-INGESTION-CREDENTIAL-20260802：ADR-013 创建（proposed）

- 状态：approved
- 生效日期：2026-08-02
- Owner：ingestion/security
- 关联：[ADR-013](ADR-013-ingestion-client-credential-storage-and-verification.md)、[ADR-009](ADR-009-ingestion-transport-and-client-credential.md)、[数据接入传输与客户端上报密钥安全决策包](../security/ingestion-transport-and-client-credential.md)
- 当前解释：ADR-013 由 2026-08-02 客户端凭证前置门禁创建为 `proposed / not-started / awaiting-user-approval`。门禁确认客户端上报密钥数据库表、密钥摘要验证、active/disabled/revoked/expired 校验、真实 Origin/environment 授权数据、ingestion-api 真实 authorizer 均无 approved 来源；ADR-009/OpenAPI 明确把精确随机位数与摘要算法留给凭证数据模型规格。
- 决策边界：ADR-013 当前为 `proposed`，只用于讨论和评审，不得约束正式实现；不创建凭证包、不运行 writing-plans、不实施代码。各既有 ADR 决策状态与实施状态均不变。

### ADR-INDEX-INGESTION-CREDENTIAL-ACCEPTED-20260802：ADR-013 用户批准

- 状态：approved
- 生效日期：2026-08-02
- Owner：ingestion/security
- 关联：[ADR-013](ADR-013-ingestion-client-credential-storage-and-verification.md)、[凭证存储与验证正式规格](../security/ingestion-client-credential-storage-and-verification.md)
- 当前解释：ADR-013 决策状态由 `proposed` 更新为 `accepted`，审批状态 `approved`，实施状态保持 `not-started`。用户批准最终决定：PostgreSQL 17；SQL-first；`pg`；`node-pg-migrate`；独立凭证数据包；16-byte keyId；32-byte secret；SHA-256 digest；timing-safe comparison；active/disabled/revoked；expires_at 动态失效；effective Origin/environment policy snapshot；ingestion-api 请求授权 adapter；不实现管理 API。
- 决策边界：批准不代表凭证创建、轮换、撤销管理 API、平台页面、CI、RDS 或 IaC 已经实现；实施状态待凭证包实施后更新。各既有 ADR 决策状态与实施状态均不变。

### ADR-INDEX-INGESTION-CREDENTIAL-IMPL-20260802：客户端凭证存储与验证第一增量实施证据

- 状态：approved
- 生效日期：2026-08-02
- Owner：ingestion/security
- 关联：[ADR-013](ADR-013-ingestion-client-credential-storage-and-verification.md)、[凭证存储与验证正式规格](../security/ingestion-client-credential-storage-and-verification.md)、[packages/ingestion-credentials](../../packages/ingestion-credentials/README.md)
- 当前解释：ADR-013 实施状态更新为 `implemented`。`@aurora/ingestion-credentials` 客户端凭证存储与验证第一增量已实施（`ingestion_client_credentials`/`origins`/`environments` Migration、密钥格式解析、SHA-256 digest、constant-time 比较、Origin 规范化、`verifyIngestionCredential`、稳定结果），`apps/ingestion-api` 私有 `postgres-request-authorizer` adapter 已集成到 composition root（复用已拥有 Pool、映射到 `IngestionRequestAuthorizer`、HTTP 401/403/503 语义不变），通过真实 PostgreSQL 17.10 凭证验证与 HTTP 集成验证及全仓质量门禁；ADR-009/011 实施状态保持 `in-progress`（凭证创建/轮换/撤销管理与完整生产配置未完成）、ADR-010 `accepted / implemented`。
- 决策边界：凭证管理 API、轮换、平台页面、Worker policy、人工重放、CI、RDS 与 IaC 未实现。

### ADR-INDEX-INGESTION-CREDENTIAL-LIFECYCLE-20260802：ADR-014 创建（proposed）

- 状态：approved
- 生效日期：2026-08-02
- Owner：ingestion/security
- 关联：[ADR-014](ADR-014-ingestion-client-credential-lifecycle.md)、[ADR-013](ADR-013-ingestion-client-credential-storage-and-verification.md)、[ADR-009](ADR-009-ingestion-transport-and-client-credential.md)
- 当前解释：ADR-014 由 2026-08-02 凭证生命周期前置门禁创建为 `proposed / not-started / awaiting-user-approval`。门禁确认生产级凭证创建、一次性完整密钥返回、安全轮换、停用/启用/撤销、并发生命周期保护、稳定生命周期接口均无 approved 来源。
- 决策边界：ADR-014 当前为 `proposed`，只用于讨论和评审，不得约束正式实现；不实施生命周期能力、不运行 writing-plans。各既有 ADR 决策状态与实施状态均不变。

### ADR-INDEX-INGESTION-CREDENTIAL-LIFECYCLE-ACCEPTED-20260802：ADR-014 用户批准

- 状态：approved
- 生效日期：2026-08-02
- Owner：ingestion/security
- 关联：[ADR-014](ADR-014-ingestion-client-credential-lifecycle.md)、[凭证生命周期正式规格](../security/ingestion-client-credential-lifecycle.md)
- 当前解释：ADR-014 决策状态由 `proposed` 更新为 `accepted`，审批状态 `approved`，实施状态保持 `not-started`。用户批准最终决定：扩展现有 ingestion-credentials 包；创建、轮换、停用、启用、撤销；disabled 可恢复；revoked 永久终态；expired 动态推导；create/rotate 一次性返回完整密钥；secret 永不持久化；rotate 原子创建新凭证并立即撤销旧凭证；rotate 原样继承策略和 expiresAt；无 grace period；PostgreSQL 行锁和事务并发保护；不实现管理 HTTP API、平台身份或完整审计。
- 决策边界：批准不代表管理 HTTP API、平台 UI、管理员授权、完整审计、CI、RDS 或 IaC 已经实现；实施状态待生命周期能力实施后更新。各既有 ADR 决策状态与实施状态均不变。

### ADR-INDEX-INGESTION-CREDENTIAL-LIFECYCLE-IMPL-20260802：凭证生命周期服务第一增量实施证据

- 状态：approved
- 生效日期：2026-08-02
- Owner：ingestion/security
- 关联：[ADR-014](ADR-014-ingestion-client-credential-lifecycle.md)、[凭证生命周期正式规格](../security/ingestion-client-credential-lifecycle.md)、[packages/ingestion-credentials](../../packages/ingestion-credentials/README.md)
- 当前解释：ADR-014 实施状态更新为 `implemented`。`@aurora/ingestion-credentials` 生命周期能力已实施（`generateClientKeyPair`、`createIngestionClientCredential`、`rotateIngestionClientCredential`、`disableIngestionClientCredential`、`enableIngestionClientCredential`、`revokeIngestionClientCredential`、`SELECT ... FOR UPDATE` 行锁、keyId 碰撞有界重试、稳定结果、metadata 不含 digest），未新增 Migration（现有 Schema 足以表达全部语义），通过真实 PostgreSQL 17.10 创建/轮换/状态变更/并发 rotate/事务回滚/keyId 碰撞集成测试与 ingestion-api 认证回归及全仓质量门禁；ADR-013 `accepted / implemented`、ADR-009/011 `accepted / in-progress`、ADR-010 `accepted / implemented`。
- 决策边界：管理 HTTP API、管理平台 UI、管理员授权、完整审计、Worker policy、人工重放、CI、RDS 与 IaC 未实现。

### ADR-INDEX-INGESTION-WORKER-RETRY-POLICY-20260802：ADR-015 创建（proposed）

- 状态：approved
- 生效日期：2026-08-02
- Owner：ingestion/backend
- 关联：[ADR-015](ADR-015-ingestion-worker-retry-budget-policy.md)、[Worker 运行时正式规格](../architecture/ingestion-worker-runtime.md)、[ADR-008](ADR-008-ingestion-durable-buffering.md)、[ADR-004](ADR-004-asynchronous-event-processing.md)
- 当前解释：ADR-015 由 2026-08-02 Worker retry policy 前置门禁创建为 `proposed / not-started / awaiting-user-approval`。门禁确认 processor 返回 retry 后无统一最大处理尝试次数、retry 可能无限重复、无 retry budget exhausted 稳定死信语义、Worker policy 无正式规格与 ADR、人工重放未设计。
- 决策边界：ADR-015 当前为 `proposed`，只用于讨论和评审，不得约束正式实现；不实施策略、不运行 writing-plans。各既有 ADR 决策状态与实施状态均不变。

### ADR-INDEX-INGESTION-WORKER-RETRY-POLICY-ACCEPTED-20260802：ADR-015 用户批准

- 状态：approved
- 生效日期：2026-08-02
- Owner：ingestion/backend
- 关联：[ADR-015](ADR-015-ingestion-worker-retry-budget-policy.md)、[Worker retry budget 正式规格](../architecture/ingestion-worker-retry-budget-policy.md)
- 当前解释：ADR-015 决策状态由 `proposed` 更新为 `accepted`，审批状态 `approved`，实施状态保持 `not-started`。用户批准最终决定：策略位于 ingestion-worker；不创建新包；processor 结果保持 processed/retry/dead-letter；`maxProcessingAttempts` 为必填运行配置；attemptCount 使用 Inbox 既有语义；budget 未耗尽时沿用 processor availableAt；budget 耗尽时自动 dead-letter；最终错误码 `retry_budget_exhausted`；processor 异常不自动 retry/dead-letter；不实现退避算法；不实现人工重放；不新增 Inbox 状态或 Schema。
- 决策边界：批准不代表人工重放、具体 processor、容量 benchmark、CI、RDS 或 IaC 已经实现；实施状态待策略实施后更新。各既有 ADR 决策状态与实施状态均不变。

### ADR-INDEX-INGESTION-WORKER-RETRY-POLICY-IMPL-20260802：Worker 重试预算与自动死信策略第一增量实施证据

- 状态：approved
- 生效日期：2026-08-02
- Owner：ingestion/backend
- 关联：[ADR-015](ADR-015-ingestion-worker-retry-budget-policy.md)、[Worker retry budget 正式规格](../architecture/ingestion-worker-retry-budget-policy.md)、[apps/ingestion-worker](../../apps/ingestion-worker/README.md)
- 当前解释：ADR-015 实施状态更新为 `implemented`。`apps/ingestion-worker` retry budget 策略已实施（`decideRetryDisposition` 纯函数、`maxProcessingAttempts` typed config、runtime 集成：`attemptCount < max` → `scheduleRetry`、`attemptCount >= max` → `markDeadLettered{retry_budget_exhausted}` 单次、显式 dead-letter/processed 不受预算影响、processor exception 保持 leased、invalid retry 不写回、lease_lost 不二次写回、稳定诊断 `retry_budget_exhausted`/`processor_retry_result_invalid`/`retry_policy_evaluation_failed`），通过真实 PostgreSQL 17.10 集成验证与全仓质量门禁；ADR-008 `accepted / in-progress`、ADR-010 `accepted / implemented`、ADR-011 `accepted / in-progress`、ADR-013/014 `accepted / implemented`。
- 决策边界：人工重放、具体事件 processor、数据处理存储、凭证管理 HTTP API、管理平台、CI、RDS、IaC、容量 benchmark 未实现。

### ADR-INDEX-G09-PLATFORM-ACCEPTED-20260808：ADR-025—028 用户批准

- 状态：approved
- 生效日期：2026-08-08
- Owner：platform/architecture
- 关联：[ADR-025](ADR-025-platform-frontend-technology-stack.md)、[ADR-026](ADR-026-platform-backend-runtime-and-contract-chain.md)、[ADR-027](ADR-027-platform-contract-codegen-tooling.md)、[ADR-028](ADR-028-platform-session-csrf-security.md)、[PLT-01 正式规格](../architecture/platform-contract-foundation.md)、[PLT-02 正式规格](../architecture/platform-frontend-shell.md)
- 当前解释：ADR-025/026/027/028 于 2026-08-08 由 G09 实施门禁创建为 `proposed`，完成独立非作者评审（架构/前端/后端/安全/测试兼容）并写回全部修订后，于 2026-08-08 经用户明确正式批准，决策状态由 `proposed` 更新为 `accepted`，审批状态 `approved`，实施状态保持 `not-started`。批准仅覆盖各 ADR 已记录并经过评审修订的决策内容；不得借批准扩大 Platform Admin 权限模型、提前实现 G13、发明未批准 Query/Command、改变 G10 范围、修改 event-schema、绕过 Session/CSRF 安全约束或修改已批准 ADR 核心决策。两份 PLT-01/PLT-02 正式规格同步由用户批准（`status: approved`、`implementation-status: not-started`）。
- 决策边界：批准不代表 `@aurora/platform-contract`、机器 Platform OpenAPI、生成 Client/Server 适配、漂移门禁、`apps/console`、平台前后端实现、数据库/Redis/BullMQ 或任何代码已经存在；`implementation-status` 全部保持 `not-started`，实现开始后按各自追加记录更新。各既有 ADR（001—024）决策状态与实施状态不变。
