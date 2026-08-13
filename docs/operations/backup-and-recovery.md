---
title: Aurora 备份、恢复与灾难恢复
status: approved
owner: operations
last-reviewed: 2026-08-13
applies-to: Aurora 单主机 PostgreSQL、Redis、私密对象、账号注销重放和恢复演练
related:
  - ../../AURORA_RULES.md
  - ../architecture/deployment.md
  - ../releases/release-migration-and-rollback.md
  - ../testing/test-strategy.md
  - ../security/account-deletion-and-data-lifecycle.md
  - ../adr/ADR-036-provider-neutral-single-host-deployment.md
  - ../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
supersedes: none
review-cycle: recovery-policy-or-quarterly-dr
---

# Aurora 备份、恢复与灾难恢复

## 1. 当前效力

本文正式承载 approved 备份、恢复和灾难恢复设计，并整合 A5 账号注销的备份淘汰语义。第一版为 provider-neutral 单主机部署（accepted [ADR-036](../adr/ADR-036-provider-neutral-single-host-deployment.md)），**不做 Multi-AZ / cross-region DR**，不宣称生产级 RPO/RTO SLA。

> **历史（append-only）**：原 approved 设计以 AWS RDS Multi-AZ + 跨区域副本为物理载体；ADR-036 生效后，第一版备份/恢复落到单主机 PostgreSQL。`OFF_HOST_BACKUP_RECOMMENDED`（单机本地备份不能抵御整机丢失）记录为非本轮 blocker；未来可接 OSS/S3-compatible/另一主机，本轮不实现新云对象存储。

## 2. PostgreSQL

- 单主机 PostgreSQL 备份可生成（逻辑/物理转储到本地加密/私有备份目录），备份目录与保留策略明确；
- 初始备份保留 35 天；备份 metadata/retention 明确；
- 在 disposable PostgreSQL 中完成 focused restore，restore 后关键数据可查询；
- 第一版只记录实际 focused restore elapsed time，正式状态写 `MVP_RECOVERY_EVIDENCE_AVAILABLE`，不声称生产级 RPO/RTO SLA 已证明；
- 恢复完成必须验证业务不变量、Migration 版本、审计、关键 Query/Command 和删除事实；
- 精确备份窗口、保留策略与恢复命令为 `implementation-detail`，在真实存储组合上验证为 `requires-benchmark`。

## 3. Redis、Session 与缓存

- Session Redis 单机 in-memory（`--appendonly no`），重启即全部 Session 失效并要求重新登录；任何恢复不得使已撤销 Session 重新有效；
- BullMQ Redis 故障后由 PostgreSQL Outbox 和权威失败记录重投，消费者必须幂等；
- 普通缓存可清空重建，不进入业务数据 RPO；
- Session、BullMQ 和缓存分别记录恢复目标，不共享淘汰策略、凭据或故障域。

## 4. 私密对象

- 私密对象经 private storage adapter 落本地受保护目录（off-host 对象存储为 future）；元数据、对象摘要和版本必须可核对，周期检查孤儿、缺失、删除失败和版本堆积；
- 恢复 Source Map/发布对象后重新验证项目、发布、路径、摘要和授权；
- 项目永久删除时对象和元数据按逐系统确认清理；备份副本只在受控期限内存在且不能作为普通读取路径。

## 5. 账号注销与备份

- 含注销前账号直接身份数据的数据库、备份和对象版本副本最长 35 天自然淘汰，不逐记录破坏共享不可变备份；
- 从注销前恢复点恢复时，服务开放前必须重放恢复点之后的注销事实；
- 恢复验证必须证明账号不能登录、全部旧 Session 无效、组织关系不复活、直接身份重新删除/匿名化、同邮箱新账号不与旧身份关联；
- 安全审计按一年最小匿名摘要独立保留，不能通过恢复普通业务数据绕过期限；
- 备份不能成为用户撤销不可逆注销或读取已删除数据的路径。

删除重放的机器模型和 Runbook 为 `deferred`，在真实存储组合上验证为 `requires-benchmark`。

## 6. 恢复顺序与验收

恢复顺序至少为：基础设施与密钥 → PostgreSQL/Migration → Session/任务安全状态 → 私密对象 → Outbox/任务续跑 → 删除/撤销事实重放 → 关键业务 Query/Command → 只读验证 → 受控开放流量。

验收不能只依据实例健康。必须检查无所有者组织、重复任务、权限、Session、审计、数据水位、Source Map 摘要、删除状态和告警。任何不变量未知时保持服务关闭或受控降级。

## 7. 演练证据

每次演练记录恢复点、制品/Migration 版本、实际 RPO/RTO、缺失/损坏数据、删除重放、验证清单、Owner、发现与整改。未执行演练前不得声称达到 RPO/RTO；本仓库当前只有 focused 本地 restore smoke 与 delete-replay 契约单测证据，无整机 DR 演练证据。
