---
title: OPS-04 现状审计、部署资产盘点与 IaC 迁移面
status: working-snapshot
implementation-status: not-started
owner: cloud/operations
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to: Aurora G16/OPS-04 的权威文档真实性审计、现有部署资产清单、IaC 迁移面与风险清单（不依赖云厂商选择的部分）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../architecture/deployment.md
  - ../architecture/aws-region-account-network-iac-foundation.md
  - ../operations/public-preview-single-host-deployment.md
  - ../operations/preview-continuous-delivery.md
  - ../releases/release-migration-and-rollback.md
  - ../adr/README.md
supersedes: none
review-cycle: cloud-foundation-or-approval
---

# OPS-04 现状审计、部署资产盘点与 IaC 迁移面

> 本文只做**现状审计与盘点**，不创建 IaC、不创建云资源、不改 ADR 状态。它是不依赖云厂商选择的 OPS-04 工作产物，作为 G16_APPROVAL_PACKAGE（[g16-ops04-cloud-decision-package.md](g16-ops04-cloud-decision-package.md)）的配套输入。

## 1. 文件真实性审计

核对关键权威文档声明的状态与仓库真实内容的一致性。

| 文档 | 声称状态 | 审计结论 |
|---|---|---|
| `docs/architecture/deployment.md` | approved；无 AWS 资源；主区域/IaC `deferred`/`requires-accepted-adr` | **一致**。仓库无 `infra/`、无 IaC 工程、无 AWS 资源（见 §2） |
| `docs/adr/ADR-022/023/024` | `proposed / not-started / awaiting-user-approval`；批准前不运行 writing-plans | **一致**。frontmatter 与正文一致；五域评审 PASS-WITH-CONCERNS 已记录但未转 accepted |
| `docs/architecture/aws-region-account-network-iac-foundation.md`（OPS-04 规格） | `proposed / awaiting-user-approval`；批准前不创建 IaC/不运行 writing-plans | **一致** |
| `docs/operations/public-preview-single-host-deployment.md` | temporary snapshot；不是 OPS-04/G16 completed | **一致**。与真实 Preview（47.238.145.24、`aurora.ah.cn`/`ingest.aurora.ah.cn`、Docker Compose、共享 Lumina nginx）一致 |
| `docs/operations/preview-continuous-delivery.md` | active；main CI PASS → 自动部署 exact SHA；不关闭叶子 | **一致**。`.github/workflows/deploy-preview.yml` 真实存在（workflow_run + workflow_dispatch，serial concurrency，拒绝 dirty checkout） |
| `docs/architecture/formalization-readiness.md` §G16/G14 | G16 = `started / temporary-preview-bridge-active`；OPS-01 completed；OPS-02 implementation completed / acceptance remote-pending；计数 62/16 | **一致**（截至 2026-08-11 与 PR #18 远程状态相符） |
| `docs/releases/release-migration-and-rollback.md` §开头 | "流水线、Environment、OIDC 角色、制品仓库和真实命令均不存在；发布基础设施为 `requires-accepted-adr`" | **部分过期**。`.github/workflows/{pr,main,nightly,release}.yml`（G14 OPS-01）与 `release.yml` 内 `sdk-release-gate`/`sdk-publish`（G15 OPS-03）已在 feature branch 真实存在；但**生产部署流水线、OIDC 角色、制品仓库与真实生产命令**确实不存在。该句应改为"生产部署/发布基础设施不存在；CI 质量与 SDK 发布 workflow 已在 feature branch"（见 §5 索引同步） |
| `docs/README.md` | 有 OPS-01/OPS-02/Public Preview/Preview CD 条目 | **缺口**。无 G16/OPS-04 条目；G15/OPS-03 规格也未在 §2 权威表索引（见 §5） |
| `docs/architecture/ci-quality-workflows.md` | OPS-01 implemented | **一致**。`.github/workflows/` 四 workflow 真实存在（G14 feature branch）；AGENTS.md 记录 8 job 通过 |

**审计结论**：除 `release-migration-and-rollback.md` 的"流水线均不存在"表述随 G14/G15 出现轻微过期，以及 `docs/README.md` 缺 G16/OPS-04 索引外，无其它虚构状态。OPS-04 相关文档"无 IaC、无 AWS 资源、ADR 未 accepted、Preview 是临时桥接"的声明全部真实。

## 2. 现有部署资产盘点（真实）

### 2.1 CI 工作流（G14 OPS-01，implemented-in-feature-branch / 未 merge main）

| 文件 | 用途 |
|---|---|
| `.github/workflows/pr.yml` | PR 质量门禁 |
| `.github/workflows/main.yml` | main 质量门禁（trigger Preview CD 的 workflow_run） |
| `.github/workflows/nightly.yml` | 夜间扩展验证（含完整兼容矩阵 OPS-02） |
| `.github/workflows/release.yml` | Release Quality Gate（G14 增加兼容矩阵 job；G15 分支扩展 `sdk-release-gate` + `sdk-publish`） |

### 2.2 Preview 桥接资产（temporary，active on main）

| 资产 | 内容 |
|---|---|
| `.github/workflows/deploy-preview.yml` | Preview Continuous Delivery：workflow_run（main PASS）+ workflow_dispatch；exact CI-passed SHA、拒绝 dirty checkout、serial concurrency；`PREVIEW_SSH_PRIVATE_KEY` |
| `deploy/preview/Dockerfile.{console,ingestion-api,ingestion-worker,migrate,platform-api,platform-worker}` | 多阶段构建（console/platform-api/platform-worker 的 Dockerfile 已存在，但对应应用在 main 尚无真实业务实现，未作为生产证据） |
| `deploy/preview/compose.yaml` + `compose.aurora-override.yml` | 服务编排：postgres / migrate / ingestion-api / ingestion-worker；Aurora vhost ownership override |
| `deploy/preview/entry/{ingestion-api,ingestion-worker,migrate,platform-api,platform-worker}/start-*.js` | 容器入口脚本 |
| `deploy/preview/nginx/{aurora-acme.conf,aurora-tls.conf,console-default.conf,preview-status.html}` | 共享 Lumina nginx 边缘的 Aurora vhost 与 Preview 状态页 |
| `deploy/preview/scripts/{deploy-preview.sh,rollback-preview.sh}` | 受控部署/回滚入口（`pnpm deploy:preview` / `deploy:preview:rollback`） |
| `deploy/preview/ssh/known_hosts` | host pinning（47.238.145.24） |
| `deploy/preview/.env.example` | 非秘密配置模板（真实秘密只在服务器 `shared/.env`） |
| `docs/operations/{public-preview-single-host-deployment.md,preview-continuous-delivery.md,public-preview-deployment-manifest.md}` | 桥接运行文档 |

### 2.3 无 IaC 工程

- 全仓**没有** `infra/`、`cdk/`、`terraform/`、`cloudformation/` 目录；没有任何 IaC 代码。
- 部署全部依赖 `deploy/preview/` 脚本 + 服务器手工 rsync/Docker，无 synth/diff/drift。

## 3. IaC Migration Surface Inventory

正式 IaC 基座（OPS-04，方案 A 为 CDK TS）必须覆盖的映射面，从现有 Preview 资产反推：

| Preview 现状 | 正式 IaC 迁移面 | 说明 |
|---|---|---|
| compose 服务 `postgres`（容器内 17.10，private network） | RDS PostgreSQL 生产 Multi-AZ（或按 D10 评估） | 私网、删除保护、备份/恢复（backup-and-recovery） |
| compose 服务 `migrate`（单次执行） | 部署期 Migration job 对 RDS 执行（CI/release 阶段） | 复用 `node-pg-migrate` + SQL-first（ADR-010） |
| compose 服务 `ingestion-api` / `ingestion-worker` | ECS/Fargate 任务（或等价） | 需 VPC/subnet/SG/Endpoint、IAM 角色、服务发现 |
| compose 服务 `console` / `platform-api` / `platform-worker`（Dockerfile 已备、应用未实现） | 预留边界，不建假资源（D10 YAGNI） | console 未来走 S3+CloudFront；platform 未来走 ALB 后 ECS |
| 共享 Lumina nginx 边缘 + certbot | CloudFront/ALB + Route 53 + ACM（或阿里云等价） | 生产与 Preview 域名分离（D4/D5/D6） |
| `shared/.env`（chmod 600） | 非秘密 → Parameter Store；秘密 → Secrets Manager + KMS | 禁止把 secrets 落 IaC 明文 |
| rsync 源码 + source checksum | 不可变制品晋级（ECR digest / S3 content-hash） | release-migration-and-rollback |
| `deploy-preview.yml` SSH identity（`aurora-preview-deploy`） | GitHub OIDC 分环境角色（production / staging / CI） | TD-002=A；无长期云密钥 |
| 无 Redis / 无远程对象存储 | ElastiCache Redis / 私有 S3（**defer** 至真实 consumer） | ADR-023/032 YAGNI；Session 存储与 BullMQ/缓存隔离 |
| 无账号概念 | 双 AWS 账号（非生产/生产）或 RAM 资源组 | D1/D3 |
| 无 region 声明 | 主区域（TDR-GAP-01） | D2 |

## 4. G16 风险清单

| # | 风险 | 等级 | 说明 / 缓解 |
|---|---|---|---|
| R1 | 云厂商决策未决 → OPS-04 planning blocked | 高 | 本轮仅 Approval Package；用户批准前不写 IaC |
| R2 | 主区域未决（TDR-GAP-01） | 高 | 数据驻留、延迟、DR、成本无法落位；需用户定 |
| R3 | ADR-022/023/024 未 accepted | 高 | 任何 AWS/阿里云资源创建均无授权；批准前保持 proposed |
| R4 | 托管服务成本 vs 单机 Preview | 中 | RDS Multi-AZ + Fargate + 边缘成本显著高于单机；需成本边界（D7）与 staging 缩容（D8） |
| R5 | Preview 单机 SPOF + 共享 Lumina nginx 边缘 | 中 | 不破坏现有 Preview；保持可访问直至 OPS-05 替换；不得把 Preview 当 production 证据 |
| R6 | main CI 当前红（fetch TS2304 + 过期 doc-contract 断言） | 高 | 由 PR #18（G14）合并修复；本地已修并推送（08b0251），remote 复跑中 |
| R7 | G14/G15 CI/发布 workflow 未 merge main | 中 | main 现仅有 `deploy-preview.yml`；pr/main/nightly/release 在 feature branch；release-migration doc 表述过期 |
| R8 | 生产域名/DNS ownership 未决（D4/D5/D6） | 中 | production 与 Preview 记录必须分离；证书续期责任明确 |
| R9 | GitHub OIDC 角色/KMS policy/Secrets 布局为 implementation-detail | 中 | 必须经 IaC 评审落位，禁止手工长期修改（deployment.md §4） |
| R10 | 生产删除保护/保留策略/高风险 IAM 审批无任何实现 | 中 | deployment.md §4 已要求；OPS-04/05 实施时落位 |

## 5. 文档索引同步（本轮 OPS-04）

- `docs/README.md` §2 权威表**缺 G16/OPS-04 条目**：需新增"G16/OPS-04 云基础设施基础"条目，指向 OPS-04 规格（proposed）与 Approval Package（awaiting-user-approval）。
- `docs/README.md` §2 权威表**无 G15/OPS-03 条目**：SDK 发布工程规格 `docs/releases/sdk-package-versioning-and-release.md` 未索引（该规格在 G15 feature branch，未 merge main；索引同步与 G15 合并同批处理）。
- `docs/releases/release-migration-and-rollback.md` 开头"流水线均不存在"表述随 G14/G15 过期，待 G14/G15 合并后修正为"生产部署/发布基础设施不存在；CI 质量与 SDK 发布 workflow 已在 feature branch"。
- 状态同步纪律：本轮不修改 AGENTS.md/AURORA_RULES.md 的 G16 状态（`started / temporary-preview-bridge-active` 不变），不关闭任何叶子；计数保持 62/16，直到 G14 远程 PASS 后按用户规则更新。

> **2026-08-11 追加（OPS-04 实施后）**：用户已批准 G16/OPS-04 Cloud Decision Package D1—D11；ADR-022/023/024 转为 `accepted / in-progress / approved`；OPS-04 正式规格转 `approved`。`docs/README.md` 已新增 G16/OPS-04 权威索引条目。OPS-04 IaC 基础已实施为 `tooling/aws-infra`（`@aurora/aws-infra`，CDK TS）：Network/Compute/Data/Identity 四栈 × staging/production，`pnpm synth` 无凭据生成 8 个 CloudFormation 模板并通过定向测试（29 个）。OPS-04 implementation = completed（本增量）；acceptance 待独立 IaC 评审 + OPS-05 provisioning 证据（从空环境重复创建、`POST /v1/batches` 冒烟）。**计数保持 62/16**；阿里云 Preview 保持 temporary-operational-snapshot。G15/OPS-03 索引与 release-migration 表述修正仍待 G14/G15 合并。
