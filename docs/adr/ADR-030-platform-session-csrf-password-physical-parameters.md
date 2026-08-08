---
title: ADR-030：管理平台 Session、CSRF 与密码物理安全参数
status: accepted
decision-status: accepted
implementation-status: not-started
approval-status: approved
owner: security
date: 2026-08-08
last-reviewed: 2026-08-09
applies-to: accepted ADR-028 明确 defer 到 G10 的物理参数——Argon2id 数值、Cookie SameSite/期限、Session 空闲/绝对期限、Redis Session 拓扑/持久化/淘汰、内部能力令牌算法/密钥托管、工作负载身份传输、recent-verification 触发规则
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../architecture/formalization-readiness.md
  - ./ADR-028-platform-session-csrf-security.md
  - ./ADR-026-platform-backend-runtime-and-contract-chain.md
  - ../superpowers/specs/2026-07-28-aurora-platform-backend-design.md
  - ../security/account-deletion-and-data-lifecycle.md
supersedes: none
superseded-by: none
---

# ADR-030：管理平台 Session、CSRF 与密码物理安全参数

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-review
- 日期：2026-08-08
- Owner：security
- 适用范围：accepted ADR-028 明确 defer 到 G10 的物理参数——Argon2id 数值、Cookie SameSite/期限、Session 空闲/绝对期限、Redis Session 拓扑/持久化/淘汰、内部能力令牌算法/密钥托管、工作负载身份传输、`recent-verification` 触发规则
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)（§4.1 必要安全规则）
- 关联技术方案：[管理平台后端设计](../../docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md)（approved，BACKEND-003=B §7.2/§7.3）
- 关联 ADR：[ADR-028](../../docs/adr/ADR-028-platform-session-csrf-security.md)（accepted，§10 显式 defer）、[ADR-029](../../docs/adr/ADR-029-platform-database-access-and-migration.md)（proposed，平台数据库）
- 关联安全规格：[账号注销与数据生命周期](../../docs/security/account-deletion-and-data-lifecycle.md)（approved，A5-001—011）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：无
- 被替代 ADR：无

## 状态说明

本 ADR 于 2026-08-08 创建为 `proposed`。创建依据：accepted ADR-028 §10"本 ADR 不冻结 Argon2id 数值、Cookie SameSite/期限、Session 空闲/绝对期限、Redis 拓扑/持久化/复制/淘汰、签名算法/密钥托管/工作负载身份传输、recent-verification 触发规则——以上属于 G10 身份业务门禁与安全评审"；formalization-readiness §8 缺口第 3 项"Session/Cookie/CSRF/密码/内部令牌物理参数安全评审缺失"；A5 安全规格 §11"requires-accepted-adr = Session/CSRF/credentials/secure storage"。**在用户批准（accepted）前，不得实现 Session 后端、Redis 基础设施、Cookie/CSRF 物理参数或进入 `writing-plans`。**

## 背景

accepted ADR-028 冻结了管理平台认证传输的**契约形状**（HttpOnly 不透明 Session、同步 CSRF、认证级别、失败语义），但显式声明其物理参数 defer 到 G10。G10 的 PLT-03（身份/认证/邀请）需要真实实现：账号密码用 Argon2id 存储（每密码唯一盐）、Session 用 Redis 权威、CSRF 令牌、Cookie 传输、重置/邀请意图。没有本 ADR 冻结这些物理参数，任何 G10 身份实现都无法开始——因为 Argon2id 数值、Cookie SameSite/期限、Session 期限、Redis 拓扑、密钥托管都是长期、高迁移成本、安全关键决策，不能由实施计划随意选择。

## 决策驱动因素

- **安全基准与威胁模型**：密码哈希必须抵抗离线破解（Argon2id 参数与 2026 年硬件基准匹配）；Session 必须抵抗会话固定、重放、侧信道；
- **与 approved 后端设计一致**：BACKEND-003=B 已确定 Redis 权威不透明 Session＋同步 CSRF；
- **可用性与安全平衡**：Redis 故障失败关闭（503）的代价可接受；Session 期限需平衡便利与暴露窗口；
- **合规与数据驻留**：密钥托管与算法需符合隐私/数据保留边界；
- **A5 兼容**：密码重置/A5 注销撤销全部 Session 的语义已批准，本 ADR 冻结实现层。

## 候选方案

### 方案 A：Argon2id（OWASP 推荐参数）+ Redis 权威 Session + HttpOnly Secure Cookie（推荐）

**行为**：密码用 Argon2id（每密码唯一盐，参数取 OWASP 当前推荐内存/迭代/并行度，按 2026 年硬件基准微调）；Session 用 Redis 权威（TLT 空闲/绝对期限）；Cookie `HttpOnly`+`Secure`+`SameSite=Lax`（允许邀请/重置顶级导航）；CSRF 用同步 token + 自定义 Header + Origin/Fetch Metadata；内部能力令牌短期、算法/密钥托管由 KMS/环境密钥承载。

**优点**：行业标准组合；OWASP 参数经过安全社区审查；SameSite=Lax 兼顾邀请/重置顶级导航与 CSRF 防护；Redis TTL 天然支持空闲/绝对期限；与 BACKEND-003=B 一致。

**缺点**：Argon2id 计算成本在低端硬件偏重；Redis 需持久化/复制/故障转移；KMS/密钥托管增加运维复杂度。

**选择结论**：推荐。

### 方案 B：bcrypt（不采用）

**行为**：密码用 bcrypt（cost=12+）。

**优点**：成熟、广泛部署。

**缺点**：bcrypt 72 字节输入截断问题；抗 GPU 离线破解弱于 Argon2id；OWASP 已推荐 Argon2id 为现代首选；与 2026 年安全基准不符。

**选择结论**：不采用。

### 方案 C：PBKDF2（不采用）

**行为**：密码用 PBKDF2-HMAC-SHA256 高迭代。

**优点**：FIPS 合规、无依赖。

**缺点**：GPU/FPGA 并行破解抵抗力弱于 Argon2id；内存硬化缺失；OWASP 列为次选。

**选择结论**：不采用。

### 候选比较

| 维度 | A：Argon2id | B：bcrypt | C：PBKDF2 |
|---|---|---|---|
| OWASP 现代推荐 | 是 | 次选 | 次选 |
| GPU/FPGA 抗破解 | 强（内存硬化） | 中 | 弱 |
| 输入截断问题 | 无 | 72 字节 | 无 |
| 生态/审计 | 成熟 | 成熟 | FIPS |

## 最终决策（proposed）

**方案 A：Argon2id（OWASP 推荐参数，2026 硬件微调）+ Redis 权威 Session + HttpOnly/Secure/SameSite=Lax Cookie + 同步 CSRF + 短期能力令牌。**

### 决定细节（proposed）

1. **密码哈希**：Argon2id，每密码唯一盐（≥16 字节 CSPRNG）；内存/迭代/并行度按 OWASP 2026 当前推荐并以本仓库 benchmark 微调；不使用 Pepper 独立密钥（密钥托管复杂度不值得其边际收益，除非安全评审另行裁定）；
2. **Cookie**：Session Cookie `HttpOnly`+`Secure`+`SameSite=Lax`+无 `Domain`（主机限定）+`Path=/`；不进入 URL/localStorage/日志；
3. **Session 期限**：空闲期限与绝对期限数值由实施计划从安全基准确定并写入配置（默认空闲 ≤30 分钟、绝对 ≤8 小时，可按 Preview 运维微调）；登录旋转 Session ID；密码重置/A5 受理撤销全部 Session；
4. **Redis Session**：隔离的 Redis 命名空间；开启持久化（AOF/RDB 策略）与复制；禁止淘汰（maxmemory-policy noeviction）；Redis 不可用受保护请求 503 失败关闭；
5. **CSRF**：同步 token 与 Session 绑定，自定义 Header（如 `X-Aurora-CSRF`）提交；校验 Origin/目标 Origin 与适用 Fetch Metadata；GET/HEAD/OPTIONS 不改变状态；
6. **内部能力令牌**：短期（分钟级）、限定目标服务/资源/动作/调用主体/操作关联；算法与密钥托管由部署环境密钥/KMS 承载；不包含浏览器 Cookie/密码/完整邮箱/无关角色；
7. **`recent-verification`**：触发规则由安全评审裁定（如密码重置/A5 受理/敏感操作）；与 A5-004 全部 Session 终止语义一致；
8. **工作负载身份传输**：`platform-api`/`platform-worker` 在签发短期能力令牌前先建立工作负载身份（平台后端设计 §7.4 要求的"工作负载身份与能力令牌双重校验"）；精确传输机制（如 SPIFFE/mTLS/共享密钥）与密钥托管由本 ADR 冻结方向，具体实现参数由部署安全评审与基础设施 ADR（ADR-022/023/024，proposed）承载；本 ADR 确保该 defer 有命名 Owner，不静默丢失 ADR-028 §10 的 deferred 项；
9. **Session ID 摘要存储**：Redis 只保存 Session ID 的不可逆摘要（如 SHA-256，与 ADR-013 凭证摘要模式一致），绝不保存原始 Session ID；Redis 被攻破不暴露活动 Session 凭据。

## 结果与影响

### 正面影响

- 解除 G10 身份实现的安全参数阻塞；
- OWASP 一致、2026 硬件抗离线破解；
- Redis 故障失败关闭符合安全关闭原则；
- 与 accepted ADR-028/BACKEND-003=B 完全一致。

### 负面影响与代价

- Argon2id 计算成本；
- Redis 持久化/复制/故障转移运维复杂度；
- 密钥托管（环境密钥/KMS）运维。

### 未解决问题

- Argon2id 精确内存/迭代/并行度数值（由 benchmark 微调，属 implementation-detail）；
- Redis 实例规格/部署拓扑（部署与运维规格承载）。

## 实施约束

- 不把密码/验证码/重置 token 写入日志、URL、前端 Store 或 MSW fixture；
- 不泄露 Session ID/Cookie 值/密码摘要到 `identityGetSession` 或任何日志；
- 密码重置/A5 受理按批准语义撤销全部 Session；
- Redis 不可用受保护请求 503 失败关闭，不伪装 401。

## 迁移方案

- 首次引入 Session/密码物理实现即按本 ADR 参数；后续参数调整通过安全评审与配置变更，不改 Schema。

## 回滚方案

- 参数可配置化（密码哈希参数、Session 期限、Cookie 属性），通过配置回滚；
- Redis Session 架构替换需新 ADR（accepted ADR-028 已冻结方向）。

## 验证方式

- 密码哈希集成测试（真实 PostgreSQL + 已知向量）；
- Session/CSRF 集成测试（真实 Redis + HTTP 401/403/503 语义）；
- 安全评审（OWASP 参数核对）；
- 全仓质量门禁。

## 重新评估条件

- 2026 年后续硬件基准显示 Argon2id 参数需上调；
- 出现 KMS/密钥托管新合规要求；
- Session 期限/CSRF 语义与 A5 或新安全要求冲突。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-08：创建（proposed）

- 状态 `proposed / not-started / awaiting-review`；
- 由 G10 PLT-03（身份/认证）实施门禁创建；
- 依据 accepted ADR-028 §10、formalization-readiness §8 缺口 3、A5 安全规格 §11；
- 未调用 writing-plans、未实现 Session/密码/Redis 物理层、未进入实施；
- 等待独立评审与用户正式批准，不自动批准、不实施。

### 2026-08-08：独立评审（security subagent，记录用，不代替正式批准）

> 评审意见用于改进决策材料，不改变 ADR 状态；正式接受必须由用户完成。

- **安全评审**：初审 `REJECT`（1 个 blocking finding B1：`工作负载身份传输` 从 ADR-028 §10 deferred 覆盖中静默丢失且未重新指定 Owner）。已修复：适用范围/元数据补上"工作负载身份传输"，新增决定细节 8（工作负载身份传输方向冻结 + 精确实现参数命名 Owner 给部署安全评审与 ADR-022/023/024），新增决定细节 9（Session ID 摘要存储，Redis 只存不可逆摘要）。修复后复审 `ACCEPT`（无 blocking）。非阻断观察 N1—N6：Session ID 摘要已并入决定细节 9；`recent-verification` 触发规则在决定细节 7 保持由安全评审裁定并记录为 G10 未决门禁项；认证端点限频/防枚举（后端设计 §7.3）在决定细节外记录为 PLT-03 待跟踪项；威胁模型建议在后续安全评审补充；A5 不可复活不变量由基础设施 ADR 承载。
- **架构交叉评审**：`ACCEPT`（无 blocking）。决定细节 3 的"默认空闲 ≤30 分钟/绝对 ≤8 小时可按 Preview 运维微调"属软承诺，建议实施计划以 `requires-benchmark` + 安全签核门禁承载；`recent-verification` 触发器建议在本 ADR 或安全评审门禁内固定。

### 2026-08-09：用户正式批准（accepted）

- 用户已于 2026-08-09 对本 ADR 作出明确正式批准，批准范围（逐条）：
  1. Argon2id 密码处理参数（OWASP 现代推荐，每密码唯一盐）；
  2. Cookie/Session 安全参数（HttpOnly、Secure、SameSite=Lax、无 Domain）；
  3. Session 生命周期（空闲/绝对期限、登录旋转、密码重置/A5 受理撤销全部 Session）；
  4. CSRF（同步 token + 自定义 Header + Origin/Fetch Metadata）；
  5. Redis/Session topology 边界（隔离命名空间、持久化、复制、noeviction、503 失败关闭）；
  6. capability/identity boundary（内部能力令牌短期限定）；
  7. 工作负载身份传输（决定细节 8）；
  8. Session ID 摘要/存储语义（决定细节 9，Redis 只存不可逆摘要）；
  9. change-password 后 Session 行为（按批准语义撤销相应 Session）。
- 批准明确：必须使用 reviewer 修订后的**最终 ACCEPT 版本**（含工作负载身份传输与 Session ID 摘要），不得恢复到初审被 REJECT 的版本；
- 批准仅适用于本 ADR 已记录并经过评审修订的决策范围；不扩大公共 API、不改变已批准 ADR 核心决策；
- 状态更新：`status: accepted`、`decision-status: accepted`、`approval-status: approved`、`implementation-status: not-started`；
- 原 proposed 历史记录完整保留（"创建（proposed）"与"独立评审"各节均未删除或覆盖）；
- 实施状态保持 `not-started`，直到 PLT-03 正式实施真正开始；本 ADR 不得在此时标记为 implemented 或 in-progress。
