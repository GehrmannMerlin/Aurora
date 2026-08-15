---
title: Aurora 邮箱验证真实交付与历史账号重发设计
status: approved
implementation-status: deployed / complete
approval-status: approved
owner: platform/identity/operations/security
created: 2026-08-14
last-reviewed: 2026-08-15
applies-to: 新注册邮箱验证邮件、已登录未验证账号重发、阿里云 DirectMail 适配器、邮件 Outbox 可靠性与 Console 邮箱验证页
related:
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
  - ../../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../../adr/ADR-028-platform-session-csrf-and-internal-capability.md
  - ../../adr/ADR-031-platform-email-delivery.md
  - ../../adr/ADR-032-platform-transactional-outbox.md
  - ./2026-08-09-platform-identity-authentication-invitation.md
  - ./2026-08-14-aurora-console-ux-ui-redesign-design.md
supersedes: none
design-stage: approved-design-deployed-complete
---

# Aurora 邮箱验证真实交付与历史账号重发设计

## 1. 授权、问题与目标

用户于 2026-08-14 明确要求完成两条真实业务链路：

1. 新用户注册后，系统向注册邮箱发送可用的验证邮件；
2. 过去未收到验证邮件、目前只能进入受限工作空间的未验证用户，登录后可以重新发送验证邮件。

用户明确选择阿里云 DirectMail，并批准以下方案：复用现有 `EmailDeliveryPort + PostgreSQL Outbox + platform-worker`，新增真实供应商适配器和受 Session 保护的重发 Command，同时修复现有 Outbox 的失败重试、崩溃回收和敏感 payload 清理缺口。

目标是让“注册 → 收件 → 点击 → 验证 → 激活”和“历史账号登录 → 重发 → 验证 → 激活”都成为可验证的真实闭环。页面中的“已发送”只表示事务性 Outbox 已可靠入队，不冒充供应商接收或最终送达。

## 2. 已选择方案与边界

### 2.1 采用：DirectMail API + 现有事务性 Outbox

身份事务在同一 PostgreSQL 事务中写入一次性验证意图和邮件 Outbox；独立 `platform-worker` 认领邮件，再通过阿里云 DirectMail `SingleSendMail` API 发送。领域层只依赖 `EmailDeliveryPort`，供应商 SDK 不进入身份领域或 HTTP handler。

不采用：

- SMTP 直连：供应商错误分类、凭证边界和可观测性弱于正式 API；
- HTTP 请求内同步发信：供应商抖动会直接污染注册事务和请求时延；
- 根据浏览器保存的注册交接信息重发：刷新、换设备和历史账号都不可靠，且可能引入邮箱枚举。

### 2.2 当前范围

本增量包括：

- 新注册自动入队验证邮件；
- 已登录、尚未验证账号的重发 Command；
- 旧链接失效、并发顺序和账户激活；
- 阿里云 DirectMail 生产适配器与全部既有身份邮件类型的安全模板；
- 邮件 Outbox 的重试、超时回收、终态脱敏和诊断；
- `/verify-email` 在刷新、换浏览器状态恢复和历史账号场景下的真实 UI；
- 契约、数据库、API、Worker、前端、可访问性和真实供应商冒烟验证。

不包括：营销邮件、群发、打开/点击追踪、附件、图片、退信 Webhook、双供应商自动切换、向未登录用户开放“输入任意邮箱重发”。

## 3. 产品行为

### 3.1 新注册

注册事务原子完成：创建账号、个人组织、两小时有效的一次性邮箱验证意图、对应邮件 Outbox。任一步失败都回滚，不得出现“账号已建但没有可发送验证意图”的半完成状态。

注册成功响应返回脱敏邮箱、`deliveryStatus=queued`、`resendAvailableAt` 与 `serverTime`。首封邮件入队后立即进入 60 秒冷却；首封注册邮件不计入“重发 5 次”额度，但参与当前冷却。

### 3.2 历史未验证账号重发

新增稳定操作：

```text
identityResendEmailVerification
POST /api/platform/v1/auth/email/resend
```

约束：

- 必须已有有效 Session；请求体只包含 `idempotencyKey`；
- 必须通过同步 CSRF；服务端从 Session 推导账号与邮箱，不接收邮箱参数；
- 账号必须未验证且未处于删除流程；
- 同账号 60 秒内只接受一次；同账号滚动 24 小时最多接受 5 次重发；
- 保留现有按账号/IP 的外层反滥用限流，数据库记录是冷却和滚动额度的权威来源；
- Command 成功只表示新意图与 Outbox 已原子提交，返回 `deliveryStatus=queued`；
- 已验证账号不发送，返回稳定 `409 state_machine_conflict`，客户端刷新 Session 后进入工作空间；
- 冷却或日上限返回 `429 rate_limited` 和可用的 `Retry-After`/`resendAvailableAt`；
- Session 失效返回既有 `401 authentication_required`，页面引导登录，不显示邮箱输入框。

同一 `idempotencyKey` 的重复请求必须返回第一次的稳定结果，不重复创建意图或 Outbox；不同键的并发请求由账号行锁串行化。

### 3.3 最新链接唯一有效

重发事务先锁定账号并确认仍未验证，再使该账号全部未消费的旧邮箱验证意图失效，创建新的两小时意图和邮件 Outbox。确认事务也使用同一账号行锁，使“确认旧链接”和“重发”按确定顺序完成：确认先完成则不再重发；重发先完成则旧链接不能确认。

尚未被 Worker 认领的旧验证邮件 Outbox 可以标记为 `superseded` 并清除敏感 payload；已经提交给供应商的邮件无法撤回，因此用户仍可能收到旧邮件，但其中链接只会得到安全的已失效状态。系统不承诺跨供应商边界的 exactly-once 发送。

确认成功后在同一事务中写入 `verified_at`，并把 `pending_verification` 账号状态推进为 `active`；重复确认保持幂等，不重复改变身份状态。

## 4. 数据与契约

### 4.1 数据库权威记录

邮件重发限制必须来自可事务查询的持久记录，不使用进程内计数作为权威。实现可复用邮件 Outbox/意图时间，也可增加最小重发接受记录，但必须满足：账号维度、接受时间、幂等键唯一、可在真实 PostgreSQL 中锁定并审计，且不保存原始 token。

Outbox 状态扩展为：

```text
pending -> processing -> succeeded
                    \-> failed -> processing
                    \-> dead_lettered
pending/failed -> superseded
processing(timeout) -> processing(new claim)
```

`failed` 是可重试状态；`dead_lettered` 和 `superseded` 是终态。认领次数有界，默认最大 5 次；退避采用有界指数退避并带抖动。供应商调用超时必须显著短于 processing 回收阈值；初始建议 10 秒调用超时、5 分钟回收阈值，精确值作为类型化部署配置。

成功、永久失败、过期或 superseded 后，Outbox 必须清除原始链接/token 等敏感 payload，只保留最小安全元数据和稳定结果码。暂态失败在下一次尝试前可以保留发送所需 payload；一旦验证意图已过期，不再发送并进入终态脱敏。

### 4.2 供应商端口结果

`EmailDeliveryPort` 的失败结果需要区分：

- `retryable`：网络错误、调用超时、供应商 429、供应商 5xx 或明确的暂态限额；
- `permanent`：无效地址、未验证发信地址、权限/签名/配置错误、非法请求；
- `accepted`：供应商 API 接受请求，不等于最终到达收件箱。

结果只记录稳定安全码、attempt、时间和可选供应商 request id；不得记录完整收件地址、HTML、原始链接、AccessKey 或供应商原始错误体。

### 4.3 Platform Contract

新操作必须进入 `@aurora/platform-contract`、Platform OpenAPI、生成 Client/Server 适配器与 drift manifest。请求和响应使用 closed schema；错误复用现有稳定错误信封。契约至少覆盖：queued、cooldown、rolling limit、already verified、session expired、CSRF failure、idempotent replay 和 provider/outbox unavailable。

## 5. 阿里云 DirectMail 适配器

### 5.1 接入方式

使用阿里云 DirectMail 2015-11-23 `SingleSendMail` 正式 API 和官方 Node.js/TypeScript SDK，适配器位于 `packages/platform-email`，由 `apps/platform-worker` composition root 按 `EMAIL_DELIVERY_MODE=aliyun` 选择。`console` 模式只保留给本地受控开发，不得在公网 Preview/生产冒充真实发送。

建议配置：

- 发信域名：`notifications.aurora.ah.cn`；
- 发信地址：`support@notifications.aurora.ah.cn`；
- 发件人显示名：`Aurora`；
- API region/endpoint、发信地址和显示名全部由类型化环境配置提供，不硬编码到领域层。

优先使用 ECS RAM 角色/默认凭证链；必须使用长期 AccessKey 时，只创建最小权限 RAM 用户并放入部署 secret。任何 AccessKey、SMTP 密码或验证 token 都不得进入 Git、聊天、前端、构建产物或日志。

### 5.2 模板

验证邮件同时提供 UTF-8 HTML 和纯文本：标题“验证你的 Aurora 邮箱”，说明发起原因、两小时有效期、主按钮和可复制备用链接。无追踪像素、外部图片和附件。

由于同一 `EmailDeliveryPort` 已承载验证、密码重置、组织邀请和注销确认，阿里云模式必须为四种既有意图提供对应的最小安全模板，避免切换真实供应商后破坏其他身份流程。本轮真实公网端到端验收重点仍是注册验证与历史账号重发。

### 5.3 成本边界

根据阿里云官方计费文档，DirectMail 新账号累计前 2,000 封免费，免费阶段每天最多 200 封；免费额度用尽后自动按量付费，当前标准为每 1,000 封 2 元。该额度不是永久免费月度额度，应用内限流也不能保证永不产生费用。部署前应在阿里云控制台配置可用的费用监控/告警并观察发送量。

权威来源：

- [阿里云 DirectMail 计费方式](https://help.aliyun.com/zh/direct-mail/billing-methods)
- [阿里云 DirectMail 使用限制](https://help.aliyun.com/zh/direct-mail/product-overview/limits/)
- [通过 API 和 SMTP 发送邮件的简化流程](https://help.aliyun.com/zh/direct-mail/getting-started/simplified-procedure-of-sending-by-api-and-smtp)
- [SingleSendMail API](https://help.aliyun.com/zh/direct-mail/api-dm-2015-11-23-singlesendmail)
- [Node.js V2.0 SDK 凭据配置](https://help.aliyun.com/zh/sdk/developer-reference/v2-nodejs-integrated-sdk)

## 6. Console 体验

`/verify-email` 不再依赖只存在内存中的注册交接信息。页面挂载时恢复 Session，以 Session 中的账号状态作为权威；刚注册时可以使用注册响应加速首屏，但刷新、换页或历史账号登录后仍能得到同样能力。

页面遵守已批准的 `Calm Observability` 认证外壳，不重做业务外观。必须覆盖：加载中、待验证、入队成功、60 秒倒计时、24 小时上限、已验证、Session 过期需登录、邮件服务暂时不可用可重试。邮箱仅作脱敏显示，不提供可编辑邮箱输入。用户仍可进入受限工作空间；验证成功后恢复 Session/导航并进入正常工作空间。

验证链接继续遵守既有安全交接：落地 GET 只建立短期 HttpOnly 验证意图并立即从地址栏移除原始 token，最终确认由显式、受 CSRF 保护的 POST 完成。token 不进入前端 Store、analytics、页面文案或日志。

## 7. 测试与验收

必须先写失败测试，再实现最小通过代码。最小验证矩阵：

1. 契约：新增操作、closed schema、状态码、OpenAPI/manifest/生成代码漂移；
2. 真实 PostgreSQL：注册原子入队、60 秒冷却、滚动 24 小时 5 次、幂等重放、并发重发、旧意图失效、确认/重发竞态、账号激活；
3. Outbox：failed 可重新认领、指数退避、最大 attempt、processing 超时回收、过期停止发送、terminal payload 清理、superseded 抑制；
4. Fastify + 真实 Redis/PostgreSQL：Session、CSRF、无邮箱参数、401/409/429/503 与 `Retry-After`；
5. 供应商 adapter：请求映射、HTML 转义、四类模板、错误分类、超时、日志脱敏；SDK 客户端以端口注入，不在自动测试中真实发信；
6. Vue/Vitest/Testing Library：刷新恢复、历史账号重发、倒计时、错误状态和成功状态；
7. Playwright + axe：桌面与窄屏路径、键盘操作、焦点和可访问名称；
8. 最终受控公网 E2E：一个新注册账号和一个历史未验证账号分别收到邮件并完成验证；检查旧链接失效、账号变为 active、普通工作空间可进入。

自动化门禁不得要求开发者把真实阿里云 secret 提交到仓库。真实发信 smoke 只在受保护部署环境中显式运行。

## 8. 部署与回滚

### 8.1 需要用户在阿里云控制台完成的最小步骤

1. 开通 DirectMail；
2. 添加并验证发信域名；
3. 按控制台给出的 DNS 记录在 `aurora.ah.cn` DNS 中完成验证；
4. 创建发信地址并审核通过；
5. 为 Aurora 主机配置最小权限 RAM 角色或受保护的 RAM 凭据；
6. 在部署环境设置 provider、region/endpoint、发信地址和显示名；
7. 完成受控真实发信 smoke 后再把公网环境从 `console` 切到 `aliyun`。

Agent 可以完成代码、文档、配置模板、测试、构建和无需登录的检查；无法代替用户完成阿里云实名/服务开通、域名控制台确认、RAM 授权或账单设置。用户不得在聊天中发送 secret。

### 8.2 回滚

供应商开关可回退到禁用真实交付的安全模式，但公网环境不得用 `console` 模式宣称已发送。回滚不得撤销数据库 migration；旧版本不认识的新 Outbox 状态时必须先保持 Worker 停止，再执行兼容回滚。已验证账号与已消费意图不回退。

## 9. 完成定义

只有以下条件同时满足，才可声称功能完成：代码与机器契约已实施、全仓门禁通过、数据库 migration 已验证、Preview/生产使用 `aliyun` 模式、阿里云域名与发信地址生效、两条受控公网 E2E 均收到真实邮件并完成验证、仓库与日志中没有 secret/token 泄漏。若阿里云控制台配置尚未完成，代码只能标记为 implemented-in-feature-branch 或 deployment-blocked，不得称真实交付已完成。

## 10. 2026-08-15 部署验收与运营取舍更新

- 公网 Preview 已部署包含本设计实现的版本 `20260815-132409`（提交 `d6700af`），应用与服务健康检查通过；
- 用户确认已在受控邮箱收到真实 DirectMail 交付邮件，并明确接受该结果作为本增量的公网交付验收；证据不保存完整邮箱、token、验证链接、邮件正文或供应商原始响应；
- 用户明确将原人工步骤中的费用/发送预警配置取消：当前应用使用量低，不配置相关预警是已接受的运营取舍，不再作为发布、验收或完成门禁。本决定 supersedes §5.3 中“部署前必须配置告警”的强制解释；计费和发送限额事实保持不变；
- 原两条受控公网 E2E 仍保留为未来回归 Runbook，但不再是本次完成状态的阻塞项；自动化 PostgreSQL/Redis/浏览器门禁继续覆盖新注册、历史账号重发、冷却、滚动配额、旧链接失效和账号激活；
- 本设计实施状态更新为 `deployed / complete`。
