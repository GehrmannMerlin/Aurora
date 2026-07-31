# Event Schema Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first independently useful `@aurora/event-schema` increment: a versioned public event envelope, bounded runtime validation, stable errors, shared contract samples, package boundaries, and verified documentation without defining concrete event bodies.

**Architecture:** `@aurora/event-schema` is a private, zero-runtime-dependency ESM package at the bottom of the Aurora dependency graph. Its root entry exposes only version/type constants, the envelope contract, limits, and `parseEventEnvelope(input: unknown)`; a separate `contract-testkit` entry exposes synthetic shared samples. A small package-local validator bounds untrusted `body` values while deliberately returning `body: unknown`, so later concrete event schemas can narrow it without this increment inventing fields.

**Tech Stack:** Node.js 24.18.0, pnpm 11.17.0, TypeScript 6.0.3 strict mode, Vitest 4.1.10, `@vitest/coverage-v8` 4.1.10, ESLint 10.8.0, Prettier 3.9.6, existing `@aurora/workspace-policy`.

## Global Constraints

- Implement only `packages/event-schema` plus the minimum root/tooling/documentation changes required to build and enforce this one module.
- Use [the approved module specification](../../protocol/event-schema-foundation.md), approved PRD/long-term norms, and accepted ADR-005/006/007 as authority; stop if a step conflicts with them.
- Do not define concrete error, request, performance, resource, behavior, user, breadcrumb, environment, release, project, batch, HTTP, ingestion, or processing fields.
- Keep `body: unknown` in the public success result. Passing envelope validation does not mean a concrete event body is valid.
- Keep the package `private: true` and version `0.0.0`; do not publish it or add release tooling.
- Add no runtime dependency. Reuse exact approved `@types/node@24.13.3`, `typescript@6.0.3`, and `vitest@4.1.10`; `@vitest/coverage-v8@4.1.10` is the only new package added to the lock graph.
- Preserve the existing root command names and exit semantics. Extend `check:ci` to enforce this package's coverage and package-entry checks.
- Use strict TypeScript. Do not use unexplained `any`, `Object`, `Function`, `Record<string, any>`, unsafe broad assertions, double assertions, non-null assertions, `@ts-ignore`, or silent catches.
- Treat all external values as `unknown`; public functions have explicit parameter and return types.
- Use `kebab-case` files, `PascalCase` public types/interfaces, `camelCase` functions/variables, and named constants for protocol versions/event types. Do not use event/version magic strings outside their defining modules and contract fixtures.
- Keep files and functions single-purpose. Do not create `utils`, `helpers`, `common`, a Schema registry, a generic DSL, compatibility converter, or speculative abstraction.
- Cross-package imports use only `@aurora/event-schema` or `@aurora/event-schema/contract-testkit`; never import another package's `src`, `internal`, test, or unexported path.
- Validation returns stable issues for invalid input and never logs or throws for ordinary validation failures. Tests and documentation contain synthetic, non-sensitive data only.
- Enforce at least 85% lines, 80% branches, 85% functions, and 85% statements for `packages/event-schema/src/**/*.ts`.
- Existing SDK-host lifecycle, browser proxy, plugin cleanup, retry, queue, and logging-level rules are not applicable because this module creates none of those behaviors. Do not add stubs for them.
- Each task follows red-green-refactor sequencing and ends with an independently testable deliverable and a suggested commit boundary. Do not execute any commit from this plan unless the user separately authorizes it.
- Do not create SDK Core, Browser, plugins, Vue/React adapters, ingestion, processing, services, databases, queues, object storage, management platform, CI workflows, release configuration, containers, IaC, or cloud resources.

---

## Planned File Responsibilities

| File | Responsibility |
|---|---|
| `package.json` | Preserve stable root commands while adding package-wide lint/type/test/build and event-schema coverage/entry gates |
| `pnpm-lock.yaml` | Record the sole new exact development dependency without unrelated upgrades |
| `eslint.config.mjs` | Apply existing strict typed rules to event-schema source, tests, and Vitest config |
| `tooling/workspace-policy/src/types.ts` | Add the stable `forbidden-layer-dependency` violation code |
| `tooling/workspace-policy/src/graph.ts` | Reject all local dependencies declared by an `aurora.layer: protocol` package |
| `tooling/workspace-policy/test/dependency-policy.test.ts` | Prove a protocol package cannot depend on a business/local package |
| `tooling/workspace-policy/test/event-schema-package-contract.test.ts` | Prove package identity, privacy, exports, scripts, and zero runtime dependencies |
| `tooling/workspace-policy/test/root-contract.test.ts` | Keep the root command contract explicit after adding coverage |
| `packages/event-schema/package.json` | Private ESM manifest, root/testkit exports, exact dev tools, and package commands |
| `packages/event-schema/tsconfig.json` | Strict no-emit source/test configuration |
| `packages/event-schema/tsconfig.build.json` | ESM and declaration build configuration |
| `packages/event-schema/vitest.config.ts` | Exact coverage inclusion and 85/80/85/85 thresholds |
| `packages/event-schema/src/constants.ts` | Protocol version and resource-limit constants |
| `packages/event-schema/src/event-types.ts` | Runtime event-type constants and type guard |
| `packages/event-schema/src/validation-issues.ts` | Stable public issue/result types and internal issue append helper |
| `packages/event-schema/src/value-boundaries.ts` | Bounded recursive scan of untrusted event bodies |
| `packages/event-schema/src/event-envelope.ts` | Public envelope and `parseEventEnvelope(input: unknown)` orchestration |
| `packages/event-schema/src/index.ts` | Minimal runtime public entry |
| `packages/event-schema/src/contract-testkit/*.ts` | Synthetic legal, illegal, and boundary samples exposed only through the testkit entry |
| `packages/event-schema/test/version-and-event-type.test.ts` | Version and event-type public behavior |
| `packages/event-schema/test/value-boundaries.test.ts` | String/array/object/depth/value/cycle/forbidden-field behavior |
| `packages/event-schema/test/event-envelope.test.ts` | Required fields, types, unknown fields, timestamp, enum, version, and result semantics |
| `packages/event-schema/test/consumers/*.test.ts` | SDK/ingestion/processing-shaped tests consuming one shared public sample source |
| `packages/event-schema/test/package-entry.test.ts` | Built root/testkit entry success and private subpath failure |
| `packages/event-schema/test/documentation-contract.test.ts` | Extract and validate README/protocol JSON examples |
| `packages/event-schema/README.md` | Real module contract, version, events, validation, errors, samples, commands, and authority |
| `docs/protocol/event-envelope-v1.md` | Human protocol meaning, fields, limits, examples, failure and compatibility semantics |
| `docs/README.md` | Add approved spec/plan now; implementation adds real module/protocol links only after verification |
| `docs/architecture/formalization-readiness.md` | Track the planned foundation increment without unblocking concrete event/consumer modules |
| `docs/adr/ADR-005-event-schema-source-of-truth.md` | Implementation appends `in-progress` evidence only after the final gate |
| `docs/adr/ADR-006-one-way-dependencies.md` | Implementation appends protocol-layer negative evidence; remains `in-progress` |
| `docs/adr/README.md` | Synchronize actual ADR dual states only after implementation |
| `AGENTS.md` / `AURORA_RULES.md` | Synchronize stage/queue only after verified implementation |

### Task 1: Package shell and executable protocol-layer boundary

**Files:**
- Create: `tooling/workspace-policy/test/event-schema-package-contract.test.ts`
- Modify: `tooling/workspace-policy/test/dependency-policy.test.ts`
- Modify: `tooling/workspace-policy/test/root-contract.test.ts`
- Modify: `tooling/workspace-policy/src/types.ts`
- Modify: `tooling/workspace-policy/src/graph.ts`
- Create: `packages/event-schema/package.json`
- Create: `packages/event-schema/tsconfig.json`
- Create: `packages/event-schema/tsconfig.build.json`
- Create: `packages/event-schema/vitest.config.ts`
- Modify: `package.json`
- Modify: `eslint.config.mjs`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: existing Workspace globs, root strict TypeScript baseline, root command names, `WorkspaceViolationCode`, `dependencyViolations(packages)`, and accepted ADR-006/007.
- Produces: private `@aurora/event-schema` package shell; root/testkit export declarations; package commands `build`, `typecheck`, `test`, `test:coverage`, `test:package`; root `test:coverage` command; public self-reference handling; and `forbidden-layer-dependency` enforcement for `aurora.layer: protocol`.

- [ ] **Step 1: Write the failing layer and package contract tests**

Append this test inside the existing `describe('Workspace dependency policy', ...)` block in `tooling/workspace-policy/test/dependency-policy.test.ts`:

```ts
  it('rejects every local dependency declared by a protocol package', async () => {
    const protocol = validManifest('@aurora/event-schema');
    protocol.aurora = { layer: 'protocol' };
    protocol.dependencies = { '@aurora/consumer': 'workspace:*' };
    fixture = await createWorkspaceFixture([
      { directory: 'packages/event-schema', manifest: protocol },
      { directory: 'packages/consumer', manifest: validManifest('@aurora/consumer') },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toMatchObject([
      {
        code: 'forbidden-layer-dependency',
        dependency: '@aurora/consumer',
        packageName: '@aurora/event-schema',
      },
    ]);
  });

  it('allows a public self-reference without a self dependency and still rejects private self paths', async () => {
    const protocol = validManifest('@aurora/event-schema');
    protocol.aurora = { layer: 'protocol' };
    protocol.exports = { '.': './src/index.ts', './contract-testkit': './src/testkit.ts' };
    fixture = await createWorkspaceFixture([
      {
        directory: 'packages/event-schema',
        manifest: protocol,
        files: {
          'test/consumer.ts': [
            "import '@aurora/event-schema';",
            "import '@aurora/event-schema/contract-testkit';",
            "import '@aurora/event-schema/internal/parser';",
            '',
          ].join('\n'),
        },
      },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toMatchObject([
      {
        code: 'private-path-import',
        dependency: '@aurora/event-schema/internal/parser',
        packageName: '@aurora/event-schema',
      },
    ]);
  });
```

Create `tooling/workspace-policy/test/event-schema-package-contract.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface EventSchemaManifest {
  readonly name?: unknown;
  readonly private?: unknown;
  readonly version?: unknown;
  readonly type?: unknown;
  readonly exports?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly scripts?: unknown;
  readonly aurora?: unknown;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

async function readManifest(): Promise<EventSchemaManifest> {
  const text = await readFile(
    new URL('../../../packages/event-schema/package.json', import.meta.url),
    'utf8',
  );
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new TypeError('event-schema package.json must be an object');
  return parsed;
}

describe('event-schema package contract', () => {
  it('is private, zero-runtime-dependency, and protocol layered', async () => {
    const manifest = await readManifest();
    expect(manifest.name).toBe('@aurora/event-schema');
    expect(manifest.version).toBe('0.0.0');
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe('module');
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toEqual({
      '@types/node': '24.13.3',
      '@vitest/coverage-v8': '4.1.10',
      typescript: '6.0.3',
      vitest: '4.1.10',
    });
    expect(manifest.aurora).toEqual({ layer: 'protocol' });
  });

  it('declares only the runtime root and contract testkit exports', async () => {
    const manifest = await readManifest();
    expect(manifest.exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './contract-testkit': {
        types: './dist/contract-testkit/index.d.ts',
        import: './dist/contract-testkit/index.js',
      },
    });
  });

  it('declares every package verification command', async () => {
    const manifest = await readManifest();
    expect(manifest.scripts).toEqual({
      build: 'tsc -p tsconfig.build.json',
      typecheck: 'tsc -p tsconfig.json --noEmit',
      test: 'vitest run --exclude test/package-entry.test.ts',
      'test:coverage': 'vitest run --coverage --exclude test/package-entry.test.ts',
      'test:package': 'pnpm build && vitest run test/package-entry.test.ts',
    });
  });
});
```

Update the expected root script names in `tooling/workspace-policy/test/root-contract.test.ts` to this exact array:

```ts
    expect(Object.keys(parsed.scripts).sort()).toEqual([
      'build',
      'check',
      'check:boundaries',
      'check:ci',
      'format:check',
      'lint',
      'test',
      'test:coverage',
      'typecheck',
    ]);
```

- [ ] **Step 2: Run the focused tests and confirm the intended failures**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/event-schema-package-contract.test.ts test/root-contract.test.ts
```

Expected: exit code `1`. The layer test fails because `forbidden-layer-dependency` is not emitted; the self-reference test reports undeclared dependencies instead of only the private-path violation; the package test fails with `ENOENT` for `packages/event-schema/package.json`; the root contract fails because `test:coverage` does not exist.

- [ ] **Step 3: Implement the protocol-layer violation**

Add the new literal to `WorkspaceViolationCode` in `tooling/workspace-policy/src/types.ts`:

```ts
export type WorkspaceViolationCode =
  | 'invalid-package-name'
  | 'missing-package-field'
  | 'non-workspace-local-dependency'
  | 'undeclared-dependency'
  | 'dependency-cycle'
  | 'private-path-import'
  | 'forbidden-layer-dependency';
```

Add these functions near `exportedSubpaths` in `tooling/workspace-policy/src/graph.ts`:

```ts
function packageLayer(workspacePackage: WorkspacePackage): string | undefined {
  const value = workspacePackage.manifest.aurora;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const layer = Reflect.get(value, 'layer');
  return typeof layer === 'string' ? layer : undefined;
}

function protocolLayerViolations(
  workspacePackage: WorkspacePackage,
  localDependencies: ReadonlySet<string>,
): readonly WorkspaceViolation[] {
  if (packageLayer(workspacePackage) !== 'protocol') return [];
  return [...localDependencies].sort().map((dependency) => ({
    code: 'forbidden-layer-dependency' as const,
    dependency,
    packageName: workspacePackage.name,
    message: `Protocol package must not depend on local package ${dependency}`,
  }));
}
```

Immediately after `graph.set(workspacePackage.name, localDependencies);` add:

```ts
    violations.push(...protocolLayerViolations(workspacePackage, localDependencies));
```

In the import loop, replace the undeclared-dependency condition with the exact self-reference-aware condition below. A package self-reference is not a dependency edge, but it still proceeds to the existing exported-subpath check:

```ts
      if (dependency !== workspacePackage.name && !(dependency in declared)) {
```

- [ ] **Step 4: Create the exact package/config shell and extend root commands**

Create `packages/event-schema/package.json`:

```json
{
  "name": "@aurora/event-schema",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Aurora public event protocol foundation",
  "sideEffects": false,
  "engines": {
    "node": ">=24.18.0 <25"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./contract-testkit": {
      "types": "./dist/contract-testkit/index.d.ts",
      "import": "./dist/contract-testkit/index.js"
    }
  },
  "files": [
    "dist"
  ],
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
  "aurora": {
    "layer": "protocol"
  }
}
```

Create `packages/event-schema/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

Create `packages/event-schema/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "types": []
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test/**/*.ts"]
}
```

Create `packages/event-schema/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@aurora\/event-schema$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      {
        find: /^@aurora\/event-schema\/contract-testkit$/,
        replacement: fileURLToPath(new URL('./src/contract-testkit/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/contract-testkit/index.ts'],
      thresholds: {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});
```

Replace the root `scripts` object in `package.json` with:

```json
{
  "format:check": "prettier --check package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json tooling/workspace-policy/package.json tooling/workspace-policy/tsconfig.json tooling/workspace-policy/tsconfig.build.json packages/event-schema/package.json packages/event-schema/tsconfig.json packages/event-schema/tsconfig.build.json packages/event-schema/vitest.config.ts \"tooling/workspace-policy/src/**/*.ts\" \"tooling/workspace-policy/test/**/*.ts\" \"packages/event-schema/src/**/*.ts\" \"packages/event-schema/test/**/*.ts\" tooling/workspace-policy/README.md packages/event-schema/README.md README.md docs/architecture/monorepo-and-build.md docs/protocol/event-schema-foundation.md docs/protocol/event-envelope-v1.md",
  "lint": "eslint tooling/workspace-policy/src tooling/workspace-policy/test packages/event-schema/src packages/event-schema/test packages/event-schema/vitest.config.ts",
  "typecheck": "pnpm -r --if-present typecheck",
  "test": "pnpm -r --if-present test",
  "test:coverage": "pnpm --filter @aurora/event-schema test:coverage",
  "check:boundaries": "tsx tooling/workspace-policy/src/cli.ts --root .",
  "build": "pnpm -r --if-present build",
  "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:coverage && pnpm check:boundaries && pnpm build && pnpm --filter @aurora/event-schema test:package",
  "check:ci": "pnpm check"
}
```

Replace the final typed-files block in `eslint.config.mjs` with:

```js
  {
    files: ['tooling/workspace-policy/**/*.ts', 'packages/event-schema/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
```

- [ ] **Step 5: Resolve the exact approved development tool graph**

Run:

```powershell
pnpm install
pnpm install --frozen-lockfile
```

Expected: both commands exit `0`; pnpm reports all three Workspace projects; the new importer reuses locked `@types/node@24.13.3`, TypeScript 6.0.3, and Vitest 4.1.10, while `@vitest/coverage-v8@4.1.10` and its required transitive graph are the only new packages; the second command does not change the lock file. Stop if unrelated dependencies upgrade or any new install script is requested beyond the existing approved `esbuild` entry.

- [ ] **Step 6: Run the focused green checks**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/event-schema-package-contract.test.ts test/root-contract.test.ts
pnpm check:boundaries
```

Expected: exit code `0`; all focused tests pass; public self-references pass without a self-dependency, private self-paths fail in the fixture, and the real repository boundary check is silent because `@aurora/event-schema` has no local dependency.

- [ ] **Step 7: Suggested commit boundary (do not execute without separate authorization)**

```bash
git add package.json pnpm-lock.yaml eslint.config.mjs tooling/workspace-policy/src/types.ts tooling/workspace-policy/src/graph.ts tooling/workspace-policy/test/dependency-policy.test.ts tooling/workspace-policy/test/event-schema-package-contract.test.ts tooling/workspace-policy/test/root-contract.test.ts packages/event-schema/package.json packages/event-schema/tsconfig.json packages/event-schema/tsconfig.build.json packages/event-schema/vitest.config.ts
git commit -m "build(protocol): scaffold event schema package"
```

### Task 2: Protocol version, event types, limits, and public result types

**Files:**
- Create: `packages/event-schema/test/version-and-event-type.test.ts`
- Create: `packages/event-schema/src/constants.ts`
- Create: `packages/event-schema/src/event-types.ts`
- Create: `packages/event-schema/src/validation-issues.ts`
- Create: `packages/event-schema/src/index.ts`

**Interfaces:**
- Consumes: Task 1 package shell and strict TypeScript configuration.
- Produces: `CURRENT_PROTOCOL_VERSION`, `SUPPORTED_PROTOCOL_VERSIONS`, `ProtocolVersion`, `EVENT_SCHEMA_LIMITS`, the `EventType` value/type pair, `isSupportedProtocolVersion(input)`, `isEventType(input)`, and all stable issue/result interfaces used by Tasks 3—6.

- [ ] **Step 1: Write the failing public version/type tests**

Create `packages/event-schema/test/version-and-event-type.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_LIMITS,
  EventType,
  SUPPORTED_PROTOCOL_VERSIONS,
  isEventType,
  isSupportedProtocolVersion,
} from '../src/index.js';

describe('protocol version contract', () => {
  it('exposes only protocol version 1', () => {
    expect(CURRENT_PROTOCOL_VERSION).toBe(1);
    expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual([1]);
    expect(isSupportedProtocolVersion(1)).toBe(true);
    expect(isSupportedProtocolVersion(0)).toBe(false);
    expect(isSupportedProtocolVersion(2)).toBe(false);
    expect(isSupportedProtocolVersion('1')).toBe(false);
  });
});

describe('event type contract', () => {
  it('exposes exactly the four approved event categories', () => {
    expect(EventType).toEqual({
      Error: 'error',
      Request: 'request',
      Performance: 'performance',
      Resource: 'resource',
    });
    for (const eventType of Object.values(EventType)) expect(isEventType(eventType)).toBe(true);
    expect(isEventType('behavior')).toBe(false);
    expect(isEventType('Error')).toBe(false);
    expect(isEventType(1)).toBe(false);
  });

  it('exports every exact validation limit', () => {
    expect(EVENT_SCHEMA_LIMITS).toEqual({
      maxEventIdLength: 128,
      maxStringLength: 4096,
      maxArrayLength: 100,
      maxObjectKeys: 100,
      maxObjectDepth: 8,
      maxIssues: 50,
    });
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-entry failure**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/version-and-event-type.test.ts
```

Expected: exit code `1` with module-not-found for `../src/index.js`.

- [ ] **Step 3: Implement exact constants and type guards**

Create `packages/event-schema/src/constants.ts`:

```ts
export const CURRENT_PROTOCOL_VERSION = 1 as const;

export const SUPPORTED_PROTOCOL_VERSIONS = [CURRENT_PROTOCOL_VERSION] as const;

export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

export const EVENT_SCHEMA_LIMITS = {
  maxEventIdLength: 128,
  maxStringLength: 4096,
  maxArrayLength: 100,
  maxObjectKeys: 100,
  maxObjectDepth: 8,
  maxIssues: 50,
} as const;

export function isSupportedProtocolVersion(input: unknown): input is ProtocolVersion {
  return input === CURRENT_PROTOCOL_VERSION;
}
```

Create `packages/event-schema/src/event-types.ts`:

```ts
export const EventType = {
  Error: 'error',
  Request: 'request',
  Performance: 'performance',
  Resource: 'resource',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

const eventTypes: ReadonlySet<unknown> = new Set(Object.values(EventType));

export function isEventType(input: unknown): input is EventType {
  return eventTypes.has(input);
}
```

Create `packages/event-schema/src/validation-issues.ts`:

```ts
import { EVENT_SCHEMA_LIMITS } from './constants.js';

export type EventSchemaIssueCode =
  | 'missing_required_field'
  | 'invalid_type'
  | 'unknown_field'
  | 'invalid_enum'
  | 'string_too_long'
  | 'array_too_large'
  | 'object_too_large'
  | 'object_too_deep'
  | 'cyclic_reference'
  | 'invalid_number'
  | 'invalid_timestamp'
  | 'unknown_event_type'
  | 'unsupported_protocol_version'
  | 'forbidden_field';

export interface EventSchemaIssue {
  readonly code: EventSchemaIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export interface EventEnvelopeParseFailure {
  readonly success: false;
  readonly issues: readonly EventSchemaIssue[];
}

export function appendIssue(
  issues: EventSchemaIssue[],
  issue: EventSchemaIssue,
): boolean {
  if (issues.length >= EVENT_SCHEMA_LIMITS.maxIssues) return false;
  issues.push(issue);
  return issues.length < EVENT_SCHEMA_LIMITS.maxIssues;
}
```

Create `packages/event-schema/src/index.ts`:

```ts
export {
  CURRENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_LIMITS,
  SUPPORTED_PROTOCOL_VERSIONS,
  isSupportedProtocolVersion,
  type ProtocolVersion,
} from './constants.js';
export { EventType, isEventType } from './event-types.js';
export type { EventType } from './event-types.js';
export type {
  EventEnvelopeParseFailure,
  EventSchemaIssue,
  EventSchemaIssueCode,
} from './validation-issues.js';
```

TypeScript keeps value and type namespaces separate, so consumers use `EventType.Error` as a runtime constant and `EventType` as the exact public union type.

- [ ] **Step 4: Run tests, strict typing, and build**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/version-and-event-type.test.ts
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema build
```

Expected: all commands exit `0`; generated `dist/index.d.ts` includes exact literal version `1`, all six limits, the `EventType` value/type pair, and result types.

- [ ] **Step 5: Suggested commit boundary (do not execute without separate authorization)**

```bash
git add packages/event-schema/src/constants.ts packages/event-schema/src/event-types.ts packages/event-schema/src/validation-issues.ts packages/event-schema/src/index.ts packages/event-schema/test/version-and-event-type.test.ts
git commit -m "feat(protocol): define event schema foundation types"
```

### Task 3: Bounded validation of untrusted event bodies

**Files:**
- Create: `packages/event-schema/test/value-boundaries.test.ts`
- Create: `packages/event-schema/src/value-boundaries.ts`

**Interfaces:**
- Consumes: Task 2 `EVENT_SCHEMA_LIMITS`, `EventSchemaIssue`, `EventSchemaIssueCode`, and `appendIssue()`.
- Produces: package-private `validateBodyValue(input: unknown, issues: EventSchemaIssue[]): void`, which Tasks 4—6 use to enforce string, array, object, depth, JSON-value, cycle, issue-count, and forbidden-field limits.

- [ ] **Step 1: Write failing boundary tests against public envelope behavior**

Create `packages/event-schema/test/value-boundaries.test.ts` with a temporary import of `validateBodyValue`; Task 4 will keep this source-level unit test and also verify the same behavior through `parseEventEnvelope`:

```ts
import { describe, expect, it } from 'vitest';
import { EVENT_SCHEMA_LIMITS } from '../src/constants.js';
import type { EventSchemaIssueCode } from '../src/validation-issues.js';
import { validateBodyValue } from '../src/value-boundaries.js';

function issueCodes(input: unknown): readonly EventSchemaIssueCode[] {
  const issues: Parameters<typeof validateBodyValue>[1] = [];
  validateBodyValue(input, issues);
  return issues.map(({ code }) => code);
}

function nestedObject(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) value = { nested: value };
  return value;
}

describe('event body resource boundaries', () => {
  it('accepts all JSON primitives and exact maximum boundaries', () => {
    expect(issueCodes(null)).toEqual([]);
    expect(issueCodes(true)).toEqual([]);
    expect(issueCodes(42)).toEqual([]);
    expect(issueCodes('x'.repeat(EVENT_SCHEMA_LIMITS.maxStringLength))).toEqual([]);
    expect(issueCodes(Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength }, () => null))).toEqual(
      [],
    );
    expect(
      issueCodes(
        Object.fromEntries(
          Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys }, (_, index) => [
            `field${index}`,
            null,
          ]),
        ),
      ),
    ).toEqual([]);
    expect(issueCodes(nestedObject(EVENT_SCHEMA_LIMITS.maxObjectDepth))).toEqual([]);
  });

  it('rejects strings, arrays, objects, and nesting one unit over their limits', () => {
    expect(issueCodes('x'.repeat(EVENT_SCHEMA_LIMITS.maxStringLength + 1))).toContain(
      'string_too_long',
    );
    expect(
      issueCodes(Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength + 1 }, () => null)),
    ).toContain('array_too_large');
    expect(
      issueCodes(
        Object.fromEntries(
          Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys + 1 }, (_, index) => [
            `field${index}`,
            null,
          ]),
        ),
      ),
    ).toContain('object_too_large');
    expect(issueCodes(nestedObject(EVENT_SCHEMA_LIMITS.maxObjectDepth + 1))).toContain(
      'object_too_deep',
    );
  });

  it('rejects non-JSON numbers and values', () => {
    expect(issueCodes(Number.NaN)).toContain('invalid_number');
    expect(issueCodes(Number.POSITIVE_INFINITY)).toContain('invalid_number');
    expect(issueCodes(undefined)).toContain('invalid_type');
    expect(issueCodes(1n)).toContain('invalid_type');
    expect(issueCodes(new Date(0))).toContain('invalid_type');
    expect(issueCodes(new Map())).toContain('invalid_type');
    expect(issueCodes(() => undefined)).toContain('invalid_type');
  });

  it('rejects cyclic values without throwing', () => {
    const input: { self?: unknown } = {};
    input.self = input;
    expect(issueCodes(input)).toContain('cyclic_reference');
  });

  it.each([
    'authorization',
    'Authorization',
    'cookie',
    'password',
    'requestBody',
    'responseBody',
    'formData',
    'dom',
    'consoleLog',
    'ipAddress',
  ])('rejects forbidden field %s at any nesting level', (fieldName) => {
    expect(issueCodes({ safe: { [fieldName]: 'synthetic' } })).toContain('forbidden_field');
  });

  it('caps diagnostics at maxIssues', () => {
    const input = Array.from({ length: EVENT_SCHEMA_LIMITS.maxIssues }, () => undefined);
    expect(issueCodes(input)).toHaveLength(EVENT_SCHEMA_LIMITS.maxIssues);
  });
});
```

- [ ] **Step 2: Run the boundary test and verify the missing-module failure**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/value-boundaries.test.ts
```

Expected: exit code `1` with module-not-found for `../src/value-boundaries.js`.

- [ ] **Step 3: Implement the complete bounded walker**

Create `packages/event-schema/src/value-boundaries.ts`:

```ts
import { EVENT_SCHEMA_LIMITS } from './constants.js';
import { appendIssue, type EventSchemaIssue } from './validation-issues.js';

const FORBIDDEN_FIELD_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'password',
  'requestbody',
  'responsebody',
  'formdata',
  'dom',
  'consolelog',
  'ipaddress',
]);

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function addIssue(
  issues: EventSchemaIssue[],
  code: EventSchemaIssue['code'],
  path: readonly (string | number)[],
  message: string,
): boolean {
  return appendIssue(issues, { code, path: [...path], message });
}

function visitValue(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
  depth: number,
  ancestors: ReadonlySet<object>,
): void {
  if (issues.length >= EVENT_SCHEMA_LIMITS.maxIssues) return;
  if (depth > EVENT_SCHEMA_LIMITS.maxObjectDepth) {
    addIssue(issues, 'object_too_deep', path, 'Event body exceeds maximum object depth');
    return;
  }
  if (input === null || typeof input === 'boolean') return;
  if (typeof input === 'string') {
    if (input.length > EVENT_SCHEMA_LIMITS.maxStringLength) {
      addIssue(issues, 'string_too_long', path, 'Event body string exceeds maximum length');
    }
    return;
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      addIssue(issues, 'invalid_number', path, 'Event body number must be finite');
    }
    return;
  }
  if (typeof input !== 'object') {
    addIssue(issues, 'invalid_type', path, 'Event body contains a non-JSON value');
    return;
  }
  if (ancestors.has(input)) {
    addIssue(issues, 'cyclic_reference', path, 'Event body must not contain a cycle');
    return;
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(input);

  if (Array.isArray(input)) {
    if (input.length > EVENT_SCHEMA_LIMITS.maxArrayLength) {
      addIssue(issues, 'array_too_large', path, 'Event body array exceeds maximum length');
      return;
    }
    for (const [index, value] of input.entries()) {
      visitValue(value, issues, [...path, index], depth + 1, nextAncestors);
      if (issues.length >= EVENT_SCHEMA_LIMITS.maxIssues) return;
    }
    return;
  }

  if (!isPlainObject(input)) {
    addIssue(issues, 'invalid_type', path, 'Event body object must be a plain JSON object');
    return;
  }
  const keys = Object.keys(input).sort();
  if (keys.length > EVENT_SCHEMA_LIMITS.maxObjectKeys) {
    addIssue(issues, 'object_too_large', path, 'Event body object exceeds maximum key count');
    return;
  }
  for (const key of keys) {
    const childPath = [...path, key];
    if (FORBIDDEN_FIELD_NAMES.has(key.toLowerCase())) {
      if (!addIssue(issues, 'forbidden_field', childPath, 'Event body contains a forbidden field')) {
        return;
      }
      continue;
    }
    visitValue(input[key], issues, childPath, depth + 1, nextAncestors);
    if (issues.length >= EVENT_SCHEMA_LIMITS.maxIssues) return;
  }
}

export function validateBodyValue(input: unknown, issues: EventSchemaIssue[]): void {
  visitValue(input, issues, ['body'], 0, new Set());
}
```

- [ ] **Step 4: Run focused tests and strict checks**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/value-boundaries.test.ts test/version-and-event-type.test.ts
pnpm --filter @aurora/event-schema typecheck
pnpm lint
```

Expected: all commands exit `0`; exact limits pass, one-over limits fail with their stable issue codes, all forbidden fields fail case-insensitively, cycles do not throw, and no more than 50 issues are returned.

- [ ] **Step 5: Suggested commit boundary (do not execute without separate authorization)**

```bash
git add packages/event-schema/src/value-boundaries.ts packages/event-schema/test/value-boundaries.test.ts
git commit -m "feat(protocol): bound untrusted event bodies"
```

### Task 4: Public event envelope parser and stable failure semantics

**Files:**
- Create: `packages/event-schema/test/event-envelope.test.ts`
- Create: `packages/event-schema/src/event-envelope.ts`
- Modify: `packages/event-schema/src/index.ts`

**Interfaces:**
- Consumes: Task 2 version/event constants and result types; Task 3 `validateBodyValue(input, issues)`.
- Produces: `EventEnvelope`, `EventEnvelopeParseSuccess`, `EventEnvelopeParseResult`, and `parseEventEnvelope(input: unknown): EventEnvelopeParseResult` through the root public entry.

- [ ] **Step 1: Write failing black-box envelope tests**

Create `packages/event-schema/test/event-envelope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_LIMITS,
  EventType,
  parseEventEnvelope,
} from '../src/index.js';

const validInput = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId: 'evt-synthetic-001',
  eventType: EventType.Error,
  occurredAt: 1_800_000_000_000,
  body: {},
} as const;

function issueCodes(input: unknown): readonly string[] {
  const result = parseEventEnvelope(input);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

describe('parseEventEnvelope', () => {
  it('returns the exact validated envelope for a legal input', () => {
    expect(parseEventEnvelope(validInput)).toEqual({ success: true, data: validInput });
  });

  it.each(['protocolVersion', 'eventId', 'eventType', 'occurredAt', 'body'])(
    'rejects missing required field %s',
    (fieldName) => {
      const input: Record<string, unknown> = { ...validInput };
      Reflect.deleteProperty(input, fieldName);
      expect(issueCodes(input)).toContain('missing_required_field');
    },
  );

  it('rejects a non-object input and an unknown top-level field', () => {
    expect(issueCodes(null)).toContain('invalid_type');
    expect(issueCodes([])).toContain('invalid_type');
    expect(issueCodes({ ...validInput, extra: true })).toContain('unknown_field');
  });

  it('separates type, unsupported-version, invalid-enum, and unknown-event failures', () => {
    expect(issueCodes({ ...validInput, protocolVersion: '1' })).toContain('invalid_type');
    expect(issueCodes({ ...validInput, protocolVersion: 2 })).toContain(
      'unsupported_protocol_version',
    );
    expect(issueCodes({ ...validInput, eventType: 1 })).toContain('invalid_type');
    expect(issueCodes({ ...validInput, eventType: 'Error' })).toContain('invalid_enum');
    expect(issueCodes({ ...validInput, eventType: 'session-replay' })).toContain(
      'unknown_event_type',
    );
  });

  it('enforces event ID type, emptiness, and maximum length', () => {
    expect(issueCodes({ ...validInput, eventId: 1 })).toContain('invalid_type');
    expect(issueCodes({ ...validInput, eventId: '' })).toContain('invalid_type');
    expect(
      issueCodes({ ...validInput, eventId: 'x'.repeat(EVENT_SCHEMA_LIMITS.maxEventIdLength) }),
    ).toEqual([]);
    expect(
      issueCodes({ ...validInput, eventId: 'x'.repeat(EVENT_SCHEMA_LIMITS.maxEventIdLength + 1) }),
    ).toContain('string_too_long');
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid timestamp %s',
    (occurredAt) => {
      expect(issueCodes({ ...validInput, occurredAt })).toContain('invalid_timestamp');
    },
  );

  it('rejects timestamp type errors separately', () => {
    expect(issueCodes({ ...validInput, occurredAt: '1800000000000' })).toContain('invalid_type');
  });

  it('returns body-boundary issues through the public parser without logging or throwing', () => {
    expect(
      issueCodes({ ...validInput, body: { nested: { password: 'synthetic' } } }),
    ).toContain('forbidden_field');
    expect(
      issueCodes({ ...validInput, body: ['x'.repeat(EVENT_SCHEMA_LIMITS.maxStringLength + 1)] }),
    ).toContain('string_too_long');
  });

  it('caps public diagnostics without exposing input values', () => {
    const result = parseEventEnvelope({
      ...validInput,
      extra: 'synthetic-secret-value',
      body: Array.from({ length: EVENT_SCHEMA_LIMITS.maxIssues }, () => undefined),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toHaveLength(EVENT_SCHEMA_LIMITS.maxIssues);
      expect(JSON.stringify(result.issues)).not.toContain('synthetic-secret-value');
    }
  });
});
```

- [ ] **Step 2: Run the envelope test and confirm the missing-export failure**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/event-envelope.test.ts
```

Expected: exit code `1`; Vitest reports that `parseEventEnvelope` is not exported.

- [ ] **Step 3: Implement the complete public parser**

Create `packages/event-schema/src/event-envelope.ts`:

```ts
import {
  EVENT_SCHEMA_LIMITS,
  isSupportedProtocolVersion,
  type ProtocolVersion,
} from './constants.js';
import { EventType, isEventType, type EventType as EventTypeValue } from './event-types.js';
import {
  appendIssue,
  type EventEnvelopeParseFailure,
  type EventSchemaIssue,
} from './validation-issues.js';
import { validateBodyValue } from './value-boundaries.js';

export interface EventEnvelope {
  readonly protocolVersion: ProtocolVersion;
  readonly eventId: string;
  readonly eventType: EventTypeValue;
  readonly occurredAt: number;
  readonly body: unknown;
}

export interface EventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: EventEnvelope;
}

export type EventEnvelopeParseResult = EventEnvelopeParseSuccess | EventEnvelopeParseFailure;

const REQUIRED_FIELDS = [
  'protocolVersion',
  'eventId',
  'eventType',
  'occurredAt',
  'body',
] as const;
const ALLOWED_FIELDS: ReadonlySet<string> = new Set(REQUIRED_FIELDS);
const canonicalEventTypes: ReadonlySet<string> = new Set(Object.values(EventType));

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function addIssue(
  issues: EventSchemaIssue[],
  code: EventSchemaIssue['code'],
  path: readonly (string | number)[],
  message: string,
): void {
  appendIssue(issues, { code, path, message });
}

function validateProtocolVersion(
  input: unknown,
  issues: EventSchemaIssue[],
): ProtocolVersion | undefined {
  if (typeof input !== 'number') {
    addIssue(issues, 'invalid_type', ['protocolVersion'], 'protocolVersion must be a number');
    return undefined;
  }
  if (!isSupportedProtocolVersion(input)) {
    addIssue(
      issues,
      'unsupported_protocol_version',
      ['protocolVersion'],
      'protocolVersion is not supported',
    );
    return undefined;
  }
  return input;
}

function validateEventId(input: unknown, issues: EventSchemaIssue[]): string | undefined {
  if (typeof input !== 'string' || input.length === 0) {
    addIssue(issues, 'invalid_type', ['eventId'], 'eventId must be a non-empty string');
    return undefined;
  }
  if (input.length > EVENT_SCHEMA_LIMITS.maxEventIdLength) {
    addIssue(issues, 'string_too_long', ['eventId'], 'eventId exceeds maximum length');
    return undefined;
  }
  return input;
}

function validateEventType(
  input: unknown,
  issues: EventSchemaIssue[],
): EventTypeValue | undefined {
  if (typeof input !== 'string') {
    addIssue(issues, 'invalid_type', ['eventType'], 'eventType must be a string');
    return undefined;
  }
  if (isEventType(input)) return input;
  if (canonicalEventTypes.has(input.toLowerCase())) {
    addIssue(issues, 'invalid_enum', ['eventType'], 'eventType values are case-sensitive');
    return undefined;
  }
  addIssue(issues, 'unknown_event_type', ['eventType'], 'eventType is not supported');
  return undefined;
}

function validateOccurredAt(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  if (typeof input !== 'number') {
    addIssue(issues, 'invalid_type', ['occurredAt'], 'occurredAt must be a number');
    return undefined;
  }
  if (!Number.isSafeInteger(input) || input <= 0) {
    addIssue(
      issues,
      'invalid_timestamp',
      ['occurredAt'],
      'occurredAt must be a positive safe integer in Unix epoch milliseconds',
    );
    return undefined;
  }
  return input;
}

export function parseEventEnvelope(input: unknown): EventEnvelopeParseResult {
  if (!isPlainRecord(input)) {
    return {
      success: false,
      issues: [{ code: 'invalid_type', path: [], message: 'Event envelope must be a plain object' }],
    };
  }

  const issues: EventSchemaIssue[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in input)) {
      addIssue(issues, 'missing_required_field', [field], `Missing required field: ${field}`);
    }
  }
  for (const field of Object.keys(input).sort()) {
    if (!ALLOWED_FIELDS.has(field)) {
      addIssue(issues, 'unknown_field', [field], `Unknown event envelope field: ${field}`);
    }
  }

  const protocolVersion = validateProtocolVersion(input.protocolVersion, issues);
  const eventId = validateEventId(input.eventId, issues);
  const eventType = validateEventType(input.eventType, issues);
  const occurredAt = validateOccurredAt(input.occurredAt, issues);
  validateBodyValue(input.body, issues);

  if (
    issues.length > 0 ||
    protocolVersion === undefined ||
    eventId === undefined ||
    eventType === undefined ||
    occurredAt === undefined
  ) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: { protocolVersion, eventId, eventType, occurredAt, body: input.body },
  };
}
```

Append these exports to `packages/event-schema/src/index.ts`:

```ts
export {
  parseEventEnvelope,
  type EventEnvelope,
  type EventEnvelopeParseResult,
  type EventEnvelopeParseSuccess,
} from './event-envelope.js';
```

- [ ] **Step 4: Run black-box, boundary, type, and build regressions**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/event-envelope.test.ts test/value-boundaries.test.ts test/version-and-event-type.test.ts
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema build
```

Expected: all commands exit `0`; validation failures are returned as stable issues; no test observes a thrown validation exception; `EventEnvelope.body` remains `unknown` in `dist/event-envelope.d.ts`.

- [ ] **Step 5: Suggested commit boundary (do not execute without separate authorization)**

```bash
git add packages/event-schema/src/event-envelope.ts packages/event-schema/src/index.ts packages/event-schema/test/event-envelope.test.ts
git commit -m "feat(protocol): validate public event envelopes"
```

### Task 5: Shared legal, illegal, and boundary contracts plus package exports

**Files:**
- Create: `packages/event-schema/src/contract-testkit/valid-samples.ts`
- Create: `packages/event-schema/src/contract-testkit/invalid-samples.ts`
- Create: `packages/event-schema/src/contract-testkit/boundary-samples.ts`
- Create: `packages/event-schema/src/contract-testkit/index.ts`
- Create: `packages/event-schema/test/consumers/sdk-consumer.contract.test.ts`
- Create: `packages/event-schema/test/consumers/ingestion-consumer.contract.test.ts`
- Create: `packages/event-schema/test/consumers/processing-consumer.contract.test.ts`
- Create: `packages/event-schema/test/package-entry.test.ts`

**Interfaces:**
- Consumes: Task 4 root public entry and exact parser/error behavior.
- Produces: `InvalidEventEnvelopeSample`, `BoundaryEventEnvelopeSample`, `validEventEnvelopeSamples`, `invalidEventEnvelopeSamples`, and `boundaryEventEnvelopeSamples` through `@aurora/event-schema/contract-testkit`; three consumer-shaped contract suites; and built export/private-path evidence.

- [ ] **Step 1: Write failing consumer and package-entry tests**

Create `packages/event-schema/test/consumers/sdk-consumer.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEventEnvelope } from '@aurora/event-schema';
import { validEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';

describe('SDK producer contract', () => {
  it('accepts every shared legal envelope through the public parser', () => {
    expect(validEventEnvelopeSamples).toHaveLength(6);
    for (const sample of validEventEnvelopeSamples) {
      expect(parseEventEnvelope(sample)).toEqual({ success: true, data: sample });
    }
  });
});
```

Create `packages/event-schema/test/consumers/ingestion-consumer.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEventEnvelope } from '@aurora/event-schema';
import { invalidEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';

describe('ingestion consumer contract', () => {
  it('rejects every shared illegal envelope with its stable issue code', () => {
    for (const sample of invalidEventEnvelopeSamples) {
      const result = parseEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(false);
      if (!result.success) {
        expect(
          result.issues.map(({ code }) => code),
          sample.name,
        ).toContain(sample.expectedIssueCode);
      }
    }
  });
});
```

Create `packages/event-schema/test/consumers/processing-consumer.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEventEnvelope } from '@aurora/event-schema';
import { boundaryEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';

describe('processing consumer contract', () => {
  it('agrees with every shared boundary expectation', () => {
    for (const sample of boundaryEventEnvelopeSamples) {
      const result = parseEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(sample.isValid);
      if (!sample.isValid && !result.success) {
        expect(
          result.issues.map(({ code }) => code),
          sample.name,
        ).toContain(sample.expectedIssueCode);
      }
    }
  });
});
```

Create `packages/event-schema/test/package-entry.test.ts`:

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

describe('built package entries', () => {
  it('loads the declared root entry', () => {
    const result = importFromPackage('@aurora/event-schema');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('parseEventEnvelope');
    expect(result.stdout).toContain('CURRENT_PROTOCOL_VERSION');
  });

  it('loads the declared contract-testkit entry', () => {
    const result = importFromPackage('@aurora/event-schema/contract-testkit');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('validEventEnvelopeSamples');
    expect(result.stdout).toContain('invalidEventEnvelopeSamples');
    expect(result.stdout).toContain('boundaryEventEnvelopeSamples');
  });

  it('rejects private and unexported paths', () => {
    for (const specifier of [
      '@aurora/event-schema/src/index.js',
      '@aurora/event-schema/internal/parser.js',
      '@aurora/event-schema/value-boundaries',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });
});
```

- [ ] **Step 2: Run consumer tests and confirm the missing-testkit failure**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/consumers
```

Expected: exit code `1` because the public testkit alias resolves to the missing `src/contract-testkit/index.ts`. Do not run `package-entry.test.ts` until the testkit source has been built.

- [ ] **Step 3: Implement all valid shared samples**

Create `packages/event-schema/src/contract-testkit/valid-samples.ts`:

```ts
import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import type { EventEnvelope } from '../event-envelope.js';
import { EventType } from '../event-types.js';

export const validEventEnvelopeSamples: readonly EventEnvelope[] = [
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-error-synthetic-001',
    eventType: EventType.Error,
    occurredAt: 1_800_000_000_001,
    body: {},
  },
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-request-synthetic-001',
    eventType: EventType.Request,
    occurredAt: 1_800_000_000_002,
    body: {},
  },
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-performance-synthetic-001',
    eventType: EventType.Performance,
    occurredAt: 1_800_000_000_003,
    body: {},
  },
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-resource-synthetic-001',
    eventType: EventType.Resource,
    occurredAt: 1_800_000_000_004,
    body: {},
  },
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-compatible-old-shape',
    eventType: EventType.Error,
    occurredAt: 1_800_000_000_005,
    body: {},
  },
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-compatible-new-shape',
    eventType: EventType.Error,
    occurredAt: 1_800_000_000_006,
    body: { optionalContext: { attempt: 1 } },
  },
];
```

- [ ] **Step 4: Implement all invalid shared samples**

Create `packages/event-schema/src/contract-testkit/invalid-samples.ts`:

```ts
import { CURRENT_PROTOCOL_VERSION, EVENT_SCHEMA_LIMITS } from '../constants.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface InvalidEventEnvelopeSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

const validBase = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId: 'evt-invalid-synthetic-base',
  eventType: EventType.Error,
  occurredAt: 1_800_000_000_100,
  body: {},
} as const;

function nestedBody(depth: number): unknown {
  let body: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) body = { nested: body };
  return body;
}

const cyclicBody: { self?: unknown } = {};
cyclicBody.self = cyclicBody;

export const invalidEventEnvelopeSamples: readonly InvalidEventEnvelopeSample[] = [
  {
    name: 'missing eventId',
    input: {
      protocolVersion: validBase.protocolVersion,
      eventType: validBase.eventType,
      occurredAt: validBase.occurredAt,
      body: validBase.body,
    },
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'protocol version has wrong type',
    input: { ...validBase, protocolVersion: '1' },
    expectedIssueCode: 'invalid_type',
  },
  {
    name: 'unsupported protocol version',
    input: { ...validBase, protocolVersion: 2 },
    expectedIssueCode: 'unsupported_protocol_version',
  },
  {
    name: 'event enum has wrong case',
    input: { ...validBase, eventType: 'Error' },
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'unknown event type',
    input: { ...validBase, eventType: 'session-replay' },
    expectedIssueCode: 'unknown_event_type',
  },
  {
    name: 'event ID is too long',
    input: { ...validBase, eventId: 'x'.repeat(EVENT_SCHEMA_LIMITS.maxEventIdLength + 1) },
    expectedIssueCode: 'string_too_long',
  },
  {
    name: 'event body string is too long',
    input: { ...validBase, body: 'x'.repeat(EVENT_SCHEMA_LIMITS.maxStringLength + 1) },
    expectedIssueCode: 'string_too_long',
  },
  {
    name: 'event body array is too large',
    input: {
      ...validBase,
      body: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength + 1 }, () => null),
    },
    expectedIssueCode: 'array_too_large',
  },
  {
    name: 'event body object has too many keys',
    input: {
      ...validBase,
      body: Object.fromEntries(
        Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys + 1 }, (_, index) => [
          `field${index}`,
          null,
        ]),
      ),
    },
    expectedIssueCode: 'object_too_large',
  },
  {
    name: 'event body object is too deep',
    input: { ...validBase, body: nestedBody(EVENT_SCHEMA_LIMITS.maxObjectDepth + 1) },
    expectedIssueCode: 'object_too_deep',
  },
  {
    name: 'event timestamp is invalid',
    input: { ...validBase, occurredAt: 0 },
    expectedIssueCode: 'invalid_timestamp',
  },
  {
    name: 'event body number is not finite',
    input: { ...validBase, body: Number.NaN },
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'event body is cyclic',
    input: { ...validBase, body: cyclicBody },
    expectedIssueCode: 'cyclic_reference',
  },
  {
    name: 'event body contains forbidden field',
    input: { ...validBase, body: { nested: { authorization: 'synthetic' } } },
    expectedIssueCode: 'forbidden_field',
  },
  {
    name: 'event envelope has an unknown field',
    input: { ...validBase, extra: true },
    expectedIssueCode: 'unknown_field',
  },
];
```

- [ ] **Step 5: Implement exact boundary and compatibility samples**

Create `packages/event-schema/src/contract-testkit/boundary-samples.ts`:

```ts
import { CURRENT_PROTOCOL_VERSION, EVENT_SCHEMA_LIMITS } from '../constants.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface BoundaryEventEnvelopeSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

function nestedBody(depth: number): unknown {
  let body: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) body = { nested: body };
  return body;
}

const base = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventType: EventType.Performance,
  occurredAt: 1_800_000_000_200,
} as const;

export const boundaryEventEnvelopeSamples: readonly BoundaryEventEnvelopeSample[] = [
  {
    name: 'maximum event ID and string length',
    input: {
      ...base,
      eventId: 'e'.repeat(EVENT_SCHEMA_LIMITS.maxEventIdLength),
      body: 'x'.repeat(EVENT_SCHEMA_LIMITS.maxStringLength),
    },
    isValid: true,
  },
  {
    name: 'maximum array length',
    input: {
      ...base,
      eventId: 'evt-boundary-array',
      body: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength }, () => null),
    },
    isValid: true,
  },
  {
    name: 'maximum object key count',
    input: {
      ...base,
      eventId: 'evt-boundary-object-keys',
      body: Object.fromEntries(
        Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys }, (_, index) => [
          `field${index}`,
          null,
        ]),
      ),
    },
    isValid: true,
  },
  {
    name: 'maximum object depth',
    input: {
      ...base,
      eventId: 'evt-boundary-depth',
      body: nestedBody(EVENT_SCHEMA_LIMITS.maxObjectDepth),
    },
    isValid: true,
  },
  {
    name: 'one over maximum object depth',
    input: {
      ...base,
      eventId: 'evt-boundary-depth-over',
      body: nestedBody(EVENT_SCHEMA_LIMITS.maxObjectDepth + 1),
    },
    isValid: false,
    expectedIssueCode: 'object_too_deep',
  },
  {
    name: 'same-version older shape without optional body data',
    input: { ...base, eventId: 'evt-compatible-old', body: {} },
    isValid: true,
  },
  {
    name: 'same-version newer shape with optional body data',
    input: {
      ...base,
      eventId: 'evt-compatible-new',
      body: { optionalContext: { attempt: 1 } },
    },
    isValid: true,
  },
  {
    name: 'older unsupported protocol version',
    input: { ...base, protocolVersion: 0, eventId: 'evt-version-old', body: {} },
    isValid: false,
    expectedIssueCode: 'unsupported_protocol_version',
  },
  {
    name: 'newer unsupported protocol version',
    input: { ...base, protocolVersion: 2, eventId: 'evt-version-new', body: {} },
    isValid: false,
    expectedIssueCode: 'unsupported_protocol_version',
  },
];
```

Create `packages/event-schema/src/contract-testkit/index.ts`:

```ts
export {
  boundaryEventEnvelopeSamples,
  type BoundaryEventEnvelopeSample,
} from './boundary-samples.js';
export {
  invalidEventEnvelopeSamples,
  type InvalidEventEnvelopeSample,
} from './invalid-samples.js';
export { validEventEnvelopeSamples } from './valid-samples.js';
```

- [ ] **Step 6: Run shared consumer contracts**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/consumers
pnpm --filter @aurora/event-schema typecheck
```

Expected: exit code `0`; SDK-shaped tests accept 6 legal samples, ingestion-shaped tests reject every illegal sample with the declared issue, and processing-shaped tests agree with every boundary/compatibility expectation.

- [ ] **Step 7: Build and verify only public package entries load**

Run:

```powershell
pnpm --filter @aurora/event-schema build
pnpm --filter @aurora/event-schema exec vitest run test/package-entry.test.ts
pnpm check:boundaries
```

Expected: all commands exit `0`; Node imports both declared entries; all three private/unexported paths fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`; the repository boundary command remains silent and successful.

- [ ] **Step 8: Suggested commit boundary (do not execute without separate authorization)**

```bash
git add packages/event-schema/src/contract-testkit packages/event-schema/test/consumers packages/event-schema/test/package-entry.test.ts
git commit -m "test(protocol): share event envelope contracts"
```

### Task 6: Verified README, protocol documentation, coverage, and implementation evidence

**Files:**
- Create: `packages/event-schema/test/documentation-contract.test.ts`
- Create: `packages/event-schema/README.md`
- Create: `docs/protocol/event-envelope-v1.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/adr/ADR-005-event-schema-source-of-truth.md`
- Modify: `docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `docs/adr/README.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `AURORA_RULES.md`

**Interfaces:**
- Consumes: every Task 1—5 public interface, shared sample, package command, accepted ADR constraint, and fresh final verification output.
- Produces: validated module/protocol examples, real module documentation, 85/80/85/85 coverage enforcement, accurate authority links, ADR-005/006 `accepted / in-progress` evidence, and an updated queue that keeps concrete event schemas and every downstream module blocked.

- [ ] **Step 1: Write the failing documentation contract test**

Create `packages/event-schema/test/documentation-contract.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseEventEnvelope } from '../src/index.js';

async function repositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

function contractExample(document: string, name: string): unknown {
  const marker = `<!-- contract-example:${name} -->`;
  const markerIndex = document.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing contract example marker: ${name}`);
  const fenceStart = document.indexOf('```json', markerIndex);
  const contentStart = document.indexOf('\n', fenceStart) + 1;
  const fenceEnd = document.indexOf('```', contentStart);
  if (fenceStart < 0 || contentStart === 0 || fenceEnd < 0) {
    throw new Error(`Invalid JSON fence for contract example: ${name}`);
  }
  return JSON.parse(document.slice(contentStart, fenceEnd));
}

describe('event-schema documentation contract', () => {
  it('keeps the module README complete and honest about its boundary', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    for (const heading of [
      '## 模块定位',
      '## 职责',
      '## 非职责',
      '## 对外接口',
      '## 输入与输出',
      '## 依赖边界',
      '## 错误与兼容性',
      '## 开发与测试',
      '## 关联文档',
    ]) {
      expect(readme).toContain(heading);
    }
    expect(readme).toContain('当前协议版本：`1`');
    expect(readme).toContain('`body` 保持 `unknown`');
    expect(readme).not.toContain('具体错误事件正文已经实现');
  });

  it('parses the valid README example and rejects the invalid one', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    expect(parseEventEnvelope(contractExample(readme, 'valid-readme')).success).toBe(true);
    const invalid = parseEventEnvelope(contractExample(readme, 'invalid-readme'));
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues.map(({ code }) => code)).toContain('unsupported_protocol_version');
    }
  });

  it('parses the valid protocol example and rejects the forbidden-field example', async () => {
    const protocol = await repositoryFile('docs/protocol/event-envelope-v1.md');
    expect(parseEventEnvelope(contractExample(protocol, 'valid-protocol')).success).toBe(true);
    const invalid = parseEventEnvelope(contractExample(protocol, 'invalid-protocol'));
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues.map(({ code }) => code)).toContain('forbidden_field');
    }
  });
});
```

- [ ] **Step 2: Run the documentation test and verify missing-file failure**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/documentation-contract.test.ts
```

Expected: exit code `1` with `ENOENT` for `packages/event-schema/README.md` or `docs/protocol/event-envelope-v1.md`.

- [ ] **Step 3: Write the complete real module README**

Create `packages/event-schema/README.md` with exactly this content:

````markdown
# Event Schema

`@aurora/event-schema` 是 Aurora 公共协议系统的首个真实包。当前协议版本：`1`。包目前保持私有，不代表已经发布到 npm。

## 模块定位

本包位于依赖图底层，为未来 SDK、数据接入和数据处理提供同一个事件信封、版本识别、运行时边界校验和共享契约样本。

## 职责

- 定义协议版本 `1` 和 `error`、`request`、`performance`、`resource` 四类事件标识；
- 校验稳定事件编号、真实发生时间和公共信封；
- 有界扫描不可信事件正文，限制字符串、数组、对象键数和对象深度；
- 拒绝非 JSON 值、循环引用和明确禁止字段；
- 返回稳定、可判别且不含输入数据的验证 issue；
- 从独立测试入口共享合法、非法和边界样本。

## 非职责

- 不定义具体错误、请求、性能或资源事件正文；
- 不定义上报批次、HTTP、鉴权、接收结果、重试或可靠缓冲；
- 不采集、发送、存储、查询或展示事件；
- 不提供历史版本转换、JSON Schema、OpenAPI、代码生成或发布编排。

## 对外接口

运行时入口：

```ts
import {
  CURRENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_LIMITS,
  EventType,
  parseEventEnvelope,
  type EventEnvelope,
  type EventEnvelopeParseResult,
  type EventSchemaIssue,
  type EventSchemaIssueCode,
  type ProtocolVersion,
} from '@aurora/event-schema';
```

契约测试入口：

```ts
import {
  boundaryEventEnvelopeSamples,
  invalidEventEnvelopeSamples,
  validEventEnvelopeSamples,
} from '@aurora/event-schema/contract-testkit';
```

禁止导入 `src`、`internal`、测试文件或未导出的子路径。

## 输入与输出

`parseEventEnvelope(input: unknown)` 接收不可信输入。成功返回只读公共信封；失败返回稳定 issue 数组。`body` 保持 `unknown`，调用方必须等待后续具体事件 Schema 才能读取业务字段。

<!-- contract-example:valid-readme -->
```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-synthetic-valid",
  "eventType": "error",
  "occurredAt": 1800000000300,
  "body": {}
}
```

<!-- contract-example:invalid-readme -->
```json
{
  "protocolVersion": 2,
  "eventId": "evt-readme-synthetic-invalid",
  "eventType": "error",
  "occurredAt": 1800000000301,
  "body": {}
}
```

## 依赖边界

本包没有运行时依赖，也不得依赖任何 Aurora 本地业务包。SDK、接入和处理只能依赖本包公开入口；本包不能反向依赖消费者。

## 错误与兼容性

普通非法输入不抛异常、不记录正文，返回 `success: false` 和最多 50 个 issue。仅精确版本 `1` 受支持；版本 `0`、`2` 和其他未知值明确拒绝。同版本新增可选正文数据保持信封兼容，但具体正文兼容性必须由后续事件 Schema 定义。不兼容公共协议变化需要 accepted ADR、迁移和旧版本处理方案。

## 开发与测试

```bash
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema test
pnpm --filter @aurora/event-schema test:coverage
pnpm --filter @aurora/event-schema build
pnpm --filter @aurora/event-schema test:package
pnpm check:ci
```

覆盖率门槛为行 85%、分支 80%、函数 85%、语句 85%。样本全部为合成数据，不包含真实凭据或用户数据。

## 关联文档

- [协议基础规格](../../docs/protocol/event-schema-foundation.md)
- [事件信封版本 1](../../docs/protocol/event-envelope-v1.md)
- [ADR-005](../../docs/adr/ADR-005-event-schema-source-of-truth.md)
- [ADR-006](../../docs/adr/ADR-006-one-way-dependencies.md)
- [测试策略](../../docs/testing/test-strategy.md)
````

- [ ] **Step 4: Write the complete protocol version document**

Create `docs/protocol/event-envelope-v1.md` with exactly this content:

````markdown
---
title: Aurora 事件信封协议版本 1
status: approved
owner: protocol
last-reviewed: 2026-07-30
applies-to: @aurora/event-schema 事件公共信封版本 1
related:
  - event-schema-foundation.md
  - ../../packages/event-schema/README.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../testing/test-strategy.md
supersedes: none
review-cycle: protocol-change-or-release
---

# Aurora 事件信封协议版本 1

## 1. 范围

版本 `1` 只定义事件公共信封和通用资源/禁止字段边界。`body` 的具体事件字段尚未定义；信封通过不表示具体事件正文可被接入或处理系统接受。

## 2. 字段

| 字段 | 类型 | 必填 | 限制 | 含义 |
|---|---|---:|---|---|
| `protocolVersion` | 数字字面量 `1` | 是 | 只接受受支持列表中的精确值 | 公共协议主版本 |
| `eventId` | string | 是 | 长度 1—128 | 客户端生成且重试保持不变的稳定事件编号 |
| `eventType` | enum | 是 | `error`、`request`、`performance`、`resource` | 已批准的事件类别 |
| `occurredAt` | number | 是 | 正安全整数，Unix epoch 毫秒 | 事件真实发生时间 |
| `body` | unknown | 是 | 通过第 3 节通用边界；具体 Schema 尚未定义 | 后续具体事件正文 |

顶层不接受其他字段。客户端时钟合理性和服务端校正属于后续接入/处理契约，本版本只校验正安全整数。

## 3. 通用正文边界

- 字符串最长 4096 个 UTF-16 code units；
- 数组最多 100 项；
- 单个对象最多 100 个自有可枚举键；
- 根正文深度为 0，最大对象/数组嵌套深度为 8；
- 数字必须有限；只接受 JSON 可表达值和普通对象；
- 循环引用拒绝；最多返回 50 个 issue；
- 任意层级拒绝 `authorization`、`cookie`、`password`、`requestBody`、`responseBody`、`formData`、`dom`、`consoleLog`、`ipAddress`，字段名按 ASCII 小写比较。

本边界不是完整脱敏器。SDK 和服务端仍必须执行各自的允许列表、隐私过滤和具体事件 Schema。

## 4. 合法示例

<!-- contract-example:valid-protocol -->
```json
{
  "protocolVersion": 1,
  "eventId": "evt-protocol-synthetic-valid",
  "eventType": "performance",
  "occurredAt": 1800000000400,
  "body": {
    "optionalContext": {
      "attempt": 1
    }
  }
}
```

## 5. 非法示例

<!-- contract-example:invalid-protocol -->
```json
{
  "protocolVersion": 1,
  "eventId": "evt-protocol-synthetic-invalid",
  "eventType": "request",
  "occurredAt": 1800000000401,
  "body": {
    "authorization": "synthetic"
  }
}
```

该示例返回 `forbidden_field`，测试不会记录正文值。

## 6. 失败语义

解析器返回 `success: false` 和稳定 issue。必填缺失、类型、未知顶层字段、大小、深度、非法时间、事件类型、协议版本、循环和禁止字段分别有明确 code。普通非法输入不抛异常，也不写日志。

## 7. 兼容性

当前仅支持版本 `1`，不存在历史协议转换。版本 `0` 与 `2` 都明确拒绝。同版本信封可以在 `body` 中增加通用边界允许的可选数据；这只证明信封级兼容，不能代替未来具体事件字段兼容。删除/重释字段、改变类型、把可选字段改为必填或改变枚举含义是不兼容变化，必须先有 accepted ADR、迁移和旧版本处理方案。

## 8. 共享样本

SDK、数据接入和数据处理的契约测试统一从 `@aurora/event-schema/contract-testkit` 导入合法、非法和边界样本。消费者不得复制并改写这些样本的协议含义。
````

- [ ] **Step 5: Run documentation tests and coverage before recording evidence**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/documentation-contract.test.ts
pnpm --filter @aurora/event-schema test:coverage
```

Expected: both commands exit `0`; all four marked JSON examples are executed; coverage reports at least 85% lines, 80% branches, 85% functions, and 85% statements. If a threshold fails, add behavior-based tests for the uncovered public branch; do not exclude a logic file or lower a threshold.

- [ ] **Step 6: Synchronize formal indexes and implementation states using verified facts**

Apply all of these exact semantic updates after Step 5 passes:

1. `docs/README.md`
   - add `docs/protocol/event-schema-foundation.md` as the approved planning specification;
   - add `packages/event-schema/README.md` as the real module authority;
   - add `docs/protocol/event-envelope-v1.md` as the version-1 envelope authority;
   - replace the statement that all event Schema is absent with: the envelope foundation exists, while concrete event bodies, batches, ingestion/processing contracts, release and CI remain absent.

2. `docs/architecture/formalization-readiness.md`
   - mark A1 as `partially implemented: envelope/version/runtime boundaries/shared samples`; keep concrete event bodies, batch Schema, compatibility conversion and real consumer implementations blocked;
   - update the machine-contract row to distinguish the implemented envelope foundation from absent concrete event/batch contracts;
   - do not unblock SDK Core, ingestion, processing, CI, release or infrastructure.

3. `docs/adr/ADR-005-event-schema-source-of-truth.md`
   - change only `implementation-status` from `not-started` to `in-progress` in frontmatter/body;
   - append a dated implementation record listing exact commands, exit codes, coverage values, package-entry evidence, files, no Issue/PR/commit if absent, and the remaining concrete event/batch/consumer work;
   - keep decision status `accepted` and the final decision unchanged.

4. `docs/adr/ADR-006-one-way-dependencies.md`
   - keep `accepted / in-progress`;
   - append the `forbidden-layer-dependency` negative fixture, real zero-local-dependency result, public/private entry checks, commands, exit codes and remaining SDK/service layer work.

5. `docs/adr/README.md`, `AGENTS.md`, and `AURORA_RULES.md`
   - record ADR-005 as `accepted / in-progress`, ADR-006 as `accepted / in-progress`, ADR-007 as `accepted / implemented`;
   - state that `@aurora/event-schema` is the second real internal package and only its envelope foundation exists;
   - put concrete event schemas next in the ordered queue; keep SDK Core and every downstream module blocked;
   - update review dates to `2026-07-30` only where the document has actually been re-reviewed;
   - keep `AGENTS.md` at no more than 180 lines/24 KiB and `AURORA_RULES.md` at no more than 260 lines/36 KiB.

6. `README.md`
   - state that event envelope/version/runtime-boundary code now exists but concrete event bodies, SDK, services, OpenAPI, data models, CI, IaC, cloud resources and deployment do not;
   - add `pnpm test:coverage` to the command table;
   - do not claim a CI workflow exists.

For every appended evidence record, copy actual counts and percentages from the fresh output. Never preserve the plan's expected counts as if they were observed results.

- [ ] **Step 7: Run the complete fresh repository gate**

Run in this exact order:

```powershell
node --version
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm build
pnpm --filter @aurora/event-schema test:package
pnpm check:ci
git diff --check
```

Expected: every command exits `0`; Node prints `v24.18.0`; frozen install reports pnpm `11.17.0` and does not alter the lock file; all tests pass; coverage meets all four thresholds; the real boundary command is silent; build creates only package/tool `dist` directories; root and testkit entries load; private paths fail; `check:ci` repeats the full non-interactive gate; `git diff --check` exits `0` with no whitespace errors.

- [ ] **Step 8: Verify scope and dependency negatives**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/event-schema-package-contract.test.ts
Get-ChildItem -Force -Name apps,examples,.github -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath packages -Directory | Select-Object -ExpandProperty Name
Select-String -Path packages/event-schema/package.json -Pattern '"dependencies"|workspace:' -CaseSensitive
Select-String -Path packages/event-schema/src/**/*.ts -Pattern 'window|document|fetch|XMLHttpRequest|localStorage|sessionStorage|console\.' -CaseSensitive
```

Expected: focused policy tests pass; `apps`, `examples`, and `.github` do not exist; `packages` contains only `event-schema`; package manifest has no runtime `dependencies` or `workspace:` range; source contains no browser, network, storage, or console API match.

- [ ] **Step 9: Inspect final diff and status without staging**

Run:

```powershell
git diff -- docs/protocol/event-schema-foundation.md docs/superpowers/plans/2026-07-30-event-schema-foundation.md package.json eslint.config.mjs tooling/workspace-policy packages/event-schema docs/protocol/event-envelope-v1.md docs/README.md docs/architecture/formalization-readiness.md docs/adr/ADR-005-event-schema-source-of-truth.md docs/adr/ADR-006-one-way-dependencies.md docs/adr/README.md README.md AGENTS.md AURORA_RULES.md
git status --short --branch
```

Expected: diff contains only this module's implementation/documentation plus protected pre-existing user changes; no file is staged; no unrelated file is modified; no business/CI/infrastructure file exists.

- [ ] **Step 10: Suggested commit boundary (do not execute without separate authorization)**

```bash
git add packages/event-schema/README.md packages/event-schema/test/documentation-contract.test.ts docs/protocol/event-envelope-v1.md docs/README.md docs/architecture/formalization-readiness.md docs/adr/ADR-005-event-schema-source-of-truth.md docs/adr/ADR-006-one-way-dependencies.md docs/adr/README.md README.md AGENTS.md AURORA_RULES.md
git commit -m "docs(protocol): record event schema foundation evidence"
```

## Final Review Gate

Before reporting implementation complete, inspect every changed file and answer each check with repository evidence:

- `@aurora/event-schema` is the only new module and has zero runtime/local dependency.
- The public root exports every documented runtime symbol and no test-only sample.
- `contract-testkit` exports all three sample collections and no runtime parser duplication.
- `body` remains `unknown`; no concrete event body field was introduced.
- Every required/mistyped/unknown/oversized/deep/cyclic/forbidden/version/timestamp case has a black-box assertion.
- Version `1` old/new body shapes pass; versions `0` and `2` fail explicitly.
- SDK-, ingestion-, and processing-shaped tests import the same shared sample source.
- Built root/testkit entries load and all tested private paths are rejected.
- Coverage is at least 85% lines, 80% branches, 85% functions, and 85% statements.
- README and protocol JSON examples are executed by tests.
- ADR-005 and ADR-006 are `accepted / in-progress`; ADR-007 remains `accepted / implemented`; no accepted final decision changed.
- Concrete events, batch/upload protocols, SDK, ingestion, processing, services, databases, CI, release and infrastructure remain absent/blocked.
- No staging, commit, push, PR, publication or plan execution occurred outside the separately authorized implementation session.

Stop after this review. Do not start a concrete event schema, SDK Core, CI, or any third module.
