---
title: Aurora Issue 聚合与有界代表样本处理存储第一增量
status: approved
implementation-status: not-started
approval-status: pending-g03-approval-package
owner: processing/backend
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: packages/processing-store（@aurora/processing-store）的 Issue 聚合数据模型（issues 表、issue_samples 表、persistIssueContribution Repository、有界代表样本策略执行器）；apps/ingestion-worker 错误事件处理器 Issue 聚合接线
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../adr/ADR-018-error-event-occurrence-processing-storage.md
  - ../adr/ADR-033-issue-aggregate-data-model.md
  - ../protocol/error-event-contract.md
  - ./error-normalization-fingerprint.md
  - ./error-event-occurrence-processing-store.md
  - ./error-event-processor.md
  - ./formalization-readiness.md
supersedes: none
review-cycle: issue-aggregate-storage-or-sample-policy-change
---

# Aurora Issue 聚合与有界代表样本处理存储第一增量

## 1. 定位、效力与当前状态

本文冻结 DAT-13（Issue 聚合、代表样本和数据模型）第一增量。该增量把 DAT-12 已 fingerprint 的错误 occurrence 聚合为项目作用域的真实 Issue 聚合，并持久化有界、安全的代表样本。

**批准状态**：本文是 G03 正式化扫掠产物，纳入 [G03 APPROVAL PACKAGE](../superpowers/g03-approval-package.md) 统一批准。批准后 `status: approved`、`approval-status: approved`；`implementation-status` 于计划执行后更新为 `implemented`。

**ADR 判断**：本增量执行 accepted 决策前的 proposed [ADR-033](../adr/ADR-033-issue-aggregate-data-model.md)。**在 ADR-033 被用户批准为 accepted 前，本文不授权任何 Migration/实现。** ADR-033 accepted 后，本规格自动成为 DAT-13 实施唯一权威来源。

## 2. 元数据、Owner 和范围

- **Owner**：processing/backend
- **适用范围**：`@aurora/processing-store` 的 `issues`/`issue_samples` Migration、`persistIssueContribution` Repository、有界代表样本策略执行器、包根导出；`@aurora/ingestion-worker` 错误事件处理器 Issue 聚合接线、单元测试、真实 PostgreSQL 17 集成测试、README、正式规格、ADR-018/033 实施证据。
- **明确非职责**：
  - Issue 生命周期 Command、活动与审计（DAT-14，独立规格）；
  - Issue Query/read projection（DAT-15，独立规格）；
  - 自定义 fingerprint 输入（需契约扩展，DAT-12 §9）；
  - Source Map 与源码映射位置（DAT-18）；
  - 发布/环境/浏览器/页面维度（v1 错误契约不含，契约缺口）；
  - 数据保留与清理、告警、影响用户估算。

## 3. 模块选择依据与依赖方向

- `@aurora/processing-store` 已实施 `error_event_occurrences`（ADR-018 / implemented），DAT-12 将增加 `fingerprint`/`fingerprint_version` 增列；
- `@aurora/event-schema` 是错误类别/错误正文唯一来源（ADR-005）；
- 错误处理器核心能力（`createErrorEventProcessor`）已实施（approved [error-event-processor.md](./error-event-processor.md)）；
- Issue 聚合键是 DAT-12 `computeErrorFingerprint` 的输出（`fingerprint` + `fingerprint_version`）；
- 依赖方向：Issue 存储模块 → `@aurora/event-schema` 包根（类别常量）；`@aurora/ingestion-worker`（service）经 `@aurora/processing-store` 包根消费 `persistIssueContribution`。无循环依赖、无私有深导入。

## 4. 数据模型（冻结，以 accepted ADR-033 决定细节 3—8 为准）

### 4.1 `issues` 表

| 列 | 类型 | 约束/语义 |
|---|---|---|
| `id` | bigserial | PK |
| `project_id` | uuid | NOT NULL |
| `fingerprint` | varchar(1024) | NOT NULL；DAT-12 输出 |
| `fingerprint_version` | integer | NOT NULL；DAT-12 `ERROR_FINGERPRINT_VERSION` |
| `category` | varchar(64) | NOT NULL；event-schema `ErrorCategory`（`javascript`/`unhandled_rejection`/`resource`），CHECK |
| `normalized_title` | varchar | NOT NULL；安全投影标题（DAT-12 `computeErrorFingerprint` 输出的 `normalizedTitle`，DAT-12 §4.1/§10 隐私边界） |
| `first_seen_at` | timestamptz | NOT NULL |
| `last_seen_at` | timestamptz | NOT NULL |
| `occurrence_count` | bigint | NOT NULL DEFAULT 1 |
| `sample_count` | integer | NOT NULL DEFAULT 0 |
| `version` | integer | NOT NULL DEFAULT 1；乐观并发版本，DAT-14 Command 携带并校验；并发冲突 409 |
| `status` | varchar(16) | NOT NULL DEFAULT 'open'；closed 枚举 `open`/`in_progress`/`resolved`/`ignored`（PRD §10.1），DAT-14 管理 |
| `assignee_account_id` | uuid | NULL；DAT-14 管理 |
| `priority` | varchar(16) | NULL；`urgent`/`high`/`medium`/`low`（PRD §10.3），DAT-14 管理 |
| `resolved_at` | timestamptz | NULL；DAT-14 管理 |
| `resolved_version` | varchar | NULL；DAT-14 管理 |
| `resolved_reason` | varchar | NULL；`by_version`/`by_time`；DAT-14 管理 |
| `ignored_until` | timestamptz | NULL（NULL=永久忽略）；DAT-14 管理 |
| `merged_into_issue_id` | bigint | NULL；PRD §9.7 合并；DAT-14 管理 |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now() |

唯一约束：`(project_id, fingerprint, fingerprint_version)`。CHECK（ADR-018/020 先例）：`category IN ('javascript','unhandled_rejection','resource')`、`status IN ('open','in_progress','resolved','ignored')`、`priority IN ('urgent','high','medium','low')` 或 NULL、`resolved_reason IN ('by_version','by_time')` 或 NULL、`occurrence_count >= 1`、`sample_count >= 0`、`sample_count <= occurrence_count`。索引：`(project_id, status, last_seen_at)` 支撑 C3 列表（`(project_id, fingerprint, fingerprint_version)` 唯一约束同时支撑项目作用域查询，不另加冗余 `project_id` 索引）。

### 4.2 `issue_samples` 表

| 列 | 类型 | 约束/语义 |
|---|---|---|
| `id` | bigserial | PK |
| `issue_id` | bigint | NOT NULL；FK → `issues.id` |
| `project_id` | uuid | NOT NULL |
| `event_id` | varchar(128) | NOT NULL |
| `occurred_at` | timestamptz | NOT NULL |
| `sample_body` | jsonb | NOT NULL；受协议约束安全投影，CHECK `jsonb_typeof(sample_body) = 'object'` |
| `sample_kind` | varchar(32) | NOT NULL；`first`/`latest`/`reappeared`/`unique_environment`/`unique_release`/`unique_browser`/`unique_page`/`higher_severity`/`regular`（PRD §9.3.3；v1 错误契约不含环境/发布/浏览器/页面字段，v1 实际以 `first`/`latest`/`reappeared`/`regular` 为主） |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

唯一约束：**`(project_id, event_id)`**（幂等；与 request/performance 样本约定一致，同一事件不可能在指纹版本缺陷下被两个 Issue 重复采样）。CHECK：`jsonb_typeof(sample_body) = 'object'`、`sample_kind` closed 枚举。索引：`(issue_id, occurred_at)` 支撑 C4 样本查询。无 `protocol_version` 列（v1 单版本前向兼容假设）。

### 4.3 事件应用登记（ADR-033 决定细节 5b，评审落实）

`issue_event_applications` 表：`(project_id, event_id)` 唯一，`issue_id bigint NOT NULL`（FK → `issues.id`）、`created_at`。每个事件**至多应用一次** Issue 聚合（ADR-020/021 同款登记表），解决 Worker retry/人工重放下 `occurrence_count` 重复累加问题。

### 4.4 生命周期证据表（DAT-14，本增量不实现）

accepted ADR-033 决定细节 5c/5d 冻结 `issue_activities`（系统活动，不可编辑/删除）与 `issue_notes`（成员备注，软删除）表结构。本增量（DAT-13）**不实现**这两张表；DAT-14 Issue 生命周期 Command 规格负责其 Migration/Repository/Command。**时序说明**：DAT-13 先于 DAT-14 实施，聚合侧自动重开（再次出现）在该窗口内只更新 `status`/`version`，`reappeared` 活动由 DAT-14 的 `issue_activities` 路径补齐；该窗口内无 `reappeared` 活动记录是可接受且已记录的过渡状态。

### 4.5 样本容量与替换（PRD §9.3.2/§9.3.5）

- 服务端常量 `DEFAULT_MAX_ISSUE_SAMPLES = 100`；不写死在前端；
- 达到上限后新事件仍更新 Issue 计数/首末次；只有满足代表性条件的新事件才替换普通重复样本；
- 优先保留：首次事件、最新事件、再次出现首条（PRD §9.3.3；v1 实际可用维度）；
- 替换按固定顺序：先淘汰同版本/同环境/同浏览器/同页面重复样本 → 时间较早且无独特上下文的普通样本 → 已被更完整源码映射样本替代的原始堆栈样本（v1 无源码映射，末级不触发）；
- 不得优先淘汰首次/最新/再次出现样本；
- 不做复杂权重算法（PRD §9.3.5）。

### 4.6 隐私（决定细节 13）

- `sample_body` 只存错误正文安全白名单投影（同 ADR-018 `normalized_body` 口径，不含完整信封/页面/环境/URL/DOM/用户信息）；
- `normalized_title` 只含归一化占位符；
- 禁止请求/响应体、Cookie、Authorization、完整 URL 查询、token、secret。

## 5. Repository 与纯函数（冻结）

### 5.1 `persistIssueContribution`

签名与结果（与既有 store 稳定结果同风格）：

```ts
export interface PersistIssueContributionInput {
  readonly projectId: string;
  readonly fingerprint: string;          // DAT-12 computeErrorFingerprint 输出
  readonly fingerprintVersion: number;   // ERROR_FINGERPRINT_VERSION
  readonly category: string;             // ErrorCategory 常量
  readonly normalizedTitle: string;      // DAT-12 归一化标题（安全投影）
  readonly eventId: string;
  readonly occurredAtIso: string;        // 信封 occurredAt
  readonly sampleBody: unknown;          // 已验证错误正文（安全投影落库）
}

export type PersistIssueContributionResult =
  | { readonly status: 'inserted'; readonly issueId: string }
  | { readonly status: 'applied' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };
```

事务语义（决定细节 9—11，评审落实）：
1. `BEGIN`；
2. **事件应用登记**：`INSERT INTO issue_event_applications (project_id, event_id, issue_id…)`——先登记 `(project_id, event_id)`（唯一约束）；`ON CONFLICT DO NOTHING` 返回未插入 → 该事件已应用过 → `COMMIT` 并返回 `duplicate`（**不与 Issue 计数重复累加**）；
3. 登记成功后尝试按 `(project_id, fingerprint, fingerprint_version)` 查找/锁行（`SELECT ... FOR UPDATE`）；不存在 → `INSERT ... ON CONFLICT DO NOTHING RETURNING id` 创建 Issue（`occurrence_count=1`、`first_seen_at=last_seen_at=occurredAt`）+ 存 `first` 样本；**首次 INSERT 竞态**：并发输方命中唯一约束 → 捕获 `unique_violation` → 重新 `SELECT ... FOR UPDATE` 按已存在路径应用 → `applied`；
4. 已存在 → `occurrence_count+1`、`last_seen_at = GREATEST(last_seen_at, occurredAt)`（防止乱序处理回退 `last_seen_at`）、`first_seen_at` 不变；若 Issue 为 `resolved`/`ignored` 且满足重开条件 → 自动恢复 `open` 并递增 `version`（ADR-033 决定细节 4/12）；按样本策略决定存/替换样本 → `applied`；
5. 样本 `(project_id, event_id)` 冲突的 INSERT 为幂等（不重复）；`COMMIT`；任一步失败 `ROLLBACK` → `temporarily_unavailable`。

### 5.2 有界代表样本策略执行器

纯函数（决定细节 6—8）：输入当前样本摘要（`issueId`、`sampleCount`、已有 `sample_kind` 集合、事件 `sampleKind` 判定）→ 输出决策：

```ts
export type IssueSampleDecision =
  | { readonly action: 'store' }
  | { readonly action: 'replace'; readonly replaceSampleId: string }
  | { readonly action: 'skip' };
```

规则（固定优先级，无随机、无副作用，评审落实）：
- `sample_count < DEFAULT_MAX_ISSUE_SAMPLES` → `store`；
- 达到上限：事件为 `regular` → `skip`（普通重复样本只更新计数，不保存完整详情，PRD §9.3.4）；
- 达到上限且事件为 `latest`/`reappeared`（不在已有样本中）→ 优先替换最旧 `regular` 样本（`replace`）；**若无可替换 `regular`**：新 `latest` 替换最旧 `latest`、新 `reappeared` 替换最旧 `reappeared`（保证"当前最新事件优先保留"，PRD §9.3.3/§9.3.5）；`first` 永不替换（创建时固定）；
- 替换目标不可能是 `first`/当前最新样本。

### 5.3 包根导出

`@aurora/processing-store` 根导出：`persistIssueContribution`、`DEFAULT_MAX_ISSUE_SAMPLES`、`IssueSampleDecision`/`PersistIssueContributionInput`/`PersistIssueContributionResult` 类型。

### 5.4 错误事件处理器接线（决定细节 9、11、12）

- `createErrorEventProcessor` 在 `persistErrorEventOccurrence` 成功（`inserted`/`duplicate`）后，对已 fingerprint 的 occurrence 调用 `persistIssueContribution`（复用 DAT-12 计算的 `fingerprint`/`fingerprint_version`）；
- 结果映射：`inserted`/`applied`/`duplicate` → 保持 `processed`；`invalid_input` → `dead-letter{invalid_event_type}`（处理器局部前置语义）；`temporarily_unavailable` → `retry{service_temporarily_unavailable}`（复用 ADR-016 backoff）；
- 再次出现重开（PRD §10.4）：`resolved`/`ignored_until` 的 Issue 在收到满足重开条件的新 occurrence 时自动恢复 `open` 并标记再次出现——该规则在本增量实现（聚合侧自动重开），精确重开条件与 `by_version`/`by_time` 语义以 DAT-14 规格为准；
- **不修改** `persistErrorEventOccurrence` 既有语义与 Worker 运行时。

## 6. 单元测试

- `persistIssueContribution` 输入校验（unknown 拒绝、非法 category、越界值）；
- 首次创建（`inserted`，`occurrence_count=1`）、重复聚合（`applied`，计数递增、`first_seen_at` 不变、`last_seen_at` 更新）、重复 occurrence 幂等（`duplicate` 不重复计数）；
- 样本策略：低于上限存样本；达到上限 `regular` 跳过、`first`/`latest`/`reappeared` 存/替换最旧 `regular`；
- 再次出现重开纯逻辑（`resolved`/`ignored` 新 occurrence → 状态/标记变化）；
- 输入不变、稳定结果、不泄露数据库错误。

## 7. 真实 PostgreSQL 集成测试（只测高风险行为）

- 首次 occurrence 创建 Issue；重复 occurrence 聚合（计数/首末次）；并发同 fingerprint 只创建一个 Issue（唯一约束/行锁）；样本保持有界（超过 `DEFAULT_MAX_ISSUE_SAMPLES` 不超）；样本替换与 `(issue_id, event_id)` 幂等；项目隔离（不同项目同指纹互不影响）；再次出现重开；Migration up/down/up；Schema/Pool 清理。
- 复用 `AURORA_TEST_DATABASE_URL` 真实 PostgreSQL 17.10；不跑全部 processing suites。

## 8. 覆盖率与质量门禁

`packages/processing-store` 与 `apps/ingestion-worker` 维持既有覆盖率阈值；不得排除具有分支逻辑的新文件，不得降低门槛。

实施必须新鲜运行：受影响 package `typecheck`、单元测试、targeted 真实 PG 集成测试、Lint、构建、包入口、Workspace 边界、`git diff --check`。本增量不运行 SDK/Console/浏览器/ingestion 全量矩阵。

## 9. 文档与 ADR 同步

- `packages/processing-store/README.md`：增加 Issue 聚合与有界样本能力；
- `docs/architecture/error-event-occurrence-processing-store.md`：追加 Issue 聚合衔接证据，保持 ADR-018 结论不变；
- `docs/architecture/formalization-readiness.md`、`docs/README.md`：更新 Issue/fingerprint 状态；
- ADR-018：追加 Issue 聚合衔接证据；ADR-033：状态按用户批准结果更新；
- `AGENTS.md` 与 `AURORA_RULES.md`：全部门禁实际通过后才更新阶段快照；
- G03 计数：DAT-13 独立验收通过后 `completed 47→48 / remaining 31→30`。

## 10. 明确排除范围

- Issue 生命周期 Command/活动/审计（DAT-14）；
- Issue Query（DAT-15）；
- 自定义 fingerprint 输入（需契约扩展）；
- 发布/环境/浏览器/页面维度（契约缺口）；
- Source Map 与源码映射位置（DAT-18）；
- 影响用户估算、告警、数据保留清理。

## 11. 规格自检

- 数据模型逐列对应 accepted ADR-033 决定细节 3—8；
- 样本容量/替换逐条对应 PRD §9.3.2/§9.3.5；聚合语义对应 §9.1/§9.3；
- 并发/幂等（唯一约束 + 行锁 + `(issue_id, event_id)` 幂等）覆盖首次/重复/并发；
- 再次出现重开对应 PRD §10.4，聚合侧自动重开与 DAT-14 语义衔接；
- 隐私边界：`sample_body`/`normalized_title` 均为安全投影，禁止字段全排除；
- 依赖方向符合 `data` 层约束，无循环依赖；
- 无跨 Store 事务、不新增包、不修改公开事件协议；
- 测试覆盖首次创建、重复聚合、并发、样本有界、项目隔离、再次出现重开；
- 无占位/TBD，全部常量与类型签名冻结。

自动审批依据：本文语义全部由 accepted ADR-018、approved DAT-12 规格、approved 错误事件协议契约与 **proposed ADR-033**（待用户批准为 accepted）派生；本规格本身不引入新的产品/架构/安全/隐私决策。**批准顺序：ADR-033 先经用户批准为 accepted，本文再随 G03 APPROVAL PACKAGE 生效为 approved。**
