---
title: ADR-014：客户端上报凭证生命周期服务
status: accepted
implementation-status: implemented
approval-status: approved
owner: ingestion/security
date: 2026-08-02
last-reviewed: 2026-08-02
applies-to: 客户端上报凭证的创建、轮换、停用、启用、撤销生命周期服务（扩展 @aurora/ingestion-credentials）
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/platform-backend.md
  - ../../docs/architecture/deployment.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/architecture/system-overview.md
  - ../../docs/security/ingestion-transport-and-client-credential.md
  - ../../docs/security/ingestion-client-credential-storage-and-verification.md
  - ../../docs/security/ingestion-client-credential-lifecycle.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../docs/adr/ADR-011-ingestion-http-service-runtime.md
  - ../../docs/adr/ADR-013-ingestion-client-credential-storage-and-verification.md
supersedes: none
superseded-by: none
---

# ADR-014：客户端上报凭证生命周期服务

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：implemented
- 审批状态：approved
- 日期：2026-08-02
- Owner：ingestion/security
- 适用范围：客户端上报凭证的创建、轮换、停用、启用、撤销生命周期服务（扩展 `@aurora/ingestion-credentials`）
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 5、6、7 章
- 关联决策包：[数据接入传输与客户端上报密钥安全决策包](../security/ingestion-transport-and-client-credential.md)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-02 由用户批准（`decision-status: accepted`、`approval-status: approved`），实施状态保持 `not-started`。批准授权客户端上报凭证生命周期服务的最终决定；批准不代表管理 HTTP API、平台 UI、管理员授权、完整审计、CI、RDS 或 IaC 已经实现。

## 背景

Aurora 已接受 ADR-009（客户端密钥传输语义）、ADR-013（凭证存储、摘要验证与请求授权）。`@aurora/ingestion-credentials` 已实现密钥格式解析、SHA-256 摘要、constant-time 比较、`ingestion_client_credentials`/`origins`/`environments` Migration、Origin 规范化、`verifyIngestionCredential` 与 ingestion-api 真实 authorizer。

当前真实缺口：没有生产级凭证创建能力；没有一次性返回完整密钥的正式服务；没有安全轮换；没有停用、重新启用和永久撤销操作；没有并发生命周期变更保护；没有可以被未来管理 API 调用的稳定生命周期接口。本 ADR 于 2026-08-02 由用户批准，解除该阻塞。

## 决策驱动因素

- **一次性显示语义**：create/rotate 成功后完整 client key 只返回一次；数据库不保存可恢复的原始 secret；不提供再次读取能力；
- **secret 永不持久化**：与 ADR-013 一致，只存 SHA-256 摘要；
- **安全轮换**：原子创建新凭证并立即撤销旧凭证，无 grace period；旧 key 在 COMMIT 后立即失效；
- **并发生命周期安全**：使用 PostgreSQL 事务和行锁（`SELECT ... FOR UPDATE`），多实例下正确；
- **最小 Schema**：现有 `status`/`expires_at`/`created_at`/`updated_at`/origins/environments 足以表达全部语义，无需新增 Migration；
- **不实现管理 HTTP API/平台 UI/完整审计**：本轮只提供可被未来可信管理服务调用的稳定生命周期接口。

## 现有约束

- ADR-009：密钥格式 `aurora_ingest_<keyId>_<secret>`；一次性显示；服务端只存 keyId、摘要与策略元数据；
- ADR-013：`active`/`disabled`/`revoked` 状态；`expired` 由 `expires_at <= now()` 动态推导；Origin/environment 精确匹配；secret 只存 SHA-256 摘要；验证顺序固定；
- ADR-010：PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first；
- 现有表结构：`ingestion_client_credentials`（`key_id` 唯一、`secret_digest` bytea 固定 32 字节、`status` check、`allow_non_browser`、`expires_at` 可空）+ origins/environments 子表。

## 最终决策

### 4.1 模块位置

不创建新 Workspace 包；在现有 `packages/ingestion-credentials` 中增加生命周期能力。原因：密钥格式、摘要、存储和验证已属于该包；生命周期直接消费同一 Schema 与加密边界；创建新包会拆散同一安全职责；不建立通用 credential framework。

### 4.2 生命周期状态

继续使用现有状态：`active`/`disabled`/`revoked`。

- `active`：可通过认证（仍需满足未过期、Origin 与 environment 策略）；
- `disabled`：临时停用，认证失败；可显式重新启用；重新启用时必须确认未过期；不改变 secret 或授权策略；
- `revoked`：永久撤销，认证失败；不得重新启用、不得恢复为 active、不得再次轮换；需要恢复访问时只能创建新凭证；
- `expired`：由 `expires_at <= database_now` 动态推导；不新增 persisted `expired` 状态；过期凭证不能重新启用、不能轮换；需要继续使用时创建新凭证。

### 4.3 创建

创建操作：

1. 调用方提供 `projectId`、Origin 集合、environment 集合、`allowNonBrowser`、可选 `expiresAt`；
2. 使用 Node `crypto.randomBytes` 生成 16 字节 keyId 与 32 字节 secret；
3. 无 padding base64url 编码；
4. 生成 `aurora_ingest_<keyId>_<secret>`；
5. 计算现有 SHA-256 digest；
6. 单一事务写入 credential、origins、environments；
7. COMMIT 成功后才返回完整密钥；只在成功结果中返回一次；不持久化完整密钥或 secret；不记录完整密钥。

创建后状态固定为 `active`。不允许调用方提供 keyId、secret、digest、status、createdAt、updatedAt。

### 4.4 一次性显示语义

- create/rotate 成功结果包含完整 client key；
- 数据库不保存可恢复的原始 secret；
- 后续读取 API 只能获得 metadata；
- 不提供 getSecret/revealKey 或再次显示接口；
- 调用方丢失完整 key 后只能执行 rotate 或 create；
- 事务未确认成功时不得返回 client key。

不声称可以在进程内技术上阻止调用方复制返回值；安全保证是服务不持久化且不提供再次读取能力。

### 4.5 轮换

轮换是单一数据库事务：

1. `SELECT ... FOR UPDATE` 锁定旧凭证；
2. 确认凭证存在；
3. 确认状态不是 revoked；
4. 确认凭证尚未过期；
5. 读取旧凭证的 projectId、Origin 集合、environment 集合、allowNonBrowser、expiresAt；
6. 生成新 keyId 与 secret；
7. 创建新的 active 凭证；
8. 原样复制旧凭证授权策略与 expiresAt；
9. 将旧凭证状态设为 revoked；
10. 同一事务 COMMIT；
11. COMMIT 成功后返回新完整密钥。

安全规则：旧密钥在 COMMIT 后立即失效；无 grace period；不允许新旧同时 active；轮换不能扩大 Origin/environment、不能改变 allowNonBrowser、不能延长 expiresAt；需要改变权限或有效期时应创建新凭证。disabled 但未过期允许轮换（新凭证 active、旧凭证 revoked）；revoked 或 expired 不可轮换。

### 4.6 停用 / 启用 / 撤销

- `disable`：active→disabled；disabled→disabled（幂等成功）；revoked→invalid_state；expired→expired；不修改 digest/策略/expiresAt；
- `enable`：disabled 且未过期→active；active 且未过期→active（幂等成功）；revoked→invalid_state；expired→expired；使用数据库时间判断过期；不修改策略或 secret；
- `revoke`：active→revoked；disabled→revoked；revoked→revoked（幂等成功）；expired 但未 persisted revoked 允许转为 revoked；revoked 永久终态；不删除数据库记录；不删除 Origin/environment 记录；不提供恢复操作。

### 4.7 不实现删除

本轮不提供 hard delete、soft delete 状态、恢复已撤销凭证、级联删除、批量删除。凭证保留和清理策略属于后续数据生命周期与运营规则。

### 4.8 并发语义

所有状态变更使用数据库事务与行锁。必须验证：两个并发 rotate 只有一个成功；rotate 与 revoke 并发不产生两个 active 新凭证；disable 与 rotate 并发结果确定；enable 与 revoke 并发结果确定；状态判断与写入在同一事务中；不使用先读后写但不加锁的模式；不依赖应用进程内 mutex；多服务实例下仍然正确。生命周期操作使用数据库时间，不使用调用方时钟判断 expiresAt。

### 4.9 keyId 碰撞处理

keyId 仍有数据库唯一约束。创建和轮换时生成 keyId、尝试插入、只对明确的 keyId 唯一冲突执行有界重试；不对任意 PostgreSQL 错误盲目重试；不向上层暴露 constraint 名或 SQLSTATE；重试次数使用小型内部安全常量；达到上限返回稳定 `generation_failed` 或 `temporarily_unavailable`；不降低 keyId 长度；不退化为时间戳、计数器或 `Math.random`。测试必须证明不会把其他唯一约束错误误判为 keyId 碰撞。

### 4.10 稳定结果类型

冻结可判别结果：

- 创建：`success`/`invalid_input`/`temporarily_unavailable`/`generation_failed`；成功含 credential metadata + `clientKey`；
- 轮换：`success`/`not_found`/`invalid_state`/`expired`/`temporarily_unavailable`/`generation_failed`；
- 状态变更：`success`/`not_found`/`invalid_state`/`expired`/`temporarily_unavailable`。

结果不含 secretDigest、SQL、SQLSTATE、constraint、PostgreSQL row；完整 allowlist 仅在规范明确批准时回显。metadata 至少含 credentialId、projectId、keyId、status、allowNonBrowser、expiresAt、createdAt、updatedAt；metadata 不含 digest。

### 4.11 公共 API

包根冻结最小生命周期 API（命名遵循仓库风格）：

```ts
export function createIngestionClientCredential(
  pool: Pool | PoolClient,
  input: CreateIngestionClientCredentialInput,
): Promise<CreateIngestionClientCredentialResult>;

export function rotateIngestionClientCredential(
  pool: Pool | PoolClient,
  input: RotateIngestionClientCredentialInput,
): Promise<RotateIngestionClientCredentialResult>;

export function disableIngestionClientCredential(
  pool: Pool | PoolClient,
  input: MutateIngestionClientCredentialInput,
): Promise<MutateIngestionClientCredentialResult>;

export function enableIngestionClientCredential(
  pool: Pool | PoolClient,
  input: MutateIngestionClientCredentialInput,
): Promise<MutateIngestionClientCredentialResult>;

export function revokeIngestionClientCredential(
  pool: Pool | PoolClient,
  input: MutateIngestionClientCredentialInput,
): Promise<MutateIngestionClientCredentialResult>;
```

必须：通过包根导出；不暴露内部 SQL；不暴露 digest；不接受 HTTP Header；不执行管理平台授权；不依赖 Fastify；不依赖 ingestion-api；不创建或关闭 Pool；不修改输入。fixture helper 保持私有。

### 4.12 输入校验

创建输入验证：projectId 为批准格式 UUID；Origins 去重后满足数量与长度边界；environments 去重后满足数量与长度边界；每个 Origin 通过现有 `normalizeOrigin`；environment 精确匹配既有验证规则；`allowNonBrowser` 为 boolean；`expiresAt` 为合法时间或 null；非 null `expiresAt` 必须晚于数据库当前时间；Origin 为空且 `allowNonBrowser=false` 时是否允许遵循 ADR-013 现有语义；environment 为空不得代表允许全部。不得为方便生命周期服务放宽 ADR-013 的验证规则。

### 4.13 数据库结构评估

现有 Schema 足够表达全部生命周期语义；**不新增 Migration**。`status`/`expires_at`/`created_at`/`updated_at`/origins/environments 全部复用。可以评估但不得无理由新增：`revoked_at`/`disabled_at`/`rotated_from_credential_id`/`replacement_credential_id`/`version`。若后续增加任何列必须说明实际不可替代用途、使用追加 Migration、不修改已有 Migration、不将审计需求假装成已批准平台审计系统、不创建 actor/user 字段（平台身份与管理员审计仍未正式实现）。

### 4.14 审计边界

本轮不实现完整平台审计系统。生命周期方法返回足够稳定结果，供未来可信管理服务写入审计。本包不得自行发明管理员身份、写入用户 Session、创建 platform admin 表、创建通用 audit log、记录原始 key。可以记录有界内部诊断：operation、stable result code、credentialId、projectId、是否发生状态变化；诊断不得包含 clientKey、secret 或 digest。

## 结果与影响

### 正面影响

- 生产级凭证创建、轮换、停用、启用、撤销能力；
- 一次性显示语义与 secret 永不持久化保持一致；
- rotate 原子性保证旧 key 在 COMMIT 后立即失效；
- 并发生命周期安全（行锁 + 事务）；
- 最小 Schema，无新增 Migration；
- 为未来管理 API 提供稳定生命周期接口。

### 负面影响与代价

- 管理 HTTP API、平台 UI、管理员授权、完整审计仍缺失；
- 过期凭证只能创建新凭证，不能重新启用或轮换（业务约束）；
- 需要维护凭证保留与清理策略（后续数据生命周期）。

### 未解决问题

- 凭证管理 HTTP API（后续独立模块）；
- 管理平台 UI、管理员授权、完整审计；
- 凭证保留/清理/级联删除策略；
- CI、RDS、IaC、容量基准。

## 实施约束

- 完全遵守 ADR-009/013 密钥格式、摘要、状态、Origin/environment 语义；
- 不改变密钥格式、摘要算法；不保存原始 secret；
- 不修改 ingestion-api HTTP 契约或 Origin/environment 验证语义；
- 不实现管理平台身份认证、管理 HTTP API、跨项目批量管理；
- 不引入 KMS、HSM 或新的密钥管理基础设施；
- 所有生命周期操作使用数据库事务与行锁；使用数据库时间；
- 完整 key 只出现在 create/rotate 成功结果；COMMIT 前不返回 key；
- 不实现 hard/soft delete 或恢复已撤销凭证。

## 迁移方案

本 ADR accepted 后：编写凭证生命周期正式规格 → writing-plans → 实施 `@aurora/ingestion-credentials` 生命周期能力（create/rotate/disable/enable/revoke、keyId 生成、事务行锁、keyId 碰撞重试、稳定结果）→ 真实 PostgreSQL 创建/轮换/状态/并发验证 + ingestion-api 认证回归。

## 回滚方案

若生命周期能力在实施中发现缺陷，可在生产部署前替换实现（验证 API 与 authorizer 抽象则迁移成本低）；不涉及新 Migration，Schema 不变。不得通过静默放行降级。

## 验证方式

- 生命周期单元测试（keyId/secret 长度、base64url、不使用 Math.random、metadata 不含 digest、clientKey 一次性）；
- 真实 PostgreSQL 创建/轮换/状态变更/并发 rotate/事务回滚/keyId 碰撞测试；
- ingestion-api 认证回归（401/403/503、disabled/revoked key 拒绝、rotate 后旧 key 401）；
- 敏感信息扫描；全仓质量门禁与覆盖率 85/80/85/85。

## 重新评估条件

- 凭证泄露路径出现新的浏览器威胁；
- 需要 pepper/KMS/HSM 或密码型慢哈希；
- 平台项目配置权威实现后需要策略迁移；
- 凭证保留/清理规则落地。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-02：用户批准与最终决定

- 决策状态更新为 `accepted`，实施状态保持 `not-started`，审批状态 `approved`；
- 用户批准本消息中的精确决定：扩展现有 ingestion-credentials 包；创建、轮换、停用、启用、撤销；disabled 可恢复；revoked 永久终态；expired 动态推导；create/rotate 一次性返回完整密钥；secret 永不持久化；rotate 原子创建新凭证并立即撤销旧凭证；rotate 原样继承策略和 expiresAt；无 grace period；PostgreSQL 行锁和事务并发保护；不实现管理 HTTP API、平台身份或完整审计；
- 本次批准不代表管理 HTTP API、平台 UI、管理员授权、完整审计、CI、RDS 或 IaC 已经实现。

### 2026-08-02：凭证生命周期服务第一增量实施证据

- 实施状态更新为 `implemented`：`@aurora/ingestion-credentials` 生命周期能力已实施并通过真实 PostgreSQL 17.10 创建/轮换/状态/并发验证与 ingestion-api 认证回归及全仓质量门禁；管理 HTTP API、管理平台 UI、管理员授权与完整审计仍未实现；
- 实施内容：`generateClientKeyPair`（`crypto.randomBytes` 16-byte keyId + 32-byte secret、无 padding base64url、不使用 Math.random）、`createIngestionClientCredential`（单一事务写入 credential/origins/environments、COMMIT 后返回一次性 clientKey、keyId 唯一冲突有界重试）、`rotateIngestionClientCredential`（`SELECT ... FOR UPDATE` 锁定、disabled 且未过期可轮换、revoked/expired 拒绝、新 active + 旧 revoked 原子提交、原样继承策略与 expiresAt、COMMIT 后返回新 key）、`disableIngestionClientCredential`/`enableIngestionClientCredential`/`revokeIngestionClientCredential`（事务内状态判断与写入、数据库时间判断过期、幂等成功/revoked 永久终态）、稳定结果判别、keyId 碰撞只对唯一冲突重试；
- 未新增 Migration（现有 Schema 足以表达全部生命周期语义）；`verifyIngestionCredential` 公共 API 与 ingestion-api adapter HTTP 语义不变；
- 测试：单元测试（key 生成/长度/base64url/无 Math.random/metadata 无 digest/mutation 无 clientKey/诊断无 secret）+ 真实 PostgreSQL 17.10 创建/轮换/状态变更/并发 rotate/事务回滚/keyId 碰撞集成测试 + ingestion-api 认证回归（401/403/503、disabled/revoked 拒绝、rotate 后旧 key 401）；
- 验证命令：`pnpm --filter @aurora/ingestion-credentials test/test:integration/test:coverage/typecheck/lint/build`、`pnpm --filter @aurora/ingestion-api test/test:integration`、全仓门禁全部 exit 0；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：凭证管理 HTTP API、管理平台 UI、管理员授权、完整审计、CI、RDS、IaC。