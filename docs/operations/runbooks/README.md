# Aurora 运行 Runbook 索引

Aurora 平台**运行告警**（OPS-06）对应的操作手册。产品告警（DAT-19，用户配置的 Issue/性能告警）不在此列——两者绝不能混用同一业务模型。

告警触发（CloudWatch，`Aurora/Operational` 契约）→ 按严重级别响应 → 本索引定位 Runbook → 诊断与恢复 → 验证。每个 Runbook 记录：症状、关联告警 id、首要诊断、恢复步骤、验证与 Owner。

## 索引

| 告警规则 id                  | 严重级 | Runbook                                                                |
| ---------------------------- | ------ | ---------------------------------------------------------------------- |
| `ops-ingestion-availability` | P1     | [ingestion-availability.md](./ingestion-availability.md)               |
| `ops-ingestion-error-rate`   | P1     | [ingestion-error-rate.md](./ingestion-error-rate.md)                   |
| `ops-processing-lag`         | P1     | [processing-lag-dead-letter.md](./processing-lag-dead-letter.md)       |
| `ops-processing-dead-letter` | P1     | [processing-lag-dead-letter.md](./processing-lag-dead-letter.md)       |
| `ops-db-cpu`                 | P2     | [postgresql-saturation.md](./postgresql-saturation.md)                 |
| `ops-db-storage`             | P2     | [postgresql-saturation.md](./postgresql-saturation.md)                 |
| `ops-db-connections`         | P2     | [postgresql-saturation.md](./postgresql-saturation.md)                 |
| `ops-worker-restarts`        | P1     | [worker-and-deployment-failure.md](./worker-and-deployment-failure.md) |
| `ops-worker-down`            | P1     | [worker-and-deployment-failure.md](./worker-and-deployment-failure.md) |
| `ops-deployment-failure`     | P0     | [worker-and-deployment-failure.md](./worker-and-deployment-failure.md) |

## 响应原则

- P0（数据/用户影响）：立即响应；确认影响 → 冻结发布 → 保护数据 → 回滚/恢复 → 证据保留 → 复盘。
- P1（服务影响）：工作时处理；同一根因去重，禁止告警风暴掩盖主故障。
- P2（趋势/饱和度）：工作时间复查。

正式值班渠道、状态页与通知对象仍未确定（运营组织缺口），本索引不宣称 24×7 响应。
