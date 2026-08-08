---
title: Aurora AWS 区域、账号、网络与 IaC 基础设施基础（OPS-04）
status: proposed
implementation-status: not-started
approval-status: awaiting-user-approval
owner: cloud/operations
created: 2026-08-07
last-reviewed: 2026-08-07
applies-to: Aurora 第一版生产云的基础设施边界——主区域、账号/环境模型、网络模型、IaC 工具、托管计算、托管 PostgreSQL、Redis/对象存储的提供边界、秘密与加密、边缘/DNS/TLS、环境配置、命名与标签、成本、生命周期、漂移与可重复创建
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora ADR 规范.md'
  - '../../Aurora 测试规范.md'
  - ../../docs/architecture/deployment.md
  - ../../docs/architecture/system-overview.md
  - ../../docs/architecture/platform-backend.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/releases/release-migration-and-rollback.md
  - ../../docs/operations/backup-and-recovery.md
  - ../../docs/testing/test-strategy.md
  - ../../docs/superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
  - ../../docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md
  - ../../docs/adr/README.md
supersedes: none
review-cycle: cloud-foundation-or-approval
---

# Aurora AWS 区域、账号、网络与 IaC 基础设施基础（OPS-04）

## 1. 定位、效力与当前状态

本文是 OPS-04 叶子模块（AWS region/account/network/IaC foundation）的正式规格草案。它把已批准部署架构 [deployment.md](deployment.md) 中标记为 `deferred`/`requires-accepted-adr` 的增量——主区域、账号/环境细化、网络模型、IaC 工具、托管计算、托管 PostgreSQL、Redis/对象存储提供边界、秘密与加密、边缘/DNS/TLS——正式化为可审批的基础设施边界。

**当前状态**：`status: proposed`、`implementation-status: not-started`、`approval-status: awaiting-user-approval`。本文不授权创建任何真实 AWS 资源、不授权编写 IaC 工程、不进入 `writing-plans`。只有用户对本轮 Cloud Decision Package（见[决策包](#19-待用户批准决策包索引)）明确批准，并更新 required ADR 为 `accepted` 后，本文才转为 `approved` 并可作为后续 OPS-05 与 IaC 实施的权威依据。

**临时部署路径（2026-08-08，状态追加）**：用户选择先使用阿里云单主机公网预览桥接（`public-preview`，见 [public-preview-single-host-deployment.md](../operations/public-preview-single-host-deployment.md)），以获得当前已实现应用的公网运行环境。本桥接不改变本文状态，不表示用户接受或拒绝本 OPS-04 正式基础设施方向；正式 G16 基础设施架构保持 `deferred`。OPS-04 不因本桥接标记 completed；当 G16/OPS-05 重新评估正式基础设施时，再更新本文。

**声明边界**：本文冻结的是基础设施**边界与决策**，不是资源清单。本仓库当前真实可部署应用只有 `apps/ingestion-api` 与 `apps/ingestion-worker`；`console`、`platform-api` 尚无真实实现，本文只为未来 workload 预留边界，不把它们标为可部署，也不为其创建假资源。

## 2. 目标（A）

Aurora 第一生产云的长期目标：

1. 基础设施可以从空环境通过版本化 IaC 重复创建；
2. 提供 staging 与 production 两个稳定目标环境；
3. 可审计、可回滚、最小公网面；
4. 为未来持续部署（OPS-05）提供稳定、可复用、不漂移的目标环境；
5. 生产数据、秘密与运行责任与其它环境隔离；
6. 不承诺跨区域主动流量（第一版单主区域）。

## 3. 现有 approved 基线（已冻结，本规格不重开）

以下来自 [deployment.md](deployment.md) 与已批准测试/部署/发布设计，已 approved，直接继承：

- **云方向**：AWS 单一主云的托管容器与托管数据服务模型（已批准方案 A）；
- **环境划分**：本地/临时、CI、预发布（staging）、生产四类环境；至少隔离非生产与生产 AWS 账号；任何环境不得共享生产数据库、Session Redis、BullMQ、对象 Bucket 或加密密钥；
- **区域形态**：第一版单主区域、生产多可用区；主区域取决于目标用户地域、数据驻留、服务可用性、延迟和成本，当前 `deferred`；区域级恢复依靠跨区域备份与 IaC 重建，不宣称自动故障转移；
- **运行拓扑（设计基线）**：SPA = 私有 S3 + CloudFront；平台 API = ALB 后 ECS/Fargate `platform-api`；后台任务 = 独立 ECS/Fargate `platform-worker`；平台关系数据 = RDS PostgreSQL Multi-AZ；Session/BullMQ/缓存 = ElastiCache Redis（隔离角色/命名空间）；Source Map 等私密对象 = 私有 S3；数据接入和处理物理技术已由 ADR-008 起逐步收口；
- **安全与供应链**：只有必要入口公开；生产任务使用最小 IAM，人与工作负载身份分离；跨账号部署使用 GitHub OIDC 短期凭据；配置与秘密分离；删除保护、保留策略和高风险 IAM 变化需独立审批；
- **可靠性目标**：单区域多 AZ 运行故障 PostgreSQL `RPO ≤ 5 分钟`、`RTO ≤ 60 分钟`；区域级第一版 `RPO ≤ 24 小时`、`RTO ≤ 8 小时`（均为 approved 目标，**`requires-benchmark`，非已验证保证**，见 [test-strategy.md](../testing/test-strategy.md) §6；测试评审 Minor #1）；
- **数据接入物理形态**：PostgreSQL 事务性 Inbox（ADR-008 accepted）、`POST /v1/batches` 公开传输与客户端上报密钥（ADR-009 accepted）、PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first（ADR-010 accepted）、Fastify 接入服务（ADR-011）、Node.js 24 Worker 运行时（ADR-012）均已实施并通过真实 PostgreSQL 17.10 验证。

## 4. AWS account/environment 模型（B）

### 4.1 已冻结

deployment.md §2 已 approved：至少隔离非生产账号与生产账号。本规格在此基础上冻结第一版账号模型候选，由用户决策包决定最终形态。

### 4.2 候选

- **方案 A：双 AWS 账号（非生产 + 生产）**。staging/CI/PR 环境共享非生产账号；生产独占生产账号。非生产与生产各自独立 VPC、KMS、秘密、数据库、Redis、Bucket。是否增设管理账号、日志/备份专用账号为 `requires-accepted-adr`（本规格建议第一版不增设，保持最简）。
- **方案 B：单 AWS 账号分环境隔离**。所有环境在一个账号内，靠 VPC 隔离与命名约定分区。成本与操作更简单，但 blast radius 大、生产与非生产共享 IAM/配额/费用边界，与 deployment.md 已 approved 的"至少隔离非生产与生产账号"冲突，**不作为第一版候选**。

### 4.3 本规格要求

- 权限隔离：非生产与生产使用独立 IAM；GitHub OIDC 按环境/工作流限制角色，生产角色与非生产角色分离；
- blast radius：生产变更不得影响非生产，反之亦然；
- 成本：生产与非生产成本分别归属、分别预算告警；
- 运维复杂度：双账号带来跨账号备份（RDS 跨账号/跨区域复制到备份账号）与 IaC 多账号 bootstrap，须在 OPS-04 中一并冻结；
- **备份目标与 RPO/RTO 一致性**：区域级 `RPO ≤ 24h / RTO ≤ 8h` 目标依赖每日加密恢复点副本到隔离备份账号/第二区域（backup-and-recovery.md §2）。**D2（Region）与 D3（账号模型）必须承诺备份账号与/或第二区域接收备份副本**，即使精确备份设计仍属 OPS-07（运维评审 Major #1）。精确备份机制不落位前，区域级目标保持 approved 目标、`requires-benchmark`；
- secret boundaries：生产秘密只存在生产账号 Secrets Manager/KMS；CI/非生产不得读取生产秘密。

## 5. Region（C）

**不能自行默选 Region。** 主区域由用户决策包 D2 决定。本文只冻结决策因素与候选评估框架：

- 目标用户/目标市场地域；
- 数据驻留与合规要求；
- 服务可用性：RDS/ECS/CloudFront/ACM/Route 53/Secrets Manager/KMS 在候选区域的可用性与服务名差异（尤其 AWS 中国区服务差异与 ICP 要求）；
- 延迟（目标用户与区域间）；
- 成本（区域间价差、跨区域流量、数据流出）；
- 团队位置与运维时区；
- 灾备：区域级恢复依赖跨区域备份与重建，需第二区域接收备份副本（**D2/D3 必须承诺备份账号/第二区域以支撑区域级 RPO/RTO**；精确备份设计属 OPS-07）；
- 后续 multi-region 主动流量：第一版 `deferred`。

用户批准 Region 后，把它作为 required ADR（见 §22）的最终决策写入，并同步到 [formalization-readiness.md](formalization-readiness.md) 消除其 §8 缺口 6（主区域与账号/运营责任；TDR-GAP-01 位于已批准测试/部署/发布设计 §4.2/§17——架构评审 Minor #9）。

## 6. IaC 工具（D）

候选：

- **方案 A：AWS CDK（TypeScript）**。已批准设计推荐（TDR §5.1）；与 Aurora 前后端 TypeScript 技术栈同构；产出可审查 CloudFormation；支持 synth 快照与 diff 评审；云厂商耦合高但厂商即 AWS。
- **方案 B：Terraform（HashiCorp）**。多云与多提供方通用，state 管理独立；与 Aurora TypeScript 栈异构，需额外工程语言；团队复杂度更高。
- **方案 C：原生 CloudFormation**。无额外语言，但可读性/可组合性弱、无 synth 校验层，不适合作为第一版 IaC 主语言。

比较维度：Aurora TypeScript 技术栈一致性、AWS 原生能力、可测试性（synth 断言）、drift 检测、state 管理、代码评审、迁移成本、团队复杂度、厂商耦合。**本规格推荐方案 A（CDK TypeScript）**，由用户决策包 D9 批准；IaC 选择属长期工具决策，纳入 required ADR（ADR-022）。在 ADR accepted 前不得创建 CDK 工程。

## 7. Network 模型（E）

冻结第一版网络边界（implementation-detail 级子网/SG 由 accepted ADR 与 IaC 评审产生，本规格冻结结构）：

- **VPC**：每个环境独立 VPC；生产与非生产 VPC 完全隔离；
- **Availability Zones**：生产使用 ≥2 AZ（Multi-AZ 基线已 approved，D8 细化 AZ 数）；staging 至少 2 AZ（D8 允许 staging 缩容为单 AZ/单实例时，同步调整此处表述——运维评审 Minor #8）；
- **子网分层**：public subnet（仅 NAT/ALB/入口必要资源）、private subnet（计算任务）、database subnet（RDS/Redis 仅私网）；
- **ingress**：只允许 CloudFront/ALB 等必要入口进入；数据库、Redis、Worker、私密对象无公网入口；**每个公开入口（CloudFront/ALB，含 ingestion 公开 host）前必须部署 WAF 与速率限制，且 ingestion 入口终止于 ALB/CloudFront，不直接暴露 ECS target**——该要求来自已批准 TDR §4.3"公共入口的 DDoS/WAF、速率限制、CSP/HSTS、TLS 和安全头参数需在安全评审中锁定"（安全评审 Major #1）；精确 WAF 规则为 IaC/安全评审细节；
- **egress**：出站显式允许；优先 VPC Endpoints（S3、Secrets Manager、KMS、ECR、CloudWatch Logs 等）；无必要不用 NAT（NAT 是持续成本）；**endpoint 数量保持最小——小型环境多接口 endpoint 的固定成本可能高于单个 NAT，按实际 workload 定尺寸，不把"优先 endpoint"当一刀切规则**（成本评审 F3）；
- **security groups**：最小化、显式来源、禁止 0.0.0.0/0 直通数据库/Redis；
- **ALB**：staging/production 各自 ALB；生产 ALB 位于私网或受控入口；
- **ECS task network**：任务使用 `awsvpc` 模式，私有子网；
- **RDS private only**：`publicly_accessible=false`；
- **Worker private only**：无公网端口；
- **Redis private only**：无公网端口（ElastiCache 第一版不 provision，见 §9）；
- **S3 public access block**：全部 bucket `BlockPublicAccess` 打开；
- **least privilege**：网络与 IAM 最小化。

## 8. Compute 基础（F）

冻结 Aurora 当前与未来 workload 的基础运行边界：

- **当前真实 workload**：`ingestion-api`（Fastify，接入 HTTP 服务）、`ingestion-worker`（Node.js 24 Worker 运行时）。二者当前通过真实 PostgreSQL 17.10 集成测试与本地 `pnpm build` 验证，但**没有容器镜像、没有 ECS 部署、没有生产运行**；
- **未来 workload 边界**：`platform-api`（ALB 后 ECS/Fargate）、`platform-worker`（独立 ECS/Fargate）、SPA 静态资源（私有 S3 + CloudFront）。console/platform-api 尚无真实实现，本规格只预留边界，不创建资源、不标记可部署；
- **运行形态候选**：ECS/Fargate 为主（避免管理 EC2 集群）；ECR 保存不可变镜像；
- **OPS-04/OPS-05 计算边界**：**OPS-04 只创建 ECS cluster/ECR 仓库/任务角色等基础资源；ECS Service 创建与部署设置（healthThreshold/minimumHealthyPercent/maximumPercent/circuit breaker）属 OPS-05 所有**，避免 OPS-05 回滚设置要求返工 OPS-04 资源（运维评审 Minor #2、架构评审 Minor #5）。"第一批部署 workload"指**未来 OPS-05 的部署目标**，不是本轮授权部署（运维评审 Minor #9）；
- **autoscaling 边界**：第一版 ECS 服务以最小稳定实例数起步，扩缩容参数由 ING-13/容量基准提供证据，不在本轮锁定；
- **health**：ECS 服务健康检查与 ALB target health 结合（属 OPS-05 部署设置）；
- **task execution role / task role**：分离——execution role 拉取镜像/读取秘密；task role 提供运行时最小权限；
- **graceful shutdown**：容器收到 SIGTERM 后完成 in-flight 处理再退出（Worker 已有 graceful shutdown 语义，见 ADR-012 实施）；
- **deployment target**：ECS 服务作为 OPS-05 不可变制品部署目标，镜像按 digest 晋级（deployment.md §5）。

## 9. PostgreSQL（G）

**复用已批准技术选型（engine family）**：PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first（ADR-010 accepted / implemented，**适用于数据接入/处理数据库**），不重新做 engine family 选型。**管理平台数据库的 ORM/Query Builder 是独立待决决策**（formalization-readiness §7 候选 5：approved Kysely 方向；platform-backend.md `requires-accepted-adr`），OPS-04/ADR-023 只冻结 RDS 基础资源边界，**不得借本规格预决平台数据库访问层**（架构评审 Major #1）。

OPS-04 只冻结生产 RDS 基础资源边界：

- **数据层隔离**：数据接入/处理数据（`event_inbox`、`error_event_occurrences`、`request_event_samples`、`request_metric_buckets`、`performance_*`——均为真实已实施表）与未来管理平台数据必须物理/逻辑隔离——同一 RDS 实例下独立逻辑数据库 + 独立凭据，或独立实例。具体形态由 D10/ADR-023 决定，但**隔离边界必须显式冻结**，不得在数据层模糊五大系统边界（架构评审 Major #2）；

- **engine family**：PostgreSQL 17（与本地/CI 工具链一致——当前仓库尚无 CI，实际对齐本地工具链 PostgreSQL 17.10；测试评审 Minor #4）；
- **encryption**：RDS 实例卷加密（KMS）；`rds_force_ssl` 与传输加密；
- **private subnet**：数据库子网、`publicly_accessible=false`；
- **security group**：只允许 ECS 任务 SG 访问，最小端口（5432）；
- **parameter ownership**：`db_parameter_group`/`db_cluster_parameter_group` 由 IaC 管理；关键参数（max_connections 等）由容量基准锁定；
- **automated backup baseline**：生产开启自动备份与 PITR，初始保留 35 天（backup-and-recovery.md §2）；删除保护开启；
- **deletion protection**：生产 RDS `deletion_protection=true`；
- **Multi-AZ 策略**：生产 Multi-AZ 是 **deployment.md/backup-and-recovery.md 已 approved 基线**，本轮不重开"是否 Multi-AZ"；D8 只细化 AZ 数量/standby 模式与 staging 缩容（运维评审 Minor #3）；staging 是否单实例按 D8；
- **staging/prod sizing**：**生产精确容量不得拿本地 benchmark 猜**（benchmark 明确标注"不得解释为生产容量"）；由 ING-13 在目标区域完成生产容量/韧性证据后锁定。

## 10. Redis（H）

**当前真实代码中不存在 Redis/BullMQ consumer。** `platform-api`（Redis Session/BullMQ 的批准载体）尚无真实实现。因此：

- **第一版在 IaC 结构上保留未来 integration boundary，但不立即 provision ElastiCache**；
- 不因旧架构设计（backend-design.md 中 BACKEND-002/003 的 Redis 方向）自动创建付费资源；
- ElastiCache 由真实消费者（platform-api / platform-worker）存在后、对应 backend ADR accepted 后再 provision；
- 若未来必须现在创建，需要直接权威依据（真实消费者 + accepted ADR）。

## 11. Object Storage（I）

区分三类（**bucket 拥有方映射**：console SPA → ADR-024/CloudFront；Source Map → 未来 DAT-18 数据模型 + 其存储 ADR；backup/private artifacts → OPS-07 备份设计——运维评审 Minor #4）：

- **console SPA static artifact storage**：私有 S3 + CloudFront 提供；console 尚未实现，不 provision，预留安全模型（ADR-024 拥有）；
- **Source Map storage**：私有 S3，数据库保存摘要/版本/路径；Source Map 功能尚未实现（Issue/fingerprint/Source Map not-started），不 provision，拥有方为未来 DAT-18 + 对应 ADR；
- **backup/private artifacts**：RDS 备份副本需要备份账号/第二区域 bucket，属 OPS-04 区域/账号决策后、OPS-07 备份设计时落位。

所有未来 bucket 一律 `BlockPublicAccess`、KMS 加密、版本控制、最小 Bucket Policy；**SPA/console 私有 S3 只能通过 CloudFront OAC（origin access control）可达，bucket policy 只授权该 distribution**（安全评审 Minor #2）。**当前必须 provision 的 S3 为 none**（由用户决策包 D10 确认）。

## 12. Secrets / encryption（J）

- **AWS Secrets Manager / SSM 边界**：秘密/签名材料/Pepper/外部凭据进入 Secrets Manager；非秘密配置进入版本化部署配置或 SSM Parameter Store（deployment.md §4）；
- **KMS**：DB 卷、S3、Secrets Manager 使用 KMS；生产与非生产 KMS 分离；**生产 RDS KMS key policy 必须授权备份账号/第二区域副本的解密与授权，作为跨账号备份的前置**（安全评审 Minor #4）；生产 CMK 纳入轮换策略（安全评审 Minor #8）；
- **DB credentials**：RDS 主凭据由 Secrets Manager 管理并自动轮换（由 IaC 接管后落位）；
- **ingestion secrets**：客户端上报密钥**从不持久化完整 secret**（ADR-013/014 已冻结：只存 SHA-256 摘要、一次性返回）；其管理 HTTP API 未实现，不在 OPS-04 provision；
- **application env**：只通过 ECS Task Role 读取当前环境所需秘密，不写入镜像/仓库/构建日志/前端资源；
- **CI 不保存长期 AWS access key**：GitHub OIDC 短期凭据，生产角色与非生产角色分离；
- **secret rotation responsibility**：轮换、双版本兼容、撤销与故障 Runbook 归对应服务 Owner；OPS-04 只冻结边界；
- **log redaction**：日志不得包含秘密/请求体/凭据；发布流水线执行秘密扫描与日志脱敏检查。

## 13. DNS / domain / HTTPS（K）

- **production domain / staging domain**：由用户决策包 D4/D6 提供；不自行购买域名、不把用户未知域名写成正式配置；
- **ingestion host / console host**：独立公开 hostname；ingestion 使用独立 hostname 与客户端上报密钥，不共享浏览器 Session（deployment.md §3）；
- **DNS ownership**：由用户决策包 D5 决定（现有 DNS provider / Route 53 / 委托到 Route 53）；
- **Route 53**：是否使用、如何委托按 D5；
- **ACM**：证书由 ACM 签发，区域与 us-east-1（CloudFront 证书）注意事项按最终拓扑；
- **certificate validation**：DNS 验证为主；域名归属确认后由 IaC 落位；
- **HTTPS only / HTTP redirect / HSTS**：生产与 staging 强制 HTTPS、HTTP 301/308 重定向、HSTS（精确头策略由安全评审与 IaC 评审产生）；**最低 TLS 版本（TLS ≥1.2，优先 1.3）与加密套件在 ADR-024/IaC 评审中冻结**（安全评审 Minor #5）；
- **CloudFront / ALB hostname mapping**：console 域名 → CloudFront；ingestion 域名 → ingestion API 入口；
- **账号级安全遥测**：生产账号启用 CloudTrail（全区域，含 S3/Secrets Manager 数据事件）与安全告警，作为 OPS-04 基础设施基础而非 OPS-06 观测仪表盘（安全评审 Minor #3）。

## 14. Edge / public entry（L）

- **console（同一管理平台主机）**：单个管理平台域名由 CloudFront 承载 SPA 并把 `/api/*` 转发到 ALB（deployment.md §3、TDR 设计——架构评审 Minor #7）；console 实现后落位；
- **console API**：CloudFront `/api` origin → ALB → 未来 `platform-api`（与 console 同一主机，非第二个公网入口）；
- **ingestion**：独立公开 ingestion hostname → `ingestion-api`（当前唯一真实公开服务，经 `POST /v1/batches`）；
- **Worker / PostgreSQL / Redis**：private only；
- console/platform-api 当前不存在：不创建假 workload，只冻结未来 edge topology。

## 15. Environment configuration（M）

- 环境集合：`local`、`staging`、`production`（`CI` 使用非生产账号下的作用域 OIDC 角色，不设独立 IaC 环境——PR 全栈环境第一版不采用，运维评审 Minor #6）；
- 不通过复制代码维护环境差异；
- 配置经 typed environment/config（现有 `IngestionWorkerConfig`/`IngestionApiConfig` 两阶段 build/start 模式）、IaC context/config、Secrets、deployment parameters 分层注入；
- 秘密不得提交 Git；
- **日志投递/保留与指标命名空间默认值属 OPS-06 所有**，OPS-04 只保留集成边界（运维评审 Minor #5）；RDS 维护窗口与次要版本升级策略显式留给 IaC 评审（运维评审 Minor #7）。

## 16. Resource naming / tagging（N）

资源命名与标签至少包含：系统（system）、环境（environment）、Owner、数据分类（data classification）、成本归属（cost-center，如适用）、managed-by、retention owner。禁止浮动 `latest` 标签用于发布依据（deployment.md §4、TDR §5.1）。

## 17. Cost boundaries（O）

- 主要持续成本来源：RDS、ECS/Fargate、ALB、NAT、CloudFront、CloudWatch Logs、**WAF/CloudFront edge、Secrets Manager、KMS**、（未来）ElastiCache（架构评审 Minor #8）；
- staging 成本压缩：staging 可缩容/按需启停、不建 Multi-AZ 冗余（按 D8）、日志低留存；**staging ALB 是固定费率资源，缩容无法降低其存在成本——staging 停止时随之销毁/停用 ALB，或显式承担其常驻成本**（成本评审 F2）；
- production 必需冗余：Multi-AZ（按 D8）、备份与跨区域副本；
- 现在不应创建的资源：ElastiCache、console/Source Map bucket、PR 全栈临时环境（TDR 第一版默认不采用）；
- 成本风险点：NAT 常开、RDS 常开、ALB 常开、CloudFront 出流量、日志无限留存、**跨账号/跨区域数据复制与备份流出流量**（成本评审 F1）；
- budget/alert requirement：按环境与账号设置预算告警（精确美元预算由用户决策包 D7 提供，不编造数字）。

## 18. Lifecycle / destruction（P）

- **retain**：生产 RDS（删除保护 + 自动备份 + PITR）、生产 KMS、生产秘密；
- **destroy**：非生产可重建资源允许销毁；生产销毁命令需独立审批；
- **RDS deletion protection**：生产 `deletion_protection=true`；
- **snapshots**：由自动备份 + 跨区域复制承接，不依赖手工快照；
- **production destructive command**：生产删除/高危 IAM/资源销毁需独立审批（deployment.md §4）；
- **stack removal**：IaC stack 销毁流程与 Dry-run 必须存在；
- **orphan detection**：备份/对象孤儿检测作为生命周期/销毁基础在本规格冻结，**实际孤儿检测 Runbook 属 OPS-07 所有**（架构评审 Minor #6；backup-and-recovery.md §4）；
- **accidental deletion protection**：生产账号最小权限 + 人工审批 + 删除保护。

## 19. Drift / reproducibility（Q）

- **IaC is source of truth**：基础设施由 IaC 定义，Console 手工长期修改不是常规路径；
- 事故期临时修改必须留审计、Owner、到期与回填 IaC 任务；
- **synth / diff**：CDK synth 快照与 diff 进入评审；
- **CI validation**：IaC 合成、策略/安全扫描与计划差异纳入 CI（OPS-05 流水线落位）；
- **drift detection**：定期 drift 检测，机制与 cadence 在 IaC 评审中确定（CloudFormation drift detection vs `cdk diff` vs AWS Config，指定 Owner 与执行路径；测试评审 Minor #3）；
- **bootstrap**：CDK bootstrap 与多账号凭据切换流程作为 IaC 实施要求存在；
- **environment recreation evidence**：从空环境重复创建并验证——最小验证清单：IaC diff 与基线干净、RDS 从 ECS SG 可达、`POST /v1/batches` 冒烟通过、网络可达性矩阵通过——作为 OPS-04 退出证据之一（测试评审 Minor #2）。

## 20. 非职责（R）

OPS-04 不实现：CI workflow（G14/OPS-01）、release pipeline、application deployment、Migration execution pipeline、production promotion（OPS-05）、observability dashboards/SLO/运行告警（OPS-06）、backup drill/DR drill/删除重放验证（OPS-07）、SDK release（G15）、platform UI（G09+）、Query、product alert。这些属于后续组或叶子；本规格只冻结基础设施边界为它们提供目标环境。

## 21. OPS-04 前置门禁自检

| 检查项 | 结果 |
|---|---|
| AWS 主云方向 approved | 是（TDR §3.1 方案 A；deployment.md approved） |
| Region 已正式决定 | 否（deferred / TDR-GAP-01）→ 用户决策包 D2 |
| account/environment 模型冻结 | 部分（deployment.md "至少隔离非生产与生产"已 approved；账号细化待 D3） |
| network 模型冻结 | 否（implementation-detail deferred）→ 本规格 §7 + ADR-022 |
| IaC 工具有 accepted ADR | 否（requires-accepted-adr）→ ADR-022 + D9 |
| RDS 生产资源被授权 | 否 → 本规格 §9 + ADR-023 + D10 |
| Redis 当前需要 | 否（无真实消费者）→ 不 provision |
| Object Storage 当前需要 | 否（console/Source Map 未实现）→ 不 provision |
| Secrets/KMS 正式化 | 否 → 本规格 §12 + ADR-024 |
| DNS/TLS 正式化 | 否 → 本规格 §13 + D4/D5/D6 |
| production deployment principal 正式化 | 否 → 属 OPS-05 门禁 |
| 成本边界存在 | 否 → 本规格 §17 + D7 |
| destructive resource policy 冻结 | 否 → 本规格 §18 + 决策包 |

结论：**OPS-04 当前不是 implementation-ready**。完成本规格 + required ADR 评审并获用户批准后，才可进入 `writing-plans` 与 IaC 实施。

## 22. Required ADR（本规格关联）

本规格要求以下 proposed ADR（见 [ADR 索引](../adr/README.md)）：

- **ADR-022**：AWS 账号、区域、网络与 IaC（云基础设施基础）；
- **ADR-023**：托管计算与数据服务（ECS/Fargate、RDS PostgreSQL、Redis 边界）；
- **ADR-024**：边缘、DNS、TLS、秘密与加密（CloudFront/Route 53/ACM、KMS/Secrets Manager/OIDC）。

三者均保持 `proposed / not-started / awaiting-user-approval`，与本规格同批进入用户审批包。OPS-05 的流水线/晋级 ADR（不可变制品、GitHub OIDC、expand/contract、生产批准与回滚）**在 G16 内部 OPS-05 叶子开始时形成**（OPS-04 → OPS-05 顺序；若用户调整路线为 OPS-04 → G14/OPS-01 → OPS-05，则在 G14 之后、OPS-05 开始前形成），不在本轮创建（运维评审 Minor #10）。

## 23. 待用户批准决策包索引

详见最终报告"USER APPROVAL REQUIRED — G16 / OPS-04 Cloud Decision Package"：

- D1 AWS Account 现状；
- D2 AWS Region；
- D3 Account/Environment 隔离；
- D4 生产域名；
- D5 DNS ownership；
- D6 Staging 域名规范化；
- D7 成本边界；
- D8 生产韧性与 staging 缩容；
- D9 IaC 工具；
- D10 Provision-now vs deferred；
- D11 生产部署授权方式。
