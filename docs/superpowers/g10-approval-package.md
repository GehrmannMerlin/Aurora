# G10 APPROVAL PACKAGE — 身份、组织治理与账号注销

**日期：2026-08-08（创建）；2026-08-09（用户正式批准）**
**分支：`feature/g10-identity-organization-governance`（基于 main `224748d`，含 PrimeUI License hotfix）**
**状态：✅ 用户已于 2026-08-09 正式批准全部项**

> **批准记录**：用户于 2026-08-09 完整审阅本包（含 G10 readiness、coherence audit、ADR-029/030/031/032、三路独立评审与修订结果），对以下作出正式批准：① ADR-029（accepted）；② ADR-030（accepted，必须使用 reviewer 修订后的最终 ACCEPT 版本，含工作负载身份传输与 Session ID 摘要）；③ ADR-031（accepted）；④ ADR-032（accepted，附 YAGNI 实施约束：只有当前 approved 叶子规格确实需要、存在真实 consumer、且 ADR 明确要求该资源时才实际 provision Redis/cache/object storage/background infra）；⑤ 回收站恢复安全规则（approved product rule）；⑥ B6 私密管理令牌参数口径（纳入 ADR-030 + ADR-013/014 先例）；⑦ G10 模块正式规格授权（brainstorming/writing-plans 逐个形成）。ADR-022/023/024 保持 proposed / not-started，不作为本轮实施依据。各 ADR 的 `implementation-status` 保持 not-started，直到对应代码实施真正开始。

---

## 一、已完成并部署（G09 稳定化 hotfix）

| 项 | 结果 |
|---|---|
| PrimeUI License 横幅根因 | `primevue@5.0.0`（PrimeUI 商业许可）→ `@primeui/license-manager` 在未配置许可时注入 `Invalid PrimeUI License` 横幅；approved ADR-025 只需开源 PrimeVue |
| 修复 | `primevue 5.0.0 → 4.5.5`（MIT）；无购买、无 fake license、无绕过 |
| 回归门禁 | `test:package` bundle 扫描 + `test-browser/license.spec.ts` 真实浏览器断言 + CI 接线（PR/main） |
| 部署 | feature CI PASS → merge main `224748d` → Main Quality Gates PASS → Preview CD PASS → `aurora.ah.cn` 无横幅、ingestion 401 回归 PASS |
| 叶子计数 | 不变（G09 completed，40/38） |

## 二、G10 基线事实

- ADR-025/026/027/028 均为 **accepted / not-started**（授权决策，不授权实现）。
- ADR-022/023/024 为 **proposed / not-started**（不可作为实施依据）。
- Platform OpenAPI manifest 将全部 G10 操作注册为 `blocked`（"not formalized (G10)"）。
- 当前基线：**completed = 40 / remaining = 38**。

## 三、G10 统一 ADR 决策扫描结果

### 已有 accepted 来源（可直接使用）

| 决策 | 来源 |
|---|---|
| 前端技术栈（Vue3/Vite/Router/Pinia/PrimeVue 开源） | ADR-025（accepted） |
| 后端运行时（Fastify/Kysely/模块化单体） | ADR-026（accepted） |
| 契约生成工具链 | ADR-027（accepted） |
| Session/CSRF **契约形状**（HttpOnly Cookie、同步 CSRF、认证级别、失败语义、A5/重置撤销全部） | ADR-028（accepted） |
| A5 产品/安全规则（168h 冷静、双重复核、唯一 Owner 阻塞、全部 Session 终止、1y 审计、7d 清理、35d 备份淘汰） | A5-001—011 + `account-deletion-and-data-lifecycle.md`（approved） |
| B5 真实 `unavailable` 状态合法 | `platform-product-domains.md` §3 状态词表（approved） |

### 缺少 accepted ADR 的长期决策（本包需批准）

| # | 决策 | 阻塞叶子 | proposed ADR |
|---|---|---|---|
| 1 | 平台数据库访问与 Migration 工具链（PostgreSQL 17 + Kysely + node-pg-migrate + SQL-first） | PLT-03/04/SEC-01（全部） | [ADR-029](ADR-029-platform-database-access-and-migration.md) |
| 2 | Session/CSRF/密码物理参数（Argon2id、Cookie 属性、Session 期限、Redis 拓扑、能力令牌、工作负载身份、Session ID 摘要） | PLT-03 | [ADR-030](ADR-030-platform-session-csrf-password-physical-parameters.md) |
| 3 | 邮件发送责任/端口/供应商（`EmailDeliveryPort` + 单供应商 + Outbox） | PLT-03（邮箱验证/重置/邀请） | [ADR-031](ADR-031-platform-email-delivery.md) |
| 4 | Outbox/任务/缓存/对象存储基础设施（Outbox + Redis/BullMQ + 私有 S3） | PLT-03（邮件 Outbox）、SEC-01（删除交接） | [ADR-032](ADR-032-platform-outbox-tasks-cache-objects.md) |

### 明确 deferred（SEC-01 不得越界）

- A5 账号 OpenAPI/数据模型/删除任务/Runbook 物理实现 = SEC-02/后续（`account-deletion-and-data-lifecycle.md` §11）。
- 跨存储物理删除传播、备份淘汰、真实清理 = SEC-02。
- `recent-verification` 触发规则、认证端点限频数值、Argon2id 精确参数 = 安全评审门禁（`requires-benchmark`）。

## 四、独立评审结果（subagent，记录用）

| ADR | 安全评审 | 后端/运维评审 | 架构交叉评审 | blocking findings |
|---|---|---|---|---|
| ADR-029 | ACCEPT（修订后） | — | ACCEPT | 无 |
| ADR-030 | **REJECT→ACCEPT**（B1 已修复：工作负载身份传输补入范围与决定细节 8） | — | ACCEPT | 无（修复后） |
| ADR-031 | — | ACCEPT（修订后） | ACCEPT | 无 |
| ADR-032 | — | ACCEPT（修订后） | ACCEPT | 无 |

已按评审意见完成修订：ADR-029 参数化/最小权限角色/引用修正；ADR-030 工作负载身份 + Session ID 摘要；ADR-031 复用通用 Outbox；ADR-032 Preview 资源预算 + A5 不变量交叉引用 + Redis 容量命名。四份 ADR 已登记进 ADR 索引。

## 五、需要用户批准的两项产品/规格缺口（非 ADR）

架构交叉评审确认：四份 ADR 覆盖 G10 的"ADR"层，但 G10 APPROVAL PACKAGE 还缺以下两项（都是规格/产品批准，不是新 ADR）：

1. **回收站恢复目标状态产品规则**（formalization §8 gap 12）——PRD §17.3 只规定"默认 7 天内可恢复"，未冻结"恢复到服务端明确安全状态"（告警不自动启用、已撤销令牌/失效密钥不恢复、成员/角色按当前组织状态重算）。建议按 gap 12 + PRD §17.2 语义批准；在 PLT-04 B8 writing-plans 前必须批准。
2. **G10 模块正式规格**（identity 数据模型、organization/membership/project 数据模型、authorization 计算、audit 数据模型、private-token 模型、SEC-01 A5 机器契约）——这些是模块规格（非 ADR，`Aurora ADR 规范` §7.2 判定为"已批准架构内的普通功能实现"），由各叶子 brainstorming/writing-plans 形成，纳入 G10 交付物。

## 六、B6 私密令牌物理参数命名归宿

架构评审建议：B6 用户侧私密令牌（区别于 ADR-030 覆盖的服务间能力令牌）的格式/哈希/scope 白名单物理参数，要么并入 ADR-030 范围，要么要求 credentials 模块规格携带安全评审签核。**建议**：并入 ADR-030 范围（与 ingestion 凭证 ADR-013/014 先例一致），在 PLT-04 B6 writing-plans 前确认。

## 七、提交给用户的批准请求

请批准以下全部项（视为整体批准，按用户指令 §7/§42）：

1. **ADR-029**（平台数据库访问与 Migration 工具链）→ accepted
2. **ADR-030**（Session/CSRF/密码物理安全参数）→ accepted
3. **ADR-031**（邮件发送责任/端口/供应商）→ accepted
4. **ADR-032**（Outbox/任务/缓存/对象存储基础设施）→ accepted
5. **回收站恢复目标状态产品规则**（§五.1 语义）→ approved product rule
6. **G10 模块正式规格**（§五.2 清单）→ 授权 brainstorming/writing-plans 逐个形成并纳入 G10
7. **B6 私密令牌物理参数**（§六：并入 ADR-030 范围）→ confirmed

**批准后**：依次进入 PLT-03 spec → PLT-03 writing-plans → PLT-03 执行/验收 → PLT-04 spec → … → SEC-01 → G10 group verification → feature CI → merge main → Main Quality Gates → Preview CD → 公网验收。

**批准前**：不写任何 writing-plans，不创建 Schema/Migration/Session 后端/邮件供应商/Outbox/S3 实现，不自行标记任何 ADR accepted。

## 八、已知风险与替代

- **风险**：Argon2id/Session 期限精确数值未冻结（依赖 `requires-benchmark` + 安全签核）；Preview 单主机需本地 Redis/MinIO，内存预算需核对（~8.5 GiB 可用 RAM）。
- **替代**：数据库方案 B（Prisma）/C（Drizzle）被否决因与 accepted ADR-026 冲突；邮件双供应商/自建 SMTP 被否决因第一版成本与可靠性；密码 bcrypt/PBKDF2 被否决因 OWASP 现代推荐。
