---
title: Aurora 不可变制品、Migration、部署与回滚流水线（OPS-05）
status: approved
implementation-status: implemented-in-feature-branch
approval-status: approved
owner: cloud/operations
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to: Aurora 第一版正式部署流水线——不可变制品身份、前向兼容 Migration、按服务边界部署与回滚、ECS 部署设置、SPA 原子切换
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - './deployment.md'
  - '../releases/release-migration-and-rollback.md'
  - '../testing/test-strategy.md'
  - '../operations/backup-and-recovery.md'
  - '../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md'
  - './aws-region-account-network-iac-foundation.md'
  - '../adr/README.md'
supersedes: none
review-cycle: deployment-or-rollback-policy-change
---

# Aurora 不可变制品、Migration、部署与回滚流水线（OPS-05）

## 1. 定位、效力与当前状态

本文正式承载 OPS-05 叶子模块（immutable artifact / migration / deployment / rollback pipeline）的边界与实现。它消费已 approved 的 [deployment.md](deployment.md)、[release-migration-and-rollback.md](../releases/release-migration-and-rollback.md) 与[测试/部署/发布设计](../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md)，并落在 OPS-04 已批准的 AWS/IaC 基础上（[aws-region-account-network-iac-foundation.md](aws-region-account-network-iac-foundation.md)）。

**当前状态**：`status: approved`、`implementation-status: implemented-in-feature-branch`、`approval-status: approved`。工具链与 IaC 已实现并通过本地验证（`tooling/aurora-release` 35 个单测、`tooling/aws-infra` 34 个单测、`cdk synth` 8 模板、dry-run CLI 冒烟）。**未执行任何真实 AWS provisioning / ECS 部署**：`PROVISIONING_EVIDENCE_PENDING`（需 GitHub OIDC 凭据与用户域名）。阿里云公网 Preview（`aurora.ah.cn` / `47.238.145.24`）保持 `temporary-operational-snapshot`，与本文 AWS 流水线完全隔离，本文不修改 `deploy/preview/` 任何文件。

## 2. 不可变制品与部署身份

- 每次可发布构建生成 `ReleaseManifest`（`tooling/aurora-release` `src/manifest.ts`）：绑定**精确 40 位提交 SHA**、每个服务（ingestion-api / ingestion-worker / console）的 **ECR 镜像 digest（`sha256:` + 64 hex）或 SPA 内容哈希**、有序 Migration 集、协议版本、创建时间。
- `buildReleaseManifest` 把不可信输入校验为冻结的 typed 对象（稳定错误 `release_manifest_*`）；`assertImmutableArtifact` 拒绝非 CI 构建或畸形 digest。
- **生产只能部署 CI 构建、预发布验证过的同一不可变制品**，绝不从生产分支重建（deployment.md §5；Release §2）。任务定义镜像引用固定 digest，禁止浮动 `latest` 作发布依据（TDR §5.1）。

## 3. 前向兼容 Migration 流水线

- `discoverMigrationSet`（`src/migrations.ts`）按版本前缀（`\d{8,20}`）跨包 `migrations/` 目录全局排序收集 Migration 集。
- `validateForwardCompatibility` 前向兼容门禁：版本有序、无重复、文件存在、**up-Migration 不得含破坏性 DDL**（`DROP TABLE`/`DROP COLUMN`/`pgm.dropTable`/`pgm.dropColumn`）；破坏性变更必须放入旧 reader 退出后的独立 contract 发布（Release §3）。
- `renderForwardMigrationCommand` 只渲染 `node-pg-migrate up`（forward-only），**永不渲染 `down`**；`assertSafeDeployment`/`assertNoDestructiveMigrationRollback` 兜底拒绝任何破坏性 DB 回退。
- Migration 失败立即停止后续部署、保留证据并按 Runbook 恢复（Release §3；测试/部署设计 §10.2）。

## 4. 部署边界（SPA / API / Worker）

- 部署顺序：**migrate → API → Worker → SPA 入口切换**（`planDeployment`，`src/deploy.ts`）；未变化 digest 的服务跳过（no-op，安全重跑）。
- **API 与 Worker 是独立 ECS Fargate Service**（OPS-05 所有，`tooling/aws-infra` ComputeStack）：私有子网、`minHealthyPercent 100 / maxHealthyPercent 200`、ECS deployment controller + **circuit breaker（enable + rollback）**、API 容器 TCP 健康检查、独立 task role、awslogs（测试/部署设计 §10.3；OPS-04 §8）。
- **SPA 以内容哈希和版本前缀发布，入口原子切换**；旧静态资源保留兼容窗口，避免已打开页面引用失效（Release §4）。SPA 的 S3/CloudFront 边缘资源仍 defer 至用户域名（ADR-024）。
- 部署失败不污染当前 Preview：AWS 流水线（`deploy/aws/deploy.yml`，仅 `workflow_dispatch` 手动触发）与阿里云 `deploy/preview/` 完全隔离。

## 5. 回滚边界

- `planRollback`（`src/rollback.ts`）按服务回退上一 digest、SPA 入口回退上一内容哈希、Worker 回滚置 `workerPause`（drain-aware：暂停消费 → 回退 → 续跑；已可靠接收的事实经租约/幂等续跑，不丢弃）。
- 回滚以旧 digest/旧入口为准，不重新构建；**不自动运行破坏性 down Migration**；若 Migration 已进入不可逆阶段，按已批准 forward-fix/兼容方案（测试/部署设计 §10.3）。

## 6. 部署流水线（deploy/aws）

`deploy/aws/deploy.yml`：GitHub Actions，`workflow_dispatch` 手动触发（environment/staging/production + commit SHA）。步骤：检出精确 CI-passed SHA → 构建工具链 → GitHub OIDC 换短期身份（生产/非生产角色分离）→ `validate-migrations`（前向兼容）→ `plan`（dry-run）→ ECS `update-service`（digest-pinned task definition + circuit breaker）。**不自动运行**，无凭据不触发。

## 7. 未决 / 后续

- `PROVISIONING_EVIDENCE_PENDING`：真实 ECR push / ECS rollout / staging smoke 需 AWS 凭据与域名；由 OPS-05 独立验收 + OPS-05 provisioning 证据（从空环境重复创建、`POST /v1/batches` 冒烟）关闭。
- 部署后验证（公开 API、关键业务链、队列/Outbox、水位、审计、告警）属 OPS-06 观测接线后的部署门禁；真实 ALB/CloudFront/WAF 边缘、Route 53/ACM、Secrets Manager 凭据注入随用户域名落位。

## 8. 非职责

本文不实现：运行可观测性/SLO/告警/Runbook（OPS-06）、备份/恢复/DR/删除重放（OPS-07）、CI workflow（G14/OPS-01）、产品告警（DAT-19）、生产容量基准（ING-13/ING-12）、管理平台业务 UI。
