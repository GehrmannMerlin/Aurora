---
title: ADR-028：管理平台 Session、CSRF 与认证传输契约
status: proposed
decision-status: proposed
implementation-status: not-started
approval-status: awaiting-user-approval
owner: platform/security
date: 2026-08-08
last-reviewed: 2026-08-08
applies-to: 管理平台浏览器认证传输契约：不透明 HttpOnly Cookie Session、同步 CSRF 令牌、Origin/Fetch Metadata 校验、identityGetSession 契约形状、Session 失败语义、认证级别枚举；物理参数（Argon2id、SameSite/期限、Redis 拓扑、KMS、内部能力令牌）由后续安全评审与 G10 门禁承载
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/security/account-deletion-and-data-lifecycle.md
  - ../../docs/architecture/platform-backend.md
  - ../../docs/architecture/platform-frontend.md
  - ../../docs/architecture/platform-contract-foundation.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md
  - ../../docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../../docs/superpowers/specs/2026-07-28-aurora-frontend-technology-stack-design.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
superseded-by: none
---

# ADR-028：管理平台 Session、CSRF 与认证传输契约

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-user-approval
- 日期：2026-08-08
- Owner：platform/security
- 适用范围：管理平台浏览器认证传输契约——不透明 HttpOnly Cookie Session、同步 CSRF 令牌、Origin/Fetch Metadata 校验、`identityGetSession` 公开契约形状、Session 失败语义、认证级别枚举（public/intent/session/recent-verification）；**物理参数**（Argon2id 数值、Cookie SameSite/期限、Redis Session 拓扑/持久化/淘汰、KMS/签名算法、内部能力令牌）由后续安全评审与 G10 门禁承载，不在本 ADR 冻结
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) §4.1—4.3、§13
- 关联安全规则：[账号注销与数据生命周期](../../docs/security/account-deletion-and-data-lifecycle.md)（approved，A5-001—011）
- 关联技术方案：[平台后端设计](../../docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md)（approved，BACKEND-003=B）、[总体 OpenAPI 与实现约束设计](../../docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)（approved，§11）、[前端技术栈设计](../../docs/superpowers/specs/2026-07-28-aurora-frontend-technology-stack-design.md)（approved，§5）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-08 创建为 `proposed`。创建依据：G09（PLT-01/PLT-02）实施门禁；formalization-readiness §7 候选队列第 7 项"Session、CSRF 与内部能力令牌"；formalization-readiness §8 缺口第 3 项"Session/Cookie/CSRF/密码/内部令牌参数"；总体 OpenAPI 设计 §11"精确 Cookie、SameSite、期限、密码参数和密钥托管仍需安全 ADR"；平台后端设计 §16"Redis 权威 Session、Cookie/CSRF 和内部短期能力令牌的安全架构"；§7.3 "Redis Session 不可用时受保护 API 失败关闭，产生去敏安全指标"。用户已于 2026-07-28 确认后端设计 BACKEND-003=B（Redis 权威不透明 Session＋同步 CSRF；PostgreSQL 账号安全事实；短期内部能力令牌）。**本 ADR 只冻结公开传输契约形状（供 PLT-01 契约与 PLT-02 壳层安全消费）；物理安全参数与基础设施组合保持 deferred/requires-accepted-adr，属于 G10 身份业务门禁。** 在用户批准（accepted）前，不得创建 Session 后端、Cookie/CSRF 实现、Redis 基础设施或进入 `writing-plans`。

## 背景

Aurora 管理平台浏览器通过公开 `platform-api` 使用服务端能力。认证必须满足：浏览器凭据不暴露给 JS（HttpOnly）、不进入 URL/localStorage/日志；Session 活动状态服务端权威；非安全方法受 CSRF 保护；Redis Session 权威不可用时失败关闭（503），不伪装 401；A5 注销受理后全部 Session 立即终止。平台后端设计已确认 BACKEND-003=B。但公开传输契约形状（`identityGetSession` 返回什么、Session 失败语义、认证级别枚举、CSRF 传输方式）需要冻结，供 PLT-01 契约与 PLT-02 壳层安全消费；物理参数（Argon2id、SameSite、期限、Redis 拓扑、KMS、内部能力令牌）属于后续安全评审与 G10 门禁。Session/CSRF 安全架构是高迁移成本、高风险长期决策，按 ADR 规范 7.2 需创建独立 ADR。

## 决策驱动因素

- **浏览器凭据不暴露**：HttpOnly Cookie，不进入 JS/URL/localStorage/日志/前端持久 Store；
- **服务端权威 Session**：活动状态服务端权威；Session 只证明认证，不固化组织/项目角色或允许操作；
- **CSRF 防护**：有状态 Session 使用同步 CSRF 令牌；同时校验 Origin/Fetch Metadata；
- **失败关闭**：Redis Session 权威不可用时受保护请求失败关闭（503），不伪装未登录，不跳过 Session 校验；
- **A5 兼容**：注销受理后全部 Session 终止；密码重置撤销全部 Session；
- **公开契约形状先行**：PLT-01/PLT-02 需要可消费的 Session/CSRF 契约形状，但物理实现属于 G10；
- **高迁移成本**：认证安全架构一旦上线，替换成本高，需要长期保留取舍依据。

## 候选方案

### 方案 A：Redis 权威不透明 Session＋同步 CSRF＋HttpOnly Cookie（推荐，BACKEND-003=B）

**行为**：浏览器持有高熵随机不透明 Session ID（HttpOnly、Secure、无 Domain 的主机限定 Cookie）；活动 Session、CSRF 绑定材料、轮换/撤销状态由隔离的 Redis 权威保存；账号状态/密码摘要/安全版本在 PostgreSQL；SPA 从 `identityGetSession` 获取 CSRF 令牌并在非安全方法自定义 Header 提交；同时校验 Origin/Fetch Metadata；Redis 不可用时 503 失败关闭。

**优点**：服务端可即时撤销/轮换 Session；不透明 Session 无 JWT 重放窗口；同步 CSRF 简单可靠；与 BACKEND-003=B 一致；Redis TTL 天然支持空闲/绝对期限；密码重置/A5 注销可批量撤销。

**缺点**：Redis 成为认证关键基础设施，需持久化/复制/故障转移/禁止淘汰/恢复演练；多一层运行依赖；Redis 故障时受保护请求失败关闭（可接受的安全代价）。

**选择结论**：推荐。

### 方案 B：数据库权威 Session（不采用）

**行为**：Session 记录保存在 PostgreSQL，随账号安全事实同库。

**优点**：无 Redis 运行依赖；恢复路径清晰；与账号事务一致。

**缺点**：用户已选择 Redis 权威 Session（BACKEND-003=B）；数据库 Session 在共享访问/即时撤销/TTL 管理上不如 Redis；A5/密码重置的批量撤销需要更多查询；与已批准后端设计冲突。

**选择结论**：不采用。

### 方案 C：短 JWT＋服务端撤销存储（不采用）

**行为**：短期 JWT 认证，服务端维护撤销列表。

**优点**：无状态验证；适合多客户端。

**缺点**：JWT 在浏览器存储/传输暴露面复杂；撤销需要额外撤销存储；浏览器 Bearer Token 与 HttpOnly Cookie 方向冲突；与已批准 BACKEND-003=B 冲突。

**选择结论**：不采用。

### 候选比较

| 维度 | A：Redis Session | B：数据库 Session | C：JWT＋撤销 |
|---|---|---|---|
| 即时撤销 | 是 | 是（查询成本） | 需撤销存储 |
| 运行依赖 | Redis | 无 | 撤销存储 |
| 与 BACKEND-003=B 一致 | 是 | 否 | 否 |
| 浏览器暴露面 | HttpOnly Cookie 最小 | 同左 | JWT 暴露面复杂 |
| 故障语义 | 失败关闭 503 | 同左 | 需撤销存储可用性 |

## 最终决策

**最终选择方案 A：Redis 权威不透明 Session＋同步 CSRF＋HttpOnly Cookie（BACKEND-003=B）。本 ADR 只冻结公开传输契约形状，不冻结物理参数。**

### 决定细节（本 ADR 冻结的是契约形状，不是物理实现）

1. **浏览器凭据**：高熵随机、无业务含义的不透明 Session ID；只通过 `Secure`、`HttpOnly`、无 `Domain` 的主机限定 Cookie 发送；不进入 URL、localStorage、日志或前端持久 Store；Cookie 值本身是凭据，前端永远不读取；
2. **Session 权威**：活动 Session、空闲/绝对期限、CSRF 绑定材料、轮换与撤销状态由隔离的 Redis 权威保存；Redis 数据丢失或不可用时受保护请求失败关闭（503），不从 PostgreSQL 猜测恢复仍有效 Session；
3. **账号权威**：账号状态、密码摘要、安全版本和影响 Session 的持久安全事实保存在 PostgreSQL；Session 只证明当前认证，不固化组织/项目角色或允许操作；
4. **`identityGetSession` 契约形状**（供 PLT-01 冻结）：当前账号安全摘要、Session 到期与轮换所需安全信息、CSRF 令牌、当前认证/账号生命周期状态、Workspace/Navigation Context 的获授权读取目标；不返回密码摘要、Session ID、Cookie 值、完整角色缓存、私密令牌或内部能力令牌；
5. **CSRF 传输**：同步 CSRF 令牌，与 Session 绑定；SPA 从安全 Session Query 获取，在非安全方法（POST/PATCH/DELETE）自定义 Header 中提交；同时校验 Origin/目标 Origin 与适用 Fetch Metadata；Cookie 凭据 CORS 只允许显式受控来源，禁止通配符；令牌不进入 URL 或日志；
6. **认证级别**：注册表声明 `public`/`intent`/`session`/`recent-verification`；验证、重置、邀请链接的 GET 只建立短期 HttpOnly 意图并清理原始令牌，最终写入由受 CSRF 保护的 Command 完成；
7. **Session 失败语义**：Session 缺失/过期/撤销 → 统一 401 并提供安全登录目标；Session Redis 不可用 → 503，受保护操作失败关闭；权限撤销但 Session 有效 → 重新鉴权后安全 403/404；
8. **A5/密码重置兼容**：密码重置和 A5 注销受理按已批准规则撤销相应 Session（A5 受理后全部 Session 立即终止）；
9. **内部能力令牌**：只定义边界——`platform-api` 使用工作负载身份连接下游并为单次调用签发短期能力令牌，令牌限定目标服务、资源、动作、调用主体和操作关联，不包含浏览器 Cookie、密码、完整邮箱或无关角色列表；不转发浏览器 Cookie；精确算法/密钥托管/KMS 由后续安全评审与 G10 门禁承载；
10. **本 ADR 不冻结**：Argon2id 数值（内存/迭代/并行度/Pepper）、Cookie SameSite/期限精确值、Session 空闲/绝对期限数值、Redis 拓扑/持久化/复制/淘汰策略、签名算法/密钥托管/工作负载身份传输、`recent-verification` 的触发规则。以上属于 G10 身份业务门禁与安全评审。

## 结果与影响

### 正面影响

- 浏览器凭据暴露面最小（HttpOnly、不透明）；
- 服务端可即时撤销/轮换 Session；
- 同步 CSRF 简单可靠；Origin/Fetch Metadata 双校验；
- Redis 故障失败关闭（503）符合安全关闭原则；
- 与 BACKEND-003=B 一致；PLT-01/PLT-02 可获得安全契约形状。

### 负面影响与代价

- Redis 成为认证关键基础设施，需持久化/复制/故障转移/禁止淘汰/恢复演练；
- 多一层运行依赖；
- Redis 故障时受保护请求失败关闭（503），影响可用性（安全优先）；
- 物理参数（SameSite/期限/密码参数/Redis 拓扑）仍未锁定，属于 G10 门禁。

### 未解决问题

- Argon2id 精确数值、Cookie SameSite/期限、Session 期限（G10 安全评审）；
- Redis Session 拓扑/持久化/复制/淘汰/监控（G10 基础设施 ADR）；
- 签名算法/密钥托管/KMS（G10 安全评审）；
- 内部能力令牌精确格式与轮换（G10 安全评审）；
- `recent-verification` 精确触发规则（由正式安全规则决定）。

## 实施约束

- 浏览器只通过 HttpOnly Cookie 建立 Session；前端不读取或保存长期凭据；
- 所有状态改变请求遵循正式 CSRF 契约；站内继续目标只允许白名单安全路由（RouteTarget）；
- Redis Session 权威不可用时受保护请求失败关闭（503），不伪装 401，不降级为跳过 Session 校验；
- Session 不保存密码、私密令牌、客户端密钥明文、完整邀请/重置令牌或长期下游能力令牌；
- 密码重置与 A5 注销按已批准规则撤销相应 Session；
- 内部能力令牌限定目标服务、资源、动作、主体与操作关联，不转发浏览器 Cookie；
- 日志、错误报告、MSW fixture、Playwright trace 不记录 Cookie、Session ID、CSRF 令牌、密码或令牌明文；
- 验证、重置、邀请原始令牌只在客户端短暂交换，服务端保存摘要；日志和 Referrer 不得包含原始令牌值；必要时消费后重定向清除地址栏令牌。

## 迁移方案

本 ADR accepted 后：PLT-01 冻结 `identityGetSession`/CSRF 传输契约形状与认证级别枚举 → PLT-02 壳层以安全 unauthenticated/unavailable 状态消费 → G10 实施 A1—A5 身份业务时落实物理 Session 后端、Cookie/CSRF 实现与 Redis 基础设施（另需基础设施 ADR 与安全评审）。

## 回滚方案

- 契约形状阶段：Session/CSRF 契约尚未被消费者使用时，可调整契约形状并保留设计记录；
- 物理实现阶段（G10）：Session 后端与业务 handler 解耦；Redis 故障失败关闭保证安全；回滚需遵守账号/组织数据与审计边界；
- A5 删除/撤销不可回滚（按正式 A5 规则）。

## 验证方式

- 契约级：`identityGetSession` 返回字段、认证级别枚举、Session 失败语义、CSRF 传输在 PLT-01 契约测试中冻结并验证；
- 壳层级：PLT-02 断言 unauthenticated/unavailable 安全状态、无 fake session/user、无凭据持久化；
- 物理实现（G10 后）：集成测试覆盖 Session 缺失/过期/撤销 401、Redis 不可用 503、权限撤销 403/404、CSRF 校验、Origin/Fetch Metadata 校验、A5/密码重置撤销；
- 全仓质量门禁与安全评审。

## 重新评估条件

- 新客户端形态需要不同认证/传输协议；
- Redis 认证关键基础设施无法达到可靠性/成本目标；
- 浏览器凭据暴露面或撤销/轮换需求变化；
- 安全、隐私、法律或数据驻留要求改变认证边界；
- 内部能力令牌治理无法满足即时撤销要求且有高可用授权服务方案。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-08：创建（proposed）

- 状态 `proposed / not-started / awaiting-user-approval`；
- 由 G09（PLT-01/PLT-02）实施门禁创建；
- 依据 approved 平台后端设计 BACKEND-003=B、总体 OpenAPI 设计 §11、前端技术栈设计 §5、formalization-readiness §7 候选第 7 项与 §8 缺口第 3 项；
- 只冻结公开传输契约形状；物理参数与 Redis 基础设施保持 deferred/G10 门禁；
- 未调用 writing-plans、未创建 Session 后端、未创建 Cookie/CSRF/Redis 实现、未实施代码；
- 等待独立评审与用户正式批准，不自动批准、不实施。

### 2026-08-08：独立评审（reviewer subagent，记录用，不代替正式批准）

> 本节点记录 reviewer subagent 意见。意见只用于改进决策材料，不改变 ADR 状态。正式接受必须由用户完成。

- **安全评审**：`ACCEPT`（无 blocking finding）。范围边界正确（只冻结公开传输契约形状，物理参数 defer 到 G10）；冻结决策安全可靠（HttpOnly 主机限定 Cookie、服务端权威不透明 Session、同步 CSRF＋Origin/Fetch Metadata、Redis 权威不可用 503 失败关闭不伪装 401、统一 401、安全 403/404、A5/密码重置全部 Session 终止、短期受限内部能力令牌不转发浏览器 Cookie）；泄露控制与 PLT-01 §15/§16/§25、PLT-02 §5.3 交叉核对干净；PLT-02"unavailable 壳层"区分安全成立；无任何物理值需在 PLT-02 壳层验收前锁定。
- **非阻断观察**（建议接受时一并纳入，不 blocking）：N1 后端设计 §7.3"日志和 Referrer 不得包含原始值"未在实施约束复述——建议补"Referrer 不得包含原始令牌值"；N2 无配套威胁模型决策包（ADR-009/013 先例有）——建议补短威胁模型附件（XSS→CSRF 令牌窃取、session fixation、Redis 泄露、A5 复活、枚举）；N3 `identityGetSession` 导航目标与 `navigationGetContext` 重叠（源自 approved 设计，非本 ADR 缺陷）；N4 建议明确 `identityGetSession` 为可无 Session 调用的公开 Query、401 表示未认证（防 G10 意外）；N5 ADR-025—028 应登记进 ADR 索引；N6 Session-ID 摘要存储（后端设计 §7.2）属 G10 存储决策；N7 CSRF 令牌不进共享/持久化请求缓存层。
- **评审落实**：N1 已补入实施约束（Referrer 不得包含原始令牌值）。N2—N7 作为非阻断建议记录，随接受/实施推进。
