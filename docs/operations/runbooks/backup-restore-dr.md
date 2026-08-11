---
title: Backup / Restore / DR / Delete-Replay
alert-ids: ops-db-cpu, ops-db-storage, ops-db-connections, ops-deployment-failure
owner: data/operations
---

# 备份 / 恢复 / 灾难恢复 / 删除重放

## 症状与触发

- 单区域多 AZ 运行故障（实例/AZ/误操作 PITR 恢复）：目标 `RPO ≤ 5 分钟`、`RTO ≤ 60 分钟`。
- 区域级灾难：目标 `RPO ≤ 24 小时`、`RTO ≤ 8 小时`（跨区域备份副本 + IaC 重建，不宣称自动故障转移）。
- 上述均为 approved 目标、`requires-benchmark`；**未执行真实 DR 演练前不声称达到 RPO/RTO**（`RPO_RTO_EVIDENCE_PENDING`）。

## 恢复流程（严格按 backup-and-recovery §6 顺序）

1. **基础设施与密钥**：重建/确认 IaC（Network/Compute/Data/Identity/Backup/Observability 栈），恢复 KMS 与 Secrets Manager；
2. **PostgreSQL / Migration**：从备份点恢复 RDS（PITR 窗口内），确认 Migration 版本与 schema 一致；
3. **Session / 任务安全状态**：Session Redis 恢复（已撤销 Session 不得重新有效）、任务安全状态；
4. **私密对象**：Source Map/发布对象恢复并重新验证项目/发布/路径/摘要/授权；
5. **Outbox / 任务续跑**：Outbox 与任务续跑（消费者幂等，不重复投递）；
6. **删除/撤销事实重放**：重放恢复点之后的删除/撤销事实（见下节）——**服务开放前必须完成**；
7. **关键业务 Query/Command**：验证关键查询与命令；
8. **只读验证**：业务不变量、Migration 版本、审计、数据水位；
9. **受控开放流量**：恢复完成后逐步放量。

任何不变量未知时保持服务关闭或受控降级。

## 删除重放（服务开放前强制）

从含注销/撤销前状态的恢复点恢复时，必须重放恢复点之后的删除事实：

- 账号不能登录；
- 全部旧 Session 无效；
- 组织关系不复活；
- 直接身份重新删除/匿名化；
- 同邮箱新账号不与旧身份关联；
- **已撤销客户端凭证不得恢复**（ADR-013/014 revoked 为永久终态）；
- 备份 35 天自然淘汰，不逐记录破坏共享不可变备份；备份不能成为读取已删除数据的路径。

**前置债务**：跨存储删除传播（SEC-02）尚未实现（G04 leaf），delete-replay acceptance = `prerequisite-pending`；本 Runbook 的删除重放清单在 SEC-02 落位前不可标记为已验证。

## 备份淘汰

- 生产 RDS 自动备份 35 天 + PITR + 删除保护；每日加密恢复点副本到隔离备份账号/第二区域（`requires-backup-account`）；
- 含注销前直接身份数据的备份最长 35 天自然淘汰；安全审计按一年最小匿名摘要独立保留，不因恢复绕过期限。

## DR 演练证据模板（每次演练记录）

| 字段                | 值                              |
| ------------------- | ------------------------------- |
| 恢复点              | `<timestamp / PITR target>`     |
| 制品/Migration 版本 | `<sha / migration set>`         |
| 实际 RPO            | `<seconds>`                     |
| 实际 RTO            | `<seconds>`                     |
| 缺失/损坏数据       | `<list / none>`                 |
| 删除重放            | `<replayed facts / none>`       |
| 验证清单            | `<business invariants checked>` |
| Owner               | `<name>`                        |
| 发现与整改          | `<findings>`                    |

Cadence：**每月**数据库恢复演练、**每季度**跨系统灾难恢复演练（backup-and-recovery §2/§7）。本地 focused restore smoke 见 `deploy/aws/restore-smoke.sh`（证据型，非生产 RPO/RTO）。
