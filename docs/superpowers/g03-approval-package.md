# G03 APPROVAL PACKAGE — 错误归一化与 Issue 主链

**日期：2026-08-10（创建）；2026-08-10（用户正式批准）**
**分支：`feature/g03-error-issue-mainline`（基于 origin/main `617b9b0`，G02 merged）**
**状态：✅ 用户已于 2026-08-10 整体批准全部项**

> **批准记录**：用户于 2026-08-10 对本包作出整体正式批准（"整体批准（Recommended）"）：
> 1. **ADR-033**（Issue 聚合与有界代表样本数据模型）→ **accepted**（含 `issues`/`issue_samples`/`issue_event_applications`/`issue_activities`/`issue_notes` 表、`(project_id, fingerprint, fingerprint_version)` 聚合键、有界代表样本策略、乐观 `version`、`error_event_occurrences` 指纹增列、v1 只实现 `by_time` 重开）；
> 2. **DAT-12 正式规格** → **approved**；
> 3. **DAT-13 正式规格** → **approved**；
> 4. **DAT-14 正式规格** → **approved**；
> 5. **DAT-15 正式规格** → **approved**。
>
> **批准后**：依次进入 DAT-12 writing-plans → DAT-12 执行/验收 → DAT-13 → … → DAT-15 → G03 group verification → feature PR/CI → merge main。各 ADR/规格的 `implementation-status` 保持 not-started，直到对应代码实施真正开始。

---

## 一、G03 基线事实

- 当前正式叶子：**completed = 46 / remaining = 32**（G01/G02/G09/G10 completed）。
- G03 四叶子独立验收通过后：DAT-12 → 47/31、DAT-13 → 48/30、DAT-14 → 49/29、DAT-15 → 50/28；只有叶子独立验收成功才更新计数。
- G02（DAT-16/17/20）已建立 Query 分页、时间范围、项目授权、安全投影与错误语义先例；G10（PLT-03/04/SEC-01）已解除身份/组织/权限阻塞（DAT-14 前置）。
- `@aurora/processing-store` 已实现 `error_event_occurrences`（ADR-018）；`@aurora/event-schema` 已实现错误事件协议契约（三类别正文）；`@aurora/ingestion-worker` 已实现 `createErrorEventProcessor`。

## 二、G03 最小 readiness 结果

| # | 检查项 | 结果 |
|---|---|---|
| A | DAT-12 fingerprint/grouping 语义是否已有 approved 决策 | ✅ 是——PRD §9.1—9.6 已冻结默认识别、归一化、自定义指纹优先、算法版本（§9.6）、敏感处理（§9.4.4）。缺独立规格，由 DAT-12 正式规格冻结实现语义。**不创建新 ADR**（PRD §9.6 固定版本/兼容）。 |
| B | DAT-13 Issue 数据模型是否已有 accepted ADR | ❌ 否——ADR-018 只覆盖错误 occurrence 存储；无 Issue 聚合 ADR。**必须创建新 ADR（ADR-033）**。 |
| C | G10 权限/审计是否足够 DAT-14 | ✅ 是——`requireProjectAccess`/`effectivePermissions`/`requireOrgManagerOnTransaction`/`runIdempotentCommand`/`insertAuditEvent` 已存在；DAT-14 新增角色感知项目访问（`getProjectAccessRole`）区分查看/处理。 |
| D | Platform Query 约束是否足够 DAT-15 | ✅ 是——G02 已建立契约优先操作、分页、时间范围、项目授权、安全投影、错误映射，DAT-15 直接复用。 |

## 三、统一 ADR 决策扫描结果

### 已有 accepted 来源（可直接使用）

| 决策 | 来源 |
|---|---|
| 错误事件协议契约（三类别正文、隐私、禁止字段） | `error-event-contract.md`（approved / implemented）+ ADR-005 |
| 错误 occurrence 存储（`(project_id, event_id)` 幂等、category/body CHECK） | ADR-018（accepted / implemented） |
| 错误事件 Processor 核心能力 | `error-event-processor.md`（approved / implemented） |
| 数据库工具链（PostgreSQL 17 + node-pg-migrate + SQL-first） | ADR-010（ingestion）/ ADR-029（platform） |
| Query 分页/时间范围/项目授权/安全投影先例 | G02 DAT-16/17/20（implemented）+ `request-metric-query-projection.md`/`performance-query-projection.md` |
| 平台 Session/CSRF/Contract/命令幂等/审计 | ADR-027/028/029/030 + G10 实现 |

### 缺少 accepted ADR 的长期决策（本包需批准）

| # | 决策 | 阻塞叶子 | proposed ADR |
|---|---|---|---|
| 1 | Issue 聚合数据模型：`issues` 表（`(project_id, fingerprint, fingerprint_version)` 聚合键、计数/首末次、生命周期列、乐观 version）+ `issue_samples` 有界代表样本表 + `issue_activities`/`issue_notes` 生命周期证据表 + `error_event_occurrences` 指纹增列 | DAT-13（DAT-14/15 依赖其数据模型） | [ADR-033](ADR-033-issue-aggregate-data-model.md) |

### 明确 deferred / not-started（G03 不得越界）

- 自定义 fingerprint 输入（v1 错误契约不含该字段，需契约扩展；DAT-12 §9 预留）；
- 页面/环境/发布/浏览器维度（v1 错误契约无字段，契约缺口；DAT-13/15 恒 `unavailable` 不伪造）；
- Source Map 与源码映射位置（DAT-18）；告警（DAT-19）；数据保留清理（SEC-02）；
- 影响用户估算（PRD §9.3.1 建议项，需独立口径，deferred）；
- Console C3—C6 页面（G11，不自动开始）。

## 四、独立评审结果（subagent，记录用）

| 评审 | ADR-033 | blocking findings |
|---|---|---|
| 架构/后端 | ACCEPT-WITH-REVISIONS | F1 缺事件应用登记表（→ `issue_event_applications`）；F2 fingerprint 交接不一致（→ DAT-12 §11 处理器计算并传入）；F3 首次 INSERT 竞态恢复（→ catch unique_violation 重锁 / ON CONFLICT）；F4 v1 无发布字段 `by_version` 重开不可实现（→ v1 只实现 `by_time`） |
| 数据库领域 | ACCEPT-WITH-REVISIONS | F1 同左（事件应用登记）；F2 `last_seen_at` 乱序回退（→ `GREATEST`）；F3 自动重开是否递增 version（→ 任何生命周期写递增）；F4 closed 枚举/计数缺 CHECK（→ 补 CHECK）；F5 子表 FK `NO ACTION` 与删除冲突（→ `ON DELETE NO ACTION` + SEC-02 定义语义） |
| 隐私/数据治理 | ACCEPT-WITH-REVISIONS | F1 帧 file 查询/片段未剥离（→ DAT-12 §6.2 截断+排除 scheme/authority）；F2 `normalized_title` 来源未冻结（→ DAT-12 §4.1 冻结 `normalizedTitle`）；F3 软删除备注仍返回 content（→ DAT-15 §6.2 已删除不返回 content） |

评审意见只用于改进决策材料，不改变 ADR 状态；正式接受必须由用户完成。**全部 load-bearing 发现已落实**到 ADR-033 决定细节 3/4/5/5b/5c/5d/8/9/10/12/13/14 与 DAT-12 §4.1/§6.2/§11、DAT-13 §4.1/§4.3/§5.1/§5.2、DAT-14 §5.2、DAT-15 §6.2（详见 ADR-033 追加记录）。

## 五、提交给用户的批准请求

请批准以下全部项（视为整体批准）：

1. **ADR-033**（Issue 聚合与有界代表样本数据模型）→ accepted（含 `issues`/`issue_samples`/`issue_activities`/`issue_notes` 表、`error_event_occurrences` 指纹增列、`(project_id, fingerprint, fingerprint_version)` 聚合键、有界代表样本策略、乐观 `version`、生命周期列存储形态、DAT-14/15 边界）
2. **DAT-12 正式规格**（[error-normalization-fingerprint.md](../architecture/error-normalization-fingerprint.md)）→ approved——归一化输入、堆栈/消息/帧安全投影、fingerprint 输入、版本 v1、分组兼容、缺失行为、隐私/脱敏、确定性；**不创建新 ADR**
3. **DAT-13 正式规格**（[issue-aggregate-representative-sample-store.md](../architecture/issue-aggregate-representative-sample-store.md)）→ approved——Issue 聚合 Repository、有界代表样本策略、并发/幂等、错误处理器聚合接线
4. **DAT-14 正式规格**（[issue-lifecycle-commands.md](../architecture/issue-lifecycle-commands.md)）→ approved——7 个生命周期 Command、服务端强制授权、状态机/负责人/优先级/备注/合并/批量、乐观并发与幂等、活动与审计
5. **DAT-15 正式规格**（[issue-query-projection.md](../architecture/issue-query-projection.md)）→ approved——`issuesListIssues`/`issuesGetIssueDetail` Query、复用 G02 模式、安全投影、诚实 unavailable 语义

**批准后**：依次进入 DAT-12 writing-plans → DAT-12 执行/验收 → DAT-13 writing-plans → … → DAT-15 → G03 group verification → feature PR/CI → merge main → Main Quality Gates → Preview CD → 公网最小 API smoke。

**批准前**：不写任何 writing-plans，不创建 Schema/Migration/Repository/handler/API 实现，不自行标记 ADR-033 accepted。

## 六、已知风险与替代

- **风险**：Issue 聚合键 `(project_id, fingerprint, fingerprint_version)` 依赖 DAT-12 fingerprint 算法稳定性；算法升级语义由 PRD §9.6 固定（新事件用新算法、不自动重组历史），本包只实现 v1；
- **风险**：有界代表样本容量 `100` 与替换策略是服务端配置常量，实际行为需真实数据观察（第一版固定顺序即可，PRD §9.3.5 不要求复杂权重）；
- **替代**：无聚合表按查询推导（方案 A）被否决（Issue 生命周期无法持久）；只聚合不存样本（方案 C）被否决（C4 无法展示代表样本）；均在 ADR-033 记录。
