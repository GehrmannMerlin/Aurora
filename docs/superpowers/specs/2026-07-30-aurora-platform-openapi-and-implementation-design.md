---
title: Aurora 管理平台总体 OpenAPI 与实现约束设计
status: approved
owner: platform/backend
created: 2026-07-30
last-reviewed: 2026-07-30
applies-to: Aurora 第一版管理平台 A1—D2、NAV-A、platform-api、Vue SPA 与公开机器契约
related:
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
  - ../../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - "../../../Aurora 架构规范.md"
  - "../../../Aurora 测试规范.md"
  - "../../../Aurora 文档规范.md"
  - "../../../Aurora ADR 规范.md"
  - ../../adr/ADR-002-five-system-boundaries.md
  - ../../adr/ADR-006-one-way-dependencies.md
  - ../../architecture/platform-frontend.md
  - ../../architecture/platform-backend.md
  - ../../architecture/formalization-readiness.md
  - ../../prd/platform-product-domains.md
  - ./2026-07-27-aurora-frontend-ux-ui-design.md
  - ./2026-07-28-aurora-frontend-technology-stack-design.md
  - ./2026-07-28-aurora-platform-backend-design.md
supersedes: none
design-stage: approved-design-machine-artifacts-absent
---

# Aurora 管理平台总体 OpenAPI 与实现约束设计

## 1. 文档定位

本文把已批准的 A1—D2、`NAV-A`、前端技术栈和管理平台后端设计收口为一套可生成机器契约的总体方案，并规定后续实现顺序、依赖边界和验收门禁。用户已选择“统一公开契约、内部模块化、生成单一 Platform OpenAPI”的方案 A，并授权其余细节在既有批准设计内按推荐方案推导。

本文已于 2026-07-30 经用户复核批准，作为后续长期文档和机器契约工作的设计输入；它仍不表示以下内容已经存在：

- `packages/platform-contract`；
- `apps/console`、`apps/platform-api` 或 `apps/platform-worker`；
- 机器可读 Platform OpenAPI；
- 生成客户端或 Fastify 适配器；
- 平台数据库模型、Migration、Redis Session、BullMQ、对象存储或云资源；
- 数据接入与处理存储系统的机器 Query/Command；
- 前端页面、路由、测试、CI 或部署。

本文不解除前端技术栈、后端技术栈、Session、安全、数据库、Outbox/BullMQ、对象存储和部署所需的 accepted ADR 门禁。正式实现仍必须等待相应 ADR、下游契约和单模块实施计划。

## 2. 目标与成功标准

### 2.1 目标

1. 为 A1—D2 共 31 个页面建立无遗漏、无重复权威来源的公开机器契约结构。
2. 为 Session、权限、导航、Query、Command、分页、错误、幂等、并发、异步 Operation、数据完整性和生命周期提供统一 Schema。
3. 让 Vue SPA 只能通过生成客户端访问 `platform-api`，让 `platform-api` 只能以同一契约返回公开结果。
4. 让页面入口、授权跳转、详情返回、作用域切换和安全退出成为机器可校验行为，杜绝只能手工输入 URL 才能访问的正式页面。
5. 保持管理平台、数据接入、数据处理与存储、SDK 和公共协议五大系统边界。
6. 建立兼容检查、契约测试、服务端一致性测试和真实浏览器导航测试门禁。

### 2.2 成功标准

- 31 个页面全部映射到至少一个真实公开 Query 或 Command，纯导航页映射到导航/作用域 Query；
- 31 个页面全部具有稳定前端路由；每个稳定一级页面可从获授权顶栏或侧栏到达，每个子路由可从父页面或后端授权业务目标到达；
- 任何正式页面都不能只通过手工输入 URL 访问；
- 每个公开操作具有唯一稳定 `operationId`、认证级别、权限、输入/输出 Schema、错误、幂等/并发、缓存、审计和页面追踪；
- OpenAPI、前端客户端、服务端校验器和契约样本来自同一契约源码，生成物不得手工修改；
- 不存在前端手写的隐藏端点、数据库模型泄露或多套角色菜单表；
- 不兼容公开 API 变化被自动识别并在合并前阻断；
- D2、Session、下游处理契约等未解除门禁不会被空实现、占位按钮或伪造数据绕过。

## 3. 方案选择

### 3.1 方案 A：统一公开契约、内部模块化、生成单一 OpenAPI

契约源码按稳定领域拆分，共用一套基础 Schema，最终生成一个 `/api/platform/v1` OpenAPI 和一个前端客户端。

优点：

- 统一认证、错误、权限、导航、分页和版本语义；
- 与一个 Vue SPA、一个 `platform-api` 模块化单体一致；
- 领域可以独立维护和测试，不产生多套浏览器协议；
- 可自动检查 31 页覆盖、重复 Schema 和兼容性；
- 未来物理拆分服务时仍可从公开操作边界演进。

代价：

- 需要维护契约组合、代码生成和兼容检查工具；
- 合并后的 OpenAPI 较大，需要稳定命名和领域 Owner；
- 下游系统不可用时必须设计组合 Query 的部分失败语义；
- 第一阶段需要先建设契约基础，不能直接从单个页面开始编码。

### 3.2 未采用：单个手写巨型 OpenAPI

单文件入口直观，但会把 31 页、九个领域和共用 Schema 混在一起，容易重复错误、分页、权限和导航结构，也容易出现多人修改冲突。手工 OpenAPI 与 Zod/Fastify/前端类型之间还会形成多个权威来源。

### 3.3 未采用：按领域暴露多套浏览器 API

领域隔离较强，但会让 SPA 同时处理多套版本、鉴权、错误、Cookie/CSRF 和可用性，并与第一版统一 `platform-api`、不按领域拆微服务的决定冲突。

### 3.4 最终决定

采用方案 A。页面编号仅用于需求追踪，不进入公开资源名；同一能力可服务多个页面，禁止机械地为每个页面创建重复端点。

## 4. 系统边界

```text
Vue SPA
  → 生成的 Platform Client
  → /api/platform/v1
  → platform-api HTTP 适配
  → 平台应用用例与领域模块
  → 平台 PostgreSQL / Redis Session / Outbox（仅内部）
  → 数据接入或处理存储公开 Query/Command（跨系统）
```

强制边界：

- 浏览器只调用 `platform-api`，不能调用数据库、Redis、BullMQ、对象内部键或下游私有端点；
- `platform-api` 只能通过数据接入和处理存储系统的正式公开契约组合数据，不能直连其数据库或队列；
- `platform-contract` 不能依赖 Fastify、Kysely、数据库模型、BullMQ、Redis 客户端、页面组件或 Pinia；
- HTTP handler 只做契约适配、认证上下文建立和错误映射，不能直接拼接多领域表写入；
- 数据库行、领域实体和下游响应必须显式映射为公开投影，不得透传；
- `event-schema` 继续只负责事件协议，不承载管理平台账号、导航或治理 API。

## 5. 目标制品与权威来源

### 5.1 契约源码

目标包：

```text
packages/platform-contract/
├─ src/
│  ├─ common/
│  │  ├─ identifiers.ts
│  │  ├─ time.ts
│  │  ├─ session.ts
│  │  ├─ authorization.ts
│  │  ├─ navigation.ts
│  │  ├─ query.ts
│  │  ├─ pagination.ts
│  │  ├─ command.ts
│  │  ├─ operation.ts
│  │  └─ problem-details.ts
│  ├─ identity/
│  ├─ organization/
│  ├─ project-governance/
│  ├─ credentials/
│  ├─ releases/
│  ├─ issues-and-alerts/
│  ├─ usage-and-policy/
│  ├─ audit/
│  ├─ operations/
│  └─ registry.ts
├─ test/
├─ contract-testkit/
└─ README.md
```

这是目标结构，不是当前已存在路径。正式创建前需要对应技术栈 ADR accepted 和单模块实施计划。

### 5.2 生成制品

契约源码确定性生成：

- `docs/api/platform-openapi-v1.yaml`：浏览器公开机器契约；
- 前端请求类型、运行时响应校验器和无业务状态的 API Client；
- Fastify 路由输入/输出校验适配器；
- MSW 基础 handler 类型与合法/非法契约样本；
- OpenAPI 兼容差异报告；
- 页面—操作—权限—路由覆盖清单。

生成制品必须带有“由契约源码生成、禁止手工修改”标记。CI 重新生成后存在差异即失败。

### 5.3 公开导出

`platform-contract` 只提供受控公开入口：

- 根入口：公共 Schema、操作注册表和稳定类型；
- `/client`：浏览器安全请求描述和响应校验器；
- `/server`：传输层输入/输出校验描述，不包含领域实现；
- `/contract-testkit`：无真实敏感信息的共享样本和一致性测试工具。

内部生成器、路径拼装器和未批准 Schema 不得通过包导出暴露。

## 6. 协议与版本

### 6.1 基础协议

- HTTPS REST/JSON；
- 公开主版本路径固定为 `/api/platform/v1`；
- JSON 使用 UTF-8；
- 时间点使用带时区的 RFC 3339 字符串并以 UTC 存储；
- 日历边界同时返回 IANA 业务时区和解析后的 UTC 起止时间；
- 资源标识是服务端不透明稳定字符串，路径不得使用名称、邮箱、显示文本或秘密作为身份；
- 二进制 Source Map 不进入通用 JSON 正文，只通过短期单对象上传/下载意图；
- 路径、查询和正文全部先按 `unknown` 运行时校验。

### 6.2 `operationId`

稳定格式为 `domainVerbObject`，例如：

```text
identityGetSession
organizationListMembers
projectCreateProject
issuesListIssues
alertsUpdateRule
navigationGetContext
```

`operationId` 不包含页面编号、HTTP 方法或实现类名。已发布 `operationId` 不得在同一主版本重命名或改变语义。

### 6.3 兼容规则

同一主版本允许：

- 新增可选响应字段；
- 新增新的可选 Query 参数，默认行为保持不变；
- 新增错误码，但不得把原成功结果改成失败；
- 新增枚举值时，仅限消费者按未知值安全降级的显式开放枚举。

以下属于不兼容变化：

- 删除或重命名字段、操作或路径；
- 改变字段类型、含义、权限、默认排序或空值语义；
- 将可选字段改为必填；
- 收紧已有合法输入；
- 改变幂等、并发、分页、缓存或错误恢复语义；
- 修改关闭枚举的已有值或增加消费者无法安全处理的新值。

不兼容变化需要新主版本、迁移方案、兼容窗口和 accepted ADR，不能静默修改 v1。

## 7. 通用标识、时间与查询规则

### 7.1 标识

所有标识在公开 Schema 中按语义使用独立品牌类型，但 JSON 表示仍为字符串：

```text
AccountId
OrganizationId
ProjectId
EnvironmentId
IssueId
ReleaseId
SourceMapFileId
AlertRuleId
AlertInstanceId
NotificationId
OperationId
```

前端不能将显示名称、规范化 URL 或列表位置转换为标识。

### 7.2 查询规范化

- 每个操作声明允许的 Query Schema；
- 未知 Query 参数返回 400，不静默忽略后扩宽查询；
- 非法筛选、排序、页码、游标或稳定选中对象返回 400 或安全规范化结果；
- 服务端返回实际接受的 `normalizedQuery`；
- 前端以 `normalizedQuery` 重写 URL，但不得把服务端拒绝的参数保留为第二权威；
- 搜索字段必须逐操作允许，秘密和敏感原文不得进入可分享 URL。

### 7.3 时间

- `readAt` 表示 Query 的服务端读取时点；
- `occurredAt`、`receivedAt`、`processedAt` 保持不同语义；
- 组织业务时区通过权威上下文返回；
- “最近 24 小时”使用连续时长；“今天、本周、本月”使用组织业务时区计算并返回 UTC 边界；
- 时区修改不重写历史时间点。

## 8. Query、列表与组合页面

### 8.1 基础 Query 响应

所有普通 Query 使用统一顶层：

```text
QueryResponse<TData>
- data
- meta
- allowedActions
- navigationTargets
```

`meta` 至少包含：

- `requestId`；
- `readAt`；
- 按需的资源版本、组织时区、规范化查询、分页、总量、计算水位、分辨率、采样、降级、完整性和陈旧原因。

`allowedActions` 只帮助 UI 显示当前可能操作，不能授权 Command。`navigationTargets` 只包含当前主体获授权且可安全披露的目标。

### 8.2 分区结果

组合页面使用 `SectionResult<T>` 区分：

- `available`：权威结果完整可用；
- `empty`：权威查询成功且集合确实为空；
- `partial`：返回安全可用数据及明确缺失范围；
- `stale`：返回最近安全投影、最后新鲜时间和陈旧原因；
- `unavailable`：权威依赖不可用且没有安全陈旧投影；
- `forbidden`：只有在披露该分区存在不会扩大信息泄露时使用，否则与不存在使用统一安全结果。

`loading` 是客户端请求状态，不由服务端返回。主身份、组织或项目权威失败时整体请求失败；次要统计失败时不得覆盖主对象成功。

### 8.3 分页

每个列表操作固定使用一种分页模型：

- 高变动时间线和通知：不透明游标；
- 小型稳定治理列表：服务端页码；
- 未正式决定的大集合默认使用游标，不允许前端从已加载数据推断总量。

分页元数据只在权威可得时返回 `totalCount`。没有权威总量时字段缺失并明确 `totalCountStatus=unavailable`，不得返回伪造的 `0`。

排序必须有稳定主键和确定性次级键；翻页期间不能因相同排序值随机重复或遗漏对象。

## 9. Command、幂等、并发与异步 Operation

### 9.1 Command 输入

所有非天然幂等 Command 使用：

- `Idempotency-Key` Header：由浏览器 `crypto.randomUUID()` 生成的 UUID；
- 资源版本或 ETag：用于并发修改；
- 与 Session 绑定的 CSRF Header；
- 正式正文 Schema。

服务端按主体、操作、目标和幂等键保存规范化请求摘要：

- 同键同摘要返回第一次结果；
- 同键不同摘要返回稳定冲突；
- 网络超时后复用原幂等键或查询 Operation，不生成新键盲目重试。

### 9.2 同步结果

同步完成返回：

```text
CommandResult<T>
- status: succeeded | duplicate
- data
- resourceVersion
- operationId
- navigationTargets
```

危险操作不能使用乐观成功；只有权威响应或 Operation 最终成功后才能切换生命周期、权限或秘密状态。

### 9.3 异步结果

真正需要后台处理的操作返回 202 和：

```text
OperationReference
- operationId
- status: processing
- submittedAt
- nextPollAfter
- resultTarget
```

Operation Query 的终态固定为：

- `succeeded`；
- `failed`；
- `expired`；
- `unavailable`。

内部 BullMQ Job 标识、队列名、重试堆栈和对象键不得暴露。`nextPollAfter` 只在服务端允许轮询时返回，前端页面进入后台后暂停轮询。

### 9.4 一次性交付秘密

私密令牌和任何被正式安全契约定义为一次性交付的值：

- 只出现在首次同步成功响应；
- 响应禁止共享缓存；
- 不进入 Operation Result、后续 Query、Pinia、URL、日志、截图或通用错误；
- 响应丢失后只能识别安全元数据、撤销并重建，不能重新显示原值。

客户端上报密钥的交付/重显仍需独立安全契约，不自动套用私密令牌规则。

## 10. 统一错误模型

错误使用 RFC 9457 Problem Details，并增加 Aurora 稳定扩展：

```text
AuroraProblem
- type
- title
- status
- detail
- instance
- code
- requestId
- fieldErrors
- retryAfter
- currentVersion
- operationId
- recoveryTarget
```

规则：

- `code` 是稳定机器码，文案可以本地化但不能替代机器码；
- 字段错误只返回公开字段路径和安全原因；
- `currentVersion` 仅在安全并发恢复需要时返回；
- `recoveryTarget` 必须是受约束 Route Target，不得是任意 URL；
- 不返回堆栈、SQL、主机、内部服务名、队列名、对象键、Cookie、令牌、密码或账号枚举信息；
- 403 只在披露资源存在安全时使用，否则与不存在统一返回 404；
- Redis Session 等认证权威依赖不可用时返回 503，不伪装成 401。

稳定类别至少覆盖：结构错误、认证、权限、未找到、字段校验、业务校验、幂等冲突、版本冲突、状态机冲突、限频、处理中、下游部分失败和权威依赖不可用。精确业务码由各领域契约声明，禁止页面自造字符串判断。

## 11. Session、认证与 CSRF

### 11.1 Session Query

`identityGetSession` 返回：

- 当前账号安全摘要；
- Session 到期与轮换所需安全信息；
- CSRF 令牌；
- 当前认证/账号生命周期状态；
- Workspace/Navigation Context 的获授权读取目标。

它不返回密码摘要、Session ID、Cookie 值、完整角色缓存、私密令牌或内部能力令牌。

### 11.2 认证级别

每个操作在注册表声明：

- `public`：注册、登录、发起密码重置等防枚举公开操作；
- `intent`：需要短期服务器端验证/重置/邀请意图；
- `session`：需要有效 Session；
- `recent-verification`：只有正式安全规则明确要求时使用，不能由前端自行发明。

验证、重置和邀请链接的 GET 只建立短期 HttpOnly 意图并清理原始令牌，最终写入由受 CSRF 保护的 Command 完成。

### 11.3 Session 失败

- Session 缺失、过期或撤销：统一 401 并提供安全登录目标；
- Session Redis 不可用：503，受保护操作失败关闭；
- 权限撤销但 Session 有效：重新鉴权后返回安全 403/404；
- 密码重置和 A5 注销受理按已批准规则撤销相应 Session。

精确 Cookie、SameSite、期限、密码参数和密钥托管仍需安全 ADR，不由本文越权决定。

## 12. 权限与能力投影

### 12.1 权限原则

- Session 只证明认证，不固化组织/项目权限；
- Query 按当前 PostgreSQL 成员关系、资源状态和下游权限返回投影；
- Command 提交时再次读取权威权限、资源版本和生命周期；
- `allowedActions` 使用操作域内的关闭枚举，不能使用任意按钮字符串；
- 前端不能维护“角色 → 菜单/操作”的第二张固定表；
- 项目进入回收站后不再依赖删除前项目角色，只有组织所有者/管理员通过 B8 管理；
- D2 只接受正式平台管理员能力，不能从组织所有者或管理员推导。

### 12.2 权限来源

C13 的访问投影明确区分：

- 组织角色继承；
- 项目显式关系；
- 两者共同存在；
- 服务端拒绝披露的安全状态。

前端删除显式关系后必须重新查询；如果组织继承仍存在，人员行继续保留并说明有效来源。

## 13. 导航与页面联动机器契约

### 13.1 Route Target

`RouteTarget` 是按 `routeId` 区分的封闭联合类型。每个成员拥有自己的路径参数和 Query Schema，不能携带任意 URL、任意路径或任意 Query Map。

第一版 `routeId`：

```text
auth.register
auth.verify-email
auth.verify-email-confirm
auth.login
auth.forgot-password
auth.reset-password
invitation.accept
account.security
workspace.home
organization.project-create
organization.members
organization.settings
organization.usage
organization.tokens
organization.audit
organization.trash
project.onboarding
project.overview
project.issues
project.issue-detail
project.requests
project.performance
project.data-status
project.releases
project.release-detail
project.source-maps
project.alerts
project.alert-rule-create
project.alert-rule-edit
project.alert-instance-detail
project.access
project.client-keys
project.settings
project.lifecycle
account.notifications
platform.resource-policies
```

上述 36 个稳定 Route Target 映射 31 个页面设计；数量差异来自 A1 的注册/验证子路由、C8 的发布列表/详情子路由和 C11 的新建/编辑子路由。覆盖检查必须同时核对“31 个页面设计”和“36 个稳定 Route Target”，不得把子路由误算成新增产品页面，也不得因页面编号相同而漏掉子路由入口。

每个目标只使用稳定标识。邀请、验证、重置令牌、秘密、显示名称和敏感搜索内容不得进入 Route Target。

### 13.2 Navigation Context

`navigationGetContext` 返回：

- 当前账号摘要；
- 可访问个人工作空间；
- 按组织分组的可访问项目；
- 当前组织/项目作用域及其权威生命周期；
- 当前作用域允许的一级 `routeId` 和受约束目标；
- D1 未读计数的完整性；
- 当前安全默认目标；
- 作用域失效时的安全退出目标。

服务端决定哪些入口允许出现；前端路由注册表决定标签、顺序、图标、父子关系和响应式表现。这样既不复制角色权限，也不让后端承载视觉布局。

### 13.3 前端路由注册表

每个 Route Target 在 Vue Router 注册表中声明：

- `routeId`；
- 路径模板；
- 作用域：公开、账号、工作空间、组织、项目或平台；
- 一级菜单、条件入口或子路由；
- 父路由与面包屑来源；
- 参数和 Query Schema；
- 页面懒加载入口；
- 无效参数和目标失效的安全处理；
- 可访问性焦点目标。

注册表不得包含角色判断或服务端资源存在性推断。

### 13.4 默认项目入口

补齐现有 UX/UI 中“项目默认业务入口”未冻结的问题：

- B2 创建项目同步成功：进入 `project.onboarding`（C1）；
- 用户从 B1 选择已有 `active` 项目：进入 `project.overview`（C2）；
- 用户从 B1 选择允许查看历史的 `archived` 项目：进入 `project.overview`，由 C2 展示归档事实和获授权生命周期目标；
- `trash`、`deleting`、`deleted` 项目不作为 B1 普通项目入口；获授权组织治理者只从 B8 处理；
- 不根据唯一项目、最近访问、浏览器历史或本地缓存自动进入项目；
- 目标无权、失效或生命周期改变时，Route Target Resolution 返回 `workspace.home` 或当前仍获授权的组织级安全目标。

未完成接入的已有项目仍进入 C2；C2 显示真实未完成原因并提供 C1 行动目标。这样符合“跳过后项目首页提醒、稍后继续”的 PRD，不强迫每次选择项目都重新进入向导。

### 13.5 页面可达性

- 顶栏必须提供 B1、组织/项目切换、D1 和 A5；
- 组织侧栏必须按能力提供 B3—B8，B2 作为条件操作；
- 项目侧栏必须按能力提供 C1、C2、C3、C5—C8、C10、C13—C15；
- C4、C9、C11、C12、C16 必须从其父页面或后端授权业务目标到达；
- D2 只在平台管理员能力存在时进入平台作用域；
- C2、C7、D1、C8/C9、C10—C12、C15/C16 等跨页入口只消费 Route Target；
- 详情返回列表恢复进入详情前的规范化 URL；不兼容或无权查询回退安全默认列表并说明未恢复条件。

CI 必须生成可达性图并验证每个正式路由至少存在一个获批准入口类型；无入口的稳定路由属于阻断缺陷。

## 14. 领域契约目录

下表冻结总体操作族；具体字段进入相应领域 Schema，但不得改变对象、权限和结果语义。

| 领域 | 页面 | Query 操作族 | Command 操作族 |
|---|---|---|---|
| identity | A1—A3、A5 | 注册要求、验证状态、Session、安全摘要、重置意图、注销预检 | 注册、登录/退出、确认/重发验证、请求/确认重置、修改密码、申请/撤销注销 |
| organization | A4、B1、B3、B4 | 邀请安全摘要、工作空间、组织/项目范围、成员、邀请、时区 | 接受邀请、邀请/撤销/重发、改角色、移除成员、转让所有权、更新时间区 |
| project-governance | B2、B8、C1、C13、C15、C16 | 创建能力、回收站、接入进度、访问投影、设置、环境、生命周期 | 创建项目、恢复回收站项目、清除测试数据、管理显式访问、更新设置、创建环境、归档/恢复/移入回收站 |
| credentials | B6、C14 | 私密令牌安全元数据、客户端密钥列表/详情和策略 | 创建/撤销私密令牌、创建/启停客户端密钥、更新允许来源/环境 |
| releases | C8、C9 | 发布、部署、Source Map 文件/详情/重解析状态 | 上传意图、确认上传、显式替换、获准下载；发布创建只由获准 SDK/令牌/CLI/CI |
| issues-and-alerts | C2—C4、C10—C12、D1 | 概览问题/告警分区、问题/样本/活动、规则、实例、证据、通知和未读数 | 个人视图、当前页问题批量、问题状态/负责人/备注/合并、创建/更新规则、逐条通知已读 |
| monitoring projections | C1、C2、C5—C7、C9—C12 | 接入/处理状态、接口/页面指标、完整性、水位、Source Map/告警处理证据 | 仅通过处理系统正式公开 Command 执行获准动作；平台不复制下游写模型 |
| usage-and-policy | B5、D2 | 当前周期用量、保护状态、策略目标/配置/来源/生效/传播 | 保存平台默认、组织完整覆盖、项目上限及恢复/清除覆盖 |
| audit | B7 | 组织安全审计时间线 | 审计由所属高风险 Command 同事务/Outbox 写入，不提供用户直接追加 API |
| operations | 全部有不确定结果的页面 | Operation Result | 无通用用户任务操作；只提供正式业务 Command 的恢复 |

### 14.1 D2 阻塞

D2 的目标、配置与传播 Schema 可以在设计中保留，但不得生成可执行路由或实现，直到平台管理员身份、授予/撤销、break-glass 和平台级审计规则正式批准。组织所有者/管理员不能替代该前置。

### 14.2 下游处理契约阻塞

C1—C12、B5 和 D2 中依赖数据接入/处理存储的部分，必须等待相应公开机器契约。Platform OpenAPI 可以先冻结浏览器所需投影语义和部分失败结构，但实现不能直接查询下游数据库或以模拟数据宣称完成。

## 15. 前端实现约束

### 15.1 应用壳先行

第一个管理平台前端实现增量必须只包含：

- Session 恢复；
- Route Target 解析；
- Vue Router 注册表；
- 顶栏和分层侧栏；
- 工作空间/组织/项目作用域切换；
- 权限和生命周期安全退出；
- 统一 API Client、错误映射和 Query 基础状态；
- 只在测试中使用、且不注册生产路由的无业务数据契约样本或夹具。

在壳层、路由、权限投影和可达性测试通过前，不得并行创建 31 个互相独立的页面实现。

### 15.2 前端数据流

```text
URL
→ Zod 路由 Schema
→ 规范化 Route State
→ 生成 Client
→ 运行时响应校验
→ 领域 Store/页面分区
→ loading/empty/error/forbidden/processing/partial/stale/unavailable
```

- URL 是筛选、搜索、排序、分页、标签和稳定选中对象的权威来源；
- Pinia 只协调当前身份/作用域、领域投影和请求缓存，不持久化服务端状态、权限、草稿或秘密；
- 页面不能直接调用 `fetch` 或手写路径；所有调用通过生成 Client；
- Command 不能被请求缓存层当作普通网络重试；
- 作用域切换、退出、权限撤销和删除必须清除不再可见的缓存、选择和危险确认；
- 正式 Route Target 解析失败进入安全错误，不拼接猜测路径。

### 15.3 页面实现清单

每个页面模块必须声明：

- 页面编号和 Route Target；
- 进入条件和作用域；
- 使用的 `operationId`；
- URL Schema；
- Query 分区和适用状态；
- Command、权限、幂等和并发；
- 父页面、跨页目标和返回行为；
- 敏感字段和缓存禁止项；
- 单元、组件和浏览器测试。

缺少任一项时不得标记页面完成。

## 16. 后端实现约束

### 16.1 契约适配

- Fastify 路由从操作注册表建立，不手写另一套输入/输出类型；
- 传输层验证成功后把公开 DTO 映射为应用用例输入；
- 应用用例返回领域结果，HTTP 适配再映射为公开 DTO；
- 领域模块不依赖 Fastify Request/Reply、OpenAPI 生成器或浏览器 Route Target 拼装实现；
- 所有外部输入、数据库行和下游响应在边界运行时验证；
- 响应序列化失败视为服务端契约缺陷并安全失败，不返回部分未验证正文。

### 16.2 权限与事务

- Query 先确认 Session，再按作用域、资源和字段重新鉴权；
- Command 在事务或跨系统调用前再次读取权限和生命周期；
- 注册、邀请接受、所有权转让、项目创建、私密令牌创建和本地生命周期变更维护既有原子不变量；
- 领域状态、审计、幂等/Operation 和需要异步执行的 Outbox 在同一 PostgreSQL 事务提交；
- API 不在事务中直接双写 Redis/BullMQ；
- 跨系统操作使用短期最小能力令牌和业务幂等上下文，不转发浏览器 Cookie。

### 16.3 组合 Query

- 身份、组织或项目权威失败时整体失败；
- 次要问题、指标、用量或告警依赖失败时返回分区 `partial/stale/unavailable`；
- 每个下游调用有有界超时；
- 不把下游超时、采样或水位延迟映射成 `empty` 或 `0`；
- 不透传下游堆栈、内部错误码或主机信息；
- 公开 `requestId`、Operation 关联和安全数据水位用于排查。

## 17. 契约与实现测试

### 17.1 契约单元测试

- 每个操作至少具有合法请求/响应样本；
- 必填缺失、类型错误、非法枚举、超长字段、非法 Query、未知参数和敏感字段进入错误样本；
- Route Target 每个成员都有合法和非法参数样本；
- `SectionResult`、Problem Details、分页、Operation 和并发版本覆盖所有分支；
- 样本不包含真实账号、Token、Cookie、密钥或监控内容。

### 17.2 生成一致性测试

- Zod 操作注册表可以确定性生成 OpenAPI；
- OpenAPI 重新生成无未提交差异；
- 每个 `operationId` 唯一；
- 每个 Schema 名称唯一且没有循环生成错误；
- 前端 Client 与服务端 Adapter 来自同一 OpenAPI/注册表版本；
- 禁止手工修改生成文件；
- 兼容差异工具阻断同一主版本的不兼容变化。

### 17.3 服务端一致性测试

- 每个公开路由都在 OpenAPI 中；
- 每个 OpenAPI 操作都有实际 handler 或明确未启用的构建门禁，不能以 501 占位冒充完成；
- 请求、响应和错误都通过运行时 Schema；
- 权限、字段级披露、幂等、ETag、CSRF 和 Operation 恢复使用集成测试；
- PostgreSQL、Redis Session、Outbox/BullMQ 和下游依赖故障覆盖失败关闭与部分失败语义。

### 17.4 前端契约测试

- URL Schema 和 Route Target 往返稳定；
- 未知参数不会扩宽查询；
- 生成 Client 对非法响应失败关闭；
- MSW 只使用契约样本构造成功、权限、冲突、限频、partial、stale 和 unavailable；
- Query/Command 状态不会因缓存或乐观更新伪造；
- 一次性秘密不进入 Store、日志、截图或测试追踪。

### 17.5 页面可达性与端到端测试

自动生成“31 个页面设计 × 36 个稳定 Route Target”的覆盖与可达性矩阵并验证：

- 顶栏、组织侧栏、项目侧栏和平台入口；
- A1—A4 公开/认证流程的真实前后续入口，以及 A5 从账号入口到达；
- B1 → B2 → C1 → C2/C4；
- C2 → C3、C7、B5、C10/C12、C1；
- C3 → C4 → 恢复原规范化查询；
- C7 → C1/C14/C15/B5/C16；
- C8 ↔ C9、C10 ↔ C11/C12、C15 → C14/C16、C16 → B8；
- D1 跨组织/项目授权目标和目标失效；
- 刷新、前进/后退、作用域切换、权限撤销、归档、回收站和删除；
- 键盘导航、焦点恢复、窄屏抽屉和面包屑。

测试必须断言每个稳定 Route Target 可通过真实 UI 操作到达。仅验证直接 `page.goto()` 不足以证明页面不是 URL 孤岛。

## 18. CI 与发布门禁

平台契约或实现变更至少通过：

1. TypeScript 严格类型检查；
2. 契约 Schema 单元测试；
3. OpenAPI 生成与格式验证；
4. 同主版本兼容差异检查；
5. 生成物无漂移检查；
6. 包入口、私有路径和依赖边界检查；
7. 服务端请求/响应一致性测试；
8. 前端 URL、Client、缓存与状态测试；
9. 31 个页面设计、36 个稳定 Route Target 的覆盖和可达性检查；
10. 核心 Playwright 跨页流程与 axe 检查；
11. 文档链接、元数据和示例检查。

以下任一情况阻止合并：

- 页面使用未登记端点；
- handler 没有契约操作；
- OpenAPI 存在没有 Owner/页面/权限元数据的操作；
- 新路由只能通过手工 URL 到达；
- Route Target 使用任意 URL；
- 同一主版本出现不兼容变化；
- 生成物与源码不一致；
- D2 或其他阻塞能力通过占位实现绕过门禁。

## 19. 实施顺序

本文批准后仍不能直接实现。满足 ADR 和上游前置后，按单模块计划依次推进：

1. Platform Contract 基础：包入口、公共 Schema、操作注册表、生成器、兼容检查和 testkit；
2. Session、Navigation Context、Route Target 和前端壳层；
3. A1—A5 账号认证与邀请衔接；
4. B1—B8 工作空间与组织治理；
5. C1/C2/C7 接入、概览与诊断；
6. C3—C6 问题、请求与性能；
7. C8—C12 发布、Source Map 与告警；
8. C13—C16 项目访问、密钥、设置与生命周期；
9. D1 通知；
10. D2 仅在平台治理规则正式批准后开始。

第 1 步交付可消费的契约生成、校验、兼容检查和测试基础，不虚构业务 handler 或页面。自第 2 步起，每个壳层或业务增量必须把相应契约、服务端实现、前端真实入口和测试成套交付，不能只生成孤立页面或空 API。

## 20. ADR 判断

正式实现前至少需要 accepted ADR 覆盖：

- Vue 3/Vite、Vue Router/Pinia、自建请求缓存和 UI/测试技术基线；
- Node.js/Fastify 模块化单体、PostgreSQL/Kysely 和 Zod/OpenAPI 契约链；
- Redis 权威 Session、Cookie/CSRF 和内部能力令牌；
- PostgreSQL Outbox、Redis/BullMQ 和私有 S3 兼容对象存储；
- 平台公开 API 版本与不兼容迁移策略是否需要独立 ADR，由正式 ADR 评审决定。

本文不预占 ADR 编号，不修改任何 ADR 状态。契约模块、生成工具和实现路径只有在相应 ADR accepted 后才可进入正式代码。

## 21. 失败、回滚与重新评估

### 21.1 实施失败回滚

- 契约基础尚未被消费者使用时，可以删除未发布的实验实现并保留设计/验证记录；
- 已有消费者后，不能回滚到手写多套类型；应回退到上一份兼容 OpenAPI 和生成制品；
- 新操作可以在未公开使用前撤回；已公开操作必须按兼容规则废弃；
- 前端页面上线失败时回退页面制品，但服务端不得破坏已发布 v1 契约；
- 数据库或基础设施回滚遵守各自 ADR、Migration 和发布文档。

### 21.2 重新评估条件

- 单一 OpenAPI 的生成或客户端体积经测量无法满足构建与加载预算；
- `platform-api` 出现独立扩缩容、隔离、团队所有权或发布瓶颈；
- 新客户端形态需要不同认证或传输协议；
- 兼容演进无法在 v1 内安全完成；
- 生成链长期产生无法控制的错误、性能或维护成本；
- 安全、隐私、法律或数据驻留要求改变公开边界。

达到条件只触发新评审，不自动改变本方案。

## 22. 文档同步范围

本书面设计已经用户复核批准；本次批准同步应覆盖：

- 完整 UX/UI：追加机器导航契约、默认项目入口和实施门禁，并校正前段旧路由/D1/D2状态残留；
- 管理平台产品业务域：增加总体契约入口；
- 管理平台前端架构：增加 `platform-contract`、Route Target、生成 Client 和壳层先行门禁；
- 管理平台后端架构：增加统一 OpenAPI、操作注册表、生成/一致性与组合 Query 规则；
- 正式化与实施就绪追踪：把“总体 Platform OpenAPI 设计”从缺口改为已批准设计输入，机器文件和实现继续标为 absent/blocked；
- 正式文档索引：登记本文与后续正式 API 文档的权威关系；
- `AGENTS.md` 与 `AURORA_RULES.md`：仅当批准改变当前阶段、门禁或决策队列时同步快照；
- 后续真实模块 README、测试和发布文档：只在模块或机器契约实际存在时创建/更新。

核心 PRD、事件协议、隐私默认、系统边界和现有 accepted ADR 结论不改变。

## 23. 明确排除

- 不新增 PRD 第一版之外的页面或能力；
- 不引入 GraphQL、浏览器 BFF、SSR 或领域微服务；
- 不让 OpenAPI 成为数据库 Schema 或内部事件总线；
- 不为每个页面创建一套重复的认证、错误或分页结构；
- 不创建通用低代码页面系统、任意动态菜单或服务端视觉布局；
- 不提供任意外部 return URL；
- 不让前端角色表、路由守卫或菜单可见性代替服务端鉴权；
- 不以 501、空数组、全零数据、“敬请期待”或禁用按钮冒充未实现能力；
- 不在下游契约缺失时直连数据库或队列；
- 不将测试 fixture 描述为真实数据或已实现 API。

## 24. 设计自检

| 检查项 | 结果 |
|---|---|
| 是否改变 approved PRD | 否；只把既有 A1—D2 和 NAV-A 转成总体机器契约与实施门禁 |
| 是否改变五大系统边界 | 否；SPA→platform-api 与 platform-api→下游公开契约保持分离 |
| 是否虚构实现 | 否；目标文件、包、应用、OpenAPI、模型和基础设施均明确为不存在 |
| 是否覆盖 31 页 | 是；总体领域目录覆盖 A1—D2，36 个 Route Target 覆盖 31 个页面设计及其全部稳定子路由 |
| 是否解决 URL 页面孤岛风险 | 是；壳层先行、Route Target、路由注册表、可达性图和真实 UI 测试形成闭环 |
| 是否解决默认项目入口 | 是；B2→C1，B1 已有 active/archived 项目→C2，删除态只走 B8 |
| 是否保留权限与安全边界 | 是；Session 不承载角色权威，Command 重新鉴权，D2 和 Session 参数门禁保留 |
| 是否处理部分失败与数据可信度 | 是；Query 分区、水位、采样、降级、stale/partial/unavailable 有统一结构 |
| 是否处理幂等和不确定结果 | 是；UUID 幂等键、资源版本、Operation Result 和秘密一次性交付分离 |
| 是否需要 ADR | 是；所有高迁移技术和安全选择继续受 accepted ADR 门禁约束，不预占编号 |
| 是否进入实现计划 | 否；用户书面复核和正式文档同步完成前不进入 writing-plans |

## 25. 用户复核入口

用户已批准方案 A、按推荐方案推导的完整书面设计以及本次正式追加。本文状态为 `approved`，第 22 节所列长期权威文档在同一变更中同步；任何机器契约或代码实施仍须在相应 ADR accepted、上游契约就绪和独立实施计划获授权后开始。
