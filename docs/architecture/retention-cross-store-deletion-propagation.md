---
title: Aurora 数据保留、跨存储删除传播与备份淘汰（SEC-02）
status: approved
implementation-status: implemented-in-feature-branch
approval-status: approved
owner: security/privacy
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to: Aurora 第一版账号/项目级数据保留、跨存储删除传播、部分失败重试、幂等完成、备份淘汰与恢复后删除重放
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../../docs/security/account-deletion-and-data-lifecycle.md
  - ../../docs/operations/backup-and-recovery.md
  - ../../docs/architecture/platform-backend.md
  - ../../docs/adr/ADR-029-platform-database-access-and-migration.md
  - ../../docs/adr/ADR-032-platform-outbox-tasks-cache-objects.md
supersedes: none
review-cycle: release-or-security-change
---

# Aurora 数据保留、跨存储删除传播与备份淘汰（SEC-02）

## 1. 定位、效力与当前状态

本文正式承载 SEC-02 叶子模块（retention / cross-store deletion propagation）。它消费已 approved 的 [账号注销与数据生命周期](../security/account-deletion-and-data-lifecycle.md) §6—11、[backup-and-recovery](../operations/backup-and-recovery.md) §5、核心 PRD §14/§16—17，并把 SEC-01 已创建的 `account_cleanup_handoffs` 意图（注释明确 "consumed by the future SEC-02 worker"）落为**消费该意图的跨存储清理编排**。

**当前状态**：`status: approved`、`implementation-status: implemented-in-feature-branch`。清理状态机、跨存储清理 adapter 端口、PostgreSQL 清理 adapter（真实）、Redis/对象/备份 adapter（契约，对应基础设施由 ADR-032 defer）、清理 orchestrator worker、审计记录、备份淘汰与恢复后删除重放契约已实现并测试。

## 2. 权威语义（不重开）

- **不可逆清理不能部分成功后冒充完成**；跨系统确认完成前只能显示"清理中"，不得用主账号记录已删除代替整体完成（A5 §8、§2）。
- **清理必须可安全重试和续跑**；失败不能回滚为可登录账号；超过 7 天属运营异常（A5 §8）。
- **共享不可变备份不做破坏完整性的逐记录修改**；含注销前账号数据的备份最长 35 天自然淘汰（A5 §9；backup-and-recovery §5）。
- **恢复不得复活账号、权限、Session 或直接身份**；从旧恢复点恢复时开放前必须重放恢复点之后的注销事实（A5 §9）。
- **安全审计保留一年最小匿名摘要**，不可逆阶段移除姓名/邮箱等直接身份（A5 §7）。
- 普通组织/项目业务事实按所属业务对象生命周期保留，但已注销行为人不可反查真实身份（A5 §2、§6）。

## 3. 跨存储清理编排

### 3.1 意图与步骤

`account_cleanup_handoffs`（SEC-01）持久化**不可逆删除意图**（`requiredLifecycle` jsonb：7 天在线清理 / 一年审计 / 35 天备份）。SEC-02 orchestrator 消费它，按固定顺序执行跨存储清理步骤：

| 存储步骤 | 实现 | 说明 |
|---|---|---|
| `postgres` | **真实** | 删除/匿名化账号直接身份与成员关系（见 §3.2） |
| `redis-sessions` | **契约** | Session 撤销（生产 Session Redis 由 ADR-032 defer；adapter 接口 + 契约测试） |
| `object-storage` | **契约** | Source Map 等私密对象删除（生产对象存储由 ADR-032 defer） |
| `audit` | **真实** | 清理完成/失败安全审计（一年最小匿名摘要） |
| `backup-lifecycle` | **契约** | 35 天自然淘汰策略，不逐记录破坏共享不可变备份 |

### 3.2 PostgreSQL 清理（真实）

对账号直接身份数据按 §6 处置：

- **删除/不可恢复**：`accounts`（终态匿名）、`account_credentials`、`email_verification_intents`、`password_reset_intents`、`account_deletion_intents`、该账号邮箱的 pending `organization_invitations`；
- **失效成员关系**：`organization_members`、`project_members`（该 account_id 全部行删除）；
- **幂等**：已成功的清理步骤不重跑；同账号只允许一个 active handoff（UNIQUE account_id）。

业务事实匿名化（处理存储中的行为人投影）依赖未来身份映射，属 `deferred`，不在本增量伪造。

### 3.3 部分失败重试与幂等完成

- `account_cleanup_steps` 表记录每个存储步骤的 `pending/succeeded/failed` 状态、`attempt_count`、`error_code`；
- 失败步骤按有界重试（`maxAttempts`）续跑；`succeeded` 步骤幂等跳过；
- 全部必需步骤 `succeeded` 后，handoff 才转为 `succeeded`（不伪造部分成功）；超限转 `dead_lettered` 并告警/进入删除 Runbook；
- 清理完成后删除 `account_cleanup_handoffs`/`account_cleanup_steps` 行（终态）。

### 3.4 备份淘汰与恢复后删除重放

- **备份淘汰契约**：35 天自然淘汰；不逐记录破坏共享不可变备份；备份不作为读取已删除数据的路径。
- **恢复后删除重放契约**：从旧恢复点恢复时，服务开放前重放恢复点之后的删除事实（账号不能登录、Session 无效、直接身份重新删除/匿名化、已撤销凭证不复活）——与 OPS-07 `validateDeletionReplay` 契约对齐。

## 4. 部署形态

清理 orchestrator 作为 `apps/platform-worker`（service 层）的第二个轮询循环，与 Outbox 邮件消费并存（ADR-032 YAGNI：无 BullMQ/S3/Redis-for-email）。生产 Redis/对象存储由 ADR-032 defer 前，对应 adapter 保持契约实现。

## 5. 未决 / 后续

- `deferred`：业务事实行为人匿名化（需身份映射）、真实 Redis/对象存储清理接线（ADR-032 基础设施落位后）、删除 Runbook（真实存储/任务技术确定前）、备份恢复演练证据（`requires-benchmark`）。
- OPS-07 删除重放 bridge 集成：OPS-07 未合入 main 时记录 `OPS07_DELETE_REPLAY_INTEGRATION_PENDING`。

## 6. 非职责

本文不实现：G12 管理平台 UI、通知/邮件发送、完整组织/项目生命周期删除（B8）、收费/额度（DAT-21）、告警求值（DAT-19）、Source Map（DAT-18）。
