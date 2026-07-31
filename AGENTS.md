# AGENTS.md

## 1. 定位与效力

本文件适用于 Aurora 仓库根目录及全部子目录，是 Agent 的精简执行入口。它不复制 PRD 或领域规范；详细规则以对应权威文档为准。

规则优先级：更高层级指令与用户已授权范围 → approved 长期规范 → accepted ADR → 本文件与 [AURORA_RULES.md](AURORA_RULES.md) 的当前快照 → 模块文档与实现说明。发现冲突时，停止受影响工作并报告，不得自行选择方便的解释。

## 2. 新会话固定读取与任务路由

每个新会话或上下文恢复后，必须先完整阅读：

1. 本文件；
2. [AURORA_RULES.md](AURORA_RULES.md)。

随后先判断任务类型，再完整阅读被触发文档；跨领域任务读取并集，不机械加载无关规范。

| 任务触发 | 必须完整阅读 |
|---|---|
| 产品范围、业务规则、UX/UI、用户流程、权限、数据生命周期、公共行为 | [核心业务 PRD](Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) |
| 系统边界、模块职责、依赖、公共 API 边界、基础设施、部署架构 | [架构规范](<Aurora 架构规范.md>) |
| 实现、重构、代码评审、Bug 修复、调试 | [代码规范](<Aurora 代码规范.md>) |
| 测试设计、缺陷回归、CI、质量门禁、发布验证 | [测试规范](<Aurora 测试规范.md>) |
| 正式文档、规则、README、API 文档、示例、文档治理 | [文档规范](<Aurora 文档规范.md>) |
| ADR 判断、长期技术选型、公共 API 兼容、高迁移成本决策 | [ADR 规范](<Aurora ADR 规范.md>) |

任务范围触及时，还必须阅读相关 accepted ADR、模块 README、公开 API、协议、测试、发布和运维文档。`proposed` ADR 可用于讨论，不能作为实施授权。分类不确定、规则冲突或任务扩大时，先补读可能适用的权威文档。

## 3. 当前项目状态

截至 2026-07-30：

- 第一版核心业务规则、管理平台前端 UX/UI、前端技术栈、管理平台后端、测试/部署/发布和 A5 账号注销与数据生命周期设计均已批准；六专题总结只作正式化输入；项目正在进行正式文档、ADR 与实施就绪审查；
- 正式文档、唯一权威来源和批准设计历史的映射见[正式文档索引](docs/README.md)，缺口与实施顺序见[正式化与实施就绪追踪](docs/architecture/formalization-readiness.md)；批准不等于代码、机器 API、数据模型、CI、基础设施或 ADR 实施授权；
- 管理平台 A1—D2、`NAV-A`、`AUDIT-A`、页面状态、Query/Command 需求和 GAP-01—GAP-20 的详细权威来源是完整前端 UX/UI 文档；六专题总结只承担状态、跨专题映射、正式化索引和阻塞追踪，不得用摘要删除或弱化详细设计；
- 管理平台九个稳定业务域和共用交互边界见[管理平台产品业务域](docs/prd/platform-product-domains.md)；逐页细节必须回读完整 UX/UI，不在本入口重复维护；
- 管理平台[控制台视觉语言](docs/superpowers/specs/2026-07-30-aurora-console-visual-language-design.md)已批准：浅色内容区、深石墨顶栏、纯色琥珀橙侧栏、深色前景、中高信息密度且禁止渐变；同方向低风险视觉细节由 Agent 直接收口并同步，不重复询问，但不得借此改变业务、导航层级、权限、安全、数据或公共契约；主题和组件实现仍不存在；
- A5-001—A5-011 的长期正式规则见[账号注销与数据生命周期](docs/security/account-deletion-and-data-lifecycle.md)：7 天冷静期、双重身份复核、受理后全部 Session 终止、普通业务匿名保留、一年审计、7 天在线清理及 35 天备份淘汰；机器契约和实现仍不存在；
- 已从 approved 设计形成系统、SDK、管理平台前后端、测试、部署、发布/回滚、备份恢复和 A5 安全的最小充分正式文档；ADR-001—007 已完成独立非作者与所需领域评审；ADR-001/003/005/006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-002、ADR-004 为 `accepted / not-started`；设计历史保留但不作为平行维护版本；
- 前端技术栈整份方案已批准：Vue 3 SPA＋Vite、Vue Router＋Pinia 自建请求缓存层、PrimeVue＋VeeValidate/Zod＋受控 DataTable＋Apache ECharts，以及 `vue-tsc`/ESLint/Vitest/Vue Testing Library/MSW/Playwright/axe/Lighthouse CI 精简质量链；精确依赖版本、浏览器版本和量化性能预算归入相应后续专题，正式实施仍受 API、ADR 和后续设计门禁约束；
- 管理平台后端专题已获用户整体批准：`BACKEND-001=A`（TypeScript/Node.js 模块化单体＋独立 Worker、Fastify、PostgreSQL/Kysely、Zod/OpenAPI）、`BACKEND-002=B`（PostgreSQL Outbox＋Redis/BullMQ＋私有 S3 兼容对象存储、第一版无独立搜索）、`BACKEND-003=B`（Redis 权威不透明 Session＋同步 CSRF、短期内部能力令牌）以及完整派生领域/API 方案均记录于[后端设计](docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md)；
- 管理平台[总体 OpenAPI 与实现约束设计](docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)已获用户批准：采用统一公开契约、内部按领域模块化并生成单一 Platform OpenAPI；31 个页面设计映射 36 个稳定 Route Target；B2 创建成功进入 C1，B1 选择已有 active/获准 archived 项目进入 C2；前端壳层、真实 UI 入口与可达性测试必须先行；
- 仓库已有已批准后端与总体契约设计，但尚无 `platform-contract`、机器可读 Platform OpenAPI、生成 Client/Fastify 适配、精确领域 Schema、可执行平台数据模型、模块 README 或管理平台实现；设计中的能力名称均不是已存在接口；
- ADR-001 与 ADR-006 为 `accepted / in-progress`，ADR-007 为 `accepted / implemented`，ADR-005 现为 `accepted / in-progress`，ADR-003 现为 `accepted / in-progress`（Core 基础第一增量与 Browser 浏览器环境能力与页面生命周期基础第一增量已实施，具体插件与传输仍未实现），ADR-002、ADR-004 仍为 `accepted / not-started`；真实内部包为 `@aurora/workspace-policy`、`@aurora/event-schema`（仅协议基础增量）、`@aurora/core`（仅 Core 基础增量）与 `@aurora/browser`（仅浏览器环境与生命周期基础增量）；
- BACKEND-001—003 和完整派生方案已经获得设计层批准；相关框架、数据库、Redis/BullMQ、Session、安全和对象存储仍需正式 ADR 才能实施；Monorepo 根 Workspace 与最小本地工具已由 [ADR-007](docs/adr/ADR-007-workspace-package-and-task-tooling.md)（implemented）和[正式规格](docs/architecture/monorepo-and-build.md)（已实施）收口，版本发布、数据接入/处理物理技术、机器契约和区域仍未获实施授权。
- 测试/部署/发布已批准 `TD-001=A`、`TD-002=A`、`TD-003=A` 及完整派生方案 `TDR-DERIVED-001`；批准只确认设计，不表示代码、CI、AWS 资源、数据库、秘密、制品或部署存在，也不自动修改 ADR 状态。
- `event-schema` 协议基础第一增量已由[正式规格](docs/protocol/event-schema-foundation.md)冻结并实施为真实私有包 `@aurora/event-schema`：版本化公共信封、运行时边界校验、稳定错误和共享契约样本已存在并通过新鲜验证；机器运行时 Schema、具体事件正文、批次/接收协议和真实消费者仍不存在。
- SDK Core 生命周期与插件编排基础第一增量已由[正式规格](docs/sdk/sdk-core-foundation.md)冻结并[实施](docs/superpowers/plans/2026-07-30-sdk-core-foundation.md)为真实私有包 `@aurora/core`：环境无关 Core、显式生命周期、最小配置、插件注册与顺序编排、异常隔离、事件入口和多实例隔离已存在并通过新鲜验证；ADR-003 进入 `accepted / in-progress`。Browser、具体插件、框架适配、采样、队列、传输和持久化仍不存在。
- `@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量已由[正式规格](docs/sdk/browser-environment-foundation.md)冻结并[实施](docs/superpowers/plans/2026-07-30-browser-environment-foundation.md)为真实私有包 `@aurora/browser`：安全环境与能力探测、脱敏页面快照、`visibilitychange`/`pagehide`/`pageshow` 生命周期订阅、幂等释放、异常隔离和多实例隔离已存在并通过新鲜验证（含本地 Chromium 真实浏览器门禁）；ADR-003/006 保持 `accepted / in-progress`。具体采集插件、框架适配、采样、队列、传输和持久化仍不存在。
- 仓库仍无完整 SDK、服务端或管理平台业务实现、机器 OpenAPI、具体事件正文、批次/接收协议、可执行数据模型、CI 或云基础设施；已实施的 `@aurora/core` 与 `@aurora/browser` 仅是各自基础增量；不得在入口维护易失真的固定文件数量。

当前决策优先级：

1. “私有 Monorepo 根 Workspace 与最小本地工程工具”的[模块实施计划](docs/superpowers/plans/2026-07-29-monorepo-foundation.md)已执行并由 2026-07-30 新鲜验证核验完成；`@aurora/workspace-policy` 是首个真实内部包；
2. `event-schema` 协议基础第一增量的[正式规格](docs/protocol/event-schema-foundation.md)与[实施计划](docs/superpowers/plans/2026-07-30-event-schema-foundation.md)已执行完毕，`@aurora/event-schema` 是第二个真实内部包，仅信封/版本/运行时边界/共享样本存在；ADR-005 进入 `in-progress`；
3. SDK Core 生命周期与插件编排基础第一增量已实施为 `@aurora/core` 并通过新鲜验证，ADR-003 进入 `in-progress`；`@aurora/browser` 浏览器环境能力与页面生命周期基础第一增量已实施为 `@aurora/browser` 并通过新鲜验证（含本地 Chromium 真实浏览器门禁），ADR-003/006 保持 `in-progress`；具体采集插件、框架适配、采样、队列、传输、持久化及具体错误、请求、性能和资源事件正文仍等待各自 approved 规格和上游实现，均不得自动开始；
4. 管理平台总体 OpenAPI 与实现约束设计已批准并同步到长期权威文档；机器契约与实现仍须等待 D2/Session/下游契约、required ADR 和单模块计划，不自动开始；
5. 按[ADR 候选队列](docs/architecture/formalization-readiness.md#7-新-adr-候选队列)只在直接阻塞所选模块时建立独立提案，不预占编号、不创建大一统 ADR；
6. D2、邮件、区域、运营、平台和数据缺口继续阻塞其直接模块，不阻塞协议基础增量；不发起新专题讨论。

每项未决内容必须留在有顺序的决策清单中；不得为了“尽快”而把未确认方案写成事实。

## 4. 范围与架构门禁

- 第一版范围以核心 PRD 为唯一产品依据；超出第一版的能力停止设计或实现并报告。
- 五个系统边界为 SDK、数据接入、数据处理与存储、管理平台、公共协议；职责和依赖方向以架构规范为准。
- 管理平台只能通过公开 API 使用服务端能力，禁止直连数据库、内部队列或私有实现。
- 公共事件类型、枚举和运行时 Schema 以 `event-schema` 为唯一来源；外部输入必须按不可信数据进行运行时校验。
- Core 不得依赖 Browser；插件和框架适配只能依赖公开接口，不能访问私有状态、维护独立上报通道或形成反向/循环依赖。
- SDK 最高优先级是不影响宿主；异常隔离、重复初始化、资源恢复、队列/重试上限和多实例隔离必须满足架构与代码规范。
- 默认隐私边界以 PRD 和架构规范为准；不得自行采集请求/响应体、凭据、表单、完整 DOM/文本、完整行为轨迹、指纹或完整 IP。

## 5. 接到任务后的流程

1. 判断请求是回答/评审、诊断、设计、实现、重构、公共契约、文档规则还是发布运维；回答、评审和诊断不自动授权修改。
2. 查看分支、`git status`、未提交修改、目标文件及更深层 `AGENTS.md`；区分当前任务与用户已有修改。
3. 按第 2 节读取任务相关权威文档，确认目标、非目标、范围、权限、隐私、依赖和失败边界。
4. 判断是否需要 ADR。系统边界、长期基础设施、公共 API 不兼容、安全/隐私默认、SDK 分层或高迁移成本选择必须先有 proposed ADR，并在 accepted 前停止正式实施。
5. 复杂实现先形成可执行设计与计划；若用户限定只讨论设计，则不得写代码、建组件或进入实施计划。
6. 只做当前授权范围内的最小变更；同步受影响文档；运行与风险相称的新鲜验证；检查完整 diff 和工作区状态后再交付。
7. 对具有有限决策清单的设计，用户已明确批准全部单项后即视为整体批准并直接同步状态，不再重复询问完整方案是否批准；出现权威冲突或不可逆安全/数据风险时除外。

## 6. 实施、测试与文档底线

- 代码必须遵守严格 TypeScript、公开入口、运行时校验、错误可见和敏感信息不入日志；具体要求见代码规范。
- 新功能和 Bug 修复按测试规范选择单元、集成、契约、浏览器、端到端、性能或稳定性验证；不得删除或弱化失败测试来恢复 CI。
- 公共 API/协议变化必须同步契约、版本、兼容、迁移和测试文档；不兼容变化需要 accepted ADR。
- 设计中的每个元素必须映射真实业务、权限与公开后端能力；没有后端支撑的第一版能力记录为缺口，非第一版能力删除。
- 统计和图表必须说明来源、口径、更新时间、水位、采样/降级影响和空值含义。
- 页面按业务需要覆盖 `loading`、`empty`、`error`、`forbidden`、`processing`、`partial`、`stale`、`unavailable` 等状态。
- 代码或设计变化必须判断 PRD、架构、ADR、README、API、协议、测试、隐私、安全、发布和运维文档影响；无影响也需说明原因。

## 7. Git、验证与停止条件

- 不覆盖、回滚、删除或整理用户已有无关修改；禁止未经明确授权使用破坏性 Git/文件操作。
- 只暂存当前任务文件；提交、推送、PR、合并和外部发布必须在用户授权范围内。
- 声称完成、修复、通过或可发布前，必须运行匹配范围的验证并读取完整输出；失败时报告实际失败。
- 发生规则冲突、第一版越界、只有 proposed ADR、权限/隐私/删除不明、需要覆盖用户修改、破坏性目标不明或权威来源无法判定时，停止受影响范围并报告；其余安全只读检查可继续。

## 8. 入口维护

每次 approved 规则、accepted ADR、产品批准或设计确认改变项目阶段、实施门禁或决策顺序时，必须在同一变更中同步本文件与 `AURORA_RULES.md` 的当前状态和决策队列。

本文件最多 180 行且不超过 24 KiB。新增细节必须进入对应权威规范或专题文档，本文件只保留链接和可执行门禁。入口可结构化重写；六份长期规范继续 append-only，历史由其维护记录与 Git 保留。
