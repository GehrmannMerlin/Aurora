---
title: ADR-031：管理平台邮件发送责任、端口与供应商
status: accepted
decision-status: accepted
implementation-status: implemented
approval-status: approved
owner: product/operations/security
date: 2026-08-08
last-reviewed: 2026-08-15
applies-to: 平台身份事务邮件（邮箱验证、密码重置、组织邀请）的发送责任边界、EmailDeliveryPort 契约、外部邮件供应商选择、发送记录与失败恢复；不覆盖 ingestion 或其他域邮件
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../architecture/formalization-readiness.md
  - ./ADR-029-platform-database-access-and-migration.md
  - ./ADR-030-platform-session-csrf-password-physical-parameters.md
  - ../superpowers/specs/2026-07-28-aurora-platform-backend-design.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
supersedes: none
superseded-by: none
---

# ADR-031：管理平台邮件发送责任、端口与供应商

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-review
- 日期：2026-08-08
- Owner：product/operations/security
- 适用范围：平台身份事务邮件（邮箱验证、密码重置、组织邀请）的发送责任边界、`EmailDeliveryPort` 契约、外部邮件供应商选择、发送记录与失败恢复；不覆盖 ingestion 或其他域邮件
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)（§4.1 邮箱验证、§4.3 邀请）
- 关联技术方案：[管理平台后端设计](../../docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md)（BE-GAP-09）
- 关联 ADR：[ADR-029](../../docs/adr/ADR-029-platform-database-access-and-migration.md)（proposed）、[ADR-030](../../docs/adr/ADR-030-platform-session-csrf-password-physical-parameters.md)（proposed）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：无
- 被替代 ADR：无

## 状态说明

本 ADR 于 2026-08-08 创建为 `proposed`。创建依据：formalization-readiness §8 缺口第 4 项"邮件发送责任、供应商、期限、冷却和失败恢复；GAP-03、BE-GAP-09"；平台后端设计 BE-GAP-09"邮件供应商、验证/重置/邀请期限、重发冷却与送达事件契约未决定"；UX/UI GAP-03（`EmailDeliveryPort` + 事务性 Outbox）。**在用户批准（accepted）前，不得选择/注册外部邮件供应商、创建 EmailDeliveryPort 实现或进入 `writing-plans`。**

## 背景

G10 的 PLT-03（A1 邮箱验证、A3 密码重置、A4 组织邀请）都需要真实邮件交付。当前没有任何已接受 ADR 决定：邮件发送由谁负责（领域 service vs 独立模块）、`EmailDeliveryPort` 契约形状、外部供应商、发送记录（Outbox）、重发冷却、送达非承诺语义。没有本 ADR，PLT-03 无法实现邮箱验证/密码重置/邀请，且可能错误地把供应商 API secret 写进 Git 或在网页显示原始 token。

## 决策驱动因素

- **安全**：验证码/重置 token 绝不写入日志或网页；供应商 API secret 绝不进入 Git；
- **职责隔离**：邮件发送是副作用，必须与身份领域逻辑解耦（端口/适配器模式）；
- **可靠性**：发送请求必须权威记录（Outbox），明确"送达非承诺"，重试/冷却语义清晰；
- **Preview 与生产**：Preview 需要可验证的发送路径（不泄露 raw token），生产需要真实供应商；
- **成本与运营**：单供应商第一版，双供应商故障切换是未来选择。

## 候选方案

### 方案 A：单供应商适配器 + EmailDeliveryPort + 事务性 Outbox 记录（推荐）

**行为**：定义 `EmailDeliveryPort`（发送事务邮件的端口契约）；身份领域 service 通过该端口发起发送；Outbox 表权威记录发送请求（主题、收件人邮箱、意图类型、幂等键、状态）；单外部供应商适配器实现该端口；明确送达非承诺——Outbox 记录"已可靠入队"，不承诺收件箱到达；重发冷却与失败恢复由运维/Worker 承担。

**优点**：职责隔离清晰；Outbox 保证发送请求不丢；供应商可替换（适配器）；安全边界明确（secret 只在服务端，不进 Git/日志）；与 ingestion 事务性缓冲（Inbox）模式一致。

**缺点**：需要一个外部供应商账号（成本）；Preview 环境仍需一种验证发送路径（可以是供应商 sandbox 或本地打印到受控日志但绝不打印 token）。

**选择结论**：推荐。

### 方案 B：双供应商故障切换（不采用第一版）

**行为**：两个独立供应商，故障自动切换。

**优点**：高可用。

**缺点**：双供应商成本/复杂度；第一版无该可用性要求；与 approved "第一版单供应商" 推荐冲突。

**选择结论**：不采用第一版。

### 方案 C：应用内自建 SMTP 直发（不采用）

**行为**：应用直接通过 SMTP 直发邮件，无外部供应商。

**优点**：无供应商依赖。

**缺点**：IP 信誉/进箱率差；无送达统计/退信处理；安全与运维复杂度高；与行业最佳实践冲突。

**选择结论**：不采用。

### 候选比较

| 维度       | A：单供应商+Outbox | B：双供应商   | C：自建 SMTP |
| ---------- | ------------------ | ------------- | ------------ |
| 职责隔离   | 端口+Outbox        | 同 A          | 耦合         |
| 送达可靠性 | Outbox 保证入队    | 同 A+故障切换 | 依赖 IP 信誉 |
| 安全边界   | secret 服务端      | 同 A          | 需自建       |
| 第一版成本 | 中（一个供应商）   | 高            | 低但质量差   |

## 最终决策（proposed）

**方案 A：单外部邮件供应商 + `EmailDeliveryPort` + 事务性 Outbox 记录。**

### 决定细节（proposed）

1. **端口契约**：定义 `EmailDeliveryPort`（如 `deliverTransactionalEmail(request)`），身份领域只依赖该端口，不依赖具体供应商；
2. **Outbox 权威记录（复用 ADR-032 通用事务性 Outbox）**：发送请求作为邮件意图记录进入 ADR-032 定义的平台通用事务性 Outbox（收件人邮箱、意图类型、幂等键、状态、attempt 计数作为邮件类型化 payload 字段），不建立第二套邮件专用 Outbox；"送达非承诺"——成功=可靠入队，不承诺收件箱到达；
3. **供应商选择**：第一版单供应商（候选：阿里云 DirectMail / SES / Resend 等，需用户授权注册）；供应商适配器隔离；
4. **重发冷却与失败恢复**：验证/重置/邀请意图的冷却时间与重发上限由实施计划从安全基准确定（防枚举）；失败重试由 Worker/运维承担；
5. **安全边界**：供应商 API secret 只存在于服务端部署环境，绝不进入 Git/日志/前端；验证码/重置 token 绝不写入日志、网页、URL 或前端 Store；Preview 发送路径（sandbox 或受控）不得泄露 raw token；
6. **意图 token**：验证/重置/邀请使用短期一次性意图，GET 链接只建立意图并清理原始 token，最终写入由受 CSRF 保护的 Command 完成（accepted ADR-028 §决定细节 6）。

## 结果与影响

### 正面影响

- 解除 PLT-03 邮箱验证/密码重置/邀请的发送阻塞；
- 职责隔离、Outbox 可靠入队、供应商可替换；
- 安全边界明确（secret 与 token 不泄漏）。

### 负面影响与代价

- 需要一个外部供应商账号（用户授权注册）；
- Preview 需要受控发送路径（不泄露 token）；
- Outbox 表增加数据模型。

### 未解决问题

- 具体供应商（阿里云 DirectMail / SES / Resend）与账号（用户授权，Agent 不自行注册）；
- 精确冷却时长/重发上限/送达超时（implementation-detail，安全基准确定）。

## 实施约束

- 不把验证码/重置 token 写日志、网页、URL 或前端 Store；
- 供应商 API secret 不进 Git、不进日志、不进前端可恢复 secret；
- 不使用 fake email 冒充真实流程；Preview 发送路径不得泄露 raw token；
- Outbox 记录权威，送达非承诺。

## 迁移方案

- 首次引入 EmailDeliveryPort + Outbox + 单供应商；供应商替换通过适配器（不改变领域逻辑）。

## 回滚方案

- 供应商适配器可替换；Outbox 记录保留可审计；禁用邮件发送可回退到意图到期失败。

## 验证方式

- EmailDeliveryPort 单元测试（mock 适配器，断言领域逻辑）；
- Outbox 集成测试（真实 PostgreSQL，断言入队/状态/幂等）；
- Preview 发送路径验证（受控，不泄露 raw token）；
- 全仓质量门禁。

## 重新评估条件

- 单一供应商可用性/进箱率不达标；
- 出现双供应商或云原生邮件服务硬性要求；
- 安全评审发现端口契约或 token 生命周期缺陷。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-08：创建（proposed）

- 状态 `proposed / not-started / awaiting-review`；
- 由 G10 PLT-03（身份/认证/邀请）实施门禁创建；
- 依据 formalization-readiness §8 缺口 4、BE-GAP-09、UX/UI GAP-03；
- 未调用 writing-plans、未注册供应商、未创建 EmailDeliveryPort 实现、未进入实施；
- 等待独立评审与用户正式批准，不自动批准、不实施。

### 2026-08-08：独立评审（backend/ops + architecture subagents，记录用，不代替正式批准）

> 评审意见用于改进决策材料，不改变 ADR 状态；正式接受必须由用户完成。

- **后端/运维评审**：`ACCEPT`（无 blocking）。已按非阻断观察修订：N1 措辞修正（"与 ingestion 事务性缓冲（Inbox）模式一致"）；N2 Preview 发送路径补充说明（任何 preview-only transport 必须 env-gated，不进入真实流程集成测试的送达语义）；N3/N4 见架构交叉评审；决定细节 2 已改为复用 ADR-032 通用事务性 Outbox（不建第二套邮件专用 Outbox）。
- **架构交叉评审**：`ACCEPT`（无 blocking）。与 formalization §8 缺口 4（第一版单供应商经 `EmailDeliveryPort` 隔离 + Outbox 权威记录 + 送达非承诺）逐条一致；供应商 API secret 不进 Git/日志；Outbox 邮件记录复用 ADR-032 通用 Outbox 已明确。

### 2026-08-09：用户正式批准（accepted）

- 用户已于 2026-08-09 对本 ADR 作出明确正式批准，批准范围（逐条）：
  1. `EmailDeliveryPort` 端口契约（身份领域只依赖端口，不依赖具体供应商）；
  2. provider boundary（第一版单供应商适配器隔离）；
  3. email delivery responsibility（送达非承诺、Outbox 权威记录、重发冷却与失败恢复）；
  4. verification/reset/invitation delivery（邮箱验证、密码重置、组织邀请三类事务邮件）；
  5. Outbox integration boundary（复用 ADR-032 通用事务性 Outbox，不建第二套邮件专用 Outbox）。
- 批准明确禁止：日志打印验证码、页面显示 reset token、fake email 冒充真实邮件交付；供应商 API secret 不进 Git/日志/前端；
- 批准仅适用于本 ADR 已记录并经过评审修订的决策范围；
- 状态更新：`status: accepted`、`decision-status: accepted`、`approval-status: approved`、`implementation-status: not-started`；
- 原 proposed 历史记录完整保留（"创建（proposed）"与"独立评审"各节均未删除或覆盖）；
- 实施状态保持 `not-started`，直到 PLT-03 正式实施真正开始；本 ADR 不得在此时标记为 implemented 或 in-progress。

### 2026-08-14：用户选择阿里云 DirectMail 并批准验证邮件重发设计

- 用户明确选择阿里云 DirectMail 作为第一版单一外部邮件供应商；采用正式 `SingleSendMail` API 与官方 Node.js/TypeScript SDK，不采用 SMTP 直连；
- 选择不改变本 ADR 已接受的 `EmailDeliveryPort + ADR-032 通用事务性 Outbox + Worker` 边界；供应商 SDK 只存在于 `packages/platform-email` 适配器与 `apps/platform-worker` composition root；
- 用户已知并接受当前官方计费边界：新账号累计前 2,000 封免费、免费阶段每日最多 200 封；免费额度用尽后自动按量付费，当前标准 2 元/1,000 封。权威来源见[阿里云计费方式](https://help.aliyun.com/zh/direct-mail/billing-methods)与[使用限制](https://help.aliyun.com/zh/direct-mail/product-overview/limits/)；
- 凭据优先使用 ECS RAM 角色/默认凭证链；回退长期 AccessKey 时必须最小权限并只存部署 secret，绝不进入 Git、聊天、日志、前端或构建产物；
- 用户同时批准历史未验证账号只能在成功登录后重发，服务端从 Session 推导账号/邮箱，不开放任意邮箱输入；具体产品与实现约束见[邮箱验证真实交付与历史账号重发设计](../superpowers/specs/2026-08-14-email-verification-delivery-and-resend-design.md)；
- 截至本记录，`EmailDeliveryPort`、Console adapter、通用 Outbox 与 Worker 消费骨架已经存在；阿里云适配器、重发 Command、Outbox 可靠性修复和真实发信部署尚未实施，因此 ADR 实施状态更新为 `in-progress`，不得标记 `implemented`。

### 2026-08-15：功能分支实现完成，部署受保护检查点阻塞

- `EmailDeliveryPort` 的阿里云 DirectMail `SingleSendMail` adapter、官方 SDK 默认凭据链、`platform-worker` composition root、新注册自动入队、Session 保护的历史账号重发、最新链接唯一有效语义及 Console Session 恢复已经实现；
- PostgreSQL Outbox 已实现失败重试、`processing` 超时回收、claim fencing、有界最大尝试次数和终态 token/payload 清理；事务、并发、冷却、滚动配额、幂等、旧链接失效和账号激活已通过真实 PostgreSQL 17.10/Redis 7.4 集成测试，自动化发信均使用假的 DirectMail client；
- 全仓格式、lint、类型、测试、覆盖率、边界、OpenAPI/manifest 漂移、构建及 Chromium 门禁通过；脱敏实施证据见[2026-08-15 邮箱验证交付与重发实施证据](../testing/evidence/2026-08-15-email-verification-delivery-and-resend.md)；
- 阿里云域名、DNS、发信地址、RAM 权限和两条公网真实发信检查仍需账号控制台权限，因此当前实施状态为 `implemented-in-feature-branch / deployment-blocked`，不得声称真实邮件交付已完成。

### 2026-08-15：公网部署与真实交付由用户验收完成

- 公网 Preview 已部署版本 `20260815-132409`（提交 `d6700af`），使用阿里云 DirectMail `aliyun` 交付模式；
- 用户确认已收到真实交付邮件，并明确授权将本任务标记完成；该用户验收作为外部供应商边界后的真实交付证据，记录中不保存完整邮箱、token、邮件正文、AccessKey 或供应商原始错误体；
- 用户明确取消原人工步骤中的费用/发送预警配置：基于当前应用使用量低，接受暂不配置预警的运营风险；该项不再作为实施或发布阻塞，若发送量、费用或运营责任发生显著变化再重新评估；
- 既定的送达非承诺语义不变：应用响应 `queued` 与供应商 `accepted` 本身仍不承诺收件箱到达，本次完成状态来自用户实际收件确认；
- ADR 当前状态更新为 `accepted / implemented`，邮箱验证真实交付与历史账号重发增量为 `deployed / complete`。
