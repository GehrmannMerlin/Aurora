# SDK Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first independently verifiable `@aurora/core` increment: an environment-neutral SDK Core with explicit lifecycle, minimal immutable configuration, plugin orchestration and isolation, an `@aurora/event-schema`-validated event entry, per-instance diagnostics, and executable architecture boundaries.

**Architecture:** `createCore()` owns all mutable state per instance. Public lifecycle calls are serialized per instance, plugins initialize/start in registration order and stop/destroy in reverse order, and plugin failures are quarantined without escaping to the host. `submitEvent(input: unknown)` only gates lifecycle and delegates validation to the public `@aurora/event-schema` root export; it does not retain, fan out, sample, queue, send, or persist events.

**Tech Stack:** Node.js 24.18.0, pnpm 11.17.0 Workspace, TypeScript 6.0.3 with strict/no-DOM compilation, ESM/NodeNext, Vitest 4.1.10 with V8 coverage, ESLint 10.8.0, Prettier 3.9.6, and the existing `@aurora/workspace-policy` and `@aurora/event-schema` packages.

## Global Constraints

- Implement only [the approved Core foundation specification](../../sdk/sdk-core-foundation.md). Re-read `AGENTS.md`, `AURORA_RULES.md`, the triggered long-term norms, ADR-003/005/006/007, and that specification before changing files.
- Preserve every pre-existing modification and untracked file. Do not reset, checkout, clean, rebase, or rewrite unrelated work. Stage or commit only this plan's files if the user separately authorizes Git actions.
- Do not implement Browser, concrete collection plugins, React/Vue adapters, sampling, queues, batches, transport, retry/backoff, persistence, ingestion, server, CI, release, containers, IaC, or cloud resources.
- Do not add a generic event bus, empty queue, empty transporter, storage interface, dependency-injection container, global logger, default singleton, or speculative extension layer.
- The only Core runtime dependency is `@aurora/event-schema: workspace:*`; import it only through `@aurora/event-schema`.
- Keep TypeScript `strict`, treat caller/plugin data as `unknown`, explicitly type every public parameter and return, and do not use unexplained `any`, `Function`, `Object`, `Record<string, any>`, non-null assertions, or broad unchecked assertions.
- Keep source filenames kebab-case; types/interfaces/classes PascalCase; functions/variables camelCase; booleans prefixed with `is`, `has`, `can`, or `should`.
- Keep each file and function single-purpose. Do not add `utils`, `helpers`, `common`, or `misc` modules.
- Core source must not reference DOM libraries, `window`, `document`, `navigator`, `location`, `fetch`, `XMLHttpRequest`, Web Storage, DOM types, or module-level mutable state.
- Public calls must not unexpectedly throw because of invalid input, hostile property access, synchronous plugin exceptions, or rejected plugin promises. Return a discriminated result and add a bounded, non-sensitive diagnostic.
- Use strict TDD in every task: add the named failing test, run it and inspect the expected failure, add the smallest named implementation, rerun to green, run the task regression, inspect the diff, then record the suggested commit boundary without committing unless separately authorized.
- Do not weaken or delete existing tests, exclude Core source from coverage, change accepted decisions, or claim an ADR implemented beyond the evidence produced here.
- ADR state changes are implementation evidence, not planning evidence. Only Task 7 may move ADR-003 to `in-progress`, and only after the complete fresh gate passes. ADR-005/006 remain `in-progress`; ADR-007 remains `implemented`.

## Explicitly Inapplicable Rules for This Increment

- Browser proxy restoration, DOM listener cleanup, real-browser matrices, framework compatibility, accessibility, and UI state rules do not apply because the increment forbids Browser, DOM, framework, and UI code. No-DOM compilation, forbidden-global checks, and plugin lifecycle cleanup are the matching gates.
- HTTP cancellation, retry/backoff, batch limits, queue pressure, offline storage, and delivery semantics do not apply because no network, queue, timer, batch, or persistence interface exists. Adding inert implementations to satisfy those rules would violate the approved exclusions.
- Database migration, OpenAPI, service integration, deployment, container, release, and CI workflow rules do not apply because this is a private SDK library increment with no service or infrastructure artifact. The existing local `check:ci` command remains the quality entry; no remote workflow is created.
- Browser end-to-end, ingestion contract, and processing-consumer tests do not apply because Core has no such consumer boundary. Unit behavior, public package entry, event-schema validation, Workspace negative fixtures, and no-DOM consumer compilation are required instead.
- SDK gzip size and runtime performance budgets remain unreported because the approved Workspace currently emits TypeScript library output without an approved bundler or benchmark harness. Do not claim a comparable size or timing from raw `dist` files.

## Frozen Public API

The implementation must expose exactly these names from `@aurora/core`; task-local additions must converge on these signatures without renaming an earlier symbol:

```ts
import type { EventSchemaIssue } from '@aurora/event-schema';

export type CoreLifecycleState =
  | 'created'
  | 'initialized'
  | 'started'
  | 'stopped'
  | 'destroyed';

export interface CoreConfigInput {
  readonly maxDiagnosticEntries?: number;
}

export interface CoreConfigSnapshot {
  readonly maxDiagnosticEntries: number;
}

export type CoreLifecycleSuccessCode =
  | 'initialized'
  | 'already_initialized'
  | 'started'
  | 'already_started'
  | 'stopped'
  | 'already_stopped'
  | 'destroyed'
  | 'already_destroyed';

export type CoreLifecycleFailureCode =
  | 'invalid_configuration'
  | 'configuration_locked'
  | 'not_initialized'
  | 'destroyed'
  | 'internal_error';

export interface CoreLifecycleSuccess {
  readonly ok: true;
  readonly code: CoreLifecycleSuccessCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export interface CoreLifecycleFailure {
  readonly ok: false;
  readonly code: CoreLifecycleFailureCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export type CoreLifecycleResult = CoreLifecycleSuccess | CoreLifecycleFailure;

export type CoreConfigUpdateFailureCode =
  | 'invalid_configuration'
  | 'configuration_locked'
  | 'not_initialized'
  | 'destroyed';

export interface CoreConfigUpdateSuccess {
  readonly ok: true;
  readonly code: 'configuration_updated';
  readonly state: 'initialized' | 'stopped';
  readonly config: CoreConfigSnapshot;
  readonly diagnosticsAdded: 0;
}

export interface CoreConfigUpdateFailure {
  readonly ok: false;
  readonly code: CoreConfigUpdateFailureCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export type CoreConfigUpdateResult = CoreConfigUpdateSuccess | CoreConfigUpdateFailure;

export interface CorePluginContext {
  readonly submitEvent: (input: unknown) => CoreEventResult;
}

export interface CorePlugin {
  readonly name: string;
  initialize(context: CorePluginContext): void | Promise<void>;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  destroy(): void | Promise<void>;
}

export interface CorePluginRegistrationSuccess {
  readonly ok: true;
  readonly code: 'registered';
  readonly pluginName: string;
  readonly state: 'created';
  readonly diagnosticsAdded: 0;
}

export type CorePluginRegistrationFailureCode =
  | 'invalid_plugin'
  | 'duplicate_plugin'
  | 'registration_closed'
  | 'destroyed';

export interface CorePluginRegistrationFailure {
  readonly ok: false;
  readonly code: CorePluginRegistrationFailureCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export type CorePluginRegistrationResult =
  | CorePluginRegistrationSuccess
  | CorePluginRegistrationFailure;

export interface CoreEventAccepted {
  readonly ok: true;
  readonly code: 'accepted';
  readonly state: 'started';
  readonly diagnosticsAdded: 0;
}

export interface CoreInvalidEvent {
  readonly ok: false;
  readonly code: 'invalid_event';
  readonly state: 'started';
  readonly issues: readonly EventSchemaIssue[];
  readonly diagnosticsAdded: 1;
}

export interface CoreInactiveEvent {
  readonly ok: false;
  readonly code: 'not_started';
  readonly state: 'created' | 'initialized' | 'stopped';
  readonly diagnosticsAdded: 1;
}

export interface CoreDestroyedEvent {
  readonly ok: false;
  readonly code: 'destroyed';
  readonly state: 'destroyed';
  readonly diagnosticsAdded: 1;
}

export interface CoreEventInternalFailure {
  readonly ok: false;
  readonly code: 'internal_error';
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: 1;
}

export type CoreEventResult =
  | CoreEventAccepted
  | CoreInvalidEvent
  | CoreInactiveEvent
  | CoreDestroyedEvent
  | CoreEventInternalFailure;

export type CoreDiagnosticCode =
  | 'invalid_configuration'
  | 'configuration_locked'
  | 'invalid_lifecycle_call'
  | 'invalid_plugin'
  | 'duplicate_plugin'
  | 'plugin_initialize_failed'
  | 'plugin_start_failed'
  | 'plugin_stop_failed'
  | 'plugin_destroy_failed'
  | 'invalid_event'
  | 'event_rejected'
  | 'internal_error';

export type CoreDiagnosticOperation =
  | 'initialize'
  | 'update_config'
  | 'register_plugin'
  | 'start'
  | 'stop'
  | 'destroy'
  | 'submit_event';

export interface CoreDiagnostic {
  readonly sequence: number;
  readonly code: CoreDiagnosticCode;
  readonly operation: CoreDiagnosticOperation;
  readonly pluginName?: string;
}

export interface AuroraCore {
  getState(): CoreLifecycleState;
  getConfig(): CoreConfigSnapshot | null;
  getDiagnostics(): readonly CoreDiagnostic[];
  registerPlugin(input: unknown): CorePluginRegistrationResult;
  initialize(input?: unknown): Promise<CoreLifecycleResult>;
  updateConfig(input: unknown): CoreConfigUpdateResult;
  start(): Promise<CoreLifecycleResult>;
  stop(): Promise<CoreLifecycleResult>;
  destroy(): Promise<CoreLifecycleResult>;
  submitEvent(input: unknown): CoreEventResult;
}

export function createCore(): AuroraCore;
export type { EventSchemaIssue } from '@aurora/event-schema';
```

## Complete File Tree and Single Responsibilities

```text
.
├── AGENTS.md                                  # Current project status and ordered implementation gate
├── AURORA_RULES.md                            # Durable current-state snapshot and decision queue
├── README.md                                  # Repository-level implemented-module truth
├── eslint.config.mjs                          # Core typed lint and forbidden browser-global rules
├── package.json                               # Root task graph including Core checks
├── pnpm-lock.yaml                             # Frozen Core Workspace importer; no new external package
├── docs/
│   ├── README.md                              # Formal-document index
│   ├── sdk/sdk-core-foundation.md             # Approved source specification; do not reinterpret it
│   ├── architecture/sdk-architecture.md       # Actual Core implementation boundary after Task 7
│   ├── architecture/formalization-readiness.md# Actual readiness and remaining SDK blockers
│   └── adr/
│       ├── README.md                           # ADR status index
│       ├── ADR-003-sdk-plugin-architecture.md  # Core-first implementation evidence
│       ├── ADR-005-event-schema-source-of-truth.md # First real SDK consumer evidence
│       └── ADR-006-one-way-dependencies.md     # Core dependency/environment enforcement evidence
├── packages/core/
│   ├── README.md                              # Module API, lifecycle, privacy, and exclusions
│   ├── package.json                           # Private ESM package and root-only export
│   ├── tsconfig.json                          # Strict source/test type checking without DOM
│   ├── tsconfig.build.json                    # Declaration/source build boundary
│   ├── tsconfig.no-dom.json                   # Public-consumer no-DOM proof
│   ├── vitest.config.ts                       # Core coverage gate 85/80/85/85
│   ├── src/
│   │   ├── configuration.ts                   # Runtime config validation and immutable snapshots
│   │   ├── core.ts                            # Per-instance public orchestration only
│   │   ├── diagnostics.ts                     # Per-instance bounded safe diagnostic store
│   │   ├── event-entry.ts                     # Lifecycle gate plus event-schema parser boundary
│   │   ├── index.ts                           # Sole package public export
│   │   ├── lifecycle.ts                       # Public lifecycle types and result constructors
│   │   ├── plugin-contract.ts                 # Public plugin types plus runtime hook snapshot
│   │   └── plugin-registry.ts                 # Ordered hook execution and quarantine state
│   └── test/
│       ├── architecture-boundary.test.ts       # Manifest and no-DOM configuration contract
│       ├── configuration.test.ts              # Config defaults, invalid input, immutability, updates
│       ├── documentation-contract.test.ts      # README snippets and bounded claims
│       ├── event-entry.test.ts                 # Event acceptance/rejection and non-mutation
│       ├── host-safety.test.ts                 # Throw/rejection/proxy containment and safe diagnostics
│       ├── lifecycle.test.ts                   # Public state machine and serialized repeats
│       ├── multi-instance.test.ts              # Independent state/config/plugins/diagnostics
│       ├── no-dom-consumer.ts                  # Public API compile fixture without DOM
│       ├── package-entry.test.ts               # Built root import and private-path rejection
│       ├── plugin-lifecycle.test.ts            # Hook order, failures, quarantine, cleanup
│       └── plugin-registration.test.ts         # Runtime contract, duplicates, registration closure
└── tooling/workspace-policy/
    ├── README.md                               # Document new sdk-core source/layer policy
    ├── src/
    │   ├── check-workspace.ts                  # Compose dependency and source policies
    │   ├── environment.ts                      # Core forbidden-global and mutable-module scan
    │   ├── graph.ts                            # sdk-core can depend only on protocol
    │   ├── imports.ts                          # Reusable TypeScript source discovery
    │   └── types.ts                            # Stable new violation codes
    └── test/
        ├── core-package-contract.test.ts       # Real Core manifest/root-export contract
        ├── dependency-policy.test.ts           # Allowed protocol and rejected layer fixtures
        └── environment.test.ts                 # Positive and negative Core source fixtures
```

## Task 1: Create the Package Shell and Executable Architecture Guardrails

**Consumes:** Approved Core specification sections 5, 13, and 14; implemented ADR-006/007 tooling; current root tasks and `@aurora/event-schema` package manifest.

**Produces:** A private, buildable `@aurora/core` shell; no-DOM compiler fixture; `sdk-core → protocol` dependency rule; Core forbidden-runtime-global and module-mutable-state checks; typed lint coverage; no lifecycle behavior yet.

**Files:**

- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/tsconfig.build.json`
- Create: `packages/core/tsconfig.no-dom.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/architecture-boundary.test.ts`
- Create: `packages/core/test/no-dom-consumer.ts`
- Create: `tooling/workspace-policy/src/environment.ts`
- Create: `tooling/workspace-policy/test/environment.test.ts`
- Modify: `tooling/workspace-policy/src/imports.ts`
- Modify: `tooling/workspace-policy/src/graph.ts`
- Modify: `tooling/workspace-policy/src/check-workspace.ts`
- Modify: `tooling/workspace-policy/src/types.ts`
- Modify: `tooling/workspace-policy/test/dependency-policy.test.ts`
- Create: `tooling/workspace-policy/test/core-package-contract.test.ts`
- Modify: `eslint.config.mjs`
- Modify: `pnpm-lock.yaml`

### Step 1: Write failing Workspace and environment-policy tests

- [ ] Extend `tooling/workspace-policy/test/dependency-policy.test.ts` with explicit Core layer fixtures, using its existing `fixture`, `createWorkspaceFixture`, `validManifest`, and `afterEach` cleanup:

```ts
it('allows sdk-core to depend on protocol', async () => {
  const core = validManifest('@aurora/core');
  core.aurora = { layer: 'sdk-core' };
  core.dependencies = { '@aurora/event-schema': 'workspace:*' };
  const protocol = validManifest('@aurora/event-schema');
  protocol.aurora = { layer: 'protocol' };
  fixture = await createWorkspaceFixture([
    { directory: 'packages/core', manifest: core },
    { directory: 'packages/event-schema', manifest: protocol },
  ]);

  await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({ ok: true, violations: [] });
});

it.each(['sdk-browser', 'sdk-plugin', 'framework', 'tooling'] as const)(
  'rejects an sdk-core dependency on %s',
  async (targetLayer) => {
    const core = validManifest('@aurora/core');
    core.aurora = { layer: 'sdk-core' };
    core.dependencies = { '@aurora/forbidden': 'workspace:*' };
    const forbidden = validManifest('@aurora/forbidden');
    forbidden.aurora = { layer: targetLayer };
    fixture = await createWorkspaceFixture([
      { directory: 'packages/core', manifest: core },
      { directory: 'packages/forbidden', manifest: forbidden },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ packageName: '@aurora/core', code: 'forbidden-layer-dependency' }),
      ]),
    );
  },
);
```

- [ ] Create `tooling/workspace-policy/test/environment.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { checkWorkspace } from '../src/check-workspace.js';
import { createWorkspaceFixture, type WorkspaceFixture, validManifest } from './fixtures.js';

let fixture: WorkspaceFixture | undefined;

afterEach(async () => fixture?.dispose());

async function createCoreSource(source: string): Promise<WorkspaceFixture> {
  const core = validManifest('@aurora/core');
  core.aurora = { layer: 'sdk-core' };
  return createWorkspaceFixture([
    { directory: 'packages/core', manifest: core, files: { 'src/index.ts': source } },
  ]);
}

describe('sdk-core source policy', () => {
  it('accepts immutable module constants and per-factory mutable state', async () => {
    fixture = await createCoreSource(
      "const defaultLimit = 100; export function createValue(): number { let value = defaultLimit; value += 1; return value; }",
    );
    await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({ ok: true, violations: [] });
  });

  it.each([
    'window',
    'document',
    'navigator',
    'location',
    'fetch',
    'XMLHttpRequest',
    'localStorage',
    'sessionStorage',
    'Document',
    'Storage',
    'EventTarget',
    'HTMLElement',
  ])(
    'rejects the browser global %s',
    async (identifier) => {
      fixture = await createCoreSource(`export const leaked = ${identifier};`);
      const result = await checkWorkspace(fixture.rootDir);
      expect(result.violations).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'forbidden-runtime-global' })]),
      );
    },
  );

  it('rejects computed access to a browser global', async () => {
    fixture = await createCoreSource("export const leaked = globalThis['window'];");
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'forbidden-runtime-global' })]),
    );
  });

  it.each([
    'let shared = 0; export function read(): number { return shared; }',
    'var shared = 0; export function read(): number { return shared; }',
    'const shared = new Map<string, number>(); export function read(): number { return shared.size; }',
    'const shared: number[] = []; export function read(): number { return shared.length; }',
    'const shared = { value: 1 }; export function read(): number { return shared.value; }',
  ])('rejects module-level mutable state', async (source) => {
    fixture = await createCoreSource(source);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'mutable-module-state' })]),
    );
  });
});
```

- [ ] Create `tooling/workspace-policy/test/core-package-contract.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

async function readManifest(): Promise<Record<string, unknown>> {
  const text = await readFile(new URL('../../../packages/core/package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new TypeError('core package.json must be an object');
  return parsed;
}

describe('core package contract', () => {
  it('is private, sdk-core layered, and depends only on event-schema', async () => {
    const manifest = await readManifest();
    expect(manifest).toMatchObject({
      name: '@aurora/core',
      version: '0.0.0',
      private: true,
      type: 'module',
      sideEffects: false,
      engines: { node: '>=24.18.0 <25' },
      aurora: { layer: 'sdk-core' },
      dependencies: { '@aurora/event-schema': 'workspace:*' },
    });
    expect(Object.keys(isRecord(manifest.dependencies) ? manifest.dependencies : {})).toEqual([
      '@aurora/event-schema',
    ]);
  });

  it('exposes only the package root', async () => {
    const manifest = await readManifest();
    expect(manifest.exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    });
  });
});
```

### Step 2: Run the red tests and confirm the intended failures

- [ ] Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts test/dependency-policy.test.ts test/core-package-contract.test.ts
```

Expected: non-zero exit. The environment suite initially fails because the new file/export and violation codes do not exist; the real package contract fails because `packages/core/package.json` does not exist. Do not accept a syntax, import-path, or unrelated existing-test failure as the red result.

### Step 3: Implement the package shell

- [ ] Create `packages/core/package.json` exactly as follows:

```json
{
  "name": "@aurora/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Aurora environment-neutral SDK Core foundation",
  "sideEffects": false,
  "engines": {
    "node": ">=24.18.0 <25"
  },
  "aurora": {
    "layer": "sdk-core"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run --exclude test/package-entry.test.ts",
    "test:coverage": "vitest run --coverage --exclude test/package-entry.test.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.no-dom.json --noEmit"
  },
  "dependencies": {
    "@aurora/event-schema": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "@vitest/coverage-v8": "4.1.10",
    "typescript": "6.0.3",
    "vitest": "4.1.10"
  }
}
```

- [ ] Create strict package configs:

`packages/core/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

`packages/core/tsconfig.build.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "types": []
  },
  "include": ["src/**/*.ts"]
}
```

`packages/core/tsconfig.no-dom.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": []
  },
  "include": ["src/**/*.ts", "test/no-dom-consumer.ts"]
}
```

`packages/core/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 85,
        statements: 85,
      },
    },
  },
});
```

`packages/core/src/index.ts`

```ts
export {};
```

`packages/core/test/no-dom-consumer.ts`

```ts
import '../src/index.js';

export {};
```

- [ ] Create `packages/core/test/architecture-boundary.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readJson(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  return parsed;
}

describe('Core architecture configuration', () => {
  it('declares only the protocol runtime dependency', async () => {
    await expect(readJson('../package.json')).resolves.toMatchObject({
      dependencies: { '@aurora/event-schema': 'workspace:*' },
      aurora: { layer: 'sdk-core' },
    });
  });

  it('keeps the public consumer compiler free of DOM types', async () => {
    await expect(readJson('../tsconfig.no-dom.json')).resolves.toMatchObject({
      compilerOptions: { types: [] },
      include: ['src/**/*.ts', 'test/no-dom-consumer.ts'],
    });
    const base = JSON.stringify(await readJson('../../../tsconfig.base.json'));
    expect(base).toContain('ES2024');
    expect(base).not.toContain('DOM');
  });
});
```

The empty root is temporary only within this accepted package-shell task; Task 2 replaces it with real Core exports before any root quality gate is claimed.

### Step 4: Implement executable Core source policy

- [ ] Add these stable codes to `WorkspaceViolationCode` in `tooling/workspace-policy/src/types.ts`:

```ts
export type WorkspaceViolationCode =
  | 'invalid-package-name'
  | 'missing-package-field'
  | 'non-workspace-local-dependency'
  | 'undeclared-dependency'
  | 'dependency-cycle'
  | 'private-path-import'
  | 'forbidden-layer-dependency'
  | 'forbidden-runtime-global'
  | 'mutable-module-state';
```

Retain every currently implemented code even if its exact existing ordering differs; the final union must contain the two new codes and all old codes.

- [ ] Export the existing TypeScript source discovery function from `tooling/workspace-policy/src/imports.ts` under this exact signature, and use it both in import checking and the new environment checker:

```ts
export async function findTypeScriptSourceFiles(directory: string): Promise<readonly string[]>;
```

Implement it by renaming the existing private `sourceFiles` function, retaining its ENOENT handling and `dist`/`node_modules` exclusions, and changing both recursive calls and `collectAuroraImports` to the exported name:

```ts
export async function findTypeScriptSourceFiles(
  directory: string,
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });
  const nested = await Promise.all(
    entries
      .filter(({ name }) => name !== 'dist' && name !== 'node_modules')
      .map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return findTypeScriptSourceFiles(path);
        return entry.isFile() && path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : [];
      }),
  );
  return nested.flat();
}
```

- [ ] Create `tooling/workspace-policy/src/environment.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { findTypeScriptSourceFiles } from './imports.js';
import type { WorkspacePackage, WorkspaceViolation } from './types.js';

const forbiddenCoreIdentifiers: ReadonlySet<string> = new Set([
  'Document',
  'Element',
  'Event',
  'EventTarget',
  'HTMLElement',
  'Location',
  'Navigator',
  'Node',
  'Storage',
  'Window',
  'XMLHttpRequest',
  'document',
  'fetch',
  'localStorage',
  'location',
  'navigator',
  'sessionStorage',
  'window',
]);

function packageLayer(workspacePackage: WorkspacePackage): string | undefined {
  const value = workspacePackage.manifest.aurora;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  if (!('layer' in value)) return undefined;
  return typeof value.layer === 'string' ? value.layer : undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return unwrapExpression(expression.expression);
  }
  if (ts.isParenthesizedExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function isMutableInitializer(expression: ts.Expression | undefined): boolean {
  if (expression === undefined) return false;
  const unwrapped = unwrapExpression(expression);
  return (
    ts.isNewExpression(unwrapped) ||
    ts.isArrayLiteralExpression(unwrapped) ||
    ts.isObjectLiteralExpression(unwrapped)
  );
}

function inspectSource(
  workspacePackage: WorkspacePackage,
  file: string,
  sourceText: string,
): readonly WorkspaceViolation[] {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const violations: WorkspaceViolation[] = [];

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const hasMutableContainer = statement.declarationList.declarations.some((declaration) =>
      isMutableInitializer(declaration.initializer),
    );
    if (!isConst || hasMutableContainer) {
      violations.push({
        code: 'mutable-module-state',
        packageName: workspacePackage.name,
        file: relative(workspacePackage.directory, file).replaceAll('\\', '/'),
        message: 'sdk-core source must not declare module-level mutable state',
      });
    }
  }

  function visit(node: ts.Node): void {
    const forbiddenName = ts.isIdentifier(node)
      ? node.text
      : ts.isElementAccessExpression(node.parent) &&
          node.parent.argumentExpression === node &&
          ts.isStringLiteralLike(node)
        ? node.text
        : undefined;
    if (forbiddenName !== undefined && forbiddenCoreIdentifiers.has(forbiddenName)) {
      violations.push({
        code: 'forbidden-runtime-global',
        packageName: workspacePackage.name,
        file: relative(workspacePackage.directory, file).replaceAll('\\', '/'),
        message: `sdk-core source must not reference ${forbiddenName}`,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

export async function findEnvironmentViolations(
  workspacePackage: WorkspacePackage,
): Promise<readonly WorkspaceViolation[]> {
  if (packageLayer(workspacePackage) !== 'sdk-core') return [];
  const sourceDirectory = join(workspacePackage.directory, 'src');
  const files = await findTypeScriptSourceFiles(sourceDirectory);
  const groups = await Promise.all(
    files.map(async (file) => inspectSource(workspacePackage, file, await readFile(file, 'utf8'))),
  );
  return groups.flat();
}
```

- [ ] In `tooling/workspace-policy/src/graph.ts`, replace `protocolLayerViolations` with this generalized layer rule and call it exactly once for each package after its local dependency set is built:

```ts
const allowedLocalDependencyLayers: ReadonlyMap<string, ReadonlySet<string>> = new Map<
  string,
  ReadonlySet<string>
>([
  ['protocol', new Set<string>()],
  ['sdk-core', new Set<string>(['protocol'])],
]);

function layerDependencyViolations(
  workspacePackage: WorkspacePackage,
  localDependencies: ReadonlySet<string>,
  packagesByName: ReadonlyMap<string, WorkspacePackage>,
): readonly WorkspaceViolation[] {
  const sourceLayer = packageLayer(workspacePackage);
  if (sourceLayer === undefined) return [];
  const allowedTargets = allowedLocalDependencyLayers.get(sourceLayer);
  if (allowedTargets === undefined) return [];
  return [...localDependencies]
    .sort()
    .flatMap((dependency) => {
      const target = packagesByName.get(dependency);
      const targetLayer = target === undefined ? undefined : packageLayer(target);
      if (targetLayer !== undefined && allowedTargets.has(targetLayer)) return [];
      return [
        {
          code: 'forbidden-layer-dependency' as const,
          dependency,
          packageName: workspacePackage.name,
          message: `${sourceLayer} package must not depend on ${targetLayer ?? 'unclassified'} package ${dependency}`,
        },
      ];
    });
}
```

Replace the old call with `violations.push(...layerDependencyViolations(workspacePackage, localDependencies, byName));`. Do not remove undeclared-dependency, private-import, manifest, or cycle checks.

- [ ] In `tooling/workspace-policy/src/check-workspace.ts`, call `findEnvironmentViolations` for every discovered package, merge those findings with the existing manifest/import/graph findings, and pass the combined list through the existing stable sorter.

### Step 5: Wire typed Core linting without changing root task scope yet

- [ ] Add `'packages/core/**/*.ts'` to the current shared typed block's `files` array so Core source, tests, and `vitest.config.ts` use its existing `projectService: true`, `consistent-type-imports`, `no-explicit-any`, and `no-non-null-assertion` rules. Then add this source-only override after that block:

```js
{
  files: ['packages/core/src/**/*.ts'],
  rules: {
    'no-restricted-globals': [
      'error',
      'window',
      'document',
      'navigator',
      'location',
      'fetch',
      'XMLHttpRequest',
      'localStorage',
      'sessionStorage',
    ],
  },
}
```

Preserve every existing shared rule and path. Root formatting, lint, coverage, and package-entry task wiring is delayed until Task 7, when every referenced Core file and test exists; the recursive root typecheck/test/build commands discover the package immediately.

- [ ] Run `pnpm install --lockfile-only` to add the `packages/core` importer to `pnpm-lock.yaml`; no external version may change and no new external package may appear.

### Step 6: Run green and task-level regression

- [ ] Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts test/dependency-policy.test.ts test/core-package-contract.test.ts
pnpm --filter @aurora/workspace-policy typecheck
pnpm exec eslint tooling/workspace-policy/src tooling/workspace-policy/test
pnpm --filter @aurora/core test
pnpm --filter @aurora/core typecheck
pnpm check:boundaries
```

Expected: every command exits `0`; Vitest reports all named files passed; `tsc` prints no diagnostics; the boundary command reports no violations for the real Workspace.

- [ ] Inspect `git diff -- packages/core tooling/workspace-policy eslint.config.mjs pnpm-lock.yaml` and `git status --short --untracked-files=all`. Confirm only Task 1 files changed and all pre-existing work remains present.

**Suggested commit boundary:** `feat(core): establish package and architecture boundaries`

## Task 2: Implement Immutable Configuration and Bounded Diagnostics

**Consumes:** Task 1 package shell; approved Core specification sections 6.1, 6.4, 7, and 11; root strict TypeScript settings.

**Produces:** Fully tested configuration parsing/snapshot behavior and a per-instance bounded diagnostic store. This task exposes only the frozen public value types; it does not expose a Core factory or lifecycle behavior.

**Files:**

- Create: `packages/core/src/configuration.ts`
- Create: `packages/core/src/diagnostics.ts`
- Create: `packages/core/src/lifecycle.ts`
- Create: `packages/core/test/configuration.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/no-dom-consumer.ts`

### Step 1: Write failing value-behavior tests

- [ ] Create `packages/core/test/configuration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseConfigurationUpdate, parseInitialConfiguration } from '../src/configuration.js';
import { DiagnosticStore } from '../src/diagnostics.js';

describe('Core configuration', () => {
  it('uses the immutable default when configuration is absent', () => {
    const result = parseInitialConfiguration(undefined);
    expect(result).toEqual({ ok: true, config: { maxDiagnosticEntries: 100 } });
    if (!result.ok) throw new Error('expected valid configuration');
    expect(Object.isFrozen(result.config)).toBe(true);
  });

  it('treats an empty initial object as having no required fields', () => {
    expect(parseInitialConfiguration({})).toEqual({
      ok: true,
      config: { maxDiagnosticEntries: 100 },
    });
  });

  it('copies and freezes a valid caller configuration', () => {
    const input = { maxDiagnosticEntries: 7 };
    const result = parseInitialConfiguration(input);
    input.maxDiagnosticEntries = 9;
    expect(result).toEqual({ ok: true, config: { maxDiagnosticEntries: 7 } });
    if (!result.ok) throw new Error('expected valid configuration');
    expect(Reflect.set(result.config, 'maxDiagnosticEntries', 11)).toBe(false);
  });

  it.each([
    null,
    [],
    () => undefined,
    { maxDiagnosticEntries: 0 },
    { maxDiagnosticEntries: 1001 },
    { maxDiagnosticEntries: 1.5 },
    { maxDiagnosticEntries: Number.NaN },
    { maxDiagnosticEntries: 5, endpoint: 'not-approved' },
    { [Symbol('unexpected')]: true },
  ])('rejects invalid or expanded initial input %#', (input) => {
    expect(parseInitialConfiguration(input)).toEqual({ ok: false });
  });

  it('rejects hostile property access without throwing', () => {
    const input = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('secret value');
        },
      },
    );
    expect(() => parseInitialConfiguration(input)).not.toThrow();
    expect(parseInitialConfiguration(input)).toEqual({ ok: false });
  });

  it('requires the one approved field for updates', () => {
    expect(parseConfigurationUpdate({})).toEqual({ ok: false });
    expect(parseConfigurationUpdate({ maxDiagnosticEntries: 25 })).toEqual({
      ok: true,
      config: { maxDiagnosticEntries: 25 },
    });
  });
});

describe('Core diagnostics', () => {
  it('keeps the newest entries with an instance-local monotonic sequence', () => {
    const store = new DiagnosticStore(2);
    store.add({ code: 'invalid_event', operation: 'submit_event' });
    store.add({ code: 'plugin_start_failed', operation: 'start', pluginName: 'first-plugin' });
    store.add({ code: 'event_rejected', operation: 'submit_event' });
    expect(store.snapshot()).toEqual([
      { sequence: 2, code: 'plugin_start_failed', operation: 'start', pluginName: 'first-plugin' },
      { sequence: 3, code: 'event_rejected', operation: 'submit_event' },
    ]);
  });

  it('returns frozen copies and trims immediately when capacity shrinks', () => {
    const store = new DiagnosticStore(3);
    store.add({ code: 'invalid_event', operation: 'submit_event' });
    store.add({ code: 'event_rejected', operation: 'submit_event' });
    store.add({ code: 'invalid_plugin', operation: 'register_plugin' });
    store.setCapacity(1);
    const snapshot = store.snapshot();
    expect(snapshot).toEqual([
      { sequence: 3, code: 'invalid_plugin', operation: 'register_plugin' },
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
  });
});
```

### Step 2: Run red

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/configuration.test.ts
```

Expected: non-zero exit with module-resolution failures for `configuration.js` and `diagnostics.js`. A failure caused only by a malformed test is not acceptable.

### Step 3: Implement exact public types and configuration parsing

- [ ] Create `packages/core/src/lifecycle.ts`:

```ts
export type CoreLifecycleState =
  | 'created'
  | 'initialized'
  | 'started'
  | 'stopped'
  | 'destroyed';

export type CoreLifecycleSuccessCode =
  | 'initialized'
  | 'already_initialized'
  | 'started'
  | 'already_started'
  | 'stopped'
  | 'already_stopped'
  | 'destroyed'
  | 'already_destroyed';

export type CoreLifecycleFailureCode =
  | 'invalid_configuration'
  | 'configuration_locked'
  | 'not_initialized'
  | 'destroyed'
  | 'internal_error';

export interface CoreLifecycleSuccess {
  readonly ok: true;
  readonly code: CoreLifecycleSuccessCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export interface CoreLifecycleFailure {
  readonly ok: false;
  readonly code: CoreLifecycleFailureCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export type CoreLifecycleResult = CoreLifecycleSuccess | CoreLifecycleFailure;

export function lifecycleSuccess(
  code: CoreLifecycleSuccessCode,
  state: CoreLifecycleState,
  diagnosticsAdded = 0,
): CoreLifecycleSuccess {
  return Object.freeze({ ok: true, code, state, diagnosticsAdded });
}

export function lifecycleFailure(
  code: CoreLifecycleFailureCode,
  state: CoreLifecycleState,
  diagnosticsAdded: number,
): CoreLifecycleFailure {
  return Object.freeze({ ok: false, code, state, diagnosticsAdded });
}
```

- [ ] Create `packages/core/src/configuration.ts`:

```ts
import type { CoreLifecycleState } from './lifecycle.js';

export interface CoreConfigInput {
  readonly maxDiagnosticEntries?: number;
}

export interface CoreConfigSnapshot {
  readonly maxDiagnosticEntries: number;
}

export type CoreConfigUpdateFailureCode =
  | 'invalid_configuration'
  | 'configuration_locked'
  | 'not_initialized'
  | 'destroyed';

export interface CoreConfigUpdateSuccess {
  readonly ok: true;
  readonly code: 'configuration_updated';
  readonly state: 'initialized' | 'stopped';
  readonly config: CoreConfigSnapshot;
  readonly diagnosticsAdded: 0;
}

export interface CoreConfigUpdateFailure {
  readonly ok: false;
  readonly code: CoreConfigUpdateFailureCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export type CoreConfigUpdateResult = CoreConfigUpdateSuccess | CoreConfigUpdateFailure;

export interface ConfigurationParseSuccess {
  readonly ok: true;
  readonly config: CoreConfigSnapshot;
}

export interface ConfigurationParseFailure {
  readonly ok: false;
}

export type ConfigurationParseResult =
  | ConfigurationParseSuccess
  | ConfigurationParseFailure;

const defaultMaxDiagnosticEntries = 100;
const maximumDiagnosticEntries = 1000;
const allowedKey = 'maxDiagnosticEntries';

function isPlainObject(input: unknown): input is object {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function createSnapshot(maxDiagnosticEntries: number): CoreConfigSnapshot {
  return Object.freeze({ maxDiagnosticEntries });
}

function parseObject(input: unknown, isUpdate: boolean): ConfigurationParseResult {
  try {
    if (!isPlainObject(input)) return { ok: false };
    const keys = Reflect.ownKeys(input);
    if (keys.some((key) => key !== allowedKey)) return { ok: false };
    if (isUpdate && keys.length !== 1) return { ok: false };
    if (!isUpdate && keys.length === 0) {
      return { ok: true, config: createSnapshot(defaultMaxDiagnosticEntries) };
    }
    if (keys.length !== 1 || keys[0] !== allowedKey) return { ok: false };
    const value: unknown = Reflect.get(input, allowedKey);
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > maximumDiagnosticEntries
    ) {
      return { ok: false };
    }
    return { ok: true, config: createSnapshot(value) };
  } catch {
    return { ok: false };
  }
}

export function parseInitialConfiguration(input: unknown): ConfigurationParseResult {
  if (input === undefined) {
    return { ok: true, config: createSnapshot(defaultMaxDiagnosticEntries) };
  }
  return parseObject(input, false);
}

export function parseConfigurationUpdate(input: unknown): ConfigurationParseResult {
  return parseObject(input, true);
}

export function areConfigurationsEqual(
  left: CoreConfigSnapshot,
  right: CoreConfigSnapshot,
): boolean {
  return left.maxDiagnosticEntries === right.maxDiagnosticEntries;
}
```

`Record<string, unknown>` is not needed in Core source. The `object` narrowing is immediately followed by `Reflect`-based key/value validation, and the catch converts hostile proxy traps into the declared failure.

### Step 4: Implement the bounded diagnostic store

- [ ] Create `packages/core/src/diagnostics.ts`:

```ts
export type CoreDiagnosticCode =
  | 'invalid_configuration'
  | 'configuration_locked'
  | 'invalid_lifecycle_call'
  | 'invalid_plugin'
  | 'duplicate_plugin'
  | 'plugin_initialize_failed'
  | 'plugin_start_failed'
  | 'plugin_stop_failed'
  | 'plugin_destroy_failed'
  | 'invalid_event'
  | 'event_rejected'
  | 'internal_error';

export type CoreDiagnosticOperation =
  | 'initialize'
  | 'update_config'
  | 'register_plugin'
  | 'start'
  | 'stop'
  | 'destroy'
  | 'submit_event';

export interface CoreDiagnostic {
  readonly sequence: number;
  readonly code: CoreDiagnosticCode;
  readonly operation: CoreDiagnosticOperation;
  readonly pluginName?: string;
}

export interface DiagnosticInput {
  readonly code: CoreDiagnosticCode;
  readonly operation: CoreDiagnosticOperation;
  readonly pluginName?: string;
}

export class DiagnosticStore {
  readonly #entries: CoreDiagnostic[] = [];
  #capacity: number;
  #nextSequence = 1;

  public constructor(capacity: number) {
    this.#capacity = capacity;
  }

  public add(input: DiagnosticInput): void {
    const common = {
      sequence: this.#nextSequence,
      code: input.code,
      operation: input.operation,
    };
    const entry: CoreDiagnostic =
      input.pluginName === undefined
        ? Object.freeze(common)
        : Object.freeze({ ...common, pluginName: input.pluginName });
    this.#nextSequence += 1;
    this.#entries.push(entry);
    this.trim();
  }

  public setCapacity(capacity: number): void {
    this.#capacity = capacity;
    this.trim();
  }

  public snapshot(): readonly CoreDiagnostic[] {
    return Object.freeze(this.#entries.map((entry) => Object.freeze({ ...entry })));
  }

  private trim(): void {
    const overflow = this.#entries.length - this.#capacity;
    if (overflow > 0) this.#entries.splice(0, overflow);
  }
}
```

### Step 5: Publish only the value types and strengthen the no-DOM fixture

- [ ] Replace `packages/core/src/index.ts` with:

```ts
export type {
  CoreConfigInput,
  CoreConfigSnapshot,
  CoreConfigUpdateFailure,
  CoreConfigUpdateFailureCode,
  CoreConfigUpdateResult,
  CoreConfigUpdateSuccess,
} from './configuration.js';
export type {
  CoreDiagnostic,
  CoreDiagnosticCode,
  CoreDiagnosticOperation,
} from './diagnostics.js';
export type {
  CoreLifecycleFailure,
  CoreLifecycleFailureCode,
  CoreLifecycleResult,
  CoreLifecycleState,
  CoreLifecycleSuccess,
  CoreLifecycleSuccessCode,
} from './lifecycle.js';
```

- [ ] Replace `packages/core/test/no-dom-consumer.ts` with:

```ts
import type {
  CoreConfigInput,
  CoreConfigSnapshot,
  CoreDiagnostic,
  CoreLifecycleState,
} from '../src/index.js';

const input: CoreConfigInput = { maxDiagnosticEntries: 10 };
const snapshot: CoreConfigSnapshot = { maxDiagnosticEntries: input.maxDiagnosticEntries ?? 100 };
const state: CoreLifecycleState = 'created';
const diagnostics: readonly CoreDiagnostic[] = [];

void [snapshot, state, diagnostics];
```

### Step 6: Run green and task-level regression

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/configuration.test.ts
pnpm --filter @aurora/core typecheck
pnpm --filter @aurora/core build
pnpm check:boundaries
```

Expected: every command exits `0`; the configuration test file passes; both normal and no-DOM TypeScript checks print no diagnostics; the Core build emits declarations and JavaScript; boundary policy finds no browser global or module-level mutable state.

- [ ] Inspect the Task 2 diff and status. Confirm no `packages/core` source imports a Browser, plugin, framework, private event-schema path, or new external dependency.

**Suggested commit boundary:** `feat(core): add safe configuration and diagnostics`

## Task 3: Implement the Public Lifecycle State Machine and Configuration Snapshot

**Consumes:** Task 2 configuration, diagnostics, and lifecycle result primitives; approved state/repeat/update semantics.

**Produces:** A public `createCore()` factory with instance-local lifecycle serialization, immutable configuration snapshots, controlled invalid-call results, and idempotent lifecycle behavior. Plugin registration and event submission are added in later tasks without changing these method names or results.

**Files:**

- Create: `packages/core/src/core.ts`
- Create: `packages/core/test/lifecycle.test.ts`
- Create: `packages/core/test/package-entry.test.ts`
- Modify: `packages/core/package.json`
- Modify: `packages/core/test/configuration.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/no-dom-consumer.ts`

### Step 1: Write failing public lifecycle tests

- [ ] Create `packages/core/test/lifecycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';

describe('AuroraCore lifecycle', () => {
  it('creates independent state and initializes once', async () => {
    const core = createCore();
    expect(core.getState()).toBe('created');
    expect(core.getConfig()).toBeNull();

    await expect(core.initialize()).resolves.toEqual({
      ok: true,
      code: 'initialized',
      state: 'initialized',
      diagnosticsAdded: 0,
    });
    expect(core.getState()).toBe('initialized');
    expect(core.getConfig()).toEqual({ maxDiagnosticEntries: 100 });
    expect(Object.isFrozen(core.getConfig())).toBe(true);
  });

  it('keeps created after invalid initialization and permits a valid retry', async () => {
    const core = createCore();
    await expect(core.initialize({ maxDiagnosticEntries: 0 })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_configuration',
      state: 'created',
      diagnosticsAdded: 1,
    });
    expect(core.getState()).toBe('created');
    await expect(core.initialize({ maxDiagnosticEntries: 8 })).resolves.toMatchObject({
      ok: true,
      code: 'initialized',
      state: 'initialized',
    });
  });

  it('distinguishes idempotent initialization from a locked configuration change', async () => {
    const core = createCore();
    await core.initialize({ maxDiagnosticEntries: 8 });
    await expect(core.initialize()).resolves.toMatchObject({ ok: true, code: 'already_initialized' });
    await expect(core.initialize({ maxDiagnosticEntries: 8 })).resolves.toMatchObject({
      ok: true,
      code: 'already_initialized',
    });
    await expect(core.initialize({ maxDiagnosticEntries: 9 })).resolves.toMatchObject({
      ok: false,
      code: 'configuration_locked',
      diagnosticsAdded: 1,
    });
    expect(core.getConfig()).toEqual({ maxDiagnosticEntries: 8 });
  });

  it('starts, stops, restarts, and treats repeats as idempotent', async () => {
    const core = createCore();
    await expect(core.start()).resolves.toMatchObject({ ok: false, code: 'not_initialized' });
    await expect(core.stop()).resolves.toMatchObject({ ok: false, code: 'not_initialized' });
    await core.initialize();
    await expect(core.start()).resolves.toMatchObject({ ok: true, code: 'started' });
    await expect(core.initialize()).resolves.toMatchObject({
      ok: true,
      code: 'already_initialized',
    });
    await expect(core.start()).resolves.toMatchObject({ ok: true, code: 'already_started' });
    await expect(core.stop()).resolves.toMatchObject({ ok: true, code: 'stopped' });
    await expect(core.stop()).resolves.toMatchObject({ ok: true, code: 'already_stopped' });
    await expect(core.start()).resolves.toMatchObject({ ok: true, code: 'started' });
    expect(core.getState()).toBe('started');
  });

  it('destroys from every live state and never revives', async () => {
    for (const prepare of [
      async () => createCore(),
      async () => {
        const core = createCore();
        await core.initialize();
        return core;
      },
      async () => {
        const core = createCore();
        await core.initialize();
        await core.start();
        return core;
      },
      async () => {
        const core = createCore();
        await core.initialize();
        await core.start();
        await core.stop();
        return core;
      },
    ]) {
      const core = await prepare();
      await expect(core.destroy()).resolves.toMatchObject({ ok: true, code: 'destroyed' });
      await expect(core.destroy()).resolves.toMatchObject({ ok: true, code: 'already_destroyed' });
      await expect(core.initialize()).resolves.toMatchObject({ ok: false, code: 'destroyed' });
      await expect(core.start()).resolves.toMatchObject({ ok: false, code: 'destroyed' });
      await expect(core.stop()).resolves.toMatchObject({ ok: false, code: 'destroyed' });
      expect(core.getState()).toBe('destroyed');
    }
  });

  it('serializes concurrent lifecycle calls in invocation order', async () => {
    const core = createCore();
    const results = await Promise.all([
      core.initialize(),
      core.start(),
      core.start(),
      core.stop(),
      core.destroy(),
      core.start(),
    ]);
    expect(results.map(({ code }) => code)).toEqual([
      'initialized',
      'started',
      'already_started',
      'stopped',
      'destroyed',
      'destroyed',
    ]);
  });
});
```

- [ ] Create `packages/core/test/package-entry.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function importFromPackage(specifier: string) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const module = await import(${JSON.stringify(specifier)}); console.log(Object.keys(module).sort().join(','));`,
    ],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  );
}

describe('built Core package entry', () => {
  it('loads the one declared runtime root', () => {
    const result = importFromPackage('@aurora/core');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('createCore');
  });

  it('rejects private and unexported paths', () => {
    for (const specifier of [
      '@aurora/core/src/index.js',
      '@aurora/core/internal/plugin-registry.js',
      '@aurora/core/plugin-registry',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });
});
```

- [ ] Add public configuration-boundary tests to `packages/core/test/configuration.test.ts`:

```ts
import { createCore } from '../src/index.js';

describe('AuroraCore public configuration boundary', () => {
  it('allows updates only while initialized or stopped', async () => {
    const core = createCore();
    expect(core.updateConfig({ maxDiagnosticEntries: 2 })).toMatchObject({
      ok: false,
      code: 'not_initialized',
    });
    await core.initialize();
    expect(core.updateConfig({ maxDiagnosticEntries: 2 })).toMatchObject({
      ok: true,
      code: 'configuration_updated',
      config: { maxDiagnosticEntries: 2 },
    });
    expect(core.updateConfig({ maxDiagnosticEntries: 2 })).toMatchObject({
      ok: true,
      code: 'configuration_updated',
      diagnosticsAdded: 0,
    });
    await core.start();
    expect(core.updateConfig({ maxDiagnosticEntries: 3 })).toMatchObject({
      ok: false,
      code: 'configuration_locked',
    });
    await core.stop();
    expect(core.updateConfig({ maxDiagnosticEntries: 3 })).toMatchObject({ ok: true });
    await core.destroy();
    expect(core.updateConfig({ maxDiagnosticEntries: 4 })).toMatchObject({
      ok: false,
      code: 'destroyed',
    });
  });

  it('does not retain update input and leaves configuration unchanged on failure', async () => {
    const core = createCore();
    await core.initialize({ maxDiagnosticEntries: 4 });
    const input = { maxDiagnosticEntries: 6 };
    const result = core.updateConfig(input);
    input.maxDiagnosticEntries = 9;
    expect(result).toMatchObject({ ok: true, config: { maxDiagnosticEntries: 6 } });
    expect(core.getConfig()).toEqual({ maxDiagnosticEntries: 6 });
    expect(core.updateConfig({ maxDiagnosticEntries: 0 })).toMatchObject({
      ok: false,
      code: 'invalid_configuration',
    });
    expect(core.getConfig()).toEqual({ maxDiagnosticEntries: 6 });
  });

  it('contains hostile public configuration input', async () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('configuration secret');
        },
      },
    );
    const core = createCore();
    await expect(core.initialize(hostile)).resolves.toMatchObject({
      ok: false,
      code: 'invalid_configuration',
    });
    await core.initialize();
    expect(() => core.updateConfig(hostile)).not.toThrow();
    expect(core.updateConfig(hostile)).toMatchObject({
      ok: false,
      code: 'invalid_configuration',
    });
    expect(JSON.stringify(core.getDiagnostics())).not.toContain('configuration secret');
  });
});
```

### Step 2: Run red

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/lifecycle.test.ts test/configuration.test.ts
pnpm --filter @aurora/core build
pnpm --filter @aurora/core exec vitest run test/package-entry.test.ts
```

Expected: the unit command and package-entry command exit non-zero because `createCore` is not exported; the build itself exits `0` for the Task 2 type-only root. Existing Task 2 value tests must still execute without unrelated failures.

### Step 3: Implement the public lifecycle and configuration behavior

- [ ] Create `packages/core/src/core.ts`:

```ts
import {
  areConfigurationsEqual,
  parseConfigurationUpdate,
  parseInitialConfiguration,
  type CoreConfigSnapshot,
  type CoreConfigUpdateResult,
} from './configuration.js';
import { DiagnosticStore, type CoreDiagnostic } from './diagnostics.js';
import {
  lifecycleFailure,
  lifecycleSuccess,
  type CoreLifecycleResult,
  type CoreLifecycleState,
} from './lifecycle.js';

export interface AuroraCore {
  getState(): CoreLifecycleState;
  getConfig(): CoreConfigSnapshot | null;
  getDiagnostics(): readonly CoreDiagnostic[];
  initialize(input?: unknown): Promise<CoreLifecycleResult>;
  updateConfig(input: unknown): CoreConfigUpdateResult;
  start(): Promise<CoreLifecycleResult>;
  stop(): Promise<CoreLifecycleResult>;
  destroy(): Promise<CoreLifecycleResult>;
}

type LifecycleOperation = 'initialize' | 'start' | 'stop' | 'destroy';

export function createCore(): AuroraCore {
  let state: CoreLifecycleState = 'created';
  let config: CoreConfigSnapshot | null = null;
  let lifecycleTail: Promise<void> = Promise.resolve();
  const diagnostics = new DiagnosticStore(100);

  function addInvalidLifecycle(operation: LifecycleOperation): void {
    diagnostics.add({ code: 'invalid_lifecycle_call', operation });
  }

  function serialize(
    operation: LifecycleOperation,
    executeOperation: () => CoreLifecycleResult | Promise<CoreLifecycleResult>,
  ): Promise<CoreLifecycleResult> {
    const executeSafely = async (): Promise<CoreLifecycleResult> => {
      try {
        return await executeOperation();
      } catch {
        diagnostics.add({ code: 'internal_error', operation });
        return lifecycleFailure('internal_error', state, 1);
      }
    };
    const result = lifecycleTail.then(executeSafely, executeSafely);
    lifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function getConfig(): CoreConfigSnapshot | null {
    return config === null ? null : Object.freeze({ ...config });
  }

  function initialize(input?: unknown): Promise<CoreLifecycleResult> {
    const parsed = parseInitialConfiguration(input);
    return serialize('initialize', () => {
      if (state === 'destroyed') {
        addInvalidLifecycle('initialize');
        return lifecycleFailure('destroyed', state, 1);
      }
      if (!parsed.ok) {
        diagnostics.add({ code: 'invalid_configuration', operation: 'initialize' });
        return lifecycleFailure('invalid_configuration', state, 1);
      }
      if (state !== 'created') {
        if (input === undefined || (config !== null && areConfigurationsEqual(config, parsed.config))) {
          return lifecycleSuccess('already_initialized', state);
        }
        diagnostics.add({ code: 'configuration_locked', operation: 'initialize' });
        return lifecycleFailure('configuration_locked', state, 1);
      }
      config = parsed.config;
      diagnostics.setCapacity(config.maxDiagnosticEntries);
      state = 'initialized';
      return lifecycleSuccess('initialized', state);
    });
  }

  function updateConfig(input: unknown): CoreConfigUpdateResult {
    if (state === 'destroyed') {
      diagnostics.add({ code: 'invalid_lifecycle_call', operation: 'update_config' });
      return Object.freeze({ ok: false, code: 'destroyed', state, diagnosticsAdded: 1 });
    }
    if (state === 'created') {
      diagnostics.add({ code: 'invalid_lifecycle_call', operation: 'update_config' });
      return Object.freeze({ ok: false, code: 'not_initialized', state, diagnosticsAdded: 1 });
    }
    if (state === 'started') {
      diagnostics.add({ code: 'configuration_locked', operation: 'update_config' });
      return Object.freeze({ ok: false, code: 'configuration_locked', state, diagnosticsAdded: 1 });
    }
    const parsed = parseConfigurationUpdate(input);
    if (!parsed.ok) {
      diagnostics.add({ code: 'invalid_configuration', operation: 'update_config' });
      return Object.freeze({ ok: false, code: 'invalid_configuration', state, diagnosticsAdded: 1 });
    }
    config = parsed.config;
    diagnostics.setCapacity(config.maxDiagnosticEntries);
    return Object.freeze({
      ok: true,
      code: 'configuration_updated',
      state,
      config: Object.freeze({ ...config }),
      diagnosticsAdded: 0,
    });
  }

  function start(): Promise<CoreLifecycleResult> {
    return serialize('start', () => {
      if (state === 'destroyed') {
        addInvalidLifecycle('start');
        return lifecycleFailure('destroyed', state, 1);
      }
      if (state === 'created') {
        addInvalidLifecycle('start');
        return lifecycleFailure('not_initialized', state, 1);
      }
      if (state === 'started') return lifecycleSuccess('already_started', state);
      state = 'started';
      return lifecycleSuccess('started', state);
    });
  }

  function stop(): Promise<CoreLifecycleResult> {
    return serialize('stop', () => {
      if (state === 'destroyed') {
        addInvalidLifecycle('stop');
        return lifecycleFailure('destroyed', state, 1);
      }
      if (state === 'created') {
        addInvalidLifecycle('stop');
        return lifecycleFailure('not_initialized', state, 1);
      }
      if (state !== 'started') return lifecycleSuccess('already_stopped', state);
      state = 'stopped';
      return lifecycleSuccess('stopped', state);
    });
  }

  function destroy(): Promise<CoreLifecycleResult> {
    return serialize('destroy', () => {
      if (state === 'destroyed') return lifecycleSuccess('already_destroyed', state);
      state = 'destroyed';
      return lifecycleSuccess('destroyed', state);
    });
  }

  return Object.freeze({
    getState: (): CoreLifecycleState => state,
    getConfig,
    getDiagnostics: (): readonly CoreDiagnostic[] => diagnostics.snapshot(),
    initialize,
    updateConfig,
    start,
    stop,
    destroy,
  });
}
```

### Step 4: Export the public lifecycle factory and compile it without DOM

- [ ] Add to `packages/core/src/index.ts`:

```ts
export { createCore, type AuroraCore } from './core.js';
```

- [ ] Add the built-entry command to `packages/core/package.json` without changing any dependency:

```json
"test:package": "pnpm build && vitest run test/package-entry.test.ts"
```

- [ ] Replace `packages/core/test/no-dom-consumer.ts` with:

```ts
import { createCore, type AuroraCore, type CoreConfigInput } from '../src/index.js';

const input: CoreConfigInput = { maxDiagnosticEntries: 10 };
const core: AuroraCore = createCore();
void core.initialize(input);
void core.getState();
void core.getConfig();
void core.getDiagnostics();
```

### Step 5: Run green and task regression

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/lifecycle.test.ts test/configuration.test.ts
pnpm --filter @aurora/core typecheck
pnpm exec eslint packages/core/src packages/core/test packages/core/vitest.config.ts
pnpm --filter @aurora/core build
pnpm --filter @aurora/core test:package
pnpm check:boundaries
```

Expected: chosen commands exit `0`; lifecycle and configuration tests pass; the two TypeScript configurations emit no diagnostics; boundary checks pass. Confirm the green source contains the corrected `update_config` operation and not the temporary operation label.

- [ ] Inspect Task 3 diff/status and verify each public lifecycle method has an explicit return type through `AuroraCore`, all result objects are discriminated, and no lifecycle Promise or state exists outside `createCore()`.

**Suggested commit boundary:** `feat(core): implement lifecycle and configuration state`

## Task 4: Freeze the Plugin Contract and Registration Rules

**Consumes:** Task 3 public Core factory/state; approved plugin signature, kebab-case name, registration-window, duplicate, and private-state rules.

**Produces:** Exact public plugin/event-result types, runtime-safe plugin hook snapshots, ordered per-instance registration, duplicate rejection, and registration closure at the first initialization attempt. No plugin hook is executed yet.

**Files:**

- Create: `packages/core/src/event-entry.ts`
- Create: `packages/core/src/plugin-contract.ts`
- Create: `packages/core/src/plugin-registry.ts`
- Create: `packages/core/test/plugin-registration.test.ts`
- Modify: `packages/core/src/core.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/no-dom-consumer.ts`

### Step 1: Write failing public registration tests

- [ ] Create `packages/core/test/plugin-registration.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createCore, type CorePlugin, type CorePluginContext } from '../src/index.js';

function createPlugin(name: string): CorePlugin {
  return {
    name,
    initialize(_context: CorePluginContext): void {},
    start(): void {},
    stop(): void {},
    destroy(): void {},
  };
}

describe('AuroraCore plugin registration', () => {
  it('registers a valid plugin and rejects its duplicate name', () => {
    const core = createCore();
    expect(core.registerPlugin(createPlugin('request-plugin'))).toEqual({
      ok: true,
      code: 'registered',
      pluginName: 'request-plugin',
      state: 'created',
      diagnosticsAdded: 0,
    });
    expect(core.registerPlugin(createPlugin('request-plugin'))).toMatchObject({
      ok: false,
      code: 'duplicate_plugin',
      state: 'created',
      diagnosticsAdded: 1,
    });
  });

  it.each([
    null,
    {},
    { name: '' },
    { name: 'Upper-Case', initialize() {}, start() {}, stop() {}, destroy() {} },
    { name: 'missing-start', initialize() {}, stop() {}, destroy() {} },
    { name: 'extra-long-' + 'a'.repeat(64), initialize() {}, start() {}, stop() {}, destroy() {} },
  ])('rejects an invalid runtime plugin %#', (input) => {
    const core = createCore();
    expect(core.registerPlugin(input)).toMatchObject({
      ok: false,
      code: 'invalid_plugin',
      diagnosticsAdded: 1,
    });
  });

  it('contains hostile plugin property access', () => {
    const core = createCore();
    const input = new Proxy(
      {},
      {
        get(): never {
          throw new Error('credential-in-exception');
        },
      },
    );
    expect(() => core.registerPlugin(input)).not.toThrow();
    expect(core.registerPlugin(input)).toMatchObject({ ok: false, code: 'invalid_plugin' });
    expect(JSON.stringify(core.getDiagnostics())).not.toContain('credential-in-exception');
  });

  it('closes registration on the first initialize attempt and after destroy', async () => {
    const failedInitializeCore = createCore();
    await failedInitializeCore.initialize({ maxDiagnosticEntries: 0 });
    expect(failedInitializeCore.registerPlugin(createPlugin('late-plugin'))).toMatchObject({
      ok: false,
      code: 'registration_closed',
    });

    const destroyedCore = createCore();
    await destroyedCore.destroy();
    expect(destroyedCore.registerPlugin(createPlugin('late-plugin'))).toMatchObject({
      ok: false,
      code: 'destroyed',
    });
  });

  it('exposes only event submission to plugin initialization', () => {
    expectTypeOf<keyof CorePluginContext>().toEqualTypeOf<'submitEvent'>();
  });
});
```

### Step 2: Run red

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/plugin-registration.test.ts
```

Expected: non-zero exit because `CorePlugin`, `CorePluginContext`, and `registerPlugin` do not exist. The failure must be confined to the new contract.

### Step 3: Define the event result and plugin contracts

- [ ] Create `packages/core/src/event-entry.ts` with the final public event-result types; behavior is added in Task 6:

```ts
import type { EventSchemaIssue } from '@aurora/event-schema';
import type { CoreLifecycleState } from './lifecycle.js';

export interface CoreEventAccepted {
  readonly ok: true;
  readonly code: 'accepted';
  readonly state: 'started';
  readonly diagnosticsAdded: 0;
}

export interface CoreInvalidEvent {
  readonly ok: false;
  readonly code: 'invalid_event';
  readonly state: 'started';
  readonly issues: readonly EventSchemaIssue[];
  readonly diagnosticsAdded: 1;
}

export interface CoreInactiveEvent {
  readonly ok: false;
  readonly code: 'not_started';
  readonly state: 'created' | 'initialized' | 'stopped';
  readonly diagnosticsAdded: 1;
}

export interface CoreDestroyedEvent {
  readonly ok: false;
  readonly code: 'destroyed';
  readonly state: 'destroyed';
  readonly diagnosticsAdded: 1;
}

export interface CoreEventInternalFailure {
  readonly ok: false;
  readonly code: 'internal_error';
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: 1;
}

export type CoreEventResult =
  | CoreEventAccepted
  | CoreInvalidEvent
  | CoreInactiveEvent
  | CoreDestroyedEvent
  | CoreEventInternalFailure;
```

- [ ] Create `packages/core/src/plugin-contract.ts`:

```ts
import type { CoreEventResult } from './event-entry.js';

export interface CorePluginContext {
  readonly submitEvent: (input: unknown) => CoreEventResult;
}

export interface CorePlugin {
  readonly name: string;
  initialize(context: CorePluginContext): void | Promise<void>;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  destroy(): void | Promise<void>;
}

type UnknownCallable = (...args: readonly unknown[]) => unknown;

export interface RegisteredPlugin {
  readonly name: string;
  readonly initialize: (context: CorePluginContext) => Promise<void>;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly destroy: () => Promise<void>;
}

export type PluginSnapshotResult =
  | { readonly ok: true; readonly plugin: RegisteredPlugin }
  | { readonly ok: false };

const pluginNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function isCallable(input: unknown): input is UnknownCallable {
  return typeof input === 'function';
}

export function snapshotPlugin(input: unknown): PluginSnapshotResult {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false };
    const name: unknown = Reflect.get(input, 'name');
    const initialize: unknown = Reflect.get(input, 'initialize');
    const start: unknown = Reflect.get(input, 'start');
    const stop: unknown = Reflect.get(input, 'stop');
    const destroy: unknown = Reflect.get(input, 'destroy');
    if (
      typeof name !== 'string' ||
      name.length > 64 ||
      !pluginNamePattern.test(name) ||
      !isCallable(initialize) ||
      !isCallable(start) ||
      !isCallable(stop) ||
      !isCallable(destroy)
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      plugin: Object.freeze({
        name,
        initialize: async (context: CorePluginContext): Promise<void> => {
          await Reflect.apply(initialize, input, [context]);
        },
        start: async (): Promise<void> => {
          await Reflect.apply(start, input, []);
        },
        stop: async (): Promise<void> => {
          await Reflect.apply(stop, input, []);
        },
        destroy: async (): Promise<void> => {
          await Reflect.apply(destroy, input, []);
        },
      }),
    };
  } catch {
    return { ok: false };
  }
}
```

The runtime object is caller-controlled and therefore remains `unknown` until every property is read safely and every hook is proven callable. Capturing the four callable values at registration prevents later property replacement from changing Core behavior; `Reflect.apply` preserves the original plugin object as `this` without a broad public type.

### Step 4: Implement ordered registration

- [ ] Create `packages/core/src/plugin-registry.ts`:

```ts
import { snapshotPlugin, type RegisteredPlugin } from './plugin-contract.js';

export type PluginRegistrationAttempt =
  | { readonly ok: true; readonly pluginName: string }
  | { readonly ok: false; readonly code: 'invalid_plugin' | 'duplicate_plugin' };

export class PluginRegistry {
  readonly #ordered: RegisteredPlugin[] = [];
  readonly #names: Set<string> = new Set();

  public register(input: unknown): PluginRegistrationAttempt {
    const snapshot = snapshotPlugin(input);
    if (!snapshot.ok) return { ok: false, code: 'invalid_plugin' };
    if (this.#names.has(snapshot.plugin.name)) {
      return { ok: false, code: 'duplicate_plugin' };
    }
    this.#names.add(snapshot.plugin.name);
    this.#ordered.push(snapshot.plugin);
    return { ok: true, pluginName: snapshot.plugin.name };
  }

  public orderedPlugins(): readonly RegisteredPlugin[] {
    return Object.freeze([...this.#ordered]);
  }
}
```

### Step 5: Add the public registration result and close the registry deterministically

- [ ] Add these imports to `packages/core/src/core.ts`:

```ts
import type {
  CorePluginRegistrationFailure,
  CorePluginRegistrationResult,
} from './plugin-contract.js';
import { PluginRegistry } from './plugin-registry.js';
```

- [ ] Add the final public registration result types to `packages/core/src/plugin-contract.ts`:

```ts
import type { CoreLifecycleState } from './lifecycle.js';

export interface CorePluginRegistrationSuccess {
  readonly ok: true;
  readonly code: 'registered';
  readonly pluginName: string;
  readonly state: 'created';
  readonly diagnosticsAdded: 0;
}

export type CorePluginRegistrationFailureCode =
  | 'invalid_plugin'
  | 'duplicate_plugin'
  | 'registration_closed'
  | 'destroyed';

export interface CorePluginRegistrationFailure {
  readonly ok: false;
  readonly code: CorePluginRegistrationFailureCode;
  readonly state: CoreLifecycleState;
  readonly diagnosticsAdded: number;
}

export type CorePluginRegistrationResult =
  | CorePluginRegistrationSuccess
  | CorePluginRegistrationFailure;
```

Merge the new type import beside the existing `CoreEventResult` import at the top of the file; the final file must not place an import after a declaration.

- [ ] In `AuroraCore`, add the exact method:

```ts
registerPlugin(input: unknown): CorePluginRegistrationResult;
```

- [ ] Inside `createCore()`, immediately after the diagnostic store, add:

```ts
const plugins = new PluginRegistry();
let isRegistrationClosed = false;
```

- [ ] Add this complete local function before `initialize`:

```ts
function registrationFailure(
  code: CorePluginRegistrationFailure['code'],
): CorePluginRegistrationFailure {
  const diagnosticCode =
    code === 'invalid_plugin'
      ? 'invalid_plugin'
      : code === 'duplicate_plugin'
        ? 'duplicate_plugin'
        : 'invalid_lifecycle_call';
  diagnostics.add({ code: diagnosticCode, operation: 'register_plugin' });
  return Object.freeze({ ok: false, code, state, diagnosticsAdded: 1 });
}

function registerPlugin(input: unknown): CorePluginRegistrationResult {
  if (state === 'destroyed') return registrationFailure('destroyed');
  if (state !== 'created' || isRegistrationClosed) {
    return registrationFailure('registration_closed');
  }
  const result = plugins.register(input);
  if (!result.ok) return registrationFailure(result.code);
  return Object.freeze({
    ok: true,
    code: 'registered',
    pluginName: result.pluginName,
    state: 'created',
    diagnosticsAdded: 0,
  });
}
```

- [ ] Set `isRegistrationClosed = true` synchronously at the beginning of both public `initialize(input)` and public `destroy()` before their calls to `serialize`. This closes the race where a plugin could be registered after a lifecycle command was invoked but before its queued operation began. Add `registerPlugin` to the frozen returned object.

### Step 6: Complete public exports and no-DOM typing

- [ ] Add these exports to `packages/core/src/index.ts`:

```ts
export type {
  CoreEventAccepted,
  CoreEventInternalFailure,
  CoreEventResult,
  CoreDestroyedEvent,
  CoreInactiveEvent,
  CoreInvalidEvent,
} from './event-entry.js';
export type {
  CorePlugin,
  CorePluginContext,
  CorePluginRegistrationFailure,
  CorePluginRegistrationFailureCode,
  CorePluginRegistrationResult,
  CorePluginRegistrationSuccess,
} from './plugin-contract.js';
export type { EventSchemaIssue } from '@aurora/event-schema';
```

- [ ] Add this compile-only use to `packages/core/test/no-dom-consumer.ts`:

```ts
import {
  createCore,
  type AuroraCore,
  type CoreConfigInput,
  type CorePlugin,
} from '../src/index.js';

const plugin: CorePlugin = {
  name: 'compile-plugin',
  initialize: () => undefined,
  start: () => undefined,
  stop: () => undefined,
  destroy: () => undefined,
};
void core.registerPlugin(plugin);
```

Replace the existing import with the combined import above and retain the existing `input` and `core` declarations before the new plugin value.

### Step 7: Run green and task regression

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/plugin-registration.test.ts test/lifecycle.test.ts test/configuration.test.ts
pnpm --filter @aurora/core typecheck
pnpm exec eslint packages/core/src packages/core/test packages/core/vitest.config.ts
pnpm check:boundaries
```

Expected: all commands exit `0`; registration tests pass; all existing lifecycle/configuration tests remain green; no-DOM compilation succeeds; the boundary checker sees no private import, cycle, forbidden layer, browser global, or module-level mutable state.

- [ ] Inspect Task 4 diff/status. Confirm `orderedPlugins()` and `RegisteredPlugin` are internal-only, the package root exposes no registry, plugin context has one key, and no plugin hook has been executed by Core yet.

**Suggested commit boundary:** `feat(core): define and validate plugin registration`

## Task 5: Add the Standard Event Entry Without a Pipeline

**Consumes:** Task 4 final event result types; `@aurora/event-schema` root exports `parseEventEnvelope`, `EventEnvelope`, and `EventSchemaIssue`; Core lifecycle and diagnostics.

**Produces:** Synchronous public `submitEvent(input: unknown)` behavior that accepts only valid envelopes while started, returns stable failures otherwise, never mutates or retains an event, and contains hostile parser inputs. It produces no callback, queue, sampling, batch, transport, or storage surface.

**Files:**

- Modify: `packages/core/src/event-entry.ts`
- Modify: `packages/core/src/core.ts`
- Create: `packages/core/test/event-entry.test.ts`
- Modify: `packages/core/test/no-dom-consumer.ts`

### Step 1: Write failing public event-entry tests

- [ ] Create `packages/core/test/event-entry.test.ts`:

```ts
import { validEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';
import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';

describe('AuroraCore event entry', () => {
  it('accepts a current EventEnvelope only while started', async () => {
    const core = createCore();
    const envelope = validEventEnvelopeSamples[0];
    expect(envelope).toBeDefined();
    expect(core.submitEvent(envelope)).toMatchObject({
      ok: false,
      code: 'not_started',
      state: 'created',
      diagnosticsAdded: 1,
    });
    await core.initialize();
    expect(core.submitEvent(envelope)).toMatchObject({ ok: false, code: 'not_started' });
    await core.start();
    expect(core.submitEvent(envelope)).toEqual({
      ok: true,
      code: 'accepted',
      state: 'started',
      diagnosticsAdded: 0,
    });
  });

  it('returns event-schema issues for invalid and unsupported input', async () => {
    const core = createCore();
    await core.initialize();
    await core.start();
    const invalid = core.submitEvent({ protocolVersion: 2 });
    expect(invalid).toMatchObject({ ok: false, code: 'invalid_event', diagnosticsAdded: 1 });
    if (invalid.code !== 'invalid_event') throw new Error('expected invalid_event');
    expect(invalid.issues.map(({ code }) => code)).toContain('unsupported_protocol_version');
    expect(Object.isFrozen(invalid.issues)).toBe(true);
  });

  it('does not mutate a valid protocol object', async () => {
    const core = createCore();
    await core.initialize();
    await core.start();
    const envelope = {
      protocolVersion: 1,
      eventId: 'event-non-mutation',
      eventType: 'error',
      occurredAt: 1,
      body: { message: 'safe summary' },
    };
    const before = JSON.stringify(envelope);
    expect(core.submitEvent(envelope).code).toBe('accepted');
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('rejects events after stop and destroy', async () => {
    const core = createCore();
    const envelope = validEventEnvelopeSamples[0];
    await core.initialize();
    await core.start();
    await core.stop();
    expect(core.submitEvent(envelope)).toMatchObject({ ok: false, code: 'not_started' });
    await core.destroy();
    expect(core.submitEvent(envelope)).toMatchObject({
      ok: false,
      code: 'destroyed',
      state: 'destroyed',
    });
  });

  it('contains an unexpected parser exception from a hostile proxy', async () => {
    const core = createCore();
    await core.initialize();
    await core.start();
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf(): never {
          throw new Error('event-body-secret');
        },
      },
    );
    expect(() => core.submitEvent(hostile)).not.toThrow();
    expect(core.submitEvent(hostile)).toEqual({
      ok: false,
      code: 'internal_error',
      state: 'started',
      diagnosticsAdded: 1,
    });
    expect(JSON.stringify(core.getDiagnostics())).not.toContain('event-body-secret');
  });

  it('does not expose retention or delivery behavior through acceptance', async () => {
    const core = createCore();
    await core.initialize();
    await core.start();
    expect(core.submitEvent(validEventEnvelopeSamples[0])).toMatchObject({ code: 'accepted' });
    expect(Object.keys(core).sort()).toEqual([
      'destroy',
      'getConfig',
      'getDiagnostics',
      'getState',
      'initialize',
      'registerPlugin',
      'start',
      'stop',
      'submitEvent',
      'updateConfig',
    ]);
  });
});
```

The testkit subpath is a declared public testing export of `@aurora/event-schema`; production Core source still imports only the package root.

### Step 2: Run red

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/event-entry.test.ts
```

Expected: non-zero exit because `AuroraCore.submitEvent` is absent. Do not add an event callback or storage surface to make a test pass.

### Step 3: Implement the event-schema boundary

- [ ] Append the behavior below to `packages/core/src/event-entry.ts` after its public types:

```ts
import { parseEventEnvelope } from '@aurora/event-schema';
import type { DiagnosticStore } from './diagnostics.js';

function freezeIssues(issues: readonly EventSchemaIssue[]): readonly EventSchemaIssue[] {
  return Object.freeze(
    issues.map((issue) =>
      Object.freeze({
        code: issue.code,
        path: Object.freeze([...issue.path]),
        message: issue.message,
      }),
    ),
  );
}

export function submitCoreEvent(
  state: CoreLifecycleState,
  input: unknown,
  diagnostics: DiagnosticStore,
): CoreEventResult {
  if (state === 'destroyed') {
    diagnostics.add({ code: 'event_rejected', operation: 'submit_event' });
    return Object.freeze({
      ok: false,
      code: 'destroyed',
      state,
      diagnosticsAdded: 1,
    });
  }
  if (state !== 'started') {
    diagnostics.add({ code: 'event_rejected', operation: 'submit_event' });
    return Object.freeze({
      ok: false,
      code: 'not_started',
      state,
      diagnosticsAdded: 1,
    });
  }
  try {
    const parsed = parseEventEnvelope(input);
    if (!parsed.success) {
      diagnostics.add({ code: 'invalid_event', operation: 'submit_event' });
      return Object.freeze({
        ok: false,
        code: 'invalid_event',
        state: 'started',
        issues: freezeIssues(parsed.issues),
        diagnosticsAdded: 1,
      });
    }
    return Object.freeze({
      ok: true,
      code: 'accepted',
      state: 'started',
      diagnosticsAdded: 0,
    });
  } catch {
    diagnostics.add({ code: 'internal_error', operation: 'submit_event' });
    return Object.freeze({
      ok: false,
      code: 'internal_error',
      state,
      diagnosticsAdded: 1,
    });
  }
}
```

Merge the imports at the top of the file so the final order is value imports, type-only imports, then local imports. `parsed.data` is intentionally unused: Core must not retain, transform, broadcast, or send it.

### Step 4: Expose the synchronous entry from the Core instance

- [ ] In `packages/core/src/core.ts`, import:

```ts
import { submitCoreEvent, type CoreEventResult } from './event-entry.js';
```

- [ ] Add to `AuroraCore`:

```ts
submitEvent(input: unknown): CoreEventResult;
```

- [ ] Inside `createCore()`, add this local function and expose it on the frozen returned object:

```ts
function submitEvent(input: unknown): CoreEventResult {
  return submitCoreEvent(state, input, diagnostics);
}
```

- [ ] Add this call to `packages/core/test/no-dom-consumer.ts`:

```ts
void core.submitEvent({ protocolVersion: 1 });
```

### Step 5: Run green and task regression

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/event-entry.test.ts test/lifecycle.test.ts test/configuration.test.ts test/plugin-registration.test.ts
pnpm --filter @aurora/core typecheck
pnpm exec eslint packages/core/src packages/core/test packages/core/vitest.config.ts
pnpm --filter @aurora/core build
pnpm check:boundaries
```

Expected: all commands exit `0`; all event cases pass; normal and no-DOM type checks pass; built declarations reference only the public event-schema package; boundaries remain clean.

- [ ] Inspect the Core source and built declaration diff. There must be no event array, listener, callback registration, sample decision, queue, sender, endpoint, project identifier, retry, timer, persistence, or Browser symbol.

**Suggested commit boundary:** `feat(core): validate standard event entry`

## Task 6: Orchestrate Plugin Hooks, Isolate Failures, and Prove Multi-Instance Safety

**Consumes:** Tasks 4–5 plugin snapshots, registration order, event entry, lifecycle serialization, and bounded diagnostics.

**Produces:** Registration-order initialize/start, reverse-order stop/destroy, permanent quarantine after a hook failure, frozen minimal plugin context, destroy cleanup from every state, and black-box host/multi-instance safety evidence. This completes the frozen public API.

**Files:**

- Replace: `packages/core/src/plugin-registry.ts`
- Modify: `packages/core/src/core.ts`
- Create: `packages/core/test/plugin-lifecycle.test.ts`
- Create: `packages/core/test/multi-instance.test.ts`
- Create: `packages/core/test/host-safety.test.ts`

### Step 1: Write failing hook-order and failure-isolation tests

- [ ] Create `packages/core/test/plugin-lifecycle.test.ts`:

```ts
import { validEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';
import { describe, expect, it } from 'vitest';
import {
  createCore,
  type CorePlugin,
  type CorePluginContext,
  type CoreEventResult,
} from '../src/index.js';

function loggingPlugin(name: string, log: string[]): CorePlugin {
  return {
    name,
    initialize(): void {
      log.push(`initialize:${name}`);
    },
    start(): void {
      log.push(`start:${name}`);
    },
    stop(): void {
      log.push(`stop:${name}`);
    },
    destroy(): void {
      log.push(`destroy:${name}`);
    },
  };
}

describe('AuroraCore plugin lifecycle', () => {
  it('initializes and starts in registration order, then stops and destroys in reverse order', async () => {
    const log: string[] = [];
    const core = createCore();
    core.registerPlugin(loggingPlugin('first-plugin', log));
    core.registerPlugin(loggingPlugin('second-plugin', log));
    await core.initialize();
    await core.initialize();
    await core.start();
    await core.start();
    await core.stop();
    await core.stop();
    await core.start();
    await core.destroy();
    expect(log).toEqual([
      'initialize:first-plugin',
      'initialize:second-plugin',
      'start:first-plugin',
      'start:second-plugin',
      'stop:second-plugin',
      'stop:first-plugin',
      'start:first-plugin',
      'start:second-plugin',
      'stop:second-plugin',
      'stop:first-plugin',
      'destroy:second-plugin',
      'destroy:first-plugin',
    ]);
    const finalLog = [...log];
    await core.start();
    expect(log).toEqual(finalLog);
  });

  it('captures hook methods at registration', async () => {
    const log: string[] = [];
    const plugin = loggingPlugin('snapshot-plugin', log);
    const core = createCore();
    core.registerPlugin(plugin);
    plugin.start = (): void => {
      log.push('start:replacement');
    };
    await core.initialize();
    await core.start();
    expect(log).toContain('start:snapshot-plugin');
    expect(log).not.toContain('start:replacement');
  });

  it('does not overlap a queued start with asynchronous initialization', async () => {
    const log: string[] = [];
    let releaseInitialize: (() => void) | undefined;
    const initializeGate = new Promise<void>((resolve) => {
      releaseInitialize = resolve;
    });
    const core = createCore();
    core.registerPlugin({
      name: 'serialized-plugin',
      async initialize(): Promise<void> {
        log.push('initialize:begin');
        await initializeGate;
        log.push('initialize:end');
      },
      start(): void {
        log.push('start');
      },
      stop(): void {},
      destroy(): void {},
    });
    const initializeResult = core.initialize();
    const startResult = core.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(['initialize:begin']);
    if (releaseInitialize === undefined) throw new Error('initialize hook did not start');
    releaseInitialize();
    await expect(initializeResult).resolves.toMatchObject({ code: 'initialized' });
    await expect(startResult).resolves.toMatchObject({ code: 'started' });
    expect(log).toEqual(['initialize:begin', 'initialize:end', 'start']);
  });

  it('quarantines an initialize failure and continues other plugins', async () => {
    const log: string[] = [];
    const failed: CorePlugin = {
      ...loggingPlugin('failed-plugin', log),
      initialize(): never {
        log.push('initialize:failed-plugin');
        throw new Error('private initialize failure');
      },
    };
    const core = createCore();
    core.registerPlugin(failed);
    core.registerPlugin(loggingPlugin('healthy-plugin', log));
    await expect(core.initialize()).resolves.toMatchObject({
      ok: true,
      code: 'initialized',
      diagnosticsAdded: 1,
    });
    await core.start();
    expect(log).toEqual([
      'initialize:failed-plugin',
      'initialize:healthy-plugin',
      'start:healthy-plugin',
    ]);
    expect(core.getDiagnostics()).toEqual([
      {
        sequence: 1,
        code: 'plugin_initialize_failed',
        operation: 'initialize',
        pluginName: 'failed-plugin',
      },
    ]);
    await core.destroy();
    expect(log.slice(-2)).toEqual(['destroy:healthy-plugin', 'destroy:failed-plugin']);
  });

  it('isolates start and stop failures while preserving order and cleanup', async () => {
    const log: string[] = [];
    const startFailure: CorePlugin = {
      ...loggingPlugin('start-failure', log),
      start(): never {
        log.push('start:start-failure');
        throw new Error('start secret');
      },
    };
    const stopFailure: CorePlugin = {
      ...loggingPlugin('stop-failure', log),
      stop(): Promise<never> {
        log.push('stop:stop-failure');
        return Promise.reject(new Error('stop secret'));
      },
    };
    const core = createCore();
    core.registerPlugin(startFailure);
    core.registerPlugin(stopFailure);
    core.registerPlugin(loggingPlugin('healthy-plugin', log));
    await core.initialize();
    await expect(core.start()).resolves.toMatchObject({ ok: true, diagnosticsAdded: 1 });
    await expect(core.stop()).resolves.toMatchObject({ ok: true, diagnosticsAdded: 1 });
    await core.start();
    await core.destroy();
    expect(log.filter((entry) => entry === 'start:start-failure')).toHaveLength(1);
    expect(log.filter((entry) => entry === 'stop:stop-failure')).toHaveLength(1);
    expect(log.filter((entry) => entry === 'start:stop-failure')).toHaveLength(1);
    expect(log).toContain('start:healthy-plugin');
    expect(log).toContain('stop:healthy-plugin');
    expect(log.slice(-3)).toEqual([
      'destroy:healthy-plugin',
      'destroy:stop-failure',
      'destroy:start-failure',
    ]);
  });

  it('destroys every registered plugin once even before initialization and contains destroy failure', async () => {
    const log: string[] = [];
    const failedDestroy: CorePlugin = {
      ...loggingPlugin('failed-destroy', log),
      destroy(): never {
        log.push('destroy:failed-destroy');
        throw new Error('destroy secret');
      },
    };
    const core = createCore();
    core.registerPlugin(loggingPlugin('first-plugin', log));
    core.registerPlugin(failedDestroy);
    await expect(core.destroy()).resolves.toMatchObject({
      ok: true,
      code: 'destroyed',
      diagnosticsAdded: 1,
    });
    await core.destroy();
    expect(log).toEqual(['destroy:failed-destroy', 'destroy:first-plugin']);
  });

  it('gives plugins only a frozen event entry bound to the same Core', async () => {
    let context: CorePluginContext | undefined;
    let duringInitialize: CoreEventResult | undefined;
    const core = createCore();
    core.registerPlugin({
      name: 'context-plugin',
      initialize(received): void {
        context = received;
        duringInitialize = received.submitEvent(validEventEnvelopeSamples[0]);
      },
      start(): void {},
      stop(): void {},
      destroy(): void {},
    });
    await core.initialize();
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.keys(context ?? {})).toEqual(['submitEvent']);
    expect(duringInitialize).toMatchObject({ ok: false, code: 'not_started' });
    await core.start();
    expect(context?.submitEvent(validEventEnvelopeSamples[0])).toMatchObject({
      ok: true,
      code: 'accepted',
    });
    await core.destroy();
    expect(context?.submitEvent(validEventEnvelopeSamples[0])).toMatchObject({
      ok: false,
      code: 'destroyed',
    });
  });
});
```

### Step 2: Write failing multi-instance and host-safety tests

- [ ] Create `packages/core/test/multi-instance.test.ts`:

```ts
import { validEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';
import { describe, expect, it } from 'vitest';
import { createCore, type CorePlugin } from '../src/index.js';

function countedPlugin(name: string, counts: { starts: number; destroys: number }): CorePlugin {
  return {
    name,
    initialize(): void {},
    start(): void {
      counts.starts += 1;
    },
    stop(): void {},
    destroy(): void {
      counts.destroys += 1;
    },
  };
}

describe('AuroraCore multi-instance isolation', () => {
  it('isolates configuration, plugins, lifecycle, diagnostics, and events', async () => {
    const firstCounts = { starts: 0, destroys: 0 };
    const secondCounts = { starts: 0, destroys: 0 };
    const first = createCore();
    const second = createCore();
    expect(first.registerPlugin(countedPlugin('instance-plugin', firstCounts))).toMatchObject({
      ok: true,
    });
    expect(second.registerPlugin(countedPlugin('instance-plugin', secondCounts))).toMatchObject({
      ok: true,
    });
    await first.initialize({ maxDiagnosticEntries: 2 });
    await second.initialize({ maxDiagnosticEntries: 5 });
    await first.start();
    await second.start();

    expect(first.getConfig()).toEqual({ maxDiagnosticEntries: 2 });
    expect(second.getConfig()).toEqual({ maxDiagnosticEntries: 5 });
    expect(firstCounts).toEqual({ starts: 1, destroys: 0 });
    expect(secondCounts).toEqual({ starts: 1, destroys: 0 });
    expect(first.submitEvent({ protocolVersion: 99 })).toMatchObject({ code: 'invalid_event' });
    expect(second.submitEvent(validEventEnvelopeSamples[0])).toMatchObject({ code: 'accepted' });
    expect(first.getDiagnostics()).toHaveLength(1);
    expect(second.getDiagnostics()).toHaveLength(0);

    await first.destroy();
    expect(firstCounts.destroys).toBe(1);
    expect(secondCounts.destroys).toBe(0);
    expect(second.getState()).toBe('started');
    await second.destroy();
    const third = createCore();
    expect(third.getState()).toBe('created');
    expect(third.getConfig()).toBeNull();
    expect(third.getDiagnostics()).toEqual([]);
  });

  it('contains one instance plugin failure without changing another instance', async () => {
    const failed = createCore();
    const healthy = createCore();
    failed.registerPlugin({
      name: 'failed-plugin',
      initialize(): never {
        throw new Error('instance-local failure');
      },
      start(): void {},
      stop(): void {},
      destroy(): void {},
    });
    await failed.initialize();
    await healthy.initialize();
    expect(failed.getDiagnostics()[0]).toMatchObject({ sequence: 1, pluginName: 'failed-plugin' });
    expect(healthy.getDiagnostics()).toEqual([]);
    expect(healthy.getState()).toBe('initialized');
  });
});
```

- [ ] Create `packages/core/test/host-safety.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createCore, type CorePlugin } from '../src/index.js';

describe('AuroraCore host safety', () => {
  it('never rejects lifecycle promises for plugin exceptions', async () => {
    const initializeFailure: CorePlugin = {
      name: 'initialize-failure',
      initialize(): Promise<never> {
        return Promise.reject(new Error('credential=hidden'));
      },
      start(): void {},
      stop(): void {},
      destroy(): void {},
    };
    const startFailure: CorePlugin = {
      name: 'start-failure',
      initialize(): void {},
      start(): never {
        throw new Error('start hidden');
      },
      stop(): void {},
      destroy(): void {},
    };
    const stopFailure: CorePlugin = {
      name: 'stop-failure',
      initialize(): void {},
      start(): void {},
      stop(): Promise<never> {
        return Promise.reject(new Error('stop hidden'));
      },
      destroy(): void {},
    };
    const destroyFailure: CorePlugin = {
      name: 'destroy-failure',
      initialize(): void {},
      start(): void {},
      stop(): void {},
      destroy(): never {
        throw new Error('destroy hidden');
      },
    };
    const core = createCore();
    for (const plugin of [initializeFailure, startFailure, stopFailure, destroyFailure]) {
      expect(() => core.registerPlugin(plugin)).not.toThrow();
    }
    await expect(core.initialize()).resolves.toMatchObject({ ok: true });
    await expect(core.start()).resolves.toMatchObject({ ok: true });
    await expect(core.stop()).resolves.toMatchObject({ ok: true });
    await expect(core.destroy()).resolves.toMatchObject({ ok: true });
    expect(core.getDiagnostics().map(({ code }) => code)).toEqual([
      'plugin_initialize_failed',
      'plugin_start_failed',
      'plugin_stop_failed',
      'plugin_destroy_failed',
    ]);
    const serialized = JSON.stringify(core.getDiagnostics());
    expect(serialized).not.toContain('credential');
    expect(serialized).not.toContain('hidden');
    expect(serialized).not.toContain('stack');
  });

  it('keeps diagnostics bounded under repeated rejected input', async () => {
    const core = createCore();
    await core.initialize({ maxDiagnosticEntries: 2 });
    core.submitEvent(null);
    core.submitEvent(null);
    core.submitEvent(null);
    expect(core.getDiagnostics().map(({ sequence }) => sequence)).toEqual([2, 3]);
  });

  it('trims the oldest diagnostics when an allowed update shrinks capacity', async () => {
    const core = createCore();
    await core.initialize({ maxDiagnosticEntries: 3 });
    core.submitEvent(null);
    core.submitEvent(null);
    core.submitEvent(null);
    expect(core.updateConfig({ maxDiagnosticEntries: 1 })).toMatchObject({ ok: true });
    expect(core.getDiagnostics().map(({ sequence }) => sequence)).toEqual([3]);
  });
});
```

### Step 3: Run red

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/plugin-lifecycle.test.ts test/multi-instance.test.ts test/host-safety.test.ts
```

Expected: non-zero exit because registered hooks are not yet invoked. Multi-instance value assertions that do not depend on hooks may already pass; the red reason must include missing hook execution/order.

### Step 4: Replace the registry with explicit phase and quarantine behavior

- [ ] Replace `packages/core/src/plugin-registry.ts` completely:

```ts
import type { DiagnosticStore } from './diagnostics.js';
import { snapshotPlugin, type CorePluginContext, type RegisteredPlugin } from './plugin-contract.js';

export type PluginRegistrationAttempt =
  | { readonly ok: true; readonly pluginName: string }
  | { readonly ok: false; readonly code: 'invalid_plugin' | 'duplicate_plugin' };

type PluginPhase =
  | 'registered'
  | 'initialized'
  | 'started'
  | 'stopped'
  | 'quarantined'
  | 'destroyed';

interface PluginRecord {
  readonly plugin: RegisteredPlugin;
  phase: PluginPhase;
}

export class PluginRegistry {
  readonly #ordered: PluginRecord[] = [];
  readonly #names: Set<string> = new Set();

  public register(input: unknown): PluginRegistrationAttempt {
    const snapshot = snapshotPlugin(input);
    if (!snapshot.ok) return { ok: false, code: 'invalid_plugin' };
    if (this.#names.has(snapshot.plugin.name)) {
      return { ok: false, code: 'duplicate_plugin' };
    }
    this.#names.add(snapshot.plugin.name);
    this.#ordered.push({ plugin: snapshot.plugin, phase: 'registered' });
    return { ok: true, pluginName: snapshot.plugin.name };
  }

  public async initializeAll(
    context: CorePluginContext,
    diagnostics: DiagnosticStore,
  ): Promise<number> {
    let diagnosticsAdded = 0;
    for (const record of this.#ordered) {
      if (record.phase !== 'registered') continue;
      try {
        await record.plugin.initialize(context);
        record.phase = 'initialized';
      } catch {
        record.phase = 'quarantined';
        diagnostics.add({
          code: 'plugin_initialize_failed',
          operation: 'initialize',
          pluginName: record.plugin.name,
        });
        diagnosticsAdded += 1;
      }
    }
    return diagnosticsAdded;
  }

  public async startAll(diagnostics: DiagnosticStore): Promise<number> {
    let diagnosticsAdded = 0;
    for (const record of this.#ordered) {
      if (record.phase !== 'initialized' && record.phase !== 'stopped') continue;
      try {
        await record.plugin.start();
        record.phase = 'started';
      } catch {
        record.phase = 'quarantined';
        diagnostics.add({
          code: 'plugin_start_failed',
          operation: 'start',
          pluginName: record.plugin.name,
        });
        diagnosticsAdded += 1;
      }
    }
    return diagnosticsAdded;
  }

  public async stopAll(diagnostics: DiagnosticStore): Promise<number> {
    let diagnosticsAdded = 0;
    for (const record of [...this.#ordered].reverse()) {
      if (record.phase !== 'started') continue;
      try {
        await record.plugin.stop();
        record.phase = 'stopped';
      } catch {
        record.phase = 'quarantined';
        diagnostics.add({
          code: 'plugin_stop_failed',
          operation: 'stop',
          pluginName: record.plugin.name,
        });
        diagnosticsAdded += 1;
      }
    }
    return diagnosticsAdded;
  }

  public async destroyAll(diagnostics: DiagnosticStore): Promise<number> {
    let diagnosticsAdded = 0;
    for (const record of [...this.#ordered].reverse()) {
      if (record.phase === 'destroyed') continue;
      try {
        await record.plugin.destroy();
      } catch {
        diagnostics.add({
          code: 'plugin_destroy_failed',
          operation: 'destroy',
          pluginName: record.plugin.name,
        });
        diagnosticsAdded += 1;
      } finally {
        record.phase = 'destroyed';
      }
    }
    return diagnosticsAdded;
  }
}
```

The reverse arrays are per-call local values, not module-level state or event queues. A quarantined plugin is skipped by initialize/start/stop and is still destroyed exactly once.

### Step 5: Integrate hooks into serialized Core transitions

- [ ] In `packages/core/src/core.ts`, import `CorePluginContext` and add this frozen context inside `createCore()` after the local `submitEvent` function:

```ts
const pluginContext: CorePluginContext = Object.freeze({
  submitEvent: (input: unknown): CoreEventResult => submitEvent(input),
});
```

- [ ] Replace the `initialize` function with this complete version:

```ts
function initialize(input?: unknown): Promise<CoreLifecycleResult> {
  isRegistrationClosed = true;
  const parsed = parseInitialConfiguration(input);
  return serialize('initialize', async () => {
    if (state === 'destroyed') {
      addInvalidLifecycle('initialize');
      return lifecycleFailure('destroyed', state, 1);
    }
    if (!parsed.ok) {
      diagnostics.add({ code: 'invalid_configuration', operation: 'initialize' });
      return lifecycleFailure('invalid_configuration', state, 1);
    }
    if (state !== 'created') {
      if (input === undefined || (config !== null && areConfigurationsEqual(config, parsed.config))) {
        return lifecycleSuccess('already_initialized', state);
      }
      diagnostics.add({ code: 'configuration_locked', operation: 'initialize' });
      return lifecycleFailure('configuration_locked', state, 1);
    }
    config = parsed.config;
    diagnostics.setCapacity(config.maxDiagnosticEntries);
    state = 'initialized';
    const diagnosticsAdded = await plugins.initializeAll(pluginContext, diagnostics);
    return lifecycleSuccess('initialized', state, diagnosticsAdded);
  });
}
```

- [ ] Replace `start`:

```ts
function start(): Promise<CoreLifecycleResult> {
  return serialize('start', async () => {
    if (state === 'destroyed') {
      addInvalidLifecycle('start');
      return lifecycleFailure('destroyed', state, 1);
    }
    if (state === 'created') {
      addInvalidLifecycle('start');
      return lifecycleFailure('not_initialized', state, 1);
    }
    if (state === 'started') return lifecycleSuccess('already_started', state);
    state = 'started';
    const diagnosticsAdded = await plugins.startAll(diagnostics);
    return lifecycleSuccess('started', state, diagnosticsAdded);
  });
}
```

- [ ] Replace `stop`:

```ts
function stop(): Promise<CoreLifecycleResult> {
  return serialize('stop', async () => {
    if (state === 'destroyed') {
      addInvalidLifecycle('stop');
      return lifecycleFailure('destroyed', state, 1);
    }
    if (state === 'created') {
      addInvalidLifecycle('stop');
      return lifecycleFailure('not_initialized', state, 1);
    }
    if (state !== 'started') return lifecycleSuccess('already_stopped', state);
    state = 'stopped';
    const diagnosticsAdded = await plugins.stopAll(diagnostics);
    return lifecycleSuccess('stopped', state, diagnosticsAdded);
  });
}
```

- [ ] Replace `destroy`:

```ts
function destroy(): Promise<CoreLifecycleResult> {
  isRegistrationClosed = true;
  return serialize('destroy', async () => {
    if (state === 'destroyed') return lifecycleSuccess('already_destroyed', state);
    let diagnosticsAdded = 0;
    if (state === 'started') {
      state = 'stopped';
      diagnosticsAdded += await plugins.stopAll(diagnostics);
    }
    state = 'destroyed';
    diagnosticsAdded += await plugins.destroyAll(diagnostics);
    return lifecycleSuccess('destroyed', state, diagnosticsAdded);
  });
}
```

State changes occur before callbacks. A plugin re-entering through its saved event context therefore sees `initialized`, `started`, `stopped`, or `destroyed` consistently. The lifecycle Promise tail serializes only lifecycle control; it does not hold event data.

### Step 6: Run green, full Core coverage, and task regression

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/plugin-lifecycle.test.ts test/multi-instance.test.ts test/host-safety.test.ts
pnpm --filter @aurora/core test
pnpm --filter @aurora/core test:coverage
pnpm --filter @aurora/core typecheck
pnpm exec eslint packages/core/src packages/core/test packages/core/vitest.config.ts
pnpm check:boundaries
```

Expected: every command exits `0`; all Core tests pass; coverage reports at least 85% lines, 80% branches, 85% functions, and 85% statements. If a threshold is missed, add a black-box case for the uncovered declared behavior; do not lower a threshold or exclude the source.

- [ ] Inspect the complete Core source/test diff and status. Confirm each hook is invoked at most once per applicable transition, every hook call is awaited inside `try/catch`, quarantined plugins cannot restart, destroy still reaches every record, diagnostic content is limited to stable fields, and all mutable fields are created per `createCore()` or per `PluginRegistry` instance.

**Suggested commit boundary:** `feat(core): orchestrate isolated plugin lifecycles`

## Task 7: Lock Package/Documentation Contracts and Record Implementation Evidence

**Consumes:** Tasks 1–6 complete Core implementation and fresh focused results; approved documentation/ADR governance; current repository status files.

**Produces:** A built-root package contract, executable README claims, complete module README, synchronized architecture/readiness/ADR/status evidence, and the full root quality gate. It does not add behavior.

**Files:**

- Create: `packages/core/README.md`
- Create: `packages/core/test/documentation-contract.test.ts`
- Modify: `package.json`
- Modify: `tooling/workspace-policy/README.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/sdk-architecture.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/adr/ADR-003-sdk-plugin-architecture.md`
- Modify: `docs/adr/ADR-005-event-schema-source-of-truth.md`
- Modify: `docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `docs/adr/README.md`
- Modify: `AGENTS.md`
- Modify: `AURORA_RULES.md`

### Step 1: Write the failing documentation contract test

- [ ] Create `packages/core/test/documentation-contract.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';

async function repositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

describe('Core documentation contract', () => {
  it('keeps the module README complete and honest about the increment', async () => {
    const readme = await repositoryFile('packages/core/README.md');
    for (const heading of [
      '## 模块定位',
      '## 职责',
      '## 非职责',
      '## 对外接口',
      '## 生命周期',
      '## 插件契约',
      '## 事件入口',
      '## 诊断与隐私',
      '## 依赖边界',
      '## 开发与测试',
      '## 关联文档',
    ]) {
      expect(readme).toContain(heading);
    }
    expect(readme).toContain('`accepted` 只表示 Core 已启动且信封通过校验');
    expect(readme).toContain('默认 `maxDiagnosticEntries` 为 `100`');
    expect(readme).not.toContain('事件已经进入发送队列');
    expect(readme).not.toContain('Browser 层已经实现');
  });

  it('keeps the formal specification linked from the document index', async () => {
    const index = await repositoryFile('docs/README.md');
    expect(index).toContain('sdk/sdk-core-foundation.md');
    const specification = await repositoryFile('docs/sdk/sdk-core-foundation.md');
    expect(specification).toContain('status: approved');
    expect(specification).toContain('实施状态为 `not-started`');
  });

  it('matches the documented default and repeat semantics', async () => {
    const core = createCore();
    await expect(core.initialize()).resolves.toMatchObject({ code: 'initialized' });
    expect(core.getConfig()).toEqual({ maxDiagnosticEntries: 100 });
    await expect(core.initialize()).resolves.toMatchObject({ code: 'already_initialized' });
    await core.destroy();
    await expect(core.destroy()).resolves.toMatchObject({ code: 'already_destroyed' });
  });
});
```

### Step 2: Run red

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/documentation-contract.test.ts
pnpm --filter @aurora/core test:package
```

Expected: the first command exits non-zero because `packages/core/README.md` and its index entry do not exist. The package command may already pass after build; if it does, record that as an existing green precondition and retain the test.

### Step 3: Write the exact module README

- [ ] Create `packages/core/README.md` with this content:

````markdown
# SDK Core

`@aurora/core` 是 Aurora SDK 的环境无关生命周期与插件编排基础包。包保持私有，不代表已经发布到 npm。

## 模块定位

Core 为每个 `createCore()` 调用建立独立实例，负责最小配置、生命周期、插件顺序、标准事件信封入口和有界内部诊断。Core 不访问 Browser 环境，也不负责采集或发送。

## 职责

- 提供 `created`、`initialized`、`started`、`stopped`、`destroyed` 生命周期；
- 提供默认 `maxDiagnosticEntries` 为 `100` 的冻结配置快照；
- 在单实例内串行化异步生命周期调用；
- 注册并隔离插件，按注册顺序初始化/启动、逆序停止/销毁；
- 通过 `@aurora/event-schema` 根入口验证标准事件信封；
- 提供每实例有界且不含异常内容的诊断结果。

## 非职责

- Browser 环境层和浏览器对象；
- 错误、请求、性能、资源等具体采集插件；
- React/Vue 适配、采样、队列、批次、网络传输、重试或持久化；
- 数据接入、服务端、CI、发布、容器、IaC 或云资源。

## 对外接口

```ts
import {
  createCore,
  type AuroraCore,
  type CoreConfigInput,
  type CoreDiagnostic,
  type CoreEventResult,
  type CoreLifecycleResult,
  type CorePlugin,
  type CorePluginContext,
} from '@aurora/core';
```

包只有根公开入口。禁止导入 `src`、`internal` 或未导出的子路径。

## 生命周期

```text
created --initialize--> initialized --start--> started
                                   ^            |
                                   |            v
                                   +---start-- stopped

任一未销毁状态 --destroy--> destroyed
```

`initialize`、`start`、`stop`、`destroy` 返回 Promise，并在单实例内按调用顺序执行。重复初始化、启动、停止和销毁返回稳定幂等结果；销毁后不能初始化、启动、注册插件、更新配置或接受事件。

配置没有必填字段。可在 `initialized` 或 `stopped` 更新 `maxDiagnosticEntries`，合法范围为 1—1000；`started` 状态锁定更新。所有成功配置都是新建并冻结的快照。

## 插件契约

插件名必须是 1—64 字符 kebab-case。插件只在 `created` 注册；首次初始化尝试后注册关闭。初始化和启动按注册顺序，停止和销毁按逆序。同步异常和 Promise 拒绝不会冒泡；失败插件被隔离，其他插件继续，销毁仍执行一次。

`CorePluginContext` 只有冻结的 `submitEvent(input: unknown)`。插件不能读取 Core 配置、诊断、其他插件或私有状态，也不能通过 Core 获得独立上报通道。

## 事件入口

`submitEvent(input: unknown): CoreEventResult` 仅在 `started` 接受输入，并调用 `@aurora/event-schema` 的 `parseEventEnvelope`。`accepted` 只表示 Core 已启动且信封通过校验；它不表示事件已采样、保留、排队、批处理、发送或持久化。Core 不修改或保存协议对象。

## 诊断与隐私

`getDiagnostics()` 返回冻结副本。诊断只包含实例内序号、稳定代码、操作和可选的已验证插件名，不包含异常消息、堆栈、配置值、事件内容、URL、凭据、IP 或用户数据。容量默认 100，最大 1000，超限移除最旧记录。

## 依赖边界

唯一运行时依赖是 `@aurora/event-schema` 根公开出口。Core 在无 DOM TypeScript 环境编译，不引用浏览器全局，不依赖 Browser、具体插件、框架或服务端包，不声明全局可变单例。

## 开发与测试

```bash
pnpm --filter @aurora/core typecheck
pnpm --filter @aurora/core test
pnpm --filter @aurora/core test:coverage
pnpm --filter @aurora/core build
pnpm --filter @aurora/core test:package
pnpm check:boundaries
pnpm check:ci
```

覆盖率门槛为行 85%、分支 80%、函数 85%、语句 85%。无 DOM 编译、包根入口、私有路径拒绝、依赖层级、浏览器全局和模块级可变状态均有自动门禁。

## 关联文档

- [Core 基础规格](../../docs/sdk/sdk-core-foundation.md)
- [SDK 架构](../../docs/architecture/sdk-architecture.md)
- [event-schema 基础规格](../../docs/protocol/event-schema-foundation.md)
- [ADR-003](../../docs/adr/ADR-003-sdk-plugin-architecture.md)
- [ADR-005](../../docs/adr/ADR-005-event-schema-source-of-truth.md)
- [ADR-006](../../docs/adr/ADR-006-one-way-dependencies.md)
- [测试策略](../../docs/testing/test-strategy.md)
````

### Step 4: Synchronize formal documents without overstating implementation

- [ ] Update the existing `docs/sdk/sdk-core-foundation.md` row in `docs/README.md` without adding a duplicate. Keep the specification's planning-time implementation sentence `not-started` as historical scope context; the index may state that implementation files now exist but must defer verified/implemented wording until Step 7 passes.

- [ ] Update `README.md` to list `@aurora/core` as the third real private package and state exactly that only lifecycle/configuration/plugin orchestration/event-entry/diagnostic foundations exist. In the same paragraph state that Browser, concrete plugins, sampling, queues, transport, persistence, SDK release, services, CI, and cloud infrastructure still do not exist.

- [ ] Update `docs/architecture/sdk-architecture.md` surgically:

  - replace claims that `event-schema` and SDK Core are wholly absent with dated evidence for the implemented event-schema foundation and this Core foundation;
  - add the root public API link to `packages/core/README.md` and the approved specification;
  - retain Browser, concrete plugins, adapters, sampling, queue, retry, transport, persistence, package-size measurement, and performance verification as unimplemented;
  - do not treat `submitEvent: accepted` as delivery.

- [ ] Update `docs/architecture/formalization-readiness.md`:

  - retain the already indexed Core specification and implementation-plan links and the pre-implementation state until Step 7 passes;
  - keep the next ordered SDK work blocked on its own approved specification and applicable accepted ADRs;
  - keep concrete event bodies, Browser, collection, queue, sampling, transport, ingestion, CI, deployment, and release gaps open;
  - do not start a new topic or reserve an ADR number.

- [ ] Update `tooling/workspace-policy/README.md` with these executable facts: `protocol` rejects every local runtime dependency; `sdk-core` accepts only `protocol`; public import checks reject private/unexported paths; Core source checks reject the listed browser globals, top-level `let`/`var`, and top-level mutable containers; dependency-cycle checking covers all Workspace packages.

### Step 5: Add Core to every stable root quality command

- [ ] Update only these script values in root `package.json`:

```json
{
  "format:check": "prettier --check package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json tooling/workspace-policy/package.json tooling/workspace-policy/tsconfig.json tooling/workspace-policy/tsconfig.build.json packages/event-schema/package.json packages/event-schema/tsconfig.json packages/event-schema/tsconfig.build.json packages/event-schema/vitest.config.ts packages/core/package.json packages/core/tsconfig.json packages/core/tsconfig.build.json packages/core/tsconfig.no-dom.json packages/core/vitest.config.ts \"tooling/workspace-policy/src/**/*.ts\" \"tooling/workspace-policy/test/**/*.ts\" \"packages/event-schema/src/**/*.ts\" \"packages/event-schema/test/**/*.ts\" \"packages/core/src/**/*.ts\" \"packages/core/test/**/*.ts\" tooling/workspace-policy/README.md packages/event-schema/README.md packages/core/README.md README.md docs/architecture/monorepo-and-build.md docs/protocol/event-schema-foundation.md docs/protocol/event-envelope-v1.md docs/sdk/sdk-core-foundation.md",
  "lint": "eslint tooling/workspace-policy/src tooling/workspace-policy/test packages/event-schema/src packages/event-schema/test packages/event-schema/vitest.config.ts packages/core/src packages/core/test packages/core/vitest.config.ts",
  "test:coverage": "pnpm --filter @aurora/event-schema test:coverage && pnpm --filter @aurora/core test:coverage",
  "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:coverage && pnpm check:boundaries && pnpm build && pnpm --filter @aurora/event-schema test:package && pnpm --filter @aurora/core test:package",
  "check:ci": "pnpm check"
}
```

Keep the current recursive `typecheck`, `test`, `check:boundaries`, and `build` values unchanged. The root command now references only Core files that exist and makes Core coverage and built-entry checks mandatory.

### Step 6: Run focused green checks and inspect the documentation diff

- [ ] Run:

```powershell
pnpm --filter @aurora/core exec vitest run test/documentation-contract.test.ts
pnpm --filter @aurora/core test:package
pnpm exec prettier --check packages/core/README.md docs/sdk/sdk-core-foundation.md docs/README.md docs/architecture/sdk-architecture.md docs/architecture/formalization-readiness.md tooling/workspace-policy/README.md README.md docs/adr/ADR-003-sdk-plugin-architecture.md docs/adr/ADR-005-event-schema-source-of-truth.md docs/adr/ADR-006-one-way-dependencies.md docs/adr/README.md AGENTS.md AURORA_RULES.md
```

Expected: all commands exit `0`; documentation contract and built package tests pass; Prettier reports every named file formatted. Format only this task's files if correction is required; do not mechanically rewrite unrelated dirty documents.

- [ ] Inspect the full documentation diff. Search each status/evidence phrase and confirm no document claims Browser, collection, sampling, queue, transport, persistence, concrete event bodies, SDK release, CI, or cloud implementation.

### Step 7: Run the complete fresh quality gate before changing implementation status

- [ ] Run these commands in order and read every complete output:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm build
pnpm --filter @aurora/event-schema test:package
pnpm --filter @aurora/core test:package
pnpm check:ci
```

Expected: every command exits `0`. `pnpm typecheck` includes `packages/core/tsconfig.no-dom.json`; all unit and contract tests pass; Core coverage reports at least 85% lines, 80% branches, 85% functions, and 85% statements; boundary checks report no violations; both public package entry suites pass; `check:ci` finishes successfully.

- [ ] If any command fails, keep ADR-003 and readiness/status documents at their pre-implementation status until the failure is fixed and the complete sequence passes. Never weaken a test, threshold, lint rule, type rule, boundary, or documented exclusion to obtain green.

### Step 8: Record verified implementation status and bounded ADR evidence

- [ ] After Step 7 has passed in full, change both the frontmatter `implementation-status` and metadata `实施状态` from `not-started` to `in-progress` in `docs/adr/ADR-003-sdk-plugin-architecture.md`, set `last-reviewed: 2026-07-30`, and append:

```text
2026-07-30：`@aurora/core` 第一增量实现了环境无关 Core、显式生命周期、最小配置、插件注册与顺序编排、异常隔离、事件入口和多实例隔离；无 DOM 编译及自动边界已验证。Browser、具体插件、框架适配、采样、队列、传输和持久化仍未实现，因此 ADR 保持 in-progress。
```

- [ ] Append this bounded consumer evidence to `docs/adr/ADR-005-event-schema-source-of-truth.md`, retaining `accepted / in-progress`:

```text
2026-07-30：`@aurora/core` 成为首个真实 SDK 消费者，只通过 `@aurora/event-schema` 根公开出口调用 `parseEventEnvelope(input: unknown)` 并复用公共 issue 类型；Core 未复制协议字段或定义具体事件正文。具体正文和其他消费者仍不存在，ADR 保持 in-progress。
```

- [ ] Append this boundary evidence to `docs/adr/ADR-006-one-way-dependencies.md`, retaining `accepted / in-progress`:

```text
2026-07-30：Workspace policy 已自动约束 `sdk-core → protocol`，拒绝 Core 指向 Browser、插件、框架和 tooling 的依赖，并继续拒绝私有深导入与循环；Core 另有无 DOM 编译、浏览器全局和模块级可变状态负例。其他系统边界尚未实施，ADR 保持 in-progress。
```

For each ADR evidence section, follow its existing append-only structure and also record the exact implementation scope, public entry, evidence paths, `Commit: none` and `Issue/PR: none` when still true, every Step 7/8 validation command with its actual exit result, actual Vitest/coverage counts copied from the output, absent performance/package-size evidence, and the precise remaining unimplemented areas. Do not invent a test count or performance result. In ADR-006, correct its already-stale metadata line `实施状态：not-started` to `in-progress` and keep frontmatter `implementation-status: in-progress`; this is consistency repair, not a new state transition.

- [ ] Update `docs/README.md`, `docs/architecture/formalization-readiness.md`, `docs/adr/README.md`, `AGENTS.md`, and `AURORA_RULES.md` from their pre-gate wording:

  - mark exactly the Core foundation increment implemented and ADR-003 `accepted / in-progress`;
  - change the existing Core formal-index row from planned/absent to implemented/verified without duplicating the row;
  - keep ADR-005/006 `accepted / in-progress` and ADR-007 `accepted / implemented`;
  - preserve every upstream event-schema fact and unrelated user edit;
  - state that Browser, concrete plugins, adapters, sampling, queues, transport, persistence, concrete event bodies, services, CI, release, and infrastructure remain absent;
  - leave the next module in the ordered decision queue and do not start it.

- [ ] Validate the final evidence-bearing tree:

```powershell
pnpm exec prettier --check docs/README.md docs/architecture/formalization-readiness.md docs/adr/ADR-003-sdk-plugin-architecture.md docs/adr/ADR-005-event-schema-source-of-truth.md docs/adr/ADR-006-one-way-dependencies.md docs/adr/README.md AGENTS.md AURORA_RULES.md
pnpm --filter @aurora/core exec vitest run test/documentation-contract.test.ts
pnpm check:ci
```

Expected: every command exits `0`. The final `check:ci` runs after all status/evidence edits, so the delivered tree—not a pre-status intermediate tree—is the verified state.

### Step 9: Perform final scope and status audit

- [ ] Run read-only audits:

```powershell
rg -n "window|document|navigator|location|fetch|XMLHttpRequest|localStorage|sessionStorage" packages/core/src
rg -n "@aurora/.+/(src|internal)/|@aurora/(browser|plugin|react|vue)" packages/core
rg -n "queue|transport|retry|backoff|storage|endpoint|projectId" packages/core/src
git diff --check
git diff -- packages/core tooling/workspace-policy package.json pnpm-lock.yaml eslint.config.mjs README.md docs/sdk/sdk-core-foundation.md docs/README.md docs/architecture/sdk-architecture.md docs/architecture/formalization-readiness.md docs/adr AGENTS.md AURORA_RULES.md
git status --short --untracked-files=all
```

Expected: the first three searches exit `1` with no matches in Core source; `git diff --check` exits `0`; the diff contains only this increment plus preserved pre-existing work; status contains no staged files unless the user separately authorized staging. Confirm `packages/core` has no Browser, plugin package, adapter, queue, sampling, transport, persistence, server, CI, release, container, IaC, or cloud artifact.

**Suggested commit boundary:** `docs(core): record verified foundation evidence`

## Requirement-to-Task Traceability

| Requirement | Primary implementation evidence | Primary verification |
|---|---|---|
| Package root and environment-neutral boundary | Task 1 | Package contract, no-DOM `tsc`, ESLint, Workspace policy |
| Lifecycle and repeat semantics | Task 3 | `lifecycle.test.ts` including concurrent invocation order |
| Minimal immutable configuration and update boundary | Tasks 2–3 | `configuration.test.ts`, diagnostic-capacity behavior |
| Plugin contract and registration | Task 4 | `plugin-registration.test.ts`, runtime hostile-input cases |
| Plugin order, cleanup, and failure isolation | Task 6 | `plugin-lifecycle.test.ts`, host-safety tests |
| Event entry and event-schema single source | Task 5 | `event-entry.test.ts`, package dependency/private-import checks |
| Multi-instance isolation and no global state | Tasks 1 and 6 | Source policy plus `multi-instance.test.ts` |
| Safe bounded diagnostics | Tasks 2, 5, and 6 | Configuration/host/event/plugin tests |
| Public package and module documentation | Task 7 | Built package entry and documentation contract tests |
| ADR and readiness evidence | Task 7 | Fresh full gate before status changes and exact bounded evidence |

## Final Acceptance Checklist

- [ ] Every public symbol and signature matches the Frozen Public API section and `docs/sdk/sdk-core-foundation.md`.
- [ ] Every public operation has valid, invalid, repeat/closed-state, and failure coverage appropriate to its contract.
- [ ] Lifecycle state names, transition results, plugin hook signatures, order, and quarantine semantics are consistent in source, tests, README, and formal documents.
- [ ] Core source imports `@aurora/event-schema` only from its root; only tests may import its public contract-testkit subpath.
- [ ] No DOM/Browser symbol, concrete plugin dependency, framework dependency, private cross-package path, dependency cycle, or module-level mutable state survives automated checks.
- [ ] No unapproved endpoint, project identifier, network option, sampling option, queue, sender, persistence interface, or generic event bus exists.
- [ ] Results and diagnostics contain no exception object/message/stack, configuration value, event body, credential, URL, IP, or user content.
- [ ] Core line coverage is at least 85%, branch coverage at least 80%, function coverage at least 85%, and statement coverage at least 85% through real behavior tests.
- [ ] Root format, lint, typecheck, tests, coverage, boundaries, build, both package-entry suites, and `check:ci` all exit `0` from fresh output.
- [ ] ADR-003 is no further than `accepted / in-progress`; ADR-005/006 remain `accepted / in-progress`; ADR-007 remains `accepted / implemented`.
- [ ] Existing unrelated modifications remain intact; no commit, push, PR, merge, release, or deployment occurs without separate user authorization.
