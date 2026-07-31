# Browser Environment Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立私有包 `@aurora/browser` 的浏览器环境安全探测、脱敏页面快照、页面生命周期订阅、幂等释放、多实例隔离和本地 Chromium 验证第一增量。

**Architecture:** Browser 保持为 Core 之上的独立环境层，本增量不依赖任何 Aurora 本地运行时包，也不实现具体插件。模块顶层不读取宿主；每个 `createBrowserEnvironment()` 实例独立捕获宿主能力、活动订阅和有界诊断，并通过原子注册与先逻辑停用再物理移除的方式保护宿主。Core 没有 Browser 环境注入公开端口，因此直接集成与 Core API 修改明确排除。

**Tech Stack:** Node.js `24.18.0`、pnpm `11.17.0`、TypeScript `6.0.3` strict/ESM、ESLint `10.8.0`、Vitest `4.1.10`、`@vitest/coverage-v8` `4.1.10`、Playwright `@playwright/test` `1.62.0`、Chromium。

## Global Constraints

- 只实施 `packages/browser` 的“浏览器环境能力与页面生命周期基础第一增量”；不创建错误、Promise、资源、请求、性能、行为或框架插件。
- 不修改 `packages/core` 或 `packages/event-schema` 的实现和公共 API；现有 `CorePluginContext` 只有 `submitEvent(input: unknown): CoreEventResult`。
- Core 不依赖 Browser；Browser 不依赖具体插件、React、Vue、应用或工具实现；Browser 对 Aurora 本地包的访问只能走公开包入口。
- `@aurora/browser` 本增量没有 Aurora 本地运行时依赖；不得访问任何包的 `src`、`internal`、测试目录或未导出子路径。
- 禁止循环依赖、全局可变单例、原生对象原型修改、宿主对象挂载状态和永久原生 API 替换。
- 不赋值或覆盖 `window.onerror`、`window.onunhandledrejection`、`fetch`、`XMLHttpRequest`、`history`、`history.pushState` 或 `history.replaceState`。
- 只监听 `visibilitychange`、`pagehide`、`pageshow`；不加入其他页面生命周期或路由事件。
- 所有公共函数和方法显式声明参数与返回类型；浏览器值先视为 `unknown`；禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、非空断言和双重类型断言。
- 文件名使用 `kebab-case`，类型/接口使用 `PascalCase`，函数/变量使用 `camelCase`，布尔名使用 `is`/`has`/`can`/`should` 前缀。
- 不创建 `utils`、`helpers`、`common`、`misc`、通用 Hook、通用事件总线、通用代理框架或未被本增量使用的配置系统。
- 内部错误不得逃逸或静默吞掉；诊断固定最多 100 条，且不包含异常文本、堆栈、Cookie、Token、Authorization、完整 URL 查询、User Agent、Storage、DOM 或用户输入。
- 页面 URL 只返回 HTTP(S) 的 `origin + pathname`，删除用户名、密码、查询和片段；非法或非 HTTP(S) 地址返回 `null`。
- 不修改调用方传入的监听函数或对象；所有公共返回对象、事件、句柄和诊断快照冻结。
- Browser 覆盖率门槛固定为 lines 85%、branches 80%、functions 85%、statements 85%；Chromium 测试不替代单元覆盖率。
- 不创建 CI、服务端、发布、容器、IaC 或云资源；Playwright 只安装 Chromium，不规划 Firefox/WebKit 矩阵。
- ADR-003、ADR-006 保持 `accepted / in-progress`，ADR-005 保持真实状态，ADR-007 保持 `accepted / implemented`；只追加真实实施证据。
- 执行前先复查 `git status --short --branch` 和 `git diff --cached --stat`，保护所有已有修改；没有用户授权时不执行 Git 提交命令。

---

## Authoritative Inputs

实施者在 Task 1 前完整读取：`CLAUDE.md`、`AGENTS.md`、`AURORA_RULES.md`、核心业务 PRD、六份 Aurora 长期规范、`docs/architecture/system-overview.md`、`docs/architecture/sdk-architecture.md`、`docs/architecture/monorepo-and-build.md`、`docs/sdk/sdk-core-foundation.md`、`docs/sdk/browser-environment-foundation.md`、`docs/protocol/event-schema-foundation.md`、`docs/testing/test-strategy.md`、`docs/architecture/formalization-readiness.md`、ADR-003/005/006/007、三个已完成实施计划，以及当前 `packages/core`、`packages/event-schema`、`tooling/workspace-policy`。只有 approved 文档和 accepted ADR 是正式依据。

## Final Public API

Task 4 完成后，`@aurora/browser` 根入口必须精确导出以下契约；任何增加或改名都先回读正式规格：

```ts
export const BrowserCapabilityName = Object.freeze({
  Window: 'window', Document: 'document', Navigator: 'navigator',
  Performance: 'performance', PageUrl: 'page_url', UserAgent: 'user_agent',
  Visibility: 'visibility', PageLifecycle: 'page_lifecycle',
} as const);
export type BrowserCapabilityName =
  (typeof BrowserCapabilityName)[keyof typeof BrowserCapabilityName];

export interface BrowserCapabilities {
  readonly isBrowserEnvironment: boolean;
  readonly hasWindow: boolean;
  readonly hasDocument: boolean;
  readonly hasNavigator: boolean;
  readonly hasPerformance: boolean;
  readonly canReadPageUrl: boolean;
  readonly canReadUserAgent: boolean;
  readonly canReadVisibility: boolean;
  readonly canObservePageLifecycle: boolean;
}

export const PageVisibilityState = Object.freeze({
  Visible: 'visible', Hidden: 'hidden', Unknown: 'unknown',
} as const);
export type PageVisibilityState =
  (typeof PageVisibilityState)[keyof typeof PageVisibilityState];
export interface BrowserClockSnapshot {
  readonly unixMilliseconds: number | null;
  readonly monotonicMilliseconds: number | null;
}
export interface BrowserPageSnapshot {
  readonly pageUrl: string | null;
  readonly userAgent: string | null;
  readonly visibilityState: PageVisibilityState;
  readonly clock: BrowserClockSnapshot;
}

export const PageLifecycleEventType = Object.freeze({
  VisibilityChange: 'visibility_change', PageHide: 'page_hide', PageShow: 'page_show',
} as const);
export type PageLifecycleEventType =
  (typeof PageLifecycleEventType)[keyof typeof PageLifecycleEventType];
export interface VisibilityChangeLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.VisibilityChange;
  readonly visibilityState: PageVisibilityState;
}
export interface PageHideLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.PageHide;
  readonly isPersisted: boolean | null;
}
export interface PageShowLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.PageShow;
  readonly isPersisted: boolean | null;
}
export type PageLifecycleEvent =
  | VisibilityChangeLifecycleEvent | PageHideLifecycleEvent | PageShowLifecycleEvent;
export type BrowserLifecycleListener = (event: PageLifecycleEvent) => void;

export const BrowserDiagnosticCode = Object.freeze({
  GlobalAccessFailed: 'global_access_failed', PropertyReadFailed: 'property_read_failed',
  ClockReadFailed: 'clock_read_failed',
  ListenerRegistrationFailed: 'listener_registration_failed',
  ListenerRemovalFailed: 'listener_removal_failed', CallbackFailed: 'callback_failed',
} as const);
export type BrowserDiagnosticCode =
  (typeof BrowserDiagnosticCode)[keyof typeof BrowserDiagnosticCode];
export const BrowserDiagnosticOperation = Object.freeze({
  Create: 'create', ReadCapabilities: 'read_capabilities', ReadSnapshot: 'read_snapshot',
  Subscribe: 'subscribe', Unsubscribe: 'unsubscribe', Destroy: 'destroy', Notify: 'notify',
} as const);
export type BrowserDiagnosticOperation =
  (typeof BrowserDiagnosticOperation)[keyof typeof BrowserDiagnosticOperation];
export interface BrowserDiagnostic {
  readonly sequence: number;
  readonly code: BrowserDiagnosticCode;
  readonly operation: BrowserDiagnosticOperation;
  readonly capability?: BrowserCapabilityName;
  readonly eventType?: PageLifecycleEventType;
}

export const BrowserSubscribeCode = Object.freeze({
  Subscribed: 'subscribed', InvalidListener: 'invalid_listener',
  EnvironmentUnavailable: 'environment_unavailable', Destroyed: 'destroyed',
  ListenerRegistrationFailed: 'listener_registration_failed',
} as const);
export type BrowserSubscribeFailureCode =
  | typeof BrowserSubscribeCode.InvalidListener
  | typeof BrowserSubscribeCode.EnvironmentUnavailable
  | typeof BrowserSubscribeCode.Destroyed
  | typeof BrowserSubscribeCode.ListenerRegistrationFailed;
export interface BrowserSubscribeSuccess {
  readonly ok: true;
  readonly code: typeof BrowserSubscribeCode.Subscribed;
  readonly subscription: BrowserSubscription;
  readonly diagnosticsAdded: number;
}
export interface BrowserSubscribeFailure {
  readonly ok: false;
  readonly code: BrowserSubscribeFailureCode;
  readonly diagnosticsAdded: number;
}
export type BrowserSubscribeResult = BrowserSubscribeSuccess | BrowserSubscribeFailure;

export const BrowserUnsubscribeCode = Object.freeze({
  Unsubscribed: 'unsubscribed', AlreadyUnsubscribed: 'already_unsubscribed',
} as const);
export interface BrowserUnsubscribeResult {
  readonly ok: true;
  readonly code:
    | typeof BrowserUnsubscribeCode.Unsubscribed
    | typeof BrowserUnsubscribeCode.AlreadyUnsubscribed;
  readonly diagnosticsAdded: number;
}
export interface BrowserSubscription { unsubscribe(): BrowserUnsubscribeResult; }

export const BrowserDestroyCode = Object.freeze({
  Destroyed: 'destroyed', AlreadyDestroyed: 'already_destroyed',
} as const);
export interface BrowserDestroyResult {
  readonly ok: true;
  readonly code:
    | typeof BrowserDestroyCode.Destroyed
    | typeof BrowserDestroyCode.AlreadyDestroyed;
  readonly diagnosticsAdded: number;
}
export interface BrowserEnvironment {
  getCapabilities(): BrowserCapabilities;
  readPageSnapshot(): BrowserPageSnapshot;
  subscribePageLifecycle(listener: BrowserLifecycleListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
  getDiagnostics(): readonly BrowserDiagnostic[];
}
export function createBrowserEnvironment(): BrowserEnvironment;
```

## Complete File Tree and Responsibilities

```text
packages/browser/
├── package.json                         # 私有包元数据、根出口与可重复命令
├── README.md                            # 模块职责、API、隐私、降级和命令
├── playwright.config.ts                # 仅 Chromium 的本地真实浏览器配置
├── tsconfig.build.json                 # 仅 src 的 ESM 声明构建
├── tsconfig.json                       # strict DOM + Node/Vitest 测试类型
├── vitest.config.ts                    # 单元覆盖率与 85/80/85/85 门槛
├── src/
│   ├── browser-environment.ts           # 实例编排、最终公共工厂
│   ├── capabilities.ts                  # 宿主捕获、能力快照和能力类型
│   ├── diagnostics.ts                   # 100 条实例级脱敏诊断
│   ├── index.ts                         # 唯一公开入口
│   ├── page-lifecycle.ts                # 事件转换、订阅、取消和销毁
│   ├── page-snapshot.ts                 # URL、UA、可见性和两类时钟
│   └── safe-access.ts                   # unknown 属性/方法的安全读取与调用
├── test/
│   ├── architecture-boundary.test.ts    # 实际包无本地运行时依赖和源边界
│   ├── capabilities.test.ts             # 环境组合与 getter 异常
│   ├── documentation-contract.test.ts   # README/架构/ADR 状态证据
│   ├── host-safety.test.ts              # 无宿主覆盖、异常和诊断脱敏
│   ├── import-safety.test.ts             # 非浏览器导入与创建安全
│   ├── multi-instance.test.ts            # 订阅/诊断/销毁实例隔离
│   ├── package-entry.test.ts             # 构建后根入口与私有路径拒绝
│   ├── page-lifecycle.test.ts            # 三事件、注册回滚、幂等释放
│   └── page-snapshot.test.ts             # URL/UA/可见性/时钟
└── test-browser/
    ├── browser-environment.spec.ts       # Chromium 宿主安全与生命周期行为
    └── fixture-server.ts                 # 只服务 dist 与固定测试页的临时 HTTP 服务
```

现有文件只按任务列出的精确目的修改；不得重排或清理用户的其他工作区变更。

---

### Task 1: Browser 包壳、根出口和单向依赖门禁

**Files:**
- Create: `packages/browser/package.json`
- Create: `packages/browser/tsconfig.json`
- Create: `packages/browser/tsconfig.build.json`
- Create: `packages/browser/vitest.config.ts`
- Create: `packages/browser/src/index.ts`
- Create: `packages/browser/test/architecture-boundary.test.ts`
- Create: `tooling/workspace-policy/test/browser-package-contract.test.ts`
- Modify: `tooling/workspace-policy/src/graph.ts`
- Modify: `tooling/workspace-policy/src/environment.ts`
- Modify: `tooling/workspace-policy/test/dependency-policy.test.ts`
- Modify: `tooling/workspace-policy/test/environment.test.ts`
- Modify: `eslint.config.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Workspace manifest contract、`aurora.layer`、公开导出检查、循环检查、根 TypeScript/ESLint/Vitest 版本。
- Produces: 私有零运行时依赖包 `@aurora/browser`、层名 `sdk-browser`、只允许指向 `sdk-core | protocol` 的依赖规则、Browser 与 Core 的模块级可变状态负例检查。

- [ ] **Step 1: 复查工作区并写失败的包与依赖策略测试**

Run first:

```bash
git status --short --branch
git diff --cached --stat
```

Expected: 输出当前分支与既有 tracked/untracked 修改；暂存区保持执行前真实状态。不得运行清理或暂存命令。

Create `tooling/workspace-policy/test/browser-package-contract.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('browser package contract', () => {
  it('is private, root-only, sdk-browser layered, and has no runtime dependencies', async () => {
    const text = await readFile(
      new URL('../../../packages/browser/package.json', import.meta.url),
      'utf8',
    );
    const manifest: unknown = JSON.parse(text);
    if (!isRecord(manifest)) throw new TypeError('browser package.json must be an object');
    expect(manifest).toMatchObject({
      name: '@aurora/browser', version: '0.0.0', private: true, type: 'module',
      sideEffects: false, exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      aurora: { layer: 'sdk-browser' },
    });
    expect(manifest.dependencies).toBeUndefined();
  });
});
```

Append to `dependency-policy.test.ts`:

```ts
it.each(['sdk-core', 'protocol'] as const)('allows sdk-browser to depend on %s', async (layer) => {
  const browser = validManifest('@aurora/browser');
  browser.aurora = { layer: 'sdk-browser' };
  browser.dependencies = { '@aurora/target': 'workspace:*' };
  const target = validManifest('@aurora/target');
  target.aurora = { layer };
  fixture = await createWorkspaceFixture([
    { directory: 'packages/browser', manifest: browser },
    { directory: 'packages/target', manifest: target },
  ]);
  await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({ ok: true, violations: [] });
});

it('allows the Core root but rejects a Browser import from Core src', async () => {
  const browser = validManifest('@aurora/browser');
  browser.aurora = { layer: 'sdk-browser' };
  browser.dependencies = { '@aurora/core': 'workspace:*' };
  const core = validManifest('@aurora/core');
  core.aurora = { layer: 'sdk-core' };
  fixture = await createWorkspaceFixture([
    {
      directory: 'packages/browser',
      manifest: browser,
      files: {
        'src/index.ts': [
          "import type { AuroraCore } from '@aurora/core';",
          "import type { CorePlugin } from '@aurora/core/src/plugin-contract.js';",
          'export type PublicCore = AuroraCore;',
          'export type PrivateCore = CorePlugin;',
          '',
        ].join('\n'),
      },
    },
    { directory: 'packages/core', manifest: core },
  ]);
  const result = await checkWorkspace(fixture.rootDir);
  expect(result.violations).toMatchObject([
    {
      code: 'private-path-import',
      dependency: '@aurora/core/src/plugin-contract.js',
      packageName: '@aurora/browser',
    },
  ]);
});

it.each(['sdk-browser', 'sdk-plugin', 'framework', 'tooling'] as const)(
  'rejects sdk-browser dependency on %s',
  async (layer) => {
    const browser = validManifest('@aurora/browser');
    browser.aurora = { layer: 'sdk-browser' };
    browser.dependencies = { '@aurora/target': 'workspace:*' };
    const target = validManifest('@aurora/target');
    target.aurora = { layer };
    fixture = await createWorkspaceFixture([
      { directory: 'packages/browser', manifest: browser },
      { directory: 'packages/target', manifest: target },
    ]);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'forbidden-layer-dependency', packageName: '@aurora/browser' }),
    ]));
  },
);
```

Add a `createBrowserSource` fixture and this case to `environment.test.ts`:

```ts
async function createBrowserSource(source: string): Promise<WorkspaceFixture> {
  const browser = validManifest('@aurora/browser');
  browser.aurora = { layer: 'sdk-browser' };
  return createWorkspaceFixture([
    { directory: 'packages/browser', manifest: browser, files: { 'src/index.ts': source } },
  ]);
}

it.each([
  'let shared = 0; export function read(): number { return shared; }',
  'const shared = new Set<string>(); export function read(): number { return shared.size; }',
  'const shared: string[] = []; export function read(): number { return shared.length; }',
])('rejects sdk-browser module-level mutable state', async (source) => {
  fixture = await createBrowserSource(source);
  const result = await checkWorkspace(fixture.rootDir);
  expect(result.violations).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'mutable-module-state' })]),
  );
});
```

- [ ] **Step 2: 运行失败测试并确认失败原因准确**

Run:

```bash
pnpm --filter @aurora/workspace-policy exec vitest run test/browser-package-contract.test.ts test/dependency-policy.test.ts test/environment.test.ts
```

Expected: exit `1`；包契约因 `packages/browser/package.json` 不存在失败，层测试因 `sdk-browser` 尚未加入矩阵失败，Browser 可变状态夹具因策略尚未扫描该层失败。不得通过放宽断言恢复测试。

- [ ] **Step 3: 写最小包壳和策略实现**

Create `packages/browser/package.json`:

```json
{
  "name": "@aurora/browser",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Aurora browser environment and page lifecycle foundation",
  "sideEffects": false,
  "engines": { "node": ">=24.18.0 <25" },
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --exclude test/package-entry.test.ts",
    "test:coverage": "vitest run --coverage --exclude test/package-entry.test.ts",
    "test:package": "pnpm build && vitest run test/package-entry.test.ts"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "@vitest/coverage-v8": "4.1.10",
    "typescript": "6.0.3",
    "vitest": "4.1.10"
  },
  "aurora": { "layer": "sdk-browser" }
}
```

Create configs:

```json
// packages/browser/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "test-browser/**/*.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

```json
// packages/browser/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true, "declarationMap": true, "noEmit": false,
    "outDir": "dist", "rootDir": "src", "sourceMap": true, "types": []
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test/**/*.ts", "test-browser/**/*.ts"]
}
```

```ts
// packages/browser/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8', include: ['src/**/*.ts'], reporter: ['text', 'json-summary'],
      thresholds: { branches: 80, functions: 85, lines: 85, statements: 85 },
    },
    environment: 'node', include: ['test/**/*.test.ts'],
  },
});
```

Create `packages/browser/src/index.ts` as an intentionally empty root for this structural increment:

```ts
export {};
```

Create `packages/browser/test/architecture-boundary.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Browser architecture boundary', () => {
  it('declares no Aurora runtime dependency and has one root export', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest).toMatchObject({
      dependencies: undefined,
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      aurora: { layer: 'sdk-browser' },
    });
  });
});
```

In `graph.ts`, extend the exact matrix:

```ts
const allowedLocalDependencyLayers: ReadonlyMap<string, ReadonlySet<string>> = new Map<
  string,
  ReadonlySet<string>
>([
  ['protocol', new Set<string>()],
  ['sdk-core', new Set<string>(['protocol'])],
  ['sdk-browser', new Set<string>(['sdk-core', 'protocol'])],
]);
```

In `environment.ts`, make module-state scanning apply to both SDK layers while Core alone keeps the browser-global ban:

```ts
function inspectSource(
  workspacePackage: WorkspacePackage,
  file: string,
  sourceText: string,
  layer: 'sdk-core' | 'sdk-browser',
): readonly WorkspaceViolation[] {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const violations: WorkspaceViolation[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const hasMutableContainer = statement.declarationList.declarations.some((declaration) =>
      isMutableInitializer(declaration.initializer),
    );
    if (!isConst || hasMutableContainer) violations.push({
      code: 'mutable-module-state',
      packageName: workspacePackage.name,
      file: relative(workspacePackage.directory, file).replaceAll('\\', '/'),
      message: `${layer} source must not declare module-level mutable state`,
    });
  }
  function visit(node: ts.Node): void {
    if (layer === 'sdk-core') {
      const forbiddenName = ts.isIdentifier(node)
        ? node.text
        : ts.isStringLiteralLike(node) && ts.isElementAccessExpression(node.parent)
          && node.parent.argumentExpression === node ? node.text : undefined;
      if (forbiddenName !== undefined && forbiddenCoreIdentifiers.has(forbiddenName)) {
        violations.push({
          code: 'forbidden-runtime-global', packageName: workspacePackage.name,
          file: relative(workspacePackage.directory, file).replaceAll('\\', '/'),
          message: `sdk-core source must not reference ${forbiddenName}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

export async function findEnvironmentViolations(
  workspacePackage: WorkspacePackage,
): Promise<readonly WorkspaceViolation[]> {
  const layer = packageLayer(workspacePackage);
  if (layer !== 'sdk-core' && layer !== 'sdk-browser') return [];
  const sourceDirectory = join(workspacePackage.directory, 'src');
  const files = await findTypeScriptSourceFiles(sourceDirectory);
  const groups = await Promise.all(
    files.map(async (file) =>
      inspectSource(workspacePackage, file, await readFile(file, 'utf8'), layer),
    ),
  );
  return groups.flat();
}
```

Add `packages/browser/**/*.ts` to the typed ESLint file list. Add Browser paths to root `format:check` and `lint`; do not yet add Browser coverage or Chromium to the root aggregate gate.

- [ ] **Step 4: 更新锁文件但不安装浏览器二进制**

Run:

```bash
pnpm install --lockfile-only
```

Expected: exit `0`；`pnpm-lock.yaml` 增加 `packages/browser` importer，未下载 Chromium，未创建 CI 或发布文件。

- [ ] **Step 5: 确认通过并运行相关回归**

Run:

```bash
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/browser test
pnpm --filter @aurora/browser build
pnpm --filter @aurora/workspace-policy test
pnpm check:boundaries
pnpm --filter @aurora/core typecheck
```

Expected: all exit `0`；Browser 结构测试 `1 passed`，Workspace Policy 新旧测试全通过，Core no-DOM typecheck 仍通过。

- [ ] **Step 6: 记录建议提交边界**

建议提交信息：`build(browser): scaffold browser environment package and boundaries`。只有执行会话另有 Git 授权时才暂存 Task 1 列出的文件并提交；否则仅在实施报告中列出该边界。

---

### Task 2: 安全全局访问、能力探测与有界诊断

**Files:**
- Create: `packages/browser/src/safe-access.ts`
- Create: `packages/browser/src/diagnostics.ts`
- Create: `packages/browser/src/capabilities.ts`
- Create: `packages/browser/src/page-lifecycle.ts`
- Create: `packages/browser/test/import-safety.test.ts`
- Create: `packages/browser/test/capabilities.test.ts`
- Modify: `packages/browser/src/index.ts`

**Interfaces:**
- Consumes: `globalThis`、`Reflect.get`、`Reflect.apply`、Task 1 的 strict DOM 配置和模块状态门禁。
- Produces: `SafeAccessResult<T>`、`BrowserHostContext`、`createDiagnosticStore()`、`captureBrowserHost()`、`detectBrowserCapabilities()`，以及公共 `BrowserCapabilityName`、`BrowserCapabilities`、诊断常量/类型。

- [ ] **Step 1: 写失败的导入安全与能力测试**

Create `test/import-safety.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('Browser import safety', () => {
  it('imports in Node without window or document', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    await expect(import('../src/index.js')).resolves.toBeDefined();
  });
});
```

Create `test/capabilities.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureBrowserHost, detectBrowserCapabilities } from '../src/capabilities.js';
import { BrowserDiagnosticCode, createDiagnosticStore } from '../src/diagnostics.js';

afterEach(() => vi.unstubAllGlobals());

function eventTargetLike(): object {
  return { addEventListener: (): void => undefined, removeEventListener: (): void => undefined };
}

describe('browser capability detection', () => {
  it('degrades each missing global independently', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('performance', undefined);
    const diagnostics = createDiagnosticStore();
    const capabilities = detectBrowserCapabilities(captureBrowserHost(diagnostics), diagnostics);
    expect(capabilities).toEqual({
      isBrowserEnvironment: false, hasWindow: false, hasDocument: false,
      hasNavigator: false, hasPerformance: false, canReadPageUrl: false,
      canReadUserAgent: false, canReadVisibility: false, canObservePageLifecycle: false,
    });
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(diagnostics.getDiagnostics()).toEqual([]);
  });

  it('reports usable capabilities without exposing host objects', () => {
    vi.stubGlobal('window', { ...eventTargetLike(), location: { href: 'https://example.test/a?x=1' } });
    vi.stubGlobal('document', { ...eventTargetLike(), visibilityState: 'visible' });
    vi.stubGlobal('navigator', { userAgent: 'synthetic-agent' });
    vi.stubGlobal('performance', { now: (): number => 12.5 });
    const diagnostics = createDiagnosticStore();
    expect(detectBrowserCapabilities(captureBrowserHost(diagnostics), diagnostics)).toEqual({
      isBrowserEnvironment: true, hasWindow: true, hasDocument: true,
      hasNavigator: true, hasPerformance: true, canReadPageUrl: true,
      canReadUserAgent: true, canReadVisibility: true, canObservePageLifecycle: true,
    });
  });

  it('contains a throwing global getter and stores no exception text', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      get(): never { throw new Error('token=must-not-leak'); },
    });
    try {
      const diagnostics = createDiagnosticStore();
      const host = captureBrowserHost(diagnostics);
      expect(host.windowTarget).toBeUndefined();
      expect(diagnostics.getDiagnostics()).toMatchObject([
        { sequence: 1, code: BrowserDiagnosticCode.GlobalAccessFailed, operation: 'create', capability: 'window' },
      ]);
      expect(JSON.stringify(diagnostics.getDiagnostics())).not.toContain('must-not-leak');
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', descriptor);
    }
  });

  it('contains throwing listener method getters', () => {
    const throwingTarget = Object.create(null, {
      addEventListener: { get(): never { throw new Error('listener-secret'); } },
      removeEventListener: { value: (): void => undefined },
    });
    vi.stubGlobal('window', {
      location: { href: 'https://example.test/' },
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    });
    vi.stubGlobal('document', throwingTarget);
    const diagnostics = createDiagnosticStore();
    const capabilities = detectBrowserCapabilities(captureBrowserHost(diagnostics), diagnostics);
    expect(capabilities.canObservePageLifecycle).toBe(false);
    expect(diagnostics.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'property_read_failed', operation: 'read_capabilities', capability: 'page_lifecycle',
      }),
    ]));
    expect(JSON.stringify(diagnostics.getDiagnostics())).not.toContain('listener-secret');
  });
});
```

- [ ] **Step 2: 运行测试并确认缺失导出失败**

Run:

```bash
pnpm --filter @aurora/browser exec vitest run test/import-safety.test.ts test/capabilities.test.ts
```

Expected: exit `1` with unresolved `../src/capabilities.js` / `../src/diagnostics.js` or missing exported members。

- [ ] **Step 3: 实现 unknown 安全访问与诊断存储**

Create `src/safe-access.ts`:

```ts
export type SafeAccessFailureReason = 'unavailable' | 'threw';
export interface SafeAccessSuccess<T> { readonly ok: true; readonly value: T; }
export interface SafeAccessFailure { readonly ok: false; readonly reason: SafeAccessFailureReason; }
export type SafeAccessResult<T> = SafeAccessSuccess<T> | SafeAccessFailure;
export type UnknownCallable = (...args: unknown[]) => unknown;

export function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export function readProperty(target: unknown, key: PropertyKey): SafeAccessResult<unknown> {
  if (!isObjectLike(target)) return { ok: false, reason: 'unavailable' };
  try { return { ok: true, value: Reflect.get(target, key) }; }
  catch { return { ok: false, reason: 'threw' }; }
}

export function readMethod(target: unknown, key: PropertyKey): SafeAccessResult<UnknownCallable> {
  const result = readProperty(target, key);
  if (!result.ok || typeof result.value !== 'function') {
    return { ok: false, reason: result.ok ? 'unavailable' : result.reason };
  }
  return { ok: true, value: result.value };
}

export function callMethod(
  method: UnknownCallable,
  receiver: unknown,
  args: readonly unknown[],
): SafeAccessResult<unknown> {
  try { return { ok: true, value: Reflect.apply(method, receiver, args) }; }
  catch { return { ok: false, reason: 'threw' }; }
}

export function sanitizePageUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.origin}${parsed.pathname}`;
  } catch { return null; }
}
```

Create `src/diagnostics.ts`:

```ts
import type { BrowserCapabilityName } from './capabilities.js';
import type { PageLifecycleEventType } from './page-lifecycle.js';

const MAX_DIAGNOSTICS = 100;
export const BrowserDiagnosticCode = Object.freeze({
  GlobalAccessFailed: 'global_access_failed', PropertyReadFailed: 'property_read_failed',
  ClockReadFailed: 'clock_read_failed',
  ListenerRegistrationFailed: 'listener_registration_failed',
  ListenerRemovalFailed: 'listener_removal_failed', CallbackFailed: 'callback_failed',
} as const);
export type BrowserDiagnosticCode =
  (typeof BrowserDiagnosticCode)[keyof typeof BrowserDiagnosticCode];
export const BrowserDiagnosticOperation = Object.freeze({
  Create: 'create', ReadCapabilities: 'read_capabilities', ReadSnapshot: 'read_snapshot',
  Subscribe: 'subscribe', Unsubscribe: 'unsubscribe', Destroy: 'destroy', Notify: 'notify',
} as const);
export type BrowserDiagnosticOperation =
  (typeof BrowserDiagnosticOperation)[keyof typeof BrowserDiagnosticOperation];
export interface BrowserDiagnostic {
  readonly sequence: number; readonly code: BrowserDiagnosticCode;
  readonly operation: BrowserDiagnosticOperation; readonly capability?: BrowserCapabilityName;
  readonly eventType?: PageLifecycleEventType;
}
export interface BrowserDiagnosticInput {
  readonly code: BrowserDiagnosticCode; readonly operation: BrowserDiagnosticOperation;
  readonly capability?: BrowserCapabilityName; readonly eventType?: PageLifecycleEventType;
}
export interface BrowserDiagnosticStore {
  append(input: BrowserDiagnosticInput): void;
  getDiagnostics(): readonly BrowserDiagnostic[];
  getTotalCount(): number;
}

export function createDiagnosticStore(): BrowserDiagnosticStore {
  const entries: BrowserDiagnostic[] = [];
  let nextSequence = 1;
  return Object.freeze({
    append(input: BrowserDiagnosticInput): void {
      const entry: BrowserDiagnostic = Object.freeze({ sequence: nextSequence, ...input });
      nextSequence += 1;
      entries.push(entry);
      if (entries.length > MAX_DIAGNOSTICS) entries.shift();
    },
    getDiagnostics(): readonly BrowserDiagnostic[] { return Object.freeze([...entries]); },
    getTotalCount(): number { return nextSequence - 1; },
  });
}
```

Create `src/page-lifecycle.ts` with the stable event discriminants needed by diagnostics; Task 4 adds resource behavior to this same file:

```ts
export const PageLifecycleEventType = Object.freeze({
  VisibilityChange: 'visibility_change', PageHide: 'page_hide', PageShow: 'page_show',
} as const);
export type PageLifecycleEventType =
  (typeof PageLifecycleEventType)[keyof typeof PageLifecycleEventType];
```

- [ ] **Step 4: 实现能力捕获和探测**

Create `src/capabilities.ts`:

```ts
import {
  BrowserDiagnosticCode, BrowserDiagnosticOperation, type BrowserDiagnosticStore,
} from './diagnostics.js';
import { isObjectLike, readMethod, readProperty, sanitizePageUrl } from './safe-access.js';

export const BrowserCapabilityName = Object.freeze({
  Window: 'window', Document: 'document', Navigator: 'navigator',
  Performance: 'performance', PageUrl: 'page_url', UserAgent: 'user_agent',
  Visibility: 'visibility', PageLifecycle: 'page_lifecycle',
} as const);
export type BrowserCapabilityName =
  (typeof BrowserCapabilityName)[keyof typeof BrowserCapabilityName];
export interface BrowserCapabilities {
  readonly isBrowserEnvironment: boolean; readonly hasWindow: boolean;
  readonly hasDocument: boolean; readonly hasNavigator: boolean;
  readonly hasPerformance: boolean; readonly canReadPageUrl: boolean;
  readonly canReadUserAgent: boolean; readonly canReadVisibility: boolean;
  readonly canObservePageLifecycle: boolean;
}
export interface BrowserHostContext {
  readonly windowTarget: unknown; readonly documentTarget: unknown;
  readonly navigatorTarget: unknown; readonly performanceTarget: unknown;
}

function readGlobal(
  key: 'window' | 'document' | 'navigator' | 'performance',
  capability: BrowserCapabilityName,
  diagnostics: BrowserDiagnosticStore,
): unknown {
  const result = readProperty(globalThis, key);
  if (!result.ok && result.reason === 'threw') diagnostics.append({
    code: BrowserDiagnosticCode.GlobalAccessFailed,
    operation: BrowserDiagnosticOperation.Create,
    capability,
  });
  return result.ok ? result.value : undefined;
}

export function captureBrowserHost(diagnostics: BrowserDiagnosticStore): BrowserHostContext {
  return Object.freeze({
    windowTarget: readGlobal('window', BrowserCapabilityName.Window, diagnostics),
    documentTarget: readGlobal('document', BrowserCapabilityName.Document, diagnostics),
    navigatorTarget: readGlobal('navigator', BrowserCapabilityName.Navigator, diagnostics),
    performanceTarget: readGlobal('performance', BrowserCapabilityName.Performance, diagnostics),
  });
}

function hasListenerPair(target: unknown, diagnostics: BrowserDiagnosticStore): boolean {
  const add = readMethod(target, 'addEventListener');
  const remove = readMethod(target, 'removeEventListener');
  for (const result of [add, remove]) {
    if (!result.ok && result.reason === 'threw') diagnostics.append({
      code: BrowserDiagnosticCode.PropertyReadFailed,
      operation: BrowserDiagnosticOperation.ReadCapabilities,
      capability: BrowserCapabilityName.PageLifecycle,
    });
  }
  return add.ok && remove.ok;
}

export function detectBrowserCapabilities(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): BrowserCapabilities {
  const location = readProperty(host.windowTarget, 'location');
  const href = location.ok ? readProperty(location.value, 'href') : location;
  const userAgent = readProperty(host.navigatorTarget, 'userAgent');
  const visibility = readProperty(host.documentTarget, 'visibilityState');
  for (const [result, capability] of [
    [href, BrowserCapabilityName.PageUrl],
    [userAgent, BrowserCapabilityName.UserAgent],
    [visibility, BrowserCapabilityName.Visibility],
  ] as const) {
    if (!result.ok && result.reason === 'threw') diagnostics.append({
      code: BrowserDiagnosticCode.PropertyReadFailed,
      operation: BrowserDiagnosticOperation.ReadCapabilities,
      capability,
    });
  }
  const hasWindow = isObjectLike(host.windowTarget);
  const hasDocument = isObjectLike(host.documentTarget);
  const hasNavigator = isObjectLike(host.navigatorTarget);
  const hasPerformance = isObjectLike(host.performanceTarget);
  return Object.freeze({
    isBrowserEnvironment: hasWindow && hasDocument,
    hasWindow, hasDocument, hasNavigator, hasPerformance,
    canReadPageUrl: href.ok && sanitizePageUrl(href.value) !== null,
    canReadUserAgent: userAgent.ok && typeof userAgent.value === 'string' && userAgent.value.length > 0,
    canReadVisibility: visibility.ok && typeof visibility.value === 'string',
    canObservePageLifecycle:
      hasListenerPair(host.windowTarget, diagnostics)
      && hasListenerPair(host.documentTarget, diagnostics),
  });
}
```

Replace `src/index.ts` for this increment with:

```ts
export { BrowserCapabilityName, type BrowserCapabilities } from './capabilities.js';
export {
  BrowserDiagnosticCode,
  BrowserDiagnosticOperation,
  type BrowserDiagnostic,
} from './diagnostics.js';
export { PageLifecycleEventType } from './page-lifecycle.js';
```

Do not export `BrowserHostContext`, the diagnostic store, or safe-access functions.

- [ ] **Step 5: 确认通过并运行 Task 级回归**

Run:

```bash
pnpm --filter @aurora/browser exec vitest run test/import-safety.test.ts test/capabilities.test.ts
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/browser test
pnpm check:boundaries
```

Expected: all exit `0`；能力测试覆盖四个缺失全局、正常能力和 getter 抛错；诊断序列化不含 `must-not-leak`。

- [ ] **Step 6: 记录建议提交边界**

建议提交信息：`feat(browser): add safe capability detection`。仅在执行会话获得 Git 授权时提交 Task 2 文件。

---

### Task 3: 脱敏页面快照、可见性与双时钟

**Files:**
- Create: `packages/browser/src/page-snapshot.ts`
- Create: `packages/browser/test/page-snapshot.test.ts`
- Modify: `packages/browser/src/index.ts`

**Interfaces:**
- Consumes: `BrowserHostContext`、`BrowserDiagnosticStore`、`readProperty()`、`readMethod()`、`callMethod()`、`sanitizePageUrl()`。
- Produces: `PageVisibilityState`、`BrowserClockSnapshot`、`BrowserPageSnapshot`、内部 `readVisibilityState()` 与 `readPageSnapshot()`。

- [ ] **Step 1: 写失败的 URL、UA、可见性和时钟测试**

Create `test/page-snapshot.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureBrowserHost } from '../src/capabilities.js';
import { createDiagnosticStore } from '../src/diagnostics.js';
import { PageVisibilityState, readPageSnapshot } from '../src/page-snapshot.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function installHost(input: {
  readonly href?: unknown; readonly userAgent?: unknown;
  readonly visibilityState?: unknown; readonly performanceNow?: () => unknown;
}): void {
  vi.stubGlobal('window', { location: { href: input.href } });
  vi.stubGlobal('document', { visibilityState: input.visibilityState });
  vi.stubGlobal('navigator', { userAgent: input.userAgent });
  vi.stubGlobal('performance', { now: input.performanceNow });
}

describe('page snapshot', () => {
  it('strips credentials, query, and fragment while reading all normal values', () => {
    installHost({
      href: 'https://user:secret@example.test:8443/orders/42?token=private#detail',
      userAgent: 'synthetic-agent', visibilityState: 'visible', performanceNow: () => 12.5,
    });
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const diagnostics = createDiagnosticStore();
    const snapshot = readPageSnapshot(captureBrowserHost(diagnostics), diagnostics);
    expect(snapshot).toEqual({
      pageUrl: 'https://example.test:8443/orders/42',
      userAgent: 'synthetic-agent',
      visibilityState: PageVisibilityState.Visible,
      clock: { unixMilliseconds: 1_800_000_000_000, monotonicMilliseconds: 12.5 },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.clock)).toBe(true);
    expect(JSON.stringify(diagnostics.getDiagnostics())).not.toContain('private');
  });

  it.each([
    ['hidden', PageVisibilityState.Hidden],
    ['prerender', PageVisibilityState.Unknown],
    [undefined, PageVisibilityState.Unknown],
  ] as const)('maps visibility %s to %s', (value, expected) => {
    installHost({ href: 'https://example.test/', userAgent: '', visibilityState: value });
    const diagnostics = createDiagnosticStore();
    expect(readPageSnapshot(captureBrowserHost(diagnostics), diagnostics).visibilityState).toBe(expected);
  });

  it.each(['mailto:user@example.test', 'not a url', '', undefined])(
    'returns null for unsupported or invalid URL %s',
    (href) => {
      installHost({ href, userAgent: undefined, visibilityState: undefined });
      const diagnostics = createDiagnosticStore();
      const snapshot = readPageSnapshot(captureBrowserHost(diagnostics), diagnostics);
      expect(snapshot.pageUrl).toBeNull();
      expect(snapshot.userAgent).toBeNull();
    },
  );

  it('isolates independent wall-clock and performance failures', () => {
    installHost({
      href: 'https://example.test/', userAgent: 'agent', visibilityState: 'hidden',
      performanceNow: (): never => { throw new Error('performance-secret'); },
    });
    vi.spyOn(Date, 'now').mockImplementation((): never => { throw new Error('date-secret'); });
    const diagnostics = createDiagnosticStore();
    const snapshot = readPageSnapshot(captureBrowserHost(diagnostics), diagnostics);
    expect(snapshot.clock).toEqual({ unixMilliseconds: null, monotonicMilliseconds: null });
    expect(diagnostics.getDiagnostics().filter(({ code }) => code === 'clock_read_failed')).toHaveLength(2);
    expect(JSON.stringify(diagnostics.getDiagnostics())).not.toContain('secret');
  });

  it('contains throwing page getters', () => {
    const throwing = Object.create(null, {
      href: { get(): never { throw new Error('query=secret'); } },
    });
    vi.stubGlobal('window', { location: throwing });
    vi.stubGlobal('document', Object.create(null, {
      visibilityState: { get(): never { throw new Error('form-value'); } },
    }));
    vi.stubGlobal('navigator', Object.create(null, {
      userAgent: { get(): never { throw new Error('agent-secret'); } },
    }));
    vi.stubGlobal('performance', undefined);
    const diagnostics = createDiagnosticStore();
    const snapshot = readPageSnapshot(captureBrowserHost(diagnostics), diagnostics);
    expect(snapshot).toMatchObject({ pageUrl: null, userAgent: null, visibilityState: 'unknown' });
    expect(JSON.stringify(diagnostics.getDiagnostics())).not.toMatch(/secret|form-value/);
  });
});
```

- [ ] **Step 2: 运行测试并确认模块缺失失败**

Run:

```bash
pnpm --filter @aurora/browser exec vitest run test/page-snapshot.test.ts
```

Expected: exit `1` with unresolved `../src/page-snapshot.js`。

- [ ] **Step 3: 写页面快照最小实现**

Create `src/page-snapshot.ts`:

```ts
import { BrowserCapabilityName, type BrowserHostContext } from './capabilities.js';
import {
  BrowserDiagnosticCode, BrowserDiagnosticOperation, type BrowserDiagnosticStore,
} from './diagnostics.js';
import { callMethod, readMethod, readProperty, sanitizePageUrl } from './safe-access.js';

export const PageVisibilityState = Object.freeze({
  Visible: 'visible', Hidden: 'hidden', Unknown: 'unknown',
} as const);
export type PageVisibilityState =
  (typeof PageVisibilityState)[keyof typeof PageVisibilityState];
export interface BrowserClockSnapshot {
  readonly unixMilliseconds: number | null;
  readonly monotonicMilliseconds: number | null;
}
export interface BrowserPageSnapshot {
  readonly pageUrl: string | null; readonly userAgent: string | null;
  readonly visibilityState: PageVisibilityState; readonly clock: BrowserClockSnapshot;
}

function reportPropertyFailure(
  hasThrown: boolean,
  capability: typeof BrowserCapabilityName.PageUrl
    | typeof BrowserCapabilityName.UserAgent
    | typeof BrowserCapabilityName.Visibility,
  diagnostics: BrowserDiagnosticStore,
  operation: typeof BrowserDiagnosticOperation.ReadSnapshot | typeof BrowserDiagnosticOperation.Notify,
): void {
  if (hasThrown) diagnostics.append({
    code: BrowserDiagnosticCode.PropertyReadFailed, operation, capability,
  });
}

function readPageUrl(host: BrowserHostContext, diagnostics: BrowserDiagnosticStore): string | null {
  const location = readProperty(host.windowTarget, 'location');
  const href = location.ok ? readProperty(location.value, 'href') : location;
  reportPropertyFailure(!href.ok && href.reason === 'threw', BrowserCapabilityName.PageUrl,
    diagnostics, BrowserDiagnosticOperation.ReadSnapshot);
  if (!href.ok) return null;
  const sanitized = sanitizePageUrl(href.value);
  if (sanitized === null && typeof href.value === 'string' && href.value.length > 0) {
    diagnostics.append({
      code: BrowserDiagnosticCode.PropertyReadFailed,
      operation: BrowserDiagnosticOperation.ReadSnapshot,
      capability: BrowserCapabilityName.PageUrl,
    });
  }
  return sanitized;
}

function readUserAgent(host: BrowserHostContext, diagnostics: BrowserDiagnosticStore): string | null {
  const result = readProperty(host.navigatorTarget, 'userAgent');
  reportPropertyFailure(!result.ok && result.reason === 'threw', BrowserCapabilityName.UserAgent,
    diagnostics, BrowserDiagnosticOperation.ReadSnapshot);
  return result.ok && typeof result.value === 'string' && result.value.length > 0
    ? result.value : null;
}

export function readVisibilityState(
  documentTarget: unknown,
  diagnostics: BrowserDiagnosticStore,
  operation: typeof BrowserDiagnosticOperation.ReadSnapshot | typeof BrowserDiagnosticOperation.Notify,
): PageVisibilityState {
  const result = readProperty(documentTarget, 'visibilityState');
  reportPropertyFailure(!result.ok && result.reason === 'threw', BrowserCapabilityName.Visibility,
    diagnostics, operation);
  if (!result.ok) return PageVisibilityState.Unknown;
  if (result.value === 'visible') return PageVisibilityState.Visible;
  if (result.value === 'hidden') return PageVisibilityState.Hidden;
  return PageVisibilityState.Unknown;
}

function readUnixMilliseconds(diagnostics: BrowserDiagnosticStore): number | null {
  try {
    const value = Date.now();
    if (Number.isSafeInteger(value)) return value;
  } catch { /* represented below */ }
  diagnostics.append({
    code: BrowserDiagnosticCode.ClockReadFailed,
    operation: BrowserDiagnosticOperation.ReadSnapshot,
  });
  return null;
}

function readMonotonicMilliseconds(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): number | null {
  const method = readMethod(host.performanceTarget, 'now');
  if (!method.ok) {
    if (method.reason === 'threw') diagnostics.append({
      code: BrowserDiagnosticCode.ClockReadFailed,
      operation: BrowserDiagnosticOperation.ReadSnapshot,
      capability: BrowserCapabilityName.Performance,
    });
    return null;
  }
  const result = callMethod(method.value, host.performanceTarget, []);
  if (result.ok && typeof result.value === 'number'
      && Number.isFinite(result.value) && result.value >= 0) return result.value;
  diagnostics.append({
    code: BrowserDiagnosticCode.ClockReadFailed,
    operation: BrowserDiagnosticOperation.ReadSnapshot,
    capability: BrowserCapabilityName.Performance,
  });
  return null;
}

export function readPageSnapshot(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): BrowserPageSnapshot {
  const clock: BrowserClockSnapshot = Object.freeze({
    unixMilliseconds: readUnixMilliseconds(diagnostics),
    monotonicMilliseconds: readMonotonicMilliseconds(host, diagnostics),
  });
  return Object.freeze({
    pageUrl: readPageUrl(host, diagnostics),
    userAgent: readUserAgent(host, diagnostics),
    visibilityState: readVisibilityState(
      host.documentTarget, diagnostics, BrowserDiagnosticOperation.ReadSnapshot,
    ),
    clock,
  });
}
```

The comment `/* represented below */` is a narrow explanation for the immediately following diagnostic and is not a silent catch. Export only the public snapshot constants/types from `src/index.ts`; keep `readPageSnapshot` and `readVisibilityState` internal.

- [ ] **Step 4: 确认通过并补充非法数值分支**

Append this exact test:

```ts
it.each([
  { unix: Number.NaN, monotonic: 1, expected: { unixMilliseconds: null, monotonicMilliseconds: 1 } },
  { unix: Number.MAX_VALUE, monotonic: 1, expected: { unixMilliseconds: null, monotonicMilliseconds: 1 } },
  { unix: 1_800_000_000_000, monotonic: -1, expected: { unixMilliseconds: 1_800_000_000_000, monotonicMilliseconds: null } },
  { unix: 1_800_000_000_000, monotonic: Infinity, expected: { unixMilliseconds: 1_800_000_000_000, monotonicMilliseconds: null } },
])('rejects invalid clock values %#', ({ unix, monotonic, expected }) => {
  installHost({
    href: 'https://example.test/', userAgent: 'agent', visibilityState: 'visible',
    performanceNow: () => monotonic,
  });
  vi.spyOn(Date, 'now').mockReturnValue(unix);
  const diagnostics = createDiagnosticStore();
  expect(readPageSnapshot(captureBrowserHost(diagnostics), diagnostics).clock).toEqual(expected);
  expect(diagnostics.getDiagnostics().filter(({ code }) => code === 'clock_read_failed')).toHaveLength(1);
});
```

Run:

```bash
pnpm --filter @aurora/browser exec vitest run test/page-snapshot.test.ts
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/browser test
```

Expected: all exit `0`；normal URL test proves query/fragment/credentials absent; all getter/clock exceptions remain inside Browser。

- [ ] **Step 5: 记录建议提交边界**

建议提交信息：`feat(browser): add privacy-safe page snapshots`。仅在执行会话获得 Git 授权时提交 Task 3 文件。

---

### Task 4: 页面生命周期订阅、原子回滚与幂等销毁

**Files:**
- Create: `packages/browser/src/browser-environment.ts`
- Create: `packages/browser/test/page-lifecycle.test.ts`
- Create: `packages/browser/test/package-entry.test.ts`
- Modify: `packages/browser/src/page-lifecycle.ts`
- Modify: `packages/browser/src/index.ts`

**Interfaces:**
- Consumes: Task 2 的宿主快照/诊断和 Task 3 的 `readPageSnapshot()` / `readVisibilityState()`。
- Produces: 完整 Final Public API、`createLifecycleManager()`、`createBrowserEnvironment()`、原子三监听器订阅、逻辑取消、整体销毁和根包运行时出口。

- [ ] **Step 1: 写失败的公共生命周期行为测试**

Create `test/page-lifecycle.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserSubscribeCode, PageLifecycleEventType, createBrowserEnvironment,
  type PageLifecycleEvent,
} from '../src/index.js';

interface FakeTarget {
  readonly addEventListener: (type: string, listener: (event: unknown) => void) => void;
  readonly removeEventListener: (type: string, listener: (event: unknown) => void) => void;
  readonly dispatch: (type: string, event?: unknown) => void;
  readonly listenerCount: () => number;
}

function createTarget(options: { readonly throwOnAdd?: string; readonly throwOnRemove?: boolean } = {}): FakeTarget {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener(type, listener): void {
      if (options.throwOnAdd === type) throw new Error('registration-secret');
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener); listeners.set(type, bucket);
    },
    removeEventListener(type, listener): void {
      if (options.throwOnRemove === true) throw new Error('removal-secret');
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event = {}): void {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    listenerCount: (): number => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

function installHost(windowTarget: FakeTarget, documentTarget: FakeTarget): void {
  vi.stubGlobal('window', { ...windowTarget, location: { href: 'https://example.test/' } });
  vi.stubGlobal('document', { ...documentTarget, visibilityState: 'visible' });
  vi.stubGlobal('navigator', { userAgent: 'synthetic-agent' });
  vi.stubGlobal('performance', { now: (): number => 1 });
}

afterEach(() => vi.unstubAllGlobals());

describe('page lifecycle subscription', () => {
  it('delivers stable visibility, pagehide, and pageshow events', () => {
    const windowTarget = createTarget(); const documentTarget = createTarget();
    installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment(); const events: PageLifecycleEvent[] = [];
    const result = browser.subscribePageLifecycle((event) => events.push(event));
    expect(result).toMatchObject({ ok: true, code: BrowserSubscribeCode.Subscribed, diagnosticsAdded: 0 });
    if (!result.ok) throw new Error('subscription must succeed');
    documentTarget.dispatch('visibilitychange');
    windowTarget.dispatch('pagehide', { persisted: true });
    windowTarget.dispatch('pageshow', { persisted: false });
    expect(events).toEqual([
      { type: PageLifecycleEventType.VisibilityChange, visibilityState: 'visible' },
      { type: PageLifecycleEventType.PageHide, isPersisted: true },
      { type: PageLifecycleEventType.PageShow, isPersisted: false },
    ]);
    expect(events.every(Object.isFrozen)).toBe(true);
  });

  it('cancels once and treats repeated cancellation as a no-op', () => {
    const windowTarget = createTarget(); const documentTarget = createTarget();
    installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment(); let calls = 0;
    const result = browser.subscribePageLifecycle(() => { calls += 1; });
    if (!result.ok) throw new Error('subscription must succeed');
    expect(result.subscription.unsubscribe()).toEqual({ ok: true, code: 'unsubscribed', diagnosticsAdded: 0 });
    expect(result.subscription.unsubscribe()).toEqual({ ok: true, code: 'already_unsubscribed', diagnosticsAdded: 0 });
    documentTarget.dispatch('visibilitychange');
    expect(calls).toBe(0); expect(windowTarget.listenerCount()).toBe(0);
    expect(documentTarget.listenerCount()).toBe(0);
    const replacement = browser.subscribePageLifecycle(() => { calls += 1; });
    expect(replacement.ok).toBe(true);
    if (replacement.ok) replacement.subscription.unsubscribe();
  });

  it('rolls back earlier listeners when later registration throws', () => {
    const windowTarget = createTarget({ throwOnAdd: 'pagehide' });
    const documentTarget = createTarget(); installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment();
    expect(browser.subscribePageLifecycle(() => undefined)).toMatchObject({
      ok: false, code: 'listener_registration_failed', diagnosticsAdded: 1,
    });
    expect(windowTarget.listenerCount()).toBe(0); expect(documentTarget.listenerCount()).toBe(0);
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('registration-secret');
  });

  it('reports a throwing listener method getter as registration failure', () => {
    const windowTarget = createTarget();
    const documentTarget = Object.create(null, {
      addEventListener: { get(): never { throw new Error('method-secret'); } },
      removeEventListener: { value: (): void => undefined },
      visibilityState: { value: 'visible' },
    });
    vi.stubGlobal('window', { ...windowTarget, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('navigator', { userAgent: 'agent' });
    vi.stubGlobal('performance', { now: (): number => 1 });
    const browser = createBrowserEnvironment();
    expect(browser.subscribePageLifecycle(() => undefined)).toMatchObject({
      ok: false, code: 'listener_registration_failed', diagnosticsAdded: 1,
    });
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('method-secret');
  });

  it('logically disables a subscription even when removeEventListener throws', () => {
    const windowTarget = createTarget({ throwOnRemove: true });
    const documentTarget = createTarget({ throwOnRemove: true });
    installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment(); let calls = 0;
    const result = browser.subscribePageLifecycle(() => { calls += 1; });
    if (!result.ok) throw new Error('subscription must succeed');
    expect(result.subscription.unsubscribe()).toMatchObject({
      ok: true, code: 'unsubscribed', diagnosticsAdded: 3,
    });
    documentTarget.dispatch('visibilitychange'); windowTarget.dispatch('pagehide');
    expect(calls).toBe(0);
  });

  it('maps a throwing persisted getter to null without leaking the exception', () => {
    const windowTarget = createTarget(); const documentTarget = createTarget();
    installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment(); const events: PageLifecycleEvent[] = [];
    browser.subscribePageLifecycle((event) => events.push(event));
    const nativeEvent = Object.create(null, {
      persisted: { get(): never { throw new Error('persisted-secret'); } },
    });
    windowTarget.dispatch('pagehide', nativeEvent);
    expect(events).toEqual([{ type: 'page_hide', isPersisted: null }]);
    expect(browser.getDiagnostics()).toMatchObject([
      { code: 'property_read_failed', operation: 'notify', eventType: 'page_hide' },
    ]);
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('persisted-secret');
  });

  it('destroys every subscription, rejects new subscriptions, and is idempotent', () => {
    const windowTarget = createTarget(); const documentTarget = createTarget();
    installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment(); let calls = 0;
    const first = browser.subscribePageLifecycle(() => { calls += 1; });
    const second = browser.subscribePageLifecycle(() => { calls += 1; });
    expect(first.ok && second.ok).toBe(true);
    expect(browser.destroy()).toEqual({ ok: true, code: 'destroyed', diagnosticsAdded: 0 });
    expect(browser.destroy()).toEqual({ ok: true, code: 'already_destroyed', diagnosticsAdded: 0 });
    expect(browser.subscribePageLifecycle(() => undefined)).toEqual({
      ok: false, code: 'destroyed', diagnosticsAdded: 0,
    });
    expect(() => browser.getCapabilities()).not.toThrow();
    expect(() => browser.readPageSnapshot()).not.toThrow();
    expect(() => browser.getDiagnostics()).not.toThrow();
    windowTarget.dispatch('pageshow'); expect(calls).toBe(0);
    if (first.ok) expect(first.subscription.unsubscribe().code).toBe('already_unsubscribed');
  });

  it('returns stable failures for a non-callable listener and unavailable environment', () => {
    vi.stubGlobal('window', undefined); vi.stubGlobal('document', undefined);
    const browser = createBrowserEnvironment();
    expect(browser.subscribePageLifecycle(null as never)).toEqual({
      ok: false, code: 'invalid_listener', diagnosticsAdded: 0,
    });
    expect(browser.subscribePageLifecycle(() => undefined)).toEqual({
      ok: false, code: 'environment_unavailable', diagnosticsAdded: 0,
    });
  });
});
```

The single `null as never` is a negative runtime-boundary test and must carry the adjacent explanation above; production code uses no assertion.

- [ ] **Step 2: 运行测试并确认工厂缺失失败**

Run:

```bash
pnpm --filter @aurora/browser exec vitest run test/page-lifecycle.test.ts
```

Expected: exit `1` because `createBrowserEnvironment` and lifecycle result types are not exported。

- [ ] **Step 3: 实现生命周期类型、注册、取消和销毁**

Replace `src/page-lifecycle.ts` with:

```ts
import { BrowserCapabilityName, type BrowserHostContext } from './capabilities.js';
import {
  BrowserDiagnosticCode, BrowserDiagnosticOperation, type BrowserDiagnosticStore,
} from './diagnostics.js';
import { readVisibilityState, type PageVisibilityState } from './page-snapshot.js';
import { callMethod, readMethod, readProperty, type UnknownCallable } from './safe-access.js';

export const PageLifecycleEventType = Object.freeze({
  VisibilityChange: 'visibility_change', PageHide: 'page_hide', PageShow: 'page_show',
} as const);
export type PageLifecycleEventType =
  (typeof PageLifecycleEventType)[keyof typeof PageLifecycleEventType];
export interface VisibilityChangeLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.VisibilityChange;
  readonly visibilityState: PageVisibilityState;
}
export interface PageHideLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.PageHide; readonly isPersisted: boolean | null;
}
export interface PageShowLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.PageShow; readonly isPersisted: boolean | null;
}
export type PageLifecycleEvent =
  | VisibilityChangeLifecycleEvent | PageHideLifecycleEvent | PageShowLifecycleEvent;
export type BrowserLifecycleListener = (event: PageLifecycleEvent) => void;

export const BrowserSubscribeCode = Object.freeze({
  Subscribed: 'subscribed', InvalidListener: 'invalid_listener',
  EnvironmentUnavailable: 'environment_unavailable', Destroyed: 'destroyed',
  ListenerRegistrationFailed: 'listener_registration_failed',
} as const);
export type BrowserSubscribeFailureCode =
  | typeof BrowserSubscribeCode.InvalidListener
  | typeof BrowserSubscribeCode.EnvironmentUnavailable
  | typeof BrowserSubscribeCode.Destroyed
  | typeof BrowserSubscribeCode.ListenerRegistrationFailed;
export interface BrowserSubscribeSuccess {
  readonly ok: true; readonly code: typeof BrowserSubscribeCode.Subscribed;
  readonly subscription: BrowserSubscription; readonly diagnosticsAdded: number;
}
export interface BrowserSubscribeFailure {
  readonly ok: false; readonly code: BrowserSubscribeFailureCode;
  readonly diagnosticsAdded: number;
}
export type BrowserSubscribeResult = BrowserSubscribeSuccess | BrowserSubscribeFailure;
export const BrowserUnsubscribeCode = Object.freeze({
  Unsubscribed: 'unsubscribed', AlreadyUnsubscribed: 'already_unsubscribed',
} as const);
export interface BrowserUnsubscribeResult {
  readonly ok: true;
  readonly code:
    | typeof BrowserUnsubscribeCode.Unsubscribed
    | typeof BrowserUnsubscribeCode.AlreadyUnsubscribed;
  readonly diagnosticsAdded: number;
}
export interface BrowserSubscription { unsubscribe(): BrowserUnsubscribeResult; }
export const BrowserDestroyCode = Object.freeze({
  Destroyed: 'destroyed', AlreadyDestroyed: 'already_destroyed',
} as const);
export interface BrowserDestroyResult {
  readonly ok: true;
  readonly code: typeof BrowserDestroyCode.Destroyed | typeof BrowserDestroyCode.AlreadyDestroyed;
  readonly diagnosticsAdded: number;
}
interface Registration {
  readonly target: unknown; readonly type: string; readonly listener: UnknownCallable;
  readonly remove: UnknownCallable;
}
interface SubscriptionRecord { isActive: boolean; readonly registrations: Registration[]; }
export interface LifecycleManager {
  subscribe(listener: BrowserLifecycleListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
}

function persisted(event: unknown, diagnostics: BrowserDiagnosticStore,
  eventType: PageLifecycleEventType): boolean | null {
  const result = readProperty(event, 'persisted');
  if (!result.ok && result.reason === 'threw') diagnostics.append({
    code: BrowserDiagnosticCode.PropertyReadFailed,
    operation: BrowserDiagnosticOperation.Notify,
    capability: BrowserCapabilityName.PageLifecycle,
    eventType,
  });
  return result.ok && typeof result.value === 'boolean' ? result.value : null;
}

export function createLifecycleManager(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): LifecycleManager {
  const active = new Set<SubscriptionRecord>();
  let isDestroyed = false;

  function notify(
    record: SubscriptionRecord,
    listener: BrowserLifecycleListener,
    event: PageLifecycleEvent,
  ): void {
    if (!record.isActive) return;
    try { listener(Object.freeze(event)); }
    catch {
      diagnostics.append({
        code: BrowserDiagnosticCode.CallbackFailed,
        operation: BrowserDiagnosticOperation.Notify,
        eventType: event.type,
      });
    }
  }

  function removeAll(record: SubscriptionRecord, operation: 'unsubscribe' | 'destroy'): number {
    if (!record.isActive) return 0;
    record.isActive = false; active.delete(record);
    const before = diagnostics.getTotalCount();
    for (const registration of [...record.registrations].reverse()) {
      const result = callMethod(registration.remove, registration.target,
        [registration.type, registration.listener]);
      if (!result.ok) diagnostics.append({
        code: BrowserDiagnosticCode.ListenerRemovalFailed,
        operation,
        capability: BrowserCapabilityName.PageLifecycle,
      });
    }
    return diagnostics.getTotalCount() - before;
  }

  function subscribe(listener: BrowserLifecycleListener): BrowserSubscribeResult {
    if (typeof listener !== 'function') return Object.freeze({
      ok: false, code: BrowserSubscribeCode.InvalidListener, diagnosticsAdded: 0,
    });
    if (isDestroyed) return Object.freeze({
      ok: false, code: BrowserSubscribeCode.Destroyed, diagnosticsAdded: 0,
    });
    const record: SubscriptionRecord = { isActive: true, registrations: [] };
    const visibilityListener = (): void => {
      if (!record.isActive) return;
      notify(record, listener, {
        type: PageLifecycleEventType.VisibilityChange,
        visibilityState: readVisibilityState(
          host.documentTarget, diagnostics, BrowserDiagnosticOperation.Notify,
        ),
      });
    };
    const hideListener = (event: unknown): void => {
      if (!record.isActive) return;
      notify(record, listener, {
        type: PageLifecycleEventType.PageHide,
        isPersisted: persisted(event, diagnostics, PageLifecycleEventType.PageHide),
      });
    };
    const showListener = (event: unknown): void => {
      if (!record.isActive) return;
      notify(record, listener, {
        type: PageLifecycleEventType.PageShow,
        isPersisted: persisted(event, diagnostics, PageLifecycleEventType.PageShow),
      });
    };
    const requests = [
      { target: host.documentTarget, type: 'visibilitychange', listener: visibilityListener },
      { target: host.windowTarget, type: 'pagehide', listener: hideListener },
      { target: host.windowTarget, type: 'pageshow', listener: showListener },
    ];
    for (const request of requests) {
      const add = readMethod(request.target, 'addEventListener');
      const remove = readMethod(request.target, 'removeEventListener');
      if (!add.ok || !remove.ok) {
        const before = diagnostics.getTotalCount();
        const hasThrown = (!add.ok && add.reason === 'threw')
          || (!remove.ok && remove.reason === 'threw');
        if (hasThrown) diagnostics.append({
          code: BrowserDiagnosticCode.ListenerRegistrationFailed,
          operation: BrowserDiagnosticOperation.Subscribe,
          capability: BrowserCapabilityName.PageLifecycle,
        });
        removeAll(record, BrowserDiagnosticOperation.Unsubscribe);
        return Object.freeze({
          ok: false,
          code: hasThrown
            ? BrowserSubscribeCode.ListenerRegistrationFailed
            : BrowserSubscribeCode.EnvironmentUnavailable,
          diagnosticsAdded: diagnostics.getTotalCount() - before,
        });
      }
      const before = diagnostics.getTotalCount();
      const added = callMethod(add.value, request.target, [request.type, request.listener]);
      if (!added.ok) {
        diagnostics.append({
          code: BrowserDiagnosticCode.ListenerRegistrationFailed,
          operation: BrowserDiagnosticOperation.Subscribe,
          capability: BrowserCapabilityName.PageLifecycle,
        });
        removeAll(record, BrowserDiagnosticOperation.Unsubscribe);
        return Object.freeze({
          ok: false, code: BrowserSubscribeCode.ListenerRegistrationFailed,
          diagnosticsAdded: diagnostics.getTotalCount() - before,
        });
      }
      record.registrations.push({ ...request, remove: remove.value });
    }
    active.add(record);
    const subscription: BrowserSubscription = Object.freeze({
      unsubscribe(): BrowserUnsubscribeResult {
        if (!record.isActive) return Object.freeze({
          ok: true, code: BrowserUnsubscribeCode.AlreadyUnsubscribed, diagnosticsAdded: 0,
        });
        return Object.freeze({
          ok: true, code: BrowserUnsubscribeCode.Unsubscribed,
          diagnosticsAdded: removeAll(record, BrowserDiagnosticOperation.Unsubscribe),
        });
      },
    });
    return Object.freeze({
      ok: true, code: BrowserSubscribeCode.Subscribed, subscription, diagnosticsAdded: 0,
    });
  }

  function destroy(): BrowserDestroyResult {
    if (isDestroyed) return Object.freeze({
      ok: true, code: BrowserDestroyCode.AlreadyDestroyed, diagnosticsAdded: 0,
    });
    isDestroyed = true;
    const before = diagnostics.getTotalCount();
    for (const record of [...active]) removeAll(record, BrowserDiagnosticOperation.Destroy);
    return Object.freeze({
      ok: true, code: BrowserDestroyCode.Destroyed,
      diagnosticsAdded: diagnostics.getTotalCount() - before,
    });
  }
  return Object.freeze({ subscribe, destroy });
}
```

Use the typed constants `BrowserDiagnosticOperation.Unsubscribe` and `.Destroy` as `operation`; change `removeAll`'s parameter type to those two literal member types so the code has no string widening.

- [ ] **Step 4: 组合最终 Browser 实例并锁定根出口**

Create `src/browser-environment.ts`:

```ts
import {
  captureBrowserHost, detectBrowserCapabilities, type BrowserCapabilities,
} from './capabilities.js';
import { createDiagnosticStore, type BrowserDiagnostic } from './diagnostics.js';
import {
  createLifecycleManager, type BrowserDestroyResult, type BrowserLifecycleListener,
  type BrowserSubscribeResult,
} from './page-lifecycle.js';
import { readPageSnapshot, type BrowserPageSnapshot } from './page-snapshot.js';

export interface BrowserEnvironment {
  getCapabilities(): BrowserCapabilities;
  readPageSnapshot(): BrowserPageSnapshot;
  subscribePageLifecycle(listener: BrowserLifecycleListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
  getDiagnostics(): readonly BrowserDiagnostic[];
}

export function createBrowserEnvironment(): BrowserEnvironment {
  const diagnostics = createDiagnosticStore();
  const host = captureBrowserHost(diagnostics);
  const capabilities = detectBrowserCapabilities(host, diagnostics);
  const lifecycle = createLifecycleManager(host, diagnostics);
  return Object.freeze({
    getCapabilities: (): BrowserCapabilities => capabilities,
    readPageSnapshot: (): BrowserPageSnapshot => readPageSnapshot(host, diagnostics),
    subscribePageLifecycle: (listener: BrowserLifecycleListener): BrowserSubscribeResult =>
      lifecycle.subscribe(listener),
    destroy: (): BrowserDestroyResult => lifecycle.destroy(),
    getDiagnostics: (): readonly BrowserDiagnostic[] => diagnostics.getDiagnostics(),
  });
}
```

Replace `src/index.ts` with:

```ts
export { createBrowserEnvironment, type BrowserEnvironment } from './browser-environment.js';
export {
  BrowserCapabilityName,
  type BrowserCapabilities,
} from './capabilities.js';
export {
  BrowserDiagnosticCode,
  BrowserDiagnosticOperation,
  type BrowserDiagnostic,
} from './diagnostics.js';
export {
  BrowserDestroyCode,
  BrowserSubscribeCode,
  BrowserUnsubscribeCode,
  PageLifecycleEventType,
  type BrowserDestroyResult,
  type BrowserLifecycleListener,
  type BrowserSubscribeFailure,
  type BrowserSubscribeFailureCode,
  type BrowserSubscribeResult,
  type BrowserSubscribeSuccess,
  type BrowserSubscription,
  type BrowserUnsubscribeResult,
  type PageHideLifecycleEvent,
  type PageLifecycleEvent,
  type PageShowLifecycleEvent,
  type VisibilityChangeLifecycleEvent,
} from './page-lifecycle.js';
export {
  PageVisibilityState,
  type BrowserClockSnapshot,
  type BrowserPageSnapshot,
} from './page-snapshot.js';
```

The required runtime exports after build must sort to:

```text
BrowserCapabilityName,BrowserDestroyCode,BrowserDiagnosticCode,BrowserDiagnosticOperation,BrowserSubscribeCode,BrowserUnsubscribeCode,PageLifecycleEventType,PageVisibilityState,createBrowserEnvironment
```

Create `test/package-entry.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function importFromPackage(specifier: string) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module', '--eval',
      `const module = await import(${JSON.stringify(specifier)}); console.log(Object.keys(module).sort().join(','));`,
    ],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  );
}

describe('built Browser package entry', () => {
  it('loads the one declared runtime root', () => {
    const result = importFromPackage('@aurora/browser');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(
      'BrowserCapabilityName,BrowserDestroyCode,BrowserDiagnosticCode,BrowserDiagnosticOperation,'
      + 'BrowserSubscribeCode,BrowserUnsubscribeCode,PageLifecycleEventType,PageVisibilityState,'
      + 'createBrowserEnvironment',
    );
  });

  it('rejects private and unexported paths', () => {
    for (const specifier of [
      '@aurora/browser/src/index.js',
      '@aurora/browser/internal/safe-access.js',
      '@aurora/browser/page-lifecycle',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });
});
```

- [ ] **Step 5: 确认通过并运行相关回归**

Run:

```bash
pnpm --filter @aurora/browser exec vitest run test/page-lifecycle.test.ts
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/browser test
pnpm --filter @aurora/browser test:package
pnpm check:boundaries
pnpm --filter @aurora/core typecheck
```

Expected: all exit `0`；`page-lifecycle.test.ts` 全部通过，built root entry only exposes the nine runtime names，三个私有路径均以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 失败，Core no-DOM 仍通过。

- [ ] **Step 6: 记录建议提交边界**

建议提交信息：`feat(browser): add page lifecycle resource management`。仅在执行会话获得 Git 授权时提交 Task 4 文件。

---

### Task 5: 异常隔离、宿主防污染与多实例安全

**Files:**
- Create: `packages/browser/test/host-safety.test.ts`
- Create: `packages/browser/test/multi-instance.test.ts`
- Modify: `tooling/workspace-policy/src/types.ts`
- Modify: `tooling/workspace-policy/src/environment.ts`
- Modify: `tooling/workspace-policy/test/environment.test.ts`
- Modify: `eslint.config.mjs`

**Interfaces:**
- Consumes: Final Public API、实例级诊断、三监听器资源管理、Workspace TypeScript AST 扫描。
- Produces: `forbidden-host-mutation` 策略、宿主身份/原型不变证据、回调隔离、100 条诊断上限和多实例释放隔离。

- [ ] **Step 1: 写失败的宿主安全和多实例测试**

Create `test/host-safety.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserEnvironment } from '../src/index.js';

interface Target {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  dispatch(type: string, event?: unknown): void;
}

function target(): Target {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener(type, listener): void {
      const bucket = listeners.get(type) ?? new Set(); bucket.add(listener); listeners.set(type, bucket);
    },
    removeEventListener(type, listener): void { listeners.get(type)?.delete(listener); },
    dispatch(type, event = {}): void {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Browser host safety', () => {
  it('does not overwrite handlers, native APIs, history, prototypes, or console', () => {
    const windowTarget = target(); const documentTarget = target();
    const onerror = (): boolean => true; const onunhandledrejection = (): boolean => true;
    const fetchValue = (): Promise<Response> => Promise.resolve(new Response());
    class SyntheticXhr {}
    const historyValue = { pushState: (): void => undefined, replaceState: (): void => undefined };
    const pushState = historyValue.pushState;
    const replaceState = historyValue.replaceState;
    const windowValue = {
      ...windowTarget, location: { href: 'https://example.test/?token=private' },
      onerror, onunhandledrejection, fetch: fetchValue, XMLHttpRequest: SyntheticXhr,
      history: historyValue,
    };
    const prototype = Object.getPrototypeOf(windowValue);
    vi.stubGlobal('window', windowValue);
    vi.stubGlobal('document', { ...documentTarget, visibilityState: 'visible' });
    vi.stubGlobal('navigator', { userAgent: 'agent' });
    vi.stubGlobal('performance', { now: (): number => 1 });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const browser = createBrowserEnvironment();
    const result = browser.subscribePageLifecycle(() => undefined);
    if (result.ok) result.subscription.unsubscribe();
    browser.destroy(); browser.readPageSnapshot();
    expect(windowValue).toMatchObject({
      onerror, onunhandledrejection, fetch: fetchValue, XMLHttpRequest: SyntheticXhr,
      history: historyValue,
    });
    expect(Object.getPrototypeOf(windowValue)).toBe(prototype);
    expect(historyValue.pushState).toBe(pushState);
    expect(historyValue.replaceState).toBe(replaceState);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('contains one throwing callback and still notifies another callback', () => {
    const windowTarget = target(); const documentTarget = target();
    vi.stubGlobal('window', { ...windowTarget, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', { ...documentTarget, visibilityState: 'visible' });
    vi.stubGlobal('navigator', { userAgent: 'agent' });
    vi.stubGlobal('performance', { now: (): number => 1 });
    const browser = createBrowserEnvironment(); let healthyCalls = 0;
    browser.subscribePageLifecycle((): never => { throw new Error('authorization=secret'); });
    browser.subscribePageLifecycle(() => { healthyCalls += 1; });
    documentTarget.dispatch('visibilitychange');
    expect(healthyCalls).toBe(1);
    expect(browser.getDiagnostics()).toMatchObject([
      { sequence: 1, code: 'callback_failed', operation: 'notify', eventType: 'visibility_change' },
    ]);
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('authorization');
  });

  it('bounds diagnostics to the newest 100 entries without reusing sequence numbers', () => {
    const windowTarget = target(); const documentTarget = target();
    vi.stubGlobal('window', { ...windowTarget, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', { ...documentTarget, visibilityState: 'visible' });
    vi.stubGlobal('navigator', { userAgent: 'agent' });
    vi.stubGlobal('performance', { now: (): number => 1 });
    const browser = createBrowserEnvironment();
    browser.subscribePageLifecycle((): never => { throw new Error('private'); });
    for (let index = 0; index < 120; index += 1) documentTarget.dispatch('visibilitychange');
    const diagnostics = browser.getDiagnostics();
    expect(diagnostics).toHaveLength(100);
    expect(diagnostics[0]?.sequence).toBe(21);
    expect(diagnostics[99]?.sequence).toBe(120);
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(diagnostics.every(Object.isFrozen)).toBe(true);
  });
});
```

Create `test/multi-instance.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserEnvironment } from '../src/index.js';

afterEach(() => vi.unstubAllGlobals());

describe('Browser multi-instance isolation', () => {
  it('destroying one instance leaves another instance subscribed', () => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const addEventListener = (type: string, listener: (event: unknown) => void): void => {
      const bucket = listeners.get(type) ?? new Set(); bucket.add(listener); listeners.set(type, bucket);
    };
    const removeEventListener = (type: string, listener: (event: unknown) => void): void => {
      listeners.get(type)?.delete(listener);
    };
    const windowTarget = { addEventListener, removeEventListener, location: { href: 'https://example.test/' } };
    const documentTarget = { addEventListener, removeEventListener, visibilityState: 'visible' };
    vi.stubGlobal('window', windowTarget); vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('navigator', { userAgent: 'agent' });
    vi.stubGlobal('performance', { now: (): number => 1 });
    const first = createBrowserEnvironment(); const second = createBrowserEnvironment();
    let firstCalls = 0; let secondCalls = 0;
    first.subscribePageLifecycle(() => { firstCalls += 1; });
    second.subscribePageLifecycle(() => { secondCalls += 1; });
    first.destroy();
    for (const listener of [...(listeners.get('pageshow') ?? [])]) listener({ persisted: true });
    expect(firstCalls).toBe(0); expect(secondCalls).toBe(1);
    expect(first.getDiagnostics()).toEqual([]); expect(second.getDiagnostics()).toEqual([]);
    second.destroy(); expect(listeners.get('pageshow')?.size ?? 0).toBe(0);
  });
});
```

Append policy failures to `environment.test.ts`:

```ts
it.each([
  'window.onerror = null;',
  'window.onunhandledrejection = null;',
  'globalThis.fetch = replacement;',
  'XMLHttpRequest.prototype.open = replacement;',
  'history.pushState = replacement;',
  'Object.defineProperty(window, "onerror", { value: null });',
  'Reflect.set(globalThis, "fetch", replacement);',
])('rejects sdk-browser host mutation: %s', async (source) => {
  fixture = await createBrowserSource(`const replacement = (): void => undefined; ${source}`);
  const result = await checkWorkspace(fixture.rootDir);
  expect(result.violations).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'forbidden-host-mutation' })]),
  );
});
```

- [ ] **Step 2: 确认新增策略测试按预期失败**

Run:

```bash
pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts
```

Expected: exit `1` because `forbidden-host-mutation` does not exist and Browser assignments are not detected。Browser behavior tests may already pass; this Task 的红灯由架构策略负例提供。

- [ ] **Step 3: 实现 AST 宿主修改门禁**

Add to `WorkspaceViolationCode` in `src/types.ts`:

```ts
| 'forbidden-host-mutation'
```

Add these helpers to `src/environment.ts` and invoke `isBrowserHostMutation()` during the existing AST visit when `layer === 'sdk-browser'`:

```ts
const browserHostRoots: ReadonlySet<string> = new Set([
  'window', 'document', 'navigator', 'performance', 'globalThis',
  'fetch', 'XMLHttpRequest', 'history',
]);

function expressionRoot(expression: ts.Expression): string | undefined {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) return value.text;
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    return expressionRoot(value.expression);
  }
  return undefined;
}

function containsPrototype(expression: ts.Expression): boolean {
  const value = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(value)) {
    return value.name.text === 'prototype' || containsPrototype(value.expression);
  }
  if (ts.isElementAccessExpression(value)) {
    return (ts.isStringLiteralLike(value.argumentExpression)
      && value.argumentExpression.text === 'prototype') || containsPrototype(value.expression);
  }
  return false;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isMutationCall(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const owner = node.expression.expression;
  const method = node.expression.name.text;
  const isMutator =
    (ts.isIdentifier(owner) && owner.text === 'Object'
      && (method === 'defineProperty' || method === 'assign'))
    || (ts.isIdentifier(owner) && owner.text === 'Reflect' && method === 'set');
  if (!isMutator) return false;
  const target = node.arguments[0];
  return target !== undefined
    && (browserHostRoots.has(expressionRoot(target) ?? '') || containsPrototype(target));
}

function isBrowserHostMutation(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
    return browserHostRoots.has(expressionRoot(node.left) ?? '') || containsPrototype(node.left);
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    const isUpdate = node.operator === ts.SyntaxKind.PlusPlusToken
      || node.operator === ts.SyntaxKind.MinusMinusToken;
    return isUpdate
      && (browserHostRoots.has(expressionRoot(node.operand) ?? '')
        || containsPrototype(node.operand));
  }
  return ts.isCallExpression(node) && isMutationCall(node);
}
```

Inside `visit`:

```ts
if (layer === 'sdk-browser' && isBrowserHostMutation(node)) {
  violations.push({
    code: 'forbidden-host-mutation',
    packageName: workspacePackage.name,
    file: relative(workspacePackage.directory, file).replaceAll('\\', '/'),
    message: 'sdk-browser source must not mutate host globals or native prototypes',
  });
}
```

Append this ESLint config block; Workspace Policy remains the AST backstop for computed properties and mutator calls:

```js
{
  files: ['packages/browser/src/**/*.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "AssignmentExpression[left.object.name=/^(window|document|navigator|performance|globalThis)$/]",
        message: 'Browser source must not assign to host globals.',
      },
      {
        selector: "AssignmentExpression[left.object.property.name='prototype']",
        message: 'Browser source must not modify native prototypes.',
      },
      {
        selector:
          "CallExpression[callee.object.name='Object'][callee.property.name=/^(assign|defineProperty)$/]",
        message: 'Browser host mutation through Object mutators is forbidden by Workspace Policy.',
      },
      {
        selector: "CallExpression[callee.object.name='Reflect'][callee.property.name='set']",
        message: 'Browser host mutation through Reflect.set is forbidden by Workspace Policy.',
      },
    ],
  },
},
```

- [ ] **Step 4: 确认安全测试和策略全部通过**

Run:

```bash
pnpm --filter @aurora/browser exec vitest run test/host-safety.test.ts test/multi-instance.test.ts test/page-lifecycle.test.ts
pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts test/dependency-policy.test.ts
pnpm lint
pnpm check:boundaries
```

Expected: all exit `0`；120 次回调失败只保留 sequence 21—120；一个实例销毁后另一个仍收到 `pageshow`；七个宿主修改负例全部返回 `forbidden-host-mutation`。

- [ ] **Step 5: 记录建议提交边界**

建议提交信息：`test(browser): enforce host safety and instance isolation`。仅在执行会话获得 Git 授权时提交 Task 5 文件。

---

### Task 6: 最小 Playwright Chromium 真实浏览器门禁

**Files:**
- Create: `packages/browser/playwright.config.ts`
- Create: `packages/browser/test-browser/fixture-server.ts`
- Create: `packages/browser/test-browser/browser-environment.spec.ts`
- Modify: `packages/browser/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: 构建后的 `dist` 根模块、Final Public API、Node `http` 临时服务和 Playwright Chromium。
- Produces: `test:browser` 可重复命令、本地固定页面夹具、真实 DOM 生命周期/释放/宿主身份/异常/多实例证据。

- [ ] **Step 1: 先写 Chromium 测试与固定页面服务**

Create `playwright.config.ts`:

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
  use: { headless: true },
  workers: 1,
});
```

Create `test-browser/fixture-server.ts`:

```ts
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>Aurora Browser Fixture</title></head>
<body><script type="module">
import { createBrowserEnvironment } from '/dist/index.js';
const baseline = Object.freeze({
  onerror: window.onerror,
  onunhandledrejection: window.onunhandledrejection,
  fetch: window.fetch,
  XMLHttpRequest: window.XMLHttpRequest,
  history: window.history,
  pushState: window.history.pushState,
  replaceState: window.history.replaceState,
  windowPrototype: Object.getPrototypeOf(window),
  xhrPrototype: window.XMLHttpRequest.prototype,
});
const environment = createBrowserEnvironment();
const events = [];
let subscriptionResult = environment.subscribePageLifecycle((event) => events.push(event));
globalThis.browserHarness = Object.freeze({
  snapshot: () => environment.readPageSnapshot(),
  capabilities: () => environment.getCapabilities(),
  events: () => [...events],
  dispatchVisibility: () => document.dispatchEvent(new Event('visibilitychange')),
  dispatchPageHide: () => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  dispatchPageShow: () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })),
  unsubscribeTwice: () => {
    if (!subscriptionResult.ok) return [subscriptionResult, subscriptionResult];
    return [subscriptionResult.subscription.unsubscribe(), subscriptionResult.subscription.unsubscribe()];
  },
  recreateAndDestroy: () => {
    const first = createBrowserEnvironment();
    const second = createBrowserEnvironment();
    return [first.destroy(), first.destroy(), second.destroy(), second.destroy()];
  },
  hostUnchanged: () => ({
    onerror: window.onerror === baseline.onerror,
    onunhandledrejection: window.onunhandledrejection === baseline.onunhandledrejection,
    fetch: window.fetch === baseline.fetch,
    XMLHttpRequest: window.XMLHttpRequest === baseline.XMLHttpRequest,
    history: window.history === baseline.history,
    pushState: window.history.pushState === baseline.pushState,
    replaceState: window.history.replaceState === baseline.replaceState,
    windowPrototype: Object.getPrototypeOf(window) === baseline.windowPrototype,
    xhrPrototype: window.XMLHttpRequest.prototype === baseline.xhrPrototype,
  }),
  throwingCallback: () => {
    let healthyCalls = 0;
    const failed = environment.subscribePageLifecycle(() => { throw new Error('browser-private'); });
    const healthy = environment.subscribePageLifecycle(() => { healthyCalls += 1; });
    document.dispatchEvent(new Event('visibilitychange'));
    if (failed.ok) failed.subscription.unsubscribe();
    if (healthy.ok) healthy.subscription.unsubscribe();
    return { healthyCalls, diagnostics: environment.getDiagnostics() };
  },
  isolatedInstances: () => {
    const first = createBrowserEnvironment();
    const second = createBrowserEnvironment();
    let firstCalls = 0;
    let secondCalls = 0;
    first.subscribePageLifecycle(() => { firstCalls += 1; });
    second.subscribePageLifecycle(() => { secondCalls += 1; });
    first.destroy();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    second.destroy();
    return { firstCalls, secondCalls };
  },
  destroyPrimary: () => environment.destroy(),
});
</script></body></html>`;

export interface BrowserFixtureServer {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<BrowserFixtureServer> {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(pageHtml); return;
    }
    const match = /^\/dist\/([a-z0-9-]+\.js)$/.exec(pathname);
    if (match?.[1] === undefined) { response.writeHead(404); response.end(); return; }
    try {
      const source = await readFile(join(distDirectory, match[1]), 'utf8');
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(source);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('fixture server did not expose a TCP port');
  }
  return Object.freeze({
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: (): Promise<void> => new Promise((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  });
}
```

Create `test-browser/browser-environment.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { startFixtureServer, type BrowserFixtureServer } from './fixture-server.js';

let fixture: BrowserFixtureServer | undefined;

async function invoke(page: Page, method: string): Promise<unknown> {
  return page.evaluate((methodName) => {
    const harness: unknown = Reflect.get(globalThis, 'browserHarness');
    if (typeof harness !== 'object' || harness === null) throw new Error('browser harness missing');
    const callable: unknown = Reflect.get(harness, methodName);
    if (typeof callable !== 'function') throw new Error(`browser harness method missing: ${methodName}`);
    return Reflect.apply(callable, harness, []);
  }, method);
}

test.beforeAll(async () => { fixture = await startFixtureServer(); });
test.afterAll(async () => { await fixture?.close(); });
test.beforeEach(async ({ page }) => {
  if (fixture === undefined) throw new Error('fixture server missing');
  await page.goto(fixture.origin);
  await expect.poll(() => page.evaluate(
    () => typeof Reflect.get(globalThis, 'browserHarness') === 'object',
  )).toBe(true);
});

test('loads built module and reads real Chromium visibility', async ({ page }) => {
  const actualVisibility = await page.evaluate(() => document.visibilityState);
  expect(await invoke(page, 'capabilities')).toMatchObject({
    isBrowserEnvironment: true, canObservePageLifecycle: true,
  });
  expect(await invoke(page, 'snapshot')).toMatchObject({
    pageUrl: fixture?.origin.concat('/'),
    visibilityState: actualVisibility === 'hidden' ? 'hidden' : 'visible',
  });
});

test('delivers three lifecycle events and releases listeners idempotently', async ({ page }) => {
  await invoke(page, 'dispatchVisibility');
  await invoke(page, 'dispatchPageHide');
  await invoke(page, 'dispatchPageShow');
  expect(await invoke(page, 'events')).toEqual([
    { type: 'visibility_change', visibilityState: 'visible' },
    { type: 'page_hide', isPersisted: true },
    { type: 'page_show', isPersisted: false },
  ]);
  expect(await invoke(page, 'unsubscribeTwice')).toEqual([
    { ok: true, code: 'unsubscribed', diagnosticsAdded: 0 },
    { ok: true, code: 'already_unsubscribed', diagnosticsAdded: 0 },
  ]);
  await invoke(page, 'dispatchPageShow');
  expect(await invoke(page, 'events')).toHaveLength(3);
});

test('preserves handlers, native APIs, history, and prototypes across repeated destroy', async ({ page }) => {
  expect(await invoke(page, 'recreateAndDestroy')).toEqual([
    { ok: true, code: 'destroyed', diagnosticsAdded: 0 },
    { ok: true, code: 'already_destroyed', diagnosticsAdded: 0 },
    { ok: true, code: 'destroyed', diagnosticsAdded: 0 },
    { ok: true, code: 'already_destroyed', diagnosticsAdded: 0 },
  ]);
  await invoke(page, 'destroyPrimary');
  expect(await invoke(page, 'hostUnchanged')).toEqual({
    onerror: true, onunhandledrejection: true, fetch: true, XMLHttpRequest: true,
    history: true, pushState: true, replaceState: true, windowPrototype: true, xhrPrototype: true,
  });
});

test('contains callback errors and leaves the host page running', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  expect(await invoke(page, 'throwingCallback')).toMatchObject({
    healthyCalls: 1,
    diagnostics: [{ code: 'callback_failed', operation: 'notify', eventType: 'visibility_change' }],
  });
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => 20 + 22)).toBe(42);
});

test('does not cross-cancel independent instances', async ({ page }) => {
  expect(await invoke(page, 'isolatedInstances')).toEqual({ firstCalls: 0, secondCalls: 1 });
});
```

- [ ] **Step 2: 运行新测试命令并确认按预期失败**

Run before adding the script or dependency:

```bash
pnpm --filter @aurora/browser test:browser
```

Expected: exit non-zero with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` / missing `test:browser` script。失败必须来自真实浏览器门禁尚未接入，而不是语法错误或弱化断言。

- [ ] **Step 3: 接入精确测试依赖并只安装 Chromium**

Modify Browser manifest:

```json
"scripts": {
  "test:browser": "pnpm build && playwright test --config playwright.config.ts"
},
"devDependencies": {
  "@playwright/test": "1.62.0"
}
```

Merge those keys with existing scripts/devDependencies; do not remove Vitest/TypeScript entries. Then run:

```bash
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm --filter @aurora/browser exec playwright install chromium
```

Expected: all exit `0`；lockfile pins `@playwright/test@1.62.0`，only Chromium browser payload is requested。Do not use `playwright install --with-deps` unless the execution host reports a missing OS library and the user separately authorizes system changes。

- [ ] **Step 4: 运行真实浏览器测试，修复本增量行为差异并确认通过**

Permitted production files are only `packages/browser/src/*.ts`, and fixes must preserve Final Public API. Do not add proxies, plugins, transport, framework code, sleeps, retry loops, browser-specific globals or test-only public switches.

Run:

```bash
pnpm --filter @aurora/browser test:browser
pnpm --filter @aurora/browser test
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/browser test:package
```

Expected: all exit `0`；Playwright summary `5 passed`，Vitest regressions pass，built package entry unchanged。

- [ ] **Step 5: 记录建议提交边界**

建议提交信息：`test(browser): verify lifecycle safety in chromium`。仅在执行会话获得 Git 授权时提交 Task 6 文件和 lockfile 的 Browser/Playwright 变更。

---

### Task 7: README、架构/ADR 证据、覆盖率与完整质量门禁

**Files:**
- Create: `packages/browser/README.md`
- Create: `packages/browser/test/documentation-contract.test.ts`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/architecture/sdk-architecture.md`
- Modify: `docs/architecture/monorepo-and-build.md`
- Modify: `docs/testing/test-strategy.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/sdk/browser-environment-foundation.md`
- Modify: `docs/adr/ADR-003-sdk-plugin-architecture.md`
- Modify: `docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `AGENTS.md`
- Modify: `AURORA_RULES.md`

**Interfaces:**
- Consumes: 已通过的 Browser 单元/包/Chromium 行为、现有根命令、文档治理和 ADR 状态规则。
- Produces: 完整模块 README、真实实施状态、Browser 覆盖率/浏览器门禁、ADR-003/006 实施证据和一次完整可重复质量链。

- [ ] **Step 1: 写失败的文档与状态契约测试**

Create `test/documentation-contract.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function rootFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

describe('Browser documentation contract', () => {
  it('documents responsibilities, privacy, release semantics, and real commands', async () => {
    const readme = await rootFile('packages/browser/README.md');
    for (const heading of [
      '## 模块定位', '## 职责', '## 非职责', '## 公共 API', '## 环境与降级',
      '## 隐私与宿主安全', '## 资源释放', '## 开发与测试', '## 权威来源',
    ]) expect(readme).toContain(heading);
    expect(readme).toContain('pnpm --filter @aurora/browser test:browser');
    expect(readme).toContain('origin + pathname');
    expect(readme).toContain('85%');
    expect(readme).toContain('80%');
    expect(readme).not.toMatch(/Cookie.*采集|完整 URL 查询.*保留/);
  });

  it('records Browser as implemented without overstating plugins or the whole SDK', async () => {
    for (const path of [
      'README.md', 'docs/architecture/system-overview.md',
      'docs/architecture/sdk-architecture.md', 'docs/architecture/formalization-readiness.md',
      'AGENTS.md', 'AURORA_RULES.md',
    ]) {
      const text = await rootFile(path);
      expect(text, path).toContain('@aurora/browser');
      expect(text, path).toContain('浏览器环境能力与页面生命周期基础第一增量');
    }
    expect(await rootFile('docs/architecture/sdk-architecture.md')).toContain(
      '错误、请求、性能、资源和行为插件仍不存在',
    );
  });

  it('keeps ADR states unchanged and appends precise evidence', async () => {
    expect(await rootFile('docs/sdk/browser-environment-foundation.md')).toContain(
      'implementation-status: implemented',
    );
    const adr003 = await rootFile('docs/adr/ADR-003-sdk-plugin-architecture.md');
    const adr005 = await rootFile('docs/adr/ADR-005-event-schema-source-of-truth.md');
    const adr006 = await rootFile('docs/adr/ADR-006-one-way-dependencies.md');
    const adr007 = await rootFile('docs/adr/ADR-007-workspace-package-and-task-tooling.md');
    expect(adr003).toContain('implementation-status: in-progress');
    expect(adr003).toContain('@aurora/browser');
    expect(adr006).toContain('implementation-status: in-progress');
    expect(adr006).toContain('sdk-browser');
    expect(adr005).toContain('implementation-status: in-progress');
    expect(adr007).toContain('implementation-status: implemented');
  });
});
```

- [ ] **Step 2: 运行文档契约并确认缺失 README/证据失败**

Run:

```bash
pnpm --filter @aurora/browser exec vitest run test/documentation-contract.test.ts
```

Expected: exit `1` because `packages/browser/README.md` and Browser implementation evidence do not exist。ADR metadata assertions must already pass and must not be changed to manufacture the red result。

- [ ] **Step 3: 写完整模块 README**

Create `packages/browser/README.md` with this complete content:

```markdown
# Browser

`@aurora/browser` 是 Aurora SDK 的浏览器环境能力与页面生命周期基础包。当前包保持私有；完成本增量不表示错误、请求、性能、资源、行为、传输或框架能力已经存在。

## 模块定位

本包位于环境无关 Core 之上，向获批的独立消费者提供浏览器能力快照、脱敏页面快照和页面生命周期订阅。当前没有 Core 环境注入或具体插件集成。

## 职责

- 安全识别 `window`、`document`、`navigator` 和 `performance`；
- 读取 URL 的 `origin + pathname`、User Agent、可见性和两类时间；
- 订阅 `visibilitychange`、`pagehide`、`pageshow`；
- 隔离 getter、监听器与回调异常；
- 提供实例级、固定 100 条的脱敏诊断；
- 支持幂等取消、幂等销毁和多实例隔离。

## 非职责

本包不采集错误、Promise 异常、资源、请求、性能指标或用户行为；不代理 fetch、XMLHttpRequest 或 History；不实现 Core 插件、事件信封、传输、队列、重试、持久化或 React/Vue 适配。

## 公共 API

```ts
import {
  createBrowserEnvironment,
  PageLifecycleEventType,
  PageVisibilityState,
  type BrowserEnvironment,
  type BrowserPageSnapshot,
  type BrowserSubscribeResult,
} from '@aurora/browser';
```

包只导出根入口。禁止导入 `src`、`internal` 或未声明子路径。

## 环境与降级

模块导入不读取浏览器全局。缺失环境返回 `false`、`null`、`unknown` 或稳定失败码；宿主 getter、时钟和监听器 API 抛错时不会向宿主页脚本传播。

## 隐私与宿主安全

页面地址只返回 HTTP(S) 的 `origin + pathname`，删除用户名、密码、查询和片段。包不读取 Cookie、Storage、表单、DOM 或页面文本，不记录异常文本和 User Agent，不覆盖 `window.onerror`、`window.onunhandledrejection`，不替换原生 API，不修改原型。

## 资源释放

成功订阅返回 `BrowserSubscription`。首次 `unsubscribe()` 逻辑停用并移除三个监听器，重复调用返回 `already_unsubscribed`。首次 `destroy()` 释放实例全部订阅，重复调用返回 `already_destroyed`；销毁后不允许重新订阅。

## 开发与测试

```bash
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/browser test
pnpm --filter @aurora/browser test:coverage
pnpm --filter @aurora/browser build
pnpm --filter @aurora/browser test:package
pnpm --filter @aurora/browser exec playwright install chromium
pnpm --filter @aurora/browser test:browser
pnpm check:ci
```

覆盖率门槛为行 85%、分支 80%、函数 85%、语句 85%。真实浏览器门禁只运行本地 Chromium。

## 权威来源

- [Browser 正式规格](../../docs/sdk/browser-environment-foundation.md)
- [SDK 架构](../../docs/architecture/sdk-architecture.md)
- [ADR-003](../../docs/adr/ADR-003-sdk-plugin-architecture.md)
- [ADR-006](../../docs/adr/ADR-006-one-way-dependencies.md)
- [测试策略](../../docs/testing/test-strategy.md)
```

- [ ] **Step 4: 同步架构、状态、测试与 ADR 实施证据**

Make these exact factual updates without changing unrelated historical text:

```yaml
# docs/sdk/browser-environment-foundation.md metadata after all implementation gates pass
status: approved
implementation-status: implemented
last-updated: 2026-07-30
```

```markdown
<!-- README.md / system-overview.md / sdk-architecture.md current-state sentence -->
真实 SDK 包现包括 `@aurora/core` 与 `@aurora/browser`：Browser 的浏览器环境能力与页面生命周期基础第一增量已经实现；错误、请求、性能、资源和行为插件仍不存在，传输与框架适配仍不存在。
```

```markdown
<!-- monorepo-and-build.md layer/command evidence -->
- `sdk-browser` 只允许依赖 `sdk-core` 与 `protocol`；Core 不允许反向依赖 Browser。
- Browser 真实浏览器门禁：`pnpm --filter @aurora/browser test:browser`，本地只运行 Chromium。
```

```markdown
<!-- test-strategy.md module gate -->
`@aurora/browser` 因直接管理宿主监听器与异常隔离，采用 lines 85%、branches 80%、functions 85%、statements 85%；单元测试之外必须通过本地 Chromium 生命周期、释放、宿主身份与多实例门禁。
```

```markdown
<!-- ADR-003 implementation evidence; metadata remains accepted / in-progress -->
- `@aurora/browser` 已实现浏览器环境探测、脱敏页面快照、页面可见性与 `visibilitychange`/`pagehide`/`pageshow` 生命周期资源管理；它没有实现具体插件或扩展 Core 环境端口，因此 SDK 分层与插件架构整体仍为 in-progress。
```

```markdown
<!-- ADR-006 implementation evidence; metadata remains accepted / in-progress -->
- Workspace Policy 已加入 `sdk-browser -> sdk-core | protocol` 允许矩阵及反向、插件/框架、私有路径、循环、模块可变状态和宿主修改负例；`@aurora/browser` 本增量实际保持零 Aurora 本地运行时依赖。
```

In `formalization-readiness.md`、`AGENTS.md`、`AURORA_RULES.md`, replace only the current implementation inventory and next-decision queue so they say the same Browser fact and retain these exact statuses:

```text
ADR-003 accepted / in-progress
ADR-005 accepted / in-progress
ADR-006 accepted / in-progress
ADR-007 accepted / implemented
```

Do not mark the whole SDK/plugin architecture implemented and do not create a new ADR.

- [ ] **Step 5: 接入根格式、Lint、覆盖率、包入口和 Chromium 门禁**

Extend the existing root scripts without renaming them:

```json
{
  "format:check": "prettier --check package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json tooling/workspace-policy/package.json tooling/workspace-policy/tsconfig.json tooling/workspace-policy/tsconfig.build.json packages/event-schema/package.json packages/event-schema/tsconfig.json packages/event-schema/tsconfig.build.json packages/event-schema/vitest.config.ts packages/core/package.json packages/core/tsconfig.json packages/core/tsconfig.build.json packages/core/tsconfig.no-dom.json packages/core/vitest.config.ts packages/browser/package.json packages/browser/tsconfig.json packages/browser/tsconfig.build.json packages/browser/vitest.config.ts packages/browser/playwright.config.ts \"tooling/workspace-policy/src/**/*.ts\" \"tooling/workspace-policy/test/**/*.ts\" \"packages/event-schema/src/**/*.ts\" \"packages/event-schema/test/**/*.ts\" \"packages/core/src/**/*.ts\" \"packages/core/test/**/*.ts\" \"packages/browser/src/**/*.ts\" \"packages/browser/test/**/*.ts\" \"packages/browser/test-browser/**/*.ts\" tooling/workspace-policy/README.md packages/event-schema/README.md packages/core/README.md packages/browser/README.md README.md AGENTS.md AURORA_RULES.md docs/architecture/system-overview.md docs/architecture/sdk-architecture.md docs/architecture/monorepo-and-build.md docs/architecture/formalization-readiness.md docs/protocol/event-schema-foundation.md docs/protocol/event-envelope-v1.md docs/sdk/sdk-core-foundation.md docs/sdk/browser-environment-foundation.md docs/testing/test-strategy.md docs/adr/ADR-003-sdk-plugin-architecture.md docs/adr/ADR-006-one-way-dependencies.md",
  "lint": "eslint tooling/workspace-policy/src tooling/workspace-policy/test packages/event-schema/src packages/event-schema/test packages/event-schema/vitest.config.ts packages/core/src packages/core/test packages/core/vitest.config.ts packages/browser/src packages/browser/test packages/browser/test-browser packages/browser/vitest.config.ts packages/browser/playwright.config.ts",
  "test:coverage": "pnpm --filter @aurora/event-schema test:coverage && pnpm --filter @aurora/core test:coverage && pnpm --filter @aurora/browser test:coverage",
  "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:coverage && pnpm check:boundaries && pnpm build && pnpm --filter @aurora/event-schema test:package && pnpm --filter @aurora/core test:package && pnpm --filter @aurora/browser test:package && pnpm --filter @aurora/browser test:browser",
  "check:ci": "pnpm check"
}
```

After editing, inspect `package.json` and prove no existing root path or command was lost.

- [ ] **Step 6: 确认文档契约和 Browser 覆盖率**

Run:

```bash
pnpm --filter @aurora/browser exec vitest run test/documentation-contract.test.ts
pnpm --filter @aurora/browser test:coverage
pnpm --filter @aurora/browser test:package
pnpm --filter @aurora/browser test:browser
```

Expected: all exit `0`；documentation contract passes；coverage summary reports lines `>=85`、branches `>=80`、functions `>=85`、statements `>=85`；package entry and `5 passed` Chromium suite remain green。

- [ ] **Step 7: 运行完整质量门禁**

Run each command separately and retain complete output:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm build
pnpm --filter @aurora/event-schema test:package
pnpm --filter @aurora/core test:package
pnpm --filter @aurora/browser test:package
pnpm --filter @aurora/browser test:browser
pnpm check:ci
```

Expected: every command exits `0`。`pnpm check:ci` repeats the complete local gate and must include Browser coverage, built entry and Chromium；no CI workflow, plugin, proxy, queue, transport, framework, server or infrastructure file appears。

- [ ] **Step 8: 检查最终 diff、状态与排除范围**

Run:

```bash
git diff --check
git diff -- packages/browser tooling/workspace-policy package.json pnpm-lock.yaml eslint.config.mjs README.md docs AGENTS.md AURORA_RULES.md
git status --short --branch
git diff --cached --stat
```

Expected: `git diff --check` exit `0`；diff 只含本计划列出的 Browser、策略、根配置和文档变更；既有用户修改仍在；暂存区与执行前授权一致。Search the implementation diff and require zero matches for these forbidden scopes:

```bash
git diff -- packages/browser | Select-String -Pattern 'window\.onerror\s*=|window\.onunhandledrejection\s*=|fetch\s*=|XMLHttpRequest\s*=|history\.(pushState|replaceState)\s*=|localStorage|sessionStorage|document\.cookie|CorePlugin|react|vue'
```

Expected: no output and exit behavior consistent with no matches。Then compare the implementation against all 23 sections of `docs/sdk/browser-environment-foundation.md` and record Task mapping in the implementation report。

- [ ] **Step 9: 记录建议提交边界**

建议提交信息：`docs(browser): record foundation evidence and quality gates`。仅在执行会话获得 Git 授权时提交 Task 7 文件；不得把用户已有无关修改混入。

---

## Task-to-Spec Traceability

| 正式规格要求 | 实施 Task |
|---|---|
| 包职责、非职责、出口、依赖方向 | 1、4、7 |
| 安全环境检测与能力缺失 | 2 |
| URL、UA、可见性、Unix/性能时间 | 3 |
| 三类生命周期事件与稳定联合类型 | 2、4 |
| 订阅、原子回滚、取消、重复取消 | 4 |
| 销毁、重复销毁、销毁后失败 | 4 |
| getter/监听器/回调异常隔离 | 2、3、4、5 |
| 100 条脱敏诊断 | 2、5 |
| 无全局可变单例、多实例隔离 | 1、5 |
| 不覆盖宿主、不改原型、不代理原生 API | 5、6 |
| strict 类型、命名、单一职责、最小 API | 1—5 |
| Node 导入、单元、包入口测试 | 2—5 |
| Chromium 真实浏览器范围 | 6 |
| 85/80/85/85 覆盖率 | 1、7 |
| README、架构、测试、入口状态 | 7 |
| ADR-003/006 证据且状态不升级 | 7 |
| 插件、代理、传输、框架等排除 | Global Constraints、5—7 |

## Suggested Review and Commit Boundaries

每个 Task 是独立评审边界：Task 1 审包与依赖；Task 2 审全局访问；Task 3 审隐私快照；Task 4 审资源状态机；Task 5 审宿主安全/隔离；Task 6 审 Chromium；Task 7 审文档和总门禁。建议提交只在执行会话获得用户授权时采用；没有授权时，实施者必须保留未暂存修改并在最终报告中列出相同边界。

## Completion Definition

只有当 Task 1—7 全部完成、每个红灯原因被实际观察、所有任务级回归和完整质量门禁均以新鲜输出通过、规格/README/ADR 证据同步且最终 diff 无排除能力时，才能报告 Browser 基础第一增量已实施。计划本身的存在不得改变 ADR 状态或声称 Browser 代码存在。
