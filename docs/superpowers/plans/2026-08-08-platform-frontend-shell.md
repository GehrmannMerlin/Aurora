# PLT-02 Platform Frontend Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real `apps/console` (`@aurora/console`, private) Vue 3 SPA shell: application bootstrap, Vue Router, Pinia, Session Context consumer (safe `unauthenticated`/`unavailable`), Navigation Context consumer (or safe empty state), the 36-RouteTarget mapping + route registry, top bar / layered sidebar / content outlet / scope-switch skeleton, global loading, status pages, focus + keyboard + responsive minimum, Playwright real-browser reachability enforcement, and switch of `aurora.ah.cn` from the static Preview status page to the built Vue SPA — with no fake user/session/org/project/API and no G10–G13 business implementation.

**Architecture:** `apps/console` is a pure-client Vue 3 SPA under the new workspace-policy `console` layer (allowed deps: `contract`, `tooling`). All platform calls go through the generated `@aurora/platform-contract/client` (`buildRequest`/`parseResponse`); a small request/cache layer adds query keys, scope isolation, concurrent dedup, cancellation, stale-response discard, RFC 9457 error normalization and scope-switch cleanup. The Session Context consumes `identityGetSession`; the Navigation Context consumes `navigationGetContext` (or falls back to a safe empty state). The front-end route registry maps all 36 `RouteTargetId`s (verbatim from `packages/platform-contract/src/common/navigation.ts`) to path templates, scope, param/query zod schemas and lazy-load entries; business targets (G10–G13) render explicit `feature/dependency/permission unavailable` or `not-found` states, never fake data. MSW (test builds only, from `contract-testkit` valid samples) drives Vitest and Playwright. `deploy/preview` gains a `console` nginx service and the `aurora.ah.cn` vhost switches from the static status page to the SPA (`try_files $uri /index.html`).

**Tech Stack:** Vue 3.5.41 (SFC + Composition API, strict TS), Vite 8.2.1, @vitejs/plugin-vue 6.0.8, vue-router 5.2.0, pinia 4.0.2, primevue 5.0.0 (through the Aurora UI wrapper), zod 4.4.3 (already locked), vue-tsc 3.3.9, vitest 4.1.10 + jsdom 30.0.1, @vue/test-utils 2.4.11, @testing-library/vue 8.1.0, msw 2.15.0, @playwright/test 1.62.1, @axe-core/playwright 4.12.1, typescript 6.0.3, eslint 10.8.1 (root-level; app adds no eslint dep).

## Closing leaf
- **PLT-02**

## Baseline / Target
- Starting (if still current): `completed = 39` / `remaining = 39`
- After verified PLT-02: `completed = 40` / `remaining = 38`
- Leaf counts change **only** after PLT-02 is independently verified; not on ADR/spec/plan creation. This plan's Task 11 doc-sync therefore records `implemented-in-feature-branch` and keeps counts at 39/39.

## Global Constraints

- Strict TypeScript (repo base `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); `apps/console` typechecks with `vue-tsc --noEmit`.
- Exact dependency versions locked — no floating `latest`: vue 3.5.41, vite 8.2.1, @vitejs/plugin-vue 6.0.8, vue-router 5.2.0, pinia 4.0.2, vue-tsc 3.3.9, vitest 4.1.10, @playwright/test 1.62.1, msw 2.15.0, primevue 5.0.0, vee-validate 4.15.1 (recorded for a future form leaf; **not installed this leaf** — spec §3 YAGNI: the shell has no forms), @testing-library/vue 8.1.0, @axe-core/playwright 4.12.1, @vue/test-utils 2.4.11, eslint 10.8.1 (root), typescript 6.0.3, jsdom 30.0.1, @vitest/coverage-v8 4.1.10, zod 4.4.3 (matches the already-locked contract dep).
- Session backend is **not implemented** → Session Context enters the approved safe `unauthenticated` / `unavailable` state; never hardcode `authenticated=true`.
- No fake user / session / organization / project / API; no localStorage fake session; no credentials in Pinia; no fake table / chart / issue / usage; no lorem ipsum; no `unavailable` faked by empty arrays, all-zero data or disabled buttons.
- Route guards do navigation-experience only (never authorization, never prove resource existence); the backend re-authorizes every Query/Command.
- Browser only calls the public `platform-api` through the generated client; no hand-written `fetch` paths, no DB / queue / private-package access.
- MSW only for frontend tests; MSW handlers built **only** from `@aurora/platform-contract/contract-testkit` valid samples; production build must not contain MSW or `contract-testkit`.
- Reachability enforcement: every shell-rendered nav entry (top bar, org/project sidebar, scope-switch entries, D1/A5 entry skeletons) reached by real UI click/keyboard and asserted by Playwright; `page.goto()`-only is not acceptable evidence; unrendered G10–G13 targets assert parse/protect/represent + explicit `unavailable`/`blocked`/`forbidden`.
- No gradients: formal surfaces `background-image: none`; no texture/noise/glow/glassmorphism/translucent overlay; only Dialog/Drawer/Popover real overlays may use a unified light shadow.
- Visual tokens verbatim from spec §11: 浅色内容区 `#F8FAFC`, 白色表面 `#FFFFFF`, 深石墨顶栏 `#111827`/foreground `#F8FAFC`, 纯色琥珀橙侧栏 `#D47A16`/foreground `#17120D`, 当前路由选中行 `#FFF4DC`/foreground `#172033` + 左侧蓝 `#1D4ED8` 3px, 默认边界 `#CBD5E1`, 深色前景 `#111827`, 辅助文字 `#475569`, 主操作蓝 `#2563EB`, 异常红 `#D92D20`, 成功绿 `#15803D`; spacing 4/8/12/16/24/32px; 控件 40px 导航 44px; 圆角 6px; system-ui 字体栈（`system-ui`, `Segoe UI`, `PingFang SC`, `Microsoft YaHei`）.
- WCAG 2.2 AA direction + axe; keyboard order matches visual order; after navigation focus moves to the page title / error summary; status is never color-only.
- Dependency direction 页面 → 业务组合/领域 Store → 公开 API 客户端与契约适配; Aurora UI does not depend on pages or domain stores.
- Workspace-policy `console` layer depends only on `contract` and `tooling`; must NOT depend on database/service internal packages; `console` is not a `service` layer (ADR-025 reviewer N2).
- No ECharts in this leaf (spec §10, ADR-025 决定细节 10); no Storybook; no dark theme / user theme switch; no external web fonts.
- No secrets in logs, DevTools snapshots, MSW fixtures, Playwright traces/screenshots; Session-related errors never enter URL, logs or reusable snapshots.
- Prettier `singleQuote`, `printWidth 100`, `trailingComma all`, LF; format changed files with `pnpm prettier --write`.
- Every task: failing test → verify failure → minimal implementation → verify pass → `git diff --check` → commit on `feature/g09-platform-contract-shell`; no `git add` of unrelated files; no push to main.
- `docs/superpowers/plans` is gitignored by `.prettierignore` — the plan itself is not prettier-checked, but all `.ts`/`.vue`/`.md` code produced by the tasks is.

---

### Task 1: Scaffold `apps/console` + workspace-policy `console` layer + lint/format/root-script registration + dependency install and compat verification

**Files:**
- Create: `apps/console/package.json`
- Create: `apps/console/tsconfig.json`
- Create: `apps/console/vite.config.ts`
- Create: `apps/console/vitest.config.ts`
- Create: `apps/console/playwright.config.ts`
- Create: `apps/console/index.html`
- Create: `apps/console/.gitignore`
- Create: `apps/console/src/vite-env.d.ts`
- Create: `apps/console/src/main.ts`
- Create: `apps/console/src/App.vue`
- Create: `apps/console/test/bootstrap.test.ts`
- Create: `apps/console/README.md`
- Modify: `tooling/workspace-policy/src/graph.ts` (add `console` layer)
- Modify: `tooling/workspace-policy/test/dependency-policy.test.ts` (add console-layer cases)
- Modify: `eslint.config.mjs` (add `apps/console/**/*.ts`)
- Modify: `package.json` (append apps/console paths to `format:check`/`lint`; add `pnpm --filter @aurora/console test:coverage` and `test:package`/`test:browser` to `check`; bump root `eslint` devDependency 10.8.0 → 10.8.1)
- Modify: `pnpm-workspace.yaml` (no change needed — `apps/*` already covers it)

**Interfaces:**
- Consumes: `@aurora/platform-contract` root (`PLATFORM_OPERATIONS`, `OPERATION_ID_SESSION`) for the Task 1 smoke only.
- Produces:
  - Workspace-policy layer `console` with allowed local deps `{ 'contract', 'tooling' }`.
  - `@aurora/console` scripts: `build` (`pnpm --filter @aurora/platform-contract build && vite build`), `build:test` (`pnpm --filter @aurora/platform-contract build && vite build --mode test --outDir dist-test`), `typecheck` (`vue-tsc --noEmit`), `test`, `test:coverage`, `test:package`, `test:browser` (`pnpm build:test && playwright test --config playwright.config.ts`).
  - `src/main.ts` mounting `#app`; `src/App.vue` (Task 1 minimal text shell); `src/vite-env.d.ts` with `/// <reference types="vite/client" />`.
  - A vitest jsdom environment + `@testing-library/vue` `render` smoke that proves the Vue/Vite/vitest/jsdom stack is mutually compatible at the pinned versions.

- [ ] **Step 1: Write the failing test**

`apps/console/test/bootstrap.test.ts`:

```ts
import { render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import App from '../src/App.vue';

describe('console bootstrap', () => {
  it('mounts the application root', () => {
    render(App);
    expect(screen.getByText('Aurora 管理平台')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/console test`
Expected: FAIL — package has no `test` script yet (`ERR_PNPM_NO_SCRIPT`). Record this first failure gate.

- [ ] **Step 3: Write minimal implementation**

`apps/console/package.json`:

```json
{
  "name": "@aurora/console",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Aurora management platform Vue 3 SPA shell",
  "exports": {
    ".": "./index.html"
  },
  "files": [
    "dist"
  ],
  "engines": {
    "node": ">=24.18.0 <25"
  },
  "scripts": {
    "build": "pnpm --filter @aurora/platform-contract build && vite build",
    "build:test": "pnpm --filter @aurora/platform-contract build && vite build --mode test --outDir dist-test",
    "typecheck": "vue-tsc --noEmit",
    "test": "vitest run --exclude test/package-entry.test.ts",
    "test:coverage": "vitest run --coverage --exclude test/package-entry.test.ts",
    "test:package": "pnpm build && vitest run test/package-entry.test.ts",
    "test:browser": "pnpm build:test && playwright test --config playwright.config.ts"
  },
  "dependencies": {
    "@aurora/platform-contract": "workspace:*",
    "pinia": "4.0.2",
    "primevue": "5.0.0",
    "vue": "3.5.41",
    "vue-router": "5.2.0",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@axe-core/playwright": "4.12.1",
    "@playwright/test": "1.62.1",
    "@testing-library/vue": "8.1.0",
    "@vitejs/plugin-vue": "6.0.8",
    "@vitest/coverage-v8": "4.1.10",
    "@vue/test-utils": "2.4.11",
    "jsdom": "30.0.1",
    "msw": "2.15.0",
    "typescript": "6.0.3",
    "vite": "8.2.1",
    "vitest": "4.1.10",
    "vue-tsc": "3.3.9"
  },
  "aurora": {
    "layer": "console"
  }
}
```

Note: `vee-validate` is deliberately **not** installed (spec §3 YAGNI — the shell has no forms; a future form leaf pins 4.15.1). ECharts is **not** installed (spec §10, ADR-025 决定细节 10). The `exports`/`files` fields are present because the workspace-policy manifest gate requires them for every workspace package.

`apps/console/tsconfig.json` (Vue SFC + Vite need bundler resolution, overriding the repo's NodeNext base for this app only):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "types": ["vite/client", "vitest/globals"],
    "paths": {
      "@aurora/platform-contract": ["../../packages/platform-contract/src/index.ts"],
      "@aurora/platform-contract/client": ["../../packages/platform-contract/src/client/index.ts"],
      "@aurora/platform-contract/contract-testkit": ["../../packages/platform-contract/src/contract-testkit/index.ts"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "test/**/*.ts", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

The `paths` map lets `vue-tsc --noEmit` and vitest resolve the contract's TypeScript source directly, so `typecheck` works on a fresh checkout before the contract `dist` is built (mirrors how `tooling/platform-contract-drift` aliases the contract source in vitest). Vite's production build still resolves the real built package through `node_modules` (the `build` script builds the contract first).

`apps/console/vite.config.ts`:

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  build: {
    sourcemap: false,
  },
});
```

`apps/console/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@aurora\/platform-contract$/,
        replacement: fileURLToPath(
          new URL('../../packages/platform-contract/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/platform-contract\/client$/,
        replacement: fileURLToPath(
          new URL('../../packages/platform-contract/src/client/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@aurora\/platform-contract\/contract-testkit$/,
        replacement: fileURLToPath(
          new URL('../../packages/platform-contract/src/contract-testkit/index.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { branches: 75, functions: 80, lines: 80, statements: 80 },
    },
  },
});
```

`apps/console/playwright.config.ts` (mirrors the `packages/browser` precedent):

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: 'line',
  testDir: './test-browser',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  workers: 1,
});
```

`apps/console/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Aurora 管理平台</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/console/.gitignore`:

```gitignore
dist-test
```

`apps/console/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`apps/console/src/main.ts` (Task 1 minimal; Tasks 5–7 add pinia/router/MSW):

```ts
import { createApp } from 'vue';
import App from './App.vue';

const app = createApp(App);
app.mount('#app');
```

`apps/console/src/App.vue` (Task 1 minimal; Tasks 7–9 replace it with the real shell):

```vue
<script setup lang="ts">
const appTitle = 'Aurora 管理平台';
</script>

<template>
  <div class="au-app">{{ appTitle }}</div>
</template>

<style scoped>
.au-app {
  font-family:
    system-ui,
    'Segoe UI',
    'PingFang SC',
    'Microsoft YaHei',
    sans-serif;
}
</style>
```

`apps/console/README.md` — one paragraph: module 定位（`apps/console` `@aurora/console` private Vue 3 SPA shell, PLT-02）、层（`console` → `contract`/`tooling`）、命令（`build`/`build:test`/`typecheck`/`test`/`test:coverage`/`test:package`/`test:browser`）、测试模式说明（`--mode test` 启用 MSW，仅前端测试）。No invented endpoints.

- [ ] **Step 4: Install and lock exact versions; verify mutual compatibility**

Run:
```bash
pnpm install
```
Then confirm every dependency appears in `apps/console/package.json` with an exact version (no `latest`) and in `pnpm-lock.yaml` at the pinned version. Then run the dependency-compat verification (the plan-mandated compat step — peer ranges verified at write time: vitest 4.1.10 peer `vite ^6||^7||^8` ✓ / `jsdom *` ✓; @testing-library/vue 8.1.0 peer `vue >=3` ✓; @vue/test-utils 2.4.11 peer `vue 3.x` ✓; vue-router 5.2.0 peer `vue ^3.5.34` ✓ / `pinia ^3.0.4||^4.0.2` ✓ / `vite ^7.3||^8` ✓; vue-tsc 3.3.9 peer `typescript >=5` ✓; @vitejs/plugin-vue 6.0.8 peer `vite ^5||^6||^7||^8`, `vue ^3.2.25` ✓; vite 8.2.1 engines node `^20.19||>=22.12` ✓ on node 24.18; @axe-core/playwright 4.12.1 peer `playwright-core >=1` ✓). Confirm at install time by running the Step 8 commands; if any peer/engine conflict surfaces, pin the latest mutually-compatible set (staying within the recorded pins where possible), record the corrected set in `apps/console/README.md` and continue — do not float `latest`.

Also bump root `package.json` devDependency `eslint` from `10.8.0` to `10.8.1` (the pinned query) and re-run `pnpm install` so `pnpm-lock.yaml` reflects it. The app adds no eslint dependency of its own — the root eslint lints it.

- [ ] **Step 5: Add the `console` layer to workspace-policy**

`tooling/workspace-policy/src/graph.ts` — replace the `allowedLocalDependencyLayers` map:

```ts
const allowedLocalDependencyLayers: ReadonlyMap<string, ReadonlySet<string>> = new Map<
  string,
  ReadonlySet<string>
>([
  ['protocol', new Set<string>()],
  ['sdk-core', new Set<string>(['protocol'])],
  ['sdk-browser', new Set<string>(['sdk-core', 'protocol'])],
  ['sdk-plugin', new Set<string>(['sdk-core', 'sdk-browser', 'protocol'])],
  ['data', new Set<string>(['protocol'])],
  ['service', new Set<string>(['protocol', 'data', 'tooling', 'contract'])],
  ['contract', new Set<string>(['protocol'])],
  ['tooling', new Set<string>(['service', 'data', 'protocol', 'tooling', 'contract'])],
  ['console', new Set<string>(['contract', 'tooling'])],
]);
```

`console` is its own layer (ADR-025 决定细节 13, spec §13) and deliberately not the `service` layer (ADR-025 reviewer N2: `service` may depend on `data`; `console` must not reach DB/service internals). Allowed local deps are exactly `{contract, tooling}`.

- [ ] **Step 6: Add console-layer cases to the workspace-policy tests**

`tooling/workspace-policy/test/dependency-policy.test.ts` — append new `it` blocks using the existing helpers (`createWorkspaceFixture`, `validManifest`, `checkWorkspace`):

```ts
it('allows a console package to depend on contract', async () => {
  const consoleApp = validManifest('@aurora/console');
  consoleApp.aurora = { layer: 'console' };
  consoleApp.dependencies = { '@aurora/platform-contract': 'workspace:*' };
  const contract = validManifest('@aurora/platform-contract');
  contract.aurora = { layer: 'contract' };
  fixture = await createWorkspaceFixture([
    { directory: 'apps/console', manifest: consoleApp },
    { directory: 'packages/platform-contract', manifest: contract },
  ]);
  const result = await checkWorkspace(fixture.rootDir);
  expect(result.violations.filter((v) => v.code === 'forbidden-layer-dependency')).toHaveLength(0);
});

it('allows a console package to depend on tooling', async () => {
  const consoleApp = validManifest('@aurora/console');
  consoleApp.aurora = { layer: 'console' };
  consoleApp.dependencies = { '@aurora/platform-contract-drift': 'workspace:*' };
  const tool = validManifest('@aurora/platform-contract-drift');
  tool.aurora = { layer: 'tooling' };
  fixture = await createWorkspaceFixture([
    { directory: 'apps/console', manifest: consoleApp },
    { directory: 'tooling/platform-contract-drift', manifest: tool },
  ]);
  const result = await checkWorkspace(fixture.rootDir);
  expect(result.violations.filter((v) => v.code === 'forbidden-layer-dependency')).toHaveLength(0);
});

it('rejects a console package depending on data (no DB internals)', async () => {
  const consoleApp = validManifest('@aurora/console');
  consoleApp.aurora = { layer: 'console' };
  consoleApp.dependencies = { '@aurora/processing-store': 'workspace:*' };
  const store = validManifest('@aurora/processing-store');
  store.aurora = { layer: 'data' };
  fixture = await createWorkspaceFixture([
    { directory: 'apps/console', manifest: consoleApp },
    { directory: 'packages/processing-store', manifest: store },
  ]);
  const result = await checkWorkspace(fixture.rootDir);
  expect(result.violations.some((v) => v.code === 'forbidden-layer-dependency')).toBe(true);
});

it('rejects a console package reaching data when declared as the service layer', async () => {
  const consoleApp = validManifest('@aurora/console');
  consoleApp.aurora = { layer: 'console' };
  consoleApp.dependencies = { '@aurora/processing-store': 'workspace:*' };
  const store = validManifest('@aurora/processing-store');
  store.aurora = { layer: 'data' };
  fixture = await createWorkspaceFixture([
    { directory: 'apps/console', manifest: consoleApp },
    { directory: 'packages/processing-store', manifest: store },
  ]);
  const result = await checkWorkspace(fixture.rootDir);
  expect(result.violations.some((v) => v.code === 'forbidden-layer-dependency')).toBe(true);
});
```

Use the existing helper names exactly as they appear in the current `dependency-policy.test.ts` (`checkWorkspace`, `createWorkspaceFixture`, `validManifest`, the `fixture` variable in `beforeEach`/`afterEach`); do not invent a new helper.

- [ ] **Step 7: Register the app in ESLint and root scripts**

`eslint.config.mjs` — add `'apps/console/**/*.ts',` to the `files` array (only `.ts` logic files; `.vue` SFC templates are type-checked by `vue-tsc` and formatted by prettier, matching the repo's eslint setup which does not use a vue parser).

`package.json`:
- In `format:check`: append `apps/console/package.json apps/console/tsconfig.json apps/console/vite.config.ts apps/console/vitest.config.ts apps/console/playwright.config.ts apps/console/index.html "apps/console/src/**/*.ts" "apps/console/src/**/*.vue" "apps/console/test/**/*.ts" apps/console/README.md`
- In `lint`: append `apps/console/src apps/console/test apps/console/vite.config.ts apps/console/vitest.config.ts apps/console/playwright.config.ts`
- In `test:coverage`: append `&& pnpm --filter @aurora/console test:coverage`
- In `check`: append `&& pnpm --filter @aurora/console test:package && pnpm --filter @aurora/console test:browser`

- [ ] **Step 8: Run the tests to verify they pass**

Run:
```bash
pnpm --filter @aurora/workspace-policy test
pnpm --filter @aurora/console test
pnpm --filter @aurora/console typecheck
pnpm typecheck
pnpm check:boundaries
```
Expected: PASS — bootstrap test passes (proves pinned Vue/vitest/jsdom/@testing-library/vue versions are mutually compatible), workspace-policy console-layer cases pass, `vue-tsc` passes on the SFC, full typecheck passes, boundaries pass with the new layer. This is the compat-verification gate.

- [ ] **Step 9: Commit**

```bash
git add apps/console tooling/workspace-policy/src/graph.ts tooling/workspace-policy/test/dependency-policy.test.ts eslint.config.mjs package.json pnpm-lock.yaml
git commit -m "feat: scaffold @aurora/console app and add console layer"
```

---

### Task 2: Design tokens + visual-language foundation (tokens.css, base.css, no-gradients enforcement)

**Files:**
- Create: `apps/console/src/styles/tokens.css`
- Create: `apps/console/src/styles/base.css`
- Create: `apps/console/test/styles/tokens.test.ts`
- Modify: `apps/console/src/main.ts` (import the two stylesheets)

**Interfaces:**
- Consumes: nothing from earlier tasks except the Task 1 scaffold.
- Produces:
  - `src/styles/tokens.css`: `:root` CSS custom properties for every approved token (exact values from spec §11), spacing `--space-1..6` (4/8/12/16/24/32px), `--control-height: 40px`, `--nav-height: 44px`, `--radius-base: 6px`, `--font-family-base` system stack.
  - `src/styles/base.css`: box-sizing reset, body background/color/font, `background-image: none` on formal surfaces, `:focus-visible` ring using `--color-action-primary`.
  - `test/styles/tokens.test.ts`: the no-gradients / token-completeness gate (visual language §9 "样式检查必须阻止侧栏使用 gradient、背景图、纹理或未登记主题值").

- [ ] **Step 1: Write the failing test**

`apps/console/test/styles/tokens.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSources(full, acc);
    else if (/\.(css|vue|ts)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const sources = collectSources(srcDir);

describe('visual language foundation', () => {
  it('defines every approved token with its exact value', () => {
    const tokens = readFileSync(join(srcDir, 'styles/tokens.css'), 'utf8');
    const expected: ReadonlyArray<[string, string]> = [
      ['--color-topbar-bg', '#111827'],
      ['--color-topbar-fg', '#F8FAFC'],
      ['--color-sidebar-bg', '#D47A16'],
      ['--color-sidebar-fg', '#17120D'],
      ['--color-sidebar-active-bg', '#FFF4DC'],
      ['--color-sidebar-active-fg', '#172033'],
      ['--color-sidebar-active-indicator', '#1D4ED8'],
      ['--color-page-bg', '#F8FAFC'],
      ['--color-surface-bg', '#FFFFFF'],
      ['--color-border-default', '#CBD5E1'],
      ['--color-text-primary', '#111827'],
      ['--color-text-secondary', '#475569'],
      ['--color-action-primary', '#2563EB'],
      ['--color-status-danger', '#D92D20'],
      ['--color-status-success', '#15803D'],
    ];
    for (const [name, value] of expected) {
      expect(tokens, name).toContain(`${name}: ${value};`);
    }
  });

  it('forbids gradients across every source file', () => {
    for (const file of sources) {
      const content = readFileSync(file, 'utf8').toLowerCase();
      expect(content, file).not.toMatch(/(linear|radial|conic)-gradient/);
    }
  });

  it('allows background-image only as none on formal surfaces', () => {
    for (const file of sources) {
      const content = readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        if (/background-image\s*:/.test(line)) {
          expect(line, file).toMatch(/background-image\s*:\s*none\s*;/);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/console test`
Expected: FAIL — `src/styles/tokens.css` does not exist (ENOENT).

- [ ] **Step 3: Write minimal implementation**

`apps/console/src/styles/tokens.css`:

```css
:root {
  --color-topbar-bg: #111827;
  --color-topbar-fg: #F8FAFC;
  --color-sidebar-bg: #D47A16;
  --color-sidebar-fg: #17120D;
  --color-sidebar-active-bg: #FFF4DC;
  --color-sidebar-active-fg: #172033;
  --color-sidebar-active-indicator: #1D4ED8;
  --color-page-bg: #F8FAFC;
  --color-surface-bg: #FFFFFF;
  --color-border-default: #CBD5E1;
  --color-text-primary: #111827;
  --color-text-secondary: #475569;
  --color-action-primary: #2563EB;
  --color-status-danger: #D92D20;
  --color-status-success: #15803D;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  --control-height: 40px;
  --nav-height: 44px;
  --radius-base: 6px;

  --font-family-base:
    system-ui,
    'Segoe UI',
    'PingFang SC',
    'Microsoft YaHei',
    sans-serif;
}
```

`apps/console/src/styles/base.css`:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  background-color: var(--color-page-bg);
  color: var(--color-text-primary);
  font-family: var(--font-family-base);
  font-size: 14px;
  line-height: 1.5;
}

/* 禁止渐变：正式表面统一背景图关闭，仅 Dialog/Drawer/Popover 浮层可用统一轻量阴影 */
body,
.au-topbar,
.au-sidebar,
.au-surface {
  background-image: none;
}

:focus-visible {
  outline: 2px solid var(--color-action-primary);
  outline-offset: 2px;
}
```

`apps/console/src/main.ts` — append the stylesheet imports after the existing imports:

```ts
import { createApp } from 'vue';
import App from './App.vue';
import './styles/tokens.css';
import './styles/base.css';

const app = createApp(App);
app.mount('#app');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aurora/console test`
Expected: PASS (tokens present with exact values, no gradient tokens anywhere, `background-image` only `none`).

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/styles apps/console/test/styles apps/console/src/main.ts
git commit -m "feat: add design tokens and visual-language no-gradient foundation"
```

---

### Task 3: Aurora UI wrapper layer (AppButton / AppLink / AppStatusBadge / AppPageHeader / AppDrawer)

**Files:**
- Create: `apps/console/src/components/aurora/AppButton.vue`
- Create: `apps/console/src/components/aurora/AppLink.vue`
- Create: `apps/console/src/components/aurora/AppStatusBadge.vue`
- Create: `apps/console/src/components/aurora/AppPageHeader.vue`
- Create: `apps/console/src/components/aurora/AppDrawer.vue`
- Create: `apps/console/test/components/aurora.test.ts`

**Interfaces:**
- Consumes: design tokens from Task 2 (`var(--color-*)`, `var(--space-*)`, `var(--control-height)`, `var(--radius-base)`); `RouterLink` from `vue-router`.
- Produces (used by Tasks 7/8/9):
  - `AppButton` — props `{ variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; type?: 'button' | 'submit' }`, emits `(e: 'click', event: MouseEvent)`.
  - `AppLink` — props `{ to: string; label?: string; active?: boolean }`, renders `<RouterLink>` with `aria-current="page"` when active.
  - `AppStatusBadge` — props `{ tone?: 'neutral' | 'success' | 'danger' | 'warning' }`, renders `<span role="status">` (text is always present — status is never color-only).
  - `AppPageHeader` — props `{ title: string; testId?: string }`, renders `<h1 id="page-title" tabindex="-1">` (default id, overridable) — the post-navigation focus target.
  - `AppDrawer` — props `{ open: boolean; title: string }`, emits `(e: 'close')`, wraps PrimeVue `Drawer` (position left) with `aria-label`; used by the narrow-screen sidebar (Task 9).

- [ ] **Step 1: Write the failing test**

`apps/console/test/components/aurora.test.ts`:

```ts
import { fireEvent, render, screen } from '@testing-library/vue';
import { RouterLinkStub } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import AppButton from '../../src/components/aurora/AppButton.vue';
import AppLink from '../../src/components/aurora/AppLink.vue';
import AppPageHeader from '../../src/components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../src/components/aurora/AppStatusBadge.vue';
import AppDrawer from '../../src/components/aurora/AppDrawer.vue';

const DrawerStub = defineComponent({
  name: 'DrawerStub',
  props: { visible: Boolean, header: String, position: String, ariaLabel: String },
  emits: ['update:visible'],
  template:
    '<div data-testid="drawer" v-if="visible" :aria-label="ariaLabel"><h2>{{ header }}</h2><slot /></div>',
});

describe('Aurora UI wrapper layer', () => {
  it('AppButton renders an accessible button and emits click', async () => {
    const onClick = vi.fn();
    render(AppButton, { props: { onClick }, slots: { default: '重试' } });
    const button = screen.getByRole('button', { name: '重试' });
    await fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('AppButton disabled blocks click', async () => {
    const onClick = vi.fn();
    render(AppButton, {
      props: { disabled: true, onClick },
      slots: { default: '保存' },
    });
    await fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('AppLink renders a real anchor and marks active state', () => {
    render(AppLink, {
      props: { to: '/workspace', label: '工作空间', active: true },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    const link = screen.getByRole('link', { name: '工作空间' });
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('AppStatusBadge is a status with text, not color-only', () => {
    render(AppStatusBadge, {
      props: { tone: 'danger' },
      slots: { default: '异常' },
    });
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('异常');
  });

  it('AppPageHeader renders the focusable page title', () => {
    render(AppPageHeader, { props: { title: '项目概览' } });
    const heading = screen.getByRole('heading', { name: '项目概览', level: 1 });
    expect(heading.id).toBe('page-title');
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('AppDrawer renders content only while open', async () => {
    const { rerender } = render(AppDrawer, {
      props: { open: true, title: '导航' },
      slots: { default: '侧栏内容' },
      global: { stubs: { Drawer: DrawerStub } },
    });
    expect(screen.getByTestId('drawer')).toBeTruthy();
    expect(screen.getByText('侧栏内容')).toBeTruthy();
    await rerender({ open: false });
    expect(screen.queryByTestId('drawer')).toBeNull();
  });
});
```

Note: `AppButton`'s prop `onClick` is passed as an event listener; the component must forward a `click` event (see the `defineEmits` below) for the test to observe it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/console test`
Expected: FAIL — the Aurora components do not exist (module not found).

- [ ] **Step 3: Write minimal implementation**

`apps/console/src/components/aurora/AppButton.vue`:

```vue
<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger';
    disabled?: boolean;
    type?: 'button' | 'submit';
  }>(),
  { variant: 'primary', disabled: false, type: 'button' },
);

const emit = defineEmits<{ (e: 'click', event: MouseEvent): void }>();
</script>

<template>
  <button
    :class="['au-button', `au-button--${variant}`]"
    :disabled="disabled"
    :type="type"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.au-button {
  height: var(--control-height);
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-base);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  background-image: none;
}
.au-button:disabled {
  cursor: not-allowed;
}
.au-button--primary {
  background-color: var(--color-action-primary);
  color: #ffffff;
}
.au-button--secondary {
  background-color: var(--color-surface-bg);
  border-color: var(--color-border-default);
  color: var(--color-text-primary);
}
.au-button--danger {
  background-color: var(--color-status-danger);
  color: #ffffff;
}
</style>
```

`apps/console/src/components/aurora/AppLink.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    to: string;
    label?: string;
    active?: boolean;
  }>(),
  { label: undefined, active: false },
);

const classes = computed(() => ['au-link', { 'au-link--active': props.active }]);
</script>

<template>
  <RouterLink :to="to" :class="classes" :aria-current="active ? 'page' : undefined">
    <slot>{{ label }}</slot>
  </RouterLink>
</template>

<style scoped>
.au-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-height);
  padding: 0 var(--space-2);
  border-radius: var(--radius-base);
  color: var(--color-action-primary);
  text-decoration: none;
  background-image: none;
}
.au-link--active {
  background-color: var(--color-sidebar-active-bg);
  color: var(--color-sidebar-active-fg);
  border-left: 3px solid var(--color-sidebar-active-indicator);
}
</style>
```

`apps/console/src/components/aurora/AppStatusBadge.vue`:

```vue
<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'success' | 'danger' | 'warning';
  }>(),
  { tone: 'neutral' },
);
</script>

<template>
  <span :class="['au-badge', `au-badge--${tone}`]" role="status">
    <slot />
  </span>
</template>

<style scoped>
.au-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 24px;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-image: none;
  color: var(--color-text-primary);
}
.au-badge--success {
  border-color: var(--color-status-success);
  color: var(--color-status-success);
}
.au-badge--danger {
  border-color: var(--color-status-danger);
  color: var(--color-status-danger);
}
.au-badge--warning {
  border-color: var(--color-sidebar-bg);
  color: var(--color-sidebar-fg);
}
</style>
```

`apps/console/src/components/aurora/AppPageHeader.vue`:

```vue
<script setup lang="ts">
defineProps<{ title: string; testId?: string }>();
</script>

<template>
  <header class="au-page-header">
    <h1 :id="testId ?? 'page-title'" tabindex="-1" class="au-page-title">{{ title }}</h1>
    <slot name="meta" />
  </header>
</template>

<style scoped>
.au-page-header {
  margin-bottom: var(--space-5);
}
.au-page-title {
  margin: 0;
  font-size: 20px;
  line-height: var(--nav-height);
  color: var(--color-text-primary);
}
</style>
```

`apps/console/src/components/aurora/AppDrawer.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import Drawer from 'primevue/drawer';

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const visible = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value) emit('close');
  },
});
</script>

<template>
  <Drawer
    v-model:visible="visible"
    :header="title"
    position="left"
    class="au-drawer"
    :aria-label="title"
  >
    <slot />
  </Drawer>
</template>
```

Note: PrimeVue's `Drawer` component name is the documented one for PrimeVue 5; if the installed package exposes the same component under a renamed path, adjust the single import above in this file and record the change in `apps/console/README.md` during Task 1's compat verification.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aurora/console test`
Expected: PASS (button/link/badge/header/drawer wrapper behaviors).

- [ ] **Step 5: Run typecheck and boundaries**

Run: `pnpm --filter @aurora/console typecheck && pnpm check:boundaries`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/aurora apps/console/test/components/aurora.test.ts
git commit -m "feat: add Aurora UI wrapper primitives for the shell"
```

---

### Task 4: API client + request/cache layer (generated-client consumption, dedup, cancellation, stale discard, RFC 9457 normalization, scope-keyed cache)

**Files:**
- Create: `apps/console/src/api/scope.ts`
- Create: `apps/console/src/api/query-key.ts`
- Create: `apps/console/src/api/errors.ts`
- Create: `apps/console/src/api/client.ts`
- Create: `apps/console/src/api/cache.ts`
- Create: `apps/console/src/api/query.ts`
- Create: `apps/console/src/mocks/handlers.ts` (MSW handler builder — from contract-testkit samples only)
- Create: `apps/console/test/msw/server.ts`
- Create: `apps/console/test/api/api.test.ts`

**Interfaces:**
- Consumes: `@aurora/platform-contract/client` (`buildRequest`, `parseResponse`, `ClientInputError`, `PLATFORM_OPERATIONS`), `@aurora/platform-contract` root (`auroraProblem`), `@aurora/platform-contract/contract-testkit` (`validSessionSamples`, `validNavigationSamples`).
- Produces:
  - `ScopeKey` (`{ type: 'public' } | { type: 'account' } | { type: 'workspace' } | { type: 'organization'; id: string } | { type: 'project'; id: string }`) and `scopeKeyString(scope: ScopeKey): string`.
  - `queryKey(scope: ScopeKey, operationId: string, params?: Readonly<Record<string, unknown>>): string`.
  - `ProblemCode` union + `ApiError` (`code`, `status: number | null`, `requestId?`, `retryAfter?`) + `normalizeProblem(raw: unknown, status: number): ApiError`.
  - `platformRequest<T>(operationId, input, options: { scope: ScopeKey; signal?: AbortSignal }): Promise<T>` — the only fetch call in the app; throws `ApiError` or rethrows `AbortError`.
  - `RequestCache` (`get`/`set`/`invalidateScope`/`invalidateKey`/`clear`) + `requestCache` singleton.
  - `executeQuery<T>(opts: { operationId; input?; scope; signal?; retry? }): Promise<T>`, `invalidateScope(scope)`, `invalidateQueryKey(key)` — dedup, cancellation, stale-generation discard, bounded single retry for idempotent reads on `network_error`/503, cache write under matching generation.
  - `createPlatformHandlers()` (MSW handlers for `identityGetSession`, `navigationGetContext`, and a test-only `POST /__mock/scope` control), `setMockScope(scope)`, `handlerControls = { delayMs, sessionRequests }` (test-only).
  - `test/msw/server.ts` exporting `mockServer` (msw/node `setupServer`).

- [ ] **Step 1: Write the failing test**

`apps/console/test/api/api.test.ts`:

```ts
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  validProblemSamples,
  validSessionSamples,
} from '@aurora/platform-contract/contract-testkit';
import { requestCache } from '../src/api/cache.js';
import { invalidateScope, executeQuery } from '../src/api/query.js';
import type { ScopeKey } from '../src/api/scope.js';
import { handlerControls } from '../src/mocks/handlers.js';
import { mockServer } from '../msw/server.js';

const workspace: ScopeKey = { type: 'workspace' };
const project: ScopeKey = { type: 'project', id: 'prj_test_1' };
const SESSION_KEY = 'workspace:identityGetSession';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  requestCache.clear();
  handlerControls.delayMs = 0;
  handlerControls.sessionRequests = 0;
});
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

describe('request/cache layer', () => {
  it('fetches a session through the generated client', async () => {
    const data = await executeQuery({
      operationId: 'identityGetSession',
      scope: workspace,
      input: {},
    });
    expect(data).toEqual(validSessionSamples[0]);
    expect(requestCache.get(SESSION_KEY)).toBeDefined();
  });

  it('deduplicates concurrent identical queries into one network call', async () => {
    const [a, b] = await Promise.all([
      executeQuery({ operationId: 'identityGetSession', scope: workspace, input: {} }),
      executeQuery({ operationId: 'identityGetSession', scope: workspace, input: {} }),
    ]);
    expect(a).toEqual(b);
    expect(handlerControls.sessionRequests).toBe(1);
  });

  it('cancels an in-flight request via AbortSignal', async () => {
    handlerControls.delayMs = 50;
    const controller = new AbortController();
    const promise = executeQuery({
      operationId: 'identityGetSession',
      scope: workspace,
      input: {},
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('discards a stale response after scope invalidation', async () => {
    handlerControls.delayMs = 50;
    const promise = executeQuery({
      operationId: 'identityGetSession',
      scope: workspace,
      input: {},
    });
    invalidateScope(workspace);
    await promise;
    expect(requestCache.get(SESSION_KEY)).toBeUndefined();
  });

  it('retries a retryable read once after a network error', async () => {
    let calls = 0;
    mockServer.use(
      http.get('/api/platform/v1/session', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.error();
        return HttpResponse.json(validSessionSamples[0], { status: 200 });
      }),
    );
    const data = await executeQuery({
      operationId: 'identityGetSession',
      scope: workspace,
      input: {},
    });
    expect(calls).toBe(2);
    expect(data).toBeDefined();
  });

  it('normalizes an RFC 9457 problem from the contract testkit', async () => {
    mockServer.use(
      http.get('/api/platform/v1/session', () =>
        HttpResponse.json(validProblemSamples[0], { status: 404 }),
      ),
    );
    await expect(
      executeQuery({ operationId: 'identityGetSession', scope: workspace, input: {} }),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('invalidates only the matching scope', async () => {
    await executeQuery({ operationId: 'identityGetSession', scope: workspace, input: {} });
    await executeQuery({ operationId: 'identityGetSession', scope: project, input: {} });
    invalidateScope(workspace);
    expect(requestCache.get(SESSION_KEY)).toBeUndefined();
    expect(requestCache.get('project:prj_test_1:identityGetSession')).toBeDefined();
  });
});
```

`apps/console/test/msw/server.ts`:

```ts
import { setupServer } from 'msw/node';
import { createPlatformHandlers } from '../../src/mocks/handlers';

export const mockServer = setupServer(...createPlatformHandlers());
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/console test`
Expected: FAIL — `src/api/*`, `src/mocks/handlers.ts`, `test/msw/server.ts` do not exist (module not found).

- [ ] **Step 3: Write minimal implementation**

`apps/console/src/api/scope.ts`:

```ts
export type ScopeKey =
  | { readonly type: 'public' }
  | { readonly type: 'account' }
  | { readonly type: 'workspace' }
  | { readonly type: 'organization'; readonly id: string }
  | { readonly type: 'project'; readonly id: string };

export function scopeKeyString(scope: ScopeKey): string {
  switch (scope.type) {
    case 'organization':
      return `organization:${scope.id}`;
    case 'project':
      return `project:${scope.id}`;
    default:
      return scope.type;
  }
}
```

`apps/console/src/api/query-key.ts`:

```ts
import type { ScopeKey } from './scope.js';
import { scopeKeyString } from './scope.js';

export function queryKey(
  scope: ScopeKey,
  operationId: string,
  params: Readonly<Record<string, unknown>> = {},
): string {
  const suffix = Object.keys(params).length === 0 ? '' : `:${JSON.stringify(params)}`;
  return `${scopeKeyString(scope)}:${operationId}${suffix}`;
}
```

`apps/console/src/api/errors.ts`:

```ts
import { auroraProblem } from '@aurora/platform-contract';

export type ProblemCode =
  | 'structural_error'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'field_validation'
  | 'business_validation'
  | 'idempotency_conflict'
  | 'version_conflict'
  | 'state_machine_conflict'
  | 'rate_limited'
  | 'processing'
  | 'downstream_partial_failure'
  | 'authority_unavailable'
  | 'network_error';

export class ApiError extends Error {
  readonly code: ProblemCode;
  readonly status: number | null;
  readonly requestId?: string;
  readonly retryAfter?: number;

  constructor(options: {
    code: ProblemCode;
    message: string;
    status?: number | null;
    requestId?: string;
    retryAfter?: number;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status ?? null;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.retryAfter !== undefined) this.retryAfter = options.retryAfter;
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'structural_error',
  'authentication',
  'authorization',
  'not_found',
  'field_validation',
  'business_validation',
  'idempotency_conflict',
  'version_conflict',
  'state_machine_conflict',
  'rate_limited',
  'processing',
  'downstream_partial_failure',
  'authority_unavailable',
]);

export function normalizeProblem(raw: unknown, status: number): ApiError {
  const parsed = auroraProblem.zod.safeParse(raw);
  if (!parsed.success || !KNOWN_CODES.has(parsed.data.code)) {
    return new ApiError({
      code: 'structural_error',
      status,
      message: 'Response does not match the public contract.',
    });
  }
  const problem = parsed.data;
  return new ApiError({
    code: problem.code as ProblemCode,
    status: problem.status,
    message: problem.title,
    requestId: problem.requestId,
    retryAfter: problem.retryAfter,
  });
}
```

`apps/console/src/api/client.ts`:

```ts
import {
  buildRequest,
  ClientInputError,
  parseResponse,
  PLATFORM_OPERATIONS,
} from '@aurora/platform-contract/client';
import type { ScopeKey } from './scope.js';
import { ApiError, normalizeProblem } from './errors.js';

export interface RequestOptions {
  scope: ScopeKey;
  signal?: AbortSignal;
}

const operationById = new Map(PLATFORM_OPERATIONS.map((op) => [op.operationId, op]));

export async function platformRequest<T>(
  operationId: string,
  input: { query?: unknown; body?: unknown },
  options: RequestOptions,
): Promise<T> {
  const op = operationById.get(operationId);
  if (op === undefined) {
    throw new ApiError({ code: 'structural_error', message: `Unknown operation ${operationId}` });
  }
  let request;
  try {
    request = buildRequest(op, input);
  } catch (error) {
    if (error instanceof ClientInputError) {
      throw new ApiError({ code: 'structural_error', message: error.message });
    }
    throw error;
  }
  const url = new URL(request.path, window.location.origin);
  if (request.query !== undefined) {
    for (const [key, value] of Object.entries(
      request.query as Readonly<Record<string, unknown>>,
    )) {
      url.searchParams.set(key, String(value));
    }
  }
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: request.method,
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({ code: 'network_error', message: 'Network request failed.' });
  }
  const raw: unknown = await response.json().catch(() => null);
  const result = parseResponse(op, raw, response.status);
  if (!result.ok) throw normalizeProblem(result.problem, response.status);
  return result.data as T;
}
```

Note: `window.location.origin` is used only to build an absolute URL for `fetch`; the browser still only calls the public `platform-api` paths declared by the generated client (`/api/platform/v1/...`). There is no other `fetch` in the app source.

`apps/console/src/api/cache.ts`:

```ts
import type { ScopeKey } from './scope.js';
import { scopeKeyString } from './scope.js';

export interface CachedValue<T> {
  readonly data: T;
  readonly readAt: string;
  readonly scope: ScopeKey;
}

export class RequestCache {
  private readonly store = new Map<string, CachedValue<unknown>>();

  get<T>(key: string): CachedValue<T> | undefined {
    return this.store.get(key) as CachedValue<T> | undefined;
  }

  set<T>(key: string, data: T, scope: ScopeKey): void {
    this.store.set(key, { data, readAt: new Date().toISOString(), scope });
  }

  invalidateScope(scope: ScopeKey): void {
    const prefix = `${scopeKeyString(scope)}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  invalidateKey(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const requestCache = new RequestCache();
```

`apps/console/src/api/query.ts`:

```ts
import { PLATFORM_OPERATIONS } from '@aurora/platform-contract/client';
import type { ScopeKey } from './scope.js';
import { scopeKeyString } from './scope.js';
import { queryKey } from './query-key.js';
import { platformRequest } from './client.js';
import { requestCache } from './cache.js';
import { ApiError } from './errors.js';

export interface ExecuteQueryOptions {
  operationId: string;
  input?: { query?: unknown; body?: unknown };
  scope: ScopeKey;
  signal?: AbortSignal;
  retry?: boolean;
}

const inFlight = new Map<string, Promise<unknown>>();
const generationByKey = new Map<string, number>();

function currentGeneration(key: string): number {
  return generationByKey.get(key) ?? 0;
}

export function invalidateQueryKey(key: string): void {
  requestCache.invalidateKey(key);
  generationByKey.set(key, currentGeneration(key) + 1);
}

export function invalidateScope(scope: ScopeKey): void {
  requestCache.invalidateScope(scope);
  const prefix = `${scopeKeyString(scope)}:`;
  for (const key of generationByKey.keys()) {
    if (key.startsWith(prefix)) generationByKey.set(key, currentGeneration(key) + 1);
  }
}

export async function executeQuery<T>(options: ExecuteQueryOptions): Promise<T> {
  const input = options.input ?? {};
  const key = queryKey(
    options.scope,
    options.operationId,
    (input.query ?? {}) as Readonly<Record<string, unknown>>,
  );
  const cached = requestCache.get<T>(key);
  if (cached !== undefined) return cached.data;

  const existing = inFlight.get(key);
  if (existing !== undefined) return existing as Promise<T>;

  const generation = currentGeneration(key);
  const promise = performRequest(key, generation, options, input);
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  }
}

async function performRequest<T>(
  key: string,
  generation: number,
  options: ExecuteQueryOptions,
  input: { query?: unknown; body?: unknown },
): Promise<T> {
  try {
    const data = await platformRequest<T>(options.operationId, input, {
      scope: options.scope,
      signal: options.signal,
    });
    if (generation === currentGeneration(key)) requestCache.set(key, data, options.scope);
    return data;
  } catch (error) {
    if (
      error instanceof ApiError &&
      options.retry !== false &&
      isRetryableRead(options.operationId, error)
    ) {
      const data = await platformRequest<T>(options.operationId, input, {
        scope: options.scope,
        signal: options.signal,
      });
      if (generation === currentGeneration(key)) requestCache.set(key, data, options.scope);
      return data;
    }
    throw error;
  }
}

function isRetryableRead(operationId: string, error: ApiError): boolean {
  const op = PLATFORM_OPERATIONS.find((candidate) => candidate.operationId === operationId);
  if (op?.method !== 'GET') return false;
  if (error.code === 'network_error') return true;
  return error.status === 503;
}
```

`apps/console/src/mocks/handlers.ts` (test-only; imported only from `test/` and from the `--mode test` entry):

```ts
import { http, HttpResponse } from 'msw';
import {
  validNavigationSamples,
  validSessionSamples,
} from '@aurora/platform-contract/contract-testkit';

export type MockScope = { readonly type: 'workspace' | 'organization' | 'project'; readonly id?: string };

let mockScope: MockScope = { type: 'project', id: 'prj_test_1' };

const navigationBody = JSON.parse(JSON.stringify(validNavigationSamples[0])) as {
  currentScope: unknown;
};

export const handlerControls = {
  delayMs: 0,
  sessionRequests: 0,
};

export function setMockScope(scope: MockScope): void {
  mockScope = scope;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPlatformHandlers() {
  return [
    http.get('/api/platform/v1/session', async () => {
      handlerControls.sessionRequests += 1;
      if (handlerControls.delayMs > 0) await delay(handlerControls.delayMs);
      return HttpResponse.json(validSessionSamples[0], { status: 200 });
    }),
    http.get('/api/platform/v1/navigation/context', () => {
      const body = structuredClone(navigationBody);
      body.currentScope =
        mockScope.type === 'workspace'
          ? { type: 'workspace', lifecycle: 'active' }
          : { type: mockScope.type, id: mockScope.id, lifecycle: 'active' };
      return HttpResponse.json(body, { status: 200 });
    }),
    http.post('/__mock/scope', async ({ request }) => {
      const body = (await request.json()) as MockScope;
      mockScope = { type: body.type, id: body.id };
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
```

Notes: response bodies come **only** from `contract-testkit` valid samples (no hand-written data). `POST /__mock/scope` is a test-only control (sets the current scope served by the mock navigation handler) and exists only inside the MSW test build; it is not part of the real contract and never ships in production.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aurora/console test`
Expected: PASS (dedup = one network call, cancel → AbortError, stale discard, single retry on network error, RFC 9457 normalization from the contract testkit problem sample, scope-scoped invalidation).

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @aurora/console typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/api apps/console/src/mocks/handlers.ts apps/console/test/api apps/console/test/msw/server.ts
git commit -m "feat: add generated-client request layer with dedup/cancel/stale/scope cache"
```

---

### Task 5: Session Context consumer (identityGetSession via generated client; safe unauthenticated/unavailable; no fake session)

**Files:**
- Create: `apps/console/src/stores/index.ts`
- Create: `apps/console/src/stores/session.ts`
- Create: `apps/console/src/mocks/entry.ts` (browser MSW worker, test builds only)
- Create: `apps/console/test/stores/session.test.ts`
- Modify: `apps/console/src/main.ts` (install pinia; enable MSW only when `import.meta.env.MODE === 'test'`)
- Modify: `apps/console/package.json` (msw `workerDirectory` entry after `msw init`)

**Interfaces:**
- Consumes: `executeQuery`/`invalidateScope` (Task 4), `OPERATION_ID_SESSION` from `@aurora/platform-contract`, `createPlatformHandlers` (Task 4), pinia.
- Produces:
  - `src/stores/index.ts`: `export const pinia = createPinia();`
  - `SessionStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable'`; `AccountSummary` (`{ accountId: string; email: string; verified: boolean }`); `mapSessionError(error: ApiError): SessionStatus`; `useSessionStore` with `status`/`account`/`expiresAt`/`csrf`/`error` state and `restore(): Promise<void>` / `reset(): void`.
  - `src/mocks/entry.ts`: `setupMockServer()` that starts the MSW browser worker on `mockServiceWorker.js` with `onUnhandledRequest: 'bypass'`.
  - `apps/console/public/mockServiceWorker.js` generated by `msw init public`.

- [ ] **Step 1: Write the failing test**

`apps/console/test/stores/session.test.ts`:

```ts
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { validProblemSamples } from '@aurora/platform-contract/contract-testkit';
import { ApiError } from '../../src/api/errors.js';
import { handlerControls } from '../../src/mocks/handlers.js';
import { invalidateScope } from '../../src/api/query.js';
import { mapSessionError, useSessionStore } from '../../src/stores/session.js';
import { mockServer } from '../msw/server.js';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setActivePinia(createPinia());
  mockServer.resetHandlers();
  handlerControls.sessionRequests = 0;
});
afterEach(() => invalidateScope({ type: 'account' }));
afterAll(() => mockServer.close());



describe('Session Context consumer', () => {
  it('enters authenticated with the contract-projected account (no fabricated data)', async () => {
    const store = useSessionStore();
    await store.restore();
    expect(store.status).toBe('authenticated');
    expect(store.account?.accountId).toBe('acct_test_1');
    expect(store.account?.email).toBe('user@example.invalid');
  });

  it('enters unavailable on a network failure and never fabricates authenticated', async () => {
    mockServer.use(http.get('/api/platform/v1/session', () => HttpResponse.error()));
    const store = useSessionStore();
    await store.restore();
    expect(store.status).toBe('unavailable');
    expect(store.account).toBeNull();
  });

  it('enters unavailable on a contract 404 problem (safe non-committal state)', async () => {
    mockServer.use(
      http.get('/api/platform/v1/session', () =>
        HttpResponse.json(validProblemSamples[0], { status: 404 }),
      ),
    );
    const store = useSessionStore();
    await store.restore();
    expect(store.status).toBe('unavailable');
    expect(store.account).toBeNull();
  });

  it('maps an authentication problem to unauthenticated', () => {
    expect(
      mapSessionError(new ApiError({ code: 'authentication', message: 'No session' })),
    ).toBe('unauthenticated');
    expect(
      mapSessionError(new ApiError({ code: 'authority_unavailable', message: 'x' })),
    ).toBe('unavailable');
    expect(mapSessionError(new ApiError({ code: 'network_error', message: 'x' }))).toBe(
      'unavailable',
    );
  });

  it('reset clears session memory and invalidates the cached session', async () => {
    const store = useSessionStore();
    await store.restore();
    expect(handlerControls.sessionRequests).toBe(1);
    store.reset();
    expect(store.status).toBe('idle');
    expect(store.account).toBeNull();
    await store.restore();
    expect(handlerControls.sessionRequests).toBe(2);
  });
});
```

Note: the store's `reset()` must invalidate the account-scope cache so a later `restore()` refetches (asserted by `sessionRequests` increasing). The unauthenticated branch is covered by the pure `mapSessionError` unit test because the contract-testkit ships no 401 sample and MSW handlers must not fabricate response bodies.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/console test`
Expected: FAIL — `src/stores/session.ts`, `src/stores/index.ts`, `src/mocks/entry.ts` do not exist.

- [ ] **Step 3: Write minimal implementation**

`apps/console/src/stores/index.ts`:

```ts
import { createPinia } from 'pinia';

export const pinia = createPinia();
```

`apps/console/src/stores/session.ts`:

```ts
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { OPERATION_ID_SESSION } from '@aurora/platform-contract';
import { ApiError } from '../api/errors.js';
import { invalidateScope, executeQuery } from '../api/query.js';

export type SessionStatus =
  | 'idle'
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'unavailable';

export interface AccountSummary {
  accountId: string;
  email: string;
  verified: boolean;
}

interface SessionResponse {
  account: AccountSummary;
  authentication: 'pending_verification' | 'authenticated' | 'restricted';
  session: { expiresAt: string };
  csrf: string;
  navigation: readonly unknown[];
}

export function mapSessionError(error: ApiError): SessionStatus {
  if (error.code === 'authentication') return 'unauthenticated';
  return 'unavailable';
}

export const useSessionStore = defineStore('session', () => {
  const status = ref<SessionStatus>('idle');
  const account = ref<AccountSummary | null>(null);
  const expiresAt = ref<string | null>(null);
  const csrf = ref<string | null>(null);
  const error = ref<string | null>(null);

  async function restore(): Promise<void> {
    if (status.value === 'loading' || status.value === 'authenticated') return;
    status.value = 'loading';
    error.value = null;
    try {
      const data = (await executeQuery({
        operationId: OPERATION_ID_SESSION,
        scope: { type: 'account' },
        input: {},
      })) as SessionResponse;
      account.value = data.account;
      expiresAt.value = data.session.expiresAt;
      csrf.value = data.csrf;
      status.value = 'authenticated';
    } catch (caught) {
      if (caught instanceof ApiError) {
        status.value = mapSessionError(caught);
        error.value = caught.code;
      } else {
        status.value = 'unavailable';
        error.value = 'network_error';
      }
    }
  }

  function reset(): void {
    invalidateScope({ type: 'account' });
    status.value = 'idle';
    account.value = null;
    expiresAt.value = null;
    csrf.value = null;
    error.value = null;
  }

  return { status, account, expiresAt, csrf, error, restore, reset };
});
```

`apps/console/src/mocks/entry.ts` (test builds only — the `--mode test` build calls this; production never imports it):

```ts
import { setupWorker } from 'msw/browser';
import { createPlatformHandlers } from './handlers';

export async function setupMockServer(): Promise<void> {
  const worker = setupWorker(...createPlatformHandlers());
  await worker.start({
    serviceWorker: { url: '/mockServiceWorker.js' },
    onUnhandledRequest: 'bypass',
  });
}
```

`apps/console/src/main.ts` (replaces the Task 1 minimal version):

```ts
import { createApp } from 'vue';
import App from './App.vue';
import { pinia } from './stores';
import './styles/tokens.css';
import './styles/base.css';

async function bootstrap(): Promise<void> {
  if (import.meta.env.MODE === 'test') {
    const { setupMockServer } = await import('./mocks/entry');
    await setupMockServer();
  }
  const app = createApp(App);
  app.use(pinia);
  app.mount('#app');
}

void bootstrap();
```

`import.meta.env.MODE === 'test'` is statically replaced by Vite (`"production"` in the default build), so the `await import('./mocks/entry')` chunk is dead-code-eliminated from the production bundle. Task 11 asserts this (no MSW / `contract-testkit` in `dist`).

- [ ] **Step 4: Generate the MSW worker script and register the worker directory**

Run (from `apps/console`):
```bash
pnpm --filter @aurora/console exec msw init public --save
```
Expected: `apps/console/public/mockServiceWorker.js` is created and `apps/console/package.json` gains:
```json
"msw": {
  "workerDirectory": [
    "public"
  ]
}
```
Commit `apps/console/public/mockServiceWorker.js` (it is the MSW-generated worker; regenerate with the same command if MSW is upgraded).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @aurora/console test`
Expected: PASS (authenticated from the contract sample, unavailable on network failure and on the contract 404 problem, `mapSessionError` maps authentication → unauthenticated, reset invalidates the cached session and refetches).

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @aurora/console typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/stores apps/console/src/mocks/entry.ts apps/console/src/main.ts apps/console/public apps/console/test/stores/session.test.ts apps/console/package.json
git commit -m "feat: add Session Context consumer and MSW test-mode entry"
```

---

### Task 6: Navigation Context consumer + RouteTarget mapping + route registry (36 ids verbatim) + status view primitives

**Files:**
- Create: `apps/console/src/contracts/route-types.ts`
- Create: `apps/console/src/contracts/route-registry.ts`
- Create: `apps/console/src/contracts/sidebar-entries.ts`
- Create: `apps/console/src/stores/navigation.ts`
- Create: `apps/console/src/components/pages/UnavailableView.vue`
- Create: `apps/console/src/components/pages/NotFoundView.vue`
- Create: `apps/console/src/components/pages/WorkspaceHomeView.vue`
- Create: `apps/console/test/contracts/route-registry.test.ts`
- Create: `apps/console/test/stores/navigation.test.ts`

**Interfaces:**
- Consumes: `ROUTE_TARGET_IDS`/`RouteTargetId` from `@aurora/platform-contract`, `OPERATION_ID_NAVIGATION`, `executeQuery`/`invalidateScope` (Task 4), `validNavigationSamples` via MSW handlers (Task 4), AppLink/AppPageHeader/AppStatusBadge (Task 3), zod.
- Produces:
  - `route-types.ts`: `RouteScope`, `UnavailableReason`, `RouteEntry` (`{ routeId, path, scope, label, parent?, paramsSchema, querySchema, lazy, menu, unavailableReason }`), `ResolveResult`.
  - `route-registry.ts`: `ROUTE_REGISTRY: readonly RouteEntry[]` (all 36, ids verbatim), `ROUTE_BY_ID: ReadonlyMap<RouteTargetId, RouteEntry>`, `resolveRouteTarget(target): ResolveResult`.
  - `sidebar-entries.ts`: `ORG_SIDEBAR_ENTRIES` (B3–B8) and `PROJECT_SIDEBAR_ENTRIES` (C1/C2/C3/C5–C8/C10/C13–C15) — the approved first-level menus (spec §12.1, §13.5).
  - `UnavailableView.vue` (`title`, `reason: UnavailableReason`, `detail?`), `NotFoundView.vue` (`title?`), `WorkspaceHomeView.vue` (real workspace page: org list from the nav store, or an unavailable state).
  - `useNavigationStore` with `status` (`'idle' | 'loading' | 'ready' | 'unavailable'`), `workspaceTargets`, `organizations`, `currentScope`, `defaultTarget`, `safeExitTarget`, getter `currentOrganizationId`, actions `load()` / `clear()`.

- [ ] **Step 1: Write the failing tests**

`apps/console/test/contracts/route-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ROUTE_TARGET_IDS, type RouteTargetId } from '@aurora/platform-contract';
import {
  ORG_SIDEBAR_ENTRIES,
  PROJECT_SIDEBAR_ENTRIES,
} from '../../src/contracts/sidebar-entries.js';
import { ROUTE_BY_ID, ROUTE_REGISTRY, resolveRouteTarget } from '../../src/contracts/route-registry.js';

describe('RouteTarget registry', () => {
  it('declares exactly the 36 frozen route targets', () => {
    expect(ROUTE_REGISTRY.map((entry) => entry.routeId).sort()).toEqual(
      [...ROUTE_TARGET_IDS].sort(),
    );
  });

  it('gives every entry a path template, scope, label and lazy loader', () => {
    for (const entry of ROUTE_REGISTRY) {
      expect(entry.path).toMatch(/^\//);
      expect(
        ['public', 'account', 'workspace', 'organization', 'project', 'platform'],
      ).toContain(entry.scope);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.lazy).toBe('function');
    }
  });

  it('resolves a project target with params and query', () => {
    const result = resolveRouteTarget({
      routeId: 'project.overview',
      pathParams: { organizationId: 'org_test_1', projectId: 'prj_test_1' },
      query: {},
    });
    expect(result.path).toBe('/organizations/org_test_1/projects/prj_test_1/overview');
  });

  it('rejects invalid params and unknown targets safely', () => {
    expect(
      resolveRouteTarget({ routeId: 'project.overview', pathParams: {}, query: {} }).error,
    ).toBe('invalid-params');
    expect(
      resolveRouteTarget({ routeId: 'made.up' as RouteTargetId, pathParams: {}, query: {} }).error,
    ).toBe('unknown-target');
  });

  it('keeps the approved sidebar entry lists within the registry', () => {
    for (const routeId of [...ORG_SIDEBAR_ENTRIES, ...PROJECT_SIDEBAR_ENTRIES]) {
      expect(ROUTE_BY_ID.get(routeId)?.menu).toBe(true);
    }
  });

  it('marks every non-shell business target as unavailable (no fake content)', () => {
    for (const entry of ROUTE_REGISTRY) {
      if (entry.routeId === 'workspace.home') continue;
      expect(entry.unavailableReason).not.toBeNull();
      expect(entry.unavailableReason).toMatch(
        /^(capability-not-provided|dependency-unavailable|permission-unavailable)$/,
      );
    }
  });

  it('keeps the frozen id list verbatim', () => {
    expect(ROUTE_REGISTRY.map((entry) => entry.routeId)).toEqual(ROUTE_TARGET_IDS);
  });
});
```

`apps/console/test/stores/navigation.test.ts`:

```ts
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setMockScope } from '../../src/mocks/handlers.js';
import { useNavigationStore } from '../../src/stores/navigation.js';
import { mockServer } from '../msw/server.js';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setActivePinia(createPinia());
  mockServer.resetHandlers();
  setMockScope({ type: 'project', id: 'prj_test_1' });
});
afterEach(() => setMockScope({ type: 'project', id: 'prj_test_1' }));
afterAll(() => mockServer.close());

describe('Navigation Context consumer', () => {
  it('loads the authorized navigation projection', async () => {
    const store = useNavigationStore();
    await store.load();
    expect(store.status).toBe('ready');
    expect(store.organizations[0]?.name).toBe('Acme');
    expect(store.currentScope?.type).toBe('project');
  });

  it('derives the current organization from the project scope', async () => {
    const store = useNavigationStore();
    await store.load();
    expect(store.currentOrganizationId).toBe('org_test_1');
  });

  it('supports an organization scope through the test control', async () => {
    setMockScope({ type: 'organization', id: 'org_test_1' });
    const store = useNavigationStore();
    await store.load();
    expect(store.currentScope?.type).toBe('organization');
    expect(store.currentOrganizationId).toBe('org_test_1');
  });

  it('enters a safe empty state when the context is unavailable', async () => {
    mockServer.use(
      http.get('/api/platform/v1/navigation/context', () => HttpResponse.error()),
    );
    const store = useNavigationStore();
    await store.load();
    expect(store.status).toBe('unavailable');
    expect(store.organizations).toHaveLength(0);
    expect(store.currentScope).toBeNull();
  });

  it('clear resets to the safe empty state', async () => {
    const store = useNavigationStore();
    await store.load();
    expect(store.status).toBe('ready');
    store.clear();
    expect(store.status).toBe('idle');
    expect(store.organizations).toHaveLength(0);
    expect(store.currentScope).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aurora/console test`
Expected: FAIL — `src/contracts/*`, `src/stores/navigation.ts`, the view components and tests do not exist.

- [ ] **Step 3: Write minimal implementation**

`apps/console/src/contracts/route-types.ts`:

```ts
import type { Component } from 'vue';
import type { z } from 'zod';
import type { RouteTargetId } from '@aurora/platform-contract';

export type RouteScope = 'public' | 'account' | 'workspace' | 'organization' | 'project' | 'platform';

export type UnavailableReason =
  | 'capability-not-provided'
  | 'dependency-unavailable'
  | 'permission-unavailable';

export interface RouteEntry {
  readonly routeId: RouteTargetId;
  readonly path: string;
  readonly scope: RouteScope;
  readonly label: string;
  readonly parent?: RouteTargetId;
  readonly paramsSchema: z.ZodType;
  readonly querySchema: z.ZodType;
  readonly lazy: () => Promise<Component>;
  readonly menu: boolean;
  readonly unavailableReason: UnavailableReason | null;
}

export type ResolveResult =
  | { readonly path: string; readonly error?: undefined }
  | { readonly path: undefined; readonly error: 'unknown-target' | 'invalid-params' };
```

`apps/console/src/contracts/sidebar-entries.ts` (approved first-level menus — spec §12.1 / §13.5; sub-routes C4/C9/C11/C12/C16 and B2 stay off the menu):

```ts
import type { RouteTargetId } from '@aurora/platform-contract';

export const ORG_SIDEBAR_ENTRIES: readonly RouteTargetId[] = [
  'organization.members',
  'organization.settings',
  'organization.usage',
  'organization.tokens',
  'organization.audit',
  'organization.trash',
];

export const PROJECT_SIDEBAR_ENTRIES: readonly RouteTargetId[] = [
  'project.onboarding',
  'project.overview',
  'project.issues',
  'project.requests',
  'project.performance',
  'project.data-status',
  'project.releases',
  'project.alerts',
  'project.access',
  'project.client-keys',
  'project.settings',
];
```

`apps/console/src/contracts/route-registry.ts` (all 36 ids verbatim from `packages/platform-contract/src/common/navigation.ts`):

```ts
import type { Component } from 'vue';
import { z } from 'zod';
import type { RouteTargetId } from '@aurora/platform-contract';
import type { ResolveResult, RouteEntry } from './route-types.js';

const emptyParams = z.object({});
const orgParams = z.object({ organizationId: z.string().min(1) });
const projectParams = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});
const issueParams = projectParams.extend({ issueId: z.string().min(1) });
const releaseParams = projectParams.extend({ releaseId: z.string().min(1) });
const sourceMapParams = projectParams.extend({ releaseId: z.string().min(1) });
const ruleParams = projectParams.extend({ ruleId: z.string().min(1) });
const instanceParams = projectParams.extend({ instanceId: z.string().min(1) });
const anyQuery = z.record(z.string(), z.string());

const unavailable = (): Promise<Component> => import('../components/pages/UnavailableView.vue');
const notFound = (): Promise<Component> => import('../components/pages/NotFoundView.vue');
const workspaceHome = (): Promise<Component> =>
  import('../components/pages/WorkspaceHomeView.vue');

export const ROUTE_REGISTRY: readonly RouteEntry[] = [
  {
    routeId: 'auth.register',
    path: '/register',
    scope: 'public',
    label: '注册',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'auth.verify-email',
    path: '/verify-email',
    scope: 'public',
    label: '邮箱验证',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'auth.verify-email-confirm',
    path: '/verify-email/confirm',
    scope: 'public',
    label: '确认邮箱验证',
    parent: 'auth.verify-email',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'auth.login',
    path: '/login',
    scope: 'public',
    label: '登录',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'auth.forgot-password',
    path: '/forgot-password',
    scope: 'public',
    label: '忘记密码',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'auth.reset-password',
    path: '/reset-password',
    scope: 'public',
    label: '重置密码',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'invitation.accept',
    path: '/invitations/accept',
    scope: 'public',
    label: '接受邀请',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'account.security',
    path: '/account/security',
    scope: 'account',
    label: '账号安全',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'workspace.home',
    path: '/workspace',
    scope: 'workspace',
    label: '工作空间',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: workspaceHome,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'organization.project-create',
    path: '/organizations/:organizationId/projects/new',
    scope: 'organization',
    label: '创建项目',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'organization.members',
    path: '/organizations/:organizationId/members',
    scope: 'organization',
    label: '成员',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'organization.settings',
    path: '/organizations/:organizationId/settings',
    scope: 'organization',
    label: '设置',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'organization.usage',
    path: '/organizations/:organizationId/usage',
    scope: 'organization',
    label: '用量',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'organization.tokens',
    path: '/organizations/:organizationId/tokens',
    scope: 'organization',
    label: '令牌',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'organization.audit',
    path: '/organizations/:organizationId/audit',
    scope: 'organization',
    label: '审计',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'organization.trash',
    path: '/organizations/:organizationId/trash',
    scope: 'organization',
    label: '回收站',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.onboarding',
    path: '/organizations/:organizationId/projects/:projectId/onboarding',
    scope: 'project',
    label: '接入',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.overview',
    path: '/organizations/:organizationId/projects/:projectId/overview',
    scope: 'project',
    label: '概览',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.issues',
    path: '/organizations/:organizationId/projects/:projectId/issues',
    scope: 'project',
    label: '问题',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.issue-detail',
    path: '/organizations/:organizationId/projects/:projectId/issues/:issueId',
    scope: 'project',
    label: '问题详情',
    parent: 'project.issues',
    paramsSchema: issueParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.requests',
    path: '/organizations/:organizationId/projects/:projectId/requests',
    scope: 'project',
    label: '请求',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.performance',
    path: '/organizations/:organizationId/projects/:projectId/performance',
    scope: 'project',
    label: '性能',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.data-status',
    path: '/organizations/:organizationId/projects/:projectId/data-status',
    scope: 'project',
    label: '数据状态',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.releases',
    path: '/organizations/:organizationId/projects/:projectId/releases',
    scope: 'project',
    label: '发布',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.release-detail',
    path: '/organizations/:organizationId/projects/:projectId/releases/:releaseId',
    scope: 'project',
    label: '发布详情',
    parent: 'project.releases',
    paramsSchema: releaseParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.source-maps',
    path: '/organizations/:organizationId/projects/:projectId/releases/:releaseId/source-maps',
    scope: 'project',
    label: 'Source Map',
    parent: 'project.release-detail',
    paramsSchema: sourceMapParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.alerts',
    path: '/organizations/:organizationId/projects/:projectId/alerts',
    scope: 'project',
    label: '告警',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.alert-rule-create',
    path: '/organizations/:organizationId/projects/:projectId/alerts/rules/new',
    scope: 'project',
    label: '新建告警规则',
    parent: 'project.alerts',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.alert-rule-edit',
    path: '/organizations/:organizationId/projects/:projectId/alerts/rules/:ruleId/edit',
    scope: 'project',
    label: '编辑告警规则',
    parent: 'project.alerts',
    paramsSchema: ruleParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.alert-instance-detail',
    path: '/organizations/:organizationId/projects/:projectId/alerts/instances/:instanceId',
    scope: 'project',
    label: '告警实例详情',
    parent: 'project.alerts',
    paramsSchema: instanceParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.access',
    path: '/organizations/:organizationId/projects/:projectId/access',
    scope: 'project',
    label: '访问',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.client-keys',
    path: '/organizations/:organizationId/projects/:projectId/client-keys',
    scope: 'project',
    label: '客户端密钥',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.settings',
    path: '/organizations/:organizationId/projects/:projectId/settings',
    scope: 'project',
    label: '设置',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'project.lifecycle',
    path: '/organizations/:organizationId/projects/:projectId/settings/lifecycle',
    scope: 'project',
    label: '生命周期',
    parent: 'project.settings',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'account.notifications',
    path: '/notifications',
    scope: 'account',
    label: '通知',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'platform.resource-policies',
    path: '/platform/resource-policies',
    scope: 'platform',
    label: '资源策略',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'permission-unavailable',
  },
];

export const ROUTE_BY_ID = new Map(ROUTE_REGISTRY.map((entry) => [entry.routeId, entry]));

export function resolveRouteTarget(target: {
  routeId: RouteTargetId;
  pathParams: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
}): ResolveResult {
  const entry = ROUTE_BY_ID.get(target.routeId);
  if (entry === undefined) return { path: undefined, error: 'unknown-target' };
  const paramsResult = entry.paramsSchema.safeParse(target.pathParams);
  if (!paramsResult.success) return { path: undefined, error: 'invalid-params' };
  const queryResult = entry.querySchema.safeParse(target.query);
  if (!queryResult.success) return { path: undefined, error: 'invalid-params' };
  let path = entry.path;
  for (const [key, value] of Object.entries(paramsResult.data)) {
    path = path.replace(`:${key}`, encodeURIComponent(value));
  }
  const queryString = new URLSearchParams(target.query).toString();
  return { path: queryString.length === 0 ? path : `${path}?${queryString}` };
}

`apps/console/src/components/pages/UnavailableView.vue`:

```vue
<script setup lang="ts">
import type { UnavailableReason } from '../../contracts/route-types';
import AppPageHeader from '../aurora/AppPageHeader.vue';
import AppStatusBadge from '../aurora/AppStatusBadge.vue';

withDefaults(
  defineProps<{
    title: string;
    reason: UnavailableReason;
    detail?: string;
  }>(),
  { detail: '' },
);

const reasonLabel: Readonly<Record<UnavailableReason, string>> = {
  'capability-not-provided': '功能未提供',
  'dependency-unavailable': '依赖不可用',
  'permission-unavailable': '权限不足',
};
</script>

<template>
  <section class="au-status au-surface" data-testid="unavailable-view">
    <AppPageHeader :title="title" />
    <AppStatusBadge tone="warning">{{ reasonLabel[reason] }}</AppStatusBadge>
    <p class="au-status-detail">
      {{ detail || '该能力尚未由后端提供；此处不会显示任何模拟数据。' }}
    </p>
  </section>
</template>

<style scoped>
.au-status-detail {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
</style>
```

`apps/console/src/components/pages/NotFoundView.vue`:

```vue
<script setup lang="ts">
withDefaults(defineProps<{ title?: string }>(), { title: '页面不存在' });
</script>

<template>
  <section class="au-status au-surface" data-testid="not-found-view">
    <h1 id="page-title" tabindex="-1" class="au-page-title">{{ title }}</h1>
    <p class="au-status-detail">请求的地址不存在或目标已失效。</p>
  </section>
</template>

<style scoped>
.au-page-title {
  margin: 0;
  font-size: 20px;
  line-height: var(--nav-height);
  color: var(--color-text-primary);
}
.au-status-detail {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
</style>
```

`apps/console/src/stores/navigation.ts`:

```ts
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { OPERATION_ID_NAVIGATION } from '@aurora/platform-contract';
import { ApiError } from '../api/errors.js';
import { invalidateScope, executeQuery } from '../api/query.js';

export type NavigationStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface RouteTargetRef {
  readonly routeId: string;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

export interface ProjectNav {
  readonly projectId: string;
  readonly name: string;
  readonly lifecycle: 'active' | 'archived';
  readonly entry: RouteTargetRef;
}

export interface OrganizationNav {
  readonly organizationId: string;
  readonly name: string;
  readonly projects: readonly ProjectNav[];
  readonly entry: RouteTargetRef;
}

export type ScopeState =
  | null
  | {
      readonly type: 'workspace' | 'organization' | 'project';
      readonly id?: string;
      readonly lifecycle: 'active' | 'archived' | 'trash';
    };

interface NavigationContextResponse {
  readonly account: { readonly accountId: string; readonly email: string; readonly verified: boolean };
  readonly workspace: readonly RouteTargetRef[];
  readonly organizations: readonly OrganizationNav[];
  readonly currentScope: ScopeState;
  readonly defaultTarget: RouteTargetRef;
  readonly safeExitTarget: RouteTargetRef;
}

export const useNavigationStore = defineStore('navigation', () => {
  const status = ref<NavigationStatus>('idle');
  const workspaceTargets = ref<readonly RouteTargetRef[]>([]);
  const organizations = ref<readonly OrganizationNav[]>([]);
  const currentScope = ref<ScopeState>(null);
  const defaultTarget = ref<RouteTargetRef | null>(null);
  const safeExitTarget = ref<RouteTargetRef | null>(null);

  const currentOrganizationId = computed<string | null>(() => {
    if (currentScope.value?.type === 'organization') return currentScope.value.id ?? null;
    if (currentScope.value?.type === 'project') {
      for (const org of organizations.value) {
        if (org.projects.some((project) => project.projectId === currentScope.value?.id)) {
          return org.organizationId;
        }
      }
    }
    return null;
  });

  async function load(): Promise<void> {
    if (status.value === 'loading' || status.value === 'ready') return;
    status.value = 'loading';
    try {
      const data = (await executeQuery({
        operationId: OPERATION_ID_NAVIGATION,
        scope: { type: 'workspace' },
        input: {},
      })) as NavigationContextResponse;
      workspaceTargets.value = data.workspace;
      organizations.value = data.organizations;
      currentScope.value = data.currentScope;
      defaultTarget.value = data.defaultTarget;
      safeExitTarget.value = data.safeExitTarget;
      status.value = 'ready';
    } catch (caught) {
      status.value = 'unavailable';
      workspaceTargets.value = [];
      organizations.value = [];
      currentScope.value = null;
      defaultTarget.value = null;
      safeExitTarget.value = null;
      if (caught instanceof ApiError) {
        // safe empty state; error code is intentionally not surfaced to the UI
      }
    }
  }

  function clear(): void {
    invalidateScope({ type: 'workspace' });
    invalidateScope({ type: 'organization' });
    invalidateScope({ type: 'project' });
    status.value = 'idle';
    workspaceTargets.value = [];
    organizations.value = [];
    currentScope.value = null;
    defaultTarget.value = null;
    safeExitTarget.value = null;
  }

  return {
    status,
    workspaceTargets,
    organizations,
    currentScope,
    defaultTarget,
    safeExitTarget,
    currentOrganizationId,
    load,
    clear,
  };
});
```

`apps/console/src/components/pages/WorkspaceHomeView.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../stores/navigation';
import { useSessionStore } from '../../stores/session';
import { resolveRouteTarget } from '../../contracts/route-registry';
import AppLink from '../aurora/AppLink.vue';
import AppPageHeader from '../aurora/AppPageHeader.vue';
import UnavailableView from './UnavailableView.vue';

const session = useSessionStore();
const navigation = useNavigationStore();
const { status: sessionStatus } = storeToRefs(session);
const { status: navStatus, organizations } = storeToRefs(navigation);

const ready = computed(
  () => sessionStatus.value === 'authenticated' && navStatus.value === 'ready',
);

function orgHref(organizationId: string, routeId: string): string {
  const result = resolveRouteTarget({
    routeId: routeId as never,
    pathParams: { organizationId },
    query: {},
  });
  return result.path ?? '/not-found';
}
</script>

<template>
  <UnavailableView
    v-if="!ready"
    title="工作空间不可用"
    reason="dependency-unavailable"
    detail="导航上下文尚未就绪；不会伪造组织或项目入口。"
  />
  <section v-else data-testid="workspace-home" class="au-surface">
    <AppPageHeader title="工作空间" />
    <p class="au-hint">选择组织或项目以进入对应作用域。</p>
    <ul class="au-org-list">
      <li v-for="org in organizations" :key="org.organizationId">
        <AppLink :to="orgHref(org.organizationId, org.entry.routeId)">
          {{ org.name }}
        </AppLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.au-hint {
  color: var(--color-text-secondary);
}
.au-org-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/console test`
Expected: PASS (registry 36-verbatim + resolve + sidebar integrity + no-fake-data; navigation store ready/unavailable/scope-derivation/clear).

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @aurora/console typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/contracts apps/console/src/stores/navigation.ts apps/console/src/components/pages apps/console/test/contracts apps/console/test/stores/navigation.test.ts
git commit -m "feat: add Navigation Context consumer and 36-RouteTarget registry"
```

---

### Task 7: App shell — top bar + layered sidebar + content outlet + scope-switch skeleton + global loading + stable title + focus management

**Files:**
- Create: `apps/console/src/router/routes.ts`
- Create: `apps/console/src/router/guards.ts`
- Create: `apps/console/src/router/focus.ts`
- Create: `apps/console/src/router/index.ts`
- Create: `apps/console/src/components/shell/AppShell.vue`
- Create: `apps/console/src/components/shell/TopBar.vue`
- Create: `apps/console/src/components/shell/LayeredSidebar.vue`
- Create: `apps/console/src/components/shell/ScopeSwitcher.vue`
- Create: `apps/console/src/components/shell/GlobalLoading.vue`
- Create: `apps/console/src/components/shell/ContentOutlet.vue`
- Create: `apps/console/test/router/router.test.ts`
- Create: `apps/console/test/components/shell.test.ts`
- Modify: `apps/console/src/App.vue` (root = `<RouterView />`)
- Modify: `apps/console/src/main.ts` (install router)

**Interfaces:**
- Consumes: `ROUTE_REGISTRY`/`resolveRouteTarget` (Task 6), `useSessionStore`/`useNavigationStore` (Tasks 5/6), AppLink/AppPageHeader (Task 3), pinia.
- Produces:
  - `router/routes.ts`: `appRoutes` — `/` → `AppShell` (layout) with children built from `ROUTE_REGISTRY` (name = `routeId`, component = `entry.lazy`, `meta.label`/`meta.scope`), a `root` child (WorkspaceHomeView) and a `not-found` catch-all `:pathMatch(.*)*`.
  - `router/guards.ts`: `installSessionGuard(router)` — nav-experience only: restores the session when idle; non-public targets redirect to `auth.login` (the authentication-unavailable entry) when session is `unauthenticated`/`unavailable`. Never authorizes.
  - `router/focus.ts`: `installFocusManagement(router)` — afterEach sets `document.title` and focuses `#page-title`.
  - `router/index.ts`: `export const router` (createRouter + createWebHistory) with both installers applied.
  - `AppShell.vue`: grid chrome (top bar / layered sidebar / content outlet) + `GlobalLoading` while the session is `loading`; restores the session and loads navigation when authenticated.
  - `TopBar.vue`: brand + workspace/notifications/account entries + `ScopeSwitcher`.
  - `LayeredSidebar.vue`: approved org (B3–B8) or project (C1/C2/C3/C5–C8/C10/C13–C15) menu from `currentScope`; empty when no scope (no fake entries).
  - `ScopeSwitcher.vue`: org/project select skeleton; on change calls `navigation.clear()` (scope-switch cleanup semantics; real org/project selection is G10/G11).
  - `GlobalLoading.vue`, `ContentOutlet.vue` (`<RouterView />`).

- [ ] **Step 1: Write the failing tests**

`apps/console/test/router/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ROUTE_TARGET_IDS } from '@aurora/platform-contract';
import { appRoutes } from '../../src/router/routes';

describe('console router', () => {
  it('registers a route for every frozen RouteTarget', () => {
    const root = appRoutes[0];
    const childNames = new Set((root.children ?? []).map((child) => child.name));
    for (const routeId of ROUTE_TARGET_IDS) {
      expect(childNames.has(routeId), routeId).toBe(true);
    }
  });

  it('registers a not-found catch-all', () => {
    const root = appRoutes[0];
    const catchAll = (root.children ?? []).find((child) => child.name === 'not-found');
    expect(catchAll?.path).toBe(':pathMatch(.*)*');
  });

  it('declares lazy components for business targets', () => {
    const root = appRoutes[0];
    for (const child of root.children ?? []) {
      if (child.name === 'root' || child.name === 'not-found') continue;
      expect(typeof child.component, String(child.name)).toBe('function');
    }
  });
});
```

`apps/console/test/components/shell.test.ts`:

```ts
import { render, screen } from '@testing-library/vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../../src/App.vue';
import { router } from '../../src/router';
import { pinia } from '../../src/stores';
import { mockServer } from '../msw/server';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(async () => {
  router.push('/');
  await router.isReady();
});
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

describe('app shell', () => {
  it('renders the top bar entries when authenticated (real session projection)', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    expect(await screen.findByRole('navigation', { name: '顶栏导航' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '工作空间' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '通知' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '账号安全' })).toBeTruthy();
  });

  it('renders the project sidebar entries in project scope', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    expect(await screen.findByRole('navigation', { name: '侧栏导航' })).toBeTruthy();
    for (const label of ['接入', '概览', '问题', '请求', '数据状态', '发布', '告警', '访问']) {
      expect(screen.getByRole('link', { name: label }), label).toBeTruthy();
    }
  });

  it('sets a stable page title after navigation', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    await router.push('/workspace');
    await router.isReady();
    expect(document.title).toContain('工作空间');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aurora/console test`
Expected: FAIL — `src/router/*` and `src/components/shell/*` do not exist.

- [ ] **Step 3: Write minimal implementation**

`apps/console/src/router/routes.ts`:

```ts
import type { RouteRecordRaw } from 'vue-router';
import { ROUTE_REGISTRY } from '../contracts/route-registry';
import AppShell from '../components/shell/AppShell.vue';

export const appRoutes: readonly RouteRecordRaw[] = [
  {
    path: '/',
    component: AppShell,
    children: [
      {
        path: '',
        name: 'root',
        component: () => import('../components/pages/WorkspaceHomeView.vue'),
        meta: { label: '工作空间', routeId: 'workspace.home', scope: 'workspace' },
      },
      ...ROUTE_REGISTRY.map((entry) => ({
        path: entry.path.replace(/^\/+/, '') || '',
        name: entry.routeId,
        component: entry.lazy,
        meta: { label: entry.label, routeId: entry.routeId, scope: entry.scope },
      })),
      {
        path: ':pathMatch(.*)*',
        name: 'not-found',
        component: () => import('../components/pages/NotFoundView.vue'),
        meta: { label: '页面不存在', scope: 'public' },
      },
    ],
  },
];
```

`apps/console/src/router/guards.ts` (route guards do navigation-experience only — never authorization):

```ts
import type { Router } from 'vue-router';
import { pinia } from '../stores';
import { useSessionStore } from '../stores/session';

export function installSessionGuard(router: Router): void {
  router.beforeEach(async (to) => {
    const session = useSessionStore(pinia);
    if (session.status === 'idle') await session.restore();
    const requiresSession = to.meta.scope !== undefined && to.meta.scope !== 'public';
    if (
      requiresSession &&
      (session.status === 'unauthenticated' || session.status === 'unavailable')
    ) {
      return { name: 'auth.login' };
    }
    return true;
  });
}
```

`apps/console/src/router/focus.ts`:

```ts
import type { Router } from 'vue-router';

export function installFocusManagement(router: Router): void {
  router.afterEach((to) => {
    const label = typeof to.meta.label === 'string' ? to.meta.label : 'Aurora 管理平台';
    document.title = `${label} · Aurora`;
    const target = document.getElementById('page-title');
    if (target !== null) {
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  });
}
```

`apps/console/src/router/index.ts`:

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { appRoutes } from './routes';
import { installSessionGuard } from './guards';
import { installFocusManagement } from './focus';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [...appRoutes],
});

installSessionGuard(router);
installFocusManagement(router);
```

`apps/console/src/components/shell/AppShell.vue`:

```vue
<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../stores/navigation';
import { useSessionStore } from '../../stores/session';
import ContentOutlet from './ContentOutlet.vue';
import GlobalLoading from './GlobalLoading.vue';
import LayeredSidebar from './LayeredSidebar.vue';
import TopBar from './TopBar.vue';

const session = useSessionStore();
const navigation = useNavigationStore();
const { status } = storeToRefs(session);

onMounted(() => {
  void session.restore();
});

watch(
  () => session.status,
  (value) => {
    if (value === 'authenticated') void navigation.load();
  },
);
</script>

<template>
  <div class="au-shell">
    <TopBar />
    <div class="au-shell-body">
      <LayeredSidebar />
      <main class="au-content">
        <ContentOutlet />
      </main>
    </div>
    <GlobalLoading v-if="status === 'loading'" />
  </div>
</template>

<style scoped>
.au-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--color-page-bg);
}
.au-shell-body {
  display: flex;
  flex: 1;
}
.au-content {
  flex: 1;
  min-width: 0;
  padding: var(--space-5);
}
</style>
```

`apps/console/src/components/shell/GlobalLoading.vue`:

```vue
<template>
  <div class="au-global-loading" role="status" aria-live="polite">正在恢复会话…</div>
</template>

<style scoped>
.au-global-loading {
  position: fixed;
  top: var(--space-4);
  right: var(--space-4);
  padding: var(--space-2) var(--space-4);
  background-color: var(--color-surface-bg);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  color: var(--color-text-primary);
  background-image: none;
}
</style>
```

`apps/console/src/components/shell/ContentOutlet.vue`:

```vue
<template>
  <RouterView />
</template>
```

`apps/console/src/components/shell/ScopeSwitcher.vue` (scope-switch skeleton: clears old cache/selection; org/project selection business is G10/G11):

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../stores/navigation';

const navigation = useNavigationStore();
const { organizations, currentOrganizationId } = storeToRefs(navigation);

const selected = computed(() => currentOrganizationId.value ?? '');

function onOrgChange(): void {
  navigation.clear();
}
</script>

<template>
  <div class="au-scope-switch">
    <label class="au-scope-label" for="scope-org">组织</label>
    <select id="scope-org" class="au-select" :value="selected" @change="onOrgChange">
      <option value="">未选择</option>
      <option v-for="org in organizations" :key="org.organizationId" :value="org.organizationId">
        {{ org.name }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.au-scope-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.au-select {
  height: var(--control-height);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  padding: 0 var(--space-2);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
}
</style>
```

`apps/console/src/components/shell/TopBar.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { resolveRouteTarget } from '../../contracts/route-registry';
import { useNavigationStore } from '../../stores/navigation';
import { useSessionStore } from '../../stores/session';
import AppLink from '../aurora/AppLink.vue';
import ScopeSwitcher from './ScopeSwitcher.vue';

const session = useSessionStore();
const navigation = useNavigationStore();
const { status: sessionStatus } = storeToRefs(session);
const { organizations, currentOrganizationId } = storeToRefs(navigation);

const authenticated = computed(() => sessionStatus.value === 'authenticated');
const orgLabel = computed(() => {
  if (!authenticated.value) return '未登录';
  const org = organizations.value.find(
    (candidate) => candidate.organizationId === currentOrganizationId.value,
  );
  return org?.name ?? '未选择';
});

function hrefFor(routeId: string): string {
  return (
    resolveRouteTarget({ routeId: routeId as never, pathParams: {}, query: {} }).path ??
    '/not-found'
  );
}
</script>

<template>
  <header class="au-topbar">
    <AppLink :to="hrefFor('workspace.home')" class="au-brand" label="Aurora" />
    <nav class="au-topnav" aria-label="顶栏导航">
      <AppLink :to="hrefFor('workspace.home')" label="工作空间" />
      <ScopeSwitcher />
      <span class="au-scope-chip">{{ orgLabel }}</span>
      <AppLink :to="hrefFor('account.notifications')" label="通知" />
      <AppLink :to="hrefFor('account.security')" label="账号安全" />
    </nav>
  </header>
</template>

<style scoped>
.au-topbar {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  height: var(--nav-height);
  padding: 0 var(--space-5);
  background-color: var(--color-topbar-bg);
  color: var(--color-topbar-fg);
}
.au-topnav {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.au-topnav :deep(.au-link) {
  color: var(--color-topbar-fg);
}
.au-brand {
  font-weight: 600;
}
.au-scope-chip {
  color: var(--color-topbar-fg);
}
</style>
```

`apps/console/src/components/shell/LayeredSidebar.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import { ROUTE_BY_ID, resolveRouteTarget } from '../../contracts/route-registry';
import {
  ORG_SIDEBAR_ENTRIES,
  PROJECT_SIDEBAR_ENTRIES,
} from '../../contracts/sidebar-entries';
import { useNavigationStore } from '../../stores/navigation';
import AppLink from '../aurora/AppLink.vue';

const route = useRoute();
const navigation = useNavigationStore();
const { status, currentScope, currentOrganizationId } = storeToRefs(navigation);

const entries = computed(() => {
  if (status.value !== 'ready') return [];
  if (currentScope.value?.type === 'organization') {
    return ORG_SIDEBAR_ENTRIES.map((id) => ROUTE_BY_ID.get(id)).filter(
      (entry) => entry !== undefined && entry.menu,
    );
  }
  if (currentScope.value?.type === 'project') {
    return PROJECT_SIDEBAR_ENTRIES.map((id) => ROUTE_BY_ID.get(id)).filter(
      (entry) => entry !== undefined && entry.menu,
    );
  }
  return [];
});

function paramsFor(routeId: string): Readonly<Record<string, string>> {
  const params: Record<string, string> = {};
  const orgId = currentOrganizationId.value;
  if (orgId !== null) params.organizationId = orgId;
  if (currentScope.value?.type === 'project' && currentScope.value.id !== undefined) {
    params.projectId = currentScope.value.id;
  }
  return params;
}

function hrefFor(routeId: string): string {
  return (
    resolveRouteTarget({ routeId: routeId as never, pathParams: paramsFor(routeId), query: {} })
      .path ?? '/not-found'
  );
}
</script>

<template>
  <nav class="au-sidebar" aria-label="侧栏导航">
    <ul class="au-sidebar-list">
      <li v-for="entry in entries" :key="entry.routeId">
        <AppLink
          :to="hrefFor(entry.routeId)"
          :label="entry.label"
          :active="route.name === entry.routeId"
        />
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.au-sidebar {
  width: 240px;
  flex-shrink: 0;
  padding: var(--space-4) 0;
  background-color: var(--color-sidebar-bg);
  color: var(--color-sidebar-fg);
}
.au-sidebar-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.au-sidebar :deep(.au-link) {
  color: var(--color-sidebar-fg);
}
.au-sidebar :deep(.au-link--active) {
  background-color: var(--color-sidebar-active-bg);
  color: var(--color-sidebar-active-fg);
}
</style>
```

`apps/console/src/App.vue` (replaces the Task 1 minimal shell; the route tree mounts `AppShell` at `/`):

```vue
<template>
  <RouterView />
</template>
```

`apps/console/src/main.ts` (replaces the Task 5 version — installs the router):

```ts
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { pinia } from './stores';
import './styles/tokens.css';
import './styles/base.css';

async function bootstrap(): Promise<void> {
  if (import.meta.env.MODE === 'test') {
    const { setupMockServer } = await import('./mocks/entry');
    await setupMockServer();
  }
  const app = createApp(App);
  app.use(pinia);
  app.use(router);
  app.mount('#app');
}

void bootstrap();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/console test`
Expected: PASS (router registers all 36 route targets + catch-all + lazy components; shell renders the top bar and project sidebar entries from the real session/navigation projection via MSW; stable page title after navigation).

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @aurora/console typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/router apps/console/src/components/shell apps/console/src/App.vue apps/console/src/main.ts apps/console/test/router apps/console/test/components/shell.test.ts
git commit -m "feat: add app shell with top bar, layered sidebar, scope switch and focus management"
```

---

### Task 8: Status pages — route error / retryable error, forbidden (no existence leak), unavailable, auth-unavailable, not-found, and root behavior + global error handling

**Files:**
- Create: `apps/console/src/components/pages/RouteErrorView.vue`
- Create: `apps/console/src/components/pages/ForbiddenView.vue`
- Create: `apps/console/src/components/pages/AuthUnavailableView.vue`
- Create: `apps/console/src/components/pages/RootView.vue`
- Create: `apps/console/test/components/status-pages.test.ts`
- Modify: `apps/console/src/router/routes.ts` (root child → `RootView`; `auth.login` → `AuthUnavailableView`; add `route-error` and `forbidden` public routes)
- Modify: `apps/console/src/router/index.ts` (install `router.onError` → `route-error`)
- Modify: `apps/console/src/main.ts` (global `app.config.errorHandler`)

**Interfaces:**
- Consumes: `UnavailableView`/`NotFoundView` (Task 6), AppButton/AppPageHeader/AppStatusBadge/AppLink (Task 3), `useSessionStore` (Task 5), router (Task 7).
- Produces:
  - `RouteErrorView.vue` — retryable error page (`重试` button calls `router.go(0)`).
  - `ForbiddenView.vue` — `无权限访问`, explicitly states it never reveals target existence.
  - `AuthUnavailableView.vue` — authentication-not-provided page (safe `unauthenticated`/`unavailable` entry; never a fake login form).
  - `RootView.vue` — root behavior (spec §9): authenticated → workspace home; `unavailable` → `认证能力未提供`; otherwise → auth entry (`AuthUnavailableView`).
  - Status pages test asserting the four states have explicit text and no fake data.

- [ ] **Step 1: Write the failing test**

`apps/console/test/components/status-pages.test.ts`:

```ts
import { render, screen } from '@testing-library/vue';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import AuthUnavailableView from '../../src/components/pages/AuthUnavailableView.vue';
import ForbiddenView from '../../src/components/pages/ForbiddenView.vue';
import RootView from '../../src/components/pages/RootView.vue';
import RouteErrorView from '../../src/components/pages/RouteErrorView.vue';
import UnavailableView from '../../src/components/pages/UnavailableView.vue';
import { useSessionStore } from '../../src/stores/session';

describe('status pages', () => {
  it('RouteErrorView offers a retry action', () => {
    render(RouteErrorView, {
      global: {
        mocks: { $router: { go: () => undefined } },
      },
    });
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('ForbiddenView reveals no existence', () => {
    render(ForbiddenView);
    expect(screen.getByText('无权限访问')).toBeTruthy();
    expect(screen.getByText(/不会透露目标是否存在/)).toBeTruthy();
  });

  it('AuthUnavailableView never fakes login', () => {
    render(AuthUnavailableView);
    expect(screen.getByText(/功能未提供/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /登录/i })).toBeNull();
  });

  it('UnavailableView renders each approved reason with text', () => {
    render(UnavailableView, {
      props: { title: '问题列表', reason: 'capability-not-provided' },
    });
    expect(screen.getByText('功能未提供')).toBeTruthy();
  });

  it('RootView shows authentication-unavailable when session is unavailable', () => {
    setActivePinia(createPinia());
    const session = useSessionStore();
    session.status = 'unavailable';
    render(RootView);
    expect(screen.getByText(/认证能力未提供/)).toBeTruthy();
  });
});
```

Note: `RootView`'s `useSessionStore()` resolves the pinia made active by `setActivePinia(createPinia())` above, so `render(RootView)` needs no plugins.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/console test`
Expected: FAIL — `RouteErrorView.vue`, `ForbiddenView.vue`, `AuthUnavailableView.vue`, `RootView.vue` do not exist.

- [ ] **Step 3: Write minimal implementation**

`apps/console/src/components/pages/RouteErrorView.vue`:

```vue
<script setup lang="ts">
import { useRouter } from 'vue-router';
import AppButton from '../aurora/AppButton.vue';
import AppPageHeader from '../aurora/AppPageHeader.vue';
import AppStatusBadge from '../aurora/AppStatusBadge.vue';

const router = useRouter();

function retry(): void {
  void router.go(0);
}
</script>

<template>
  <section class="au-status au-surface" data-testid="route-error-view">
    <AppPageHeader title="页面加载失败" />
    <AppStatusBadge tone="danger">可重试错误</AppStatusBadge>
    <p class="au-status-detail">
      页面加载过程中发生错误。错误详情不包含任何敏感信息，请重试。
    </p>
    <AppButton @click="retry">重试</AppButton>
  </section>
</template>

<style scoped>
.au-status-detail {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
</style>
```

`apps/console/src/components/pages/ForbiddenView.vue`:

```vue
<script setup lang="ts">
import AppPageHeader from '../aurora/AppPageHeader.vue';
import AppStatusBadge from '../aurora/AppStatusBadge.vue';
</script>

<template>
  <section class="au-status au-surface" data-testid="forbidden-view">
    <AppPageHeader title="无权限访问" />
    <AppStatusBadge tone="danger">权限不足</AppStatusBadge>
    <p class="au-status-detail">
      你没有访问该资源的权限。出于安全原因，本页面不会透露目标是否存在。
    </p>
  </section>
</template>

<style scoped>
.au-status-detail {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
</style>
```

`apps/console/src/components/pages/AuthUnavailableView.vue`:

```vue
<script setup lang="ts">
import AppPageHeader from '../aurora/AppPageHeader.vue';
import AppStatusBadge from '../aurora/AppStatusBadge.vue';
</script>

<template>
  <section class="au-status au-surface" data-testid="auth-unavailable-view">
    <AppPageHeader title="登录" />
    <AppStatusBadge tone="warning">功能未提供</AppStatusBadge>
    <p class="au-status-detail">
      平台认证后端尚未实现（G10）。当前预览以安全的「认证能力未提供」状态展示，不会伪造登录成功或假用户；认证入口将在对应后端实现后启用。
    </p>
  </section>
</template>

<style scoped>
.au-status-detail {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
</style>
```

`apps/console/src/components/pages/RootView.vue` (spec §9 root behavior):

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '../../stores/session';
import AuthUnavailableView from './AuthUnavailableView.vue';
import UnavailableView from './UnavailableView.vue';
import WorkspaceHomeView from './WorkspaceHomeView.vue';

const session = useSessionStore();
const { status } = storeToRefs(session);

const view = computed<'workspace' | 'unavailable' | 'auth'>(() => {
  if (status.value === 'authenticated') return 'workspace';
  if (status.value === 'unavailable') return 'unavailable';
  return 'auth';
});
</script>

<template>
  <WorkspaceHomeView v-if="view === 'workspace'" />
  <UnavailableView
    v-else-if="view === 'unavailable'"
    title="认证能力未提供"
    reason="capability-not-provided"
    detail="平台认证后端尚未实现；会话以安全不可用状态展示，不会伪造登录。"
  />
  <AuthUnavailableView v-else />
</template>
```

`apps/console/src/router/routes.ts` — replace the `root` child component and add the two status routes and the `auth.login` special case:

```ts
import type { RouteRecordRaw } from 'vue-router';
import { ROUTE_REGISTRY } from '../contracts/route-registry';
import AppShell from '../components/shell/AppShell.vue';

export const appRoutes: readonly RouteRecordRaw[] = [
  {
    path: '/',
    component: AppShell,
    children: [
      {
        path: '',
        name: 'root',
        component: () => import('../components/pages/RootView.vue'),
        meta: { label: '工作空间', routeId: 'workspace.home', scope: 'workspace' },
      },
      ...ROUTE_REGISTRY.map((entry) => ({
        path: entry.path.replace(/^\/+/, '') || '',
        name: entry.routeId,
        component:
          entry.routeId === 'auth.login'
            ? () => import('../components/pages/AuthUnavailableView.vue')
            : entry.lazy,
        meta: { label: entry.label, routeId: entry.routeId, scope: entry.scope },
      })),
      {
        path: 'route-error',
        name: 'route-error',
        component: () => import('../components/pages/RouteErrorView.vue'),
        meta: { label: '页面加载失败', scope: 'public' },
      },
      {
        path: 'forbidden',
        name: 'forbidden',
        component: () => import('../components/pages/ForbiddenView.vue'),
        meta: { label: '无权限访问', scope: 'public' },
      },
      {
        path: ':pathMatch(.*)*',
        name: 'not-found',
        component: () => import('../components/pages/NotFoundView.vue'),
        meta: { label: '页面不存在', scope: 'public' },
      },
    ],
  },
];
```

`apps/console/src/router/index.ts` — add the route-error wiring:

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { appRoutes } from './routes';
import { installSessionGuard } from './guards';
import { installFocusManagement } from './focus';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [...appRoutes],
});

installSessionGuard(router);
installFocusManagement(router);

router.onError(() => {
  void router.replace({ name: 'route-error' });
});
```

`apps/console/src/main.ts` — add the global error handler (code-only, never secrets):

```ts
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { pinia } from './stores';
import './styles/tokens.css';
import './styles/base.css';

async function bootstrap(): Promise<void> {
  if (import.meta.env.MODE === 'test') {
    const { setupMockServer } = await import('./mocks/entry');
    await setupMockServer();
  }
  const app = createApp(App);
  app.config.errorHandler = (error) => {
    console.error('[console]', error instanceof Error ? error.message : 'unknown');
  };
  app.use(pinia);
  app.use(router);
  app.mount('#app');
}

void bootstrap();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aurora/console test`
Expected: PASS (status pages render the four explicit states; no fake login controls; root shows authentication-unavailable when the session is unavailable).

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @aurora/console typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/pages apps/console/src/router apps/console/src/main.ts apps/console/test/components/status-pages.test.ts
git commit -m "feat: add status pages, root behavior, and global error handling"
```

---

### Task 9: Responsive minimum (narrow-screen Drawer, same amber + same entry order) + keyboard accessibility foundation

**Files:**
- Create: `apps/console/test/components/responsive.test.ts`
- Modify: `apps/console/src/components/shell/AppShell.vue` (menu trigger + `AppDrawer` + responsive CSS: desktop sidebar hidden below 1024px, drawer used below 1024px)
- Modify: `apps/console/src/components/shell/LayeredSidebar.vue` (accept `fill?: boolean` so the drawer renders the sidebar full-width — same amber, same entry order)

**Interfaces:**
- Consumes: `AppDrawer` (Task 3), `LayeredSidebar` (Task 7), `AppButton` (Task 3), session/nav stores.
- Produces:
  - `AppShell` narrow-screen behavior: a `导航` trigger button (always in the DOM, CSS-hidden on wide screens) opens an `AppDrawer` whose content is the same `LayeredSidebar`; the inline desktop sidebar is CSS-hidden on narrow screens. Both render the exact same entry order (same component instance source).
  - `LayeredSidebar` `fill` prop → `au-sidebar--fill` (width 100%).
  - Structural keyboard test: every shell nav entry is a `role="link"` anchor (keyboard-reachable), the scope switcher is a `role="combobox"`, the drawer trigger is a `role="button"`. Full Tab/Enter navigation is asserted by Playwright in Task 10.

- [ ] **Step 1: Write the failing test**

`apps/console/test/components/responsive.test.ts`:

```ts
import { fireEvent, render, screen } from '@testing-library/vue';
import { defineComponent } from 'vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../../src/App.vue';
import { router } from '../../src/router';
import { pinia } from '../../src/stores';
import { mockServer } from '../msw/server';

const DrawerStub = defineComponent({
  name: 'DrawerStub',
  props: { visible: Boolean, header: String, position: String, ariaLabel: String },
  emits: ['update:visible'],
  template:
    '<div data-testid="drawer" v-if="visible" :aria-label="ariaLabel"><h2>{{ header }}</h2><slot /></div>',
});

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(async () => {
  router.push('/');
  await router.isReady();
});
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

describe('responsive shell + keyboard foundation', () => {
  it('renders every shell nav entry as a keyboard-reachable link', async () => {
    render(App, { global: { plugins: [pinia, router], stubs: { Drawer: DrawerStub } } });
    await screen.findByRole('navigation', { name: '侧栏导航' });
    for (const label of ['接入', '概览', '问题', '请求', '数据状态', '发布', '告警', '访问']) {
      const link = screen.getByRole('link', { name: label });
      expect(link.getAttribute('href')).not.toBeNull();
    }
  });

  it('exposes the scope switcher as a combobox', async () => {
    render(App, { global: { plugins: [pinia, router], stubs: { Drawer: DrawerStub } } });
    await screen.findByRole('navigation', { name: '侧栏导航' });
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('opens the narrow-screen drawer with the same sidebar entries', async () => {
    render(App, { global: { plugins: [pinia, router], stubs: { Drawer: DrawerStub } } });
    await screen.findByRole('navigation', { name: '侧栏导航' });
    const trigger = screen.getByRole('button', { name: '导航' });
    await fireEvent.click(trigger);
    expect(screen.getByTestId('drawer')).toBeTruthy();
    // the drawer reuses the same LayeredSidebar, so the same amber entry order appears
    expect(screen.getAllByRole('link', { name: '概览' }).length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/console test`
Expected: FAIL — `AppShell` has no `导航` trigger/drawer yet, and `LayeredSidebar` has no `fill` prop.

- [ ] **Step 3: Write minimal implementation**

`apps/console/src/components/shell/AppShell.vue` (replaces the Task 7 version — adds the narrow-screen drawer):

```vue
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../stores/navigation';
import { useSessionStore } from '../../stores/session';
import AppButton from '../aurora/AppButton.vue';
import AppDrawer from '../aurora/AppDrawer.vue';
import ContentOutlet from './ContentOutlet.vue';
import GlobalLoading from './GlobalLoading.vue';
import LayeredSidebar from './LayeredSidebar.vue';
import TopBar from './TopBar.vue';

const session = useSessionStore();
const navigation = useNavigationStore();
const { status } = storeToRefs(session);
const drawerOpen = ref(false);

onMounted(() => {
  void session.restore();
});

watch(
  () => session.status,
  (value) => {
    if (value === 'authenticated') void navigation.load();
  },
);
</script>

<template>
  <div class="au-shell">
    <TopBar />
    <div class="au-shell-body">
      <aside class="au-desktop-sidebar">
        <LayeredSidebar />
      </aside>
      <main class="au-content">
        <AppButton
          class="au-menu-trigger"
          variant="secondary"
          aria-haspopup="dialog"
          aria-controls="nav-drawer"
          @click="drawerOpen = true"
        >
          导航
        </AppButton>
        <ContentOutlet />
      </main>
    </div>
    <AppDrawer :open="drawerOpen" title="导航" @close="drawerOpen = false">
      <LayeredSidebar fill />
    </AppDrawer>
    <GlobalLoading v-if="status === 'loading'" />
  </div>
</template>

<style scoped>
.au-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--color-page-bg);
}
.au-shell-body {
  display: flex;
  flex: 1;
}
.au-content {
  flex: 1;
  min-width: 0;
  padding: var(--space-5);
}
.au-menu-trigger {
  margin-bottom: var(--space-4);
}
@media (min-width: 1024px) {
  .au-menu-trigger {
    display: none;
  }
}
@media (max-width: 1023px) {
  .au-desktop-sidebar {
    display: none;
  }
}
</style>
```

`apps/console/src/components/shell/LayeredSidebar.vue` — add the `fill` prop (replace the `<script setup>` opening and the root `class`):

```ts
withDefaults(defineProps<{ fill?: boolean }>(), { fill: false });
```

and change the root element to:

```html
<nav class="au-sidebar" :class="{ 'au-sidebar--fill': fill }" aria-label="侧栏导航">
```

and append to the scoped style:

```css
.au-sidebar--fill {
  width: 100%;
}
```

Note: `class` attribute merging already forwards the AppShell-attached class onto this root; the `:class` binding above is additive.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aurora/console test`
Expected: PASS (nav links are real anchors, scope switcher is a combobox, drawer opens with the same sidebar entries).

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @aurora/console typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/shell apps/console/test/components/responsive.test.ts
git commit -m "feat: add narrow-screen drawer and keyboard accessibility foundation"
```

---

### Task 10: Playwright reachability enforcement (real UI click/keyboard, not page.goto-only) + axe in the real browser

**Files:**
- Create: `apps/console/test-browser/serve-spa.ts` (static server for `dist-test/` with SPA fallback)
- Create: `apps/console/test-browser/reachability.spec.ts`
- Create: `apps/console/test-browser/axe.spec.ts`

**Interfaces:**
- Consumes: the `--mode test` build (`dist-test/`, MSW-enabled), MSW browser worker (`/mockServiceWorker.js`), the app shell (Tasks 7–9), `@axe-core/playwright`.
- Produces:
  - `serve-spa.ts`: `startSpaServer()` returning `{ origin, close }` — serves `dist-test/`, SPA-fallback to `index.html`, serves `/mockServiceWorker.js`.
  - `reachability.spec.ts`: every shell-rendered nav entry (project sidebar, organization sidebar, top bar workspace/notifications/account, scope-switch select) reached by **real UI click/select** and asserted by URL + explicit unavailable content; `page.goto()` is used only for the initial root load and the post-scope-control reload — never as the entry's reachability evidence. Blocked G10–G13 targets assert parse/protect/represent + explicit unavailable/blocked and **no fake tables**.
  - `axe.spec.ts`: `AxeBuilder` on the authenticated shell; `expect(results.violations).toEqual([])`.

- [ ] **Step 1: Write the failing tests**

`apps/console/test-browser/reachability.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';

let server: { origin: string; close(): Promise<void> } | undefined;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\]/g, '\$&');
}

async function setMockScope(page: Page, type: 'workspace' | 'organization' | 'project', id?: string): Promise<void> {
  await page.evaluate(
    ([scopeType, scopeId]) =>
      fetch('/__mock/scope', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: scopeType, id: scopeId }),
      }),
    [type, id],
  );
}

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

const PROJECT_ENTRIES: ReadonlyArray<{ name: string; path: string }> = [
  { name: '接入', path: '/organizations/org_test_1/projects/prj_test_1/onboarding' },
  { name: '概览', path: '/organizations/org_test_1/projects/prj_test_1/overview' },
  { name: '问题', path: '/organizations/org_test_1/projects/prj_test_1/issues' },
  { name: '请求', path: '/organizations/org_test_1/projects/prj_test_1/requests' },
  { name: '性能', path: '/organizations/org_test_1/projects/prj_test_1/performance' },
  { name: '数据状态', path: '/organizations/org_test_1/projects/prj_test_1/data-status' },
  { name: '发布', path: '/organizations/org_test_1/projects/prj_test_1/releases' },
  { name: '告警', path: '/organizations/org_test_1/projects/prj_test_1/alerts' },
  { name: '访问', path: '/organizations/org_test_1/projects/prj_test_1/access' },
  { name: '客户端密钥', path: '/organizations/org_test_1/projects/prj_test_1/client-keys' },
  { name: '设置', path: '/organizations/org_test_1/projects/prj_test_1/settings' },
];

const ORG_ENTRIES: ReadonlyArray<{ name: string; path: string }> = [
  { name: '成员', path: '/organizations/org_test_1/members' },
  { name: '设置', path: '/organizations/org_test_1/settings' },
  { name: '用量', path: '/organizations/org_test_1/usage' },
  { name: '令牌', path: '/organizations/org_test_1/tokens' },
  { name: '审计', path: '/organizations/org_test_1/audit' },
  { name: '回收站', path: '/organizations/org_test_1/trash' },
];

test('every project sidebar entry is reachable by real click and shows unavailable (no fake data)', async ({ page }) => {
  await setMockScope(page, 'project', 'prj_test_1');
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  for (const entry of PROJECT_ENTRIES) {
    await page.getByRole('link', { name: entry.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(escapeRegExp(entry.path)));
    await expect(page.getByTestId('unavailable-view')).toBeVisible();
    await expect(page.getByText('功能未提供')).toBeVisible();
  }
});

test('top bar workspace, notifications and account entries are reachable by real click', async ({ page }) => {
  await setMockScope(page, 'project', 'prj_test_1');
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('link', { name: '工作空间' })).toBeVisible();
  await page.getByRole('link', { name: '工作空间', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByRole('link', { name: '通知', exact: true }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByTestId('unavailable-view')).toBeVisible();
  await page.getByRole('link', { name: '账号安全', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(page.getByTestId('unavailable-view')).toBeVisible();
});
test('every organization sidebar entry is reachable by real click after switching scope', async ({ page }) => {
  await setMockScope(page, 'organization', 'org_test_1');
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  for (const entry of ORG_ENTRIES) {
    await page.getByRole('link', { name: entry.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(escapeRegExp(entry.path)));
    await expect(page.getByTestId('unavailable-view')).toBeVisible();
  }
});

test('scope switch (real select) clears the old scope state', async ({ page }) => {
  await setMockScope(page, 'project', 'prj_test_1');
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  await page.selectOption('#scope-org', 'org_test_1');
  // 壳层骨架语义：切换作用域清除旧缓存/选择；新作用域未获服务端确认前不显示伪造入口
  await expect(page.locator('.au-sidebar-list li')).toHaveCount(0);
});

test('a nav entry is reachable by keyboard (focus + Enter)', async ({ page }) => {
  await setMockScope(page, 'project', 'prj_test_1');
  await page.goto(`${server!.origin}/`);
  const overview = page.getByRole('link', { name: '概览', exact: true });
  await overview.focus();
  await expect(overview).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(//organizations/org_test_1/projects/prj_test_1/overview$/);
  await expect(page.getByTestId('unavailable-view')).toBeVisible();
});
test('blocked G10-G13 targets parse, protect and represent unavailable (no fake data)', async ({ page }) => {
  const targets: ReadonlyArray<{ path: string; testId: string }> = [
    { path: '/login', testId: 'auth-unavailable-view' },
    { path: '/register', testId: 'unavailable-view' },
    { path: '/platform/resource-policies', testId: 'unavailable-view' },
    { path: '/organizations/org_test_1/projects/prj_test_1/issues/some_issue', testId: 'unavailable-view' },
    { path: '/organizations/org_test_1/projects/prj_test_1/releases/r_1/source-maps', testId: 'unavailable-view' },
  ];
  for (const target of targets) {
    await page.goto(`${server!.origin}${target.path}`);
    await expect(page.getByTestId(target.testId), target.path).toBeVisible();
    await expect(page.getByRole('table'), target.path).toHaveCount(0);
  }
});
`apps/console/test-browser/axe.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';

let server: { origin: string; close(): Promise<void> } | undefined;

async function setProjectScope(page: Page): Promise<void> {
  await page.evaluate(() =>
    fetch('/__mock/scope', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'project', id: 'prj_test_1' }),
    }),
  );
}

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

test('the authenticated shell passes axe auto-checks', async ({ page }) => {
  await setProjectScope(page);
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aurora/console test:browser`
Expected: FAIL — `test-browser/serve-spa.ts` does not exist (import error), and no static server serves `dist-test/`. Record the failure gate.
- [ ] **Step 3: Write minimal implementation**

`apps/console/test-browser/serve-spa.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDirectory = fileURLToPath(new URL('../dist-test/', import.meta.url));

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface SpaServer {
  readonly origin: string;
  close(): Promise<void>;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const candidate = normalize(join(distDirectory, decodeURIComponent(pathname)));
  if (!candidate.startsWith(distDirectory)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const content = await readFile(candidate);
    response.writeHead(200, {
      'content-type': MIME[extname(candidate)] ?? 'application/octet-stream',
    });
    response.end(content);
    return;
  } catch {
    // SPA history fallback: non-asset client routes serve index.html
  }
  const index = await readFile(join(distDirectory, 'index.html'));
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(index);
}

export async function startSpaServer(): Promise<SpaServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('SPA server did not expose a TCP port');
  }
  return Object.freeze({
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: (): Promise<void> =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  });
}
```

Note: API requests (`/api/platform/v1/*`) never reach this server — the MSW browser worker intercepts them inside the page. `/mockServiceWorker.js` is copied from `public/` by Vite into `dist-test/` and served by this server.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/console test:browser`
Expected: PASS — every shell-rendered project/org/top-bar entry reached by real click; keyboard focus + Enter reaches the target; scope switch (real select) clears state; blocked G10–G13 targets parse/protect/represent unavailable with no tables; axe reports no violations on the authenticated shell.

- [ ] **Step 5: Commit**

```bash
git add apps/console/test-browser
git commit -m "feat: add Playwright reachability and axe gates"
```

---

### Task 11: Package-entry tests, production-build audit, README, repo-state sync, and the Preview serving switch

**Files:**
- Create: `apps/console/test/package-entry.test.ts` (build-structure gate)
- Create: `deploy/preview/Dockerfile.console`
- Create: `deploy/preview/nginx/console-default.conf`
- Modify: `apps/console/README.md` (full module README)
- Modify: `deploy/preview/compose.yaml` (add `console` service)
- Modify: `deploy/preview/nginx/aurora-tls.conf` (`aurora.ah.cn` vhost → `proxy_pass http://console:80`)
- Modify: `deploy/preview/scripts/deploy-preview.sh` (build the console in the local gate; update the final URL comment)
- Modify: `docs/architecture/formalization-readiness.md`, `docs/architecture/aurora-v1-remaining-module-batches.md`, `AGENTS.md`, `AURORA_RULES.md`, `docs/README.md` (record PLT-02 `implemented-in-feature-branch`; **leaf counts stay 39/39** until independent verification)
- Modify: `tooling/workspace-policy/README.md` (document the `console` layer)

**Interfaces:**
- Consumes: the built `dist/` (production, no MSW), the pinned nginx/Docker precedents in `deploy/preview`.
- Produces:
  - `test/package-entry.test.ts`: asserts `dist/index.html` loads hashed `/assets/*-<hash>.js`, no `.map` files (no source-map leak), and no `msw`/`contract-testkit`/`validSessionSamples` strings in production JS (spec §12.3, §13).
  - Preview switch files: `Dockerfile.console` (multi-stage: pnpm build → nginx runtime), `console-default.conf` (SPA `try_files $uri /index.html`, hashed-asset immutable cache, `index.html` no-cache, security headers), compose `console` service, `aurora-tls.conf` vhost swap, `deploy-preview.sh` console build.

- [ ] **Step 1: Write the failing test**

`apps/console/test/package-entry.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else acc.push(full);
  }
  return acc;
}

const files = collect(dist);

describe('built console production output', () => {
  it('emits an index.html entry that loads hashed assets', () => {
    const index = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(index).toMatch(/<script[^>]+src="\/assets\/[^"]+-[A-Za-z0-9_-]+\.js"/);
  });

  it('emits no source maps (no leak through Preview static serving)', () => {
    expect(files.filter((file) => file.endsWith('.map'))).toHaveLength(0);
  });

  it('contains no MSW or contract-testkit in the production bundle', () => {
    const jsFiles = files.filter((file) => file.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);
    for (const file of jsFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/msw|contract-testkit|validSessionSamples|__mock\/scope/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/console test:package`
Expected: FAIL initially (`dist/` not built because the `test:package` script runs `pnpm build` first — if the build fails, record that failure; otherwise the assertions must hold after the Task 1–10 code exists). If the production bundle still contains `msw`/`contract-testkit`, fix the main.ts `import.meta.env.MODE === 'test'` dead-code gate until the assertion passes.

- [ ] **Step 3: Write the full module README and the Preview serving switch files**

`apps/console/README.md` — document: module 定位（`@aurora/console`，private Vue 3 SPA shell，PLT-02）、层边界（`console` → `contract`/`tooling`，禁止依赖 database/service 内部包）、架构（bootstrap → router → Session/Navigation Context → Aurora UI shell → status pages）、命令（`build`/`build:test`/`typecheck`/`test`/`test:coverage`/`test:package`/`test:browser`）、测试模式（`--mode test` 启用 MSW，仅前端测试，生产构建不含 MSW/contract-testkit）、依赖版本表（Task 1 锁定的精确版本）、可访问性方向（WCAG 2.2 AA + axe）、非职责（无 G10–G13 业务、无 ECharts/Storybook、无暗色主题/Web Font、无 fake data）。No invented endpoints.

`deploy/preview/Dockerfile.console`:

```dockerfile
# Aurora console production image (multi-stage): build the SPA with pnpm, serve via nginx.
# Node version from repository engines: >=24.18.0 <25. .node-version = 24.18.0.
FROM node:24.18.0-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_HOME=/corepack
RUN npm i -g corepack && corepack enable && corepack prepare pnpm@11.17.0 --activate

WORKDIR /workspace
COPY . ./
# Production build (no MSW): vite build --mode default, sourcemap false.
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @aurora/console build

FROM nginx:1.27-alpine AS runtime

COPY deploy/preview/nginx/console-default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/console/dist/ /usr/share/nginx/html/

EXPOSE 80
```

`deploy/preview/nginx/console-default.conf`:

```nginx
server {
    listen 80;
    server_name _;
    server_tokens off;

    root /usr/share/nginx/html;
    index index.html;

    # hashed static assets: immutable long cache
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
        add_header X-Content-Type-Options "nosniff" always;
        try_files $uri =404;
    }

    # index.html: no-cache so an old HTML never points at a missing chunk
    location = /index.html {
        add_header Cache-Control "no-cache";
        add_header X-Content-Type-Options "nosniff" always;
    }

    # SPA history fallback for non-API client routes
    location / {
        add_header Cache-Control "no-cache";
        try_files $uri /index.html;
    }
}
```

`deploy/preview/compose.yaml` — add the `console` service (no published port; reached only via the shared Lumina nginx edge):

```yaml
  console:
    image: aurora-preview-console:${RELEASE_ID:?RELEASE_ID is required}
    build:
      context: ../..
      dockerfile: deploy/preview/Dockerfile.console
    restart: unless-stopped
    networks:
      - aurora-private
      - lumina-prod-internal
    logging: *default-logging
```

`deploy/preview/nginx/aurora-tls.conf` — replace the `aurora.ah.cn` 443 server block (currently serving the static status page) with a proxy to the `console` service; `ingest.aurora.ah.cn` is untouched (spec §14: `ingest` keeps serving only ingestion-api):

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name aurora.ah.cn www.aurora.ah.cn;
    server_tokens off;
    ssl_certificate /etc/letsencrypt/live/aurora.ah.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aurora.ah.cn/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:AuroraConsoleTLS:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # aurora.ah.cn now serves the built Vue SPA (try_files fallback inside console nginx).
    location / {
        resolver 127.0.0.11 valid=10s ipv6=off;
        set $console_upstream http://console:80;
        proxy_pass $console_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        access_log off; # no request bodies / sensitive query strings in logs
    }
}
```

The old `root /usr/share/nginx/html/aurora-preview; index preview-status.html; location / { try_files /preview-status.html =404; }` block is removed. The `deploy/preview/nginx/preview-status.html` file stays in the repo so rollback to the status page remains a one-release revert (spec §14 reversibility).

`deploy/preview/scripts/deploy-preview.sh` — two edits:
1. In the local quality gate, after the ingestion-worker build check, add:

```bash
  pnpm --filter @aurora/console build >/tmp/aurora-preview-console-build.log 2>&1 || { echo "CONSOLE BUILD FAILED"; tail -30 /tmp/aurora-preview-console-build.log; exit 1; }
```

2. Update the final URL echo:

```bash
echo "    https://aurora.ah.cn/          (Aurora Vue console SPA)"
```

- [ ] **Step 4: Run the local quality chain and verify the production build gate**

Run:
```bash
pnpm --filter @aurora/console test:package
pnpm --filter @aurora/console build
pnpm format:check
pnpm lint
pnpm typecheck
pnpm check:boundaries
```
Expected: PASS — `dist/` has hashed assets, no source maps, no MSW/contract-testkit; formatting/lint/boundaries include the app.

- [ ] **Step 5: Sync repo-state docs (leaf counts stay 39/39 until independent verification)**

- `docs/architecture/formalization-readiness.md`: register `apps/console` as real (`implemented-in-feature-branch`, 未部署); note the `console` workspace-policy layer; keep D2/Session/下游 contract states unchanged.
- `docs/architecture/aurora-v1-remaining-module-batches.md`: record PLT-02 `implemented-in-feature-branch` (not `deployed`); **do not change** `completed 39 / remaining 39` — leaf counts update only after PLT-02 independent verification.
- `AGENTS.md` / `AURORA_RULES.md`: update the platform state block — `apps/console` Vue 3 SPA shell real (bootstrap/router/session-context/nav-context/36-route-registry/shell/status pages/reachability Playwright gates), no G10–G13 business, no fake data; `aurora.ah.cn` Preview vhost switched to the SPA (config in repo); counts remain 39/39.
- `docs/README.md` / `tooling/workspace-policy/README.md`: document the `console` layer and the new app.

- [ ] **Step 6: Run the full gate for this leaf**

Run:
```bash
pnpm --filter @aurora/console test:package
pnpm --filter @aurora/console test:browser
pnpm --filter @aurora/console typecheck
```
Expected: PASS. Then run the whole `pnpm check` (root) once to confirm the app is fully wired into `format:check`/`lint`/`typecheck`/`test`/`test:coverage`/`check:boundaries`/`build`/`test:package`/`test:browser`.

- [ ] **Step 7: Commit**

```bash
git add apps/console/test/package-entry.test.ts apps/console/README.md deploy/preview docs AGENTS.md AURORA_RULES.md tooling/workspace-policy/README.md
git commit -m "feat: add production build gate and switch Preview serving to the Vue SPA"
```

**Preview serving switch execution notes** (run after PLT-02 verification, not in this commit): execute `pnpm deploy:preview` (or the CI preview workflow) to build `console` on the server and swap `current`; then smoke (spec §14): `curl -sS -o /dev/null -w '%{http_code}\n' https://aurora.ah.cn/` = 200, `curl -sS https://aurora.ah.cn/ | grep -q 'id="app"'`, and `curl -sS -o /dev/null -w '%{http_code}\n' https://ingest.aurora.ah.cn/v1/batches` = 401 (ingest regression gate). If the swap fails, `pnpm deploy:preview:rollback` reverts to the previous release (status page still present in the repo).

### Task 12: Broad final review + verification-before-completion inputs

**Files:**
- (no new source files; review gate)

**Interfaces:**
- Consumes: all of Tasks 1–11.

- [ ] **Step 1: Full quality gate**

Run:
```bash
pnpm format:check
pnpm openapi:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm build
pnpm --filter @aurora/console test:package
pnpm --filter @aurora/console test:browser
```
Expected: all PASS (the console app is now part of the root gates).

- [ ] **Step 2: No-fake-data audit (manual)**

Confirm `grep -rniE "lorem|敬请期待|待办事项占位" apps/console/src apps/console/test apps/console/test-browser` returns nothing. Confirm no `authenticated = true` hardcode in `apps/console/src` (the session store sets `authenticated` only from the contract-validated `identityGetSession` response). Confirm no fake tables/charts/issues exist (the only tables would be absent — the no-fake-data Playwright assertion in Task 10 already enforces `getByRole('table')` count 0 on blocked targets).

- [ ] **Step 3: Security-negative + boundary audit (manual)**

- Confirm `grep -rn "Kysely\|BullMQ\|processing-store\|ingestion-inbox\|redis" apps/console/src` returns nothing.
- Confirm the only `fetch(` call in `apps/console/src` is inside `src/api/client.ts`.
- Confirm `apps/console/package.json` has no `echarts`, `storybook`, `vee-validate` dependency.
- Confirm Playwright config has `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, `video: 'off'` (no reusable sensitive snapshots), and the MSW samples contain no secrets (already enforced by PLT-01's testkit test).

- [ ] **Step 4: Reachability evidence**

Re-run `pnpm --filter @aurora/console test:browser` and collect the reporter output showing every project/org/top-bar entry reached by real click and the keyboard/scope-switch/blocked-target tests passing. This is the approved reachability gate evidence (spec §7/§12.2/§17).

- [ ] **Step 5: `git diff --check`**

Run: `git diff --check HEAD`
Expected: no whitespace errors.

- [ ] **Step 6: Prepare verification evidence**

Collect: fresh outputs of Task 12 Step 1 commands, the Playwright/axe outputs, the no-fake-data grep, the security-negative greps, the production build audit (Task 11). Hand these to `superpowers:verification-before-completion`. PLT-02 is `implemented-in-feature-branch` (not `deployed`). Update leaf baseline to `completed 40 / remaining 38` in the repo status docs **only after** independent verification passes; until then counts stay 39/39.

- [ ] **Step 7: Commit any final doc/status sync**

```bash
git add -A
git commit -m "docs: record PLT-02 verification inputs"
```

---

## Self-Review (writing-plans §9 — run after writing, before execution handoff)

**1. Spec coverage** (against `docs/architecture/platform-frontend-shell.md` §1–§19 and the four approved input specs):

- §1 status/boundaries → Global Constraints + Task 12 (verification before completion). ✓
- §2.1 goals (aurora.ah.cn SPA, app-shell-first gates) → Tasks 7/8/10/11. ✓
- §2.2 non-goals (no G10 business, no fake data, no platform-api/db, no Storybook/dark/web-font) → Global Constraints + Task 3/8 (status-only business pages) + Task 12 audit + Task 1 (deps). ✓
- §3 technical baseline + exact versions → Task 1 (pinned, verified compatible; vee-validate deferred per §3 YAGNI). ✓
- §4 application layering (session/scope/nav, request+cache, UI wrapper) → Tasks 4/5/6/3; no DB/queue imports (Task 12 audit). ✓
- §5 Session Context boundary + safe state → Task 5 (mapSessionError, unavailable/unauthenticated, no fake). ✓
- §6 Navigation Context + safe empty + scope-switch cleanup → Task 6 store + Task 7 ScopeSwitcher. ✓
- §7 RouteTarget mapping + reachability gate → Task 6 (36 registry) + Task 10 (Playwright real-click; page.goto excluded as evidence; blocked targets parse/protect/represent). ✓
- §8 unimplemented pages (feature/dependency/permission unavailable, no fake) → Task 6 UnavailableView reasons + Task 8 AuthUnavailable/Forbidden + Task 10 no-table assertions. ✓
- §9 root route behavior → Task 8 RootView (authenticated→workspace, unavailable→认证能力未提供, else auth entry). ✓
- §10 real SPA shell minimal set → Tasks 7 (bootstrap/router/shell/loading/focus/title/outlet), 8 (status pages), 9 (responsive + keyboard). ✓
- §11 visual language compliance → Task 2 tokens (all 13 verbatim) + no-gradient gate; sidebar/active colors bound in AppLink/AppStatusBadge; tokens not scattered. ✓
- §12 tests → Task 1 (bootstrap), 2 (tokens), 3 (components), 4 (client/cache), 5 (session), 6 (registry/nav), 7 (router/shell), 8 (status), 9 (responsive/keyboard), 10 (reachability + axe), 11 (no-fake-data bundle gate). ✓
- §13 build/package/workspace → Task 1 (console layer, exact versions, hashed assets), Task 11 (no source-map leak). ✓
- §14 Preview serving → Task 11 (Dockerfile/nginx/compose/vhost/deploy script + smoke). ✓
- §15 limited completion (Session backend not implemented) → Task 5 + Global Constraints (safe unavailable, never fake login). ✓
- §16 excluded (do not start G10) → Global Constraints + Task 12 audit (no auth business). ✓
- §17 completion definition → Tasks 1–12 + Task 12 verification; every load-bearing gate (registry 36, session safety, no fake data, reachability real-click, visual tokens, production build no MSW/sourcemap, Preview switch, no G10). ✓
- §18/§19 self-check/review record → Task 12 evidence + this Self-Review. ✓

**2. Placeholder scan**: No unfinished work markers and no cross-task "repeat earlier task" references appear in any code step; every code step carries real, complete code. The only conditional language is the Task 1 PrimeVue import-path compat fallback (bound to a specific file, `AppDrawer.vue`, with a recorded README action) and the Task 11 "if the MSW dead-code gate still leaks" instruction (a concrete fix action, not a placeholder).

**3. Type consistency**: `ScopeKey`/`scopeKeyString` (Task 4) used by query-key/cache/store tests consistently; `queryKey` shape `workspace:identityGetSession` matches the Task 4 test; `SessionStatus`/`mapSessionError`/`useSessionStore` (Task 5) consumed by Task 8 RootView and the guard; `NavigationStatus`/`currentOrganizationId`/`load`/`clear` (Task 6) consumed by Task 7 shell/TopBar/LayeredSidebar/ScopeSwitcher and Task 10; `RouteEntry`/`resolveRouteTarget`/`ROUTE_BY_ID`/`ROUTE_REGISTRY`/`ORG_SIDEBAR_ENTRIES`/`PROJECT_SIDEBAR_ENTRIES` (Task 6) consumed by Tasks 7/9/10; `AppButton`/`AppLink`/`AppStatusBadge`/`AppPageHeader`/`AppDrawer` prop names identical across Tasks 3/7/8/9; the 36 registry ids are byte-identical to the frozen `ROUTE_TARGET_IDS` (verified against `navigation.ts` at write time). `test:package` runs `pnpm build` then `package-entry.test.ts` — consistent across Tasks 1/11.

**ADR coverage**: ADR-025 决定细节 1–14 (Task 1 versions/boundary, Task 4 self-built cache, Task 3 Aurora UI wrapper, Task 1 no ECharts/Storybook, Task 1 console layer, Task 2 single light theme + tokens); reviewer N1 (client state stays in composables/pages — shell keeps selections out of Pinia), N2 (console is its own layer, not `service`) → Task 1; ADR-027/028 (Session/CSRF contract via generated client) → Tasks 4/5. **No G10–G13 business implementation anywhere.** **No fake data** (MSW from contract-testkit samples only; status-only business pages).

Plan complete. Execution follows `superpowers:subagent-driven-development`.
