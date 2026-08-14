# Console Navigation Shell Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace detached organization/project selects with accessible anchored scope menus, add explicit top/side navigation current states, and make every desktop organization/project sidebar fixed and viewport-height while the content pane scrolls independently.

**Architecture:** Keep the existing `TopBar → ScopeSwitcher`, `AppShell → LayeredSidebar`, and Navigation Context boundaries. Extend the navigation store only with derived current-project data and safe in-memory activation of already-authorized Navigation Context entries; keep route resolution in the console route registry. CSS changes remain scoped to the shell components and reuse the approved visual tokens.

**Tech Stack:** Vue 3.5 SFC + Composition API, Pinia 4, Vue Router 5, strict TypeScript, Vitest/Vue Testing Library/MSW, Playwright Chromium, axe.

## Global Constraints

- Preserve the `NAV-A` entry order and all 36 Route Targets; do not add, remove, or reorder business navigation.
- Use only Navigation Context-projected organizations, projects, and `entry` Route Targets; never concatenate arbitrary URLs or duplicate role rules.
- Keep `#111827` top bar, `#D47A16` solid sidebar, `#FFF4DC` active row, `#1D4ED8` active indicator, and `background-image: none`.
- Do not change Session, permissions, public API schemas, Query/Command behavior, data, or server code.
- Keep user-owned/unrelated files untouched.
- Apply strict TDD: each behavior test must fail for the intended missing behavior before implementation.

---

### Task 1: Safe Navigation Scope Projection

**Files:**
- Modify: `apps/console/src/stores/navigation.ts`
- Test: `apps/console/test/stores/navigation.test.ts`

**Interfaces:**
- Produces: `currentProject: ComputedRef<ProjectNav | null>`
- Produces: `activateWorkspace(): void`
- Produces: `activateOrganization(organizationId: string): RouteTargetRef | null`
- Produces: `activateProject(projectId: string): RouteTargetRef | null`
- Preserves: `clear()` as the full Session/Navigation Context reset path.

- [ ] **Step 1: Write failing store tests**

Add tests proving that the loaded project scope derives `currentProject`, that organization/project activation preserves the authorized navigation projection while changing the active scope, that the prior scope cache is invalidated, and that unknown IDs return `null` without changing scope.

```ts
it('activates only organizations present in the authorized projection', async () => {
  const store = useNavigationStore();
  await store.load();
  const target = store.activateOrganization('org_test_1');
  expect(target?.routeId).toBe('workspace.home');
  expect(store.currentScope).toEqual({ type: 'organization', id: 'org_test_1', lifecycle: 'active' });
  expect(store.organizations).toHaveLength(1);
});

it('rejects an unknown project without changing the current scope', async () => {
  const store = useNavigationStore();
  await store.load();
  expect(store.activateProject('prj_missing')).toBeNull();
  expect(store.currentScope?.id).toBe('prj_test_1');
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm --filter @aurora/console test -- test/stores/navigation.test.ts
```

Expected: FAIL because `currentProject` and activation methods do not exist.

- [ ] **Step 3: Implement minimal safe activation**

Add a helper that invalidates the current workspace/organization/project cache without clearing the Navigation Context projection. Resolve organizations/projects only from `organizations`; update `currentScope` only after a match; use the projected lifecycle for projects.

```ts
const currentProject = computed<ProjectNav | null>(() => {
  if (currentScope.value?.type !== 'project') return null;
  for (const organization of organizations.value) {
    const project = organization.projects.find(({ projectId }) => projectId === currentScope.value?.id);
    if (project !== undefined) return project;
  }
  return null;
});
```

- [ ] **Step 4: Run focused and store tests and verify GREEN**

Run:

```powershell
pnpm --filter @aurora/console test -- test/stores/navigation.test.ts
```

Expected: all Navigation Context consumer tests PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add apps/console/src/stores/navigation.ts apps/console/test/stores/navigation.test.ts
git commit -m "feat(console): add safe navigation scope activation"
```

### Task 2: Anchored Organization and Project Menus

**Files:**
- Modify: `apps/console/src/components/shell/ScopeSwitcher.vue`
- Modify: `apps/console/src/components/shell/TopBar.vue`
- Modify: `apps/console/src/components/aurora/AppLink.vue`
- Modify: `apps/console/test/components/shell.test.ts`
- Modify: `apps/console/test/components/responsive.test.ts`

**Interfaces:**
- Consumes: Task 1 store activation methods and projected `entry` Route Targets.
- Produces: buttons named from `组织：<name>` and `项目：<name>` with `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, and anchored `role="menu"` lists.
- Produces: explicit active state for workspace, organization, project, notifications, and account-security top-level entries.

- [ ] **Step 1: Write failing shell interaction tests**

Replace the obsolete “combobox exists” assertion with real behavior tests:

```ts
it('opens organization and project menus from integrated topbar buttons', async () => {
  render(App, { global: { plugins: [pinia, router] } });
  const organization = await screen.findByRole('button', { name: /组织：Acme/ });
  expect(screen.queryByRole('combobox')).toBeNull();
  await fireEvent.click(organization);
  expect(screen.getByRole('menu', { name: '选择组织' })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: /Acme.*当前/ })).toBeTruthy();
});

it('closes an open scope menu with Escape and restores trigger focus', async () => {
  const organization = await screen.findByRole('button', { name: /组织：Acme/ });
  await fireEvent.click(organization);
  await fireEvent.keyDown(organization, { key: 'Escape' });
  expect(screen.queryByRole('menu', { name: '选择组织' })).toBeNull();
  expect(document.activeElement).toBe(organization);
});
```

Add route assertions that only the appropriate top-level item has current-page semantics.

- [ ] **Step 2: Run focused component tests and verify RED**

Run:

```powershell
pnpm --filter @aurora/console test -- test/components/shell.test.ts test/components/responsive.test.ts
```

Expected: FAIL because the integrated menu buttons and menu semantics do not exist and the legacy combobox remains.

- [ ] **Step 3: Implement the accessible anchored menus**

In `ScopeSwitcher.vue`:

- track one open menu (`organization | project | null`);
- derive current organization/project names from the store;
- close on Escape, outside pointer interaction, route change, and selection;
- return focus to the trigger on Escape;
- resolve selected projected targets through `resolveRouteTarget`, call Task 1 activation, then `router.push()`;
- render readable empty states instead of disabled fake options;
- keep lists bounded with internal overflow.

In `TopBar.vue`, remove the detached `orgLabel` chip and pass active state to the top-level links/switcher. Handle workspace activation before navigation so organization/project current state does not remain active on `/workspace`.

In `AppLink.vue`, keep shared semantics but isolate selected styling via component-specific CSS so a top-bar active link uses a bottom indicator while a sidebar active link uses the cream row and left indicator.

- [ ] **Step 4: Run focused component tests and verify GREEN**

Run:

```powershell
pnpm --filter @aurora/console test -- test/components/shell.test.ts test/components/responsive.test.ts
```

Expected: all focused component tests PASS and no `combobox` is rendered.

- [ ] **Step 5: Commit Task 2**

```powershell
git add apps/console/src/components/shell/ScopeSwitcher.vue apps/console/src/components/shell/TopBar.vue apps/console/src/components/aurora/AppLink.vue apps/console/test/components/shell.test.ts apps/console/test/components/responsive.test.ts
git commit -m "feat(console): integrate organization and project scope menus"
```

### Task 3: Fixed Full-Height Sidebar and Balanced Navigation Rows

**Files:**
- Modify: `apps/console/src/components/shell/AppShell.vue`
- Modify: `apps/console/src/components/shell/LayeredSidebar.vue`
- Modify: `apps/console/src/styles/tokens.css`
- Modify: `apps/console/test-browser/reachability.spec.ts`

**Interfaces:**
- Produces: `100dvh` desktop shell, fixed-height top bar, `min-height: 0` shell body, independently scrolling `.au-content`, and full-height sidebar.
- Produces: 48px centered sidebar rows with an absolutely positioned 3px active indicator.

- [ ] **Step 1: Add failing browser layout assertions**

Add a Playwright test at a project page with a tall content area:

```ts
const sidebar = page.locator('.au-desktop-sidebar');
const content = page.locator('.au-content');
const before = await sidebar.boundingBox();
await content.evaluate((element) => { element.scrollTop = 600; });
const after = await sidebar.boundingBox();
expect(after?.y).toBe(before?.y);
expect(after?.height).toBe(before?.height);
expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
```

Assert the active “概览” link has `aria-current="page"`, computed `min-height` is at least 48px, and its text box is horizontally centered within the row within a two-pixel tolerance.

- [ ] **Step 2: Build the test bundle and run the new browser test to verify RED**

Run:

```powershell
pnpm --filter @aurora/console build:test
pnpm --filter @aurora/console exec playwright test test-browser/reachability.spec.ts --grep "fixed full-height sidebar"
```

Expected: FAIL because document scrolling currently owns the page and sidebar rows are only 40px with left-aligned text.

- [ ] **Step 3: Implement the viewport shell and sidebar row CSS**

In `AppShell.vue`:

```css
.au-shell { height: 100vh; height: 100dvh; overflow: hidden; }
.au-shell-body { flex: 1; min-height: 0; overflow: hidden; }
.au-desktop-sidebar { flex: 0 0 248px; min-height: 0; }
.au-content { min-height: 0; overflow-y: auto; }
```

In `LayeredSidebar.vue`, make the navigation 100% high with its own overflow, give list items horizontal margin and consistent gap, center every link, and render the active indicator through `::before` so text alignment is not shifted. Keep the Drawer `fill` variant at width/height 100%.

Add `--topbar-height: 56px` and `--sidebar-width: 248px` tokens while preserving `--nav-height: 44px` for row-height consumers.

- [ ] **Step 4: Rebuild and verify the browser test GREEN**

Run:

```powershell
pnpm --filter @aurora/console build:test
pnpm --filter @aurora/console exec playwright test test-browser/reachability.spec.ts --grep "fixed full-height sidebar"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add apps/console/src/components/shell/AppShell.vue apps/console/src/components/shell/LayeredSidebar.vue apps/console/src/styles/tokens.css apps/console/test-browser/reachability.spec.ts
git commit -m "style(console): fix and balance the layered sidebar"
```

### Task 4: End-to-End Scope Navigation, Accessibility, and Visual Evidence

**Files:**
- Modify: `apps/console/test-browser/reachability.spec.ts`
- Modify: `apps/console/test-browser/axe.spec.ts`
- Modify: `apps/console/README.md`
- Create (ignored evidence only): `apps/console/.artifacts/navigation-org-trash.png`
- Create (ignored evidence only): `apps/console/.artifacts/navigation-project-overview.png`

**Interfaces:**
- Consumes: Tasks 1–3 behavior.
- Produces: real browser evidence for click/keyboard scope menus, focus restoration, active states, fixed scrolling, and both reference screenshots.

- [ ] **Step 1: Add failing end-to-end interaction tests**

Cover:

- organization menu opens and selects `Acme` through a real click;
- project menu opens and selects `Web` through keyboard interaction;
- only one menu is open at a time;
- Escape closes and restores trigger focus;
- organization/project selections navigate through projected targets;
- axe analysis runs with an open menu as well as the normal shell.

- [ ] **Step 2: Run targeted Playwright/axe tests and verify RED**

Run:

```powershell
pnpm --filter @aurora/console build:test
pnpm --filter @aurora/console exec playwright test test-browser/reachability.spec.ts test-browser/axe.spec.ts --grep "scope menu|authenticated shell"
```

Expected: new interaction test(s) fail before final fixes.

- [ ] **Step 3: Apply only minimal behavior/accessibility fixes**

Fix actual failures in the new menu/focus/ARIA behavior; do not expand scope. Update the Console README architecture and accessibility sections to describe anchored organization/project menus and the fixed desktop scroll model.

- [ ] **Step 4: Run complete Console verification**

Run fresh:

```powershell
pnpm --filter @aurora/console typecheck
pnpm --filter @aurora/console test
pnpm --filter @aurora/console test:coverage
pnpm --filter @aurora/console test:package
pnpm --filter @aurora/console test:browser
pnpm eslint apps/console/src apps/console/test apps/console/test-browser apps/console/vite.config.ts apps/console/vitest.config.ts apps/console/playwright.config.ts
```

Expected: all commands exit 0 with no test or axe failures.

- [ ] **Step 5: Capture local visual evidence**

Use Playwright at `1906 × 1014` to capture organization trash and project overview after asserting the integrated trigger, active state, sidebar height, and independent content scroll. Store screenshots under ignored `apps/console/.artifacts/`.

- [ ] **Step 6: Commit Task 4**

```powershell
git add apps/console/test-browser/reachability.spec.ts apps/console/test-browser/axe.spec.ts apps/console/README.md
git commit -m "test(console): verify polished navigation shell"
```

### Task 5: Preview Deployment and Public Verification

**Files:**
- No source changes expected.
- Deployment creates a new server release under `/opt/aurora-preview/releases/<release-id>`.

**Interfaces:**
- Consumes: repository `pnpm deploy:preview` controlled release path.
- Produces: HTTPS-visible Console at `https://aurora.ah.cn/` with the approved navigation behavior.

- [ ] **Step 1: Verify the final diff and clean feature scope**

Run:

```powershell
git status --short --branch
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
```

Confirm no unrelated files or server/public API changes are present.

- [ ] **Step 2: Deploy the verified working tree**

Use the repository-controlled Bash entry with the configured SSH key:

```powershell
bash deploy/preview/scripts/deploy-preview.sh
```

Expected: local gate, source shipment, remote image build, migration no-op/success, Compose health, atomic `current` switch, nginx validation/reload, and deploy completion all succeed.

- [ ] **Step 3: Verify public HTTPS behavior**

Verify:

- `https://aurora.ah.cn/` returns 200 and loads the current hashed Console bundle;
- authenticated organization/project routes render without console errors;
- organization/project menus open under their triggers;
- top and side active states are visible;
- the sidebar remains fixed/full-height while the right pane scrolls;
- `https://ingest.aurora.ah.cn/v1/batches` keeps its expected unauthenticated 401 behavior.

- [ ] **Step 4: Record deployment result**

Report the release ID, public verification result, exact test counts, and any remaining limitation. If any public verification fails, run the existing rollback command and report the actual state rather than claiming success.

