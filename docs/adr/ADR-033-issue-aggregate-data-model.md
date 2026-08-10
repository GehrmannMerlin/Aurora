---
title: ADR-033：Issue 聚合与有界代表样本数据模型
status: accepted
implementation-status: implemented
approval-status: approved
owner: processing/backend
date: 2026-08-10
last-reviewed: 2026-08-10
applies-to: packages/processing-store（@aurora/processing-store）的 Issue 聚合数据模型（issues 表、issue_samples 表、issue_activities 表、issue_notes 表、error_event_occurrences 指纹增列、persistIssueContribution Repository、有界代表样本策略执行器）
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/architecture/error-event-occurrence-processing-store.md
  - ../../docs/architecture/error-event-processor.md
  - ../../docs/architecture/error-normalization-fingerprint.md
  - ../../docs/architecture/request-event-sample-processing-store.md
  - ../../docs/architecture/request-metric-aggregate-store.md
  - ../../docs/architecture/performance-metric-aggregate-and-bounded-sample-store.md
  - ../../docs/adr/ADR-018-error-event-occurrence-processing-storage.md
  - ../../docs/adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
superseded-by: none
---

# ADR-033：Issue 聚合与有界代表样本数据模型

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-user-approval
- 日期：2026-08-10
- Owner：processing/backend
- 适用范围：`packages/processing-store`（`@aurora/processing-store`）的 Issue 聚合数据模型（`issues` 表、`issue_samples` 表、`issue_activities` 表、`issue_notes` 表、`error_event_occurrences` 指纹增列、`persistIssueContribution` Repository、有界代表样本策略执行器）
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 9.1—9.7、10、16、18 节
- 关联协议：[错误事件协议契约](../../docs/protocol/error-event-contract.md)（approved / implemented）
- 关联 DAT-12 规格：[错误归一化与 fingerprint 分组算法](../../docs/architecture/error-normalization-fingerprint.md)（approved / not-started）
- 关联 Error store：[错误事件 occurrence 处理存储正式规格](../../docs/architecture/error-event-occurrence-processing-store.md)（implemented）
- 关联 Processor：[具体错误事件 Processor 核心能力正式规格](../../docs/architecture/error-event-processor.md)（implemented）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-10 创建为 `proposed`。创建依据：G03 分组基线（`aurora-v1-remaining-module-batches.md`）明确 DAT-13 "独立数据模型 ADR/规格缺失" 且 "必须先回读 DAT-12 的 accepted 决策"；用户 G03 readiness 规则明确 **DAT-13 Issue 数据模型必须有 accepted ADR**。ADR 规范 §7.2 触发：新增核心处理聚合表、Migration/回滚成本高、Issue 身份跨算法版本与生命周期有长期迁移成本，需长期保留取舍依据。本 ADR 处于 `proposed / not-started / awaiting-user-approval`。它需要独立非作者架构/后端评审、数据库领域评审与隐私/数据治理评审（可派发 reviewer subagent），但评审意见不代替用户正式批准。**在用户批准（accepted）前，不得创建正式 Migration、实现代码，不得进入 writing-plans。**

## 背景

Aurora 已接受 ADR-004/005/008/010/012/018/019/020/021，`@aurora/processing-store` 已实现错误 occurrence 存储（`error_event_occurrences`，`(project_id, event_id)` 幂等）、请求样本/指标存储、性能聚合/样本存储。DAT-12 将把错误事件规范化为带版本语义的 fingerprint/group key 并随 occurrence 落库。

当前真实缺口：错误事件被逐条持久化为 occurrence，但**没有任何 Issue 聚合**。PRD §9.1 定义"一个问题代表多次相似事件的聚合结果"；§9.2 定义默认问题识别（项目、错误类型、归一化错误信息、关键调用栈）；§9.3 定义"总量持续统计、完整事件只保留有限代表样本"（每个问题最多保留最近 100 条完整事件样本，服务端配置）；§9.6 定义聚合算法版本（新事件用新算法、不自动重组历史）；§10 定义问题处理生命周期（open/in_progress/resolved/ignored、负责人、优先级、备注、合并、再次出现重开）。但 PRD 未明确 Issue 聚合的**物理存储边界**（聚合表结构、指纹与版本关系、计数/首末次语义、样本容量/替换策略、生命周期列归属、并发/幂等）。Issue 物理模型属于需要长期保留取舍依据的高迁移成本决策，且用户明确要求 accepted ADR，故创建本独立 ADR。

## 决策驱动因素

- **聚合是 Issue 主对象**：PRD §9.1 明确 Issue 是多次相似事件的聚合结果；C3/C4 UX 以 Issue 为主对象展示总次数、首末次、样本与活动；
- **fingerprint 是聚合键**：DAT-12 的 fingerprint/版本语义决定哪些 occurrence 属于同一 Issue；算法版本升级不得静默改变历史 Issue 身份（PRD §9.6）；
- **生命周期需要持久身份**：Issue 状态/负责人/优先级/合并由 DAT-14 Command 管理，需要可并发更新的持久行，不能只靠查询推导；
- **有界代表样本**：PRD §9.3.2 每个问题最多保留 100 条完整事件样本，高频重复事件不无限占用存储/额度；
- **复用已批准工具链**：与 Error/Request/Performance store 一致使用 PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first；
- **不建完整事件历史**：第一版不构建完整逐错误历史产品（PRD §9.3 边界）；样本是"有限代表样本"，不是完整日志；
- **隐私与配额**：Issue/样本投影必须保持错误契约的安全边界，不得泄露未经批准的原始错误字段。

## 现有约束

- ADR-005：外部输入按不可信数据运行时校验；event-schema 是事件 Schema 唯一来源；
- ADR-008：`(project_id, event_id)` 租户作用域幂等键；
- ADR-010：PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first；Migration 追加式；
- ADR-018：`error_event_occurrences` 结构、`(project_id, event_id)` 幂等、`error_category` 来自 event-schema 常量、`normalized_body` 受协议约束 jsonb；**本 ADR 不修改其既有列/约束**，只允许后续 additive 增列；
- ADR-019/020/021：请求/性能聚合先例；只作事务/幂等/隐私/稳定错误模式参考，不自动授权 Issue 表结构；
- 错误事件协议契约：`ErrorEventBody` 三类别、`ErrorDescriptor`（name/message/stack）、资源错误（type/url）；错误正文**不含**页面/环境/发布版本/浏览器字段；
- DAT-12 规格：`computeErrorFingerprint` 纯函数、`ERROR_FINGERPRINT_VERSION = 1`、`error_event_occurrences` 增列 `fingerprint`/`fingerprint_version`；
- PRD §9.1—9.7、§10、§16、§18 与 C3/C4 UX §7.18—7.19、§8.16—8.17、§9.16—9.17、§10.10—10.11；
- 代码规范：严格 TypeScript、参数化 SQL、稳定结果、不暴露 SQLSTATE/约束名/SQL、敏感信息不入日志。

## 候选方案

### 方案 A：无聚合表，按 occurrence 查询推导 Issue（不采用）

**行为**：不建 `issues` 表；查询时按 `(project_id, fingerprint, fingerprint_version)` 从 `error_event_occurrences` 分组聚合计数/首末次。

**优点**：无冗余状态；无迁移；实现直接。

**缺点**：与"总量持续统计"的聚合主路径冲突（每次查询都扫描全部 occurrence，量级随错误增长）；Issue 生命周期状态/负责人/优先级/合并无法可靠持久（需要独立状态存储）；无法支撑 C3/C4 高频查询；无法支撑 DAT-14 Command 并发更新与再次出现重开。

**选择结论**：不采用。

### 方案 B：Issue 聚合表＋有界代表样本表（推荐）

**行为**：建 `issues` 聚合表（项目内以 `(project_id, fingerprint, fingerprint_version)` 为聚合键，维护 occurrence_count、first_seen_at、last_seen_at、生命周期列）＋ `issue_samples` 有界代表样本表（每个 Issue 最多 100 条安全投影样本，按 PRD §9.3.3/§9.3.5 固定优先级替换）。

**优点**：聚合主路径符合 PRD §9.1/§9.3；Issue 身份稳定、生命周期可持久、Command 可并发更新；查询高效；样本有界控制存储/隐私/额度；指纹版本语义可保留历史 Issue 身份。

**缺点**：需要聚合与样本两个存储边界；样本替换策略需要明确固定优先级；计数与样本不同步时需明确"总次数 vs 已保留样本"分离展示（PRD §9.3.6）。

**选择结论**：采用。

### 方案 C：只建 Issue 聚合表，不存任何代表样本（不采用）

**行为**：只维护 Issue 计数/首末次/生命周期，不保存任何样本。

**优点**：数据量和隐私风险最低；数据模型简单。

**缺点**：C4 问题详情无法展示代表样本（PRD §9.3.6 明确展示首次事件、最新事件、最近代表样本）；问题定位缺少诊断证据。

**选择结论**：不采用。

### 候选比较

| 维度 | A：查询推导 | B：聚合＋有界样本 | C：只聚合 |
| --- | --- | --- | --- |
| 聚合主路径与查询成本 | 差（全扫） | 好 | 好 |
| Issue 生命周期持久 | 否 | 是 | 是 |
| 代表样本（C4 需要） | 无 | 有（有界） | 无 |
| 存储/隐私/额度成本 | 无新表 | 可控 | 最低 |
| 并发 Command/再次出现重开 | 不支持 | 支持 | 支持 |
| 指纹版本保留历史身份 | 隐式 | 显式列 | 显式列 |
| 第一版成本 | 低 | 中 | 低 |

## 最终决策

**最终选择方案 B：Issue 聚合表＋有界代表样本表。**

### 决定细节（全部在本 ADR 冻结）

1. **存储边界**：`@aurora/processing-store` 新增 `issues` 聚合表 + `issue_samples` 有界代表样本表；DAT-12 已为 `error_event_occurrences` 增加 `fingerprint`/`fingerprint_version` 增列；本 ADR 不修改其既有列/约束。Issue 聚合更新由错误事件处理器（DAT-13 Processor 集成）调用 `persistIssueContribution` Repository 完成。
2. **Issue 身份**：项目作用域 `(project_id, fingerprint, fingerprint_version)` 唯一；`fingerprint_version` 保留历史 Issue 身份（PRD §9.6 新事件用新算法、不自动重组历史）；Issue 的 `fingerprint` 来自 DAT-12 `computeErrorFingerprint`。
3. **`issues` 表结构**：
   - `id bigserial PK`、`project_id uuid NOT NULL`、`fingerprint varchar(1024) NOT NULL`、`fingerprint_version integer NOT NULL`、`category varchar(64) NOT NULL`（来自 event-schema `ErrorCategory` 常量）、`normalized_title varchar NOT NULL`（安全投影标题，DAT-12 冻结的归一化消息有界截断，供 C3 列表/详情使用）、`first_seen_at timestamptz NOT NULL`、`last_seen_at timestamptz NOT NULL`、`occurrence_count bigint NOT NULL DEFAULT 1`、`sample_count integer NOT NULL DEFAULT 0`、`version integer NOT NULL DEFAULT 1`（乐观并发版本，DAT-14 Command 携带并校验；并发冲突 409；处理器自动重开等**任何**生命周期写也递增）、`created_at timestamptz NOT NULL DEFAULT now()`、`updated_at timestamptz NOT NULL DEFAULT now()`；
   - 唯一约束 `(project_id, fingerprint, fingerprint_version)`；CHECK 同 ADR-018/020 先例：`category IN ('javascript','unhandled_rejection','resource')`、`status IN ('open','in_progress','resolved','ignored')`、`priority IN ('urgent','high','medium','low')` 或 NULL、`resolved_reason IN ('by_version','by_time')` 或 NULL、`occurrence_count >= 1`、`sample_count >= 0`、`0 <= sample_count <= occurrence_count`；
   - 索引 `(project_id, status, last_seen_at)` 支撑 C3 列表；`(project_id, fingerprint, fingerprint_version)` 唯一约束同时支撑项目作用域查询（不另加冗余 `project_id` 索引）。
4. **生命周期列（DAT-14 管理，本 ADR 冻结存储）**：`status varchar(16) NOT NULL DEFAULT 'open'`（closed 枚举 `open`/`in_progress`/`resolved`/`ignored`，PRD §10.1）、`assignee_account_id uuid NULL`、`priority varchar(16) NULL`（`urgent`/`high`/`medium`/`low`，PRD §10.3）、`resolved_at timestamptz NULL`、`resolved_version varchar NULL`、`resolved_reason varchar NULL`（`by_version`/`by_time`）、`ignored_until timestamptz NULL`（NULL=永久忽略）、`merged_into_issue_id bigint NULL`（PRD §9.7 合并；原问题标记已合并，旧链接跳主问题）。列语义由 DAT-14 Command 规格冻结；本 ADR 只确定存储形态。**任何写入生命周期列的路径（DAT-14 Command 或 DAT-13 聚合侧自动重开）都必须递增 `version`**，保持"version 每次生命周期写前进"不变量。
5. **`issue_samples` 表结构**：
   - `id bigserial PK`、`issue_id bigint NOT NULL`（FK → `issues.id`，`ON DELETE NO ACTION`；SEC-02 定义项目作用域删除/保留语义）、`project_id uuid NOT NULL`、`event_id varchar(128) NOT NULL`、`occurred_at timestamptz NOT NULL`、`sample_body jsonb NOT NULL`（受协议约束安全投影）、`sample_kind varchar(32) NOT NULL`（`first`/`latest`/`reappeared`/`unique_environment`/`unique_release`/`unique_browser`/`unique_page`/`higher_severity`/`regular`，PRD §9.3.3）、`created_at timestamptz NOT NULL DEFAULT now()`；
   - 唯一约束 **`(project_id, event_id)`**（幂等；与 `request_event_samples`/`performance_event_samples` 的 `(project_id, event_id)` 约定一致，同一事件不可能在指纹版本缺陷下被两个 Issue 重复采样）；CHECK `jsonb_typeof(sample_body) = 'object'`、`sample_kind` closed 枚举 CHECK；
   - `issue_id` 索引支持 C4 样本查询；`issue_samples` 无 `protocol_version` 列（v1 单版本前向兼容假设，与 ADR-021 性能样本先例一致）。
5b. **`issue_event_applications` 表结构（事件应用登记，ADR-020/021 先例）**：
   - `project_id uuid NOT NULL`、`event_id varchar(128) NOT NULL`、`issue_id bigint NOT NULL`（FK → `issues.id`，`ON DELETE NO ACTION`）、`created_at timestamptz NOT NULL DEFAULT now()`；
   - 唯一约束 **`(project_id, event_id)`**：每个事件**至多应用一次** Issue 聚合。聚合计数/首末次更新只在首次应用时执行（`ON CONFLICT DO NOTHING`），与 Issue 行 UPSERT 同事务。该登记表解决 Worker retry/ADR-017 人工重放下 `occurrence_count` 重复累加问题（ADR-020 `request_metric_event_applications`/ADR-021 `performance_metric_event_applications` 同款）。
5c. **`issue_activities` 表结构（DAT-14 系统活动，PRD §10.6）**：
   - `id bigserial PK`、`issue_id bigint NOT NULL`（FK → `issues.id`，`ON DELETE NO ACTION`）、`project_id uuid NOT NULL`、`actor_account_id uuid NULL`（NULL=系统自动动作，如再次出现自动重开）、`activity_type varchar(32) NOT NULL`（closed 枚举：`status_changed`/`assignee_changed`/`priority_changed`/`marked_resolved`/`reappeared`/`ignored`/`reopened`/`merged`/`note_added`/`note_deleted`，CHECK）、`details jsonb NOT NULL`（安全结构化详情：from/to 状态、旧/新负责人、版本等；禁止 token/secret/完整 email/备注正文）、`created_at timestamptz NOT NULL DEFAULT now()`；
   - `issue_id` 索引；**不可编辑、不可删除**（PRD §10.6 系统活动不可编辑和删除）；幂等由 Command 事务保证（一次 Command 写一条活动，重放不重复写）。**`ON DELETE NO ACTION` 与不可删除不变量一致**：只要活动存在，对应 Issue 行不得被删除（SEC-02 删除/保留语义另行定义）。
5d. **`issue_notes` 表结构（DAT-14 成员备注，PRD §10.6）**：
   - `id bigserial PK`、`issue_id bigint NOT NULL`（FK → `issues.id`，`ON DELETE NO ACTION`）、`project_id uuid NOT NULL`、`author_account_id uuid NOT NULL`、`content varchar NOT NULL`（Markdown，长度上限由 DAT-14 规格冻结）、`created_at timestamptz NOT NULL DEFAULT now()`、`deleted_at timestamptz NULL`、`deleted_by_account_id uuid NULL`；
   - `issue_id` 索引；发布后不可编辑（PRD §10.6）；作者可软删除自己的备注、项目管理员可删除包含敏感信息的备注（DAT-15 详情投影对已删除备注**不返回 `content`**，使管理员敏感删除在读取路径有效）；不支持附件/回复/提及。
6. **代表样本容量（PRD §9.3.2）**：每个 Issue 最多保留 `100` 条完整事件样本（服务端配置常量 `DEFAULT_MAX_ISSUE_SAMPLES = 100`，不写死在前端）。达到上限后：新事件仍更新计数/首末次；只有满足代表性条件的新事件才替换普通重复样本；被替换的完整事件按事件保留策略清理；首次事件和再次出现事件不能被普通重复样本替换。
7. **样本优先保留（PRD §9.3.3）**：问题首次发生事件、当前最新事件、新发布版本首条、新运行环境首条、新浏览器类型首条、新页面/新接口首条、问题再次出现首条、严重级别更高、包含有效源码映射结果。**v1 错误契约不含发布/环境/浏览器/页面字段**，因此这些维度在 v1 只能以 `regular`/`first`/`latest`/`reappeared` 为主；发布/环境/浏览器/页面维度是**契约缺口**，不得凭空造列（与 ADR-020/021 同口径）。
8. **样本替换顺序（PRD §9.3.5）**：达到上限后按固定顺序优先淘汰：① 同版本/同环境/同浏览器/同页面重复样本；② 时间较早且无独特上下文的普通样本；③ 已被更完整源码映射样本替代的原始堆栈样本。不得优先淘汰：首次样本、最新样本、再次出现样本、唯一环境/版本/浏览器/页面样本。第一版不建设复杂权重算法，只用明确固定顺序（PRD §9.3.5）。**替换目标固定**：优先替换最旧 `regular` 样本；若无可替换 `regular`，新 `latest` 替换最旧 `latest`、新 `reappeared` 替换最旧 `reappeared`（保证"当前最新事件优先保留"），`first` 永不替换（创建时固定）。
9. **聚合更新语义（Processor 集成）**：错误事件处理器对已 fingerprint 的 occurrence 调用 `persistIssueContribution`：先同事务登记 `issue_event_applications (project_id, event_id)`（`ON CONFLICT DO NOTHING`）；登记成功才更新聚合：首次 fingerprint → INSERT Issue（`occurrence_count=1`、`first_seen_at=last_seen_at=occurredAt`）+ 存 `first` 样本；已存在 → UPSERT Issue（`occurrence_count+1`、`last_seen_at = GREATEST(last_seen_at, occurredAt)`、`first_seen_at` 不变，防止乱序处理回退 last_seen_at）+ 按样本策略决定存/替换样本。`(project_id, event_id)` 幂等防止重复应用。
10. **并发/幂等（PRD §10.2 并发处理先例）**：`(project_id, fingerprint, fingerprint_version)` 唯一约束保证并发同指纹首次 occurrence 只创建一个 Issue；**首次 INSERT 竞态恢复固定**：并发首次 occurrence 同时尝试 INSERT 时，输方命中唯一约束——`persistIssueContribution` 捕获 `unique_violation` 后重新加锁（`SELECT ... FOR UPDATE`）并作为已存在路径应用（或采用 INSERT-first `ON CONFLICT DO NOTHING RETURNING id` 形态，见 DAT-13 规格 §5.1），保证"只创建一个 Issue"且不丢失合法 applied 结果；聚合更新在事务内 `SELECT ... FOR UPDATE` 锁定 Issue 行后做计数/首末次更新（与 ADR-017 行锁先例一致）；样本 `(project_id, event_id)` 唯一防止并发重复样本；`issue_event_applications (project_id, event_id)` 唯一防止重复应用。禁止先查后插的 TOCTOU。
11. **无跨 Store 事务**：occurrence 持久化与 Issue 聚合是两次独立持久化调用；收敛通过 retry + 各自幂等实现，不引入 Store 间事务协调（与请求 metric/sample 跨 Store 收敛一致）。
12. **再次出现重开（PRD §10.4）**：`resolved`/`ignored_until` 的 Issue 在收到满足重开条件的新 occurrence 时自动恢复为 `open` 并标记再次出现——该规则属于 Processor/Command 侧语义，本 ADR 只冻结存储形态（`status`/`resolved_at`/`resolved_version`/`ignored_until` 列）与**任何生命周期写递增 `version`** 的不变量。**v1 只实现 `by_time` 重开**（`resolved_at` 之后真实发生的新事件）；`by_version` 重开依赖发布字段（v1 错误契约缺省，契约缺口），需未来协议扩展后实现。
13. **隐私**：`issue_samples.sample_body` 是受协议约束的安全投影 jsonb（与 ADR-018 `normalized_body` 同口径：排除 Cookie/Authorization/request/response body/完整 URL 查询/token/secret；自由文本 message/stack 的清洁度依赖生产者隐私过滤边界，见 error-event-contract §7）；`normalized_title` 只含归一化占位符（DAT-12 §10 隐私边界）；禁止请求/响应体、Cookie、Authorization、完整 URL 查询、token、secret。
14. **数据保留**：PRD §16/§18 定义 Issue/样本保留边界；本 ADR 不实现清理任务；表中不预置 `expires_at` 列。SEC-02 删除样本时须同步递减 `issues.sample_count`。
15. **不修改**：error-event-contract、ingestion-api、POST /v1/batches、Worker 运行时、Error/Request/Performance store 既有表与 Repository、retry/backoff/replay、event-schema；`error_event_occurrences` 只接受 DAT-12 已冻结的 additive 增列。
16. **包边界**：扩展现有 `packages/processing-store`（`aurora.layer: data`），不新建包；新增 Migration 时间戳晚于 DAT-12 指纹增列 Migration；`@aurora/processing-store` 不新增运行时依赖。
17. **Repository 稳定错误**：`invalid_input`、`temporarily_unavailable`、`inserted`/`duplicate`/`applied`；不暴露 SQLSTATE/约束名/SQL。
18. **真实 PostgreSQL 门禁**：集成测试必须使用真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL`（目标必须是测试数据库）；禁止 SQLite/mock/PGlite 证明数据库约束。
19. **DAT-14/15 边界**：DAT-14 Issue 生命周期 Command 通过未来公开 Command/Repository 接口更新 Issue 生命周期列并写入 `issue_activities`/`issue_notes`，不得直接执行 SQL；DAT-15 Issue Query 只能通过未来公开 Query/投影接口读取 `issues`/`issue_samples`/`issue_event_applications`/`issue_activities`/`issue_notes`，不得直接复用写侧 Repository 内部或直接执行 SQL。
20. **跨 Store 计数一致性**：Issue `occurrence_count` 是聚合主路径的权威计数（事件应用登记保证不重复累加）；C3/C4 展示"总发生次数 vs 已保留完整样本"分离（PRD §9.3.6）；不得用 `sample_count` 冒充总量。

## 结果与影响

### 正面影响

- 符合 PRD §9.1/§9.3/§9.6 聚合主路径与算法版本语义；
- Issue 身份稳定，生命周期可持久，Command 可并发更新；
- 支持 C3 列表/C4 详情的真实查询与代表样本展示；
- 样本有界控制存储、隐私和额度；
- 与 Error/Request/Performance store 复用同一工具链。

### 负面影响与代价

- 需要聚合与样本两个存储边界；
- 样本替换策略需要明确固定优先级；
- 发布/环境/浏览器/页面维度缺协议字段，C3/C4 维度筛选依赖未来协议扩展；
- 计数与样本不同步时需"总次数 vs 已保留样本"分离展示。

### 未解决问题

- 发布/环境/浏览器/页面维度的协议扩展（契约缺口，DAT-18/后续）；
- Source Map 位置进入样本/分组（DAT-18）；
- 数据保留期限的清理任务（SEC-02）；
- Issue 合并/拆分的历史重算（PRD §9.7 第一版只保留合并，不做拆分）；
- 影响用户估算（PRD §9.3.1 建议项；需独立口径与数据，deferred）；
- 生产容量/成本基准（requires-benchmark）。

## 实施约束

- 完全遵守 ADR-005/008/010/012/018/019/020/021 与 DAT-12 规格；不修改 `@aurora/ingestion-inbox`、`@aurora/event-schema`、`apps/ingestion-worker`、`apps/ingestion-api`、OpenAPI；
- `@aurora/processing-store` 新增 `issues`/`issue_samples` Migration 与 `persistIssueContribution` Repository + 有界代表样本策略执行器；不创建通用 Repository 泛型框架；
- 输入经 `@aurora/event-schema` 根入口验证；样本只保存安全投影字段；
- SQL 全参数化；不暴露 SQLSTATE/约束名/SQL；
- 不记录请求体/响应体/Header/Cookie/Authorization/敏感查询/完整 URL/DOM/文本/IP/指纹；
- Workspace Policy：`data → {protocol}`（现有允许矩阵已支持）。

## 迁移方案

本 ADR accepted 后：DAT-13 正式规格从 draft 更新为 approved → writing-plans → 实施 `issues`/`issue_samples` Migration + `persistIssueContribution` Repository + 有界代表样本策略执行器 + 错误事件处理器集成 → 真实 PostgreSQL 17 集成验证。

## 回滚方案

- Migration 发布前缺陷：可直接修改未发布 Migration；
- Migration 发布后：向前修复与 expand/contract；destructive down 不作为生产默认回滚；
- Repository 实现与 Worker 主循环/既有 store 解耦，可替换而不影响既有公共接口。

## 验证方式

- 单元测试：`persistIssueContribution` 输入校验、聚合更新（首次/重复）、样本容量上限、样本替换优先级、并发幂等、输入不变、稳定结果、不泄露数据库错误；
- 真实 PostgreSQL 17：首次创建、重复聚合、并发同指纹只建一个 Issue、样本有界（超过 100 不超）、样本替换、项目隔离、Migration up/down/up、Schema/Pool 清理；
- 回归：event-schema、Error store、Request/Performance store、Worker、ingestion-api 全部测试通过；OpenAPI 无变化；
- 全仓质量门禁与覆盖率 85/80/85/85。

## 重新评估条件

- 错误量变化使 `issues` 聚合键或样本容量不满足 C3/C4；
- 需要发布/环境/浏览器/页面维度且协议字段已批准；
- 需要完整逐错误历史；
- 数据生命周期规则要求同步 Issue 表保留；
- 需要样本支持重算聚合。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-10：创建（proposed）

- 状态 `proposed / not-started / awaiting-user-approval`；
- 由 G03 正式化扫掠创建；用户 G03 readiness 规则明确 DAT-13 Issue 数据模型必须有 accepted ADR；
- 审计确认：`error_event_occurrences` implemented（ADR-018）；DAT-12 规格 approved/not-started；无既有 Issue 聚合规格/ADR；ADR-019/020/021 只作先例不授权 Issue 模型；错误事件协议层无页面/环境/发布/浏览器字段；
- DAT-13 正式规格（draft）已同步创建：[issue-aggregate-representative-sample-store.md](../../docs/architecture/issue-aggregate-representative-sample-store.md)；
- 未调用 writing-plans、未创建 Migration、未实施代码；
- 等待独立非作者与隐私/数据治理评审 + 用户正式批准，不自动批准、不实施。

### 2026-08-10：独立评审（reviewer subagent，记录用，不代替正式批准）

> 本节点记录 reviewer subagent 意见。意见只用于改进决策材料，不改变 ADR 状态。正式接受必须由用户完成。

三路评审均为 `ACCEPT-WITH-REVISIONS`（无 REJECT）：

- **架构/后端评审**：数据模型忠实 PRD §9/§10 与 ADR-018/020/021 先例；依赖方向符合 Workspace Policy。
  - Load-bearing：F1 缺事件应用登记表导致 `occurrence_count` 在 retry/重放下重复累加（`issue_event_applications` 修正，决定细节 5b/9/10）；F2 fingerprint 交接 DAT-12/DAT-13 不一致（DAT-12 §11 已改为处理器经 `computeErrorFingerprint` 计算并传入 store）；F3 首次 INSERT 竞态恢复未固定（决定细节 10 修正为 catch `unique_violation` 重锁或 INSERT-first `ON CONFLICT`）；F4 DAT-14 `by_version` 重开在 v1 无发布字段不可实现（决定细节 12 修正为 v1 只实现 `by_time`）。
  - 非阻断：N1 编号顺序；N2 时间趋势（PRD §9.3.1）无逐桶计数表（DAT-15 v1 无趋势端点，记录）；N3 fingerprint 内嵌版本前缀与 `fingerprint_version` 列一致性不变量未文档化；N4 样本替换无 `regular` 可替换时的边界；N5 DAT-13 早于 DAT-14 时自动重开无 `reappeared` 活动；N6 `normalized_title` 来源未冻结。
- **数据库领域评审**：类型/键/CHECK/迁移符合 SQL-first 工具链；F1 同架构（事件应用登记）；F2 `last_seen_at` 无条件置 occurredAt 会在乱序处理时回退（决定细节 9 修正为 `GREATEST`）；F3 处理器自动重开是否递增 `version` 未固定（决定细节 3/4 修正为任何生命周期写递增）；F4 closed 枚举/计数缺 CHECK（决定细节 3/5/5c 修正加 CHECK）；F5 子表 FK 默认 `NO ACTION` 与未来删除冲突（决定细节 5/5c/5d 修正为 `ON DELETE NO ACTION` + SEC-02 定义删除/保留语义）。
- **隐私/数据治理评审**：边界设计符合仓库隐私规则；F1 帧 `file` 查询/片段未剥离（DAT-12 §6.2 修正为截断查询/片段并排除 scheme/authority）；F2 `normalized_title` 来源未冻结 + 引用错误（DAT-12 §4.1 冻结 `normalizedTitle` 输出；DAT-13 引用改为 §4.1/§10）；F3 软删除备注仍返回 content（DAT-15 §6.2 修正为已删除备注不返回 content）。
  - 非阻断：N1 `error.name` 作为稳定组件未做占位符替换（记录）；N2 `sample_body` 自由文本清洁度依赖生产者边界（记录）；N3 活动/审计排除规则是调用方纪律；N4 `sample_kind` v1 不可能值不设为可筛选；N5 SEC-02 删样本须递减 `sample_count`（决定细节 14 记录）；N6 原始 fingerprint 不出现在 Query（保持）；N7 跨项目再识别由作用域封闭。

**评审落实**：上述 load-bearing 发现全部落实到 ADR-033 决定细节 3/4/5/5b/5c/5d/8/9/10/12/13/14 与 DAT-12 §4.1/§6.2/§11、DAT-13 §4.1/§4.3/§5.1/§5.2、DAT-14 §5.2、DAT-15 §6.2。详见各节修订。

### 2026-08-10：状态——等待用户批准

- 本 ADR 保持 `proposed / not-started / awaiting-user-approval`；
- 用户需批准的具体事项：方案 B（Issue 聚合表＋有界代表样本表）、`(project_id, fingerprint, fingerprint_version)` 聚合键、`issue_event_applications (project_id, event_id)` 事件应用登记、`occurrence_count`/`first_seen_at`/`last_seen_at`（`GREATEST`）聚合语义、`DEFAULT_MAX_ISSUE_SAMPLES = 100` 有界样本与固定替换策略、生命周期列（含乐观 `version`）、`issue_activities`/`issue_notes` 生命周期证据表、`error_event_occurrences` 指纹增列、v1 只实现 `by_time` 重开、扩展 processing-store 不新建包；
- **`by_version` 重开 deferred**：依赖发布字段（v1 错误契约缺省，契约缺口），需未来协议扩展；
- **页面/环境/发布/浏览器维度 deferred**：契约缺口，恒 `unavailable` 不伪造；
- 用户批准前：不创建正式 Migration、不实现代码、不进入 writing-plans。

### 2026-08-10：用户正式批准（accepted）

- 用户已于 2026-08-10 对 G03 APPROVAL PACKAGE 作出整体正式批准（"整体批准（Recommended）"），批准范围（逐条）：
  1. 方案 B：Issue 聚合表＋有界代表样本表；
  2. `(project_id, fingerprint, fingerprint_version)` 项目作用域聚合键（fingerprint 来自 DAT-12 `computeErrorFingerprint`，`fingerprint_version` 保留历史 Issue 身份）；
  3. `issue_event_applications (project_id, event_id)` 事件应用登记（防 retry/重放下计数重复累加）；
  4. `occurrence_count`/`first_seen_at`/`last_seen_at`（`GREATEST`）聚合语义与 `DEFAULT_MAX_ISSUE_SAMPLES = 100` 有界样本固定替换策略；
  5. 生命周期列（四状态/负责人/优先级/解决/忽略/合并，乐观 `version` 每次生命周期写递增）与 `issue_activities`/`issue_notes` 生命周期证据表；
  6. `error_event_occurrences` 指纹增列（DAT-12 实施）；
  7. v1 只实现 `by_time` 重开；`by_version` 重开与页面/环境/发布/浏览器维度为契约缺口 deferred；
  8. 扩展 `@aurora/processing-store`，不新建包；
  9. 本 ADR 从 proposed 转为 accepted。
- 批准范围仅适用于本 ADR 已记录并经过评审修订的决策范围；不得扩大到 DAT-14/15 之外的 Command/Query 实现、自定义 fingerprint、Source Map、告警、数据保留、新基础设施；
- 状态更新：`status: accepted`、`decision-status: accepted`、`approval-status: approved`、`implementation-status: not-started`；
- 原 proposed 历史记录完整保留；实施状态保持 `not-started`，直到 DAT-13 正式实施开始；本 ADR 不得在此时标记为 implemented 或 in-progress。

### 2026-08-10：DAT-13 Issue 聚合与有界代表样本存储实施证据

- 实施状态更新为 `implemented`：`@aurora/processing-store` Issue 聚合与有界代表样本存储能力已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁；Issue 生命周期 Command（DAT-14）、Issue Query（DAT-15）、`issue_activities`/`issue_notes` 表仍未实现，故不扩大范围；
- 实施内容：Migration `1722500000008_issue-aggregate-and-samples.ts`（`issues` + `issue_event_applications` + `issue_samples`，决定细节 3/5/5b/5c/5d 的 DAT-13 部分：聚合键/计数/首末次/生命周期列/乐观 version/closed 枚举与计数 CHECK/`(project_id, event_id)` 事件应用 PK/样本幂等/FK `ON DELETE NO ACTION`）；`src/issue-contribution-types.ts`（`PersistIssueContributionInput`/`Result`/`DEFAULT_MAX_ISSUE_SAMPLES=100`）；`src/issue-sample-decision.ts`（`decideIssueSample` 固定优先级：容量内 store、regular 满 skip、priority 替换最旧 regular/latest/reappeared、first 永不替换）；`src/issue-contribution-repository.ts`（`persistIssueContribution`：`(project_id, event_id)` 事件应用登记防重复累加、`last_seen_at = GREATEST`、首次 INSERT `ON CONFLICT DO NOTHING` + 重锁恢复、`by_time` 再次出现重开 + `version` 递增、样本有界存储/替换、无跨 Store 事务）；`apps/ingestion-worker` `createErrorEventProcessor` 注入 `contributeIssue`（默认 no-op 保持 DAT-12 行为，生产接线时注入真实 `persistIssueContribution`）；
- 语义（决定细节 1—20 落实）：聚合键 `(project_id, fingerprint, fingerprint_version)`；事件应用登记防 retry/重放下计数重复；`first_seen_at` 不变、`last_seen_at` `GREATEST` 防乱序回退；`occurrence_count >= 1`/`sample_count <= occurrence_count` CHECK；样本 `(project_id, event_id)` 幂等；`by_time` 重开（`resolved_at`/`ignored_until` 之后新事件）；v1 不实现 `by_version` 重开与页面/环境/发布维度（契约缺口）；
- 未修改：error-event-contract/ingestion-api/Worker 运行时/既有 store 表与 Repository/retry/backoff/replay/event-schema；未增加新包；
- 测试：单元测试（`decideIssueSample` 决策矩阵 + `persistIssueContribution` 输入校验）+ 真实 PostgreSQL 17.10 集成测试（迁移 4 + Issue 聚合 8 + 既有回归全绿，共 12 文件 94 集成测试）+ Worker 290 测试，覆盖率达 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%，全仓质量门禁通过；
- 正式规格：[issue-aggregate-representative-sample-store.md](../architecture/issue-aggregate-representative-sample-store.md)（approved + implemented）；
- 状态记录：issue aggregate and bounded representative sample store implemented；Issue lifecycle Commands not-started（DAT-14）；Issue Query not-started（DAT-15）；production worker composition not-started / blocked（DAT-13 处理器贡献为可注入，未接入生产 composition root）；本 ADR 实施状态更新为 implemented。

### 2026-08-10：DAT-14 Issue 生命周期 Command、活动与审计实施证据

- 决策状态保持 `accepted`，实施状态保持 `implemented`；本 ADR 决定细节 3/4/5c/5d（生命周期列、乐观 `version`、`issue_activities`/`issue_notes` 表）由 DAT-14 实施（正式规格 [issue-lifecycle-commands.md](../architecture/issue-lifecycle-commands.md) approved + implemented）；
- 实施内容：Migration `1722500000009_issue-activities-notes.ts`（`issue_activities` immutable 时间线 + `issue_notes` 软删除备注，`ON DELETE NO ACTION`）；`@aurora/processing-store` 生命周期 Repository（`updateIssueState`：closed 转移表 + 开始处理自动分配同事务 + resolution/ignore 载荷 + 乐观 `version` + 活动；`updateIssueAssignee`/`updateIssuePriority`/`createIssueNote`/`deleteIssueNote`（作者或管理员）/`mergeIssues`（计数/首末次并入主问题 + 原问题标记）/`batchUpdateIssues`（≤100 逐项部分结果））；`@aurora/platform-project-governance` `getProjectAccessRole`（org manager → project_admin，project_members role）；`@aurora/platform-contract` 7 个 Command 操作（`issuesUpdateState`/`Assignee`/`Priority`/`CreateNote`/`DeleteNote`/`Merge`/`BatchUpdate`）；`apps/platform-api` 7 个 handler（`requireProjectHandleAccess`、CSRF、幂等、审计经 `insertAuditEvent`）；
- **不修改本 ADR 决定细节**：生命周期列/`version`/活动/备注表结构按决定细节 3/4/5c/5d 实施；`by_time` 重开由 DAT-13 聚合侧保持；`by_version` 重开仍 deferred（契约缺口）；
- 测试：`@aurora/processing-store` 129 单元 + 94 真实 PG 集成；`@aurora/platform-contract` 244 契约测试 + drift；`apps/platform-api` 20 文件 132 真实 PG+Redis 集成（含 5 个 issue Command 流：状态转移+自动分配+审计、read_only 403、跨项目 404、版本冲突 409、备注创建/删除）；全仓质量门禁通过；
- 状态记录：issue lifecycle Commands implemented（DAT-14）；Issue Query not-started（DAT-15）；production worker composition not-started / blocked；`issue_activities`/`issue_notes` implemented。

### 2026-08-10：DAT-15 Issue 列表/详情 Query 实施证据

- 决策状态保持 `accepted`，实施状态保持 `implemented`；本 ADR 决定细节 19（DAT-15 只经公开 Query/投影接口读取，不直接执行写侧 SQL）由 DAT-15 实施（正式规格 [issue-query-projection.md](../architecture/issue-query-projection.md) approved + implemented）；
- 实施内容：`@aurora/processing-store` 只读 Query Repository（`queryIssueListPage` keyset 分页 + 状态/负责人/优先级过滤 + 过滤感知 totalCount；`queryIssueDetail` 聚合/生命周期/合并投影；`queryIssueSamples` 有界安全样本 ≤100；`queryIssueActivity` 活动时间线 + 备注，已删除备注不返回 content）；`@aurora/platform-contract` `issuesListIssues`/`issuesGetIssueDetail` 从 `BLOCKED_OPERATIONS` 移入稳定 GET 操作（zod schemas + OpenAPI 重新生成 + drift）；`apps/platform-api` 2 个 Query handler（复用 DAT-16 `requireProjectAccess`，诚实 `empty`/`unavailable`，`environments`/`releases` 恒 `unavailable`）；
- **不修改本 ADR 数据模型**；无新 Migration；不修改写侧 Repository/Worker/ingestion-api；
- 测试：`@aurora/processing-store` 129 单元 + 103 真实 PG 集成（含 7 个 Issue Query）；`@aurora/platform-contract` 244 契约 + drift；`apps/platform-api` 21 文件真实 PG+Redis 集成（含 4 个 Issue Query 流：列表/详情样本+活动/跨项目 404/只读成员）；全仓质量门禁通过；
- 状态记录：Issue list/detail Query implemented（DAT-15）；Console C3/C4（G11）not-started；`by_version` 重开、页面/环境/发布维度 deferred（契约缺口）。
