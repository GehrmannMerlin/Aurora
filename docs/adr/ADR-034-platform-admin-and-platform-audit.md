---
title: ADR-034：平台管理员身份、授权与平台级审计
status: proposed
implementation-status: not-started
approval-status: awaiting-user-approval
owner: platform/security
date: 2026-08-12
last-reviewed: 2026-08-12
applies-to: 管理平台 D2 平台资源策略的前置身份/授权/审计能力（platform_admins 表、平台命令鉴权、platform_audit_events 表）；`platform.resource-policies` Route Target
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/security/platform-admin-and-platform-audit.md
  - ../../docs/architecture/platform-resource-policy-data-model.md
  - ../../docs/adr/ADR-028-platform-session-csrf-security.md
  - ../../docs/adr/ADR-029-platform-database-access-and-migration.md
  - ../../docs/adr/ADR-030-platform-session-csrf-password-physical-parameters.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
superseded-by: none
---

# ADR-034：平台管理员身份、授权与平台级审计

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-user-approval
- 日期：2026-08-12
- Owner：platform/security
- 适用范围：管理平台 D2 平台资源策略的前置身份/授权/审计能力（`platform_admins` 表、平台命令鉴权、`platform_audit_events` 表）；`platform.resource-policies` Route Target
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 15.8 节
- 关联产品/安全规格：[平台管理员与平台级审计](../../docs/security/platform-admin-and-platform-audit.md)（draft）
- 关联策略规格：[平台资源策略数据模型](../../docs/architecture/platform-resource-policy-data-model.md)（draft）
- 关联 ADR：ADR-028/029/030（Session/CSRF/数据库工具链/物理参数，不修改）
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-12 创建为 `proposed`。创建依据：formalization-readiness §7 新 ADR 候选队列第 2 项明确 D2 平台管理员身份、授予/撤销与平台级审计为"product/security decision required"，且"未解决时阻塞 D2、授权/审计文档、安全 ADR"。用户已于 2026-08-12 整体批准 `G13_PLT10_APPROVAL_PACKAGE` 六项推荐（含平台管理员身份/授权/break-glass/平台审计四项）。本 ADR 把这些已批准决策正式化为长期安全决策，需独立非作者评审（security、backend 领域）后再由用户正式批准。**在用户批准（accepted）前，不得创建 Migration、实现代码，不得进入 writing-plans。**

## 背景

Aurora 已接受 ADR-028/029/030（平台 Session、CSRF、密码、数据库工具链），并已实现 org 角色（owner/admin/member）与 project 角色（project_admin/developer/read_only）。D2 平台资源策略管理（PRD §15.8：默认组织周期额度、组织/项目资源上限、预警比例、硬上限、降级开关、高价值事件最低保留）需要一个**平台层面的管理员身份**。已批准 UX/UI §8.31 明确"只向后端确认的平台管理员开放"，OpenAPI §459 明确"D2 只接受正式平台管理员能力，不能从组织所有者或管理员推导"。当前缺口：平台管理员身份、授予/撤销、break-glass 与平台级审计均无正式模型，构成 D2 的真实阻塞。平台管理员是平台级权限类（org 角色之上），属于需要长期保留取舍依据的高安全迁移成本决策，故创建本独立 ADR。

## 决策驱动因素

1. **身份模型**：平台管理员应是账号级显式能力，还是 org 角色的全局扩展、IdP 组映射、云控制面身份？
2. **授予/撤销**：谁维护平台管理员集合？是否需要超级管理员层级？撤销语义（立即失效/级联）？
3. **bootstrap**：首个管理员如何建立？能否从公开路径授予？
4. **break-glass**：平台管理员集合失效时如何紧急恢复？
5. **平台级审计**：平台管理员操作是否全部审计？与 org 级 B7 审计的关系与保留期限？

## 候选方案

### 身份模型
- **A（推荐，已批准）**：数据库显式账号级能力（`platform_admins` 表），与 org/project 角色完全解耦。
- B：企业 IdP 组映射（第一版无 IdP 集成；仅作未来授予来源扩展点）。
- C：云控制面身份直连（第一版无云控制面）。

### 平台级审计
- **A（推荐，已批准）**：独立 `platform_audit_events` 表，与 org 级 B7 审计分离（PRD §13.3 未把平台策略修改列入 B7）；平台命令同事务写入；保留 1 年（对齐 PRD §16 安全审计）。
- B：并入 B7 组织审计（违反已批准 UX/UI §8.31 边界；平台审计需独立）。

## 决策

1. 平台管理员 = `platform_admins(account_id, granted_by, granted_at)` 显式账号级能力；不从 org/project 角色推导。
2. 已授权平台管理员维护集合（无超级管理员层级）；Grant/Revoke 均 CSRF + 幂等 + 独立确认 + 平台审计；撤销后目标平台命令立即失效（每次鉴权重读 `platform_admins`）。
3. 首个管理员经受控 bootstrap（`PLATFORM_ADMIN_BOOTSTRAP_ACCOUNT_IDS` + `admin_bootstrapped` 审计）；集合恒保持 ≥1 名有效管理员（空集操作 fail-closed）。
4. 第一版不实现自动 break-glass；以 bootstrap ≥2 名管理员缓解单点；自动临时提升 deferred（依赖 OPS 值班模型）。
5. 平台级审计独立 `platform_audit_events` 表；平台命令同事务写入；仅平台管理员可读；保留 1 年；记录完整 accountId（详情掩码），不记录策略正文/密钥/完整目录。

## 影响与后果

- **新增**：`platform_admins`、`platform_audit_events` Migration（platform-identity/平台数据包）；平台命令鉴权重读 `platform_admins`。
- **不修改**：ADR-028/029/030（Session/CSRF/数据库工具链/物理参数沿用）。
- **兼容**：org/project 角色模型不变；平台管理员身份不改变现有业务权限。
- **安全**：平台命令 fail-closed（Session 权威不可用 → 503）；非管理员访问统一 403，不泄露策略/目录/用量。
- **隐私**：平台审计记录完整 accountId（安全合规用途），详情掩码；保留 1 年。
- **成本**：一个账号级小表 + 一个审计表；平台命令每次鉴权一次小查询。

## 评审记录

- 2026-08-12：proposed 创建，待独立非作者评审（security、backend 领域）与用户正式批准。

## 附录：与 G13_PLT10_APPROVAL_PACKAGE 的对应

- 决策 1 ← package 第 1 项（平台管理员身份模型）
- 决策 2—3 ← package 第 2 项（授权与撤销 + 受控 bootstrap）
- 决策 4 ← package 第 3 项（break-glass）
- 决策 5 ← package 第 4 项（平台级审计）
