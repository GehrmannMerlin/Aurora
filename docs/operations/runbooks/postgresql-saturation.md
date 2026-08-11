---
title: PostgreSQL Saturation
alert-ids: ops-db-cpu, ops-db-storage, ops-db-connections
owner: data/operations
---

## 症状

- `DB.CPUUtilization`（AWS/RDS）> 80%；
- `DB.FreeStorageSpace` < 5 GiB；
- `DB.DatabaseConnections` > 100。

## 首要诊断

1. RDS CloudWatch 指标与增强监控：CPU、连接、存储、慢查询。
2. 查活动查询：`pg_stat_activity`（经最小权限读路径）；识别锁/长事务。
3. 查连接池配置与 max_connections（参数由容量基准锁定，ING-13）。

## 恢复

1. 连接饱和：检查池泄漏、中止长时间 idle-in-transaction；恢复后收紧池。
2. 存储低：评估扩容（`maxAllocatedStorage` 已设 200GiB 上限）、归档/清理；不直接删除生产数据。
3. CPU 高：定位慢查询/索引缺失；若为 backfill，用有界并发分批暂停续跑（Release §3）。
4. 备份/恢复相关：确认自动备份与 PITR 正常（OPS-07），避免恢复操作叠加负载。

## 验证

连接/CPU/存储回到阈值内；业务 Query p95 恢复；无未授权 schema 变更。
