---
title: Aurora 备份、恢复与灾难恢复
status: approved
owner: operations
last-reviewed: 2026-07-29
applies-to: Aurora PostgreSQL、Redis/BullMQ、私密对象、账号注销重放和恢复演练
related:
  - ../../AURORA_RULES.md
  - ../architecture/deployment.md
  - ../releases/release-migration-and-rollback.md
  - ../testing/test-strategy.md
  - ../security/account-deletion-and-data-lifecycle.md
  - ../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
supersedes: none
review-cycle: recovery-policy-or-quarterly-dr
---

# Aurora 备份、恢复与灾难恢复

## 1. 当前效力

本文正式承载 approved 备份、恢复和灾难恢复设计，并整合 A5 账号注销的备份淘汰语义。仓库没有数据库、Redis、Bucket、备份、跨区域副本、IaC 或演练结果；所有实现证据均为 `requires-benchmark`，基础设施选择为 `requires-accepted-adr`。

## 2. PostgreSQL

- 生产 RDS PostgreSQL 启用 Multi-AZ、加密、自动备份和 PITR；初始备份保留 35 天；
- 每日复制加密恢复点到隔离的备份账号/第二区域，与生产运行角色分离；
- 单区域多可用区故障目标 `RPO ≤ 5 分钟`、`RTO ≤ 60 分钟`；
- 第一版区域级目标 `RPO ≤ 24 小时`、`RTO ≤ 8 小时`，依靠跨区域备份和 IaC 重建，不宣称自动故障转移；
- 每月执行数据库恢复演练，每季度执行跨系统灾难恢复演练；
- 恢复完成必须验证业务不变量、Migration 版本、审计、关键 Query/Command 和删除事实。

主区域、备份账号拓扑、窗口和实际恢复命令为 `deferred`。

## 3. Redis、BullMQ 与缓存

- Session Redis 采用高可用、加密、认证、禁止淘汰和满足安全目标的持久化/备份；
- Session 数据丢失可以要求重新登录，但任何恢复不得使已撤销 Session 重新有效；
- BullMQ Redis 故障后由 PostgreSQL Outbox 和权威失败记录重投，消费者必须幂等；
- 普通缓存可清空重建，不进入业务数据 RPO；
- Session、BullMQ 和缓存分别记录恢复目标，不共享淘汰策略、凭据或故障域。

精确 ElastiCache 拓扑、持久化、备份窗口和容量为 `requires-accepted-adr`/`requires-benchmark`。

## 4. 私密对象

- 私密 Bucket 启用加密、版本控制、阻止公共访问和最小 Bucket Policy；
- 数据库元数据、对象摘要和版本必须可核对，周期检查孤儿、缺失、删除失败和版本堆积；
- 恢复 Source Map/发布对象后重新验证项目、发布、路径、摘要和授权；
- 项目永久删除时对象和元数据按逐系统确认清理；备份副本只在受控期限内存在且不能作为普通读取路径；
- 精确对象生命周期、非当前版本和复制策略在区域/对象 ADR accepted 后定义。

## 5. 账号注销与备份

- 含注销前账号直接身份数据的数据库、备份账号、跨区域和对象版本副本最长 35 天自然淘汰，不逐记录破坏共享不可变备份；
- 从注销前恢复点恢复时，服务开放前必须重放恢复点之后的注销事实；
- 恢复验证必须证明账号不能登录、全部旧 Session 无效、组织关系不复活、直接身份重新删除/匿名化、同邮箱新账号不与旧身份关联；
- 安全审计按一年最小匿名摘要独立保留，不能通过恢复普通业务数据绕过期限；
- 备份不能成为用户撤销不可逆注销或读取已删除数据的路径。

删除重放的机器模型和 Runbook 为 `deferred`，在真实存储组合上验证为 `requires-benchmark`。

## 6. 恢复顺序与验收

恢复顺序至少为：基础设施与密钥 → PostgreSQL/Migration → Session/任务安全状态 → 私密对象 → Outbox/任务续跑 → 删除/撤销事实重放 → 关键业务 Query/Command → 只读验证 → 受控开放流量。

验收不能只依据实例健康。必须检查无所有者组织、重复任务、权限、Session、审计、数据水位、Source Map 摘要、删除状态和告警。任何不变量未知时保持服务关闭或受控降级。

## 7. 演练证据

每次演练记录恢复点、制品/Migration 版本、实际 RPO/RTO、缺失/损坏数据、删除重放、验证清单、Owner、发现与整改。未执行演练前不得声称达到 RPO/RTO；本仓库当前没有此类证据。
