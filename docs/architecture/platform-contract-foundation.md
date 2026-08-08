---
title: Aurora 管理平台契约基础（PLT-01）正式规格
status: approved
implementation-status: not-started
approval-status: approved
owner: platform/backend
created: 2026-08-08
last-reviewed: 2026-08-08
applies-to: packages/platform-contract（@aurora/platform-contract）契约源码、Schema、操作注册表、生成器、生成 Client/Server 适配器、漂移门禁、契约样本与包公开导出
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - ../adr/README.md
  - ../adr/ADR-025-platform-frontend-technology-stack.md
  - ../adr/ADR-026-platform-backend-runtime-and-contract-chain.md
  - ../adr/ADR-027-platform-contract-codegen-tooling.md
  - ../adr/ADR-028-platform-session-csrf-security.md
  - ../architecture/platform-frontend.md
  - ../architecture/platform-backend.md
  - ../architecture/formalization-readiness.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../prd/platform-product-domains.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: platform-contract-api-or-compat-change
---

# Aurora 管理平台契约基础（PLT-01）正式规格

## 1. 定位、效力与当前状态

本文冻结管理平台契约基础第一增量（PLT-01）的正式规格。它承载 accepted/待批准总体 OpenAPI 与实现约束设计的"统一公开契约、内部按领域模块化、生成单一 Platform OpenAPI"方案 A，并为后续 Session/Navigation/RouteTarget/前端壳层（PLT-02）与全部 A1—D2 业务增量提供可消费、可校验、可生成、可漂移检测的机器契约基础。

**当前状态**：本文为用户于 2026-08-08 批准的正式规格（`status: approved`、`approval-status: approved`）。它是已批准设计（总体 OpenAPI 设计、平台前端架构、平台后端架构、前端 UX/UI、控制台视觉语言）与 accepted ADR-025/026/027/028 的形式化产物，不是新设计。`implementation-status` 保持 `not-started`：正式实施需 PLT-01 实施计划（writing-plans）经自检后按 SDD 执行；未创建 `packages/platform-contract` 正式代码、机器 OpenAPI 或进入实施前不得标记 implemented。

**声明边界**：本文冻结的是**契约基础**（Schema、操作注册表、生成器、Client/Server 适配、漂移门禁、样本、包导出），不是业务 handler，不是数据库模型，不是 Session/Redis 实现，不是 Vue SPA 页面实现。PLT-01 不实现任何业务端点；未授权能力一律以未启用/不可用状态表示，禁止空 Schema、`{}` Schema、`unknown` 响应或伪造端点。

## 2. 单一 Platform Contract 定位

- Aurora 管理平台浏览器公开边界只有一个权威机器契约：`platform-contract` 生成的单一 Platform OpenAPI（`/api/platform/v1`）。
- `platform-contract` 是管理平台**公开机器契约的唯一源码**；契约源码按稳定领域模块维护（identity/organization/project-governance/credentials/releases/issues-and-alerts/usage-and-policy/audit/operations + common），通过唯一操作注册表确定性生成：
  - `docs/api/platform-openapi-v1.yaml`（浏览器公开机器契约）；
  - 前端请求类型、运行时响应校验器和无业务状态的 API Client；
  - Fastify 路由输入/输出校验适配器；
  - MSW 基础 handler 类型与合法/非法契约样本；
  - OpenAPI 兼容差异报告；
  - 页面—操作—权限—路由覆盖清单。
- 契约是**公开契约的权威**，不是数据库 Schema、不是内部事件总线、不是领域实体模型。禁止将数据库行、Kysely 类型、BullMQ Job、Redis Session 结构、对象存储键或处理存储模型透传为公开 DTO。

## 3. package/application 边界

| 单元 | 路径（以仓库正式化后的真实路径为准） | 职责 | 禁止 |
|---|---|---|---|
| `@aurora/platform-contract` | `packages/platform-contract` | 契约源码、操作注册表、生成器、样本、testkit、Client/Server 适配定义 | 依赖 Fastify/Kysely/BullMQ/Redis/页面组件/Pinia/数据库模型 |
| `apps/platform-api` | `apps/platform-api`（仅定义边界，不在 PLT-01 实现） | 浏览器公开 Query/Command HTTP 适配 | 直连数据库/队列/处理存储私有接口 |
| `apps/platform-worker` | `apps/platform-worker`（仅定义边界，不在 PLT-01 实现） | Outbox relay/邮件/通知/策略传播/删除编排 | 向浏览器暴露业务 API |
| `apps/console` | `apps/console`（仅定义边界，不在 PLT-01 实现） | Vue SPA 管理平台 | 直连数据库/队列/私有包 |

依赖方向：`console → 生成 Client → platform-contract`；`platform-api → platform-contract 生成 server 适配`；`platform-contract` 不依赖任何框架/数据库/页面层。Workspace Policy 需要为平台层新增规则（`contract` 层，仅允许依赖 `protocol` 与 `tooling`；`service` 层允许依赖 `contract`），具体在实施计划中落为 `aurora.layer` 声明。

## 4. OpenAPI 唯一机器权威

- `docs/api/platform-openapi-v1.yaml` 是浏览器公开机器契约的唯一文件权威；由契约源码确定性生成，**禁止手工修改**，文件头携带"由契约源码生成、禁止手工修改"标记。
- 主版本路径固定为 `/api/platform/v1`。
- OpenAPI 3.1 表达；`operationId` 采用 `domainVerbObject` 稳定格式（如 `identityGetSession`、`organizationListMembers`、`navigationGetContext`），不包含页面编号、HTTP 方法或实现类名。
- OpenAPI 只能表达公开投影，不得暴露内部 event/process/store 模型、数据库表、队列名或对象键。

## 5. human documentation 与 machine contract 边界

- 机器契约（Zod 注册表 + 生成 OpenAPI）是**可执行权威**；human documentation（正式规格、模块 README、领域文档）只做解释与导航，不得成为第二套契约来源。
- 页面/领域能力名称（如 `projectCreateProject`）只从注册表读取；任何文档不得凭空新增未在注册表登记的 operationId、字段、枚举或路径。
- 正式 API 文档从机器契约生成字段表，不手工维护平行 Schema 表。

## 6. Schema source of truth

- 契约 Schema 的**唯一源码**是 `platform-contract` 内的 Zod Schema（严格 TypeScript），按领域与 common 模块组织。
- 所有外部输入（路径、查询、正文）先按 `unknown` 运行时校验；数据库行和下游响应不得因 TypeScript 类型而被无条件信任。
- 标识、时间、查询、分页、错误、操作、导航、权限等通用 Schema 在 `common/` 定义，领域 Schema 复用且不得重复定义基础结构。
- 禁止在 `platform-contract` 之外手工复制契约 Schema 作为第二权威（前端类型、服务端 DTO、OpenAPI 均从注册表生成）。

## 7. Zod/OpenAPI relationship

- Zod 注册表是契约来源；OpenAPI、Client 类型、Server 校验适配器、MSW 样本全部由同一注册表确定性生成。
- 生成器保证：每个 `operationId` 唯一；每个 Schema 名称唯一且无循环；OpenAPI 重新生成无未提交差异；前端 Client 与服务端 Adapter 来自同一注册表版本。
- 具体 `zod`/`zod/mini` 入口与生成器技术选型属于 accepted ADR-027（契约生成工具链）范围；本文只冻结"单一注册表 → 确定性多制品"的关系与门禁。
- 运行时响应校验必须在边界执行：Client 消费的响应、Server 输出的请求/响应/错误都通过契约 Schema；序列化失败视为服务端契约缺陷并安全失败。

## 8. generated client

- 生成浏览器 Client：请求描述、运行时响应校验器、稳定错误归一化、取消与请求上下文支持；**无业务状态**。
- Client 只能调用 `platform-api` 的公开操作；不携带任何权限、生命周期或领域规则判断。
- Client 不得包含隐藏端点、手写路径或数据库访问；不支持从 Client 推断服务端实体存在性。
- 一次性交付秘密的响应禁止缓存；敏感字段（私密令牌、验证/重置令牌、Cookie、客户端密钥明文）不得进入 Client 通用日志或可复用快照。

## 9. generated Fastify/server adapter

- 生成 Fastify 路由输入/输出校验适配器：从操作注册表建立路由，不手写另一套输入/输出类型。
- 传输层验证成功后把公开 DTO 映射为应用用例输入；应用用例返回领域结果，HTTP 适配再映射为公开 DTO。
- 领域模块不依赖 Fastify Request/Reply、OpenAPI 生成器或浏览器 Route Target 拼装实现。
- `platform-contract` 的 `/server` 导出只提供传输层输入/输出校验描述，**不包含领域实现**。
- 本规格冻结 server adapter 的**契约适配职责**；Fastify 运行时选型与 app 边界由 accepted ADR-026 承载，不在 PLT-01 创建可运行的 platform-api。

## 10. generated file ownership

- 生成制品（OpenAPI、Client 类型、Server 适配、MSW 样本、覆盖清单、兼容报告）全部标记"由契约源码生成、禁止手工修改"。
- CI 重新生成后存在差异即失败；生成物不提交源码级修改。
- 生成器本身是受控源码；生成器变更必须伴随全量再生成与漂移门禁通过。
- 手工文件（契约源码、文档、测试）与生成文件严格分离，避免误改。

## 11. drift detection

- 漂移门禁（`tooling/platform-contract-drift` 或等价机制，归属 accepted ADR-027）自动比对：
  - Zod 注册表枚举/required/限制/样本与生成 OpenAPI 逐值一致；
  - `operationId` 唯一、`$ref` 完整、Schema 名称稳定、状态码集合完整；
  - Client 与 Server 适配来自同一注册表版本；
  - 兼容差异工具阻断同一主版本的不兼容变化。
- 漂移检测纳入根 `openapi:check`（或新增等价根命令）与 `check:ci`；任何漂移失败阻断合并。

## 12. codegen deterministic

- 同一注册表、同一生成器版本、同一输入产生字节级一致的输出；不依赖时间戳、随机数、文件系统顺序或环境变量。
- 生成失败（Schema 循环、命名冲突、非法引用）必须稳定失败并给出可定位原因，不产生部分生成物。
- 生成命令可重复执行；CI 中"生成 → 比对无差异"是合并前置。

## 13. package exports

`platform-contract` 只提供受控公开入口：

- 根入口（`.`）：公共 Schema、操作注册表、稳定类型；
- `/client`：浏览器安全请求描述和响应校验器；
- `/server`：传输层输入/输出校验描述（不含领域实现）；
- `/contract-testkit`：无真实敏感信息的共享样本和一致性测试工具。

内部生成器、路径拼装器和未批准 Schema 不得通过包导出暴露。包入口与私有路径由 Workspace Policy 依赖边界检查强制执行。

## 14. error contract

- 错误统一使用 RFC 9457 Problem Details，并增加 Aurora 稳定扩展 `AuroraProblem`：`type/title/status/detail/instance/code/requestId/fieldErrors/retryAfter/currentVersion/operationId/recoveryTarget`。
- `code` 是稳定机器码，文案可本地化但不能替代机器码；`fieldErrors` 只返回公开字段路径和安全原因。
- 稳定类别至少覆盖：结构错误、认证、权限、未找到、字段校验、业务校验、幂等冲突、版本冲突、状态机冲突、限频、处理中、下游部分失败和权威依赖不可用。
- 不返回堆栈、SQL、主机、内部服务名、队列名、对象键、Cookie、令牌、密码或账号枚举信息；403 只在披露资源存在安全时使用，否则与不存在统一 404；认证权威依赖不可用时 503，不伪装 401。

## 15. Session contract foundation

- 冻结 `identityGetSession` 公开契约形状：当前账号安全摘要、Session 到期与轮换所需安全信息、CSRF 令牌、当前认证/账号生命周期状态、Workspace/Navigation Context 的获授权读取目标。
- 不返回密码摘要、Session ID、Cookie 值、完整角色缓存、私密令牌或内部能力令牌。
- 认证级别在注册表声明：`public` / `intent` / `session` / `recent-verification`。
- Session 失败语义：缺失/过期/撤销 → 401 + 安全登录目标；Redis Session 权威不可用 → 503 失败关闭；权限撤销但 Session 有效 → 安全 403/404。
- 本文只冻结**契约形状**（已由 approved 总体 OpenAPI 设计 §11 确定）；Redis 权威 Session、Cookie/CSRF 物理参数、Argon2id、KMS 与内部能力令牌属于后续安全 ADR（G10 门禁），不由本文决定。

## 16. CSRF transport contract

- 有状态 Session 使用同步 CSRF 令牌；SPA 从安全 Session Query 获取，在非安全方法（POST/PATCH/DELETE）自定义 Header 中提交。
- 同时校验 Origin/目标 Origin 与适用 Fetch Metadata；Cookie 凭据 CORS 只允许显式受控来源，禁止通配符。
- 令牌不进入 URL、日志、通用错误或可复用快照。
- GET/HEAD/OPTIONS 不改变业务状态；验证、重置、邀请链接的 GET 只建立短期 HttpOnly 意图并清理原始令牌，最终写入由受 CSRF 保护的 Command 完成。
- 本文冻结传输契约形状；精确 SameSite、期限与密钥托管参数属于后续安全 ADR。

## 17. pagination

- 每个列表操作固定使用一种分页模型：高变动时间线和通知用不透明游标；小型稳定治理列表用服务端页码；未正式决定的大集合默认用游标。
- 分页元数据只在权威可得时返回 `totalCount`；无权威总量时字段缺失并明确 `totalCountStatus=unavailable`，不得返回伪造 `0`。
- 排序必须有稳定主键和确定性次级键；翻页期间不能因相同排序值随机重复或遗漏对象。
- 前端把当前分页表示写入 URL，不得从已加载数据推断总量。

## 18. time range

- 时间点使用带时区的 RFC 3339 字符串并以 UTC 存储；日历边界同时返回 IANA 业务时区和解析后的 UTC 起止时间。
- `readAt`（Query 服务端读取时点）、`occurredAt`、`receivedAt`、`processedAt` 保持不同语义。
- "最近 24 小时"使用连续时长；"今天、本周、本月"使用组织业务时区计算并返回 UTC 边界；时区修改不重写历史时间点。
- 时间范围、分辨率、计算完成水位与采样/降级影响随指标 Query 返回，不得由前端推断。

## 19. sorting/filtering

- 每个操作声明允许的 Query Schema；未知 Query 参数返回 400，不静默忽略后扩宽查询。
- 非法筛选、排序、页码、游标或稳定选中对象返回 400 或安全规范化结果；服务端返回实际接受的 `normalizedQuery`。
- 搜索字段必须逐操作允许；秘密和敏感原文不得进入可分享 URL。
- 前端以 `normalizedQuery` 重写 URL，但不得把服务端拒绝的参数保留为第二权威。

## 20. idempotency/version conflict

- 所有非天然幂等 Command 使用 `Idempotency-Key` Header（浏览器 `crypto.randomUUID()`），作用域至少包含当前主体、操作类型和目标；服务端保存规范化请求摘要。
- 同键同摘要返回第一次结果；同键不同摘要返回稳定冲突，不执行第二次业务动作。
- 可并发修改资源携带权威版本或 ETag 并使用条件写入；冲突返回安全当前版本与重新确认要求，不自动合并危险操作。
- 网络超时或响应丢失时先查询 Operation Result 或权威对象，不换新幂等键盲目重试。
- 真正长操作返回 202 + `OperationReference`（operationId/status=processing/submittedAt/nextPollAfter/resultTarget）；Operation Query 终态为 `succeeded`/`failed`/`expired`/`unavailable`；内部 BullMQ Job 标识、队列名、重试堆栈和对象键不得暴露。
- 一次性交付秘密只出现在首次同步成功响应；禁止共享缓存；不进入 Operation Result、后续 Query、Pinia、URL、日志、截图或通用错误；响应丢失后只能识别安全元数据、撤销并重建。

## 21. RouteTarget contract

- `RouteTarget` 是按 `routeId` 区分的封闭联合类型；每个成员拥有自己的路径参数和 Query Schema，不能携带任意 URL、任意路径或任意 Query Map。
- 第一版冻结 36 个稳定 Route Target（`auth.register` … `platform.resource-policies`），来源为 approved 总体 OpenAPI 设计 §13.1 与完整 UX/UI §12.9；本文不复述全部清单（见权威来源），但冻结"36 个稳定 RouteTarget 是封闭集合、31 个页面设计映射关系、A1/C8/C11 稳定子路由不增加页面数"。
- 每个目标只使用稳定标识；邀请、验证、重置令牌、秘密、显示名称和敏感搜索内容不得进入 Route Target。
- `recoveryTarget` 必须是受约束 Route Target，不得是任意 URL。
- 覆盖检查必须同时核对"31 个页面设计"和"36 个稳定 Route Target"，不得把子路由误算成新增产品页面，也不得因页面编号相同漏掉子路由入口。

## 22. capability/permission projection

- `allowedActions` 使用操作域内关闭枚举，只帮助 UI 显示当前可能操作，不能授权 Command；前端不能维护"角色 → 菜单/操作"的第二张固定表。
- `navigationTargets` 只包含当前主体获授权且可安全披露的目标；使用封闭 Route Target，不允许任意 URL。
- Session 只证明认证，不固化组织/项目权限；Query 按当前 PostgreSQL 成员关系、资源状态和下游权限返回投影；Command 提交时再次读取权威权限、资源版本和生命周期。
- 项目进入回收站后不依赖删除前项目角色，只有组织所有者/管理员通过 B8 管理；D2 只接受正式平台管理员能力，不能从组织角色推导。

## 23. unavailable/partial/stale states

- 组合页面使用 `SectionResult<T>` 区分 `available` / `empty` / `partial` / `stale` / `unavailable` / `forbidden`；`loading` 是客户端请求状态，不由服务端返回。
- 主身份、组织或项目权威失败时整体请求失败；次要统计失败时不得覆盖主对象成功。
- `partial`：返回安全可用数据及明确缺失范围；`stale`：返回最近安全投影、最后新鲜时间和陈旧原因；`unavailable`：权威依赖不可用且没有安全陈旧投影；`forbidden`：只有披露分区存在不会扩大信息泄露时使用。
- 权威查询成功但集合确实无记录时才是 `empty`；未知、超时、被采样掉或部分失败不能伪装为空集合或数值 `0`。
- 未实现功能以明确的 `unavailable`（能力未提供）/`forbidden`/`blocked` 状态表示，禁止空数组、全零数据、禁用按钮或"敬请期待"冒充实现。

## 24. D2 PlatformAdmin contract boundary

- D2 的目标、配置与传播 Schema **可以**在契约设计中保留为公开投影结构，但**不得**生成可执行路由或实现，直到平台管理员身份、授予/撤销、break-glass 和平台级审计规则正式批准（G13 门禁）。
- 组织所有者/管理员不能替代该前置；非平台管理员在 Navigation Context 中不获得 D2 入口。
- PLT-01 冻结 D2 的 `platform.resource-policies` RouteTarget 存在性与 `unavailable`（平台管理员能力未批准）状态，不伪造平台管理员能力或 D2 端点。

## 25. safe error projection

- 所有错误对客户端安全投影：不泄露堆栈、SQL、内部队列/主机、对象键、秘密、账号存在性、字段级私有信息。
- 字段错误只返回公开字段路径和安全原因；`currentVersion` 仅在安全并发恢复需要时返回。
- 日志、错误报告、MSW fixture、Playwright trace 和截图不得包含私密令牌、客户端密钥完整值、原始邀请/验证/重置令牌、请求/响应体或 PRD 禁止采集的数据。

## 26. no private backend type exposure

- 公开契约不得暴露 `platform-api` 私有类型、领域实体、Kysely 查询类型、BullMQ Job 定义、Redis Session 结构、配置对象或内部服务名。
- 数据库行、领域实体和下游响应必须显式映射为公开投影，不得透传。
- `platform-contract` 不能依赖 Fastify、Kysely、数据库模型、BullMQ、Redis 客户端、页面组件或 Pinia。

## 27. no processing DB model exposure

- Platform OpenAPI 不得暴露数据接入/处理存储的数据库表、字段、索引、队列或私有投影。
- 浏览器不能访问处理存储私有接口；`platform-api` 只能通过处理系统的正式公开 Query/Command 组合数据，不能直连其数据库或队列。
- 页面所需的监控投影只以公开契约返回，不透传下游数据库模型。

## 28. no event-schema reinterpretation

- `event-schema` 继续只负责事件协议（错误/请求/性能/批次/接收结果），不承载管理平台账号、导航、组织或治理 API。
- `platform-contract` 不重新定义事件类型、枚举或运行时 Schema；如公开投影需要引用事件协议语义，只引用 `event-schema` 的公共常量与契约，不复制为第二套。
- 禁止把事件信封、事件正文或处理存储的 normalized_body 作为管理平台公开 DTO。

## 29. versioning

- 浏览器公开 API 使用 HTTPS REST/JSON，主版本路径 `/api/platform/v1`；同一主版本内只允许向后兼容扩展。
- `operationId` 已发布不得在同一主版本重命名或改变语义。
- 机器 OpenAPI 文件名承载主版本（`platform-openapi-v1.yaml`）；新主版本需要 accepted ADR、迁移方案、兼容窗口。
- `event-schema` 的版本与平台契约版本相互独立；平台公开 API 版本不跟随事件协议版本。

## 30. compatibility

- 同一主版本允许：新增可选响应字段、新增可选 Query 参数（默认行为不变）、新增错误码（不得把原成功结果改成失败）、显式开放枚举新增值（消费者按未知值安全降级）。
- 不兼容变化（删除/重命名字段或操作、改变类型/含义/权限/默认排序/空值语义、可选改必填、收紧合法输入、改变幂等/并发/分页/缓存/错误恢复语义、修改关闭枚举）需要新主版本、迁移方案、兼容窗口和 accepted ADR。
- 兼容差异工具自动阻断同一主版本的不兼容变化；不兼容变化不得静默修改 v1。

## 31. contract fixtures

- 每个操作至少具有合法请求/响应样本；必填缺失、类型错误、非法枚举、超长字段、非法 Query、未知参数和敏感字段进入错误样本。
- Route Target 每个成员都有合法和非法参数样本；`SectionResult`、Problem Details、分页、Operation 和并发版本覆盖所有分支。
- 样本不包含真实账号、Token、Cookie、密钥或监控内容；`contract-testkit` 共享样本无真实敏感信息。
- 前端测试只用契约样本；MSW handler 只能基于契约样本构造。

## 32. generated adapter tests

- 生成的 Server 适配器必须验证：请求、响应和错误都通过运行时 Schema；非法输入稳定拒绝；序列化失败安全失败。
- 生成的 Client 必须验证：对非法响应失败关闭；请求描述与响应校验器与注册表一致；取消与请求上下文正确。
- 生成一致性测试：Zod 注册表可以确定性生成 OpenAPI；OpenAPI 重新生成无未提交差异；每个 `operationId` 唯一；每个 Schema 名称唯一且无循环；Client 与 Server Adapter 来自同一注册表版本。

## 33. OpenAPI drift test

- 漂移测试断言生成 OpenAPI 与契约源码逐值一致（枚举、required、限制、样本、安全约束、operationId 唯一、`$ref` 完整、Schema 名称稳定、状态码集合完整）。
- 禁止手工修改生成文件；任何漂移失败阻断合并。
- 漂移门禁纳入根 `openapi:check`（或等价根命令）与 `check:ci`。

## 34. consumer tests

- 契约消费者测试：URL Schema 和 Route Target 往返稳定；未知参数不会扩宽查询；生成 Client 对非法响应失败关闭；MSW 只使用契约样本构造成功、权限、冲突、限频、partial、stale 和 unavailable。
- Query/Command 状态不会因缓存或乐观更新伪造；一次性秘密不进入 Store、日志、截图或测试追踪。
- `platform-api` 与前端通过同一契约消费/生产；契约测试是 PR 门禁的一部分（testing 规范"单元测试不能替代契约"）。

## 35. CI integration

- 契约变更至少通过：TypeScript 严格类型检查；契约 Schema 单元测试；OpenAPI 生成与格式验证；同主版本兼容差异检查；生成物无漂移检查；包入口、私有路径和依赖边界检查；Server 请求/响应一致性测试；前端 URL、Client、缓存与状态测试；31 页面/36 RouteTarget 覆盖和可达性检查。
- 以下任一情况阻止合并：页面使用未登记端点；handler 没有契约操作；OpenAPI 存在没有 Owner/页面/权限元数据的操作；新路由只能通过手工 URL 到达；Route Target 使用任意 URL；同一主版本出现不兼容变化；生成物与源码不一致；D2 或其他阻塞能力通过占位实现绕过门禁。
- 具体 CI job 归属 accepted ADR-027 与 OPS-01 扩展；本规格冻结门禁语义。

## 36. out-of-scope

PLT-01 **不**实现：

- 任何业务 handler、业务端点、数据库模型、Migration、Redis Session、BullMQ/Outbox、S3 对象存储；
- Vue SPA、页面组件、路由注册表、导航、视觉令牌（属于 PLT-02）；
- A1—A5 认证流程、B1—B8 组织治理、C1—C16 业务页面、D1/D2 页面（后续模块）；
- 处理/存储系统的公开 Query/Command 实现；
- 一次性交付秘密的创建/撤销业务逻辑；
- 版本发布策略、IaC、云资源。

## 37. completion definition

**PLT-01 的操作注册表范围**：与总体 OpenAPI 设计 §19 第 1 步一致，PLT-01 登记 **A1—D2 完整操作集的操作注册表**（operationId、认证级别、权限、输入/输出 Schema、错误、幂等/并发、页面/权限元数据——全部无 handler、无业务实现），并实现 common 基础 Schema 与生成器/testkit/漂移门禁。业务 handler 不属于 PLT-01（后续模块）。"完整"以**契约覆盖清单（expected-operation manifest）** 界定：manifest 按领域逐 operation 枚举所需操作（identity/organization/project-governance/credentials/releases/issues-and-alerts/usage-and-policy/audit/operations/navigation + common），并列出每个 named 契约能力（RFC 9457 错误、Session/CSRF 传输形状、分页、时间、排序、幂等/并发、RouteTarget、capability projection、unavailable/partial/stale）对应的具体 Schema/operation；清单缺失项为完成定义失败。

PLT-01 完成当且仅当：

1. `packages/platform-contract`（或等价真实包）存在：契约源码按领域/common 组织、操作注册表按上述 manifest 完整、公共 Schema 完整；
2. 机器 OpenAPI `docs/api/platform-openapi-v1.yaml` 真实存在且由契约源码生成；
3. 生成器真实存在且确定性（同输入同输出，字节级一致）；
4. 生成 Client（`/client`）与服务端校验适配（`/server`）真实存在并可通过注册表编译；
5. 漂移门禁真实存在并在 PR＋main 都通过（生成无差异）；
6. 契约样本与 `contract-testkit` 真实存在并通过合法性/非法性断言；
7. 包公开导出（`.`/`/client`/`/server`/`/contract-testkit`）真实且符合 Workspace Policy（含新增 `contract` 层矩阵）；
8. RFC 9457 错误契约、Session/CSRF 传输契约形状、分页/时间/排序/幂等/并发、RouteTarget、capability projection、unavailable/partial/stale 均有契约级表达，且逐项登记在契约覆盖清单；
9. D2 只冻结 RouteTarget 与 unavailable 状态，不伪造平台管理员能力；
10. 无私有后端类型、处理存储模型或 event-schema 语义泄露（依赖规则/导出边界/OpenAPI 内部名扫描阻断）；
11. 契约相关测试（生成一致性、漂移、adapter、consumer、样本）真实通过；
12. CI 集成门禁真实通过：31 页/36 RouteTarget 覆盖、无未登记端点、无任意 URL、兼容差异阻断（含 `openEnum`/默认排序/空值语义标记的机器判定）、漂移 PR＋main；
13. 未实现能力以明确的 unavailable/blocked 状态表达；自定义 OpenAPI lint 阻断空 operation/`{}`/自由形式 Schema/未类型化 `unknown` 响应逃逸；生产代码不得 import `contract-testkit`/MSW/fixture；启用 operation 必须有真实 handler 模块（stub/501 为构建失败）；
14. 不包含 PLT-02 Vue SPA 实现；
15. 独立验收通过且叶子计数按正式规则更新。

## 38. 规格自检

| 检查项 | 结果 |
|---|---|
| 是否改变 approved PRD/架构 | 否；只把已批准总体 OpenAPI、平台前后端设计与 UX/UI 转成契约基础规格 |
| 是否虚构实现 | 否；目标文件、包、OpenAPI、生成器、Client/Server 适配均标为不存在，待 ADR accepted |
| 是否泄露私有类型/数据库/事件模型 | 否；26/27/28 节明确禁止 |
| 是否伪造 D2/下游能力 | 否；D2 只冻结 RouteTarget 与 unavailable，下游契约保持 blocked |
| 是否覆盖 31 页/36 RouteTarget | 是；覆盖检查门禁 |
| 是否覆盖错误/幂等/并发/分页/时间/排序 | 是；14/17/18/19/20 节 |
| 是否需要 ADR | 是；ADR-025 前端技术栈、ADR-026 后端运行时与契约链、ADR-027 契约生成工具链、ADR-028 Session/CSRF 安全未 accepted 前不得实施 |
| 是否进入 writing-plans | 否；ADR accepted 且用户批准后才进入 |

## 39. 评审记录

### 2026-08-08：独立评审（reviewer subagent，记录用，不代替正式批准）

> 本节点记录 reviewer subagent 意见。意见只用于改进设计材料，不改变本规格的 draft 状态。正式批准必须由用户完成。

- **架构评审**：内部一致性高，与 ADR-025/026/027/028 边界一致；占位符可追溯（"真实路径为准""由 accepted ADR-026 承载"等不虚构实现）。`§37 "操作注册表完整"` 存在歧义。修正：§37 已改为与总体 OpenAPI 设计 §19 第 1 步一致的"A1—D2 完整操作注册表（无 handler）＋契约覆盖清单（expected-operation manifest）"界定。
- **测试/兼容评审**：`ACCEPT-WITH-REVISIONS`。§37 部分完成项为不可验证文本（操作注册表"完整"、契约能力"均有表达"、无泄露、无空 Schema）。修正：§37 已改为覆盖清单逐项登记、漂移 PR＋main、自定义 OpenAPI lint（空 operation/`{}`/`unknown`）、生产代码不 import testkit/MSW/fixture、启用 operation 真实 handler、注册表 `openEnum`/默认排序/空值语义标记、错误码进稳定目录。
- **非阻断观察**：平台契约漂移为自引用（注册表→OpenAPI），与 ingestion 双权威先例不同，其真实职责是确定性＋已提交制品一致＋跨制品版本一致（§11 已覆盖）；兼容语义含义变化需人工评审门禁与机器检查并行。
- **评审落实**：已落实于 §11、§35、§37。另附：安全评审对 PLT-02 的交叉意见不影响本规格。
