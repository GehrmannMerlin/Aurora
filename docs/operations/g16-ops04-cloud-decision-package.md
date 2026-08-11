---
title: G16 / OPS-04 Cloud Decision Package（已批准）
status: approved
implementation-status: in-progress
approval-status: approved
owner: cloud/operations
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to: Aurora 正式第一版生产云基础设施的云厂商、区域、账号、网络、托管服务、IaC、边缘/安全与部署授权决策
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../architecture/deployment.md
  - ../architecture/aws-region-account-network-iac-foundation.md
  - ../adr/ADR-022-aws-account-region-network-and-iac.md
  - ../adr/ADR-023-managed-compute-and-managed-data-services.md
  - ../adr/ADR-024-edge-dns-tls-secrets-and-encryption.md
  - ../operations/public-preview-single-host-deployment.md
  - ../adr/README.md
supersedes: none
review-cycle: cloud-foundation-or-approval
---

# G16 / OPS-04 Cloud Decision Package

## 0. 本包定位与效力

- 本轮 PHASE C 的一次性完整决策包。因 ADR-022/023/024 均为 `proposed / not-started / awaiting-user-approval`，OPS-04 planning 记为 **`awaiting-user-cloud-decision`**。
- **本包不自行批准任何选项。** 用户明确批准后：更新 ADR-022/023/024 为 `accepted` → OPS-04 正式规格 [aws-region-account-network-iac-foundation.md](../architecture/aws-region-account-network-iac-foundation.md) 转 `approved` → 才允许进入 `writing-plans` 与 IaC 实施。
- **批准前禁止**：创建 Terraform/Pulumi/CDK 工程、创建任何云资源、创建 Migration、创建 production secret、运行 `writing-plans`、把单机 Preview 标成生产 G16 foundation。
- 所有缺口一次列完；每项给出 approved AWS 设计、真实 Alibaba Preview 事实、方案 A/B、影响与 Claude 推荐。

> **2026-08-11 用户批准（append-only）**：用户正式批准本包 D1—D11 全部推荐方案（含核心云厂商选择：正式生产平台保持 **AWS**）。ADR-022/023/024 已更新为 `accepted / in-progress / approved`；OPS-04 正式规格已转 `approved`；OPS-04 planning 由 `awaiting-user-cloud-decision` 进入实施。本包继续保留 D1—D11 决策记录与影响分析作为实施依据。

## 1. 现状核心事实

| 维度 | Approved 长期设计（已冻结） | 当前真实 Preview 事实 |
|---|---|---|
| 云厂商 | **AWS 单一主云**（TD-001 = A，已批准；deployment.md 正式承载） | **阿里云单主机** ECS 47.238.145.24（`public-preview` 临时桥接，2026-08-08 用户授权） |
| 运行形态 | 托管容器 + 托管数据服务：S3/CloudFront、ECS/Fargate、RDS PostgreSQL Multi-AZ、ElastiCache Redis、私有 S3 | 单机 Docker Compose：postgres 17.10 + migrate + ingestion-api + ingestion-worker；共享 Lumina nginx 边缘；certbot TLS |
| 域名 | 生产域名未决（D4） | `aurora.ah.cn`（Preview 状态页）、`ingest.aurora.ah.cn`（ingestion-api），A 记录指向 47.238.145.24 |
| 账号/环境 | 至少非生产 + 生产 AWS 账号隔离（approved） | 单机无账号概念 |
| 区域 | 单主区域、生产多可用区；主区域 `deferred`（TDR-GAP-01） | 阿里云（区域未知/不适用） |
| IaC | CDK TypeScript 为派生推荐（`requires-accepted-adr`） | 无 IaC；`deploy/preview/` 脚本 + 手工 rsync/Docker |
| 身份/秘密 | GitHub OIDC 短期身份、Secrets Manager + KMS（approved 方向） | 宿主机 `shared/.env`（chmod 600）、SSH `lumina_ops_ed25519`、`PREVIEW_SSH_PRIVATE_KEY` |
| 状态 | OPS-04 = `started / temporary-preview-bridge-active`（formalization-readiness §G16）；计数 62/16 | Preview ≠ production、≠ OPS-04 completed |

## 2. 用户级架构决策（必须先决）

**正式第一版生产云平台使用哪个云厂商？**

- **方案 A：保持正式 AWS** —— 延续 TD-001=A 与 deployment.md、ADR-022/023/024、Backend Design、测试/部署设计全部 approved 基线；Preview 继续作为临时桥接，OPS-05 用 approved CI/CD 替换。
- **方案 B：正式改定阿里云（或其它单一云）** —— 把正式生产架构整体迁移到阿里云；需要重写/新开 ADR-022/023/024 的云厂商前提、区域、账号模型、托管服务边界、OIDC/DNS/TLS 方案，并把现有阿里云单机升级为正式 Multi-AZ 生产形态。

这是用户级决策，Claude 不代决（见 §6 推荐仅供评估）。

## 3. 逐项决策（D1—D11）

### D1：AWS Account 现状

- **Approved 设计**：`deployment.md §2` 要求至少非生产与生产 AWS 账号隔离；是否增设管理/日志备份账号为 `requires-accepted-adr`。当前仓库**无任何 AWS 账号、无 IaC**。
- **Preview 事实**：阿里云单账号 ECS；无组织/账号隔离概念。
- **方案 A（AWS）**：非生产账号（staging/CI/PR）+ 生产账号；各自独立 VPC/KMS/秘密/数据。**成本**：双账号 IAM/quota 管理费用，无资源时接近零。**迁移**：全新创建，无历史包袱。**OIDC**：GitHub OIDC 分环境角色（approve 后由 ADR-024 落位）。**DNS/TLS**：无影响（DNS 独立于账号）。
- **方案 B（阿里云）**：RAM 子账号/资源组隔离非生产与生产；等价于 AWS 账号隔离。**成本**：RAM 免费。**迁移**：现有单机可演进。**OIDC**：阿里云 RAM Role 通过 GitHub OIDC 或 STS 扮演（需新 ADR）。**DNS/TLS**：阿里云 DNS/CAS 或继续 certbot。
- **影响共性**：无论 A/B，都必须把 Preview 与 Production 在身份、数据、秘密上隔离。
- **Claude 推荐**：方案 A（双 AWS 账号），与全部 approved 设计与 ADR-022 候选一致；若用户选 B 则对应阿里云 RAM 资源组模型。

### D2：AWS Region（主区域）

- **Approved 设计**：第一版单主区域、生产多可用区；主区域由目标用户地域、数据驻留、服务可用性、延迟、成本决定（`deferred`，TDR-GAP-01）。
- **Preview 事实**：阿里云实例在中国大陆区域（IP 归属浙江，区域未公开）。
- **方案 A（AWS）**：按用户目标地域/数据驻留选择（如 `ap-northeast-1` 东京 / `ap-southeast-1` 新加坡 / `us-east-1` 等；若选 AWS 中国区则有 ICP 与可用性差异）。**影响**：数据驻留合规、延迟、备份/DR 落位、成本单价。
- **方案 B（阿里云）**：主区域 `cn-hangzhou`（现有实例所在）或其它 `cn-*`/国际区域；继续沿用现有部署地。**影响**：与现有 Preview 同区、ICP/数据驻留清晰，但与国际用户延迟相关。
- **Claude 推荐**：由用户按目标用户与数据驻留定；若保持 AWS 且主要用户在中国大陆，需明确 AWS 中国区（ICP）或就近国际区（新加坡/东京）的取舍；若主要用户即现有阿里云 Preview 受众，方案 B 主区域直接落 `cn-hangzhou`。

### D3：Account/Environment 隔离

- **Approved 设计**：四类环境（本地/CI/预发布/生产），至少非生产与生产账号隔离；任何环境不得共享生产数据库、Session Redis、BullMQ、对象 Bucket 或加密密钥。
- **Preview 事实**：单一 `public-preview` 环境标识，无隔离。
- **方案 A（AWS）**：staging 与 production 分账号，CI/PR 用临时环境。**影响**：blast radius/费用/IAM 隔离清晰；跨账号备份与 OIDC 角色复杂度增加。
- **方案 B（阿里云）**：同账号 RAM 资源组 + 独立 VPC/KMS（KMS 或等价）/secret，staging 与 production 用独立资源组。**影响**：单一账号故障域较大，需依赖资源组/权限边界弥补。
- **Claude 推荐**：与 D1 一致；无论厂商，生产与非生产在身份/数据/秘密上必须硬隔离。

### D4：生产域名

- **Approved 设计**：生产域名未决（deployment.md 未指定）；SDK 数据接入使用独立公开主机，不共享浏览器 Session。
- **Preview 事实**：`aurora.ah.cn`（Preview 状态页）、`ingest.aurora.ah.cn`（ingestion-api），`ah.cn` 后缀为既有域。
- **方案 A/B**：生产需要独立权威域名（如 `aurora.example` 或沿用 `ah.cn` 子域但明确 production 与 preview 分离）；若沿用 `ah.cn`，需确认域名所有权（D5）与 production 记录不指向 Preview 主机。
- **影响**：production 域名决定 TLS 证书、CloudFront/ALB/边缘路由、SDK 上报主机与浏览器 Origin 校验。
- **Claude 推荐**：生产与 Preview 域名必须分离；沿用 `ah.cn` 系域名时生产记录与 Preview 记录并行但指向不同目标（生产边缘 vs Preview 单机），且 DNS ownership 明确（D5）。

### D5：DNS ownership

- **Approved 设计**：DNS 与 TLS 由部署设计定义（Route 53 + ACM 方向，`requires-accepted-adr`）。
- **Preview 事实**：DNS 记录由用户持有的 `ah.cn` 域名在第三方 DNS（阿里云 DNS 或其它）管理；certbot http-01 webroot 续期。
- **方案 A（AWS）**：生产 DNS 迁到 Route 53（或保持第三方托管 + 手工记录），ACM 签发证书。**影响**：DNS 迁移会影响现有 `ah.cn` 记录，需与 Preview 桥接并行管理。
- **方案 B（阿里云）**：阿里云 DNS（云解析）+ 数字证书（免费证书或 certbot）。**影响**：与现有 Preview DNS 同域，切换更平滑。
- **Claude 推荐**：DNS ownership 由用户/组织决定；无论 A/B，Preview 与 Production 记录并存、证书续期责任明确，避免生产记录误指 Preview 主机。

### D6：Staging 域名规范化

- **Approved 设计**：预发布环境与生产同形态、不共享数据；域名规范未定。
- **Preview 事实**：无 staging 域名；只有 `aurora.ah.cn` / `ingest.aurora.ah.cn`。
- **方案 A/B**：staging 域名规范化（如 `staging.aurora.example` + 生产 `app.aurora.example` / `ingest.aurora.example`），且 staging 与 production 独立 TLS。
- **Claude 推荐**：staging 用独立子域与独立证书，绝不复用生产证书/记录。

### D7：成本边界

- **Approved 设计**：资源命名/标签含 cost-center（deployment.md §4）；成本预算 `deferred`。
- **Preview 事实**：单台 ECS + 共享 nginx；无托管服务费用（无 RDS/Redis/ALB/CDN/对象存储）。
- **方案 A（AWS）**：RDS Multi-AZ + Fargate + ElastiCache（若 provision）+ CloudFront/ALB + S3 的月成本显著高于单机 Preview；需要成本预算与资源标签、成本告警。
- **方案 B（阿里云）**：RDS 高可用版 + ECS/容器服务 + Redis + CDN/ALB 等价物，成本结构类似但单价与计费方式不同。
- **Claude 推荐**：先定成本上限（OPS-04 实施时固化预算与告警）；D8 的 staging 缩容与 D10 的 provision-now/deferred 直接影响首月成本。

### D8：生产韧性与 staging 缩容

- **Approved 设计**：生产 Multi-AZ；staging 与生产同形态（测试/部署设计 §4.1），但成本可治理。
- **Preview 事实**：单机无 Multi-AZ、无 DR。
- **方案 A/B**：生产使用 Multi-AZ RDS + 多子网 ECS/Fargate；staging 使用单 AZ、最小实例、非工作时段可停；避免 staging 完整复制生产全部付费资源。
- **Claude 推荐**：生产 Multi-AZ（正式 SLO 要求），staging 最小可用形态（ADM-022 候选即如此）；Preview 保留单机直至 OPS-05 替换。

### D9：IaC 工具

- **Approved 设计**：派生推荐 AWS CDK（TypeScript），因前后端主语言为 TypeScript、可 synth/diff/断言；`requires-accepted-adr`。
- **Preview 事实**：无 IaC；`deploy/preview/scripts/deploy-preview.sh` 手工 rsync + Docker compose。
- **方案 A（AWS）**：CDK TypeScript 管理账号内基础设施（VPC/子网/SG/Endpoint、ECS、RDS、S3、CloudFront/ALB、Route 53、ACM、KMS/Secrets、OIDC 角色）。
- **方案 B（阿里云）**：阿里云 ROS（资源编排）/ Terraform（多云）/ CDKTF（TypeScript）。**影响**：若选 B，需要新 IaC ADR；若坚持 TypeScript 栈，CDKTF 比 ROS 更贴近现有技术栈。
- **Claude 推荐**：方案 A 用 CDK TypeScript（与 approved 派生推荐和 TS 栈一致）；若用户改选阿里云，推荐 CDKTF 而非 ROS（保持 TS + 多云可迁移），并以新 ADR 正式化。

### D10：Provision-now vs deferred

- **Approved 设计**：部署拓扑定义 RDS PostgreSQL、ElastiCache Redis（Session/BullMQ/缓存）、私有 S3；但 ADR-023 候选为"不立即 provision ElastiCache"，ADR-032 用户 YAGNI 约束"只有真实 consumer 才 provision"。
- **Preview 事实**：本地 postgres 容器；无 Redis、无远程对象存储（"默认不提供，只有真实 production path 需要时才评估"）。
- **方案 A（AWS）**：OPS-04 只 provision OPS-05 需要的网络基座 + 最小托管服务；RDS 生产版可先建，ElastiCache/S3 按 consumer 出现再建。**影响**：首月成本最低、不建无 consumer 付费资源。
- **方案 B（阿里云）**：等价——只建当前真实应用（ingestion-api/worker + RDS）需要的最小资源；console/platform-api 尚无真实实现，不为它们建假资源。
- **Claude 推荐**：provision-now 仅限当前真实消费者（PostgreSQL 生产实例按需评估；Redis/对象存储/Source Map 桶 defer 到真实 consumer）；不创建无 consumer 的付费资源（延续 ADR-032 用户 YAGNI 约束）。

### D11：生产部署授权方式

- **Approved 设计**：GitHub OIDC 短期身份（TD-002=A）、受保护生产 Environment 人工批准、不可变制品分阶段晋级。
- **Preview 事实**：`deploy-preview.yml` 在 main CI PASS 后自动部署到 Preview（exact SHA、serial concurrency）；Preview 无人工生产批准。
- **方案 A/B**：生产部署走 GitHub Actions 受保护 Environment + OIDC 角色 + 人工 approval（保护分支 + 受保护生产 env），与 Preview CD 分离；Preview CD 继续只对 main/Preview 生效。
- **Claude 推荐**：生产批准走独立受保护 Environment（人工 gate），Preview CD 与生产 CD 用不同身份/环境，避免 Preview 自动部署路径碰生产。

## 4. 影响汇总（横切）

| 影响域 | 方案 A（保持 AWS） | 方案 B（改定阿里云） |
|---|---|---|
| 成本 | 新增 AWS 托管服务费用；双账号 IAM；无 Preview 停机 | 复用现有阿里云实例与域名；升级为 Multi-AZ 生产形态费用 |
| 迁移 | 全新 IaC 创建；Preview 保持运行直至 OPS-05 替换 | 在现有单机基础上演进为生产形态；需重写 ADR-022/023/024 前提 |
| 现有 Preview | 保持不变，作为临时桥接；不自动并入 production | Preview 可成为 production 演进起点，但必须与 production 身份/数据隔离 |
| RDS/Redis/Object Storage | RDS PostgreSQL（Multi-AZ）、ElastiCache Redis（defer）、私有 S3（按 consumer） | RDS 等价（阿里云 RDS/高可用）、Redis（Tair/Redis）、OSS 私有桶 |
| OIDC | GitHub OIDC → AWS 分环境角色（ADR-024 落位） | GitHub OIDC → 阿里云 RAM Role 或 STS 扮演（新 ADR） |
| DNS/TLS | Route 53 + ACM（或第三方 DNS 手工记录） | 阿里云 DNS + 免费证书/certbot |
| IaC | CDK TypeScript | CDKTF / ROS / Terraform（新 ADR） |

## 5. 批准后执行路径

1. 用户对 D1—D11（含核心云厂商选择）逐项批准或整体批准；
2. 更新 ADR-022/023/024 为 `accepted / not-started / approved`，OPS-04 规格转 `approved`；
3. 唯一允许调用一次 `superpowers:writing-plans`，创建 OPS-04 实施计划（4—5 Tasks：环境/账号/区域契约、网络+边缘+DNS/TLS、托管数据服务+秘密、IaC 基座+状态/身份、定向验证+文档）；
4. FAST INLINE 实施（不派 Agent），创建 `feature/g16-cloud-foundation`，本地 targeted gates PASS 后 commit/push/PR；
5. OPS-04 退出证据：从空环境重复创建、CDK synth/diff、网络可达性矩阵、`POST /v1/batches` 冒烟。

## 6. Claude 总体推荐（仅供评估，不代决）

- **云厂商**：推荐 **方案 A（保持正式 AWS）**。理由：TD-001=A 与 deployment.md、ADR-022/023/024、Backend Design、测试/部署设计全部 approved 基线均以 AWS 为前提；ADR-022/023/024 与 OPS-04 规格的候选与五域评审结论（PASS-WITH-CONCERNS，无 blocking）都建立在 AWS 之上。改定阿里云意味着重做这批 ADR 的前提与云厂商映射，且没有其它 approved 依据。若用户判断正式用户与数据驻留都在中国大陆且希望运维收敛，方案 B 也可行，但需要新 ADR 与规格迁移。
- **主区域**：由目标用户/数据驻留决定；若 AWS 且主要用户在中国大陆，明确 AWS 中国区（ICP 合规）vs 就近国际区的取舍。
- **OPS-04 本轮范围**：仅网络基座 + 最小真实 consumer 托管服务 + IaC 基座；不越界 OPS-05/06/07，不实现 G08/G04。
- **Preview**：全程保持可访问、与 production 身份/数据隔离；只作现状与迁移输入，不当作 production G16 foundation。

> 本包不修改任何 ADR 状态；在用户批准前 ADR-022/023/024 与 OPS-04 规格保持 `proposed / not-started / awaiting-user-approval`。
