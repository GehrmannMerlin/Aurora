---
title: Aurora 管理平台前端架构
status: approved
owner: platform
last-reviewed: 2026-07-30
applies-to: Aurora 第一版管理平台 SPA、路由、状态、请求、表单、组件、图表与质量边界
related:
  - ../../AURORA_RULES.md
  - ../../Aurora 架构规范.md
  - ../../Aurora 代码规范.md
  - ../../Aurora 测试规范.md
  - ../prd/platform-product-domains.md
  - platform-backend.md
  - ../testing/test-strategy.md
  - ../adr/ADR-002-five-system-boundaries.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../superpowers/specs/2026-07-28-aurora-frontend-technology-stack-design.md
  - ../superpowers/specs/2026-08-14-aurora-console-ux-ui-redesign-design.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
supersedes: none
review-cycle: frontend-stack-or-release
---

# Aurora 管理平台前端架构

## 1. 定位

本文是已批准前端技术设计的长期正式承载。页面业务细节由[完整 UX/UI 设计](../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md)维护，稳定业务域见[管理平台产品业务域](../prd/platform-product-domains.md)，公共契约与实现门禁见[总体 OpenAPI 与实现约束设计](../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)。本文不重复定义精确 OpenAPI 字段或数据库模型。

设计方向为 Vue 3 SPA＋Vite、Vue Router、Pinia 和自建请求缓存层，配合 PrimeVue、VeeValidate/Zod、受控 DataTable 与按路由懒加载的 Apache ECharts。精确版本为 `implementation-detail`；前端技术栈长期选择为 `requires-accepted-adr`。

## 2. 应用分层

| 层 | 职责 | 禁止 |
|---|---|---|
| 应用壳 | 认证/账号/工作空间/组织/项目/平台作用域、全局导航、错误边界和版本信息 | 承载领域字段或数据库模型 |
| 路由与页面编排 | URL 解析、进入条件、分区 Query、页面状态和安全返回目标 | 把 URL 当授权、跨域持久化临时选择 |
| 领域用例 | A—D 稳定业务域的 Query/Command 编排和视图模型 | 直接调用数据库/队列或复制服务端规则 |
| 请求与缓存 | 公开 API 客户端、请求去重、缓存键、取消、失效、陈旧/部分状态 | 把 Pinia 或浏览器存储当服务端权威 |
| 表单与组件 | 即时基础校验、可访问控件、表格/图表展示和危险确认 | 用前端校验替代服务端组合校验 |

领域之间通过稳定路由上下文和公开用例协作，不引用彼此页面私有状态。管理平台前端不得导入服务端数据库行、Kysely 类型、BullMQ Job 或对象存储内部键。

## 3. URL、状态与权限

- URL 是活动筛选、搜索、排序、分页、标签和稳定选中对象的权威来源；临时跨行选择不写入 URL，查询变化即清除；
- Pinia 只维护当前身份/作用域、有限客户端偏好和请求缓存协调，不复制所有服务端实体为第二权威；
- 缓存键必须包含 API 主版本、账号/组织/项目作用域和规范化 Query；作用域切换或安全状态变化清除受影响缓存；
- 路由守卫只做导航和体验控制，后端对每个 Query/Command 重新鉴权；
- `allowedActions` 只决定是否展示入口，提交时仍使用最新资源版本和服务端权限；
- 禁止在 localStorage/sessionStorage 保存 Session Bearer Token、密码、验证码、私密令牌、Source Map 上传意图或一次性秘密。

缓存 TTL、键实现和失效粒度在平台 OpenAPI 存在后定义，当前为 `deferred`。

### 3.1 机器导航与页面可达性

- `RouteTarget` 使用按 `routeId` 区分的封闭联合类型，只携带该目标允许的稳定标识与 Query，禁止任意 URL、任意路径和任意 Query Map；
- 31 个页面设计对应 36 个稳定 Route Target；A1、C8、C11 的多个稳定子路由不是新增产品页面，但每个子路由都必须具备真实入口；
- 服务端 `Navigation Context` 只投影当前主体获授权且可安全披露的入口和退出目标；前端路由注册表负责路径模板、标签、顺序、图标、父子关系、懒加载和焦点目标，不复制角色权限；
- B2 创建项目成功进入 C1；B1 选择已有 `active` 或获准查看的 `archived` 项目进入 C2；`trash`、`deleting`、`deleted` 项目只从 B8 处理；
- CI 同时校验 31 个页面设计和 36 个 Route Target，并通过真实 UI 操作证明每个目标可达；仅使用 `page.goto()` 不算消除 URL 孤岛。

## 4. Query 与 Command

Query 分区独立表示加载、成功、空、错误、无权限、部分、陈旧和不可用；主对象成功不允许被次要指标失败覆盖，次要失败也不能伪装为零或空。

Command 使用唯一业务操作上下文、幂等键和资源版本；提交期间只锁定受影响操作，不冻结整页无关区域。超时或响应丢失时先查询 Operation Result 或权威对象，不换新幂等键盲目重试。冲突清除旧危险确认并要求基于最新对象重新确认。一次性秘密只在首次成功响应短暂交付，离开后不得从缓存恢复。

总体 Header、错误、Operation、生成链和 Client 边界已经设计批准；精确领域 Schema、生成制品与机器 OpenAPI 仍为 `deferred`/absent，不得从本文编造。

## 5. 表单、表格、图表和可访问性

- VeeValidate/Zod 负责客户端即时结构校验；服务端仍权威校验权限、唯一性、组合规则和并发版本；
- DataTable 必须由受控 Query 状态驱动，服务端分页/排序不与组件本地隐式状态双轨；
- 图表只在有正式时序、分辨率、水位、采样、降级和空值契约时显示；ECharts 按路由懒加载；
- PrimeVue 组件需要统一封装焦点、错误关联、密度、主题和语义，不把视觉状态当业务枚举；
- WCAG 2.2 AA、键盘顺序、焦点恢复、缩放、屏幕阅读器和非颜色状态表达是发布门禁。

当前批准视觉语言为单一浅色 `Calm Observability`：`#101828` 深石墨窄全局栏、`#F2F4F7` 冷灰组织/项目上下文侧栏、`#F7F8FA` 浅色画布、白色工作表面、钴蓝主操作与独立语义色；内容遵循“状态 → 证据 → 行动”和平衡证据密度。正式表面禁止装饰性渐变、纹理、光晕和玻璃拟态。完整令牌、双层壳层、页面族、状态和适配边界见[Console UX/UI 全面重设计](../superpowers/specs/2026-08-14-aurora-console-ux-ui-redesign-design.md)。方向已批准，新设计代码实现和浏览器证据仍 `not-started`；当前旧壳层实现不得被误写为目标已完成。

## 6. 质量与性能

质量链采用 `vue-tsc`、ESLint、Vitest、Vue Testing Library、MSW、Playwright、axe 和 Lighthouse CI 的精简组合。测试覆盖路由/权限、URL 恢复、Query 各状态、Command 幂等/冲突/不确定结果、秘密一次性交付、真实键盘/焦点及关键浏览器。

批准预算为：初始非图表路由 gzip 不超过 300 KiB，ECharts 路由增量不超过 250 KiB 且懒加载；Lighthouse CI Performance 不低于 85、LCP 不高于 2.5s、CLS 不高于 0.1、TBT 不高于 200ms；足够样本后核心页面 INP p75 不高于 200ms。当前没有参考构建或预发布环境，全部标记 `requires-benchmark`。

## 7. 实施门禁

总体 OpenAPI、实现约束和控制台视觉语言设计已批准，但机器 Platform OpenAPI、`platform-contract`、生成 Client、稳定领域错误/Operation Schema、权限投影实现、请求缓存、设计令牌主题和组件实现仍不存在；前端技术栈与依赖检查仍需相应 accepted ADR，真实浏览器和性能基准也不存在。因此本文是 approved 架构设计，不是可直接实现的授权。首个前端增量必须先交付 Session 恢复、Route Target、路由注册表、分层壳层、作用域切换和可达性测试，并让公共壳层落实已批准视觉令牌，不能先并行制造互相独立的业务页面。
