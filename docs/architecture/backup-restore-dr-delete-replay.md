---
title: Aurora 备份、恢复、灾备与删除重放验证（OPS-07）
status: approved
implementation-status: implemented-in-feature-branch
approval-status: approved
owner: data/operations
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to: Aurora 第一版备份策略、恢复编排、灾难恢复演练、删除重放契约与备份淘汰
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../operations/backup-and-recovery.md'
  - '../releases/release-migration-and-rollback.md'
  - '../security/account-deletion-and-data-lifecycle.md'
  - '../testing/test-strategy.md'
  - '../operations/runbooks/backup-restore-dr.md'
  - './immutable-artifact-deployment-pipeline.md'
  - '../adr/README.md'
supersedes: none
review-cycle: recovery-policy-or-quarterly-dr
---

# Aurora 备份、恢复、灾备与删除重放验证（OPS-07）

## 1. 定位、效力与当前状态

本文正式承载 OPS-07 叶子模块（backup / restore / DR / delete-replay validation）。它把已 approved 的 [backup-and-recovery.md](../operations/backup-and-recovery.md)、[测试/部署/发布设计](../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md) §10—11 与 A5 数据生命周期规则落为可执行契约与 IaC。

**当前状态**：`status: approved`、`implementation-status: implemented-in-feature-branch`、`approval-status: approved`。备份策略/恢复编排/删除重放契约与 BackupStack 已实现并通过本地验证（`tooling/aws-infra` 77 个单测、`cdk synth` 12 模板、本地 PG restore smoke PASS）。**OPS-07 implementation = completed-to-available-boundary**（见 §7 前置债务）。

## 2. 备份策略与资源

- 生产 RDS PostgreSQL 自动备份 **35 天 + PITR + 删除保护**（DataStack，OPS-04）；`AURORA_BACKUP_POLICY` 冻结此策略并声明每日加密恢复点副本到隔离备份账号/第二区域（`crossRegionCopy.cadence: 'daily'`，目标区域/账号 `requires-backup-account`，用户提供拓扑后落位）。
- `BackupStack` 提供备份 KMS key（`aurora-<env>-kms-backup`，自动轮换），用于跨区域/备份账号恢复点副本加密。
- 目标（approved、`requires-benchmark`）：单区域多 AZ `RPO ≤ 5 分钟`、`RTO ≤ 60 分钟`；区域级 `RPO ≤ 24 小时`、`RTO ≤ 8 小时`。`validateBackupPolicy` 拒绝 PITR 关闭、保留 <35 天、非 daily 跨区域 cadence 与非法 target。

## 3. 恢复编排

`planRestoreOrder` 冻结 backup-and-recovery §6 顺序：基础设施与密钥 → PostgreSQL/Migration → Session/任务安全状态 → 私密对象 → Outbox/任务续跑 → **删除/撤销事实重放** → 关键 Query/Command → 只读验证 → 受控开放流量。`assertRestoreSafety` 强制：删除重放必须在服务开放与验证之前；恢复不得复活已删除数据、已撤销凭证、已失效 Session。

**focused restore smoke**：`deploy/aws/restore-smoke.sh` 对本地 disposable PG 执行 create small dataset → pg_dump → restore → verify critical rows，本增量已执行并 **PASS**（3 行数据集备份→恢复→行数校验）。此为证据型本地验证，非生产 RPO/RTO。

## 4. DR 演练与 RPO/RTO 证据

`docs/operations/runbooks/backup-restore-dr.md` 提供恢复流程、删除重放清单、备份淘汰说明与 **DR 演练证据模板**（恢复点/制品版本/实际 RPO/RTO/缺失损坏数据/删除重放/验证清单/Owner/发现整改）。Cadence：**每月**数据库恢复演练、**每季度**跨系统 DR 演练。

**RPO_RTO_EVIDENCE_PENDING**：真实 RPO/RTO 测量需 staging/release 环境（本增量无 provisioned 环境）；未演练前不声称达到目标。

## 5. 删除重放契约

`validateDeletionReplay` 冻结删除重放事实模型：账号删除、Session 撤销、组织关系、直接身份、同邮箱新账号、**客户端凭证撤销**、备份淘汰。服务开放前必须重放前六类；已撤销凭证（ADR-013/014 revoked 永久终态）不得因恢复复活；备份 35 天自然淘汰、不逐记录破坏共享不可变备份、不作为读取已删除数据的路径。审计按一年最小匿名摘要独立保留（A5 规则）。

## 6. 备份淘汰

含注销前直接身份数据的备份最长 35 天自然淘汰；不逐记录破坏共享不可变备份；备份不能成为用户撤销不可逆注销或读取已删除数据的路径（backup-and-recovery §5；A5 规则）。

## 7. 前置债务（OPS07_PREREQUISITE_DEBT）

- **SEC-02（跨存储删除传播：PostgreSQL/Redis/对象/审计/备份）已于 2026-08-12 在 `feature/g04-gap-close` 完成**（`apps/platform-worker/src/retention/`，PR #22 OPEN，未合入 origin/main → `SEC02_MAIN_INTEGRATION_PENDING`）。`validateDeletionReplay` 仍返回 `prerequisiteDebt: ['sec-02-cross-store-deletion-pending']`（本分支未消费 SEC-02 契约，不改实现、不伪造）。
- 因此：**OPS-07 implementation = completed-to-available-boundary；delete-replay acceptance = prerequisite-pending**。不得写 OPS-07 completed，不得为完成 G16 临时伪造 SEC-02 / 假 deletion API / 用 mock 代替跨存储删除真实性。本模块只冻结删除重放**契约模型**，跨存储删除真实验证在 SEC-02 落位后于 staging/release 进行。
- 其他证据状态：`PROVISIONING_EVIDENCE_PENDING`（无 AWS 凭据，未 provisioning）、`RPO_RTO_EVIDENCE_PENDING`（真实 DR 演练）、`requires-backup-account`（跨区域副本拓扑）。

## 8. 非职责

本文不实现：SEC-02 跨存储删除传播（G04）、数据保留在线清理（A5 具体清理任务）、生产容量基准（ING-13）、CI workflow（G14）、告警/通知业务 UI。
