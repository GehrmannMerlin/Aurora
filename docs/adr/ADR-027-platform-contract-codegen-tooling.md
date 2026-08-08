---
title: ADR-027：管理平台契约生成工具链
status: proposed
decision-status: proposed
implementation-status: not-started
approval-status: awaiting-user-approval
owner: platform/backend
date: 2026-08-08
last-reviewed: 2026-08-08
applies-to: @aurora/platform-contract 的契约源码组织、唯一操作注册表、确定性生成器、生成 Client/Server 适配、漂移门禁、兼容差异检查与契约样本/testkit
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/platform-contract-foundation.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../../docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md
  - ../../docs/adr/ADR-005-event-schema-source-of-truth.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
superseded-by: none
---

# ADR-027：管理平台契约生成工具链

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-user-approval
- 日期：2026-08-08
- Owner：platform/backend
- 适用范围：`@aurora/platform-contract` 的契约源码组织、唯一操作注册表、确定性生成器、生成 Client/Server 适配、漂移门禁、兼容差异检查与契约样本/testkit；数据接入 OpenAPI 工具链先例（`tooling/ingestion-openapi-contract`）与 event-schema 单一来源原则的推广
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联技术方案：[总体 OpenAPI 与实现约束设计](../../docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)（approved）、[平台后端设计](../../docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md)（approved，BE-GAP-01/02）、[管理平台契约基础（PLT-01）](../../docs/architecture/platform-contract-foundation.md)（draft）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-08 创建为 `proposed`。创建依据：G09（PLT-01）实施门禁；前端技术栈设计 §7.2"Schema/客户端生成——仓库没有 OpenAPI 等公开 API 源、生成工具或版本兼容规则"；总体 OpenAPI 设计 §17.2"生成一致性测试"与 §18 CI 门禁；平台后端设计 BE-GAP-01"机器可读 OpenAPI、请求/响应 Schema、示例和兼容测试尚不存在"。数据接入已有真实工具链先例（`docs/api/ingestion.openapi.yaml` + `tooling/ingestion-openapi-contract` 漂移门禁，40 测试）。`formalization-readiness.md` §7 候选队列当前无"契约/代码生成工具链"独立行（该队列的"管理平台前端技术栈"第 3 项、"管理平台服务形态与后端栈"第 4 项、"Session、CSRF 与内部能力令牌"第 7 项已分别由 ADR-025/026/028 承接）；本 ADR 补足队列中由总体 OpenAPI 设计 §17.2/§18 与前端技术栈设计 §7.2 确立的契约生成工具链候选，且同一变更中在 §7 追加该候选行。**在用户批准（accepted）前，不得创建 `@aurora/platform-contract`、生成器、机器 OpenAPI、漂移门禁或进入 `writing-plans`。**

## 背景

管理平台浏览器公开 API 需要单一权威机器契约：Zod 注册表 → 确定性生成 OpenAPI、前端 Client、Fastify 输入/输出校验适配、MSW 样本与兼容差异报告。总体 OpenAPI 设计方案 A 已批准"统一公开契约、内部按领域模块化、生成单一 Platform OpenAPI"，并规定"契约源码按领域拆分，共用基础 Schema，最终生成一个 `/api/platform/v1` OpenAPI 和一个前端客户端""生成制品必须带有'由契约源码生成、禁止手工修改'标记""CI 重新生成后存在差异即失败"。数据接入域已用 `tooling/ingestion-openapi-contract` 建立漂移门禁先例（event-schema 枚举/required/限制/样本逐值比对）。管理平台契约生成工具链（契约源码组织、唯一注册表、确定性生成器、兼容差异检查、漂移门禁、testkit）是长期、高迁移成本工程基线，按 ADR 规范 7.2 需创建独立 ADR。

## 决策驱动因素

- **单一权威来源**：Zod 注册表是契约源码，OpenAPI/Client/Server/MSW 样本全部由同一注册表生成，避免多套权威；
- **禁止手工改生成物**：生成制品带"禁止手工修改"标记，CI 再生成差异即失败；
- **确定性**：同输入同输出；不依赖时间戳/随机数/文件顺序/环境变量；
- **兼容阻断**：同一主版本内不兼容变化自动识别并在合并前阻断；
- **漂移检测**：机器 OpenAPI 与契约源码逐值一致；
- **复用先例**：数据接入已用 `tooling/ingestion-openapi-contract` 验证漂移门禁可行性；event-schema 单一来源原则（ADR-005）可推广；
- **不改变已批准方案**：总体 OpenAPI 方案 A 已批准，工具链只是其工程落地；
- **高迁移成本**：生成工具链一旦铺开，替换成本高，需要长期保留取舍依据。

## 候选方案

### 方案 A：Zod 注册表源码 → 自研确定性生成器 + 漂移门禁 + 兼容差异检查（推荐）

**行为**：`@aurora/platform-contract` 内按 common/领域组织 Zod Schema 与唯一操作注册表；自研（或在 approved 范围内最小引入）确定性生成器将注册表转成 OpenAPI 3.1、Client 类型/校验器、Server 输入/输出校验适配、MSW 样本与覆盖清单；`tooling/platform-contract-drift`（或等价）在 CI 比对生成无差异并阻断不兼容变化。

**优点**：完全掌控确定性、命名与兼容语义；与 event-schema/ingestion-openapi-contract 先例一致；无第三方生成器锁定；可精确实现 31 页/36 RouteTarget 覆盖与 D2 门禁。

**缺点**：需要自行实现/维护生成器与漂移工具；OpenAPI 生成正确性需大量测试；自研成本高于直接采用现成生成库。

**选择结论**：推荐。

### 方案 B：采用现成 OpenAPI 生成库（如 openapi-typescript、@fastify/swagger 等）（不采用）

**行为**：直接采用第三方 OpenAPI 生成库生成类型与校验器。

**优点**：开发成本低；生态成熟。

**缺点**：现成库的确定性/命名/兼容语义与 approved 方案 A 的 31 页/36 RouteTarget 覆盖、D2 门禁、`recoveryTarget` 受约束 Route Target 等专用要求不完全一致；生成物控制力弱；与 event-schema/ingestion 先例（自研漂移）不一致；引入第三方契约链锁定。

**选择结论**：不采用（可作为生成器内部可选依赖，不作为方案主导）。

### 方案 C：手写多套类型/OpenAPI（不采用）

**行为**：前端类型、服务端 DTO、OpenAPI 各自手写。

**优点**：无工具链成本。

**缺点**：形成多套权威来源，必然漂移；与 approved 方案 A"生成物不得手工修改""无未登记端点""兼容差异自动阻断"直接冲突；与 event-schema 单一来源原则冲突。

**选择结论**：不采用。

### 候选比较

| 维度 | A：Zod 注册表自研 | B：现成生成库 | C：手写多套 |
|---|---|---|---|
| 单一权威来源 | 是 | 部分 | 否 |
| 确定性/控制力 | 高 | 中 | 不适用 |
| 专用门禁（31 页/36 RT/D2） | 可精确实现 | 需改造 | 无法自动 |
| 兼容差异阻断 | 可精确实现 | 需改造 | 无法自动 |
| 工程成本 | 中高 | 低 | 低（但漂移无限） |

## 最终决策

**最终选择方案 A：Zod 注册表源码 + 自研确定性生成器 + 漂移门禁 + 兼容差异检查。**

### 决定细节

1. **契约源码**：`@aurora/platform-contract` 内按 `common/`（identifiers/time/session/authorization/navigation/query/pagination/command/operation/problem-details）与领域模块（identity/organization/project-governance/credentials/releases/issues-and-alerts/usage-and-policy/audit/operations）组织 Zod Schema 与唯一操作注册表；
2. **唯一操作注册表**：每个公开操作声明 `operationId`（`domainVerbObject` 稳定格式）、认证级别（public/intent/session/recent-verification）、权限、输入/输出 Schema、错误、幂等/并发、缓存、审计与页面追踪；`operationId` 不包含页面编号/HTTP 方法/实现类名；
3. **确定性生成器**：将注册表确定性生成 OpenAPI 3.1（`docs/api/platform-openapi-v1.yaml`）、前端请求类型/运行时响应校验器/无业务状态 Client、Fastify 路由输入/输出校验适配、MSW 基础 handler 类型与合法/非法契约样本、OpenAPI 兼容差异报告、页面—操作—权限—路由覆盖清单；同输入同输出，生成失败稳定失败；
4. **生成物所有权**：生成物带"由契约源码生成、禁止手工修改"标记；CI 重新生成后存在差异即失败；
5. **漂移门禁**：`tooling/platform-contract-drift`（或等价）比对 Zod 注册表枚举/required/限制/样本与生成 OpenAPI 逐值一致；`operationId` 唯一、`$ref` 完整、Schema 名称稳定、状态码集合完整；纳入根 `openapi:check`/等价根命令与 `check:ci`；漂移/再生成检查在 PR（快速漂移）与 main（CI-passed 提交制品再生成差异）都运行；
6. **兼容差异检查**：同一主版本内不兼容变化（删除/重命名字段或操作、类型/含义/权限/默认排序/空值语义改变、可选改必填、收紧合法输入、幂等/并发/分页/缓存/错误恢复语义改变、关闭枚举修改）自动阻断合并；不兼容变化需要新主版本、迁移方案、兼容窗口和 accepted ADR；
7. **包公开导出**：根入口（公共 Schema/操作注册表/稳定类型）、`/client`、`/server`、`/contract-testkit`；内部生成器/路径拼装器/未批准 Schema 不导出；
8. **testkit**：`contract-testkit` 共享合法/非法样本（无真实敏感信息）；每个操作至少一个合法请求/响应样本；Route Target 每个成员合法/非法参数样本；`SectionResult`/Problem Details/分页/Operation/并发版本覆盖全部分支；
9. **依赖边界**：`@aurora/platform-contract` 不依赖 Fastify/Kysely/BullMQ/Redis/页面组件/Pinia/数据库模型；Workspace Policy 新增 `contract` 层规则。具体矩阵变更（与 `tooling/workspace-policy/src/graph.ts` 当前层矩阵一致地落为 `aurora.layer` 声明）：
   - 新增 `contract` 层，允许目标集合为 `{protocol}`（纯契约叶子层，只依赖 protocol，**不依赖 tooling**，避免 `contract → tooling → service → contract` 可达环）；
   - `service` 层允许目标集合追加 `contract`（`platform-api` 以 `service` 层消费生成 Server 适配）；
   - `tooling` 层允许目标集合追加 `contract`（漂移门禁 `tooling/platform-contract-drift` 作为 tooling 层包可依赖 `@aurora/platform-contract` 比对注册表与生成物；若实施时改为消费仅生成 YAML＋testkit，则该边可不加，实施计划以"漂移门禁不产生层环、可执行"为准钉死）；
   - `console` 应用层（ADR-025 决定细节 13）在 `apps/console` 创建时作为独立应用层加入，允许目标集合含 `contract`/`tooling`，不依赖 `data`/`service` 内部包；
10. **本 ADR 冻结决策**：契约源码组织、唯一注册表、确定性生成、漂移门禁、兼容差异、包导出、testkit 的工程基线；精确生成器实现细节、依赖版本、CI job 归属归实施计划（ADR-025/026 与 OPS-01 扩展）。

## 结果与影响

### 正面影响

- 单一权威来源，杜绝多套类型漂移；
- 生成物禁止手工修改，CI 再生成差异即失败；
- 兼容差异自动阻断同一主版本不兼容变化；
- 与 event-schema/ingestion-openapi-contract 先例一致；
- 可精确实现 31 页/36 RouteTarget 覆盖与 D2 门禁。

### 负面影响与代价

- 需要自行实现/维护生成器与漂移工具；
- OpenAPI 生成正确性需大量测试；
- 自研成本高于直接采用现成生成库；
- 契约组合与代码生成工具维护责任。

### 未解决问题

- 生成器精确实现与依赖版本（实施计划锁定）；
- CI job 归属（OPS-01 扩展）；
- 版本发布策略（requires-accepted-adr，release 门禁）。

## 实施约束

- 生成制品带"禁止手工修改"标记；CI 再生成差异即失败；
- `operationId` 唯一且稳定；已发布 `operationId` 不得在同一主版本重命名或改变语义；
- 不兼容变化自动阻断合并；
- `@aurora/platform-contract` 不依赖 Fastify/Kysely/BullMQ/Redis/页面组件/Pinia/数据库模型；
- 不暴露内部生成器、路径拼装器或未批准 Schema；
- 契约样本不含真实账号/Token/Cookie/密钥/监控内容；
- 严格 TypeScript；所有外部输入按 `unknown` 运行时校验；
- **可执行门禁（§7.12）**，以下各项必须落为 CI 阻断/依赖规则/自定义 OpenAPI lint：
  - 无空 OpenAPI operation（operation 必须带类型化请求/响应）；无 `{}`/自由形式 Schema；无未类型化 `unknown` 响应逃逸契约——自定义 OpenAPI lint 规则集标记并阻断；
  - `operationId`/Schema 名称唯一、`$ref` 完整、Schema 名称稳定、状态码集合完整；
  - 生产代码不得导入 `contract-testkit`/MSW/固定 fixture 模块（依赖规则阻断）；生产构建排除 fixture 模块；
  - 启用 operation 必须有真实 handler 模块；stub/fixture 支撑的 handler 与 501 占位为构建失败（与总体 OpenAPI §17.3"不能以 501 占位冒充完成"互补的反向规则）；
  - 注册表必须为每个列表操作声明分页模型、每个枚举声明开放/关闭性（`openEnum: boolean`）、声明默认排序与空值语义标记，使兼容差异检查可机器判定"显式开放枚举新增值"（允许）vs"关闭枚举修改"（阻断）与"空值语义改变"（阻断）；语义含义类变化（非类型/元数据可判定的）作为人工评审门禁与机器检查并行；
  - 新增错误码必须加进 PLT-01 §14 稳定类别目录且客户端对未知码安全降级；
  - 漂移/再生成检查在 PR 与 main 都运行（PR 快速漂移，main 对 CI-passed 提交做制品再生成差异，与 test-strategy 主分支"同一提交不可变候选制品"一致）。

## 迁移方案

本 ADR accepted 后：PLT-01 正式规格从 draft 更新为 approved → writing-plans → 实施 `@aurora/platform-contract`、生成器、漂移门禁、testkit → 根 `openapi:check` 扩展 → CI 集成。

## 回滚方案

- 契约基础尚未被消费者使用时，可删除未发布实验实现并保留设计/验证记录；
- 已有消费者后，回退到上一份兼容 OpenAPI 与生成制品，不退回手写多套类型；
- 新操作可在未公开使用前撤回；已公开操作按兼容规则废弃。

## 验证方式

- 契约单元测试（合法/非法/边界样本）；
- 生成一致性测试（Zod 注册表确定性生成 OpenAPI；再生成无差异；operationId/Schema 名称唯一无循环）；
- OpenAPI 格式验证（redocly 或等价）；
- 漂移门禁测试（40+ 断言类比 ingestion 先例）；
- 兼容差异测试（同一主版本不兼容变化被阻断）；
- 包入口/私有路径/依赖边界检查；
- 全仓质量门禁。

## 重新评估条件

- 生成链长期产生无法控制的错误、性能或维护成本；
- 单一 OpenAPI 生成或客户端体积经测量无法满足构建与加载预算；
- 新客户端形态需要不同认证/传输协议；
- 现成生成库演进到完全匹配专用门禁。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-08：创建（proposed）

- 状态 `proposed / not-started / awaiting-user-approval`；
- 由 G09（PLT-01）实施门禁创建；
- 依据 approved 总体 OpenAPI 设计、平台后端设计 BE-GAP-01/02、event-schema/ingestion-openapi-contract 先例；
- 未调用 writing-plans、未创建 `@aurora/platform-contract`、未创建生成器/漂移门禁/机器 OpenAPI、未实施代码；
- 等待独立评审与用户正式批准，不自动批准、不实施。

### 2026-08-08：独立评审（reviewer subagent，记录用，不代替正式批准）

> 本节点记录 reviewer subagent 意见。意见只用于改进决策材料，不改变 ADR 状态。正式接受必须由用户完成。

- **架构/后端评审**：`ACCEPT-WITH-REVISIONS`（无正确性阻断）。生成方向与 approved 总体 OpenAPI 设计与 event-schema/ingestion-openapi-contract 先例一致；但有两个 load-bearing 修正：① 新 `contract` 层与当前 workspace-policy 层矩阵不兼容（漂移门禁作为 `tooling` 层包需依赖 `contract` 层，矩阵不允许；`contract → tooling` 边反向且打开可达环）；② §7 候选队列引用错误（队列第 7 项是 Session/CSRF，无"Schema/客户端生成"行）。
- **测试/兼容评审**：`ACCEPT-WITH-REVISIONS`（无正确性阻断）。可测试门禁充分（确定性、漂移、生成物所有权、唯一性、fixtures/adapter/consumer）；但"不伪造端点/fake backend/空 Schema/`unknown` 逃逸"等反模式禁令未映射为可执行约束；兼容规则非完全机器可判定（需注册表 `openEnum`/默认排序/空值语义标记，语义含义变化需人工评审门禁）。
- **非阻断观察**：平台契约漂移是自引用（注册表→OpenAPI），与 ingestion 双权威先例不同，其真实职责是确定性＋已提交制品一致＋跨制品版本一致；新增错误码应加进稳定类别目录且客户端未知码安全降级；漂移建议 PR＋main 都跑。

**评审落实**：本 ADR 决定细节 5/9、实施约束已落实：① Workspace Policy `contract` 层矩阵变更钉死（`contract → {protocol}`、`service` 追加 `contract`、`tooling` 追加 `contract`、`console` 应用层），漂移门禁不产生层环；② 引用改为前端技术栈设计 §7.2 与总体 OpenAPI §17.2/§18，并说明 §7 队列同一变更追加候选行；③ 实施约束新增可执行门禁（空 operation/`{}`/`unknown` lint、生产代码不 import testkit/MSW/fixture、启用 operation 真实 handler、注册表 `openEnum`/默认排序/空值语义标记、错误码进稳定目录、漂移 PR＋main）。详见各节修订。
