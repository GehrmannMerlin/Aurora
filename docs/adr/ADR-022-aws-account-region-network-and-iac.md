---
title: ADR-022：AWS 账号、区域、网络与 IaC 基础设施基础
status: proposed
implementation-status: not-started
approval-status: awaiting-user-approval
owner: cloud/operations
date: 2026-08-07
last-reviewed: 2026-08-07
applies-to: Aurora 第一版云基础设施的账号/环境模型、主区域、网络模型与 IaC 工具选择
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - '../../Aurora 架构规范.md'
  - ../architecture/deployment.md
  - ../architecture/aws-region-account-network-iac-foundation.md
  - ../architecture/formalization-readiness.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../adr/ADR-011-ingestion-http-service-runtime.md
  - ../adr/ADR-012-ingestion-worker-runtime.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
supersedes: none
superseded-by: none
---

# ADR-022：AWS 账号、区域、网络与 IaC 基础设施基础

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-user-approval
- 日期：2026-08-07
- Owner：cloud/operations
- 适用范围：Aurora 第一版云基础设施的账号/环境模型、主区域、网络模型与 IaC 工具选择
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联技术方案：[部署架构](../architecture/deployment.md)（approved）、[AWS 区域、账号、网络与 IaC 基础设施基础（OPS-04）](../architecture/aws-region-account-network-iac-foundation.md)（proposed）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-07 由 G16/OPS-04 前置门禁创建为 `proposed / not-started / awaiting-user-approval`。门禁确认：AWS 主云方向已 approved（TDR §3.1 方案 A），但主区域（TDR-GAP-01）、账号/环境细化、网络模型与 IaC 工具均无 accepted 决策；deployment.md 明确这些增量为 `deferred`/`requires-accepted-adr`。本 ADR 只记录决策候选与推荐，**在用户批准前不得约束任何正式实现**；不创建 IaC、不运行 `writing-plans`。

> **临时部署路径说明（2026-08-08，append-only 状态追加）**：用户选择先使用阿里云单主机公网预览桥接（`public-preview`，见 [public-preview-single-host-deployment.md](../operations/public-preview-single-host-deployment.md)），以获得当前已实现应用的公网运行环境。这**不表示用户接受或拒绝本 AWS 生产 ADR**；正式 G16 基础设施架构保持 `deferred`。本 ADR 继续 `proposed / not-started`，不因临时桥接改变状态；当 G16/OPS-05 重新评估正式基础设施时，再据此更新。

## 背景

Aurora 已批准 AWS 单一主云方向、至少非生产/生产账号隔离、第一版单主区域多可用区、最小公网面与版本化 IaC。但仓库当前没有 `infra/`、没有 IaC 工程、没有 AWS 资源；deployment.md 把主区域、精确拓扑、容量与成本标为 `deferred`/`requires-benchmark`，把 AWS/IaC 长期选择标为 `requires-accepted-adr`。因此账号/环境模型、主区域决策机制、网络模型与 IaC 工具需要独立 ADR 收口，才能为 OPS-05（不可变制品与部署流水线）提供稳定目标环境。

## 决策驱动因素

- 数据驻留与合规；
- 权限隔离与 blast radius；
- 成本与运维复杂度；
- 与 Aurora TypeScript 技术栈的一致性；
- 可测试性与可审查性（synth/diff/drift）；
- 与已批准部署、发布、备份设计的兼容；
- 为未来持续部署提供可重复创建、可回滚的目标环境。

## 候选方案

### 方案 A：双 AWS 账号（非生产 + 生产）＋ 主区域由目标用户/合规决定 ＋ CDK TypeScript

- 非生产账号承载 staging/CI/PR，生产账号承载生产；各自独立 VPC/KMS/秘密/数据；
- 主区域由用户按目标地域、数据驻留、服务可用性、延迟与成本决定；
- IaC 使用 AWS CDK（TypeScript）。

优点：

- 生产与非生产 blast radius、费用与 IAM 隔离（deployment.md 已 approved）；
- CDK 与 TypeScript 栈同构，synth 可审查、可断言，利于 CI 校验；
- 为跨账号备份与 OIDC 分角色提供明确边界。

缺点：

- 双账号增加 IaC bootstrap 与跨账号备份/运维复杂度；
- 主区域若选 AWS 中国区，服务可用性与 ICP 合规要求显著不同。

### 方案 B：单 AWS 账号分环境隔离 ＋ CDK TypeScript

优点：

- 单账号成本与操作最简。

缺点：

- 与 deployment.md 已 approved 的"至少隔离非生产与生产账号"冲突；
- blast radius 大、生产与非生产共享 IAM/配额/费用边界；
- 不作为第一版候选。

### 方案 C：Terraform 或原生 CloudFormation

优点：

- Terraform 多云通用；CloudFormation 无额外语言。

缺点：

- Terraform 与 Aurora TypeScript 栈异构，需额外工程语言；
- CloudFormation 可读性/可组合性弱、无 synth 校验层；
- 二者均不如 CDK 与已批准技术栈一致。

## 最终决策

**待用户批准（Decision Package D3/D2/D9）。** 本 ADR 推荐：双 AWS 账号（方案 A）、主区域由用户决策决定、CDK TypeScript（方案 A）。最终选择由用户在 G16/OPS-04 Cloud Decision Package 中批准后写入本 ADR 的"最终决策"，并把状态更新为 `accepted`。在此之前本 ADR 保持 `proposed`。

## 结果与影响

### 正面影响

- 生产与非生产完全隔离，权限/成本/故障域清晰；
- IaC 可审查、可重复、可回滚；
- 为 OPS-05 提供稳定目标环境。

### 负面影响与代价

- 双账号运维与 bootstrap 复杂度；
- 跨账号备份与 OIDC 分角色需在 OPS-04/05 一并落位；
- CDK 强绑定 AWS（厂商耦合可接受，因为云方向已 approved 为 AWS 单一主云）。

### 未解决问题

- 主区域具体值（用户决策）；
- 是否增设管理账号、日志/备份专用账号（第一版建议不增设）；
- 精确子网/SG（implementation-detail，IaC 评审产生）。

## 实施约束

- 基础设施以 IaC 为唯一真相，Console 手工长期修改不是常规路径；
- 资源命名/标签至少包含 system、environment、Owner、data classification、cost-center、managed-by；
- 禁止浮动 `latest` 作为发布依据；
- 生产删除保护、保留策略与高风险 IAM 变化需独立审批；
- 非秘密配置进版本化部署配置或 SSM Parameter Store，秘密进 Secrets Manager + KMS；
- CI 不保存长期 AWS access key，使用 GitHub OIDC 短期凭据。

## 迁移方案

从"无基础设施"迁移到目标账号/区域：先完成 CDK bootstrap（双账号）、创建网络基座（VPC/子网/SG/Endpoint）、再按 OPS-05 流水线引入 workload 栈。迁移全程用 IaC 表达，不手工建生产资源。

## 回滚方案

IaC 栈可整体销毁重建；生产 RDS 受删除保护与自动备份保护；生产变更先 diff 评审。区域级回滚依赖跨区域备份副本与重建 Runbook（OPS-07 验证）。

## 验证方式

- 从空环境通过 IaC 重复创建并验证（OPS-04 退出证据）；
- CDK synth 快照、diff 评审、策略/安全扫描进入 CI；
- 定期 drift 检测；
- 生产/非生产隔离通过 IAM 与网络可达性验证。

## 重新评估条件

- 事件量/规模超过第一版预期；
- 基础设施成本显著增长；
- 出现跨区域主动流量或双活需求；
- 合规/数据驻留要求变化；
- 团队规模或部署方式重大变化；
- CDK 或依赖技术停止维护。
