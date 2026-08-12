---
title: PLT-09 Notifications Implementation Plan
status: approved
owner: platform
created: 2026-08-12
last-reviewed: 2026-08-12
applies-to: D1 站内通知中心（通知数据模型 + 触发源 + 查询/未读/已读公开契约 + platform-api handler + console D1 页面）
related:
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
  - ../../architecture/aurora-v1-remaining-module-batches.md
  - ../../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../../adr/ADR-033-issue-aggregate-data-model.md
  - ../../architecture/alert-evaluation-and-instance-evidence.md
  - ../../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../../../packages/processing-store/src/alert-evaluator.ts
  - ../../../packages/processing-store/src/issue-contribution-repository.ts
supersedes: none
design-stage: implemented-in-feature-branch
---

# PLT-09 Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 D1 站内通知中心第一增量：通知数据模型 + 三个真实触发源（告警触发/恢复、新问题/重开、分配给我）+ 通知查询/未读/已读公开契约 + platform-api handler + console D1 页面与未读角标。

**Architecture:** 通知存储复用 `@aurora/processing-store`（worker 生成 + platform-api 查询均已有依赖，不引入新包）。触发源在调用方接入：platform-worker alert 评估轮询（告警触发/恢复）、ingestion-worker issue processor（新问题/重开）、platform-api assignee 命令 handler（分配给我）。`notifications` 表用 `(account_id, business_key)` 唯一约束实现"同一业务动作对同一成员一条"。数据接入异常/额度触发源无明确事件源，第一增量 defer 并登记 GAP。

**Tech Stack:** TypeScript、`@aurora/processing-store`（Migration + Repository）、node-pg-migrate、`@aurora/platform-contract`（2 操作 + OpenAPI 生成 + drift）、Fastify handler、Vue 3 SFC + `monitoring/` adapter、MSW、Playwright Chromium。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --------- | ------------ | -------- | ------------------------ | -------- |
| PLT-09 | `BASE-PRD`、`BASE-ARCH`、`BASE-IMPL`、`PLAT-DOMAINS`、`PLAT-UX`、`PLAT-STACK`、`PLAT-OAPI`、`FORM` | PRD §11.4；UX/UI §8.30、§9.30、§10.24 | 通知类型限定 PRD §11.4 六类；同一业务动作对同一成员只一条；默认接收者由服务端决定（项目管理员/当前负责人/告警规则选择成员）；已读只表示处理过入口，不等于业务已解决/恢复；D1 不提供批量/删除/偏好/订阅 | 数据接入异常/额度触发源无明确事件源 → defer 并登记 GAP；通知生成不改变 alert evaluator / issue processor / assignee 既有语义（只追加写通知） |

## Global Constraints

- 通知只从服务端生成（触发源在 worker/命令 handler），D1 不提供接收人配置。
- `(account_id, business_key)` 唯一去重（同一业务动作对同一成员一条）；重复尝试返回已存在记录，不报错。
- 通知是账号级（不从属当前组织/项目）；查询/已读按当前 session accountId 隔离，跨账号 404/空不泄露他人通知。
- 授权目标：每条通知的 `target` 用受约束 Route Target（`{routeId, pathParams, query}`），不携带任意 URL；目标失效时页面显示安全结果并允许留在通知列表。
- 已读只标记通知入口；`markNotificationRead` 幂等（同 account + notification 重复标记成功）。
- 通知生成是**追加**：在 alert evaluator `notifyNow`、issue `inserted`/`reopened`、assignee 设置时额外写通知；不修改这三个既有路径的业务结果。
- 状态诚实：列表/未读分别用 `loading`/`empty`/`error`/`forbidden`/`processing`/`partial`/`stale`/`unavailable` 映射；未读数量未知时不显示 `0`。
- 不提前实现 G14/G15/G16；不修改 PLT-07/08、不碰 G04 服务端语义；数据接入异常/额度触发源 defer。

## File Structure

新增（processing-store 通知数据）：

- `packages/processing-store/migrations/1722600000000_notifications.ts` — `notifications` 表
- `packages/processing-store/src/notification-repository.ts` — `persistNotification`/`queryNotifications`/`queryUnreadCount`/`markNotificationRead`
- `packages/processing-store/src/notification-types.ts` — 通知类型常量（六类）与投影类型

修改（触发源 + 契约 + handler + UI）：

- `apps/platform-worker/src/worker.ts` — alert 轮询后生成告警触发/恢复通知
- `apps/ingestion-worker/src/`（issue processor）— `contributeIssue` 后生成新问题/重开通知
- `apps/platform-api/src/routes/issues.ts` — assignee 变更时生成分配通知
- `packages/platform-contract/src/notifications/notifications.ts` — `notificationsListAndUnread`/`notificationsMarkRead`
- `packages/platform-contract/src/registry/operations.ts` — 解冻 2 个 BLOCKED 操作
- `packages/platform-contract/src/identity/navigation-context.ts` — 追加 `unreadCount` 安全投影
- `apps/platform-api/src/routes/notifications.ts` — 2 个 handler
- `apps/console/src/views/account/NotificationsView.vue` + `notifications-view-model.ts` — D1 页面
- `apps/console/src/components/shell/TopBar.vue` — 未读角标（消费 navigation context unreadCount）
- `apps/console/src/mocks/handlers.ts` — 通知 MSW
- 测试：`packages/processing-store/test/`（notification repository）、`apps/platform-api/test/`（handler）、`apps/console/test/views/account/notifications-view-model.test.ts`、`test/monitoring/notifications-commands.test.ts`、`test-browser/g13-notifications-smoke.spec.ts`

## 数据契约速查（新 operations）

- `notificationsListAndUnread`(GET, session) → `queryResponse({ notifications: sectionResult({ items: [{ notificationId, type, title, summary?, organizationId?, projectId?, occurredAt, readAt?, target: {routeId, pathParams, query} }] , pagination }), unreadCount: { value?, status: 'available'|'unavailable' } })`
- `notificationsMarkRead`(POST, path `:notificationId`) → body `{ idempotencyKey }` → `{ data: { status:'read', notificationId } }`

## 通知类型（PRD §11.4）

```ts
export const NOTIFICATION_TYPES = [
  'alert_triggered', 'alert_recovered', 'new_issue',
  'issue_reappeared', 'issue_assigned_to_me',
  // 'ingestion_anomaly' / 'quota_exhausted' deferred (no event source yet)
] as const;
```

## Task 结构

### Task 1: 通知数据模型 + Repository（processing-store）

**Files:**
- Create: `packages/processing-store/migrations/1722600000000_notifications.ts`
- Create: `packages/processing-store/src/notification-types.ts`
- Create: `packages/processing-store/src/notification-repository.ts`
- Test: `packages/processing-store/test/notification-repository.test.ts`
- Modify: `packages/processing-store/src/index.ts`（导出）

**Interfaces:**
- Produces: `NOTIFICATION_TYPES`；`persistNotification(pool, { accountId, type, businessKey, organizationId?, projectId?, title, summary?, target })`（upsert 去重，返回 `{status:'inserted'|'existing', notificationId}`）；`queryNotifications(pool, { accountId, readState?, cursor?, limit? })` → `{items, nextCursor?}`；`queryUnreadCount(pool, { accountId })` → `number | null`；`markNotificationRead(pool, { accountId, notificationId })` → `{status:'read'|'not_found'}`

- [ ] **Step 1: Migration**

`notifications` 表：`notification_id uuid pk`、`account_id`（接收者，index）、`organization_id`/`project_id`（nullable，最小上下文）、`type`（CHECK 六类）、`business_key`（同一业务动作去重键，如 `alert:<instanceId>`/`issue:<issueId>`/`assignment:<issueId>:<assignee>`）、`title`、`summary`（nullable）、`target` jsonb（受约束 `{routeId, pathParams, query}`，序列化校验）、`read_at` nullable、`created_at`；`UNIQUE(account_id, business_key, type)`。

- [ ] **Step 2: notification-types.ts + notification-repository.ts**

按上述 Produces 签名实现；`business_key` 冲突（unique violation）→ `existing` 不报错。

- [ ] **Step 3: 测试（failing）+ 实现**

`notification-repository.test.ts`：persist 插入 + 重复去重返回 existing；query 分页 + readState 过滤；unread 计数；markRead 幂等。运行见 Task 4 命令 A。

- [ ] **Step 4: Commit**

---

### Task 2: 触发源接入（告警 / 新问题重开 / 分配）

**Files:**
- Modify: `apps/platform-worker/src/worker.ts`（alert 轮询后生成通知）
- Modify: `apps/ingestion-worker/src/`（issue processor `contributeIssue` 后生成通知）
- Modify: `apps/platform-api/src/routes/issues.ts`（assignee 变更时生成通知）

**Interfaces:**
- Consumes: Task 1 的 `persistNotification`
- Produces: 三个触发点的通知写入；不改这三个路径既有业务结果

- [ ] **Step 1: 告警触发/恢复通知（platform-worker alert 轮询）**

`runAlertEvaluationRound` 结果中实例级 `notifyNow`（`first_trigger`/`retrigger`/`recovered`）为真时，为规则 `recipientAccountIds` 每个成员 `persistNotification({ accountId, type: instance.recovered ? 'alert_recovered' : 'alert_triggered', businessKey: 'alert:'+instanceId, organizationId, projectId, title: ruleName+' '+(recovered?'已恢复':'已触发'), target: { routeId:'project.alert-instance-detail', pathParams:{organizationId,projectId,instanceId}, query:{} } })`。在 alert 轮询事务内/后追加，不改变评估结果。

- [ ] **Step 2: 新问题/重开通知（ingestion-worker issue processor）**

issue processor 在 `contributeIssue` 返回 `inserted`（新问题）或 processor 检测到 reopened（问题再次出现）时，为项目管理员（org manager + `project_members` 中 `project_admin`）每人 `persistNotification({ type:'new_issue'|'issue_reappeared', businessKey:'issue:'+issueId, target:{routeId:'project.issue-detail',...} })`。不改变 processor 现有返回。

- [ ] **Step 3: 分配通知（platform-api assignee handler）**

`updateIssueAssignee` handler 在 `body.assigneeAccountId` 非空且与旧值不同时，为新 assignee `persistNotification({ type:'issue_assigned_to_me', businessKey:'assignment:'+issueId+':'+assignee, target:{routeId:'project.issue-detail',...} })`。

- [ ] **Step 4: 测试 + Commit**

每个触发点一个 focused 测试（worker 集成 / handler 断言通知写入）。运行见 Task 4 命令 A。

---

### Task 3: 通知契约 + platform-api handler + navigation unread

**Files:**
- Create: `packages/platform-contract/src/notifications/notifications.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`（解冻 `notificationsListAndUnread`/`notificationsMarkRead`）、`src/index.ts`
- Modify: `packages/platform-contract/src/identity/navigation-context.ts`（追加 `unreadCount`）
- Create: `apps/platform-api/src/routes/notifications.ts`（2 handler）
- Modify: `apps/platform-api/src/app.ts`

**Interfaces:**
- Consumes: Task 1 Repository、`requireSession`
- Produces: 2 个稳定操作（GET 列表/未读 + POST 已读）；navigation context 含 `unreadCount`

- [ ] **Step 1: 契约 + 解冻 + OpenAPI**

按"数据契约速查"定义 `notifications.ts`；从 `BLOCKED_OPERATIONS` 移除两操作；`pnpm platform-contract:generate && pnpm platform-contract:drift`。

- [ ] **Step 2: navigation context 未读计数**

`navigationGetContext` 追加 `unreadCount: { value?, status }`（账号级，查询 `queryUnreadCount`；Redis/session 权威依赖不可用时 `unavailable`）。

- [ ] **Step 3: platform-api handler**

`notifications.ts`：`handleListAndUnread`（session 账号隔离，列表 keyset 分页 + 未读计数）、`handleMarkRead`（session + 幂等 + 账号隔离）。注册到 app.ts。

- [ ] **Step 4: 测试 + Commit**（运行见 Task 4 命令 A）

---

### Task 4: console D1 页面 + MSW + acceptance

**Files:**
- Create: `apps/console/src/views/account/NotificationsView.vue`、`notifications-view-model.ts`
- Modify: `apps/console/src/monitoring/queries.ts` + `commands.ts`（通知 query/command）、`apps/console/src/contracts/route-registry.ts`（`account.notifications` 接真实组件）、`apps/console/src/components/shell/TopBar.vue`（未读角标）、`apps/console/src/mocks/handlers.ts`
- Create: `apps/console/test-browser/g13-notifications-smoke.spec.ts`、`apps/console/test/views/account/notifications-view-model.test.ts`、`apps/console/test/monitoring/notifications-commands.test.ts`

**Interfaces:**
- Consumes: Task 3 的 2 个操作 + navigation context unreadCount
- Produces: D1 页面（列表 + 全部/未读筛选 URL + 单条已读 + 打开授权目标）、顶栏未读角标

- [ ] **Step 1: view-model + view + route 接线**

`NotificationsView.vue`（账号级，URL `?read=all|unread` 权威、keyset 加载更多、单条"标为已读"、行点击进 `target.routeId` 授权目标；已读成功后刷新该条 + 未读角标）；route-registry `account.notifications` 从 unavailable 换真实组件；TopBar 消费 navigation `unreadCount`（未读角标，未知显示 unavailable 而非 0）。

- [ ] **Step 2: MSW + smoke**

`g13-notifications-smoke.spec.ts`：`/notifications` → 列表 + 未读筛选真实可达 → 单条已读 → 无 fatal error、无 `capability-not-provided`。

- [ ] **Step 3: 预算测试（A/B/C/D）+ docs**

A：`pnpm --filter @aurora/processing-store exec vitest run test/notification-repository.test.ts` + 触发源 focused tests + `pnpm platform-contract:drift`；B：`pnpm --filter @aurora/console exec vitest run test/views/account/notifications-view-model.test.ts test/monitoring/notifications-commands.test.ts test/contracts/route-registry.test.ts`；C：Chromium smoke；D：typecheck/build/`git diff --check`。同步 `AGENTS.md`/`AURORA_RULES.md`（ledger 68→69/10，G13 状态）。

- [ ] **Step 4: Commit**

---

## Self-Review

**1. Spec coverage：** D1 通知列表/未读/已读/授权目标/去重/账号隔离：Task 1—4 ✓；告警触发/恢复、新问题/重开、分配：Task 2 ✓；数据接入异常/额度：defer（无明确事件源）登记 GAP，不伪造触发。
**2. Placeholder scan：** 无 TBD；关键接口给出签名。
**3. Type consistency：** `persistNotification`/`queryNotifications`/`queryUnreadCount`/`markNotificationRead` 与 `notificationsListAndUnread`/`notificationsMarkRead` 一致；`NOTIFICATION_TYPES` 六类与 PRD §11.4 一致。

**缺陷修正：** 通知生成是追加不改变既有路径语义；`(account_id, business_key, type)` 唯一去重；未读数量未知显示 unavailable 而非 0；目标用受约束 Route Target 不携带任意 URL。
