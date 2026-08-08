---
title: Aurora 管理平台前端壳层（PLT-02）正式规格
status: draft
implementation-status: not-started
approval-status: proposed
owner: platform/frontend
created: 2026-08-08
last-reviewed: 2026-08-08
applies-to: apps/console（@aurora/console）Vue 3 SPA 真实壳层、Vue Router、Session Context 消费边界、Navigation Context、RouteTarget 映射、分层侧栏/顶栏、页面状态基础与真实浏览器可达性
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
  - ../architecture/platform-contract-foundation.md
  - ../architecture/formalization-readiness.md
  - ../superpowers/specs/2026-07-28-aurora-frontend-technology-stack-design.md
  - ../superpowers/specs/2026-07-30-aurora-console-visual-language-design.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../prd/platform-product-domains.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: frontend-shell-router-or-accessibility-change
---

# Aurora 管理平台前端壳层（PLT-02）正式规格

## 1. 定位、效力与当前状态

本文冻结管理平台前端壳层第一增量（PLT-02）的正式规格。它把已批准前端技术栈（FE-STACK-001—004）、控制台视觉语言、总体 OpenAPI 与实现约束设计的"应用壳先行"门禁（§15.1）落实为真实 Vue 3 SPA 壳层：Session Context 消费边界、Navigation Context、RouteTarget 映射、Vue Router 注册表、分层顶栏/侧栏、内容出口、页面状态基础与真实浏览器可达性。

**当前状态**：本文为 `draft`。正式实施受以下门禁约束：PLT-01（契约基础）独立通过、required ADR（ADR-025 前端技术栈、ADR-026 后端运行时、ADR-027 契约生成、ADR-028 Session/CSRF）accepted、控制台视觉语言已批准。在 PLT-01 未通过或 ADR 未 accepted 前，不得创建 `apps/console` 正式代码、主题令牌、组件或进入 `writing-plans`。

**声明边界**：本文冻结的是**真实 SPA 壳层**，不是完整管理平台。G09 不实现 A1—A5 身份业务、B1—B8 组织治理、C1—C16 业务页面或 D1/D2 页面。后续模块页面只以明确 `unavailable`/`blocked`/`forbidden` 状态表示，禁止 mock 数据、伪造登录、假用户、假项目、假图表或 lorem ipsum 冒充已实现功能。

## 2. 目标与非目标

### 2.1 目标

1. 让 `https://aurora.ah.cn` 从静态 Preview 状态页演进为真实 Aurora Vue SPA 管理平台壳层；
2. 落实"应用壳先行"门禁：Session 恢复、Route Target 解析、Vue Router 注册表、顶栏和分层侧栏、作用域切换、权限/生命周期安全退出、统一 API Client、错误映射和 Query 基础状态；
3. 建立 Session Context、Navigation Context、RouteTarget 的真实契约消费者边界；
4. 落实批准视觉令牌（浅色内容区、深石墨顶栏、纯色琥珀橙侧栏、深色前景、中高信息密度、禁止渐变）；
5. 建立 loading/error/forbidden/unavailable/not-found 等真实状态基础与真实浏览器可达性门禁。

### 2.2 非目标

- 不实现 G10 身份业务（注册/登录/密码/邀请/账号安全）；
- 不实现 G11/G12/G13 业务页面（Issue/请求/性能/发布/Source Map/告警/访问/设置/通知/资源策略）；
- 不建立 mock 数据让用户误以为后端功能存在；
- 不伪造登录成功、用户、Session、Organization、Project、Issue、Request、Performance、Alert、Notification、Usage、PlatformAdmin 或 API 响应；
- 不实现 `platform-api`、`platform-worker`、数据库、Redis/BullMQ 或对象存储；
- 不引入 Storybook、暗色主题、用户主题切换或外部 Web Font。

## 3. 技术基线（来自 approved FE-STACK，精确版本待 ADR-025 accepted 后锁定）

| 能力 | 已确认选择 | 本叶子实际使用 |
|---|---|---|
| 主框架 | Vue 3 SPA＋Vite（SFC + Composition API，严格 TypeScript） | 是 |
| 路由 | Vue Router（嵌套路由、稳定路由名、类型化路径） | 是 |
| 状态 | Pinia 按领域拆分的 domain stores（自建请求/缓存层） | 是（Session/Scope/Navigation 基础） |
| 表单 | VeeValidate/Zod | 本叶子仅基础（壳层无复杂表单） |
| 组件 | PrimeVue＋Aurora UI 包装层 | 是（壳层基础控件） |
| 表格/图表 | 受控 DataTable / ECharts 懒加载 | 本叶子不使用（无业务列表/图表） |
| 测试 | vue-tsc/ESLint/Vitest/Vue Testing Library/MSW/Playwright/axe/Lighthouse CI | 是（本叶子适用子集） |

本叶子只安装实际使用的依赖；YAGNI。精确版本在实施计划中锁定并验证兼容，不使用浮动 `latest`。

## 4. 应用分层（来自 approved platform-frontend.md）

| 层 | 职责 | 禁止 |
|---|---|---|
| 应用壳 | 认证/账号/工作空间/组织/项目/平台作用域、全局导航、错误边界和版本信息 | 承载领域字段或数据库模型 |
| 路由与页面编排 | URL 解析、进入条件、分区 Query、页面状态和安全返回目标 | 把 URL 当授权、跨域持久化临时选择 |
| 领域用例 | A—D 稳定业务域的 Query/Command 编排（本叶子仅 Session/Scope/Navigation） | 直接调用数据库/队列或复制服务端规则 |
| 请求与缓存 | 公开 API 客户端、请求去重、缓存键、取消、失效、陈旧/部分状态 | 把 Pinia 或浏览器存储当服务端权威 |
| 表单与组件 | 即时基础校验、可访问控件、表格/图表展示和危险确认（本叶子仅壳层控件） | 用前端校验替代服务端组合校验 |

管理平台前端不得导入服务端数据库行、Kysely 类型、BullMQ Job 或对象存储内部键；只能通过生成 Client 调用 `platform-api` 公开操作。

## 5. Session Context boundary

### 5.1 契约消费者

- Session Context 是 `identityGetSession`（PLT-01 冻结的公开契约）的**消费者边界**；本叶子不实现 Session backend，只实现安全消费。
- 前端不保存或读取长期凭据；Session 通过 HttpOnly Cookie 建立（后端实现后），前端从安全 Session Query 读取当前账号安全摘要、认证/生命周期状态、CSRF 令牌与 Navigation Context 读取目标。

### 5.2 安全状态（本叶子真实行为）

由于真正 Session backend 尚未实现（属于 G10），PLT-02 的 Session Context 在初始状态进入 approved 的 **unauthenticated / unavailable** 安全状态：

- 不 hardcode `authenticated=true`；
- 不 fake user、不 fake session、不 localStorage fake session、不把凭据写入 Pinia；
- 不 fake organization、不 fake project；
- 当 `identityGetSession` 不可用/未实现时，壳层显示明确 `unavailable`（认证能力未提供）状态，并保留向认证流程的入口占位（不伪造登录成功）；
- 受保护路由在无 Session 时进入安全的 unauthenticated 处理（重定向到登录入口或显示认证不可用状态），不泄露受保护内容存在性。

### 5.3 Session 失败语义

- Session 缺失/过期/撤销：安全登录目标（本叶子为认证入口/不可用状态）；
- Session Redis 权威不可用：503 → `unavailable` 失败关闭，不伪装 401 或未登录；
- 权限撤销但 Session 有效：安全 403/404；
- Session 相关错误不进入 URL、日志或可复用快照。

## 6. Navigation Context

- `navigationGetContext`（PLT-01 冻结的公开契约）是 Navigation Context 的**消费者边界**。
- 本叶子在 Navigation Context 不可用时进入安全的 scope 空状态：顶栏/侧栏不伪造组织/项目入口；当前作用域为"未选择/不可用"。
- 服务端 Navigation Context 只投影当前主体获授权且可安全披露的入口和退出目标；前端路由注册表负责路径模板、标签、顺序、图标、父子关系、懒加载和焦点目标，**不复制角色权限**。
- 作用域切换（工作空间/组织/项目）清除旧缓存、选择和危险确认；本叶子实现 scope 切换的壳层骨架与清理语义，不实现具体组织/项目选择业务（G10/G11）。

## 7. RouteTarget mapping

- 36 个稳定 RouteTarget 的**封闭联合类型与参数/Query Schema** 由 PLT-01 契约冻结；前端路由注册表从契约类型映射路径模板。
- 每个 RouteTarget 至少声明：`routeId`、路径模板、作用域（公开/账号/工作空间/组织/项目/平台）、一级菜单或子路由、父路由与面包屑来源、参数和 Query Schema、页面懒加载入口、无效参数和目标失效的安全处理、可访问性焦点目标。
- 注册表不得包含角色判断或服务端资源存在性推断。
- **"全部 RouteTarget 可达性"** 不是所有业务页面已实现，而是：RouteTarget 契约与导航壳层能正确解析/保护/表示对应目标，且不通过手输隐藏 URL 才能进入。
- **可达性执行（approved 门禁）**：每个由壳层实际渲染的导航入口（顶栏、组织/项目侧栏、作用域切换入口、D1/A5 入口骨架）必须由真实 UI 操作（点击/键盘）到达目标，并由 Playwright 真实浏览器交互断言；仅 `page.goto()` 直达不满足可达性门禁（UX/UI §12.9、总体 OpenAPI §17.5、平台前端架构 §3.1）。未由壳层渲染的业务页面（G10—G13）在该门禁内以"目标可解析/保护/表示＋明确 unavailable/blocked"验收，不要求其业务内容已实现。

## 8. 未实现页面处理

- G10/G11/G12/G13 业务页面的 RouteTarget **可以**存在，但实际 content 必须使用明确状态：
  - `feature unavailable`（能力未提供）；
  - `dependency unavailable`（依赖/Query 不存在）；
  - `permission unavailable`（无权/未认证）；
  - `not-found`。
- 不得出现 fake table、fake chart、fake issue、fake project、fake usage、fake alert；不能用 lorem ipsum；不能用空数组/全零数据/禁用按钮/“敬请期待”冒充实现。

## 9. 首页/根路由行为

- 不凭空猜根路由；从 RouteTarget 契约与 Session 状态决定：
  - 未认证：认证入口 / 认证不可用状态；
  - 已认证（后端存在后）：workspace 目标；
  - 后端不可用：`unavailable` 状态。
- 本叶子阶段（Session backend 未实现）：aurora.ah.cn 展示真实 Aurora application shell + authentication-unavailable 状态，**不能**继续显示旧 "Backend Public Preview Status Page" 作为最终 G09 UI，**也不能**假装用户已登录。

## 10. 真实 SPA shell（最少实现集）

- application bootstrap（Vite 入口、Pinia、Router、全局错误处理）；
- Vue Router（嵌套、懒加载、类型化路径、History 模式）；
- Session Context consumer；
- Navigation Context consumer（或安全空状态）；
- RouteTarget 映射与路由注册表；
- 顶栏（工作空间/组织/项目切换入口、通知入口、账号入口——仅入口骨架，不实现 G10 业务）；
- 分层侧栏（组织上下文/项目上下文入口，仅已批准层级，业务入口在未实现时为 unavailable/入口骨架）；
- content outlet（RouterView + 页面状态出口）；
- global loading（仅 Session/scope/base 权限恢复，不覆盖独立页面加载）；
- route error / retryable error 页；
- forbidden 页（不泄露存在性）；
- unavailable 页（能力未提供/依赖不可用/安全原因）；
- not-found 页；
- stable page title；
- focus management（导航后聚焦页面标题/错误摘要，键盘顺序与视觉顺序一致）；
- keyboard accessibility（WCAG 2.2 AA 方向，axe 自动检查 + 人工键盘/焦点）；
- responsive minimum（窄屏顶栏/侧栏收为可关闭 Drawer，同一琥珀橙纯色与同一入口顺序）。

## 11. 视觉语言合规

必须遵守 approved 控制台视觉语言：

- 浅色内容区（`#F8FAFC`）、白色工作表面（`#FFFFFF`）；
- 深石墨顶栏（`#111827`，前景 `#F8FAFC`）；
- 纯色琥珀橙侧栏（`#D47A16`，前景 `#17120D`）；当前路由浅奶油选中行背景（`#FFF4DC`）＋选中行前景（`#172033`）＋左侧蓝色 3px 标识（`#1D4ED8`）；
- 默认边界（`#CBD5E1`）用于控件和分区的 1px 边界；
- 深色前景（`#111827`）/辅助文字（`#475569`）；
- 主操作蓝 `#2563EB`、异常红 `#D92D20`、成功绿 `#15803D`；
- 中高信息密度；基础间距 4/8/12/16/24/32px；常规控件 40px、主导航 44px；圆角 6px 基线；系统无衬线字体栈（`system-ui`、`Segoe UI`、`PingFang SC`、`Microsoft YaHei`）；
- **禁止渐变**：侧栏及正式表面 `background-image: none`，无纹理、噪点、光晕、玻璃拟态、半透明叠色或模拟灯光明暗；只有 Dialog/Drawer/Popover 等真实浮层可用统一轻量阴影；
- 不重新设计品牌方向；不采用大面积渐变、随机蓝紫 SaaS 模板、过度卡片化、巨大留白 landing-page 风。

低风险尺寸/spacing/hover/detail 可由 Agent 按批准方向直接收口并同步；业务、权限、导航层级、契约不得借视觉实现改变。

## 12. 测试

### 12.1 适用工具

Vitest、Vue Testing Library、MSW（正式契约驱动）、Playwright、axe、Lighthouse CI（smoke）。MSW 只用于前端测试，不作为真实 backend implementation evidence。

### 12.2 覆盖

- bootstrap（应用启动、Pinia/Router 初始化）；
- router（嵌套、懒加载、类型化路径、History 模式）；
- RouteTarget（36 个 routeId 的注册表映射、参数/Query Schema、非法参数安全处理）；
- navigation（顶栏/侧栏入口、active 状态、作用域切换清理）；
- unauthorized / unauthenticated / unavailable / 404；
- keyboard、focus（导航后焦点恢复、焦点环）；
- axe（自动可访问性检查）；
- responsive shell（窄屏 Drawer）；
- no fake data（断言无 mock 产品数据作为生产 UI）；
- generated client consumption（壳层通过生成 Client 描述请求，不手写 fetch）；
- request cancellation（如适用）；
- route/query authority semantics（URL 不是授权；路由守卫只做导航体验控制）；
- **reachability enforcement（approved 门禁，Playwright 真实浏览器）**：每个壳层实际渲染的导航入口（顶栏、组织/项目侧栏、作用域切换入口、D1/A5 入口骨架）通过真实 UI 点击/键盘操作到达目标并断言目标路由正确；测试显式排除"仅 `page.goto()` 直达"作为通过证据；未由壳层渲染的业务目标（G10—G13）断言其解析/保护/表示与明确 unavailable/blocked 状态。

### 12.3 禁止

- 不得用 MSW 冒充真实 backend 证据；
- 不得删除或弱化失败测试来恢复 CI；
- 关键流程必须有真实浏览器（Playwright Chromium）证据。

## 13. 构建、包与工作区

- `apps/console`（包名 `@aurora/console`，private）创建为真实可部署 SPA；Vite 生产构建输出 hashed static assets；
- Vite 生成按路由分割的静态 SPA 资源；ECharts 等重依赖不在本叶子引入；
- 精确依赖版本在实施计划锁定（Vue/Vite/Router/Pinia/PrimeVue/VeeValidate/Zod/Vitest/Vue Testing Library/MSW/Playwright/@axe-core/playwright 等），不使用浮动 `latest`；
- Workspace Policy 需要新增平台前端规则（`console` 应用层可依赖 `contract`/`tooling`；不依赖数据库/服务内部包）；
- 生产 Source Map 如果设计禁止公开：不得通过 Preview 静态目录意外暴露。

## 14. Preview serving 集成

PLT-02 完成后，当前 Public Preview 必须从静态 Preview Status Page 切换为真实 built Vue SPA。Preview 部署需要根据当前部署架构最小修改：

- Docker/asset build（或等价静态产物）支持 SPA 构建产物；
- nginx/static serving：`aurora.ah.cn` vhost 改为服务 SPA 构建产物；
- SPA history fallback：`try_files $uri /index.html`（对非 API 路径）；
- cache headers：hashed static assets → 可缓存；`index.html` → no-cache / 短缓存，避免旧 HTML 指向不存在 chunk；
- API routing future boundary：`ingest.aurora.ah.cn` 继续只服务 ingestion-api，不被改变；
- no source map leak；
- health/smoke：`aurora.ah.cn` 200 + SPA 内容；`ingest.aurora.ah.cn/v1/batches` 未认证 401。

实际 SPA serving 改造属于 PLT-02 实施计划与部署集成任务；本规格冻结边界与门禁。

## 15. Session backend 未实现的受限完成

必须区分：

- **Session semantics/contract 未 formalized**：阻塞 G09。若 PLT-01 契约、ADR-028 未冻结 Session/CSRF 传输契约，不得进入壳层实现；
- **Session backend implementation 尚未完成**：如果 approved G09 规格明确允许 shell 以安全 unauthenticated/unavailable state 工作，则可以完成 shell；不得假装登录成功。

本规格属于后者场景：PLT-01/ADR-028 冻结 Session/CSRF 契约形状后，PLT-02 以安全 unauthenticated/unavailable state 完成壳层，不实现 G10 身份业务。如果权威文档要求真实 Session backend 才能验收 PLT-02，按权威文档停止；不得为完成 G09 降低门禁。

## 16. 排除（不开始 G10）

即使 G09 成功，不自动实现 PLT-03/PLT-04/SEC-01（G10）、PLT-05/PLT-06（G11）、PLT-07/PLT-08（G12）、PLT-09/PLT-10（G13）。只在最终报告建议下一组。

## 17. 完成定义

PLT-02 完成当且仅当：

1. `apps/console` 真实 Vue 3 SPA 存在：bootstrap、Vue Router、Pinia、Session Context consumer、Navigation Context（或安全空状态）、RouteTarget 映射、顶栏、分层侧栏、content outlet、全局 loading、route error、forbidden、unavailable、not-found、stable page title、focus management、keyboard、responsive minimum 全部真实；
2. Session Context 安全：无 fake user/session、无 localStorage fake session、无 Pinia 凭据、无 fake org/project；Session backend 未实现时进入 approved unauthenticated/unavailable 状态；
3. Navigation Context 消费契约，不复制角色权限，作用域切换清理语义真实；
4. 36 个 RouteTarget 全部在注册表声明并映射；未实现业务目标可解析/保护/表示，且不通过手输隐藏 URL 才能进入；
5. 后续模块页面只显示 feature/dependency/permission unavailable 或 not-found，无 fake data/lorem ipsum；
6. 视觉语言合规：浅色内容区、深石墨顶栏、纯色琥珀橙侧栏（`#D47A16`）、选中行前景 `#172033`、边界 `#CBD5E1`、深色前景、中高信息密度、禁止渐变；令牌不散落页面；
7. 测试覆盖 bootstrap/router/route-target/navigation/unauthorized/unauthenticated/unavailable/404/keyboard/focus/axe/responsive/no-fake-data/client-consumption/reachability；**每个壳层渲染的导航入口经真实 UI 操作到达（Playwright 交互断言，非 `page.goto()` 直达）**；Playwright 真实浏览器通过；axe 通过；
8. 构建：`vue-tsc`、ESLint、Vite production build 通过；`index.html` no-cache、assets 可缓存；
9. Preview serving 从静态状态页切换为真实 built SPA，`ingest.aurora.ah.cn` 回归不破坏；
10. 不包含 G10 身份业务、无 mock 产品数据、无数据库/队列直连；
11. 独立验收通过且叶子计数按正式规则更新。

## 18. 规格自检

| 检查项 | 结果 |
|---|---|
| 是否改变 approved PRD/架构/视觉语言 | 否；全部来自已批准 FE-STACK、视觉语言、总体 OpenAPI、UX/UI |
| 是否虚构实现 | 否；壳层、入口、状态均标为待实施；无 mock 数据/伪造登录 |
| Session 是否安全 | 是；unauthenticated/unavailable 安全状态，不造假 |
| 是否覆盖 36 RouteTarget 可达性 | 是；注册表 + 可达性测试，不允许仅手输 URL |
| 是否实现 G10 | 否；明确排除 |
| 是否需要 ADR | 是；ADR-025/026/027/028 未 accepted 且 PLT-01 未通过前不得实施 |
| 是否进入 writing-plans | 否；PLT-01 通过 + ADR accepted 且用户批准后才进入 |

## 19. 评审记录

### 2026-08-08：独立评审（reviewer subagent，记录用，不代替正式批准）

> 本节点记录 reviewer subagent 意见。意见只用于改进设计材料，不改变本规格的 draft 状态。正式批准必须由用户完成。

- **前端评审**：`ACCEPT-WITH-REVISIONS`（无正确性阻断）。壳层先行范围、Session 安全、视觉语言映射正确；ADR-025 忠实形式化 FE-STACK-001—004 无静默改变。
  - **Load-bearing finding R1**：可达性门禁执行不足——"每个壳层渲染导航入口经真实 UI 操作到达、仅 `page.goto()` 不满足"未在测试/验收中显式编码。修正：本规格 §7、§12.2、§17 已落实 reachability enforcement（Playwright 真实浏览器交互断言，显式排除 page.goto-only）。
  - **Load-bearing finding R2**：视觉令牌精度——选中行前景应为 `#172033` 而非泛"深色前景"，且补 `#CBD5E1` 边界令牌。修正：§11、§17 已落实。
- **安全评审（交叉）**：PLT-02 §5 的 unauthenticated/unavailable 状态安全成立；无 blocking finding；N1 壳层 unavailable 状态不得被任何路由守卫当作 authenticated；N2 壳层在 G09 期间不得发出任何 cookie/token（本规格已隐含）。
- **评审落实**：R1/R2/N1/N2 已落实（见 §7/§11/§12.2/§17）。
