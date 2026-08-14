# Aurora Console UX/UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing amber/topbar Aurora Console presentation with the approved `Calm Observability` design across every implemented A1—D2 route while preserving all current business behavior, Route Targets, permissions, API calls, URL state, security rules, and honest unavailable states.

**Architecture:** Keep the existing Vue Router, Pinia stores, generated Platform API client, view-models, and Command/Query boundaries. Introduce a centralized design-system layer, replace the horizontal topbar with a 64px global rail plus a 232px contextual sidebar, render public authentication routes in an independent split shell, and migrate views by page family onto shared page/section/state primitives. Use existing MSW data only in tests; production components continue to consume the current public API and never fabricate data.

**Tech Stack:** Vue 3.5.41, Vue Router 5.2.0, Pinia 4.0.2, PrimeVue 4.5.5, lucide-vue-next 1.0.0, strict TypeScript 6.0.3, Vitest/Vue Testing Library/MSW, Playwright 1.62.1, axe-core.

## Global Constraints

- Preserve all 36 stable Route Targets, route paths, route names, parent relationships, Query/Command operation IDs, CSRF/idempotency behavior, and URL-authoritative filters/pagination.
- Do not add global search, command palette, dark mode, project health scores, predictions, rankings, AI recommendations, external notification preferences, or APIs.
- C2 must not display a trend chart, health score, prediction, ranking, or decorative statistic; B1 must not display project health metrics.
- Public authentication and invitation routes must not render authenticated navigation; A5 remains an authenticated account surface.
- Use `#101828` global rail, `#F2F4F7` context sidebar, `#F7F8FA` canvas, `#FFFFFF` surfaces, `#D0D5DD` borders, `#3157D5` primary action/focus, and independent semantic colors from the approved design.
- Use the local system font stack; use a monospace stack only for IDs, timestamps, raw status keys, request identifiers, and code.
- No decorative gradients, glass effects, noise, glow, fabricated charts, fake product data, empty links, or controls without a real action.
- Every independently loaded region must preserve honest `loading`, `empty`, `error`, `forbidden`, `partial`, `stale`, and `unavailable` behavior; unknown values never become `0`.
- Desktop shell is global rail + optional context sidebar + independently scrolling content; below 960px navigation is a focus-managed Drawer; below 640px authentication becomes a single column.
- Meet WCAG 2.2 AA, visible `:focus-visible`, keyboard reachability, focus return, 200% zoom, reduced motion, and non-color status communication.
- Use TDD, keep each task green before commit, and never include `.superpowers/brainstorm/` visual-companion artifacts in a product commit.

---

## File Structure Map

| Responsibility | Files |
|---|---|
| Design tokens and global reset | `apps/console/src/styles/tokens.css`, `apps/console/src/styles/base.css` |
| UI primitives | `apps/console/src/components/aurora/AppButton.vue`, `AppLink.vue`, `AppPageHeader.vue`, `AppStatusBadge.vue`, new `AppSection.vue`, `AppEmptyState.vue`, `AppSkeleton.vue`, `AppTechnicalDetails.vue` |
| Status copy | new `apps/console/src/presentation/status-copy.ts` |
| Application shell | `apps/console/src/components/shell/AppShell.vue`, new `GlobalNavigation.vue`, `GlobalRail.vue`, `ContextSidebar.vue`, existing `ScopeSwitcher.vue`, `AppDrawer.vue`; remove superseded `TopBar.vue` and `LayeredSidebar.vue` |
| Authentication shell | new `apps/console/src/components/auth/AuthShell.vue`, existing `AuthCard.vue`, `AuthFormField.vue`, `AuthStatusBanner.vue` |
| Page-family views | `apps/console/src/views/{auth,workspace,organization,account,project,platform}/**/*.vue` |
| Route/navigation contracts | `apps/console/src/contracts/sidebar-entries.ts`; no Route Target changes in `route-registry.ts` |
| Unit/component tests | `apps/console/test/styles`, `test/components`, `test/views`, new `test/presentation/status-copy.test.ts` |
| Browser/accessibility/visual tests | `apps/console/test-browser/shell-helpers.ts`, `axe.spec.ts`, `focus.spec.ts`, `reachability.spec.ts`, `auth-flow.spec.ts`, new `visual-regression.spec.ts` and its committed snapshots |
| Documentation/status | approved design, `apps/console/README.md`, frontend/shell architecture, `docs/README.md`, `AGENTS.md`, `AURORA_RULES.md` |

---

### Task 1: Design Tokens, Status Copy, and Aurora UI Primitives

**Files:**
- Modify: `apps/console/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/console/src/styles/tokens.css`
- Modify: `apps/console/src/styles/base.css`
- Modify: `apps/console/src/components/aurora/AppButton.vue`
- Modify: `apps/console/src/components/aurora/AppLink.vue`
- Modify: `apps/console/src/components/aurora/AppPageHeader.vue`
- Modify: `apps/console/src/components/aurora/AppStatusBadge.vue`
- Modify: `apps/console/src/components/auth/AuthFormField.vue`
- Modify: `apps/console/src/components/auth/AuthStatusBanner.vue`
- Modify: `apps/console/src/components/monitoring/SectionNotice.vue`
- Create: `apps/console/src/components/aurora/AppSection.vue`
- Create: `apps/console/src/components/aurora/AppEmptyState.vue`
- Create: `apps/console/src/components/aurora/AppSkeleton.vue`
- Create: `apps/console/src/components/aurora/AppTechnicalDetails.vue`
- Create: `apps/console/src/presentation/status-copy.ts`
- Modify: `apps/console/test/styles/tokens.test.ts`
- Modify: `apps/console/test/components/aurora.test.ts`
- Create: `apps/console/test/presentation/status-copy.test.ts`

**Interfaces:**
- Produces: `statusLabel(key: string): string`, `AppSection(title, description?, tone?, testId?)`, `AppEmptyState(title, description, tone?)`, `AppSkeleton(lines?, label?)`, and `AppTechnicalDetails(summary?)`.
- Produces: shared CSS tokens consumed by every later task; temporary aliases for old token variable names remain until Task 10 so intermediate commits stay green.

- [ ] **Step 1: Add failing tests for the approved token values and readable status labels**

```ts
// apps/console/test/presentation/status-copy.test.ts
import { describe, expect, it } from 'vitest';
import { statusLabel } from '../../src/presentation/status-copy';

describe('statusLabel', () => {
  it.each([
    ['not_receiving', '尚未接收到数据'],
    ['no_received_events', '当前项目还没有已接收事件'],
    ['batch_partial', '部分操作未完成'],
    ['receiving', '正在接收数据'],
    ['processing', '正在处理'],
  ])('maps %s to readable Chinese copy', (key, expected) => {
    expect(statusLabel(key)).toBe(expected);
  });

  it('uses a safe unknown label instead of echoing an internal key', () => {
    expect(statusLabel('future_internal_key')).toBe('状态未知');
  });
});
```

Update `tokens.test.ts` to assert the exact new rail/context/page/surface/border/action/semantic tokens, 64px rail, 232px context sidebar, 8px control radius, and 12px surface radius.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/styles/tokens.test.ts test/presentation/status-copy.test.ts test/components/aurora.test.ts
```

Expected: FAIL because the new tokens, `status-copy.ts`, and new primitives do not exist.

- [ ] **Step 3: Install the fixed icon dependency and implement the token/status foundation**

Run:

```powershell
pnpm --filter @aurora/console add lucide-vue-next@1.0.0 --save-exact
```

Define the new root tokens and compatibility aliases:

```css
:root {
  --color-rail-bg: #101828;
  --color-rail-fg: #F9FAFB;
  --color-rail-muted: #98A2B3;
  --color-context-bg: #F2F4F7;
  --color-page-bg: #F7F8FA;
  --color-surface-bg: #FFFFFF;
  --color-border-default: #D0D5DD;
  --color-text-primary: #101828;
  --color-text-secondary: #475467;
  --color-action-primary: #3157D5;
  --color-status-success: #067647;
  --color-status-warning: #B54708;
  --color-status-danger: #B42318;
  --color-status-info: #175CD3;
  --global-rail-width: 64px;
  --context-sidebar-width: 232px;
  --control-height: 40px;
  --compact-control-height: 36px;
  --radius-control: 8px;
  --radius-surface: 12px;
  --motion-fast: 150ms;
  --motion-standard: 200ms;

  /* Removed in Task 10 after every view migrates. */
  --color-topbar-bg: var(--color-rail-bg);
  --color-topbar-fg: var(--color-rail-fg);
  --color-sidebar-bg: var(--color-context-bg);
  --color-sidebar-fg: var(--color-text-primary);
  --radius-base: var(--radius-control);
}
```

Implement `statusLabel` with a frozen map and never return the raw unknown key. Add `@media (prefers-reduced-motion: reduce)` to `base.css` and set global selection, body smoothing, focus ring, link, and disabled-state foundations without page-specific layout.

- [ ] **Step 4: Implement the shared primitives**

Use typed props and named slots. `AppPageHeader` must render optional eyebrow/description/actions/meta without changing its stable `h1` focus target. `AppStatusBadge` must support `neutral | info | success | warning | danger` with text plus optional icon slot. `AppSkeleton` uses `role="status"` and visible “正在加载…” copy; its animation is disabled under reduced motion. `AppTechnicalDetails` renders a native `<details>` so raw IDs and keys are secondary evidence.

```vue
<!-- AppSection.vue core contract -->
<section :class="['au-section', `au-section--${tone}`]" :data-testid="testId">
  <header class="au-section__header">
    <div><h2>{{ title }}</h2><p v-if="description">{{ description }}</p></div>
    <slot name="actions" />
  </header>
  <slot />
</section>
```

- [ ] **Step 5: Run unit, type, and lint verification**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/styles/tokens.test.ts test/presentation/status-copy.test.ts test/components/aurora.test.ts
pnpm --filter @aurora/console typecheck
pnpm eslint apps/console/src apps/console/test apps/console/vite.config.ts apps/console/vitest.config.ts apps/console/playwright.config.ts
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the design-system foundation**

```powershell
git add apps/console/package.json pnpm-lock.yaml apps/console/src/styles apps/console/src/components/aurora apps/console/src/components/auth/AuthFormField.vue apps/console/src/components/auth/AuthStatusBanner.vue apps/console/src/components/monitoring/SectionNotice.vue apps/console/src/presentation apps/console/test/styles apps/console/test/components/aurora.test.ts apps/console/test/presentation
git commit -m "feat(console): add calm observability design system"
```

---

### Task 2: Global Rail, Context Sidebar, and Scope Navigation

**Files:**
- Modify: `apps/console/src/components/shell/AppShell.vue`
- Delete: `apps/console/src/components/shell/TopBar.vue`
- Delete: `apps/console/src/components/shell/LayeredSidebar.vue`
- Create: `apps/console/src/components/shell/GlobalNavigation.vue`
- Create: `apps/console/src/components/shell/GlobalRail.vue`
- Create: `apps/console/src/components/shell/ContextSidebar.vue`
- Modify: `apps/console/src/components/shell/ScopeSwitcher.vue`
- Modify: `apps/console/src/components/aurora/AppDrawer.vue`
- Modify: `apps/console/src/contracts/sidebar-entries.ts`
- Modify: `apps/console/test/components/shell.test.ts`
- Modify: `apps/console/test/components/responsive.test.ts`
- Modify: `apps/console/test-browser/shell-helpers.ts`
- Modify: `apps/console/test-browser/reachability.spec.ts`
- Modify: `apps/console/test-browser/axe.spec.ts`

**Interfaces:**
- Produces: `SidebarGroup { label: string; routeIds: readonly RouteTargetId[] }`, `ORG_SIDEBAR_GROUPS`, and `PROJECT_SIDEBAR_GROUPS`.
- Produces: `GlobalNavigation` prop `expanded?: boolean` and `navigate` emit; `ContextSidebar` props `fill?: boolean`, `mobile?: boolean` and `navigate` emit.
- Consumes: Task 1 tokens and lucide-vue-next icons; existing Navigation Store, `resolveRouteTarget`, and scope cleanup behavior remain authoritative.

- [ ] **Step 1: Replace old shell assertions with failing structural assertions**

Add assertions that authenticated project routes render navigation named “全局导航” and “项目导航”, contain labeled groups “接入/观测/交付/告警/治理”, place the organization/project scope buttons inside the context sidebar, and do not render `.au-topbar`. Assert `/workspace`, `/notifications`, and `/account/security` have no context sidebar. Assert the Drawer contains both expanded global links and contextual links.

```ts
expect(screen.getByRole('navigation', { name: '全局导航' })).toBeTruthy();
expect(screen.getByRole('navigation', { name: '项目导航' })).toBeTruthy();
expect(screen.getByText('观测')).toBeTruthy();
expect(document.querySelector('.au-topbar')).toBeNull();
```

- [ ] **Step 2: Run the shell tests and verify they fail**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/components/shell.test.ts test/components/responsive.test.ts
```

Expected: FAIL because the old horizontal topbar and flat sidebar still render.

- [ ] **Step 3: Implement grouped navigation contracts and reusable global navigation**

```ts
export interface SidebarGroup {
  readonly label: string;
  readonly routeIds: readonly RouteTargetId[];
}

export const PROJECT_SIDEBAR_GROUPS: readonly SidebarGroup[] = [
  { label: '接入', routeIds: ['project.onboarding'] },
  { label: '观测', routeIds: ['project.overview', 'project.issues', 'project.requests', 'project.performance', 'project.data-status'] },
  { label: '交付', routeIds: ['project.releases'] },
  { label: '告警', routeIds: ['project.alerts'] },
  { label: '治理', routeIds: ['project.access', 'project.client-keys', 'project.settings'] },
];
```

`GlobalNavigation` renders only real workspace, notification, and account targets with `LayoutGrid`, `Bell`, and `ShieldCheck`. It shows unread count only when authoritative and greater than zero. Collapsed mode uses accessible names and tooltips; expanded Drawer mode displays visible text labels.

- [ ] **Step 4: Move scope switching into the context sidebar and split the 429-line component**

Keep `ScopeSwitcher.vue` responsible for state and selection, but extract menu markup/keyboard behavior into a local `ScopeMenu.vue` if the file remains over 300 lines. The trigger labels stay exactly `组织：{name}` and `项目：{name}` for existing accessibility and browser tests. Menus continue using authorized Navigation Context targets, `Escape` focus return, outside click closure, route-change closure, and no URL construction.

- [ ] **Step 5: Implement the responsive shell**

Use CSS grid at desktop:

```css
.au-shell {
  display: grid;
  grid-template-columns: var(--global-rail-width) var(--context-sidebar-width) minmax(0, 1fr);
  height: 100dvh;
  overflow: hidden;
}
.au-shell--global-only {
  grid-template-columns: var(--global-rail-width) minmax(0, 1fr);
}
```

At `< 960px`, hide desktop rail/sidebar, display a compact mobile bar and open one PrimeVue Drawer containing `GlobalNavigation expanded` followed by `ContextSidebar mobile` when the current route has organization/project scope. Ensure closing restores focus to the menu button.

- [ ] **Step 6: Update browser helpers and run shell/browser checks**

`waitForShell` waits for “全局导航”; `openResponsiveSidebar` returns “项目导航” or “组织导航” from the visible desktop region or Drawer. Update reachability geometry assertions to verify the 64px rail and fixed 232px sidebar instead of topbar height and centered amber rows.

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/components/shell.test.ts test/components/responsive.test.ts
pnpm --filter @aurora/console typecheck
pnpm --filter @aurora/console exec playwright test --config playwright.config.ts test-browser/reachability.spec.ts test-browser/axe.spec.ts
```

Expected: all commands PASS.

- [ ] **Step 7: Commit the shell migration**

```powershell
git add apps/console/src/components/shell apps/console/src/components/aurora/AppDrawer.vue apps/console/src/contracts/sidebar-entries.ts apps/console/test/components apps/console/test-browser/shell-helpers.ts apps/console/test-browser/reachability.spec.ts apps/console/test-browser/axe.spec.ts
git commit -m "feat(console): replace topbar with layered navigation rail"
```

---

### Task 3: Independent Authentication Shell and A1—A4 Views

**Files:**
- Create: `apps/console/src/components/auth/AuthShell.vue`
- Modify: `apps/console/src/components/auth/AuthCard.vue`
- Modify: `apps/console/src/components/shell/AppShell.vue`
- Modify: `apps/console/src/views/auth/RegisterView.vue`
- Modify: `apps/console/src/views/auth/LoginView.vue`
- Modify: `apps/console/src/views/auth/ForgotPasswordView.vue`
- Modify: `apps/console/src/views/auth/ResetPasswordView.vue`
- Modify: `apps/console/src/views/auth/VerifyEmailView.vue`
- Modify: `apps/console/src/views/auth/VerifyEmailConfirmView.vue`
- Modify: `apps/console/src/views/auth/InvitationAcceptView.vue`
- Modify: `apps/console/src/views/account/DeletionCancelView.vue`
- Modify: `apps/console/src/views/account/DeletionConfirmView.vue`
- Modify: `apps/console/test/views/auth.test.ts`
- Modify: `apps/console/test/components/shell.test.ts`
- Modify: `apps/console/test-browser/auth-flow.spec.ts`
- Modify: `apps/console/test-browser/reachability.spec.ts`

**Interfaces:**
- Produces: `AuthShell` with default slot; it renders the approved solid graphite brand panel and a max-420px form region.
- Consumes: existing route meta `scope === 'public'`; AppShell skips authenticated rail/context navigation for public routes without changing route names or guards.

- [ ] **Step 1: Add failing tests for public-shell isolation and responsive auth structure**

Assert `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, invitation, and deletion-link routes render `data-testid="auth-shell"`, one level-1 heading, and no “全局导航”, “项目导航”, or scope buttons. Assert login still exposes the same labels and submit behavior.

- [ ] **Step 2: Run auth tests and verify they fail**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/auth.test.ts test/components/shell.test.ts
```

Expected: FAIL because public routes are still wrapped by authenticated navigation and `AuthShell` does not exist.

- [ ] **Step 3: Implement the auth shell and route-sensitive AppShell branch**

```vue
<AuthShell v-if="route.meta.scope === 'public'">
  <ContentOutlet />
</AuthShell>
<div v-else class="au-shell" :class="{ 'au-shell--global-only': !hasContext }">
  <!-- authenticated rail/context/content from Task 2 -->
</div>
```

The brand panel contains Aurora, “把异常、请求与性能证据放回同一个调查上下文”, and a decorative orbit rendered with borders only. The decorative element is `aria-hidden="true"` and contains no fake metric. At `< 640px`, hide the large panel and show a compact Aurora header above the form.

- [ ] **Step 4: Migrate all public views to the focused form surface**

Keep every existing field, hint, security message, intent-token clearing behavior, cooldown, disabled rule, and Command. Remove page-local card borders and duplicated width rules; use `AuthCard` for title/description/slots inside the shell. Invitation retains safe organization/role summary. Deletion confirm/cancel retains token hygiene and lifecycle copy.

- [ ] **Step 5: Run unit and real-browser auth verification**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/auth.test.ts test/components/shell.test.ts
pnpm --filter @aurora/console exec playwright test --config playwright.config.ts test-browser/auth-flow.spec.ts test-browser/reachability.spec.ts --grep "auth|register"
pnpm --filter @aurora/console typecheck
```

Expected: all commands PASS; browser assertions confirm no authenticated navigation on public routes.

- [ ] **Step 6: Commit the authentication surface**

```powershell
git add apps/console/src/components/auth apps/console/src/components/shell/AppShell.vue apps/console/src/views/auth apps/console/src/views/account/DeletionCancelView.vue apps/console/src/views/account/DeletionConfirmView.vue apps/console/test/views/auth.test.ts apps/console/test/components/shell.test.ts apps/console/test-browser/auth-flow.spec.ts apps/console/test-browser/reachability.spec.ts
git commit -m "feat(console): add focused authentication shell"
```

---

### Task 4: Workspace and Organization Page Family (B1—B8)

**Files:**
- Modify: `apps/console/src/views/workspace/WorkspaceHomeView.vue`
- Modify: `apps/console/src/views/organization/ProjectCreateView.vue`
- Modify: `apps/console/src/views/organization/MembersView.vue`
- Modify: `apps/console/src/views/organization/SettingsView.vue`
- Modify: `apps/console/src/views/organization/UsageView.vue`
- Modify: `apps/console/src/views/organization/TokensView.vue`
- Modify: `apps/console/src/views/organization/AuditView.vue`
- Modify: `apps/console/src/views/organization/TrashView.vue`
- Modify: `apps/console/test/views/org.test.ts`
- Modify: `apps/console/test-browser/org-flow.spec.ts`
- Modify: `apps/console/test-browser/reachability.spec.ts`

**Interfaces:**
- Consumes: Task 1 `AppPageHeader`, `AppSection`, `AppEmptyState`, `AppSkeleton`, badges, and technical details.
- Preserves: workspace `organizationId` query, project list Query, allowed actions, current organization, B2 create success target, member/invite/settings/token/audit/trash Commands and view-models.

- [ ] **Step 1: Add failing B1/B2 and organization-family presentation tests**

Assert B1 has a page header description and action slot, an explicit organization scope strip, surfaced project rows with localized framework/lifecycle labels, and an actionable empty state. Assert it does not contain “健康分”, “趋势”, or fabricated metrics. Assert organization views expose one page heading and use section headings rather than anonymous continuous forms.

- [ ] **Step 2: Run organization view tests and verify they fail**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/org.test.ts
```

Expected: FAIL on the new structural/test-id assertions.

- [ ] **Step 3: Redesign B1 without changing its scope-selector semantics**

Use `AppPageHeader` with description “在组织范围内选择和管理可访问项目。” and place “创建项目” in the actions slot only when `allowedActions` includes `create`. Render organization choices as compact scope tabs and projects as rows with name, localized framework, localized lifecycle badge, and a clear “打开项目” target. Use `AppSkeleton` during Query loading and `AppEmptyState` for no organization/no project.

- [ ] **Step 4: Migrate B2—B8 by interaction type**

- B2/B4 use a max-720px form work area with separate basic/settings sections and existing field errors.
- B3/B6/B8 use toolbar + stable table/list rows + row actions; secrets remain one-time only.
- B5 uses current resource facts and honest unavailable state; no trend, prediction, billing, or upgrade UI.
- B7 uses dense audit rows with monospace timestamps/IDs in `AppTechnicalDetails`; no unsupported export.
- Destructive actions in B8 use danger sections and existing confirmation/Command behavior.

- [ ] **Step 5: Run unit and browser organization flows**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/org.test.ts
pnpm --filter @aurora/console exec playwright test --config playwright.config.ts test-browser/org-flow.spec.ts test-browser/reachability.spec.ts --grep "organization|workspace"
pnpm --filter @aurora/console typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit B1—B8 migration**

```powershell
git add apps/console/src/views/workspace apps/console/src/views/organization apps/console/test/views/org.test.ts apps/console/test-browser/org-flow.spec.ts apps/console/test-browser/reachability.spec.ts
git commit -m "feat(console): redesign workspace and organization views"
```

---

### Task 5: Monitoring Entry Pages C1, C2, and C7

**Files:**
- Modify: `apps/console/src/views/project/ProjectOnboardingView.vue`
- Modify: `apps/console/src/views/project/ProjectOverviewView.vue`
- Modify: `apps/console/src/views/project/ProjectDataStatusView.vue`
- Create: `apps/console/test/views/project/monitoring-entry-presentation.test.ts`
- Modify: `apps/console/test/monitoring/diagnosis.test.ts`
- Modify: `apps/console/test-browser/reachability.spec.ts`

**Interfaces:**
- Consumes: existing DAT-20/15/16/17 Queries, `SectionView`, action targets, and Task 1 primitives/status copy.
- Preserves: `accepted ≠ processing ≠ processed ≠ queryable`, independent section loading, UTC, partial/stale/unavailable states, and C2 no-trend rule.

- [ ] **Step 1: Add failing tests for the state → evidence → action hierarchy**

Assert C2 renders regions in order: `overview-status`, `overview-evidence`, `overview-actions`; readable status labels are primary while raw keys appear only inside “技术详情”; no `svg[role="img"]`, canvas, “趋势”, or “健康分” exists. Assert C1 uses a numbered onboarding sequence and C7 groups current authority status, reason, stages, trust evidence, and action targets.

- [ ] **Step 2: Run focused monitoring tests and verify they fail**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/project/monitoring-entry-presentation.test.ts test/monitoring/diagnosis.test.ts
```

Expected: FAIL because the current views are flat blocks with raw status keys.

- [ ] **Step 3: Redesign C2 as one authority surface plus evidence grid**

Use one prominent authority `AppSection` containing readable receiving status, cause, service time, and technical raw key. Combine issues, requests, performance, recent data, and queryable evidence into a responsive two-column evidence grid; each existing section keeps its independent `SectionNotice`. Put only authorized action targets in the final action section and map route IDs to readable labels such as “查看问题列表” and “打开数据诊断”. Do not add a chart or calculated summary.

- [ ] **Step 4: Redesign C1 and C7 with the same evidence language**

C1 presents the approved three steps as a vertical sequence with code snippets in monospace surfaces and real diagnosis state above the steps. C7 leads with current authority state and direct cause, then renders received/processing/processed/dead-letter stages, credential/queryable evidence, and authorized actions. Raw codes remain in `AppTechnicalDetails`.

- [ ] **Step 5: Run monitoring unit, browser, and axe checks**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/project/monitoring-entry-presentation.test.ts test/views/project/onboarding-view-model.test.ts test/views/project/overview-view-model.test.ts test/views/project/data-status-view-model.test.ts test/monitoring/diagnosis.test.ts
pnpm --filter @aurora/console exec playwright test --config playwright.config.ts test-browser/reachability.spec.ts test-browser/axe.spec.ts --grep "project|shell"
pnpm --filter @aurora/console typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit C1/C2/C7 migration**

```powershell
git add apps/console/src/views/project/ProjectOnboardingView.vue apps/console/src/views/project/ProjectOverviewView.vue apps/console/src/views/project/ProjectDataStatusView.vue apps/console/test/views/project/monitoring-entry-presentation.test.ts apps/console/test/monitoring/diagnosis.test.ts apps/console/test-browser/reachability.spec.ts apps/console/test-browser/axe.spec.ts
git commit -m "feat(console): redesign monitoring entry workspaces"
```

---

### Task 6: Investigation Workspaces C3—C6

**Files:**
- Modify: `apps/console/src/views/project/ProjectIssuesView.vue`
- Modify: `apps/console/src/views/project/ProjectIssueDetailView.vue`
- Modify: `apps/console/src/views/project/ProjectRequestsView.vue`
- Modify: `apps/console/src/views/project/ProjectPerformanceView.vue`
- Create: `apps/console/test/views/project/investigation-presentation.test.ts`
- Modify: `apps/console/test-browser/focus.spec.ts`

**Interfaces:**
- Preserves: URL-authoritative C3 filters/pagination, current-page selection, C4 lifecycle Commands and invalidation, C5 endpoint selection, C6 page selection, server series/metric semantics, partial/stale/dataThrough/totalCountStatus.
- Consumes: Task 1 primitives; existing `monitoring/issue-workspace.ts`, `queries.ts`, and `commands.ts` remain data authority.

- [ ] **Step 1: Add failing view tests for stable investigation layouts**

Assert C3 has page header, query toolbar, results surface, and current-page selection summary; C4 has object header, lifecycle actions, evidence, representative sample, technical stack, and activity sections; C5/C6 use list-detail workspaces and show charts only when the existing view-model supplies a formal server series. Assert missing series renders an empty/unavailable state, not an empty chart.

- [ ] **Step 2: Run C3—C6 tests and verify they fail**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/project/investigation-presentation.test.ts
```

Expected: FAIL on the new layout/presentation contracts.

- [ ] **Step 3: Migrate C3 and C4**

C3 uses a compact filter toolbar above a bordered results table/list, keeps URL updates and current-page selection, and places batch actions in a sticky-in-surface selection bar only when selected. C4 uses a strong issue identity header with status/priority/assignee actions, then separate evidence, selected sample/stack, activity, note, and merge sections. Preserve every current Command, conflict behavior, safe return query, and no-attachment/no-thread boundary.

- [ ] **Step 4: Migrate C5 and C6**

Use a responsive list-detail grid: normalized endpoint or safe page rows on the left, selected-object metrics/evidence on the right. Existing server-returned series may use ECharts only if the dependency and formal series already exist; because ECharts is not currently installed, this migration must keep the current textual/table series representation and must not introduce a decorative chart. Preserve explicit sampling, watermarks, units, missing reasons, and unavailable dimensions.

- [ ] **Step 5: Run unit, focus, and browser checks**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/project/investigation-presentation.test.ts test/views/project/issues-view-model.test.ts test/views/project/issue-detail-view-model.test.ts test/views/project/requests-view-model.test.ts test/views/project/performance-view-model.test.ts test/monitoring/issue-workspace.test.ts
pnpm --filter @aurora/console exec playwright test --config playwright.config.ts test-browser/focus.spec.ts test-browser/reachability.spec.ts --grep "Issue|project"
pnpm --filter @aurora/console typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit C3—C6 migration**

```powershell
git add apps/console/src/views/project/ProjectIssuesView.vue apps/console/src/views/project/ProjectIssueDetailView.vue apps/console/src/views/project/ProjectRequestsView.vue apps/console/src/views/project/ProjectPerformanceView.vue apps/console/test/views/project/investigation-presentation.test.ts apps/console/test-browser/focus.spec.ts apps/console/test-browser/reachability.spec.ts
git commit -m "feat(console): redesign investigation workspaces"
```

---

### Task 7: Delivery and Alerting Pages C8—C12

**Files:**
- Modify: `apps/console/src/views/project/ProjectReleasesView.vue`
- Modify: `apps/console/src/views/project/ProjectReleaseDetailView.vue`
- Modify: `apps/console/src/views/project/ProjectSourceMapsView.vue`
- Modify: `apps/console/src/views/project/ProjectAlertsView.vue`
- Modify: `apps/console/src/views/project/ProjectAlertRuleFormView.vue`
- Modify: `apps/console/src/views/project/ProjectAlertInstanceDetailView.vue`
- Create: `apps/console/test/views/project/delivery-alert-presentation.test.ts`
- Modify: `apps/console/test-browser/g12-release-alert-smoke.spec.ts`

**Interfaces:**
- Preserves: release/deployment list-detail relationships, Source Map diagnostic/replace/delete Commands, alert rule/instance tabs, rule form schema, instance acknowledgement/resolution behavior, version/conflict/idempotency, and authorized targets.

- [ ] **Step 1: Add failing presentation assertions for delivery and alert workspaces**

Assert releases and Source Maps use primary-object list/detail layouts; alert overview keeps rules and instances as the approved two tabs; rule form is a single-page adaptive form; alert instance leads with current state and evaluation evidence rather than a decorative timeline.

- [ ] **Step 2: Run release/alert unit tests and verify they fail**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/project/delivery-alert-presentation.test.ts
```

Expected: FAIL on the new structural assertions.

- [ ] **Step 3: Migrate C8/C9 delivery pages**

Render release rows with stable identity, environment/deployment facts, state, and authorized detail target. Render Source Map files as the primary list with diagnostic identity, state, and replacement/deletion actions in a dedicated detail/action area. Preserve upload conflict, processing, missing, and unavailable semantics; do not add deployment charts or processing statistics.

- [ ] **Step 4: Migrate C10/C11/C12 alert pages**

C10 keeps URL-restorable “规则/实例” tabs with consistent toolbars and row lists. C11 groups metric, threshold, window, environment, recipient, and enabled state in one adaptive form, showing only fields allowed by the selected metric. C12 leads with current state, direct reason, rule snapshot, evaluation evidence, and available actions; historical/current rule configuration remain visually distinct.

- [ ] **Step 5: Run unit and browser smoke checks**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/project/delivery-alert-presentation.test.ts test/views/project/releases-view-model.test.ts test/views/project/source-maps-view-model.test.ts test/views/project/alerts-view-model.test.ts test/views/project/alert-rule-form-view-model.test.ts test/views/project/alert-instance-detail-view-model.test.ts
pnpm --filter @aurora/console exec playwright test --config playwright.config.ts test-browser/g12-release-alert-smoke.spec.ts
pnpm --filter @aurora/console typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit C8—C12 migration**

```powershell
git add apps/console/src/views/project/ProjectReleasesView.vue apps/console/src/views/project/ProjectReleaseDetailView.vue apps/console/src/views/project/ProjectSourceMapsView.vue apps/console/src/views/project/ProjectAlertsView.vue apps/console/src/views/project/ProjectAlertRuleFormView.vue apps/console/src/views/project/ProjectAlertInstanceDetailView.vue apps/console/test/views/project/delivery-alert-presentation.test.ts apps/console/test-browser/g12-release-alert-smoke.spec.ts
git commit -m "feat(console): redesign delivery and alerting views"
```

---

### Task 8: Project Governance C13—C16 and Platform Policy D2

**Files:**
- Modify: `apps/console/src/views/project/ProjectAccessView.vue`
- Modify: `apps/console/src/views/project/ProjectClientKeysView.vue`
- Modify: `apps/console/src/views/project/ProjectSettingsView.vue`
- Modify: `apps/console/src/views/project/ProjectLifecycleView.vue`
- Modify: `apps/console/src/views/platform/ResourcePolicyView.vue`
- Create: `apps/console/test/views/project/governance-presentation.test.ts`
- Create: `apps/console/test/views/platform/resource-policy-presentation.test.ts`
- Modify: `apps/console/test-browser/g12-access-settings-smoke.spec.ts`
- Modify: `apps/console/test-browser/g13-resource-policy-smoke.spec.ts`

**Interfaces:**
- Preserves: effective role/source separation, client-key one-time secret lifecycle, project settings/environment independent Commands, archive/delete lifecycle, platform target search, configured/source/effective policy separation, version/conflict/propagating states, and platform-admin authorization.

- [ ] **Step 1: Add failing governance/policy presentation assertions**

Assert C13 shows one person per row with effective role and source separated; C14 uses key list + selected detail rather than a card grid; C15 keeps basic settings and environments as distinct sections/tabs; C16 isolates archive/delete danger actions; D2 shows configured value, source, and effective value as distinct columns/sections and no usage trend/cost/prediction.

- [ ] **Step 2: Run governance/platform tests and verify they fail**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/project/governance-presentation.test.ts test/views/platform/resource-policy-presentation.test.ts
```

Expected: FAIL on the new presentation assertions.

- [ ] **Step 3: Migrate C13—C16**

Use stable lists/tables for people, keys, and environments. Keep inherited/effective role source visible. Put the one-time key result in a dedicated secret delivery surface with copy feedback and no recovery path. Keep project settings/environment forms independent. Render archive and delete as separate danger sections with existing confirmation and lifecycle copy.

- [ ] **Step 4: Migrate D2**

Use a platform-admin workspace with target type/search at the top, an effective-policy summary, and separate editors for platform default, organization override, and project limit. Always distinguish configured/source/effective values; keep propagation and conflict visible. Do not add organization rankings, usage trends, billing, cost, or predicted deletion counts.

- [ ] **Step 5: Run unit and browser governance checks**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/project/governance-presentation.test.ts test/views/platform/resource-policy-presentation.test.ts test/views/project/access-view-model.test.ts test/views/project/client-keys-view-model.test.ts test/views/project/settings-view-model.test.ts test/views/project/lifecycle-view-model.test.ts test/views/platform/resource-policy-view-model.test.ts
pnpm --filter @aurora/console exec playwright test --config playwright.config.ts test-browser/g12-access-settings-smoke.spec.ts test-browser/g13-resource-policy-smoke.spec.ts
pnpm --filter @aurora/console typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit governance/platform migration**

```powershell
git add apps/console/src/views/project/ProjectAccessView.vue apps/console/src/views/project/ProjectClientKeysView.vue apps/console/src/views/project/ProjectSettingsView.vue apps/console/src/views/project/ProjectLifecycleView.vue apps/console/src/views/platform/ResourcePolicyView.vue apps/console/test/views/project/governance-presentation.test.ts apps/console/test/views/platform/resource-policy-presentation.test.ts apps/console/test-browser/g12-access-settings-smoke.spec.ts apps/console/test-browser/g13-resource-policy-smoke.spec.ts
git commit -m "feat(console): redesign governance and policy workspaces"
```

---

### Task 9: Account Security A5, Notification Center D1, and Status Pages

**Files:**
- Modify: `apps/console/src/views/account/AccountSecurityView.vue`
- Modify: `apps/console/src/views/account/NotificationsView.vue`
- Modify: `apps/console/src/views/account/notifications-view-model.ts` only for typed presentation labels
- Modify: `apps/console/src/components/pages/AuthUnavailableView.vue`
- Modify: `apps/console/src/components/pages/ForbiddenView.vue`
- Modify: `apps/console/src/components/pages/NotFoundView.vue`
- Modify: `apps/console/src/components/pages/RootView.vue`
- Modify: `apps/console/src/components/pages/RouteErrorView.vue`
- Modify: `apps/console/src/components/pages/UnavailableView.vue`
- Modify: `apps/console/src/components/pages/WorkspaceHomeView.vue`
- Modify: `apps/console/test/views/account.test.ts`
- Modify: `apps/console/test/views/account/notifications-view-model.test.ts`
- Modify: `apps/console/test/components/status-pages.test.ts`
- Modify: `apps/console/test-browser/deletion-flow.spec.ts`
- Modify: `apps/console/test-browser/g13-notifications-smoke.spec.ts`

**Interfaces:**
- Preserves: A5 password/logout/deletion preflight and two-step confirmation, seven-day cooling period copy, D1 URL `read=all|unread`, keyset loading, single-item mark-read, authorized target opening, and unknown unread count semantics.

- [ ] **Step 1: Add failing A5/D1/status-page presentation tests**

Assert A5 renders an account page header plus separate password, current-session, and danger sections without `AuthCard`; D1 renders a max-width single list with URL tabs, safe context, unread marker, and per-row action; status pages use `AppEmptyState`/`AppSection` and expose one clear recovery action where one already exists.

- [ ] **Step 2: Run account/status tests and verify they fail**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/account.test.ts test/views/account/notifications-view-model.test.ts test/components/status-pages.test.ts
```

Expected: FAIL because A5 still uses the auth card and shared status surfaces are absent.

- [ ] **Step 3: Redesign A5 without changing its security workflow**

Use an 880px account work area. Password uses a normal section; current-session logout is a secondary danger action; account deletion is a full danger section with preflight, unique-owner blockers, two-step email/password confirmation, and explicit seven-day cooling/lifecycle consequences. Preserve CSRF readiness, session revocation, navigation, and every current error branch.

- [ ] **Step 4: Redesign D1 and generic status pages**

Use a centered 840px notification list. Each row has readable type, title, optional summary, minimal safe context, UTC time, unread dot plus text, and mark-read action. Keep “全部/未读” URL tabs and no bulk action. Generic status pages use concise icon, title, explanation, and existing recovery target; forbidden pages never reveal object details.

- [ ] **Step 5: Run account, notification, deletion, and axe checks**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/views/account.test.ts test/views/account/notifications-view-model.test.ts test/components/status-pages.test.ts
pnpm --filter @aurora/console exec playwright test --config playwright.config.ts test-browser/deletion-flow.spec.ts test-browser/g13-notifications-smoke.spec.ts test-browser/axe.spec.ts
pnpm --filter @aurora/console typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit account/global-state migration**

```powershell
git add apps/console/src/views/account apps/console/src/components/pages apps/console/test/views/account.test.ts apps/console/test/views/account apps/console/test/components/status-pages.test.ts apps/console/test-browser/deletion-flow.spec.ts apps/console/test-browser/g13-notifications-smoke.spec.ts apps/console/test-browser/axe.spec.ts
git commit -m "feat(console): redesign account and notification surfaces"
```

---

### Task 10: Visual Regression, Cross-Viewport Verification, Legacy Cleanup, and Documentation

**Files:**
- Modify: `apps/console/src/styles/tokens.css`
- Modify: `apps/console/test/styles/tokens.test.ts`
- Create: `apps/console/test-browser/visual-regression.spec.ts`
- Create: `apps/console/test-browser/visual-regression.spec.ts-snapshots/*.png`
- Modify: `apps/console/playwright.config.ts` only if screenshot defaults require a deterministic animation/font setting
- Modify: `apps/console/README.md`
- Modify: `docs/architecture/platform-frontend.md`
- Modify: `docs/architecture/platform-frontend-shell.md`
- Modify: `docs/superpowers/specs/2026-08-14-aurora-console-ux-ui-redesign-design.md`
- Modify: `docs/README.md`
- Modify: `AGENTS.md`
- Modify: `AURORA_RULES.md`

**Interfaces:**
- Consumes: all Tasks 1—9.
- Produces: no legacy amber/topbar token aliases, committed deterministic visual baselines for the six representative surfaces, and authoritative `implemented-in-feature-branch` documentation only after verification passes.

- [ ] **Step 1: Add failing legacy-token and screenshot regression gates**

Extend `tokens.test.ts` to reject `--color-topbar-*`, `--color-sidebar-*`, `#D47A16`, `.au-topbar`, and `.au-desktop-sidebar` outside superseded historical docs. Add screenshots for:

```ts
test('approved representative surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.origin}/login`);
  await expect(page).toHaveScreenshot('login-desktop.png', { animations: 'disabled' });
  // Authenticate through the existing mock control before the remaining routes.
  await page.goto(`${server.origin}/workspace`);
  await expect(page).toHaveScreenshot('workspace-desktop.png', { animations: 'disabled' });
  await page.goto(`${server.origin}/organizations/org_test_1/projects/prj_test_1/overview`);
  await expect(page).toHaveScreenshot('project-overview-desktop.png', { animations: 'disabled' });
  await page.goto(`${server.origin}/notifications`);
  await expect(page).toHaveScreenshot('notifications-desktop.png', { animations: 'disabled' });
  await page.goto(`${server.origin}/account/security`);
  await expect(page).toHaveScreenshot('account-security-desktop.png', { animations: 'disabled' });
});
```

Add a 390×844 login screenshot and a 900×900 project overview screenshot. Mask only volatile server timestamps; do not mask layout, labels, states, or data completeness messages.

- [ ] **Step 2: Run cleanup/screenshot tests and verify they fail**

Run:

```powershell
pnpm --filter @aurora/console exec vitest run test/styles/tokens.test.ts
pnpm --filter @aurora/console exec playwright test --config playwright.config.ts test-browser/visual-regression.spec.ts
```

Expected: token test FAIL if aliases remain; first screenshot run creates missing baselines and reports them as absent.

- [ ] **Step 3: Remove every legacy alias/reference and approve the generated baselines visually**

Use `git grep` to remove old token/class references from live Console code, then delete the compatibility aliases from `tokens.css`. Inspect each generated PNG at original resolution. Reject and fix any clipped text, oversized blank region, misplaced Drawer, raw primary status key, inaccessible focus indication, or fabricated chart before updating snapshots.

- [ ] **Step 4: Run the complete Console quality chain**

Run:

```powershell
pnpm --filter @aurora/console typecheck
pnpm eslint apps/console/src apps/console/test apps/console/test-browser apps/console/vite.config.ts apps/console/vitest.config.ts apps/console/playwright.config.ts
pnpm --filter @aurora/console test
pnpm --filter @aurora/console test:coverage
pnpm --filter @aurora/console test:package
pnpm --filter @aurora/console test:browser
pnpm --filter @aurora/console test:matrix
```

Expected: all commands PASS. If the full matrix cannot run because a browser binary is unavailable, install the declared Playwright browser locally and rerun; do not mark implementation complete from Chromium-only evidence.

- [ ] **Step 5: Perform manual browser verification at approved widths**

Verify 1440×900, 1280×800, 1024×768, 900×900, 390×844, and 200% zoom. Check keyboard traversal, `Escape` Drawer/menu closure and focus return, reduced motion, long Chinese labels, long project names, empty/error/partial/stale/unavailable states, deep-link refresh, back/forward restoration, C2 no-trend rule, B1 no-health-metric rule, and absence of authenticated navigation on public routes.

- [ ] **Step 6: Update implementation-status documentation only after evidence is green**

Set the redesign document to `implementation-status: implemented-in-feature-branch`, check its plan/implementation/evidence items, and record the exact verification commands. Update Console README, frontend/shell architecture, docs index, AGENTS, and AURORA_RULES to distinguish “implemented in feature branch / not deployed”. Do not change Route Target, API, ADR, deployment, or product statuses.

- [ ] **Step 7: Run documentation and repository checks**

Run:

```powershell
git diff --check
pnpm format:check
pnpm check:boundaries
pnpm --filter @aurora/console test:package
```

Expected: all commands PASS.

- [ ] **Step 8: Commit final verification and documentation**

```powershell
git add apps/console docs/architecture/platform-frontend.md docs/architecture/platform-frontend-shell.md docs/superpowers/specs/2026-08-14-aurora-console-ux-ui-redesign-design.md docs/README.md AGENTS.md AURORA_RULES.md
git commit -m "feat(console): complete calm observability redesign"
```

---

## Self-Review Record

### Spec coverage

- Visual tokens, typography, shapes, motion, and no-gradient/no-fake-data constraints: Tasks 1 and 10.
- Global rail, contextual navigation, scope switching, global-only pages, and responsive Drawer: Task 2.
- Independent authentication shell and all public auth/invitation/token routes: Task 3.
- B1 no-health-metric boundary and B2—B8 organization pages: Task 4.
- C1/C2/C7 state→evidence→action and C2 no-trend boundary: Task 5.
- C3—C6 investigation, URL, selection, detail, metric, completeness, and no-empty-chart rules: Task 6.
- C8—C12 release/Source Map/alert list-detail and form rules: Task 7.
- C13—C16 access/key/settings/lifecycle and D2 configured/source/effective policy rules: Task 8.
- A5 deletion lifecycle, D1 notification boundaries, and generic honest states: Task 9.
- WCAG, keyboard, focus, viewport, screenshot, complete browser matrix, legacy cleanup, and documentation status: Task 10.

### Placeholder scan

The forbidden-marker scan returns no placeholder or unspecified-handling matches. Every code-changing task specifies files, a failing-test command, an implementation contract, a passing verification command, and a commit boundary.

### Type and naming consistency

- `SidebarGroup`, `ORG_SIDEBAR_GROUPS`, and `PROJECT_SIDEBAR_GROUPS` are defined once in Task 2 and consumed by `ContextSidebar`.
- `statusLabel` is defined once in Task 1 and consumed only as presentation copy; raw stable keys remain available through `AppTechnicalDetails`.
- `AppSection`, `AppEmptyState`, `AppSkeleton`, and `AppTechnicalDetails` keep the same names across all later tasks.
- Existing view-model and API types remain authoritative; later tasks may add typed presentation projections but do not rename operation IDs or Route Targets.
