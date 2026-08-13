---
title: Provider-Neutral Single-Host G16 Migration and G08 Gate Rebase Plan
status: approved
owner: cloud/operations
created: 2026-08-13
last-reviewed: 2026-08-13
applies-to: ADR-036 生效后的 G16 单主机迁移、最小真实验收与 G08 门禁重写；不改业务代码
related:
  - ../../adr/ADR-036-provider-neutral-single-host-deployment.md
  - ../../adr/ADR-022-aws-account-region-network-and-iac.md
  - ../../adr/ADR-023-managed-compute-and-managed-data-services.md
  - ../../adr/ADR-024-edge-dns-tls-secrets-and-encryption.md
  - ../architecture/deployment.md
  - ../operations/backup-and-recovery.md
  - ../releases/release-migration-and-rollback.md
  - ../operations/public-preview-single-host-deployment.md
  - ../architecture/formalization-readiness.md
  - ../architecture/aurora-v1-remaining-module-batches.md
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
supersedes: none
---

# Provider-Neutral Single-Host G16 Migration and G08 Gate Rebase Plan

## 固定回读与权威边界

| Module ID | 完整回读文件 | 本计划不得改变的业务逻辑 | 缺失门禁 |
|---|---|---|---|
| OPS-04 | deployment.md、ADR-036、ADR-022/023/024、public-preview-single-host-deployment.md | 可靠接收、Inbox、Worker lease、事件协议、权限/隐私、账号删除、SEC-02、Source Map、credential 一次性、Issue/Alert/Notification | ADR-036 accepted（已满足） |
| OPS-05 | release-migration-and-rollback.md、deploy/preview/ | expand/contract Migration、不可变制品、回滚边界 | 单主机 deploy 脚本已存在 |
| OPS-06 | observability-slo-alerts-runbooks.md（G16 分支）、deployment.md §6 | 产品告警 ≠ 运行告警（DAT-19 分离） | 基础观测 smoke |
| OPS-07 | backup-and-recovery.md、SEC-A5 | durable deletion intent、revoked 不复活 | SEC-02 contract |
| G08 | remaining-module-batches §5.5、ingestion-capacity-and-resilience-benchmark.md | 不用本地 PostgreSQL 冒充目标服务器 | TARGET_POSTGRESQL_ENVIRONMENT |

本计划只改变基础设施部署决策与 G16/G08 门禁，不触碰核心业务 PRD、SDK wire protocol、G04/G12/G13 功能模块、Kubernetes、新云账号、阿里云专有 SDK，也不削弱秘密/隐私底线。

## Task 1：权威部署/运维文档与 G16/G08 门禁迁移

把 deployment.md、backup-and-recovery.md、release-migration-and-rollback.md、formalization-readiness.md（ADR 候选队列 #6/#11 与缺口 #6）、remaining-module-batches.md（G08 §5.5）、AURORA_RULES.md、AGENTS.md 与 public-preview-single-host-deployment.md 中 AWS-specific 硬前置（AWS account/region/RDS-only/CDK/Multi-AZ）替换为 provider-neutral 单主机门禁（target deployment host / target PostgreSQL / target Redis / target private storage / single-host network / Docker Compose / real deployment evidence），并把 Preview 单主机部署从 `temporary-operational-snapshot` 转正为 v1 正式路径。`tooling/aws-infra` 与 `tooling/aurora-release` 标记为历史实现、非 v1 部署路径（不删除）。

## Task 2：single-host runtime/deploy configuration 收口

验证 `deploy/preview/compose.yaml` 可解析（`docker compose config`）、服务网络隔离（PostgreSQL/Redis 不映射公网）、persistent volumes 与 restart policy 明确、secret 不入库、nginx vhost 归属（共享 Lumina 边缘只 reload 不 recreate 其他容器）。确认 `pnpm deploy:preview` / `deploy:preview:rollback` 为受控部署/回滚入口。

## Task 3：backup/restore + SEC-02 delete-replay 收口

在 disposable PostgreSQL 中完成 focused backup/restore（小受控数据集 → 备份 → 恢复到隔离目标 → 关键记录可查询）；执行 SEC-02 delete-replay focused bridge（durable deletion intent → 模拟陈旧恢复数据 → 重放删除 → 已删资源保持不可用、revoked credential/delete 状态不复活）。

## Task 4：observability + deployment/rollback targeted acceptance

验证当前服务器真实存在的 service/container health、ingestion health、worker health、PostgreSQL health、processing/error 日志与基础应用 metric；确认 operational alert 配置与 Runbook 链接。执行一条最小部署链（existing release → deploy current SHA → migration → health → 最小 ingestion smoke → 回滚路径存在），不做完整业务 E2E。

## Task 5：ledger/docs/G16 close + G08 readiness

按新验收语义逐叶判定 OPS-04/05/06/07，关闭本轮满足退出条件的 G16 叶子并同步 ledger；把 G08 ING-13/ING-12 门禁改为 TARGET_POSTGRESQL_ENVIRONMENT；输出 G08_READY 判定与最终中文报告。不自动进入 G08。

## 自检（§14 十三项）

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 只改变 infrastructure deployment decision | PASS |
| 2 | 不改核心业务 PRD | PASS |
| 3 | 不改 SDK wire protocol | PASS |
| 4 | 不重做 G04/G12/G13 | PASS |
| 5 | 不引入 Kubernetes | PASS |
| 6 | 不引入新云账号 | PASS |
| 7 | 不依赖阿里云专有 SDK | PASS |
| 8 | 保留模块逻辑边界 | PASS |
| 9 | 不削弱秘密/隐私 | PASS |
| 10 | 有迁移与回滚 | PASS |
| 11 | 保持 Docker Compose | PASS |
| 12 | 可在当前主机运行 | PASS |
| 13 | 测试最小 | PASS |

## 最小验证预算

最多：ADR/docs link/consistency check 一次、`docker compose config` 一次、deployment script syntax/dry-run 一次、server health smoke 一次、`POST /v1/batches` 最小 smoke 一次、focused PostgreSQL backup/restore 一次、SEC-02 delete-replay focused test 一次、observability/log smoke 一次、`git diff --check`。仅当生产代码实际改变时运行 affected typecheck。禁止 root pnpm check/test/coverage、全 PostgreSQL/Worker/Platform-API suite、浏览器矩阵、Console E2E、SDK tests、G04/G12/G13 tests、full benchmark、AWS test/AWS CLI/CDK/Terraform/Kubernetes。
