---
title: Aurora 正式化与实施就绪追踪
status: draft
owner: architecture
created: 2026-07-29
last-reviewed: 2026-07-30
applies-to: Aurora 第一版六专题正式化、ADR 收口、机器契约队列与实施就绪审查
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/README.md
  - ../README.md
  - system-overview.md
  - monorepo-and-build.md
  - sdk-architecture.md
  - platform-frontend.md
  - platform-backend.md
  - deployment.md
  - ../prd/platform-product-domains.md
  - ../testing/test-strategy.md
  - ../releases/release-migration-and-rollback.md
  - ../operations/backup-and-recovery.md
  - ../security/account-deletion-and-data-lifecycle.md
  - ../superpowers/specs/2026-07-28-aurora-foundation-topic-approval-baseline.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../superpowers/specs/2026-07-28-aurora-frontend-technology-stack-design.md
  - ../superpowers/specs/2026-07-30-aurora-console-visual-language-design.md
  - ../superpowers/specs/2026-07-28-aurora-platform-backend-design.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
  - ../superpowers/specs/2026-07-29-aurora-topic-discussion-summary.md
  - ../superpowers/specs/2026-07-29-aurora-account-deletion-data-lifecycle-design.md
supersedes: none
design-stage: first-module-planning-authorized
review-cycle: milestone-or-30-days
---

# Aurora 正式化与实施就绪追踪

## 1. 定位、效力与停止边界

本文是六专题设计批准后的正式化工作台，维护权威来源矩阵、前端页面映射、未来正式文档树、ADR 复审与候选队列、产品/安全/技术/运营缺口、机器契约清单和实施依赖顺序。

本文当前为 `draft`，因为它是持续更新的工作追踪，而不是第二份 PRD。ADR 状态的唯一来源是各 ADR 与[ADR 索引](../adr/README.md)；本文只同步结果，不替代完整专题设计，不创建机器契约，也不证明代码、CI、AWS 资源、数据库、秘密、制品、部署或测试结果存在。

权威优先级固定为：

1. approved 核心 PRD 与六份长期规范；
2. accepted ADR；
3. approved 完整专题设计；
4. approved 六专题总结；
5. proposed ADR、本文工作矩阵和其他讨论材料。

发现真实语义冲突时，必须把受影响范围标为阻塞并回到更高权威来源；不得从摘要、能力名称、建议路径或本矩阵推导机器字段和实现事实。

## 2. 当前证据基线

截至 2026-07-30：

- 核心业务规则已冻结；
- 前四基础专题批准的是可追溯业务/高层架构基线，不是完整实施规格；
- 管理平台完整 UX/UI、控制台视觉语言、前端技术栈、后端设计和测试/部署/发布完整设计均已批准；控制台采用浅色内容区、纯色琥珀橙侧栏且禁止渐变，同方向低风险视觉细节可由 Agent 直接收口；
- 六专题总结已确认作为 ADR、正式文档、机器契约、缺口和实施就绪审查的输入；
- A5-001—A5-011 账号注销与数据生命周期完整方案已批准并进入正式安全文档；
- ADR-001—ADR-007 已完成独立非作者和所需领域评审；ADR-001/003/005/006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-002、ADR-004 为 `accepted / not-started`；
- 首个有界模块“私有 Monorepo 根 Workspace 与最小本地工程工具”已实施，并于 2026-07-30 通过完整新鲜验证；
- `event-schema` 协议基础第一增量已实施为真实私有包 `@aurora/event-schema`：版本化公共信封、运行时边界校验、稳定错误和共享契约样本已存在并通过新鲜验证；具体事件正文、批次/接收协议、兼容转换和真实消费者仍未规格化；
- SDK Core 生命周期与插件编排基础第一增量已有[approved 正式规格](../sdk/sdk-core-foundation.md)和[单一模块实施计划](../superpowers/plans/2026-07-30-sdk-core-foundation.md)；计划已执行，`packages/core` 基础增量（环境无关 Core、显式生命周期、最小配置、插件注册与顺序编排、异常隔离、事件入口和多实例隔离）已实施并通过 2026-07-30 新鲜验证，ADR-003 保持 `accepted / in-progress`；
- `@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量已有[approved 正式规格](../sdk/browser-environment-foundation.md)和[单一模块实施计划](../superpowers/plans/2026-07-30-browser-environment-foundation.md)；计划已执行，`packages/browser` 基础增量（安全环境与能力探测、脱敏页面快照、`visibilitychange`/`pagehide`/`pageshow` 生命周期订阅、幂等释放、异常隔离和多实例隔离）已实施并通过 2026-07-30 新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/006 保持 `accepted / in-progress`；
- 已创建根入口、正式文档索引以及系统、SDK、管理平台前后端、测试、部署、发布/回滚、恢复和 A5 安全的最小充分正式文档；
- 除根 Workspace、`@aurora/workspace-policy`、`@aurora/event-schema` 协议基础增量、`@aurora/core` 基础增量与 `@aurora/browser` 基础增量外，仓库仍没有业务模块代码、具体事件正文、批次/接收协议、机器 OpenAPI、可执行数据模型、CI 工作流、IaC、云资源或部署。

## 3. 权威来源矩阵

| 主题或规则                                            | 当前详细权威来源                                                                                                                                                   | 批准状态                                                                                 | 未来长期承载                                                                                                                                     | ADR                                         | 前置条件                                                  | 当前阻塞                                      | 不允许重复维护的位置                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| 第一版产品范围、权限、生命周期与公共行为              | 核心 PRD；管理平台稳定分域见正式产品域文档；A5 见正式安全文档                                                                                                      | approved                                                                                 | 核心 PRD、`docs/prd/platform-product-domains.md`、`docs/security/account-deletion-and-data-lifecycle.md`                                         | 仅高迁移成本技术决定需要                    | D2 等剩余规则不阻塞已正式化部分                           | D2、A5 之外的保留/运营等缺口                  | 六专题总结、ADR、API 不得改写产品范围          |
| 五大边界、依赖方向、SDK 宿主安全与隐私默认            | 架构规范                                                                                                                                                           | approved；ADR accepted                                                                   | `docs/architecture/` 分领域文档                                                                                                                  | ADR-002/003/004/005/006 accepted            | 真实模块规格与机器契约按依赖补齐                          | 实施证据不存在                                | 模块 README、构建配置不得形成平行架构          |
| Monorepo 目录与工程方向                               | [Monorepo 与基础工程工具](monorepo-and-build.md)                                                                                                                   | approved planning spec；ADR-001/006/007 accepted                                         | `docs/architecture/monorepo-and-build.md`                                                                                                        | ADR-001/006/007                             | 仅首模块计划                                              | 计划尚未执行；版本/发布仍 deferred            | 根 README 与 CI 只链接，不复制完整决策         |
| SDK Core、Browser、插件与框架职责                     | PRD、架构/代码/测试规范、[SDK Core 基础规格](../sdk/sdk-core-foundation.md)、[Browser 环境基础规格](../sdk/browser-environment-foundation.md)、ADR-003/005/006/007 | Core 基础与 Browser 环境基础第一增量 implemented；ADR-003/005/006 accepted / in-progress | `docs/architecture/sdk-architecture.md` 与 `docs/sdk/`                                                                                           | ADR-003/005/006/007 accepted                | event-schema 信封基础、Core 基础与 Browser 环境基础已实施 | 具体插件、适配器、完整 SDK API 与兼容证据缺失 | 示例、适配器 README 不得另定义 SDK 行为        |
| 公共事件协议与版本兼容                                | PRD、架构规范、ADR-005、基础专题基线                                                                                                                               | 业务/架构 approved；ADR-005 accepted / in-progress                                       | `docs/protocol/event-envelope-v1.md`＋`@aurora/event-schema` 公共信封                                                                            | ADR-005 accepted                            | 信封基础已实施；具体事件 Schema 工具、版本/迁移规则       | 具体事件正文、批次/接收协议和兼容转换不存在   | SDK 类型、数据库模型、OpenAPI 不得另定义事件   |
| 数据接入与可靠确认                                    | PRD、架构/测试规范、基础专题基线、ADR-004/005                                                                                                                      | 基线 approved；ADR accepted                                                              | `docs/architecture/ingestion.md`＋接入 OpenAPI                                                                                                   | ADR-004/005 accepted；物理缓冲 ADR required | 事件协议、容量模型、密钥规则                              | 缓冲技术、逐事件结果、限流/重试契约缺失       | C1/C7、日志和处理存储不得充当接入契约          |
| 处理、问题、指标、Source Map、告警、保留/删除         | PRD、基础专题基线、平台后端设计                                                                                                                                    | 设计 approved                                                                            | `docs/architecture/processing-and-storage.md`＋处理 Query/Command 契约                                                                           | 数据/任务/存储 ADR required                 | 事件协议、容量与保留规则                                  | 数据模型、任务、存储和公开投影缺失            | 前端页面、代表样本和审计不得推导处理事实       |
| A1—D2、NAV-A、AUDIT-A、页面状态、视觉语言与 GAP-01—20 | 完整前端 UX/UI；控制台视觉语言；总体 OpenAPI 与实现约束设计                                                                                                        | approved                                                                                 | `docs/prd/platform-product-domains.md` 维护稳定分域；页面与视觉细节继续回读完整设计；跨页面工程模型进入 `docs/architecture/platform-frontend.md` | 只对长期工程/安全决定使用 ADR               | 机器 Platform OpenAPI、领域 Schema 与主题实现             | D2、机器契约制品、权限矩阵、视觉组件证据缺失  | 六专题总结和前端代码注释不得弱化详细设计       |
| 前端框架、状态、表单、组件和质量方法                  | 前端技术栈设计                                                                                                                                                     | approved design                                                                          | `docs/architecture/platform-frontend.md`、真实模块 README                                                                                        | 前端技术栈 ADR required                     | 机器 API、工程工具、基准                                  | ADR、精确版本、参考工程缺失                   | 页面域文档不复制库级选择                       |
| 管理平台领域、Query/Command 能力和后端栈              | 平台后端设计；总体 OpenAPI 与实现约束设计                                                                                                                          | approved design                                                                          | `docs/architecture/platform-backend.md`、未来机器 Platform OpenAPI、数据模型                                                                     | 后端/Session/数据基础设施 ADR required      | 产品缺口、Schema 工具                                     | 机器 OpenAPI、SQL 模型、Session 安全评审缺失  | 前端请求层和数据库迁移不得另定义领域行为       |
| 测试矩阵、兼容、性能、SLO、CI 门禁                    | 测试规范＋测试/部署/发布设计                                                                                                                                       | approved                                                                                 | `docs/testing/`                                                                                                                                  | 工具/公共兼容是否需 ADR按评审判断           | 可执行工程、设备与基准                                    | 真实命令、设备、基准、CI 不存在               | package scripts、Runbook 不复制政策正文        |
| AWS、部署、Migration、发布、回滚、备份与 Runbook      | 架构规范＋测试/部署/发布设计                                                                                                                                       | approved design                                                                          | `docs/architecture/deployment.md`、`docs/releases/`、`docs/operations/`                                                                          | AWS/IaC、发布/Migration ADR required        | 区域、账号、角色、容量、成本                              | IaC、资源、流水线、演练均不存在               | ADR 不承载频繁变化命令和阈值                   |
| Session、凭据、权限、审计、保留与删除安全             | PRD、架构/代码规范、UX/UI、后端设计、approved A5 设计                                                                                                              | A5 approved；其余部分规则/设计 approved                                                  | `docs/security/account-deletion-and-data-lifecycle.md`；其他安全主题待有充分输入再建                                                             | Session/安全、密钥基础设施 ADR required     | D2、邮件/非 A5 保留决定                                   | Session/凭据 ADR和其他产品规则缺失            | 前端角色表、日志字段和运维脚本不得成为安全权威 |
| 六专题状态、映射与正式化入口                          | 六专题总结                                                                                                                                                         | approved formalization input                                                             | 本文维护执行追踪；入口只链接                                                                                                                     | 不适用                                      | 定期同步                                                  | 本文仍为 draft                                | 不得从总结生成页面细节、API 或表               |

## 4. 前端页面到长期文档的映射

### 4.1 共同承载规则

以下表中的 Query/Command 名称只是批准设计中的能力标签，不是接口路径、字段或机器契约。每个未来领域文档必须从完整 UX/UI 对应章节回读并维护：

- 页面编号/名称、用户角色、进入目的、前置条件、主对象、路由和作用域；
- 权限、Query、Command、字段/公式/空值、水位/采样/时区；
- 成功、失败、冲突、重复提交、异步、陈旧和生命周期状态；
- 危险操作、一次性交付秘密、隐私和可访问性；
- 第一版排除、GAP、关联 PRD/ADR/API/测试。

通用状态至少包含 `loading`、`empty`、`error`、`forbidden`、`processing`、`partial`、`stale`、`unavailable`；具体页面再补充 `conflict`、`archived`、`trash`、`deleting`、`secret_lost`、`propagating` 等。URL 是标签/筛选/搜索/排序/分页/稳定选择的当前权威；选择、草稿、秘密和操作状态不进入 URL。

### 4.2 逐页映射

| 页面                  | 角色、目的与主对象                                     | 路由/作用域                                                       | Query 与权限                                            | Command                                                    | 关键状态、安全与第一版排除                                       | 合同阻塞                                                                   | 未来详细承载                                           |
| --------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| A1 注册与邮箱验证     | 公开用户/未验证账号；创建账号、个人工作空间和验证意图  | `/register`、`/verify-email*`；公开/当前账号                      | Session、安全账号投影；公开注册，验证需有效意图         | Register、Resend、ConfirmVerification                      | 防枚举；GET 不写入；令牌清理；不含第三方登录/SSO/2FA             | GAP-01—04；认证/邮件 OpenAPI                                               | `docs/prd/account-authentication-and-invitations.md`   |
| A2 登录               | 公开用户；建立 Session 并恢复本次邀请或安全站内任务    | `/login`；公开                                                    | Session/Continuation/Authorization                      | Login                                                      | 邀请意图→安全 returnTo→workspace；不恢复上次访问，不开放重定向   | GAP-01/05/07                                                               | 同上                                                   |
| A3 忘记/重置密码      | 公开用户/有效重置意图；安全恢复凭据                    | `/forgot-password`、`/reset-password`                             | 重置意图与统一公开结果                                  | RequestReset、ConfirmReset、RevokeAllSessions              | 防枚举；GET 不消费令牌；重置后不自动登录                         | GAP-01/03/05                                                               | 同上                                                   |
| A4 接受组织邀请       | 邀请令牌持有者和匹配账号；显式加入组织/项目            | `/invitations/accept`；认证衔接                                   | InvitationIntent/Query、邮箱匹配、权限摘要              | SwitchAccount/Logout、AcceptInvitation                     | 原子成员关系；不自动接受；不含拒绝/批量/历史                     | GAP-03/06/09                                                               | 同上                                                   |
| A5 账号安全与注销     | 当前账号；改密码、退出、解除所有权阻塞并注销           | `/account/security`；账号级                                       | AccountDeletionPreflight、Ownership Projection          | ChangePassword、Logout、申请/撤销注销                      | A5-001—011 已批准并正式承载；无自动提权/级联删除                 | GAP-04/05/09；账号 OpenAPI、模型、删除任务、Session/安全 ADR与测试仍不存在 | `docs/security/account-deletion-and-data-lifecycle.md` |
| B1 工作空间与项目入口 | 当前账号；查看个人工作空间和按组织分组的可访问项目     | `/workspace`；账号/组织                                           | Workspace、Authorization、Lifecycle                     | 无；B2 安全入口                                            | 不显示健康/最近/收藏；部分范围不可伪装为空                       | GAP-02/07                                                                  | `docs/prd/workspace-and-organization-governance.md`    |
| B2 创建项目           | 组织所有者/管理员；原子创建可接入项目                  | `/organizations/:organizationId/projects/new`                     | Organization Context/Authorization                      | Idempotent CreateProject/OperationResult                   | 项目、production、密钥、接入进度和审计原子；无草稿/异步任务      | GAP-08/12/19                                                               | 同上                                                   |
| B3 组织成员与邀请     | 组织所有者/管理员；分别治理已生效成员和待处理邀请      | `/organizations/:organizationId/members?tab=...`                  | Membership、PendingInvitation、ProjectAccess            | Invite/Revoke、ChangeRole、RemoveMember、TransferOwnership | 双标签独立；每次重鉴权审计；无历史/批量/自定义角色               | GAP-06/09/12                                                               | 同上                                                   |
| B4 组织业务时区       | 成员读取，所有者/管理员修改；唯一 IANA 时区            | `/organizations/:organizationId/settings`                         | OrganizationSettings、SupportedTimezone                 | UpdateBusinessTimezone                                     | 真实时间不变；立即全组织生效；无项目/成员时区分叉                | GAP-07/12/15                                                               | 同上                                                   |
| B5 资源用量           | 获准组织成员；先判断保护状态和当前周期可信度           | `/organizations/:organizationId/usage`                            | UsageSummary、Protection/Completeness                   | 无                                                         | 状态优先；不含趋势、排行、收费或策略编辑                         | GAP-10/15                                                                  | 同上                                                   |
| B6 私密管理令牌       | 获准管理员；最小 scope 创建、识别和撤销秘密            | `/organizations/:organizationId/tokens`                           | TokenMetadata、Scope/Expiry Capability、OperationResult | Create/RevokePrivateToken                                  | 首次响应一次性交付；`secret_lost` 只能撤销重建；无重显/编辑/模板 | GAP-01/11/12                                                               | 同上                                                   |
| B7 安全审计           | 仅组织所有者/管理员；读取统一组织级高风险证据          | `/organizations/:organizationId/audit`                            | AuditLog/SafeSummary/Authorization                      | 无                                                         | 项目事件同一时间线；不向项目管理员开放；无导出/评分              | GAP-12                                                                     | 同上                                                   |
| B8 项目回收站         | 仅组织所有者/管理员；恢复 `trash`，观察 `deleting`     | `/organizations/:organizationId/trash`                            | RecycleBin、RecoveryEligibility、DeletionProgress       | RestoreProject                                             | 服务端截止时间权威；无立即永久删除/批量/项目管理员入口           | GAP-12/13                                                                  | 同上                                                   |
| C1 SDK 接入向导       | 获准项目成员；安装、初始化、发送测试错误并验证问题生成 | `/.../:projectId/onboarding`                                      | ProjectOnboarding、Templates、TestEventStatus           | UpdateProgress、ClearOnboardingTestData                    | 三步单页；最长 60 秒检查；只有测试问题生成算成功；不自动改代码   | GAP-08/19                                                                  | `docs/prd/project-onboarding-and-diagnostics.md`       |
| C2 项目概览           | 项目查看成员；理解权威状态、原因和最小行动证据         | `/.../:projectId/overview`                                        | Overview/Status/Issue/Alert/Completeness                | 无                                                         | `normal/abnormal/no_data` 不由前端计算；无趋势/健康评分          | GAP-10/14/15/18                                                            | 同上                                                   |
| C3 问题列表           | 项目查看/处理成员；规范化查询、个人视图和当前页批量    | `/.../:projectId/issues`                                          | CanonicalIssueQuery、SavedView、AllowedActions          | SaveView、PageBatchIssue                                   | URL 权威；查询变化清选择；无跨页全选/后台批量/共享视图           | GAP-14                                                                     | `docs/prd/issues-and-events.md`                        |
| C4 问题详情           | 项目查看/处理成员；处理聚合问题并检查有限代表样本      | `/.../issues/:issueId`                                            | IssueAggregate、Samples、SourceMap、Activity            | Lifecycle/Assignment/Priority、Notes、Merge                | 问题主对象、样本从属；无完整事件历史/附件/复杂拆分               | GAP-14/17                                                                  | 同上                                                   |
| C5 请求监控           | 项目查看成员；定位规范化接口失败和耗时                 | `/.../:projectId/requests`                                        | RequestMetrics、EndpointList/Detail/TimeSeries          | 无                                                         | 服务端公式/阈值/采样/水位；无 API 目录、正文、完整 URL           | GAP-15                                                                     | `docs/prd/request-and-performance-monitoring.md`       |
| C6 页面性能           | 项目查看成员；定位安全页面的 LCP/INP/CLS/加载耗时      | `/.../:projectId/performance`                                     | PerformanceMetrics、PageList/Detail/TimeSeries          | 无                                                         | 指标不可用不等于零；无网站地图、DOM、Replay、全项目评分          | GAP-15                                                                     | 同上                                                   |
| C7 数据接收诊断       | 项目诊断查看成员；解释接收、缓冲、处理和行动           | `/.../:projectId/data-status`                                     | Diagnostics、Receipt/Processing/SafeStatus/Targets      | 无；跳转目标另行 Command                                   | `accepted` 仅可靠缓冲；无原始日志、队列操作、自动修复            | GAP-08/10/19                                                               | `docs/prd/project-onboarding-and-diagnostics.md`       |
| C8 发布与部署         | 发布查看成员；查看发布及从属环境部署                   | `/.../:projectId/releases`、`/.../:projectId/releases/:releaseId` | Release/Deployment/Recurrence                           | 条件式 CreateDeployment                                    | SDK/令牌创建发布，管理平台不手工创建；仅成功部署参与再次出现     | GAP-11/16                                                                  | `docs/prd/releases-and-source-maps.md`                 |
| C9 Source Map         | 获准成员；在发布下管理当前有效映射文件                 | `/.../releases/:releaseId/source-maps`                            | FileList/Detail/ReparseStatus                           | Upload/Replace/Download                                    | 严格键、同摘要幂等、显式替换、有界重解析；无版本历史/任务中心    | GAP-11/12/17                                                               | 同上                                                   |
| C10 告警规则与实例    | 项目成员查看、管理员管理；分离规则与每次实例           | `/.../:projectId/alerts?tab=...`                                  | RuleList/Evaluation、InstanceList                       | 只导航 C11；无内联编辑                                     | 双标签独立；数据不足/暂停不等于恢复；无跨项目中心                | GAP-18                                                                     | `docs/prd/alerts.md`                                   |
| C11 告警规则编辑      | 项目管理员；按指标能力创建/编辑完整规则                | `/.../alerts/rules/new                                            | :ruleId/edit`                                           | Capability、Targets、Recipients、RuleDetail                | Create/UpdateAlertRule                                           | 切指标显式清理冲突；服务端组合校验；无通用查询/模板/模拟                   | GAP-18                                                 | 同上 |
| C12 告警实例详情      | 获准项目成员；只读查看状态、原因、证据和业务轨迹       | `/.../alerts/instances/:instanceId`                               | InstanceDetail、Evidence、RuleSnapshot、Timeline        | 无人工状态 Command                                         | 历史快照与当前规则分离；无手工恢复/评论/原始评估日志             | GAP-18                                                                     | 同上                                                   |
| C13 项目成员与角色    | 具备成员治理权限者；按人员唯一行解释有效权限和来源     | `/.../:projectId/access`                                          | EffectiveAccess/Permission/Source、EligibleMember       | Grant/Change/RemoveProjectMembership                       | 组织继承只读；无项目邮箱邀请/自定义角色/批量                     | GAP-09/12                                                                  | `docs/prd/project-access-credentials-and-lifecycle.md` |
| C14 客户端上报密钥    | 项目密钥管理员；逐密钥治理状态、来源、环境与最近使用   | `/.../:projectId/client-keys`                                     | ClientKeyList/Detail/Capability/Policy                  | Create、Enable/Disable、Origin/EnvironmentPolicy           | 与 B6 私密令牌分离；候选来源不得自动放行；无删除/趋势            | GAP-12/19                                                                  | 同上                                                   |
| C15 项目设置与环境    | 组织所有者/管理员或项目管理员；分离基本设置和环境目录  | `/.../:projectId/settings?tab=...`                                | ProjectSettings、EnvironmentCapability/List             | UpdateSettings、CreateEnvironment                          | 环境名固定；网站地址不联动密钥/SDK；无重命名/停用/删除           | GAP-19                                                                     | 同上                                                   |
| C16 项目归档与删除    | 项目/组织管理员；可逆归档，组织管理员可移入回收站      | `/.../:projectId/settings/lifecycle`                              | LifecycleStatus/Capability                              | Archive、RestoreFromArchive、MoveToTrash                   | 名称确认、幂等/并发/审计；无直接永久删除/批量                    | GAP-12/13                                                                  | 同上                                                   |
| D1 站内通知           | 当前账号；跨可访问组织/项目查看通知和逐条已读          | `/notifications?filter=...`                                       | NotificationList/UnreadCount/AuthorizedTarget           | MarkRead                                                   | 已读不等于业务处理；无线程/批量/偏好/外部渠道                    | GAP-20                                                                     | `docs/prd/notifications-and-resource-policy.md`        |
| D2 平台资源策略       | 后端确认的平台管理员；治理默认、组织覆盖和项目上限     | `/platform/resource-policies`                                     | PlatformAdmin、TargetSearch、EffectivePolicy            | SetDefault、Set/ResetOrganization、Set/ClearProjectLimit   | 来源/生效值/传播分离；无收费/组织自助；平台级审计未定            | GAP-10；平台管理员与审计规则缺失                                           | 同上                                                   |

31 页不拆成 31 份文档。上述 9 个稳定业务域文档是当前建议边界；`NAV-A`、`AUDIT-A`、URL、权限、表格、通用状态、危险操作与可访问性统一进入 `docs/architecture/platform-frontend.md`，领域文档只链接并记录本域例外。

## 5. 未来正式文档树

状态说明：`exists/approved` 表示由 approved 输入形成的当前正式文档；`exists/draft` 表示工作追踪；`planned/blocked` 表示只登记位置和解除条件，未创建空壳；`machine/blocked` 表示扩展名或生成方式须由契约工具决定。

| 路径                                                   | 内容来源                                          | Owner                      | 状态                          | 创建/批准前置条件                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------- | -------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                            | 全部 approved 入口                                | documentation              | exists/approved               | 明确仓库尚无代码与命令，不虚构模块                                                                                     |
| `docs/README.md`                                       | approved 入口、正式文档和设计历史                 | documentation/architecture | exists/approved               | 按里程碑维护权威映射                                                                                                   |
| `docs/architecture/formalization-readiness.md`         | 六专题总结与本轮审计                              | architecture               | exists/draft                  | 用户审阅本矩阵；按里程碑复查                                                                                           |
| `docs/architecture/system-overview.md`                 | 架构规范、基础专题                                | architecture               | exists/approved               | 实现仍需对应 accepted ADR                                                                                              |
| `docs/architecture/monorepo-and-build.md`              | 基础专题、ADR-001/006/007、测试规范               | architecture/tooling       | exists/approved/implemented   | 根 Workspace 与 policy 工具已实施；版本/发布不在范围                                                                   |
| `docs/architecture/sdk-architecture.md`                | 基础专题、架构规范、ADR-003/005/006、TDR          | sdk                        | exists/approved design        | 公共 API/Schema deferred；实现需 accepted ADR                                                                          |
| `docs/architecture/ingestion.md`                       | 基础专题、ADR-004/005、TDR                        | ingestion                  | planned/blocked               | 缓冲/运行基础设施 ADR、容量模型                                                                                        |
| `docs/architecture/processing-and-storage.md`          | PRD、基础专题、平台后端/TDR                       | processing                 | planned/blocked               | 数据/任务/存储 ADR、保留删除规则                                                                                       |
| `docs/architecture/platform-backend.md`                | approved 平台后端、总体契约设计、A5               | backend                    | exists/approved design        | 机器 OpenAPI/模型 deferred；实现需后端/Session/数据 ADR                                                                |
| `docs/architecture/platform-frontend.md`               | approved UX/UI、前端栈、总体契约设计              | platform                   | exists/approved design        | 机器 OpenAPI/Client/缓存实现 deferred；实现需前端 ADR                                                                  |
| `docs/architecture/deployment.md`                      | approved TDR、架构规范                            | cloud/operations           | exists/approved design        | 主区域/账号/IaC deferred；实现需 AWS/IaC ADR                                                                           |
| `docs/architecture/platform-data-model.md`             | 平台后端、A1—D2、A5                               | backend                    | planned/blocked               | D2、数据库 ADR、字段/事务设计                                                                                          |
| `docs/architecture/processing-data-model.md`           | PRD、处理专题                                     | processing                 | planned/blocked               | 事件协议、存储 ADR、容量和保留规则                                                                                     |
| `docs/prd/platform-product-domains.md`                 | UX/UI A1—D2、NAV-A、AUDIT-A、PRD                  | product/platform           | exists/approved               | 页面细节继续回读完整 UX/UI；域过大时才评估拆分                                                                         |
| `docs/protocol/event-schema-foundation.md`             | PRD、架构/代码/测试规范、ADR-005/006/007          | protocol                   | exists/approved planning spec | 协议基础增量计划已执行；信封/版本/运行时边界/共享样本已实施；具体事件正文 deferred                                     |
| `docs/protocol/event-envelope-v1.md`                   | event-schema 基础规格与真实实现                   | protocol                   | exists/approved               | 信封字段、限制、禁止字段、合法/非法示例与兼容规则由文档契约测试验证                                                    |
| `docs/sdk/sdk-core-foundation.md`                      | PRD、架构/代码/测试/文档规范、ADR-003/005/006/007 | sdk                        | exists/approved planning spec | 单一模块计划已执行；`packages/core` 基础增量已实施并通过新鲜验证；Browser、具体插件、采样、队列、传输与持久化仍 absent |
| `docs/sdk/getting-started.md`                          | PRD、SDK 设计、C1                                 | sdk                        | planned/blocked               | 包名/版本、公共 API、真实示例                                                                                          |
| `docs/sdk/configuration.md`                            | PRD、SDK 设计                                     | sdk                        | planned/blocked               | 配置 Schema、默认值和隐私规则                                                                                          |
| `docs/sdk/public-api.md`                               | SDK 设计、event-schema                            | sdk                        | planned/blocked               | 公共 TypeScript 契约 accepted                                                                                          |
| `docs/sdk/lifecycle-and-plugins.md`                    | ADR-003、SDK 设计                                 | sdk                        | planned/blocked               | 生命周期/插件接口与宿主安全测试                                                                                        |
| `docs/sdk/framework-integrations.md`                   | React/Vue 适配设计                                | sdk                        | planned/blocked               | Core/Browser 公共 API 与框架矩阵                                                                                       |
| `docs/sdk/privacy-and-compatibility.md`                | PRD、架构、TDR                                    | sdk/security               | planned/blocked               | 浏览器/框架真实设备证据、隐私评审                                                                                      |
| `docs/api/ingestion-openapi.*`                         | 接入设计、事件协议                                | ingestion                  | machine/blocked               | Schema 工具、密钥、缓冲与错误语义                                                                                      |
| `docs/api/processing-query-command-openapi.*`          | 处理/存储、平台后端                               | processing                 | machine/blocked               | 数据模型、Query/Command、权限/水位                                                                                     |
| `docs/api/platform-openapi-v1.yaml`                    | 总体 OpenAPI 设计、平台后端、UX/UI A1—D2、A5      | backend                    | machine/blocked               | 总体方案已批准；D2、Session、下游契约、Zod/OpenAPI 工具 ADR 与单模块计划仍阻塞                                         |
| `docs/testing/test-strategy.md`                        | 测试规范、TDR                                     | quality                    | exists/approved policy        | 可执行命令/结果 deferred；真实证据 requires-benchmark                                                                  |
| `docs/testing/browser-and-framework-compatibility.md`  | TDR、SDK/前端设计                                 | quality                    | planned/blocked               | 真实 Safari/移动设备和框架版本证据                                                                                     |
| `docs/testing/performance-baselines.md`                | TDR 预算                                          | performance                | planned/blocked               | 版本化参考工程、设备/网络档位和首次基准                                                                                |
| `docs/testing/ci-quality-gates.md`                     | 测试规范、TDR                                     | quality/release            | planned/blocked               | 工程工具、工作流、真实命令                                                                                             |
| `docs/releases/versioning-and-artifacts.md`            | Monorepo/SDK/TDR                                  | release                    | planned/blocked               | 版本/发布 ADR、包和制品清单                                                                                            |
| `docs/releases/release-migration-and-rollback.md`      | TDR、数据库/部署设计                              | release                    | exists/approved policy        | 流水线/脚本 deferred；发布/Migration ADR required                                                                      |
| `docs/operations/aws-deployment.md`                    | TDR                                               | operations                 | planned/blocked               | 主区域、账号、网络、IaC、容量、成本                                                                                    |
| `docs/operations/backup-and-recovery.md`               | TDR、A5                                           | operations                 | exists/approved design        | 资源/IaC deferred；恢复演练 requires-benchmark                                                                         |
| `docs/operations/incident-response.md`                 | TDR                                               | operations                 | planned/blocked               | 值班 Owner、事故渠道、告警实现                                                                                         |
| `docs/operations/queue-backlog-and-dead-letter.md`     | 接入/处理、TDR                                    | operations                 | planned/blocked               | 缓冲/任务技术和死信策略                                                                                                |
| `docs/operations/data-deletion.md`                     | PRD、A5/C16/B8、TDR                               | operations/security        | planned/blocked               | 账号/项目永久删除、备份副本规则                                                                                        |
| `docs/security/account-and-session-security.md`        | A1—A5、后端、TDR                                  | security                   | planned/blocked               | A5 已正式化；仍需 Session/CSRF/密码 ADR与参数评审                                                                      |
| `docs/security/credentials-and-secrets.md`             | B6/C9/C14、TDR                                    | security                   | planned/blocked               | 密钥交付、scope、KMS/Secrets ADR                                                                                       |
| `docs/security/authorization-and-audit.md`             | B3/B7/C13/C16/D2、后端                            | security                   | planned/blocked               | D2 平台管理员/审计、权限矩阵                                                                                           |
| `docs/security/account-deletion-and-data-lifecycle.md` | PRD、A5、UX/UI、TDR                               | security/privacy           | exists/approved               | A5 机器契约/模型/Runbook deferred；实现需 accepted ADR                                                                 |

模块 README 只能在真实 `apps/*` 或 `packages/*` 模块创建时落盘，记录职责/非职责、公开接口、输入输出、依赖、配置、错误、测试和上述权威链接。`packages/event-schema/README.md` 已随协议基础第一增量实施与真实包同步创建，并由文档契约测试验证其示例。

## 6. ADR-001—ADR-007 审批结果

2026-07-29 已完成独立非作者和所需领域评审。此后 ADR-001/006 随真实 Workspace 约束进入 `accepted / in-progress`，ADR-007 随首模块验证进入 `accepted / implemented`，ADR-005 随 event-schema 信封基础进入 `in-progress`，ADR-003 随 Core 基础第一增量进入 `in-progress`；ADR-002、ADR-004 仍为 `accepted / not-started`。各 ADR 追加记录是详细证据，接受本身不得解释为 implemented。

| ADR                                                                             | 已并入的新证据/约束                                         | 候选方案复审                                             | 已覆盖评审角色                                                                                         | 验证与重新评估重点                          | 审批结果               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ---------------------- |
| [ADR-001 Monorepo](../adr/ADR-001-use-monorepo.md)                              | 根规范例外、协议原子变更、独立制品、部署/测试/发布追踪      | Monorepo、多仓库、混合仓库三案真实；工具拆出             | non-author、architecture、tooling、sdk/backend consumer、release                                       | 依赖图、受影响构建、发布隔离；规模/团队变化 | accepted / in-progress |
| [ADR-002 五大边界](../adr/ADR-002-five-system-boundaries.md)                    | 同云/仓库/语言不合并逻辑边界；公开 API；跨系统删除确认      | 五大职责、按部署应用、首日微服务三案真实                 | non-author、architecture、sdk、ingestion、processing、platform、security/infrastructure                | 公共接口、同部署约束、拆分触发与迁移        | accepted / not-started |
| [ADR-003 SDK 插件架构](../adr/ADR-003-sdk-plugin-architecture.md)               | Browser/插件/框架边界、统一管道、宿主安全、资源恢复、多实例 | 分层、单体、全局单例插件三案真实                         | non-author、sdk、browser、framework、security/privacy、performance                                     | 包体、长任务、内存、宿主故障、迁移兼容      | accepted / in-progress |
| [ADR-004 可靠接收与异步处理](../adr/ADR-004-asynchronous-event-processing.md)   | 确认、幂等、积压/死信、恢复与 A5 重放；BullMQ 范围纠正      | 可靠缓冲异步、同步全处理、易失队列三案真实；物理缓冲拆出 | non-author、sdk、ingestion、processing、reliability、security、performance、infrastructure、operations | 不静默丢失、重复/乱序、重试、积压、灾难恢复 | accepted / not-started |
| [ADR-005 event-schema 单一来源](../adr/ADR-005-event-schema-source-of-truth.md) | 独立协议、共享契约、不可信输入、版本兼容与隐私              | 独立单一来源、各端重复、服务端生成三案真实               | non-author、protocol、sdk、ingestion、processing、security/privacy、compatibility                      | 合法/非法样本、兼容窗口、生成一致性、包体   | accepted / in-progress |
| [ADR-006 单向依赖](../adr/ADR-006-one-way-dependencies.md)                      | 允许/禁止方向、受控例外；实施证据与接受门禁分离             | 自动约束、人工评审、全远程边界三案真实                   | non-author、architecture、tooling、sdk、frontend、backend、framework                                   | 类型/运行时/测试依赖、例外治理、检查性能    | accepted / in-progress |
| [ADR-007 Workspace 工具](../adr/ADR-007-workspace-package-and-task-tooling.md)  | pnpm Workspace、锁文件、原生任务、无远程缓存                | pnpm 原生、pnpm＋Turbo、npm 原生三案真实                 | non-author、architecture、tooling、quality、consumer                                                   | 可重复安装、命令稳定、规模/反馈时间触发     | accepted / implemented |

ADR-004 的平台 BullMQ 外推和 ADR-006 的接受前实施证据门禁已在独立评审中修正并重新通过；其他非阻断改进也已归入正文或追加记录。任何 ADR 进入 `implemented` 前仍须提供各自列出的新鲜实现和验证证据。

## 7. 新 ADR 候选队列

Workspace、包管理器和首期任务策略已经由 accepted [ADR-007](../adr/ADR-007-workspace-package-and-task-tooling.md)收口，不再列为候选。下表其余项不预占编号，也不替代后续 ADR 正文；只有直接阻塞所选模块时才建立独立提案。

| 排序（非 ADR 编号） | 候选决策                          | 至少两个真实候选                                                                   | 当前推荐输入                                          | Owner/评审                                         | 建立前置条件                                |
| ------------------: | --------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
|                   2 | 版本与发布策略                    | 独立包版本＋Changesets；统一版本；混合发布列车                                     | SDK 包与应用制品独立，但协议兼容需协调                | release / sdk、backend、protocol                   | 包关系、兼容窗口、发布频率                  |
|                   3 | 管理平台前端技术栈                | approved Vue3/Vite/Router/Pinia；React/Vite＋对应状态栈；SSR/BFF方案仅作被否决比较 | approved Vue 方案                                     | platform / architecture、quality、security         | 精确版本、参考构建与迁移成本                |
|                   4 | 管理平台服务形态与后端栈          | approved Node/Fastify模块化单体＋Worker；NestJS模块化单体；JVM/Spring模块化单体    | approved Node/Fastify方向                             | backend / architecture、operations、security       | 容量原型、版本支持、迁移与观测证据          |
|                   5 | 平台数据库与访问/Migration        | PostgreSQL＋Kysely＋SQL Migration；PostgreSQL＋Prisma；PostgreSQL＋Drizzle         | approved Kysely方向                                   | backend/data / operations、security                | 数据模型、复杂查询原型、迁移演练            |
|                   6 | 平台 Outbox、任务、缓存与对象     | PostgreSQL Outbox＋Redis/BullMQ＋S3；Outbox＋SQS＋S3；托管事件总线＋对象存储       | approved BullMQ设计方向，仅限平台域                   | backend/operations / data、security                | 租约/并发/死信/成本/恢复证据                |
|                   7 | Session、CSRF 与内部能力令牌      | Redis 不透明 Session＋同步 CSRF；数据库 Session；短 JWT＋服务端撤销存储            | approved Redis Session方向；A5 Session 终止语义已固定 | security / backend、platform、operations           | 邮件规则、故障/撤销/KMS参数与安全评审       |
|                   8 | 数据接入可靠缓冲与运行基础设施    | SQS；Kinesis；Kafka/MSK；自管数据库队列仅作边界比较                                | 未决定；以确认语义、容量和恢复为先                    | ingestion / processing、operations、security       | 事件大小/速率、顺序、重试和成本模型         |
|                   9 | 处理、聚合与分析存储              | PostgreSQL分区/汇总；ClickHouse；DynamoDB＋专用聚合；组合方案                      | 未决定；第一版无独立搜索保持有效                      | processing/data / operations、privacy、performance | Query模型、保留、基数、容量原型             |
|                  10 | 数据库、对象、缓存、搜索职责边界  | 单一PostgreSQL＋S3＋Redis；增加ClickHouse；增加OpenSearch                          | 第一版不引入独立搜索，除非证据触发                    | data/architecture / backend、operations            | 查询/容量/成本与删除传播证据                |
|                  11 | AWS 账号、区域、网络与 IaC        | CDK TypeScript；Terraform；CloudFormation原生                                      | approved设计推荐CDK，主区域未决定                     | cloud/operations / security、release、privacy      | 数据驻留、账号Owner、成本预算、区域服务核验 |
|                  12 | 不可变制品、Migration、晋级与回滚 | GitHub Actions＋OIDC＋Environment；AWS CodePipeline；其他同等来源证明流水线        | approved GitHub Actions方向                           | release / backend、database、security、operations  | 生产批准者、制品清单、迁移演练              |
|                  13 | 公共浏览器/框架兼容承诺           | 最近两个主版本滚动支持；固定长期版本窗口；能力检测优先矩阵                         | approved TDR滚动矩阵                                  | sdk/platform/quality / support、release            | 真实 Safari/移动设备与框架样例证据          |

不得把以上内容合并成“大一统技术栈 ADR”。Owner、评审者、迁移/回滚边界不同的安全、数据、基础设施和公共兼容决定必须拆分；频繁变化的版本、命令、阈值和 Runbook 放普通正式文档。

## 8. 产品、安全、技术与运营缺口

推荐均为待审查建议，不是 approved 结论。

|              优先级 | 缺口与来源                                                                         | 影响范围                              | 当前状态                                           | 候选方案                                                                                             | 推荐                                                                                       | Owner                            | 最迟解决门禁                  | 未解决时阻塞                                |
| ------------------: | ---------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------- | ------------------------------------------- |
| 1（产品规则已解除） | A5 账号注销、删除/匿名化、保留、身份复核、Session影响；PRD/UX GAP-04/05、BE-GAP-07 | 账号、组织成员、备注/审计、备份、邮件 | approved并正式化                                   | 7 天冷静期、双重身份复核、全部 Session 终止、普通业务匿名保留、一年审计、7 天在线清理、35 天备份淘汰 | 不再讨论产品方案；转入账号 OpenAPI、数据模型、删除 Runbook、测试和 Session/安全 ADR        | product/security/privacy         | 进入相关机器契约/ADR审批前    | 只阻塞机器契约和实现，不再阻塞正式产品语义  |
|                   2 | D2 平台管理员身份、授予/撤销和平台级审计；GAP-10、BE-GAP-08                        | 平台策略、全局搜索、审计、紧急权限    | product/security decision required                 | 数据库显式能力；企业IdP组映射；云控制面身份直连                                                      | 服务端显式平台能力＋独立平台审计；外部IdP只作授予来源，保留break-glass流程                 | product/security/operations      | D2 OpenAPI、权限模型前        | D2、授权/审计文档、安全ADR                  |
|                   3 | Session/Cookie/CSRF/密码/内部令牌参数                                              | 所有认证与服务间调用                  | design direction approved; security review missing | Redis不透明Session；数据库Session；短JWT＋撤销存储                                                   | 以approved Redis Session方向评审故障、撤销、固定/轮换、KMS与密码参数                       | security/backend                 | 安全ADR与认证OpenAPI前        | A1—A5、B6、平台上线                         |
|                   4 | 邮件发送责任、供应商、期限、冷却和失败恢复；GAP-03、BE-GAP-09                      | 验证、重置、邀请                      | product/operations/security missing                | 单供应商适配；双供应商故障切换；云原生邮件服务                                                       | 第一版单供应商经 `EmailDeliveryPort` 隔离，Outbox权威记录请求，明确送达非承诺和恢复责任    | product/operations/security      | 认证/邀请契约和发布前         | A1/A3/A4、Outbox、Runbook                   |
|                   5 | 数据保留、永久删除、审计与备份副本                                                 | A5、B7/B8、C4/C9/C16、处理存储        | partially defined by PRD                           | 同步删除主存＋备份到期；加密擦除；跨副本删除任务                                                     | 按数据分类定义主存期限、删除任务、备份不可变窗口与到期清理；保留最小审计墓碑不得含监控内容 | privacy/security/data/operations | 数据模型、处理ADR和备份方案前 | 删除API、存储模型、恢复/合规说明            |
|                   6 | AWS 主区域、数据驻留、账号/网络、运营责任                                          | 全系统部署/恢复                       | design direction approved; region/owners missing   | 中国/亚太/其他主区域；单账号分环境；生产/非生产/日志备份多账号                                       | 先由目标用户地域与合规确定主区域；至少生产/非生产账号隔离，明确数据与值班Owner             | product/privacy/cloud/operations | AWS/IaC ADR前                 | IaC、容量、备份、区域灾难目标               |
|   7（首模块已解除） | Monorepo 工具、Node/包管理器、版本/缓存                                            | 所有模块、CI、发布                    | ADR-007 accepted；首模块规格 approved              | pnpm Workspace＋原生 scripts；无任务编排器/远程缓存                                                  | 版本/发布继续 deferred，真实反馈时间 requires-benchmark                                    | tooling/release                  | 首个公开包或制品规划前        | 不阻塞私有根 Workspace；仍阻塞发布/制品策略 |
|                   8 | 数据接入/处理吞吐、事件大小、基数和容量                                            | SDK、接入、处理、存储、SLO            | no evidence                                        | 保守初始假设；生产流量样本；合成负载模型                                                             | 先建立合成但可复现容量模型，再决定缓冲/存储ADR                                             | ingestion/processing/performance | ADR-004及数据基础设施ADR前    | 协议限制、缓冲、分区、成本、SLO             |
|                   9 | 真实Safari/iOS/Android与框架版本提供方                                             | SDK与管理平台发布                     | design matrix approved; evidence missing           | 自建设备实验室；可信设备云；组合                                                                     | 第一版可信设备云＋少量关键实机复核                                                         | quality/release                  | 发布兼容文档和首个release前   | 公共兼容承诺、发布门禁                      |
|                  10 | 生产批准者、值班/事故渠道、成本预算                                                | 发布/运维                             | organization assignment missing                    | 团队轮值；专职Owner；外部托管支持                                                                    | 每个环境/服务指定业务、技术、数据、安全和事故Owner，生产批准者与提交者分离                 | operations/release/management    | CI/IaC/Runbook批准前          | 生产晋级、告警、事故和成本治理              |
|                  11 | 客户端上报密钥的交付/重显/轮换语义                                                 | C1/C14、SDK配置                       | security contract missing                          | 可重显公开密钥；一次性交付；前缀＋受控重置                                                           | 根据浏览器可见凭据威胁模型单独设计，不套用B6私密令牌规则                                   | security/sdk/backend             | C14 OpenAPI与SDK配置前        | C1/C14、密钥审计和轮换                      |
|                  12 | 项目回收站恢复后的状态                                                             | B8/C16、告警/密钥/令牌/成员           | product rule incomplete                            | 恢复到active；恢复到archived；恢复原状态                                                             | 恢复到服务端明确安全状态并保持告警不自动启用、已撤销令牌不恢复；最终状态需产品批准         | product/security                 | Lifecycle OpenAPI/模型前      | B8/C16、删除/恢复测试                       |

### 8.1 A5 账号注销与数据生命周期批准记录

本节追踪已经整体批准的 A5 产品与安全规则。本文作为实施就绪工作矩阵继续保持 `draft`，但 A5-001—011 和对应正式安全文档均为 `approved`。批准不创建 API、字段、数据模型、任务、基础设施或实现授权，也不修改任何 ADR 状态。

详细长期规则唯一维护于[账号注销与数据生命周期](../security/account-deletion-and-data-lifecycle.md)；[A5 专项设计](../superpowers/specs/2026-07-29-aurora-account-deletion-data-lifecycle-design.md)作为批准依据和设计历史保留。下表只保留决策追踪。

| 决策范围      | 状态     | 唯一详细权威来源                                                             | 批准依据                                                                                        | 下游状态                                                                                              |
| ------------- | -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A5-001—A5-011 | approved | [账号注销与数据生命周期](../security/account-deletion-and-data-lifecycle.md) | [A5 专项设计](../superpowers/specs/2026-07-29-aurora-account-deletion-data-lifecycle-design.md) | API/模型/删除任务 `deferred`；Session/基础设施 `requires-accepted-adr`；恢复演练 `requires-benchmark` |

## 9. 机器契约和可执行规格清单

| 机器契约/规格                            | Producer → Consumer                      | 当前设计来源                                                                        | required前置                         | 当前状态与阻塞                                                                                         |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `event-schema` 运行时 Schema、版本与样本 | protocol → SDK/ingestion/processing/docs | [基础增量规格](../protocol/event-schema-foundation.md)、PRD、ADR-005                | 已实现 Workspace、ADR-005/006/007    | 信封基础已实施（版本化信封、运行时边界校验、共享样本）；具体事件正文、批次/接收协议和兼容转换仍 absent |
| SDK 公共 API 与配置 Schema               | SDK → 应用/适配/示例                     | PRD、SDK设计、[Core 基础规格](../sdk/sdk-core-foundation.md)                        | event-schema、ADR-003/005/006/007    | Core 第一增量接口已实施；完整 SDK API、采集配置与具体事件正文仍 absent                                 |
| Browser Environment 与插件接口           | Core/Browser → 采集插件/框架适配         | SDK设计、架构规范、[Browser 环境基础规格](../sdk/browser-environment-foundation.md) | SDK公共API、宿主安全基准             | Browser 环境与生命周期基础第一增量已实施；具体插件接口、采集插件与框架适配仍 absent                    |
| 数据接入 OpenAPI                         | SDK/客户 → ingestion                     | 接入基线、TDR                                                                       | event-schema、密钥、缓冲ADR          | absent                                                                                                 |
| 接收结果、稳定错误码、重试/限频语义      | ingestion → SDK/C1/C7                    | PRD、UX C1/C7                                                                       | 接入OpenAPI、容量/保护策略           | absent                                                                                                 |
| 处理系统 Query/Command                   | processing → platform-api                | 处理专题、平台后端                                                                  | 数据模型、权限、水位/完整性          | absent                                                                                                 |
| Platform Contract 与 Platform OpenAPI    | platform-api → Vue SPA                   | approved 总体 OpenAPI 设计、UX/UI、平台后端、A5                                     | D2、Session、下游契约、Schema工具ADR | 总体设计 approved；`platform-contract`、机器 OpenAPI、生成 Client/适配和领域 Schema absent/blocked     |
| 平台可执行数据模型与SQL Migration        | backend → PostgreSQL                     | 平台后端、A5                                                                        | D2、数据库ADR、OpenAPI领域对象       | absent；A5 产品前置已解除                                                                              |
| 处理/存储可执行模型                      | processing → 数据/对象/任务存储          | PRD、处理专题                                                                       | 基础设施ADR、容量/保留               | absent                                                                                                 |
| 事务、幂等与Operation Result             | Commands → 前端/CLI/Worker               | UX/UI、平台后端                                                                     | 每域状态机和错误契约                 | absent                                                                                                 |
| Outbox、任务状态、租约、重试和死信       | platform/processing → Worker/operations  | 后端/TDR                                                                            | 队列ADR、容量、恢复规则              | absent                                                                                                 |
| Source Map对象键、摘要、替换和重解析     | C9/CLI → object/processing               | PRD、UX C9、后端                                                                    | 对象/任务ADR、scope和删除            | absent                                                                                                 |
| 数据库expand/contract与兼容窗口          | release → API/Worker/database            | TDR                                                                                 | 数据模型、发布ADR                    | absent                                                                                                 |
| 前端请求缓存与失效契约                   | platform-api → Router/Pinia stores       | 前端技术栈、UX/UI                                                                   | 平台OpenAPI、错误/Operation          | absent                                                                                                 |
| IaC配置、秘密引用和制品清单 Schema       | release → AWS/runtime/audit              | TDR                                                                                 | AWS/IaC与发布ADR                     | absent                                                                                                 |

只有相关产品规则和 required ADR 收敛后才能创建这些机器契约。设计文档中的“Query”“Command”“能力名”和建议路径不等于机器契约；信息不足时保持 absent/blocked，不编造字段。

## 10. 兼容、性能、可靠性与发布门禁快照

以下数值来自已批准测试/部署/发布设计，当前是设计预算，不是已测结果。

### 10.1 兼容矩阵

| 范围       | 已批准设计                                                                | 仍缺证据                              |
| ---------- | ------------------------------------------------------------------------- | ------------------------------------- |
| 桌面浏览器 | Chrome、Edge、Firefox 最近两个稳定主版本；Safari 最近两个主版本；不支持IE | 精确版本表、真实Safari和自动/人工结果 |
| 移动浏览器 | iOS Safari 最近两个主版本；Android Chrome 当前与前一稳定主版本            | 真实设备或可信设备云                  |
| 自动浏览器 | Playwright Chromium/Firefox/WebKit                                        | WebKit不能单独证明Safari/iOS          |
| 框架       | React/Vue适配需与Core/Browser兼容组合测试                                 | 精确框架版本、可执行示例              |
| 可访问性   | WCAG 2.2 AA目标；axe＋人工键盘/焦点/缩放/屏幕阅读器                       | 人工评审与真实辅助技术证据            |

### 10.2 性能预算

| 对象                  | 已批准预算                                                       | 当前证据              |
| --------------------- | ---------------------------------------------------------------- | --------------------- |
| Core基础包            | ≤10 KiB gzip                                                     | 无参考构建            |
| Browser＋Core最小接入 | ≤30 KiB gzip                                                     | 无参考构建            |
| 单个可选采集插件      | 增量≤8 KiB gzip                                                  | 无插件制品            |
| React/Vue适配         | 单个增量≤5 KiB gzip                                              | 无适配制品            |
| SDK初始化             | 桌面p95≤20ms；中档移动p95≤50ms                                   | 无版本化设备/页面脚本 |
| SDK宿主开销           | 不产生单次SDK归因>50ms Long Task；稳态附加Heap≤5MiB；包装p95≤1ms | 无基准                |
| SPA初始非图表路由     | ≤300 KiB gzip                                                    | 无构建                |
| ECharts路由增量       | ≤250 KiB gzip，懒加载                                            | 无构建                |
| Lighthouse CI         | Performance≥85；LCP≤2.5s；CLS≤0.1；TBT≤200ms                     | 无预发布环境          |
| 真实用户INP           | 足够样本后核心页面p75≤200ms                                      | 无RUM样本             |

### 10.3 SLO、RPO、RTO

| 目标                  | 已批准设计                                                    | 当前证据            |
| --------------------- | ------------------------------------------------------------- | ------------------- |
| 数据接入可用性        | 月度99.9%                                                     | 无服务/指标         |
| platform-api可用性    | 月度99.9%                                                     | 无服务/指标         |
| 简单平台Query/Command | 服务端p95 500ms/1s                                            | 无实现/负载         |
| 跨处理组合读取        | p95 1.5s，可返回partial/stale                                 | 无契约/负载         |
| 处理新鲜度            | 正常容量下95%≤60秒，99%≤5分钟                                 | 无吞吐模型/积压测试 |
| PostgreSQL单区域多AZ  | RPO≤5分钟，RTO≤60分钟                                         | 无资源/恢复演练     |
| 区域级第一版          | RPO≤24小时，RTO≤8小时                                         | 主区域/备份/IaC未定 |
| 错误预算              | 99.9%约43.8分钟/月；消耗50%限制高风险发布，耗尽暂停非关键发布 | 无SLO平台/告警      |

### 10.4 CI与发布门禁

| 阶段     | 已批准设计门禁                                                                                             | 未就绪原因                 |
| -------- | ---------------------------------------------------------------------------------------------------------- | -------------------------- |
| PR       | 文档/ADR、架构、类型/Lint/构建、受影响测试、契约、SDK exports/体积/Chromium、关键Playwright、Migration/IaC | 无代码、工具、工作流和命令 |
| main     | 生成不可变制品、部署预发布、核心E2E/Migration                                                              | 无制品/环境                |
| nightly  | 多引擎、完整E2E、示例、稳定性/内存、安全、协议组合、队列/处理恢复、故障注入                                | 无系统/设备/依赖           |
| release  | 完整支持矩阵、性能/负载/积压、备份恢复、Migration/回滚、SBOM/来源证明、人工可访问性                        | 无发布候选和证据           |
| 生产晋级 | 同一制品、独立批准者、短期OIDC、ECS熔断、expand/contract                                                   | 无AWS/IaC/批准角色         |

## 11. 正式化批次与未来模块依赖

### 11.1 正式化批次

|        批次 | 产出                                                                                                                                            | 前置                                                                 | 完成边界                                                                           |
| ----------: | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 0（已完成） | 六专题批准同步、矩阵/树/队列                                                                                                                    | 用户批准消息                                                         | 不改变 ADR，不创建实现                                                             |
| 1（已完成） | A5 账号注销、删除/匿名化、保留、身份复核与 Session 影响                                                                                         | approved A5-001—011                                                  | 已进入正式安全文档                                                                 |
| 2（已完成） | 系统、SDK、管理平台、测试、部署、发布/恢复和安全的最小充分正式文档                                                                              | approved 设计与文档规范                                              | 无重复当前权威；未建空壳/机器契约                                                  |
| 3（已完成） | ADR-001—006 非作者/领域评审；ADR-007 与首模块规格                                                                                               | 真实候选、独立评审、模块依赖审查                                     | ADR-001—007 accepted；Monorepo 规格 approved                                       |
| 4（已完成） | [私有 Monorepo 根 Workspace 与最小本地工具实施计划](../superpowers/plans/2026-07-29-monorepo-foundation.md)                                     | 对应 ADR/spec 就绪                                                   | 已实施并由 2026-07-30 新鲜验证核验                                                 |
| 5（已完成） | [event-schema 协议基础规格](../protocol/event-schema-foundation.md)与[单一模块计划](../superpowers/plans/2026-07-30-event-schema-foundation.md) | 已实现 Workspace、ADR-005/006/007、approved 产品与架构语义           | 协议基础增量已实施并通过 2026-07-30 新鲜验证                                       |
| 6（已完成） | [SDK Core 基础规格](../sdk/sdk-core-foundation.md)与[单一模块计划](../superpowers/plans/2026-07-30-sdk-core-foundation.md)                      | 已实现 event-schema 信封基础、ADR-003/005/006/007、approved SDK 规则 | `packages/core` 基础增量已实施并通过 2026-07-30 新鲜验证；ADR-003 进入 in-progress |
|           7 | 具体事件正文、其余 SDK、接入 API/缓冲、处理模型/Query/Command                                                                                   | 对应模块 ADR/spec 及上游实现                                         | 唯一机器契约可契约测试                                                             |
|           8 | 实施 Platform Contract、机器 OpenAPI、平台数据模型/Migration、权限/领域错误/Operation 与前端缓存契约                                            | 总体设计已批准；仍需 D2/Session、处理契约、required ADR 与单模块计划 | A1—D2 获得唯一机器公开能力；31 页面/36 Route Target 可生成并验证                   |
|           9 | 真实模块 README、CI/IaC、兼容/性能/容量和恢复证据                                                                                               | 真实模块、工具、环境存在                                             | 文档与实现/验证一致                                                                |
|          10 | 各模块实施就绪审查                                                                                                                              | 仅检查该模块直接前置                                                 | 逐模块决定是否允许 `writing-plans`，不要求全项目同时就绪                           |

### 11.2 未来模块分解和依赖顺序

以下是模块级依赖与门禁；A0 已实施，A1 只有计划、尚未实施：

| 波次 | 模块边界                                                                                                                                     | consumes                                                   | produces                                                          | 当前状态                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A0   | 1 私有 Monorepo 根 Workspace 与最小本地工具                                                                                                  | ADR-001/006/007、approved Monorepo 规格                    | 可重复 Workspace、policy 工具、`check:ci` 命令入口                | implemented                                                                                                             |
| A1   | 2 `event-schema` 协议基础第一增量                                                                                                            | 已实现 Workspace、ADR-005/006/007、approved 基础规格       | 版本化公共信封、运行时边界校验与共享契约样本                      | partially implemented：信封/版本/运行时边界/共享样本已实施；具体事件正文、批次 Schema、兼容转换和真实消费者继续 blocked |
| A2   | 32 CI 与测试基础设施                                                                                                                         | 已实现 Workspace、真实模块命令、测试策略                   | PR/main/nightly/release 工作流                                    | blocked：真实模块与环境 absent                                                                                          |
| B    | 3 SDK Core；4 Browser层；5—8错误/请求/性能/行为插件；9—10 Vue/React适配                                                                      | event-schema、SDK公共API、宿主预算                         | 独立包、公开接口、浏览器/框架证据                                 | Core 基础第一增量 implemented（ADR-003 in-progress）；Browser、具体插件与适配器 blocked                                 |
| C    | 11接入API；12可靠缓冲；13事件消费/幂等事实；14问题聚合；15请求/性能指标；16发布/Source Map；17告警；18保留/回收站/永久删除                   | 协议、接入/数据ADR、容量/保留                              | 可查询处理能力与公开Query/Command                                 | blocked                                                                                                                 |
| D    | 19 Platform Contract/认证/Session；20工作空间/组织/成员/邀请；21项目/环境/密钥/设置；22私密令牌/审计；23问题/指标/发布/告警查询；24通知/策略 | approved 总体契约设计、A5/D2/Session规则、下游契约         | `platform-contract`、机器 OpenAPI、`platform-api`领域与Worker能力 | blocked：总体设计 approved，机器契约、ADR、模型和下游前置 absent                                                        |
| E    | 25前端壳/路由/权限/请求层；26账号认证；27组织治理；28接入诊断；29问题/请求/性能；30发布/Source Map/告警；31项目治理/通知/策略                | 机器 Platform OpenAPI、生成 Client、前端缓存契约、领域文档 | 可独立验收的前端流程增量；31 页面/36 Route Target 真实可达        | blocked                                                                                                                 |
| F    | 33 AWS/IaC；34部署/Migration/发布/回滚；35可观测性/备份/Runbook                                                                              | 可运行模块、ADR、容量、区域/Owner                          | 预发布/生产运行与恢复证据                                         | blocked                                                                                                                 |

每次只能选择一个已具备前置条件、职责单一、输入输出明确、可独立测试和独立验收的模块。过大模块必须继续拆分；不能从页面跳到数据库、从高层设计跳到云资源，也不能把未来模块实现偷带入当前模块。

## 12. 实施就绪结论

首个有界模块“私有 Monorepo 根 Workspace 与最小本地工程工具”已实施并通过指定的完整新鲜验证。第二个有界模块 `event-schema` 协议基础第一增量已实施：版本化公共信封、运行时边界校验、稳定错误和共享契约样本真实存在并通过新鲜验证；ADR-005 进入 `accepted / in-progress`。第三个有界模块 `@aurora/core` SDK Core 生命周期与插件编排基础第一增量已实施：环境无关 Core、显式生命周期、最小冻结配置、插件注册与顺序编排、异常隔离、事件入口和多实例隔离真实存在并通过新鲜验证；ADR-003 进入 `accepted / in-progress`。第四个有界模块 `@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量已实施：安全环境与能力探测、脱敏页面快照、`visibilitychange`/`pagehide`/`pageshow` 生命周期订阅、幂等释放、异常隔离和多实例隔离真实存在并通过 2026-07-30 新鲜验证（含本地 Chromium 真实浏览器门禁）；ADR-003/006 保持 `accepted / in-progress`。这些增量不定义具体事件正文、具体采集插件或传输，也不依赖尚不存在的服务端或基础设施。

D2、邮件、Session、A5 之外保留、AWS 区域、运营责任、具体事件字段、数据库、容量和发布策略都不被 Browser 环境基础第一增量消费，继续只阻塞各自直接模块。具体错误/请求/性能/资源事件正文、批次/接收协议、兼容转换、具体采集插件、框架适配、采样、队列、传输、持久化、接入、处理、平台、CI、发布和 AWS/IaC 仍未获规划或执行授权。

`event-schema` 协议基础第一增量[实施计划](../superpowers/plans/2026-07-30-event-schema-foundation.md)、SDK Core 基础第一增量[实施计划](../superpowers/plans/2026-07-30-sdk-core-foundation.md)与 Browser 环境基础第一增量[实施计划](../superpowers/plans/2026-07-30-browser-environment-foundation.md)均已执行完毕并通过 2026-07-30 新鲜验证；`@aurora/browser` 是第四个真实内部包，ADR-003/006 保持 `accepted / in-progress`。具体事件正文 Schema、具体采集插件与框架适配仍需各自 approved 规格和上游实现；采样、队列、传输与持久化继续 blocked；本轮不自动开始下一个模块。

管理平台总体 OpenAPI 与实现约束设计已于 2026-07-30 批准：采用统一公开契约、内部按领域模块化并生成单一 Platform OpenAPI；31 个页面设计映射 36 个稳定 Route Target，前端壳层和真实 UI 可达性先行。该批准只关闭总体设计门禁；`platform-contract`、机器 OpenAPI、生成 Client/Fastify 适配、领域 Schema、平台数据模型和管理平台代码仍不存在，且未授权自动进入实施计划。

管理平台控制台视觉语言已于 2026-07-30 批准：浅色内容区、深石墨顶栏、纯色琥珀橙侧栏、深色前景、中高信息密度且禁止渐变。后续同方向、且不改变产品、权限、安全、数据或公共契约的低风险视觉细节可由 Agent 直接批准并同步；设计令牌代码、主题、组件和浏览器证据仍不存在，不因此自动进入实施计划。
