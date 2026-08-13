# 平台资源策略数据模型

- **status**: approved
- **created**: 2026-08-12
- **applies-to**: D2 平台资源策略管理（`platform.resource-policies`）的数据模型与分层策略；B5 用量保护状态
- **decision-source**: 用户 2026-08-12 批准的 `G13_PLT10_APPROVAL_PACKAGE` 六项推荐（第 5—6 项）与 [ADR-035](adr/ADR-035-platform-resource-policy-data-model.md)（accepted）；UX/UI §8.31（已确认方案 A，最小分层策略）；PRD §15.8—§15.9；PRD §16 数据保留
- **related**: `docs/security/platform-admin-and-platform-audit.md`（approved）；formalization-readiness §7 候选队列第 2 项

> 本文只定义策略数据模型（分层、字段、版本、来源、传播）。平台管理员身份/审计见[平台管理员与平台级审计](platform-admin-and-platform-audit.md)；页面交互见 UX/UI §8.31；机器契约边界沿用已批准 OpenAPI §14.1。

## 1. 目标与非目标

### 目标

为第一版平台保护性资源策略提供最小分层存储：平台默认适用于无覆盖组织；组织可保存一份版本化完整覆盖或恢复默认；项目只允许可选资源上限覆盖，其余保护参数继承组织有效策略。页面展示"配置值、来源、生效值"三者分离。

### 非目标

- 不实现逐字段三级继承、每目标完整独立策略、跨目标"保存全部"、批量策略（已确认方案 A 排除）；
- 不实现组织自助调整、申请扩容、套餐、收费、购买、账单、欠费、商业升级、动态成本优化或按功能售卖额度（PRD §15.10）；
- 策略的接收链路执行（数据面传播）不在本文数据模型范围，但模型必须支持传播状态与更新时间的事实呈现（UX/UI §8.31 `propagating`）。

## 2. 配置字段（PRD §15.8，服务端权威校验）

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| `default_period_quota` | numeric（事件数） | 默认组织周期额度；> 0 |
| `warning_ratio` | numeric（0—100） | 预警比例；`0 < warning_ratio < hard_limit` |
| `hard_limit` | numeric（0—100） | 硬上限比例；`warning_ratio < hard_limit <= 100` |
| `degradation_enabled` | boolean | 降级开关 |
| `high_value_retention_days` | int（天） | 高价值事件最低保留；> 0，与 PRD §16 保留策略一致 |
| `resource_limit`（组织/项目上限） | numeric（事件数） | 单个组织或项目资源上限；> 0 |

字段之间由服务端权威校验单位、比例关系与上下限组合（UX/UI §8.31 第 6 条）；前端只做公开契约能表达的基础校验。

### 建议默认值（**产品确认点**，批准后写入正式策略）

| 字段 | 建议默认 |
|---|---|
| 默认组织周期额度 `default_period_quota` | 100 万事件/月 |
| 预警比例 `warning_ratio` | 80% |
| 硬上限 `hard_limit` | 100% |
| 降级开关 `degradation_enabled` | 开启 |
| 高价值事件最低保留 `high_value_retention_days` | 90 天 |

`policy_source`（PRD §15.9）取值：`system_default`（系统默认）或 `platform_admin`（平台管理员配置）。

## 3. 分层与存储模型

三张表，独立版本：

```
platform_resource_policies        -- 平台默认（单行，版本化）
organization_policy_overrides     -- 组织完整覆盖（每组织一行，版本化）
project_policy_limits             -- 项目可选资源上限（每项目至多一行，版本化）
```

### 3.1 `platform_resource_policies`

- `id` uuid PK；`version` int NOT NULL（乐观并发）；
- 六项配置字段（§2 表）；`policy_source` 恒 `system_default`（或由平台管理员 Set 后为 `platform_admin`，见下）；
- `created_at`/`updated_at`；`updated_by`（平台管理员 account_id）；
- 单行约束：**最多一行**（平台默认唯一）。

> 说明：PRD §15.8 允许平台管理员配置默认参数，因此平台默认的 `policy_source` 在管理员保存后为 `platform_admin`；"恢复出厂默认"把六项字段重置为 §2 建议默认并置 `policy_source = system_default`（独立确认 Command）。

### 3.2 `organization_policy_overrides`

- `organization_id` uuid PK 引用 `organizations`；
- `version` int NOT NULL；
- 六项完整配置字段 + `policy_source`（管理员保存后为 `platform_admin`）+ `created_at`/`updated_at`/`updated_by`；
- **组织无覆盖 = 该组织无行**（继承平台默认）；"恢复平台默认" = 删除该行（独立确认 Command）。

### 3.3 `project_policy_limits`

- `project_id` uuid PK 引用 `projects`；
- `version` int NOT NULL；
- 仅 `resource_limit`（可选资源上限）+ `policy_source` + `created_at`/`updated_at`/`updated_by`；
- **项目无覆盖 = 无行**（继承组织有效策略）；"清除项目覆盖" = 删除该行（独立确认 Command）；
- 不复制其他保护字段（预警/硬上限/降级/保留继承组织有效策略）。

## 4. 生效值、来源与传播

- **生效值**由服务端计算：平台默认 →（有覆盖时）组织覆盖 →（有项目上限时）项目 `resource_limit` 覆盖；其余字段继承上级。
- **来源**与配置值分离：页面同时展示"目标自身保存的值、来源（system_default/platform_admin/继承自某组织）、当前生效值"（UX/UI §8.31 第 4 条）。
- **传播状态**：Command 保存后返回 `propagating` + `propagatedAt`（服务端权威）；页面不因表单成功宣称数据面已全面生效（UX/UI §8.31 `propagating`）。
- 生效查询是只读 Query（`EffectivePolicy`）；不缓存，每次读取重新计算，保证新鲜度。
- B5 用量摘要不替代策略配置事实（UX/UI §10.25：正式资源策略 Query 才是配置事实来源）。

## 5. 状态语义（D2 页面）

沿用已批准 UX/UI §8.31 状态集：`loading`/`empty`（组织/项目无覆盖是有效继承状态；平台默认缺失不是正常空态）/`error`/`forbidden`（非平台管理员）/`processing`/`partial`/`stale`/`conflict`（版本冲突要求重新确认）/`unavailable`（停止写入，不从 B5 用量反推）/`propagating`/`inherited`。

## 6. 机器契约边界（草案）

- `platformAdminCapability`（能力前置，见平台管理员规格）；
- `targetSearch`（服务端授权搜索组织/项目，不加载/暴露无关目录）；
- 三个独立 EffectivePolicy Query：`policyGetDefault` / `policyGetOrganizationEffective` / `policyGetProjectEffective`（各自版本）；
- 命令：`policySetDefault` / `policySetOrganization` / `policyResetOrganization` / `policySetProjectLimit` / `policyClearProjectLimit`（版本化 + CSRF + 幂等 + 组合校验 + 影响说明 + 独立确认；收紧操作需显式确认）。
- 能力名称是草案，非最终路径/字段；正式契约在 spec 批准后按已批准 OpenAPI §14.1 生成。

## 7. 边界与门禁

- 本 spec 是数据模型与产品规则，不是实施授权；Migration、机器契约、`platform-api`/Worker 与 D2 UI 需本 spec + 相关 ADR accepted 后另行计划与实施。
- 不修改 ADR-021/019/020（处理存储）与 DAT-21 用量投影；策略生效值作为用量/保护状态的新事实来源，由 D2 与 DAT-21 的正式契约协同。
- 数据保留：策略配置随目标生命周期（组织/项目存在期间）；审计按平台审计 1 年。
