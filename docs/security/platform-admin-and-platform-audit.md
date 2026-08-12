# 平台管理员与平台级审计

- **status**: draft（正式化中；决策已获用户批准）
- **created**: 2026-08-12
- **applies-to**: D2 平台资源策略管理的前置身份/授权/审计能力；`platform.resource-policies` Route Target
- **decision-source**: 用户 2026-08-12 批准的 `G13_PLT10_APPROVAL_PACKAGE` 六项推荐（第 1—4 项）；PRD §15.8；UX/UI §8.31；OpenAPI §14.1/§459
- **related**: `docs/architecture/platform-resource-policy-data-model.md`；ADR-034（proposed）；formalization-readiness §7 候选队列第 2 项

> 本文只定义平台管理员身份、授权/撤销、break-glass 与平台级审计的正式规则。D2 页面与策略数据模型见[资源策略数据模型规格](platform-resource-policy-data-model.md)；机器契约边界沿用已批准 UX/UI §8.31 与 OpenAPI §14.1。

## 1. 目标与非目标

### 目标

第一版为 D2 平台资源策略管理提供可信的平台管理员身份与平台级审计，使"谁可以配置平台保护性资源参数、改了什么、何时、结果如何"可追溯且可审计。

### 非目标

- 不实现企业 IdP 组映射、云控制面身份直连（仅保留为未来授予来源的扩展点）；
- 不实现自动 break-glass（临时提升自动化依赖 OPS 值班模型，第一版以多管理员缓解单点）；
- 不把平台管理员纳入 org 角色体系（owner/admin 不能推导平台管理员）；
- 不把平台级审计并入 B7 组织安全审计（PRD §13.3 未把平台策略修改列入 B7；平台审计独立）。

## 2. 平台管理员身份

**平台管理员是数据库显式的账号级能力，与 org/project 角色完全解耦。**

- 新增 `platform_admins(account_id, granted_by, granted_at)`（platform-identity Migration）：
  - `account_id` uuid PK，引用 `accounts`；
  - `granted_by` uuid NOT NULL 引用 `accounts`（授予者）；
  - `granted_at` timestamptz NOT NULL 默认 `now()`。
- 平台能力判定 = 账号在 `platform_admins` 中存在；**不**从 org owner/admin、project_admin 或任何项目/组织角色推导（OpenAPI §459）。
- 账号被删除/终止时，其 `platform_admins` 行随账号生命周期处理（账号终止清理），平台命令对无效账号 fail-closed。
- 删除账号、吊销会话等既有流程不受平台管理员身份影响；平台管理员身份不是权限提升到数据面，只授权平台策略命令。

## 3. 授予与撤销

**已授权平台管理员维护集合，无超级管理员层级。**

- `grantPlatformAdmin(accountId, actorAccountId)`：CSRF + 幂等 + 独立确认 + 平台级审计；目标账号必须存在且非终止状态。
- `revokePlatformAdmin(accountId, actorAccountId)`：同上；撤销后目标账号的所有平台命令立即重新鉴权失败（每个平台命令读 `platform_admins`）。
- 禁止通过注册/邀请等公开路径授予平台管理员。
- 撤销不产生级联（不撤销 org/project 权限）。

### 首个管理员（bootstrap）

- 受控 bootstrap：启动时若 `platform_admins` 为空，从受控环境变量（`PLATFORM_ADMIN_BOOTSTRAP_ACCOUNT_IDS`，逗号分隔 uuid）种子初始管理员；bootstrap 记录平台级审计 `admin_bootstrapped`。
- 不允许"无人为管理员"状态持续：任何使集合为空的操作被拒绝（平台命令 fail-closed；至少保留 1 名有效管理员）。
- **产品确认点**：推荐 bootstrap 创建 **2 名**管理员以缓解单点（避免"最后一名管理员被撤销导致平台失管"）。

## 4. 授权规则

- 所有平台命令（策略 Set/Reset/Clear、管理员 Grant/Revoke、审计查询）在执行前重新读取 `platform_admins` 鉴权；不缓存。
- 非平台管理员访问 `platform.resource-policies` 或目标搜索：统一 `403 authorization`，不泄露平台默认/组织/项目策略、目录或用量（UX/UI §8.31 `forbidden` 语义）。
- Redis/Session 权威不可用：平台命令 fail-closed（`503 authority_unavailable`），不降级为允许。
- 管理员自己可查看自己的授予记录（`granted_by/granted_at`）与全部平台审计。

## 5. break-glass

**第一版不实现自动 break-glass。** 单点可用性风险通过 bootstrap 创建 ≥2 名管理员缓解；若集合因事故为空，走受控 bootstrap 重种子（记录 `admin_bootstrapped` 审计）。自动临时提升（时限 + 双重确认 + 高熵授权码）依赖 OPS 值班/事故模型，**deferred**，不作为第一版能力。

## 6. 平台级审计

**独立 `platform_audit_events` 表，与 org 级 B7 审计分离。**

- 字段（最小充分）：
  - `event_id` uuid PK；
  - `actor_account_id` uuid NOT NULL（完整记录，平台审计为安全/合规用途；详情内容掩码）；
  - `action` varchar CHECK（`admin_bootstrapped`/`admin_granted`/`admin_revoked`/`policy_set_default`/`policy_set_organization`/`policy_reset_organization`/`policy_set_project_limit`/`policy_clear_project_limit`/`audit_read`）；
  - `target` jsonb NOT NULL（受约束：`{targetType, targetId?}`，不携带策略正文或敏感值）；
  - `result` varchar CHECK（`succeeded`/`rejected`）；
  - `occurred_at` timestamptz NOT NULL；
  - `request_id` varchar（关联请求）。
- 写入：`insertPlatformAuditEvent` 由平台命令在**同一事务内**写入（与 org audit 同模式）；平台命令失败回滚则不写审计（审计只记录已提交动作）。
- 读取：仅平台管理员可读；`auditListPlatformEvents` 只读 Query，keyset 分页。
- 保留期限：对齐 PRD §16 安全审计摘要 **1 年**；过期由平台清理任务删除（接入 SEC-02 删除状态机，不在本文展开）。
- **不**记录策略正文值、请求体、密钥或完整目录。

## 7. 状态语义（D2 页面）

沿用已批准 UX/UI §8.31：`forbidden`（非管理员，不泄露）、`unavailable`（平台能力或审计服务不可用，停止写入）、`partial`（能力/来源/生效/传播缺失时禁用依赖写入）。平台管理员身份是能力前置；无能力时不进入目标搜索。

## 8. 机器契约边界（草案）

- `platformAdminCapability` Query（session，返回 `{ hasCapability: boolean }`；无能力时不泄露策略）。
- `platformAdminsList` / `platformAdminGrant` / `platformAdminRevoke`（管理员集合 Query/Commands，CSRF + 幂等）。
- `auditListPlatformEvents`（只读，keyset 分页）。
- 这些能力名称是草案，非最终路径/字段；正式契约在 spec 批准后按已批准 OpenAPI 设计与 ADR 生成。

## 9. 边界与门禁

- 本 spec 是产品/安全规则，不是实施授权；Migration、机器契约、`platform-api` handler 与 D2 UI 需本 spec + 相关 ADR accepted 后另行计划与实施。
- 不修改 ADR-028/029/030（Session/CSRF/数据库工具链/物理参数）；平台管理员沿用既有 Session 与 CSRF 机制。
