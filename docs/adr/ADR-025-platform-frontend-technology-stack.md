---
title: ADR-025：管理平台前端技术栈
status: accepted
decision-status: accepted
implementation-status: not-started
approval-status: approved
owner: platform/frontend
date: 2026-08-08
last-reviewed: 2026-08-08
applies-to: 管理平台前端工程基线：Vue 3 SPA＋Vite、Vue Router、Pinia 与自建请求/缓存层、PrimeVue＋VeeValidate/Zod＋受控 DataTable＋Apache ECharts、质量工具链（vue-tsc/ESLint/Vitest/Vue Testing Library/MSW/Playwright/axe/Lighthouse CI）
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/platform-frontend.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/superpowers/specs/2026-07-28-aurora-frontend-technology-stack-design.md
  - ../../docs/superpowers/specs/2026-07-30-aurora-console-visual-language-design.md
  - ../../docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../../docs/superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
superseded-by: none
---

# ADR-025：管理平台前端技术栈

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：not-started
- 审批状态：approved
- 日期：2026-08-08
- Owner：platform/frontend
- 适用范围：管理平台前端工程基线——Vue 3 SPA＋Vite（严格 TypeScript、SFC＋Composition API）、Vue Router、Pinia 与自建请求/缓存层、PrimeVue＋VeeValidate/Zod＋受控 DataTable＋Apache ECharts、质量工具链（vue-tsc/ESLint/Vitest/Vue Testing Library/MSW/Playwright/axe/Lighthouse CI）
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联技术方案：[前端技术栈设计](../../docs/superpowers/specs/2026-07-28-aurora-frontend-technology-stack-design.md)（approved，FE-STACK-001—004）、[控制台视觉语言](../../docs/superpowers/specs/2026-07-30-aurora-console-visual-language-design.md)（approved）、[管理平台前端架构](../../docs/architecture/platform-frontend.md)（approved）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-08 创建为 `proposed`。创建依据：G09（PLT-01/PLT-02）实施门禁；前端技术栈设计 §7.1"Vue 3/Vite、Vue Router/Pinia 自建请求缓存、PrimeVue/VeeValidate/Zod/ECharts 及质量工具共同构成长期、高迁移成本的前端工程基线，需要一份新的前端技术栈 ADR"；formalization-readiness §7 候选队列第 3 项"管理平台前端技术栈"；总体 OpenAPI 设计 §20"正式实现前至少需要 accepted ADR 覆盖：Vue 3/Vite、Vue Router/Pinia、自建请求缓存和 UI/测试技术基线"。用户已于 2026-07-28 批准整份前端技术栈设计（FE-STACK-005），本 ADR 将该已批准设计升格为正式技术决策并冻结精确版本策略与实施边界。**在用户批准（accepted）前，不得创建 `apps/console`、设计令牌、组件、依赖锁文件或进入 `writing-plans`。**

## 背景

Aurora 第一版管理平台是登录后的高交互应用，31 个页面设计（A1—D2）需要稳定深链、组织/项目作用域、复杂表格与表单、局部分区加载、`partial`/`stale`/`unavailable`、危险操作和一次性交付秘密。前端技术栈设计已于 2026-07-28 经用户整体批准（FE-STACK-005），确认方向为 Vue 3 SPA＋Vite、Vue Router＋Pinia 自建请求缓存层、PrimeVue＋VeeValidate/Zod＋受控 DataTable＋ECharts，以及精简质量工具链。但该批准是设计层批准，未锁定精确版本，也未升格为 accepted ADR。前端框架、状态方案、组件库与测试工具共同构成长期、高迁移成本工程基线，按 ADR 规范 7.2 需创建独立 ADR。

## 决策驱动因素

- **高交互客户端工作区**：没有 SEO/SSR/公开内容分发需求，纯客户端 SPA 最匹配；
- **URL 权威与状态恢复**：筛选/搜索/排序/分页/稳定选中对象以规范化 URL 为唯一权威，刷新/复制/深链可恢复；
- **权限与安全边界**：浏览器只调用正式公开 `platform-api`；路由守卫只做导航体验控制，服务端每次重新鉴权；
- **服务端状态语义**：`loading`/`empty`/`error`/`forbidden`/`processing`/`partial`/`stale`/`unavailable` 必须无损映射，不允许乐观结果伪造危险操作成功；
- **一次性秘密**：明文只在首次成功响应出现一次，不进 URL/Store/日志/截图；
- **组件与可访问性**：WCAG 2.2 AA、键盘/焦点/缩放/屏幕阅读器、颜色外状态编码；
- **团队与生态**：Vue 3 官方工具链直接支持 Vite、TypeScript、SFC 类型检查；当前没有足以抵消额外服务端运行时成本的 SSR/SEO 需求；
- **高迁移成本**：框架/状态/组件/测试基线一旦铺开，替换成本高，需要长期保留取舍依据。

## 候选方案

### 方案 A：Vue 3 SPA＋Vite＋Vue Router＋Pinia＋自建请求缓存层＋PrimeVue＋VeeValidate/Zod＋ECharts（推荐）

**行为**：Vue 3 SPA 纯客户端渲染；Vue Router 管理嵌套路由与类型化路径；Pinia 按领域拆分 domain stores 并协调自建请求/缓存层（去重、取消、过期响应丢弃、作用域清理、状态无损映射）；PrimeVue 通过 Aurora UI 包装层提供受控组件；VeeValidate/Zod 做前端即时基础校验；受控 DataTable 完全服务端模式；ECharts 按路由懒加载。

**优点**：与已批准页面高交互客户端工作区最一致；官方工具链统一（Vite/TS/SFC）；自建缓存层可精确实现 approved 的 `partial`/`stale`/`unavailable` 语义；PrimeVue 降低组件自建量；可访问性/测试链已批准。

**缺点**：自建请求/缓存层显著增加状态与一致性代码、测试和长期维护责任；不采用现成服务端状态库（TanStack Query），缓存 TTL/失效/分页策略需自行定义；PrimeVue token 化主题与业务包装层需要实现工作。

**选择结论**：推荐。

### 方案 B：React SPA＋Vite＋TanStack Query（不采用）

**行为**：React 18/19 SPA，Vite 构建，TanStack Query 处理服务端缓存。

**优点**：React 生态成熟；TanStack Query 提供现成缓存/失效/重试能力。

**缺点**：用户已于 2026-07-28 明确撤回先前短暂选择的 React 方案并最终指定 Vue 3；第一版不维护两套框架基线；TanStack Query 的服务端状态抽象与 approved `partial`/`stale`/`unavailable` 语义不完全一致；会造成已批准前端技术栈设计的反向改变。

**选择结论**：不采用。

### 方案 C：Next.js App Router / RSC（不采用）

**行为**：React 框架带前端服务端渲染运行时。

**优点**：具备 SSR/SEO 能力。

**缺点**：Aurora 管理平台没有公开内容分发/SEO 需求；引入前端服务端运行时、缓存、Cookie 转发和潜在 BFF 边界，增加安全与运维复杂度；与已批准纯客户端 SPA 方向冲突。

**选择结论**：不采用。

### 候选比较

| 维度 | A：Vue 3 SPA | B：React＋TanStack Query | C：Next.js/RSC |
|---|---|---|---|
| 与已批准设计一致 | 是 | 否（用户已撤回 React） | 否 |
| 服务端状态语义 | 自建精确映射 | 现成但语义不完全一致 | 不适用 |
| SSR/SEO 需求 | 无需求，纯客户端 | 无需求 | 引入额外运行时 |
| 安全/运维复杂度 | 低 | 低 | 高（BFF/Cookie 转发） |
| 第一版成本 | 中（自建缓存） | 中（现成缓存） | 高 |

## 最终决策

**最终选择方案 A：Vue 3 SPA＋Vite＋Vue Router＋Pinia＋自建请求缓存层＋PrimeVue＋VeeValidate/Zod＋受控 DataTable＋Apache ECharts，配合 vue-tsc/ESLint/Vitest/Vue Testing Library/MSW/Playwright/axe/Lighthouse CI 精简质量链。**

### 决定细节

1. **渲染边界**：纯客户端单页管理应用；不引入 Next.js App Router、React Server Components、SSR/SSG 或常驻前端服务端渲染运行时；
2. **主框架**：Vue 3，SFC 与 Composition API，严格 TypeScript；精确版本在实施计划锁定（实施时受支持的稳定版本），不使用浮动 `latest`；
3. **构建**：Vite 负责开发服务、代码分割和生产静态资源构建；Vite 默认构建目标不是正式浏览器承诺，浏览器矩阵由已批准测试/部署设计决定；
4. **路由**：Vue Router 管理嵌套路由、稳定路由名、路径参数和导航生命周期；路径/Query 经运行时 Schema 解析，未知/无效参数不扩大查询；
5. **状态**：Pinia 按业务领域拆分 domain stores；只协调当前身份/作用域、领域投影和请求缓存，不持久化服务端状态、权限、草稿或秘密；禁止全应用巨型 Store；
6. **请求/缓存层**：自建（不采用 TanStack Vue Query）；规范化查询键与作用域隔离、并发去重、取消、过期响应丢弃、作用域切换清理、每类 Query 的新鲜度/失效/分页策略、`loading/empty/error/forbidden/partial/stale/unavailable` 无损映射、只对幂等可重试读取使用有界重试、Command 用正式幂等/并发上下文且不做缓存重试、响应运行时校验与 RFC 9457 错误归一化、敏感字段禁止进通用 Store/日志/DevTools 快照；
7. **表单**：VeeValidate Composition API＋Zod 做前端即时基础校验；服务端仍权威校验权限、唯一性、组合规则和并发版本；
8. **组件**：PrimeVue 受支持稳定版本＋token 化主题；业务页面通过 Aurora UI 包装层使用高频控件、状态和可访问约束，不扩散 PrimeVue 私有配置；第一版单一浅色主题，不提供暗色/用户主题切换；
9. **表格**：PrimeVue DataTable 使用完全受控服务端模式；筛选/排序/分页由 Vue Router/Pinia 提供，不启用会改变口径的客户端过滤/排序/分页/总量推断；
10. **图表**：Apache ECharts 仅用于已批准 C5/C6 选中对象时序；按路由懒加载；启用适用 ARIA、颜色外编码和同口径文本摘要，不在前端聚合指标；本叶子（PLT-02 壳层）不引入 ECharts；
11. **质量工具**：`vue-tsc --noEmit`、ESLint、Vitest、Vue Testing Library、MSW（仅契约样本）、Playwright（Chromium/Firefox/WebKit 按正式矩阵）、`@axe-core/playwright`、有限 Playwright 截图基线、Lighthouse CI；第一版不引入 Storybook；
12. **依赖边界**：依赖方向为"页面 → 业务组合/领域 Store → 公开 API 客户端与契约适配"；Aurora UI 不反向依赖页面或领域 Store；管理平台前端不得导入服务端数据库行、Kysely 类型、BullMQ Job 或对象存储内部键；
13. **包与工作区**：`apps/console`（`@aurora/console`，private）；Workspace Policy 新增平台前端应用层规则（可依赖 `contract`/`tooling`，不依赖数据库/服务内部包）；精确版本与锁文件只在 ADR accepted 后由实施计划确定；
14. **本 ADR 冻结决策**：Vue 3/Vite、Vue Router/Pinia、自建请求缓存、PrimeVue/VeeValidate/Zod/ECharts 及质量工具链的整体基线；不锁定具体依赖版本、浏览器矩阵数值、性能预算数值或 CI job（这些属于 implementation-detail/requires-benchmark）。

## 结果与影响

### 正面影响

- 与已批准前端技术栈设计与 31 页高交互工作区需求一致；
- 官方工具链统一，开发/构建/部署边界简单；
- 自建缓存层可精确实现 approved 状态语义与作用域清理；
- PrimeVue/ECharts 降低组件与图表自建量；
- 单一浅色主题符合视觉语言方向。

### 负面影响与代价

- 自建请求/缓存层显著增加状态与一致性代码、测试和长期维护责任；
- 不采用现成服务端状态库，缓存 TTL/失效/分页/分页策略需自行定义并测试；
- 精确版本、浏览器/性能基准、真实参考工程缺失（requires-benchmark）；
- PrimeVue token 化主题与 Aurora UI 包装层需要实现工作。

### 未解决问题

- 精确依赖版本与兼容组合（实施计划锁定）；
- 浏览器矩阵/性能预算真实证据（requires-benchmark，TD-003）；
- 参考工程与真实部署基线（OPS-02 前置缺失）。

## 实施约束

- 浏览器只调用正式 `platform-api`；不直连数据库、Redis/BullMQ、处理存储或对象内部键；
- 路由守卫只做导航体验控制，不授权写入、不证明资源存在；后端对每个 Query/Command 重新鉴权；
- 禁止在 localStorage/sessionStorage 保存 Session Bearer Token、密码、验证码、私密令牌、Source Map 上传意图或一次性秘密；
- 危险操作不使用乐观成功；一次性秘密只在首次成功响应短暂交付；
- URL 是筛选/搜索/排序/分页/标签和稳定选中对象的权威来源；临时选择/草稿/秘密不进 URL；
- 依赖方向严格单向；Workspace Policy 边界检查强制执行；
- 严格 TypeScript；外部输入运行时校验；通用日志/错误报告/MSW fixture/Playwright trace 不得包含敏感数据。

## 迁移方案

本 ADR accepted 后：PLT-01（契约基础）先实施 → PLT-02（`apps/console` 壳层）按规格实施 → 精确版本在实施计划锁定并验证兼容。第一版单一主题，不引入多主题迁移。

## 回滚方案

- 壳层/组件实现与 `platform-api` 契约解耦（通过生成 Client 消费），可回退到静态 Preview 状态页而不破坏 ingestion-api；
- 前端制品回退不影响服务端 v1 契约；
- 未发布依赖版本可调整，但主框架/组件/状态基线替换需新 ADR。

## 验证方式

- `vue-tsc --noEmit`、ESLint、Vite production build；
- Vitest 单元测试（URL Schema、缓存状态机、错误归一化）；
- Vue Testing Library 行为测试（角色/标签/键盘路径/八类状态）；
- MSW 基于契约样本构造成功/权限/冲突/限频/partial/stale/unavailable；
- Playwright 关键流程真实浏览器（Chromium 先行）；
- axe 自动可访问性检查；
- Lighthouse CI（性能预算 requires-benchmark）；
- Workspace Policy 依赖边界检查。

## 重新评估条件

- 管理平台出现公开内容分发或 SEO 需求；
- 自建请求缓存层成本经测量不可维护且现成库语义满足 approved 状态模型；
- 新客户端形态需要不同认证/传输协议；
- 浏览器矩阵/性能基准显示 Vue 3 无法满足目标；
- 安全、隐私、法律或数据驻留要求改变公开边界。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-08：创建（proposed）

- 状态 `proposed / not-started / awaiting-user-approval`；
- 由 G09（PLT-01/PLT-02）实施门禁创建；
- 依据 approved 前端技术栈设计（FE-STACK-001—004/005）、管理平台前端架构、总体 OpenAPI 设计 §20 与 formalization-readiness §7 候选第 3 项；
- 未调用 writing-plans、未创建 `apps/console`、未安装依赖、未实施代码；
- 等待独立评审与用户正式批准，不自动批准、不实施。

### 2026-08-08：独立评审（reviewer subagent，记录用，不代替正式批准）

> 本节点记录 reviewer subagent 意见。意见只用于改进决策材料，不改变 ADR 状态。正式接受必须由用户完成。

- **前端评审**：`ACCEPT`（无 blocking finding）。ADR-025 逐条忠实形式化已批准 FE-STACK-001—004，无静默改变任何决策；候选方案 A/B/C 真实且公平比较（方案 B 的否决基于用户 2026-07-28 撤回 React 的文档化记录与 approved Vue 方向，非稻草人）；自建缓存层成本诚实评估；§7.15 检查表完整；决策范围正确延后版本/浏览器矩阵/性能预算数值。
- **架构评审（交叉）**：`ACCEPT`（无 blocking finding）。触发合法性成立；与 ADR-002/005/006、平台前端架构一致。
- **非阻断观察**：N1 决定细节 5 未复述 FE-STACK-002"客户端状态（草稿/选择/抽屉/对话框）留在页面/业务 composable 而非 Pinia"——建议实施计划补一句；N2 建议在实施计划为 `apps/console` 钉死新 Workspace 层（console 不得是 `service` 层，因 service 可依赖 data）；N3 ADR-025—028 应登记进 ADR 索引；N4 修正方案 B 标题笔误（TanStack Vue Query → TanStack Query，已修正）。
- **评审落实**：N1—N3 作为实施计划与索引同步事项记录；N4 已修正。

### 2026-08-08：用户正式批准（accepted）

- 用户已于 2026-08-08 对本 ADR 作出明确正式批准，批准范围（逐条）：
  1. 方案 A：Vue 3 SPA＋Vite＋Vue Router＋Pinia＋自建请求缓存层＋PrimeVue＋VeeValidate/Zod＋受控 DataTable＋Apache ECharts＋vue-tsc/ESLint/Vitest/Vue Testing Library/MSW/Playwright/axe/Lighthouse CI 精简质量链；
  2. 纯客户端渲染；不使用 Next.js App Router/RSC/SSR/SSG/BFF；
  3. 严格 TypeScript、SFC 与 Composition API；精确版本实施锁定时确定，不使用浮动 `latest`；
  4. 自建请求/缓存层（去重、取消、过期丢弃、作用域清理、八状态无损映射、有界重试仅限幂等读取、Command 用正式幂等/并发上下文）；
  5. PrimeVue 经 Aurora UI 包装层；单一浅色主题；受控 DataTable 全服务端模式；ECharts 仅 C5/C6 懒加载；
  6. `apps/console`（`@aurora/console`，private）＋Workspace Policy 新平台前端应用层；
  7. 本 ADR 从 proposed 转为 accepted。
- 批准仅适用于本 ADR 已记录并经过评审修订的决策范围；不得扩大 Platform Admin 权限模型、提前实现 G13、发明未批准 Query/Command、改变 G10 范围、修改 event-schema、绕过 Session/CSRF 安全约束或修改已批准 ADR 核心决策；
- 状态更新：`status: accepted`、`decision-status: accepted`、`approval-status: approved`、`implementation-status: not-started`；
- 原 proposed 历史记录完整保留（上文"创建（proposed）"、"独立评审"各节均未删除或覆盖）；
- 实施状态保持 `not-started`，直到 PLT-02 正式实施开始；本 ADR 不得在此时标记为 implemented 或 in-progress。
