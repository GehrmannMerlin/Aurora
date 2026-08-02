---
title: Aurora 客户端上报凭证生命周期服务第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/security
created: 2026-08-02
last-reviewed: 2026-08-02applies-to: packages/ingestion-credentials（@aurora/ingestion-credentials，客户端凭证创建/轮换/停用/启用/撤销生命周期服务）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../adr/ADR-011-ingestion-http-service-runtime.md
  - ../adr/ADR-013-ingestion-client-credential-storage-and-verification.md
  - ../adr/ADR-014-ingestion-client-credential-lifecycle.md
  - ../security/ingestion-transport-and-client-credential.md
  - ../security/ingestion-client-credential-storage-and-verification.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: ingestion-credential-lifecycle-schema-or-security-change
---

# Aurora 客户端上报凭证生命周期服务第一增量

## 1. 定位、效力与当前状态

本文冻结客户端上报凭证生命周期服务第一增量，实施为 `@aurora/ingestion-credentials` 的生命周期能力（扩展，不新建包）。它承载 ADR-014 的机器语义：生产级凭证创建、一次性完整密钥返回、安全轮换、停用、重新启用、永久撤销、并发生命周期变更保护（PostgreSQL 行锁 + 事务），以及可被未来管理 API 调用的稳定生命周期接口。ADR-009 冻结密钥格式与传输语义，ADR-013 冻结存储、摘要与请求授权，本文只冻结**生命周期服务**，不改变密钥格式、摘要算法、状态集合、Origin/environment 验证语义或 ingestion-api HTTP 契约。

**批准状态**：本文于 2026-08-02 由用户预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-02 更新为 `implemented`：`@aurora/ingestion-credentials` 生命周期能力已实施（`generateClientKeyPair`、`createIngestionClientCredential`、`rotateIngestionClientCredential`、`disableIngestionClientCredential`、`enableIngestionClientCredential`、`revokeIngestionClientCredential`）并通过真实 PostgreSQL 17.10 创建/轮换/状态变更/并发 rotate/事务回滚/keyId 碰撞集成测试与 ingestion-api 认证回归及全仓质量门禁。本文由 accepted ADR-008/009/010/011/013/014 与 approved 凭证存储与验证规格无歧义派生；自动审批依据见规格自检节。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/security
- **适用范围**：`@aurora/ingestion-credentials` 生命周期能力（创建/轮换/停用/启用/撤销、keyId 生成、事务行锁、keyId 碰撞重试、稳定结果、包根出口、单元与集成测试）。
- **明确非职责**：
  - 管理 HTTP API、管理平台 UI、平台管理员授权、完整审计；
  - 跨项目批量管理、hard/soft delete、恢复已撤销凭证；
  - 用户身份、Session、平台认证；
  - KMS/HSM/新密钥管理基础设施；
  - CI、RDS、IaC。

## 3. 模块选择依据

- ADR-013 冻结凭证存储、摘要验证与请求授权，但无生产级创建/轮换/停用/启用/撤销；
- 现有 `ingestion_client_credentials`/`origins`/`environments` 表结构足以表达全部生命周期语义，无需新增 Migration；
- 生命周期操作直接消费同一 Schema 与加密边界，扩展现有包而非新建包；
- 本模块只提供可被未来管理 API 调用的稳定生命周期接口。

## 4. 职责与非职责

### 4.1 职责

- 生产级凭证创建（一次性完整密钥返回）；
- 安全轮换（原子创建新凭证 + 立即撤销旧凭证）；
- 停用、重新启用、永久撤销；
- 并发生命周期变更保护（行锁 + 事务）；
- keyId 碰撞有界重试；
- 稳定生命周期结果；
- 包根出口、单元测试、PostgreSQL 集成测试。

### 4.2 非职责

- 不实现管理 HTTP API、管理平台 UI、管理员授权、完整审计；
- 不实现跨项目批量管理、删除、恢复已撤销凭证；
- 不实现用户身份/Session/平台认证；
- 不引入 KMS/HSM/新密钥管理基础设施；
- 不创建 CI/RDS/IaC。

## 5. 信任边界

- 生命周期方法通过包根导出，只接受外部 `Pool | PoolClient`；
- 不执行管理平台授权（管理授权由未来可信管理服务负责）；
- 不记录原始 key/secret/digest；
- 调用方与数据库之间的信任由稳定结果与参数化 SQL 保证。

## 6. 状态模型

继续使用现有状态：`active`/`disabled`/`revoked`。

- `active`：可通过认证（仍需满足未过期、Origin 与 environment 策略）；
- `disabled`：临时停用，认证失败；可显式重新启用；重新启用时必须确认未过期；不改变 secret 或授权策略；
- `revoked`：永久撤销，认证失败；不得重新启用、不得恢复为 active、不得再次轮换；需要恢复访问时只能创建新凭证；
- `expired`：由 `expires_at <= database_now` 动态推导；不新增 persisted `expired` 状态；过期凭证不能重新启用、不能轮换；需要继续使用时创建新凭证。

## 7. 创建

创建操作：

1. 调用方提供 `projectId`、Origin 集合、environment 集合、`allowNonBrowser`、可选 `expiresAt`；
2. 使用 Node `crypto.randomBytes` 生成 16 字节 keyId 与 32 字节 secret；
3. 无 padding base64url 编码；
4. 生成 `aurora_ingest_<keyId>_<secret>`；
5. 计算现有 SHA-256 digest；
6. 单一事务写入 credential、origins、environments；
7. COMMIT 成功后才返回完整密钥；只在成功结果中返回一次；不持久化完整密钥或 secret；不记录完整密钥。

创建后状态固定为 `active`。不允许调用方提供 keyId、secret、digest、status、createdAt、updatedAt。

## 8. 一次性显示语义

- create/rotate 成功结果包含完整 client key；
- 数据库不保存可恢复的原始 secret；
- 后续读取 API 只能获得 metadata；
- 不提供 getSecret/revealKey 或再次显示接口；
- 调用方丢失完整 key 后只能执行 rotate 或 create；
- 事务未确认成功时不得返回 client key。

不声称可以在进程内技术上阻止调用方复制返回值；安全保证是服务不持久化且不提供再次读取能力。

## 9. 轮换

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

## 10. 停用

`disable`：

- active → disabled；
- disabled → disabled，幂等成功；
- revoked → invalid_state；
- expired → expired；
- 不修改 secret digest、策略、expiresAt。

## 11. 重新启用

`enable`：

- disabled 且未过期 → active；
- active 且未过期 → active，幂等成功；
- revoked → invalid_state；
- expired → expired；
- 使用数据库时间判断过期；
- 不修改策略或 secret。

## 12. 撤销

`revoke`：

- active → revoked；
- disabled → revoked；
- revoked → revoked，幂等成功；
- expired 但未 persisted revoked 的记录允许转为 revoked；
- revoked 永久终态；
- 不删除数据库记录；不删除 Origin/environment 记录；不提供恢复操作。

## 13. 过期

- `expired` 由 `expires_at <= database_now` 动态推导；
- 不新增 persisted `expired` 状态；
- 过期凭证不能重新启用、不能轮换；
- 需要继续使用时创建新凭证。

## 14. 并发

所有状态变更使用数据库事务与行锁。验证：两个并发 rotate 只有一个成功；rotate 与 revoke 并发不产生两个 active 新凭证；disable 与 rotate 并发结果确定；enable 与 revoke 并发结果确定；状态判断与写入在同一事务中；不使用先读后写但不加锁的模式；不依赖应用进程内 mutex；多服务实例下仍然正确。生命周期操作使用数据库时间，不使用调用方时钟判断 expiresAt。

## 15. keyId 碰撞处理

keyId 仍有数据库唯一约束。创建和轮换时生成 keyId、尝试插入、只对明确的 keyId 唯一冲突执行有界重试；不对任意 PostgreSQL 错误盲目重试；不向上层暴露 constraint 名或 SQLSTATE；重试次数使用小型内部安全常量；达到上限返回稳定 `generation_failed` 或 `temporarily_unavailable`；不降低 keyId 长度；不退化为时间戳、计数器或 `Math.random`。测试必须证明不会把其他唯一约束错误误判为 keyId 碰撞。

## 16. 事务边界

- 所有生命周期操作在单一事务内完成状态判断与写入；
- 创建/轮换使用从 Pool 获取的同一 client 显式 BEGIN/COMMIT/ROLLBACK；
- COMMIT 成功前不返回 client key；
- 事务回滚不留下部分写入（credential 与 origins/environments 原子）。

## 17. 稳定结果

### 17.1 创建

- `success`（含 credential metadata + `clientKey`）
- `invalid_input`
- `temporarily_unavailable`
- `generation_failed`

### 17.2 轮换

- `success`（含 metadata + `clientKey`）
- `not_found`
- `invalid_state`
- `expired`
- `temporarily_unavailable`
- `generation_failed`

### 17.3 状态变更（disable/enable/revoke）

- `success`
- `not_found`
- `invalid_state`
- `expired`
- `temporarily_unavailable`

结果不含 secretDigest、SQL、SQLSTATE、constraint、PostgreSQL row；完整 allowlist 仅在规范明确批准时回显。metadata 至少含 credentialId、projectId、keyId、status、allowNonBrowser、expiresAt、createdAt、updatedAt；metadata 不含 digest。mutation 结果不含 clientKey。

## 18. 公共 API

包根冻结最小生命周期 API：

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

## 19. 输入校验

创建输入验证：projectId 为批准格式 UUID；Origins 去重后满足数量与长度边界；environments 去重后满足数量与长度边界；每个 Origin 通过现有 `normalizeOrigin`；environment 精确匹配既有验证规则；`allowNonBrowser` 为 boolean；`expiresAt` 为合法时间或 null；非 null `expiresAt` 必须晚于数据库当前时间；Origin 为空且 `allowNonBrowser=false` 时是否允许遵循 ADR-013 现有语义；environment 为空不得代表允许全部。不得为方便生命周期服务放宽 ADR-013 的验证规则。

## 20. 数据库结构

现有 Schema 足够表达全部生命周期语义；**不新增 Migration**。`status`/`expires_at`/`created_at`/`updated_at`/origins/environments 全部复用。可以评估但不得无理由新增：`revoked_at`/`disabled_at`/`rotated_from_credential_id`/`replacement_credential_id`/`version`。若后续增加任何列必须说明实际不可替代用途、使用追加 Migration、不修改已有 Migration、不将审计需求假装成已批准平台审计系统、不创建 actor/user 字段（平台身份与管理员审计仍未正式实现）。

## 21. 日志与隐私

- 不记录原始 key/secret/digest/clientKey/数据库 URL/SQL/SQLSTATE/constraint；
- 错误映射为稳定结果，不泄露数据库细节；
- 生命周期操作可以记录有界内部诊断：operation、stable result code、credentialId、projectId、是否发生状态变化；诊断不得包含 clientKey、secret 或 digest。

## 22. 审计边界

本轮不实现完整平台审计系统。生命周期方法返回足够稳定结果，供未来可信管理服务写入审计。本包不得自行发明管理员身份、写入用户 Session、创建 platform admin 表、创建通用 audit log、记录原始 key。

## 23. 单元测试

覆盖：keyId/secret 长度；base64url 无 padding；不使用 `Math.random`；create 输入不可提供 secret；metadata 不含 digest；create 成功结果包含一次性 clientKey；mutation 结果不含 clientKey；输入不被修改；诊断不包含 secret/digest。

## 24. PostgreSQL 集成测试

真实 PostgreSQL 17 验证：

- **创建**：成功；credential/origins/environments 原子写入；clientKey 可通过现有 verify API；数据库无 raw secret/完整 key；digest 与返回 key 匹配；COMMIT 失败不返回 key；Origin 写入失败回滚 credential；environment 写入失败回滚全部；expiresAt 使用数据库时间校验；keyId 唯一冲突有界重试；非 keyId 错误不被误重试；
- **轮换**：active 轮换成功；disabled 轮换成功；expired 不可轮换；revoked 不可轮换；新 key 可认证；旧 key 在 COMMIT 后立即 401；新旧不能同时 active；Origin/environment/allowNonBrowser/expiresAt 原样继承；事务失败时旧 key 仍有效且不返回新 key；两个并发 rotate 只有一个成功；rotate 与 revoke 并发不产生额外 active key；
- **状态变更**：active→disabled；disabled 重复 disable 幂等；disabled→active；active 重复 enable 幂等；expired disabled 不可 enable；revoked 不可 enable；active→revoked；disabled→revoked；revoked 重复 revoke 幂等；revoked 永远不能恢复；disabled key 返回 401；re-enabled key 恢复认证；revoked key 返回 401。

## 25. HTTP 验证回归

- ingestion-api 认证回归：401/403/503 不变；disabled/revoked key 拒绝；rotate 后旧 key 401；
- `buildIngestionApi` fake authorizer 测试保持兼容。

## 26. 覆盖率与质量门禁

- 包维持 TypeScript strict；覆盖率不低于 lines 85%、branches 80%、functions 85%、statements 85%；
- 包入口、私有路径负例、Workspace Policy、敏感信息扫描（无 raw key/secret/digest/clientKey/SQLSTATE/constraint）；
- ingestion-api 既有测试全部保持通过。

## 27. 后续管理 API 衔接

- 未来凭证管理 HTTP API 调用这些生命周期方法，写入平台审计；
- 管理平台 UI（C14）通过管理 API 使用生命周期能力；
- `verifyIngestionCredential` 与 authorizer 抽象保持不变。

## 28. 排除范围

- 管理 HTTP API、管理平台 UI、平台管理员授权、完整审计；
- 跨项目批量管理、hard/soft delete、恢复已撤销凭证；
- 用户身份、Session、平台认证；
- KMS/HSM/新密钥管理基础设施；
- CI、RDS、IaC、容量基准。

## 29. 规格自检

- **权威一致性**：密钥格式、digest 和验证语义不变；ADR-009/013 不被破坏；Origin/environment 不放宽；revoked 永久终态；rotation 后旧 key 立即失效；不实现重新显示 secret；不创建第二套凭证协议；
- **兼容性**：现有 verify 公共 API 不变；ingestion-api adapter 不需要改变 HTTP 语义；Inbox 和 Worker 不变；新能力只通过 credentials 包根导出；无循环依赖或私有路径；现有 401/403/503 回归通过；
- **计划质量**：每个生命周期操作有 Task 和测试；状态、SQL、类型和结果全文一致；每个 Task 有 TDD 闭环；无占位；无管理 API、UI 或完整审计；
- **安全**：secret 永不持久化；完整 key 只出现在 create/rotate 成功结果；COMMIT 前不返回 key；并发 rotation 安全；revoked 不可恢复；使用数据库时间；SQL 参数化；错误和日志不泄露安全信息；测试数据库隔离。

自动审批依据：本文全部语义由 accepted ADR-008/009/010/011/013/014 与 approved 凭证存储与验证规格无歧义派生；无新增产品/架构/安全/隐私决策；不改变密钥格式、摘要算法、状态集合或 Origin/environment 语义；自检全部通过。
