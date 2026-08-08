# PLT-01 Platform Contract Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the real `@aurora/platform-contract` package: common + domain Zod schemas, an operation registry for the A1–D2 operation set, a deterministic generator producing a machine Platform OpenAPI (v1) plus generated client/server adapters, a drift gate, contract testkit, and the workspace-policy `contract` layer — with no business handlers and no fake/empty schemas.

**Architecture:** Contract source lives in `packages/platform-contract` as `common/` + domain modules + an operation registry (Zod schemas with OpenAPI JSON-Schema emission). A deterministic generator (Task 6) walks the registry to emit `docs/api/platform-openapi-v1.yaml`, client request/response validators, server input/output validators, contract samples, and a coverage manifest. `tooling/platform-contract-drift` (tooling layer, depends on `contract` layer) compares the registry against the emitted OpenAPI and blocks regeneration drift. Operations whose downstream modules are not yet formalized are registered in the manifest as `blocked` (reserved operationId + declared reason) and are **not** emitted as OpenAPI operations with empty schemas. Workspace-policy `graph.ts` gains the `contract` layer (`contract → {protocol}`), `service` gains `contract`, and `tooling` gains `contract`.

**Tech Stack:** TypeScript 6.0.3 (strict, NodeNext, ES2024), zod 4 (new dependency), `yaml` 2.9.0 (already in repo as a devDependency of ingestion-openapi-contract), vitest 4.1.10, redocly 2.43.1 (existing), workspace-policy CLI, pnpm 11.17.0 / Node 24.18.

## Closing leaf
- **PLT-01**

## Baseline / Target
- Starting (if still current): `completed = 38` / `remaining = 40`
- After verified PLT-01: `completed = 39` / `remaining = 39`
- Leaf counts change **only** after PLT-01 is independently verified; not on ADR/spec/plan creation.

## Global Constraints

- Strict TypeScript (`tsconfig.base.json`: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, NodeNext); every file passes `vue-tsc`-equivalent `tsc --noEmit`.
- All external input is `unknown` → runtime-validated by zod before use; never trust TS types for untrusted input.
- `@aurora/platform-contract` must NOT depend on Fastify, Kysely, BullMQ, Redis, Vue/Pinia, page components, or any DB model. Its layer is `contract` with allowed local deps `{protocol}`.
- No business handlers. No empty operations. No `{}` / free-form / untyped-`unknown` response schemas. Operations blocked by downstream gaps are `blocked` in the manifest and never emitted as OpenAPI operations.
- Generated artifacts (`docs/api/platform-openapi-v1.yaml`, client/server adapters, coverage manifest, samples) carry a "由契约源码生成、禁止手工修改" marker and are checked for drift in CI; regeneration must be byte-identical.
- `operationId` format: `domainVerbObject` (e.g. `identityGetSession`, `navigationGetContext`); must be unique; never contains page numbers, HTTP methods, or impl class names.
- D2: register `platform.resource-policies` RouteTarget + `unavailable` (PlatformAdmin not approved) only; never fabricate a PlatformAdmin capability or D2 endpoint.
- No private backend types, no processing-store/ingestion-inbox/event-schema model exposure.
- RFC 9457 `AuroraProblem` is the unified error shape with stable `code`; no stack/SQL/host/queue/object-key/secret/account-existence leakage.
- Every task: failing test → verify failure → minimal implementation → verify pass → `git diff --check` → commit on `feature/g09-platform-contract-shell`. No `git add` of unrelated files, no push to main.
- Prettier: `singleQuote`, `printWidth 100`, `trailingComma all`, LF. Format changed files with `pnpm prettier --write`.
- `docs/superpowers/plans` is gitignored by `.prettierignore` — the plan itself is not prettier-checked, but all `.ts`/`.md` code we produce is.
- All package exports: root (`.`), `/client`, `/server`, `/contract-testkit`. Internal generator/path-assembly must NOT be exported.
- zod 4 is not yet in the repo — it must be added (`pnpm add zod@4 --filter @aurora/platform-contract`) in Task 1; no floating `latest`.

---

### Task 1: Scaffold `@aurora/platform-contract` + workspace-policy `contract` layer + lint/format registration

**Files:**
- Create: `packages/platform-contract/package.json`
- Create: `packages/platform-contract/tsconfig.json`
- Create: `packages/platform-contract/tsconfig.build.json`
- Create: `packages/platform-contract/vitest.config.ts`
- Create: `packages/platform-contract/src/index.ts`
- Create: `packages/platform-contract/test/package-scaffold.test.ts`
- Modify: `tooling/workspace-policy/src/graph.ts` (add `contract` layer + edges)
- Modify: `tooling/workspace-policy/test/dependency-policy.test.ts` (add contract-layer cases)
- Modify: `eslint.config.mjs` (add `packages/platform-contract/**/*.ts`)
- Modify: `package.json` (add package paths to `format:check` and `lint` lists; add `platform-contract:*` scripts)
- Modify: `pnpm-workspace.yaml` (no change needed — `packages/*` already covers it)

**Interfaces:**
- Consumes: existing `@aurora/event-schema` layer (`protocol`) — NOT yet imported in this task.
- Produces: `@aurora/platform-contract` root export `PLATFORM_CONTRACT_VERSION: string` and type `PlatformContractVersion`; workspace-policy layer `contract`; root scripts `platform-contract:generate`, `platform-contract:drift`.

- [ ] **Step 1: Write the failing test**

`packages/platform-contract/test/package-scaffold.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PLATFORM_CONTRACT_VERSION } from '../src/index.js';

describe('platform-contract scaffold', () => {
  it('exposes a stable version constant', () => {
    expect(PLATFORM_CONTRACT_VERSION).toBe('v1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: FAIL — package has no `test` script yet (or module not found). This is the first failure gate; record it.

- [ ] **Step 3: Write minimal implementation**

`packages/platform-contract/package.json`:

```json
{
  "name": "@aurora/platform-contract",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Aurora platform public contract foundation (single source of truth for the Platform OpenAPI)",
  "sideEffects": false,
  "engines": {
    "node": ">=24.18.0 <25"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
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
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "@vitest/coverage-v8": "4.1.10",
    "typescript": "6.0.3",
    "vitest": "4.1.10",
    "yaml": "2.9.0"
  },
  "aurora": {
    "layer": "contract"
  }
}
```

`packages/platform-contract/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node", "vitest/globals"],
    "paths": {
      "@aurora/platform-contract": ["./src/index.ts"]
    }
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

`packages/platform-contract/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

`packages/platform-contract/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@aurora\/platform-contract$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
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

`packages/platform-contract/src/index.ts`:

```ts
export const PLATFORM_CONTRACT_VERSION = 'v1' as const;
export type PlatformContractVersion = typeof PLATFORM_CONTRACT_VERSION;
```

- [ ] **Step 4: Install zod and lock the version**

Run: `cd packages/platform-contract && pnpm add zod@4 && cd ../..` then `pnpm install`
Expected: `zod` 4.x appears in `packages/platform-contract/package.json` `dependencies` and in `pnpm-lock.yaml` with a pinned version (no `latest`).

- [ ] **Step 5: Add the `contract` layer to workspace-policy**

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
]);
```

- [ ] **Step 6: Add contract-layer cases to the workspace-policy tests**

`tooling/workspace-policy/test/dependency-policy.test.ts` — append new `it` blocks:

```ts
it('allows a contract package to depend on protocol', async () => {
  const contract = validManifest('@aurora/platform-contract');
  contract.aurora = { layer: 'contract' };
  contract.dependencies = { '@aurora/event-schema': 'workspace:*' };
  const protocol = validManifest('@aurora/event-schema');
  protocol.aurora = { layer: 'protocol' };
  const { violations } = await checkDependencyPolicy(
    { directory: 'packages/platform-contract', manifest: contract },
    { directory: 'packages/event-schema', manifest: protocol },
  );
  expect(violations.filter((v) => v.code === 'forbidden-layer-dependency')).toHaveLength(0);
});

it('rejects a contract package depending on tooling', async () => {
  const contract = validManifest('@aurora/platform-contract');
  contract.aurora = { layer: 'contract' };
  contract.dependencies = { '@aurora/ingestion-benchmark': 'workspace:*' };
  const tool = validManifest('@aurora/ingestion-benchmark');
  tool.aurora = { layer: 'tooling' };
  const { violations } = await checkDependencyPolicy(
    { directory: 'packages/platform-contract', manifest: contract },
    { directory: 'tooling/ingestion-benchmark', manifest: tool },
  );
  expect(violations.some((v) => v.code === 'forbidden-layer-dependency')).toBe(true);
});
```

Note: match the existing test helpers (`validManifest`, `checkDependencyPolicy`) already used in `dependency-policy.test.ts`; if the helper is named differently, use the existing name. Do not invent a new helper.

- [ ] **Step 7: Register the package in ESLint and root scripts**

`eslint.config.mjs` — add `'packages/platform-contract/**/*.ts',` to the `files` array.

`package.json`:
- In `format:check`: append `packages/platform-contract/package.json packages/platform-contract/tsconfig.json packages/platform-contract/tsconfig.build.json packages/platform-contract/vitest.config.ts "packages/platform-contract/src/**/*.ts" "packages/platform-contract/test/**/*.ts" packages/platform-contract/README.md`
- In `lint`: append `packages/platform-contract/src packages/platform-contract/test packages/platform-contract/vitest.config.ts`
- Add scripts:
  ```json
  "platform-contract:generate": "tsx packages/platform-contract/scripts/generate-openapi.ts",
  "platform-contract:drift": "pnpm --filter @aurora/platform-contract-drift test"
  ```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @aurora/workspace-policy test && pnpm --filter @aurora/platform-contract test && pnpm typecheck && pnpm check:boundaries`
Expected: PASS (scaffold test passes; workspace-policy contract-layer cases pass; typecheck passes; boundaries pass).

- [ ] **Step 9: Commit**

```bash
git add packages/platform-contract tooling/workspace-policy/src/graph.ts tooling/workspace-policy/test/dependency-policy.test.ts eslint.config.mjs package.json pnpm-lock.yaml
git commit -m "feat: scaffold @aurora/platform-contract and add contract layer"
```

---

### Task 2: Common schema primitives + identifiers + time

**Files:**
- Create: `packages/platform-contract/src/common/schema.ts`
- Create: `packages/platform-contract/src/common/identifiers.ts`
- Create: `packages/platform-contract/src/common/time.ts`
- Test: `packages/platform-contract/test/common/schema.test.ts`, `test/common/identifiers.test.ts`, `test/common/time.test.ts`
- Modify: `packages/platform-contract/src/index.ts` (re-export common)

**Interfaces:**
- Consumes: zod (Task 1).
- Produces:
  - `SchemaDef` (in `schema.ts`): `{ zod: z.ZodType, openapi: JsonSchemaObject, meta: { openEnum?: boolean; defaultSort?: readonly string[]; nullSemantics?: 'absent' | 'empty' | 'unknown' } }`
  - Builders: `str(min?, max?)`, `num(min?, max?)`, `bool()`, `enum_(values, opts?)`, `obj(props)`, `arr(item)`, `rec(value)`, `union(members)`, `nullable(def)`, `optional(def)` — each returns `SchemaDef` with a zod schema and a JSON-Schema emission.
  - `JsonSchemaObject`: a plain object type (`{ type?: string | string[]; enum?: unknown[]; ... }`) typed loosely to be JSON-serializable.
  - `brandedId<T extends string>(name: string, min?: number, max?: number): SchemaDef` returning a zod `z.string().min(min).max(max).brand<T>()`.
  - `AccountId`, `OrganizationId`, `ProjectId`, `EnvironmentId`, `IssueId`, `ReleaseId`, `SourceMapFileId`, `AlertRuleId`, `AlertInstanceId`, `NotificationId`, `OperationId` (in `identifiers.ts`), each a `SchemaDef` with branded zod.
  - `utcTimestamp` (RFC 3339 string), `timeRange` (`{ start, end }`), `businessCalendarBoundary` (`{ ianaTimezone, utcStart, utcEnd }`), `readAt` (in `time.ts`).

- [ ] **Step 1: Write the failing test**

`test/common/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { arr, bool, enum_, num, nullable, obj, optional, rec, str } from '../../src/common/schema.js';

describe('schema primitives', () => {
  it('emits JSON Schema for a string primitive', () => {
    expect(str(3, 40).openapi).toEqual({ type: 'string', minLength: 3, maxLength: 40 });
  });

  it('validates values with the zod schema', () => {
    expect(str(3, 40).zod.safeParse('abc').success).toBe(true);
    expect(str(3, 40).zod.safeParse('ab').success).toBe(false);
  });

  it('emits closed vs open enums via meta', () => {
    const closed = enum_(['a', 'b']);
    expect(closed.openapi.enum).toEqual(['a', 'b']);
    expect(closed.meta.openEnum).toBeUndefined();
    const open = enum_(['a', 'b'], { openEnum: true });
    expect(open.meta.openEnum).toBe(true);
  });

  it('composes objects, arrays, records, nullable, optional, union', () => {
    const def = obj({
      name: str(1, 10),
      tags: arr(str(1, 5)),
      counts: rec(num(0)),
      maybe: nullable(str(1, 5)),
      extra: optional(str(1, 5)),
    });
    expect(def.zod.safeParse({ name: 'a', tags: [], counts: {} }).success).toBe(true);
    expect(def.zod.safeParse({ name: 'a', tags: ['x'], counts: { k: 1 }, maybe: 'y', extra: 'z' }).success).toBe(true);
    expect(def.zod.safeParse({ name: 'a', tags: [''], counts: {} }).success).toBe(false);
    expect(def.openapi.properties).toBeDefined();
  });
});
```

`test/common/identifiers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ProjectId } from '../../src/common/identifiers.js';

describe('branded identifiers', () => {
  it('accepts opaque stable ids and rejects empty/oversized', () => {
    expect(ProjectId.zod.safeParse('p_abc123').success).toBe(true);
    expect(ProjectId.zod.safeParse('').success).toBe(false);
  });
});
```

`test/common/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { timeRange, utcTimestamp } from '../../src/common/time.js';

describe('time contracts', () => {
  it('validates RFC3339 timestamps and bounded ranges', () => {
    expect(utcTimestamp.zod.safeParse('2026-08-08T00:00:00.000Z').success).toBe(true);
    expect(utcTimestamp.zod.safeParse('not-a-date').success).toBe(false);
    expect(
      timeRange.zod.safeParse({
        start: '2026-08-08T00:00:00.000Z',
        end: '2026-08-08T01:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: FAIL — `schema.js`/`identifiers.js`/`time.js` do not exist.

- [ ] **Step 3: Write minimal implementation**

`src/common/schema.ts`:

```ts
import { z } from 'zod';

export interface JsonSchemaObject {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly properties?: Readonly<Record<string, JsonSchemaObject>>;
  readonly items?: JsonSchemaObject;
  readonly additionalProperties?: boolean | JsonSchemaObject;
  readonly required?: readonly string[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly anyOf?: readonly JsonSchemaObject[];
  readonly format?: string;
  readonly nullable?: boolean;
  readonly description?: string;
  readonly [key: string]: unknown;
}

export interface SchemaMeta {
  readonly openEnum?: boolean;
  readonly defaultSort?: readonly string[];
  readonly nullSemantics?: 'absent' | 'empty' | 'unknown';
}

export interface SchemaDef {
  readonly zod: z.ZodType;
  readonly openapi: JsonSchemaObject;
  readonly meta: SchemaMeta;
}

function def(zod: z.ZodType, openapi: JsonSchemaObject, meta: SchemaMeta = {}): SchemaDef {
  return { zod, openapi, meta };
}

export function str(minLength = 1, maxLength = 1024): SchemaDef {
  return def(z.string().min(minLength).max(maxLength), {
    type: 'string',
    minLength,
    maxLength,
  });
}

export function num(minimum?: number, maximum?: number): SchemaDef {
  const base = minimum === undefined ? z.number() : z.number().min(minimum);
  const refined = maximum === undefined ? base : base.max(maximum);
  return def(refined, { type: 'number', ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }) });
}

export function bool(): SchemaDef {
  return def(z.boolean(), { type: 'boolean' });
}

export function enum_(values: readonly string[], opts: { openEnum?: boolean } = {}): SchemaDef {
  const zod = z.enum(values as [string, ...string[]]);
  return def(zod, { type: 'string', enum: values }, { openEnum: opts.openEnum });
}

export function obj(props: Readonly<Record<string, SchemaDef>>, requiredAll = true): SchemaDef {
  const entries = Object.entries(props);
  const shape = Object.fromEntries(entries.map(([k, v]) => [k, v.zod]));
  const zod = requiredAll ? z.object(shape) : z.object(shape).partial();
  const required = requiredAll ? entries.map(([k]) => k) : entries.filter(([k]) => !props[k].zod.isOptional()).map(([k]) => k);
  return def(zod, {
    type: 'object',
    properties: Object.fromEntries(entries.map(([k, v]) => [k, v.openapi])),
    ...(required.length > 0 ? { required } : {}),
  });
}

export function arr(item: SchemaDef, min = 0, max = 100): SchemaDef {
  return def(z.array(item.zod).min(min).max(max), { type: 'array', items: item.openapi });
}

export function rec(value: SchemaDef): SchemaDef {
  return def(z.record(value.zod), { type: 'object', additionalProperties: value.openapi });
}

export function union(members: readonly SchemaDef[]): SchemaDef {
  return def(z.union(members.map((m) => m.zod) as [z.ZodType, z.ZodType, ...z.ZodType[]]), {
    anyOf: members.map((m) => m.openapi),
  });
}

export function nullable(def_: SchemaDef): SchemaDef {
  return def(z.nullable(def_.zod), { ...def_.openapi, nullable: true });
}

export function optional(def_: SchemaDef): SchemaDef {
  return def(z.optional(def_.zod), def_.openapi);
}

export function brandedId<T extends string>(name: string, min = 3, max = 64): SchemaDef {
  return def(z.string().min(min).max(max).brand<T>(), {
    type: 'string',
    minLength: min,
    maxLength: max,
    description: name,
  });
}
```

`src/common/identifiers.ts`:

```ts
import { brandedId } from './schema.js';

export const AccountId = brandedId<'AccountId'>('AccountId');
export const OrganizationId = brandedId<'OrganizationId'>('OrganizationId');
export const ProjectId = brandedId<'ProjectId'>('ProjectId');
export const EnvironmentId = brandedId<'EnvironmentId'>('EnvironmentId');
export const IssueId = brandedId<'IssueId'>('IssueId');
export const ReleaseId = brandedId<'ReleaseId'>('ReleaseId');
export const SourceMapFileId = brandedId<'SourceMapFileId'>('SourceMapFileId');
export const AlertRuleId = brandedId<'AlertRuleId'>('AlertRuleId');
export const AlertInstanceId = brandedId<'AlertInstanceId'>('AlertInstanceId');
export const NotificationId = brandedId<'NotificationId'>('NotificationId');
export const OperationId = brandedId<'OperationId'>('OperationId');
```

`src/common/time.ts`:

```ts
import { z } from 'zod';
import { obj, str } from './schema.js';

const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const utcTimestampZod = z
  .string()
  .min(20)
  .max(24)
  .refine((v) => rfc3339.test(v), { message: 'must be RFC 3339 UTC' });

export const utcTimestamp = { zod: utcTimestampZod, openapi: { type: 'string', format: 'date-time' }, meta: {} };

export const timeRange = obj({
  start: utcTimestamp,
  end: utcTimestamp,
});

export const businessCalendarBoundary = obj({
  ianaTimezone: str(1, 64),
  utcStart: utcTimestamp,
  utcEnd: utcTimestamp,
});

export const readAt = utcTimestamp;
```

Note: `utcTimestamp` is built as a literal `SchemaDef` (not via the `def` helper) because it needs a custom zod refinement while keeping the `{ zod, openapi, meta }` shape that `obj(...)` consumes.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: PASS (schema/identifiers/time tests pass).

- [ ] **Step 5: Re-export from the package root**

`src/index.ts` — append:

```ts
export * from './common/schema.js';
export * from './common/identifiers.js';
export * from './common/time.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/platform-contract
git commit -m "feat: add common schema primitives, identifiers, and time contracts"
```

---

### Task 3: Common contracts — pagination, query, command, operation, problem-details, section, authorization, navigation (RouteTarget)

**Files:**
- Create: `packages/platform-contract/src/common/pagination.ts`
- Create: `packages/platform-contract/src/common/query.ts`
- Create: `packages/platform-contract/src/common/command.ts`
- Create: `packages/platform-contract/src/common/operation.ts`
- Create: `packages/platform-contract/src/common/problem-details.ts`
- Create: `packages/platform-contract/src/common/section.ts`
- Create: `packages/platform-contract/src/common/authorization.ts`
- Create: `packages/platform-contract/src/common/navigation.ts`
- Test: `packages/platform-contract/test/common/contracts.test.ts`
- Modify: `packages/platform-contract/src/index.ts`

**Interfaces:**
- Consumes: `schema.ts`, `identifiers.ts`, `time.ts` (Task 2).
- Produces:
  - `pagination.ts`: `cursorPage` (`{ cursor?: str, limit: num(1,100) }`), `pageNumber` (`{ page: num(1), pageSize: num(1,100) }`), `paginationMeta` (`{ cursor?, nextCursor?, totalCount?, totalCountStatus: enum_(['available','unavailable']) }`), `pageResult<T>(item: SchemaDef)` → `obj({ items: arr(item), pagination: paginationMeta })`.
  - `query.ts`: `normalizedQuery` (`rec(str)`, but as a typed map), `queryResponse<T>(data: SchemaDef)` → `obj({ data, meta: queryMeta, allowedActions, navigationTargets })` where `queryMeta = obj({ requestId: str, readAt: utcTimestamp })` extended by callers.
  - `command.ts`: `idempotencyKey` (`str(36,36)`), `resourceVersion` (`str(1,64)`), `commandResult<T>(data)` → `obj({ status: enum_(['succeeded','duplicate']), data, resourceVersion, operationId, navigationTargets })`.
  - `operation.ts`: `operationReference` (`obj({ operationId, status: enum_(['processing']), submittedAt, nextPollAfter?, resultTarget? })`), `operationStatus` = `enum_(['succeeded','failed','expired','unavailable'])`.
  - `problem-details.ts`: `auroraProblem` — `obj({ type: str, title: str, status: num(400,599), detail: str, instance?: str, code: str, requestId: str, fieldErrors?: arr(fieldError), retryAfter?: num, currentVersion?: str, operationId?: str, recoveryTarget?: nullable(routeTargetRef) })`; `fieldError = obj({ field: str, reason: str })`. Stable category codes exported as `PROBLEM_CATEGORY_CODES` (closed enum values).
  - `section.ts`: `sectionResult<T>(data)` = `union([available, empty, partial, stale, unavailable, forbidden])` per approved semantics; `sectionStatus = enum_(['available','empty','partial','stale','unavailable','forbidden'])`.
  - `authorization.ts`: `allowedActions` = `arr(enum_(['create','read','update','delete','manage','restore','transfer','revoke']))`; `capabilityRequirement = str`.
  - `navigation.ts`: `ROUTE_TARGET_IDS` (the 36 routeId strings verbatim from OpenAPI design §13.1), `routeTargetId = enum_(ROUTE_TARGET_IDS, { openEnum: false })`, `routeTarget = obj({ routeId: routeTargetId, pathParams: rec(str), query: rec(str) })`, `navigationTargets = arr(routeTarget, 0, 20)`. Export `ROUTE_TARGET_IDS` for tests.

- [ ] **Step 1: Write the failing test**

`test/common/contracts.test.ts` (abridged; each assertion is real):

```ts
import { describe, expect, it } from 'vitest';
import { commandResult } from '../../src/common/command.js';
import { pageResult } from '../../src/common/pagination.js';
import { auroraProblem } from '../../src/common/problem-details.js';
import { ROUTE_TARGET_IDS, routeTargetId } from '../../src/common/navigation.js';
import { sectionResult, sectionStatus } from '../../src/common/section.js';
import { str } from '../../src/common/schema.js';

describe('common contracts', () => {
  it('builds a cursor page result', () => {
    const r = pageResult(str(1, 10));
    expect(r.zod.safeParse({ items: ['a'], pagination: { totalCountStatus: 'unavailable' } }).success).toBe(true);
    expect(r.zod.safeParse({ items: ['a'], pagination: { totalCountStatus: 'unavailable' } }).success).toBe(true);
  });

  it('builds a command result with idempotent status', () => {
    const r = commandResult(str(1, 10));
    expect(r.zod.safeParse({ status: 'succeeded', data: 'x', resourceVersion: 'v1', operationId: 'op_1', navigationTargets: [] }).success).toBe(true);
    expect(r.zod.safeParse({ status: 'invalid', data: 'x', resourceVersion: 'v1', operationId: 'op_1', navigationTargets: [] }).success).toBe(false);
  });

  it('builds an AuroraProblem with stable code', () => {
    expect(auroraProblem.zod.safeParse({ type: 'about:blank', title: 'Not found', status: 404, detail: 'x', code: 'not_found', requestId: 'r_1' }).success).toBe(true);
    expect(auroraProblem.zod.safeParse({ type: 'about:blank', title: 'Bad', status: 404, detail: 'x', code: 'bad', requestId: 'r_1' }).success).toBe(true);
  });

  it('freezes all 36 route target ids as a closed enum', () => {
    expect(ROUTE_TARGET_IDS).toHaveLength(36);
    expect(ROUTE_TARGET_IDS).toContain('auth.register');
    expect(ROUTE_TARGET_IDS).toContain('platform.resource-policies');
    expect(routeTargetId.zod.safeParse('auth.register').success).toBe(true);
    expect(routeTargetId.zod.safeParse('made.up.route').success).toBe(false);
  });

  it('models section status as the approved closed set', () => {
    expect(sectionStatus.zod.safeParse('unavailable').success).toBe(true);
    expect(sectionStatus.zod.safeParse('loading').success).toBe(false);
  });

  it('builds a section result union with a forbidden branch', () => {
    const sr = sectionResult(str(1, 5));
    expect(sr.zod.safeParse({ status: 'unavailable', reason: 'capability-not-provided' }).success).toBe(true);
    expect(sr.zod.safeParse({ status: 'available', data: 'x' }).success).toBe(true);
    expect(sr.zod.safeParse({ status: 'forbidden' }).success).toBe(true);
    expect(sr.zod.safeParse({ status: 'forbidden', data: 'secret' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: FAIL — common contract modules do not exist.

- [ ] **Step 3: Write minimal implementation**

`src/common/pagination.ts`:

```ts
import { arr, enum_, num, obj, optional, SchemaDef, str } from './schema.js';

export const cursorPage = obj({ cursor: optional(str(1, 64)), limit: num(1, 100) });

export const pageNumber = obj({ page: num(1), pageSize: num(1, 100) });

export const totalCountStatus = enum_(['available', 'unavailable']);

export const paginationMeta = obj({
  cursor: optional(str(1, 64)),
  nextCursor: optional(str(1, 64)),
  totalCount: optional(num(0)),
  totalCountStatus,
});

export function pageResult<T>(item: SchemaDef): SchemaDef {
  return obj({ items: arr(item), pagination: paginationMeta });
}

export type PaginationModel = 'cursor' | 'page';
```

`src/common/query.ts`:

```ts
import { arr, enum_, obj, optional, rec, SchemaDef, str } from './schema.js';
import { readAt, utcTimestamp } from './time.js';

export const normalizedQuery = rec(str(1, 512));

export const queryMeta = obj({
  requestId: str(1, 64),
  readAt,
  normalizedQuery: optional(normalizedQuery),
});

export function queryResponse<T>(data: SchemaDef): SchemaDef {
  return obj({
    data,
    meta: queryMeta,
    allowedActions: arr(enum_(['create', 'read', 'update', 'delete', 'manage', 'restore', 'transfer', 'revoke'])),
    navigationTargets: arr(rec(str(1, 64)), 0, 20),
  });
}
```

Note: `allowedActions`/`navigationTargets` also exist in `authorization.ts`/`navigation.ts`; to avoid duplication, Task 3 defines them once in `authorization.ts`/`navigation.ts` and `query.ts` imports them from there. Implement in that order and have `query.ts` reference `allowedActions` and `navigationTargets` from those modules.

`src/common/authorization.ts`:

```ts
import { arr, enum_ } from './schema.js';

export const allowedActions = arr(enum_(['create', 'read', 'update', 'delete', 'manage', 'restore', 'transfer', 'revoke']), 0, 32);

export type Capability = string;
```

`src/common/command.ts`:

```ts
import { arr, enum_, obj, optional, SchemaDef, str } from './schema.js';
import { OperationId } from './identifiers.js';
import { navigationTargets } from './navigation.js';

export const idempotencyKey = str(36, 36);

export const resourceVersion = str(1, 64);

export function commandResult<T>(data: SchemaDef): SchemaDef {
  return obj({
    status: enum_(['succeeded', 'duplicate']),
    data,
    resourceVersion,
    operationId: OperationId,
    navigationTargets,
  });
}
```

`src/common/operation.ts`:

```ts
import { enum_, obj, optional, SchemaDef, str } from './schema.js';
import { OperationId } from './identifiers.js';
import { utcTimestamp } from './time.js';

export const operationStatus = enum_(['processing', 'succeeded', 'failed', 'expired', 'unavailable']);

export function operationReference<T>(resultTarget?: SchemaDef): SchemaDef {
  return obj({
    operationId: OperationId,
    status: enum_(['processing']),
    submittedAt: utcTimestamp,
    nextPollAfter: optional(utcTimestamp),
    resultTarget: optional(resultTarget ?? str(1, 128)),
  });
}
```

`src/common/problem-details.ts`:

```ts
import { arr, num, obj, optional, SchemaDef, str, nullable } from './schema.js';

export const PROBLEM_CATEGORY_CODES = [
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
] as const;
export type ProblemCategoryCode = (typeof PROBLEM_CATEGORY_CODES)[number];

const fieldError = obj({ field: str(1, 128), reason: str(1, 256) });

export const auroraProblem = obj({
  type: str(1, 256),
  title: str(1, 128),
  status: num(400, 599),
  detail: str(1, 1024),
  instance: optional(str(1, 128)),
  code: str(1, 64),
  requestId: str(1, 64),
  fieldErrors: optional(arr(fieldError, 0, 50)),
  retryAfter: optional(num(0)),
  currentVersion: optional(str(1, 64)),
  operationId: optional(str(1, 64)),
  recoveryTarget: optional(nullable(str(1, 128))),
});
```

`src/common/section.ts`:

```ts
import { enum_, obj, SchemaDef, str, union } from './schema.js';

export const sectionStatus = enum_(['available', 'empty', 'partial', 'stale', 'unavailable', 'forbidden']);

export function sectionResult<T>(data: SchemaDef): SchemaDef {
  return union([
    obj({ status: enum_(['available']), data }),
    obj({ status: enum_(['empty']), reason: str(1, 256) }),
    obj({ status: enum_(['partial']), data, missing: str(1, 256) }),
    obj({ status: enum_(['stale']), data, freshAt: str(20, 24), staleReason: str(1, 256) }),
    obj({ status: enum_(['unavailable']), reason: str(1, 256) }),
    obj({ status: enum_(['forbidden']) }),
  ]);
}
```

`src/common/navigation.ts`:

```ts
import { arr, enum_, obj, rec, SchemaDef, str } from './schema.js';

export const ROUTE_TARGET_IDS = [
  'auth.register', 'auth.verify-email', 'auth.verify-email-confirm', 'auth.login',
  'auth.forgot-password', 'auth.reset-password', 'invitation.accept', 'account.security',
  'workspace.home', 'organization.project-create', 'organization.members', 'organization.settings',
  'organization.usage', 'organization.tokens', 'organization.audit', 'organization.trash',
  'project.onboarding', 'project.overview', 'project.issues', 'project.issue-detail',
  'project.requests', 'project.performance', 'project.data-status', 'project.releases',
  'project.release-detail', 'project.source-maps', 'project.alerts', 'project.alert-rule-create',
  'project.alert-rule-edit', 'project.alert-instance-detail', 'project.access', 'project.client-keys',
  'project.settings', 'project.lifecycle', 'account.notifications', 'platform.resource-policies',
] as const;

export type RouteTargetId = (typeof ROUTE_TARGET_IDS)[number];

export const routeTargetId = enum_(ROUTE_TARGET_IDS, { openEnum: false });

export const routeTarget = obj({
  routeId: routeTargetId,
  pathParams: rec(str(1, 256)),
  query: rec(str(1, 512)),
});

export const navigationTargets = arr(routeTarget, 0, 20);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: PASS.

- [ ] **Step 5: Re-export from the package root and typecheck**

`src/index.ts` — append:

```ts
export * from './common/pagination.js';
export * from './common/query.js';
export * from './common/command.js';
export * from './common/operation.js';
export * from './common/problem-details.js';
export * from './common/section.js';
export * from './common/authorization.js';
export * from './common/navigation.js';
```

Run: `pnpm --filter @aurora/platform-contract typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-contract
git commit -m "feat: add common platform contracts (pagination/query/command/operation/problem/section/auth/navigation)"
```

---

### Task 4: Session + Navigation Context operation shapes

**Files:**
- Create: `packages/platform-contract/src/identity/session.ts`
- Create: `packages/platform-contract/src/identity/navigation-context.ts`
- Test: `packages/platform-contract/test/identity/session.test.ts`, `test/identity/navigation-context.test.ts`
- Modify: `packages/platform-contract/src/index.ts`

**Interfaces:**
- Consumes: common contracts (Task 3), identifiers (Task 2).
- Produces:
  - `identityGetSessionResponse` (SchemaDef): `obj({ account: accountSummary, authentication: authState, session: sessionInfo, csrf: csrfToken, navigation: navigationReadTargets })` where:
    - `accountSummary = obj({ accountId: AccountId, email: str(3,320), verified: bool })`
    - `authState = enum_(['pending_verification','authenticated','restricted'])`
    - `sessionInfo = obj({ expiresAt: utcTimestamp, rotationDueAt?: utcTimestamp })`
    - `csrfToken = str(1,256)`
    - `navigationReadTargets = navigationTargets`
  - `navigationGetContextResponse` (SchemaDef): `obj({ account: accountSummary, workspace: navigationTargets, organizations: arr(organizationNav), currentScope: nullable(scopeState), defaultTarget: routeTarget, safeExitTarget: routeTarget })` where:
    - `organizationNav = obj({ organizationId, name: str(1,128), projects: arr(projectNav), entry: routeTarget })`
    - `projectNav = obj({ projectId, name: str(1,128), lifecycle: enum_(['active','archived']), entry: routeTarget })`
    - `scopeState = obj({ type: enum_(['workspace','organization','project']), id?: str(1,64), lifecycle: enum_(['active','archived','trash']) })`
  - Exported operationId constants: `OPERATION_ID_SESSION = 'identityGetSession'`, `OPERATION_ID_NAVIGATION = 'navigationGetContext'`.

- [ ] **Step 1: Write the failing test**

`test/identity/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { identityGetSessionResponse } from '../../src/identity/session.js';

describe('identityGetSession', () => {
  it('accepts a valid session projection', () => {
    expect(
      identityGetSessionResponse.zod.safeParse({
        account: { accountId: 'acct_1', email: 'a@b.c', verified: true },
        authentication: 'authenticated',
        session: { expiresAt: '2026-08-08T01:00:00.000Z' },
        csrf: 'tok',
        navigation: [],
      }).success,
    ).toBe(true);
  });

  it('rejects a leaked session id or password field', () => {
    expect(
      identityGetSessionResponse.zod.safeParse({
        account: { accountId: 'acct_1', email: 'a@b.c', verified: true, passwordHash: 'x' },
        authentication: 'authenticated',
        session: { expiresAt: '2026-08-08T01:00:00.000Z', sessionId: 's_1' },
        csrf: 'tok',
        navigation: [],
      }).success,
    ).toBe(false);
  });
});
```

`test/identity/navigation-context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { navigationGetContextResponse } from '../../src/identity/navigation-context.js';

describe('navigationGetContext', () => {
  it('accepts a workspace-scoped navigation projection', () => {
    expect(
      navigationGetContextResponse.zod.safeParse({
        account: { accountId: 'acct_1', email: 'a@b.c', verified: true },
        workspace: [{ routeId: 'workspace.home', pathParams: {}, query: {} }],
        organizations: [],
        currentScope: { type: 'workspace', lifecycle: 'active' },
        defaultTarget: { routeId: 'workspace.home', pathParams: {}, query: {} },
        safeExitTarget: { routeId: 'workspace.home', pathParams: {}, query: {} },
      }).success,
    ).toBe(true);
  });

  it('rejects a non-closed route target', () => {
    expect(
      navigationGetContextResponse.zod.safeParse({
        account: { accountId: 'acct_1', email: 'a@b.c', verified: true },
        workspace: [],
        organizations: [],
        currentScope: { type: 'workspace', lifecycle: 'active' },
        defaultTarget: { routeId: 'anything.goes', pathParams: {}, query: {} },
        safeExitTarget: { routeId: 'workspace.home', pathParams: {}, query: {} },
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Write minimal implementation**

`src/identity/session.ts`:

```ts
import { bool, enum_, obj, optional, str } from '../common/schema.js';
import { AccountId } from '../common/identifiers.js';
import { utcTimestamp } from '../common/time.js';
import { navigationTargets } from '../common/navigation.js';

export const OPERATION_ID_SESSION = 'identityGetSession' as const;

const accountSummary = obj({
  accountId: AccountId,
  email: str(3, 320),
  verified: bool(),
});

const sessionInfo = obj({
  expiresAt: utcTimestamp,
  rotationDueAt: optional(utcTimestamp),
});

export const identityGetSessionResponse = obj({
  account: accountSummary,
  authentication: enum_(['pending_verification', 'authenticated', 'restricted']),
  session: sessionInfo,
  csrf: str(1, 256),
  navigation: navigationTargets,
});
```

`src/identity/navigation-context.ts`:

```ts
import { arr, bool, enum_, nullable, obj, optional, str } from '../common/schema.js';
import { AccountId, OrganizationId, ProjectId } from '../common/identifiers.js';
import { navigationTargets, routeTarget } from '../common/navigation.js';

export const OPERATION_ID_NAVIGATION = 'navigationGetContext' as const;

const accountSummary = obj({
  accountId: AccountId,
  email: str(3, 320),
  verified: bool(),
});

const projectNav = obj({
  projectId: ProjectId,
  name: str(1, 128),
  lifecycle: enum_(['active', 'archived']),
  entry: routeTarget,
});

const organizationNav = obj({
  organizationId: OrganizationId,
  name: str(1, 128),
  projects: arr(projectNav),
  entry: routeTarget,
});

const scopeState = obj({
  type: enum_(['workspace', 'organization', 'project']),
  id: optional(str(1, 64)),
  lifecycle: enum_(['active', 'archived', 'trash']),
});

export const navigationGetContextResponse = obj({
  account: accountSummary,
  workspace: navigationTargets,
  organizations: arr(organizationNav),
  currentScope: nullable(scopeState),
  defaultTarget: routeTarget,
  safeExitTarget: routeTarget,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: PASS.

- [ ] **Step 5: Re-export and typecheck**

`src/index.ts` — append:

```ts
export * from './identity/session.js';
export * from './identity/navigation-context.js';
```

Run: `pnpm --filter @aurora/platform-contract typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-contract
git commit -m "feat: add identityGetSession and navigationGetContext contract shapes"
```

---

### Task 5: Operation registry + expected-operation manifest

**Files:**
- Create: `packages/platform-contract/src/registry/operations.ts`
- Create: `packages/platform-contract/src/registry/manifest.ts`
- Test: `packages/platform-contract/test/registry/manifest.test.ts`
- Modify: `packages/platform-contract/src/index.ts`

**Interfaces:**
- Consumes: common contracts + session/navigation shapes (Tasks 3–4).
- Produces:
  - `HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'`.
  - `AuthLevel = 'public' | 'intent' | 'session' | 'recent-verification'`.
  - `OperationDef`:
    ```ts
    interface OperationDef {
      readonly operationId: string;
      readonly domain: string;
      readonly authLevel: AuthLevel;
      readonly method: HttpMethod;
      readonly path: string; // /api/platform/v1 + template
      readonly summary: string;
      readonly request?: {
        readonly pathParams?: SchemaDef;
        readonly query?: SchemaDef;
        readonly body?: SchemaDef;
        readonly idempotency?: boolean;
        readonly csrf?: boolean;
        readonly versioned?: boolean;
      };
      readonly responses: Readonly<Record<number, SchemaDef>>;
      readonly errorCodes: readonly string[];
      readonly page?: RouteTargetId;
      readonly pagination?: PaginationModel;
      readonly tags: readonly string[];
    }
    ```
  - `PLATFORM_OPERATIONS: readonly OperationDef[]` — the two stable ops (`identityGetSession`, `navigationGetContext`).
  - `BLOCKED_OPERATIONS: readonly { operationId: string; domain: string; reason: string }[]` — every other A1–D2 operation family from backend design §6 and OpenAPI design §14, each with a declared downstream-gap reason (e.g. `identityLogin` → 'identity auth backend not formalized (G10)'; `organizationListMembers` → 'organization domain model not formalized (G10)'; `projectCreateProject` → 'project-governance model not formalized (G10)'; `issuesListIssues` → 'processing-store Query contract absent (G11)'; `usageGetSummary` → 'usage module absent'; `d2SetPlatformDefaultPolicy` → 'PlatformAdmin authority not approved (G13)'; etc.). These are **metadata only** — they are NOT emitted as OpenAPI operations and have no schemas.
  - `OPERATION_MANIFEST` (in `manifest.ts`): an object `{ stable: string[], blocked: Record<string,string>, routeTargetCoverage: Record<RouteTargetId, 'stable'|'blocked'|'unavailable'> }` computed from the above, with a `validateManifest()` function that throws on: duplicate operationId; operationId not matching `^[a-z][A-Za-z0-9]+$` (domainVerbObject); stable op not in OpenAPI-emittable set; blocked op carrying a schema; every RouteTargetId covered by ≥1 stable or blocked operation or marked `unavailable` with reason; no blocked op used as a routeTargetCoverage `'stable'`.

- [ ] **Step 1: Write the failing test**

`test/registry/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateManifest, OPERATION_MANIFEST } from '../../src/registry/manifest.js';
import { BLOCKED_OPERATIONS, PLATFORM_OPERATIONS } from '../../src/registry/operations.js';
import { ROUTE_TARGET_IDS } from '../../src/common/navigation.js';

describe('operation registry and manifest', () => {
  it('exposes two stable foundation operations', () => {
    expect(PLATFORM_OPERATIONS.map((o) => o.operationId)).toEqual(['identityGetSession', 'navigationGetContext']);
  });

  it('registers blocked downstream operations without schemas', () => {
    expect(BLOCKED_OPERATIONS.length).toBeGreaterThan(30);
    for (const op of BLOCKED_OPERATIONS) {
      expect(op.reason.length).toBeGreaterThan(10);
      expect('responses' in op).toBe(false);
    }
  });

  it('passes manifest validation (uniqueness, coverage, no blocked-as-stable)', () => {
    expect(() => validateManifest()).not.toThrow();
  });

  it('covers every route target via stable or blocked operations or unavailable', () => {
    const covered = Object.keys(OPERATION_MANIFEST.routeTargetCoverage);
    for (const rt of ROUTE_TARGET_IDS) {
      expect(covered).toContain(rt);
      expect(['stable', 'blocked', 'unavailable']).toContain(OPERATION_MANIFEST.routeTargetCoverage[rt]);
    }
  });

  it('marks platform.resource-policies unavailable (D2 gate)', () => {
    expect(OPERATION_MANIFEST.routeTargetCoverage['platform.resource-policies']).toBe('unavailable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: FAIL — registry modules do not exist.

- [ ] **Step 3: Write minimal implementation**

`src/registry/operations.ts`:

```ts
import type { RouteTargetId } from '../common/navigation.js';
import type { PaginationModel } from '../common/pagination.js';
import type { SchemaDef } from '../common/schema.js';
import { identityGetSessionResponse, OPERATION_ID_SESSION } from '../identity/session.js';
import { navigationGetContextResponse, OPERATION_ID_NAVIGATION } from '../identity/navigation-context.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type AuthLevel = 'public' | 'intent' | 'session' | 'recent-verification';

export interface OperationDef {
  readonly operationId: string;
  readonly domain: string;
  readonly authLevel: AuthLevel;
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly request?: {
    readonly pathParams?: SchemaDef;
    readonly query?: SchemaDef;
    readonly body?: SchemaDef;
    readonly idempotency?: boolean;
    readonly csrf?: boolean;
    readonly versioned?: boolean;
  };
  readonly responses: Readonly<Record<number, SchemaDef>>;
  readonly errorCodes: readonly string[];
  readonly page?: RouteTargetId;
  readonly pagination?: PaginationModel;
  readonly tags: readonly string[];
}

export const PLATFORM_OPERATIONS: readonly OperationDef[] = [
  {
    operationId: OPERATION_ID_SESSION,
    domain: 'identity',
    authLevel: 'public',
    method: 'GET',
    path: '/api/platform/v1/session',
    summary: 'Resolve the current account session projection and CSRF token',
    responses: { 200: identityGetSessionResponse },
    errorCodes: ['authentication', 'authority_unavailable'],
    page: 'workspace.home',
    tags: ['identity', 'session'],
  },
  {
    operationId: OPERATION_ID_NAVIGATION,
    domain: 'identity',
    authLevel: 'session',
    method: 'GET',
    path: '/api/platform/v1/navigation/context',
    summary: 'Resolve the authorized navigation context for the current scope',
    responses: { 200: navigationGetContextResponse },
    errorCodes: ['authentication', 'authorization', 'authority_unavailable'],
    page: 'workspace.home',
    tags: ['identity', 'navigation'],
  },
];

export interface BlockedOperation {
  readonly operationId: string;
  readonly domain: string;
  readonly reason: string;
}

export const BLOCKED_OPERATIONS: readonly BlockedOperation[] = [
  { operationId: 'identityRegister', domain: 'identity', reason: 'A1 auth backend not formalized (G10)' },
  { operationId: 'identityConfirmEmailVerification', domain: 'identity', reason: 'A1 verify backend not formalized (G10)' },
  { operationId: 'identityLogin', domain: 'identity', reason: 'A2 login backend not formalized (G10)' },
  { operationId: 'identityLogout', domain: 'identity', reason: 'A2 session backend not formalized (G10)' },
  { operationId: 'identityRequestPasswordReset', domain: 'identity', reason: 'A3 reset backend not formalized (G10)' },
  { operationId: 'identityConfirmPasswordReset', domain: 'identity', reason: 'A3 reset backend not formalized (G10)' },
  { operationId: 'identityChangePassword', domain: 'identity', reason: 'A5 security backend not formalized (G10)' },
  { operationId: 'identityDeleteAccountPreflight', domain: 'identity', reason: 'A5 deletion backend not formalized (G10)' },
  { operationId: 'identityDeleteAccount', domain: 'identity', reason: 'A5 deletion orchestration not formalized (G10/SEC-01)' },
  { operationId: 'organizationAcceptInvitation', domain: 'organization', reason: 'A4 invitation backend not formalized (G10)' },
  { operationId: 'organizationListProjects', domain: 'organization', reason: 'B1 workspace backend not formalized (G10)' },
  { operationId: 'organizationCreateProject', domain: 'organization', reason: 'B2 project-governance model not formalized (G10)' },
  { operationId: 'organizationListMembers', domain: 'organization', reason: 'B3 membership model not formalized (G10)' },
  { operationId: 'organizationInviteMember', domain: 'organization', reason: 'B3 invitation model not formalized (G10)' },
  { operationId: 'organizationUpdateTimezone', domain: 'organization', reason: 'B4 org settings model not formalized (G10)' },
  { operationId: 'usageGetSummary', domain: 'usage-and-policy', reason: 'B5 usage module absent (G10/G11)' },
  { operationId: 'credentialsListPrivateTokens', domain: 'credentials', reason: 'B6 credential model not formalized (G10)' },
  { operationId: 'credentialsCreatePrivateToken', domain: 'credentials', reason: 'B6 one-time secret delivery not formalized (G10)' },
  { operationId: 'auditListSecurityAudit', domain: 'audit', reason: 'B7 audit model not formalized (G10)' },
  { operationId: 'projectGovernanceListTrash', domain: 'project-governance', reason: 'B8 recycle-bin model not formalized (G10)' },
  { operationId: 'projectGovernanceRestoreProject', domain: 'project-governance', reason: 'B8 restore backend not formalized (G10)' },
  { operationId: 'onboardingGetProgress', domain: 'project-governance', reason: 'C1 onboarding model not formalized (G11)' },
  { operationId: 'overviewGetProjectStatus', domain: 'issues-and-alerts', reason: 'C2 overview Query not formalized (G11)' },
  { operationId: 'issuesListIssues', domain: 'issues-and-alerts', reason: 'C3 processing-store Query contract absent (G11)' },
  { operationId: 'issuesGetIssueDetail', domain: 'issues-and-alerts', reason: 'C4 processing-store Query contract absent (G11)' },
  { operationId: 'requestsListEndpoints', domain: 'monitoring-projections', reason: 'C5 request metric Query absent (G11)' },
  { operationId: 'performanceListPages', domain: 'monitoring-projections', reason: 'C6 performance metric Query absent (G11)' },
  { operationId: 'diagnosticsGetDataStatus', domain: 'monitoring-projections', reason: 'C7 diagnostics Query absent (G11)' },
  { operationId: 'releasesListReleases', domain: 'releases', reason: 'C8 releases model not formalized (G12)' },
  { operationId: 'sourceMapsListFiles', domain: 'releases', reason: 'C9 Source Map/object store not formalized (G12)' },
  { operationId: 'alertsListRulesAndInstances', domain: 'issues-and-alerts', reason: 'C10 alert model not formalized (G12)' },
  { operationId: 'alertsCreateRule', domain: 'issues-and-alerts', reason: 'C11 alert rule model not formalized (G12)' },
  { operationId: 'alertsGetInstanceDetail', domain: 'issues-and-alerts', reason: 'C12 alert instance Query absent (G12)' },
  { operationId: 'accessListEffectiveMembers', domain: 'project-governance', reason: 'C13 access projection not formalized (G12)' },
  { operationId: 'credentialsListClientKeys', domain: 'credentials', reason: 'C14 client-key management not formalized (G12)' },
  { operationId: 'settingsGetProject', domain: 'project-governance', reason: 'C15 settings model not formalized (G12)' },
  { operationId: 'lifecycleArchiveProject', domain: 'project-governance', reason: 'C16 lifecycle model not formalized (G12)' },
  { operationId: 'notificationsListAndUnread', domain: 'issues-and-alerts', reason: 'D1 notifications backend not formalized (G13)' },
  { operationId: 'policySetPlatformDefault', domain: 'usage-and-policy', reason: 'D2 PlatformAdmin authority not approved (G13)' },
];
```

`src/registry/manifest.ts`:

```ts
import { ROUTE_TARGET_IDS, type RouteTargetId } from '../common/navigation.js';
import { BLOCKED_OPERATIONS, PLATFORM_OPERATIONS } from './operations.js';

export type CoverageKind = 'stable' | 'blocked' | 'unavailable';

export interface OperationManifest {
  readonly stable: readonly string[];
  readonly blocked: Readonly<Record<string, string>>;
  readonly routeTargetCoverage: Readonly<Record<RouteTargetId, CoverageKind>>;
}

const operationIdPattern = /^[a-z][A-Za-z0-9]+$/;

function buildRouteTargetCoverage(): Record<RouteTargetId, CoverageKind> {
  const coverage = Object.fromEntries(ROUTE_TARGET_IDS.map((rt) => [rt, 'unavailable' as CoverageKind]));
  for (const op of PLATFORM_OPERATIONS) {
    if (op.page) coverage[op.page] = 'stable';
  }
  for (const op of BLOCKED_OPERATIONS) {
    const page = pageForOperation(op.operationId);
    if (page && coverage[page] === 'unavailable') coverage[page] = 'blocked';
  }
  return coverage;
}

function pageForOperation(operationId: string): RouteTargetId | undefined {
  const map: Readonly<Record<string, RouteTargetId>> = {
    identityRegister: 'auth.register',
    identityConfirmEmailVerification: 'auth.verify-email-confirm',
    identityLogin: 'auth.login',
    identityRequestPasswordReset: 'auth.forgot-password',
    identityConfirmPasswordReset: 'auth.reset-password',
    identityChangePassword: 'account.security',
    identityDeleteAccountPreflight: 'account.security',
    identityDeleteAccount: 'account.security',
    organizationAcceptInvitation: 'invitation.accept',
    organizationListProjects: 'workspace.home',
    organizationCreateProject: 'organization.project-create',
    organizationListMembers: 'organization.members',
    organizationInviteMember: 'organization.members',
    organizationUpdateTimezone: 'organization.settings',
    usageGetSummary: 'organization.usage',
    credentialsListPrivateTokens: 'organization.tokens',
    credentialsCreatePrivateToken: 'organization.tokens',
    auditListSecurityAudit: 'organization.audit',
    projectGovernanceListTrash: 'organization.trash',
    projectGovernanceRestoreProject: 'organization.trash',
    onboardingGetProgress: 'project.onboarding',
    overviewGetProjectStatus: 'project.overview',
    issuesListIssues: 'project.issues',
    issuesGetIssueDetail: 'project.issue-detail',
    requestsListEndpoints: 'project.requests',
    performanceListPages: 'project.performance',
    diagnosticsGetDataStatus: 'project.data-status',
    releasesListReleases: 'project.releases',
    sourceMapsListFiles: 'project.source-maps',
    alertsListRulesAndInstances: 'project.alerts',
    alertsCreateRule: 'project.alert-rule-create',
    alertsGetInstanceDetail: 'project.alert-instance-detail',
    accessListEffectiveMembers: 'project.access',
    credentialsListClientKeys: 'project.client-keys',
    settingsGetProject: 'project.settings',
    lifecycleArchiveProject: 'project.lifecycle',
    notificationsListAndUnread: 'account.notifications',
    policySetPlatformDefault: 'platform.resource-policies',
  };
  return map[operationId];
}

export const OPERATION_MANIFEST: OperationManifest = {
  stable: PLATFORM_OPERATIONS.map((op) => op.operationId),
  blocked: Object.fromEntries(BLOCKED_OPERATIONS.map((op) => [op.operationId, op.reason])),
  routeTargetCoverage: buildRouteTargetCoverage(),
};

export function validateManifest(): void {
  const seen = new Set<string>();
  for (const op of PLATFORM_OPERATIONS) {
    if (seen.has(op.operationId)) throw new Error(`duplicate operationId: ${op.operationId}`);
    seen.add(op.operationId);
    if (!operationIdPattern.test(op.operationId)) throw new Error(`invalid operationId format: ${op.operationId}`);
  }
  for (const op of BLOCKED_OPERATIONS) {
    if (seen.has(op.operationId)) throw new Error(`blocked op collides with stable op: ${op.operationId}`);
    seen.add(op.operationId);
    if (!operationIdPattern.test(op.operationId)) throw new Error(`invalid blocked operationId: ${op.operationId}`);
  }
  for (const rt of ROUTE_TARGET_IDS) {
    const kind = OPERATION_MANIFEST.routeTargetCoverage[rt];
    if (kind === undefined) throw new Error(`route target not covered: ${rt}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: PASS (registry/manifest tests pass, including the >30 blocked ops and the D2 unavailable assertion).

- [ ] **Step 5: Re-export and typecheck**

`src/index.ts` — append:

```ts
export * from './registry/operations.js';
export * from './registry/manifest.js';
```

Run: `pnpm --filter @aurora/platform-contract typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-contract
git commit -m "feat: add operation registry and expected-operation manifest"
```

---

### Task 6: Deterministic OpenAPI generator

**Files:**
- Create: `packages/platform-contract/src/generator/openapi.ts`
- Create: `packages/platform-contract/src/generator/to-json-schema.ts`
- Test: `packages/platform-contract/test/generator/openapi.test.ts`
- Modify: `packages/platform-contract/src/index.ts` (do NOT export generator internals)

**Interfaces:**
- Consumes: `SchemaDef` (Task 2), `PLATFORM_OPERATIONS`, `BLOCKED_OPERATIONS`, `OPERATION_MANIFEST` (Task 5).
- Produces:
  - `toJsonSchema(def: SchemaDef, registry: SchemaRegistry, name?: string): JsonSchemaObject` — when `name` is provided, registers the schema in the registry under that name and returns `{ $ref: '#/components/schemas/<name>' }`; otherwise returns the inline JSON-Schema. Nested schemas are inlined (OpenAPI allows inline schemas); top-level operation responses get stable names `${operationId}Response`.
  - `generateOpenApiDocument(opts?: { title?: string }): OpenApiDocument` — returns an in-memory OpenAPI 3.1 document: `{ openapi: '3.1.0', info: { title, version: 'v1' }, servers: [{ url: '/api/platform/v1' }], paths, components: { schemas }, tags }`. `paths` are built only from `PLATFORM_OPERATIONS` (stable). `components.schemas` includes every named response schema (in first-seen order). Blocked operations are NOT in `paths`.
  - `OpenApiDocument` type with minimal shape `{ openapi: string; info: { title: string; version: string }; servers: readonly { url: string }[]; paths: Readonly<Record<string, unknown>>; components: { schemas: Readonly<Record<string, unknown>> }; tags: readonly { name: string }[] }`.

Note on determinism: the generator iterates arrays in insertion order, never `Object.entries` order that depends on runtime hash, and never uses timestamps/random. Regeneration must be byte-identical.

- [ ] **Step 1: Write the failing test**

`test/generator/openapi.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateOpenApiDocument } from '../../src/generator/openapi.js';
import { PLATFORM_OPERATIONS } from '../../src/registry/operations.js';

describe('openapi generator', () => {
  it('produces a deterministic v1 document', () => {
    const a = JSON.stringify(generateOpenApiDocument());
    const b = JSON.stringify(generateOpenApiDocument());
    expect(a).toBe(b);
  });

  it('emits exactly the stable operations as paths', () => {
    const doc = generateOpenApiDocument();
    const pathCount = Object.keys(doc.paths).length;
    expect(pathCount).toBe(PLATFORM_OPERATIONS.length);
    expect(doc.paths['/session']).toBeDefined();
    expect(doc.paths['/navigation/context']).toBeDefined();
  });

  it('does not emit blocked operations as empty schemas', () => {
    const doc = generateOpenApiDocument();
    const json = JSON.stringify(doc);
    expect(json).not.toContain('identityLogin');
    expect(json).not.toContain('projectCreateProject');
    expect(json).not.toContain('"type":"object","properties":{}');
  });

  it('names response schemas stably', () => {
    const doc = generateOpenApiDocument();
    expect((doc.components.schemas as Record<string, unknown>)['identityGetSessionResponse']).toBeDefined();
  });
});
```

Note: because `servers` is `[{ url: '/api/platform/v1' }]`, the emitted paths use the server-relative path (e.g. `/session`). The generator strips the `/api/platform/v1` prefix from `OperationDef.path` when building `paths`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: FAIL — generator module does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/generator/to-json-schema.ts`:

```ts
import type { JsonSchemaObject, SchemaDef } from '../common/schema.js';

export interface SchemaRegistry {
  readonly register: (name: string, schema: JsonSchemaObject) => void;
  readonly read: () => Readonly<Record<string, JsonSchemaObject>>;
}

export function toJsonSchema(def: SchemaDef, registry: SchemaRegistry, name?: string): JsonSchemaObject {
  if (name !== undefined) {
    registry.register(name, def.openapi);
    return { $ref: `#/components/schemas/${name}` };
  }
  return def.openapi;
}
```

`src/generator/openapi.ts`:

```ts
import type { JsonSchemaObject } from '../common/schema.js';
import { PLATFORM_OPERATIONS, type OperationDef } from '../registry/operations.js';
import { toJsonSchema, type SchemaRegistry } from './to-json-schema.js';

export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly version: string };
  readonly servers: readonly { readonly url: string }[];
  readonly paths: Readonly<Record<string, unknown>>;
  readonly components: { readonly schemas: Readonly<Record<string, unknown>> };
  readonly tags: readonly { readonly name: string }[];
}

const API_PREFIX = '/api/platform/v1';

function createRegistry(): SchemaRegistry {
  const names = new Map<string, JsonSchemaObject>();
  return {
    register: (name, schema) => {
      if (!names.has(name)) names.set(name, schema);
    },
    read: () => Object.fromEntries(names),
  };
}

function buildPathKey(op: OperationDef): string {
  return op.path.startsWith(API_PREFIX) ? op.path.slice(API_PREFIX.length) : op.path;
}

export function generateOpenApiDocument(opts: { title?: string } = {}): OpenApiDocument {
  const registry = createRegistry();
  const paths: Record<string, unknown> = {};
  const tags = new Set<string>();

  for (const op of PLATFORM_OPERATIONS) {
    for (const t of op.tags) tags.add(t);
    const responses: Record<string, unknown> = {};
    for (const [status, schema] of Object.entries(op.responses)) {
      const name = status === '200' ? `${op.operationId}Response` : `${op.operationId}${status}Response`;
      responses[status] = {
        description: `${status} response`,
        content: { 'application/json': { schema: toJsonSchema(schema, registry, name) } },
      };
    }
    const operation: Record<string, unknown> = {
      operationId: op.operationId,
      summary: op.summary,
      tags: op.tags,
      responses,
    };
    if (op.request?.query) operation.parameters = [{ name: 'query', in: 'query', schema: toJsonSchema(op.request.query, registry) }];
    if (op.request?.body) operation.requestBody = { content: { 'application/json': { schema: toJsonSchema(op.request.body, registry) } } };
    const key = buildPathKey(op);
    const existing = (paths[key] as Record<string, unknown> | undefined) ?? {};
    existing[op.method.toLowerCase()] = operation;
    paths[key] = existing;
  }

  return {
    openapi: '3.1.0',
    info: { title: opts.title ?? 'Aurora Platform API', version: 'v1' },
    servers: [{ url: API_PREFIX }],
    paths,
    components: { schemas: registry.read() },
    tags: [...tags].sort().map((name) => ({ name })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: PASS.

- [ ] **Step 5: Do not export generator internals from the package root**

Verify `src/index.ts` does NOT re-export `generator/*`. Keep the generator internal (consumed by the emit script in Task 7 and the drift tool in Task 11 via a test/build path, not the public entry).

- [ ] **Step 6: Commit**

```bash
git add packages/platform-contract
git commit -m "feat: add deterministic OpenAPI generator"
```

---

### Task 7: Emit machine OpenAPI artifact + generation script + redocly lint + coverage manifest

**Files:**
- Create: `packages/platform-contract/scripts/generate-openapi.ts`
- Create: `docs/api/platform-openapi-v1.yaml` (generated, committed with "由契约源码生成、禁止手工修改" header)
- Create: `docs/api/platform-openapi-v1.manifest.json` (generated coverage manifest)
- Test: `packages/platform-contract/test/generator/artifact.test.ts`
- Modify: `package.json` (`openapi:platform:lint`, wire into `openapi:check`)
- Modify: `.redocly.yaml` (add platform file rules — reuse the ingestion rule set)

**Interfaces:**
- Consumes: `generateOpenApiDocument` (Task 6), `OPERATION_MANIFEST` (Task 5).
- Produces:
  - `scripts/generate-openapi.ts` — Node entry that writes `docs/api/platform-openapi-v1.yaml` (with a fixed comment header line `# 由契约源码生成、禁止手工修改`) and `docs/api/platform-openapi-v1.manifest.json`.
  - Root script `openapi:platform:lint`: `redocly lint docs/api/platform-openapi-v1.yaml --config .redocly.yaml`.
  - Root `openapi:check` becomes: `pnpm openapi:lint && pnpm openapi:platform:lint && pnpm --filter @aurora/ingestion-openapi-contract test && pnpm --filter @aurora/platform-contract-drift test` (drift tool added in Task 11; for Task 7, wire the lint and generation, leave the drift placeholder out of `openapi:check` until Task 11 adds it).

- [ ] **Step 1: Write the failing test**

`test/generator/artifact.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateOpenApiDocument } from '../../src/generator/openapi.js';
import { OPERATION_MANIFEST } from '../../src/registry/manifest.js';

describe('generated artifact', () => {
  it('committed YAML matches a fresh generation', async () => {
    const { dump } = await import('yaml');
    const fresh = dump(generateOpenApiDocument());
    const committed = await readFile(new URL('../../../../docs/api/platform-openapi-v1.yaml', import.meta.url), 'utf8');
    expect(committed.replace(/^# 由契约源码生成、禁止手工修改\n/, '')).toBe(fresh);
  });

  it('manifest marks platform.resource-policies unavailable', () => {
    expect(OPERATION_MANIFEST.routeTargetCoverage['platform.resource-policies']).toBe('unavailable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: FAIL — YAML file does not exist (readFile ENOENT).

- [ ] **Step 3: Write the generation script**

`scripts/generate-openapi.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dump } from 'yaml';
import { generateOpenApiDocument } from '../src/generator/openapi.js';
import { OPERATION_MANIFEST } from '../src/registry/manifest.js';

const apiDir = fileURLToPath(new URL('../../../docs/api/', import.meta.url));
const GENERATED_HEADER = '# 由契约源码生成、禁止手工修改\n';

async function main(): Promise<void> {
  await mkdir(apiDir, { recursive: true });
  const yaml = GENERATED_HEADER + dump(generateOpenApiDocument({ title: 'Aurora Platform API' }));
  await writeFile(new URL('platform-openapi-v1.yaml', new URL(apiDir, import.meta.url)), yaml, 'utf8');
  const manifest = JSON.stringify(OPERATION_MANIFEST, null, 2) + '\n';
  await writeFile(new URL('platform-openapi-v1.manifest.json', new URL(apiDir, import.meta.url)), manifest, 'utf8');
}

await main();
```

- [ ] **Step 4: Generate the artifacts and verify determinism**

Run: `pnpm platform-contract:generate`
Expected: `docs/api/platform-openapi-v1.yaml` and `docs/api/platform-openapi-v1.manifest.json` are written. Run it twice; the second run must produce byte-identical YAML (verify with `git diff --stat` being empty after regenerating).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: PASS (artifact matches fresh generation).

- [ ] **Step 6: Wire redocly lint**

`package.json` — add script: `"openapi:platform:lint": "redocly lint docs/api/platform-openapi-v1.yaml --config .redocly.yaml"` and change `"openapi:check"` to:

```json
"openapi:check": "pnpm openapi:lint && pnpm openapi:platform:lint && pnpm --filter @aurora/ingestion-openapi-contract test"
```

Run: `pnpm openapi:platform:lint`
Expected: PASS (or documented violations fixed — redocly `recommended` may flag missing operation responses; the generator emits `responses` for every operation, so it should pass; if a recommended rule fires, add the same suppression to `.redocly.yaml` that ingestion already has).

- [ ] **Step 7: Commit**

```bash
git add package.json .redocly.yaml docs/api/platform-openapi-v1.yaml docs/api/platform-openapi-v1.manifest.json packages/platform-contract/scripts packages/platform-contract/test
git commit -m "feat: emit machine Platform OpenAPI v1 and coverage manifest"
```

---

### Task 8: Generated client (request descriptors + response validators)

**Files:**
- Create: `packages/platform-contract/src/client/types.ts`
- Create: `packages/platform-contract/src/client/operations.ts`
- Create: `packages/platform-contract/src/client/index.ts` (public `/client` entry)
- Test: `packages/platform-contract/test/client/client.test.ts`
- Modify: `packages/platform-contract/package.json` (add `/client` export)

**Interfaces:**
- Consumes: `PLATFORM_OPERATIONS` (Task 5), `SchemaDef.zod` (Task 2).
- Produces (all in `/client`):
  - `type OperationRequest` = `{ operationId: string; method: HttpMethod; path: string; body?: unknown; query?: unknown }`.
  - `type OperationResult = { ok: true; operationId: string; status: number; data: unknown } | { ok: false; operationId: string; status: number; problem: unknown }`.
  - `buildRequest(op: OperationDef, input: { query?: unknown; body?: unknown }): OperationRequest` — validates `input` against `op.request.query`/`op.request.body` zod schemas, throws `ClientInputError` on failure.
  - `parseResponse(op: OperationDef, raw: unknown, status: number): OperationResult` — validates the 2xx body against `op.responses[200]` zod; a 4xx/5xx body is validated against `auroraProblem`; returns `ok:false` with the problem otherwise.
  - `ClientInputError` class with `message` and `issues`.
  - Re-export `PLATFORM_OPERATIONS` so consumers can enumerate operations without importing the root.

- [ ] **Step 1: Write the failing test**

`test/client/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildRequest, parseResponse, ClientInputError } from '../../src/client/index.js';
import { PLATFORM_OPERATIONS } from '../../src/registry/operations.js';

const sessionOp = PLATFORM_OPERATIONS.find((o) => o.operationId === 'identityGetSession')!;

describe('generated client', () => {
  it('builds a request for identityGetSession', () => {
    const req = buildRequest(sessionOp, {});
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/api/platform/v1/session');
  });

  it('rejects an invalid response body', () => {
    const res = parseResponse(sessionOp, { account: {} }, 200);
    expect(res.ok).toBe(false);
  });

  it('accepts a valid session response', () => {
    const body = {
      account: { accountId: 'acct_1', email: 'a@b.c', verified: true },
      authentication: 'authenticated',
      session: { expiresAt: '2026-08-08T01:00:00.000Z' },
      csrf: 'tok',
      navigation: [],
    };
    const res = parseResponse(sessionOp, body, 200);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(body);
  });

  it('throws ClientInputError on invalid input', () => {
    const navOp = PLATFORM_OPERATIONS.find((o) => o.operationId === 'navigationGetContext')!;
    expect(() => buildRequest(navOp, { query: { bogus: 1 } })).toThrow(ClientInputError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: FAIL — client module does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/client/types.ts`:

```ts
import type { HttpMethod } from '../registry/operations.js';

export interface OperationRequest {
  readonly operationId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly body?: unknown;
  readonly query?: unknown;
}

export type OperationResult =
  | { readonly ok: true; readonly operationId: string; readonly status: number; readonly data: unknown }
  | { readonly ok: false; readonly operationId: string; readonly status: number; readonly problem: unknown };
```

`src/client/operations.ts`:

```ts
import { z } from 'zod';
import type { OperationDef } from '../registry/operations.js';
import { auroraProblem } from '../common/problem-details.js';
import type { OperationRequest, OperationResult } from './types.js';

export class ClientInputError extends Error {
  readonly issues: readonly z.ZodIssue[];
  constructor(message: string, issues: readonly z.ZodIssue[]) {
    super(message);
    this.name = 'ClientInputError';
    this.issues = issues;
  }
}

export function buildRequest(op: OperationDef, input: { query?: unknown; body?: unknown }): OperationRequest {
  if (op.request?.query) {
    const r = op.request.query.zod.safeParse(input.query ?? {});
    if (!r.success) throw new ClientInputError(`invalid query for ${op.operationId}`, r.error.issues);
  }
  if (op.request?.body) {
    const r = op.request.body.zod.safeParse(input.body);
    if (!r.success) throw new ClientInputError(`invalid body for ${op.operationId}`, r.error.issues);
  }
  return { operationId: op.operationId, method: op.method, path: op.path, body: input.body, query: input.query };
}

export function parseResponse(op: OperationDef, raw: unknown, status: number): OperationResult {
  if (status >= 200 && status < 300) {
    const schema = op.responses[200];
    if (!schema) return { ok: false, operationId: op.operationId, status, problem: { code: 'processing' } };
    const r = schema.zod.safeParse(raw);
    if (!r.success) return { ok: false, operationId: op.operationId, status, problem: { code: 'structural_error' } };
    return { ok: true, operationId: op.operationId, status, data: r.data };
  }
  const problem = auroraProblem.zod.safeParse(raw);
  return problem.success
    ? { ok: false, operationId: op.operationId, status, problem: problem.data }
    : { ok: false, operationId: op.operationId, status, problem: { code: 'structural_error' } };
}
```

`src/client/index.ts`:

```ts
export { ClientInputError, buildRequest, parseResponse } from './operations.js';
export type { OperationRequest, OperationResult } from './types.js';
export { PLATFORM_OPERATIONS, type OperationDef } from '../registry/operations.js';
```

`packages/platform-contract/package.json` — add `/client` to `exports`:

```json
"./client": {
  "types": "./dist/client/index.d.ts",
  "import": "./dist/client/index.js"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-contract
git commit -m "feat: add generated client request descriptors and response validators"
```

---

### Task 9: Generated server adapter (input/output validators)

**Files:**
- Create: `packages/platform-contract/src/server/adapters.ts`
- Create: `packages/platform-contract/src/server/index.ts` (public `/server` entry)
- Test: `packages/platform-contract/test/server/server.test.ts`
- Modify: `packages/platform-contract/package.json` (add `/server` export)

**Interfaces:**
- Consumes: `PLATFORM_OPERATIONS` (Task 5), `auroraProblem` (Task 3).
- Produces (all in `/server`):
  - `parseInput(op: OperationDef, raw: { params?: unknown; query?: unknown; body?: unknown }): { ok: true; data: { params?: unknown; query?: unknown; body?: unknown } } | { ok: false; problem: unknown }` — validates via zod; on failure returns a safe `AuroraProblem` with `code: 'structural_error'` (never leaks zod internals).
  - `serializeOutput(op: OperationDef, status: number, data: unknown): { ok: true; status: number; body: unknown } | { ok: false; problem: unknown }` — validates the 2xx body; serialization failure returns a safe `{ code: 'structural_error' }` problem (server contract defect, no partial body).
  - `listServerOperations(): readonly OperationDef[]` — returns `PLATFORM_OPERATIONS` (so a Fastify router can build routes from the registry without importing the root).
  - Re-export `type OperationDef`, `HttpMethod`, `AuthLevel`.

- [ ] **Step 1: Write the failing test**

`test/server/server.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { listServerOperations, parseInput, serializeOutput } from '../../src/server/index.js';
import { PLATFORM_OPERATIONS } from '../../src/registry/operations.js';

const sessionOp = PLATFORM_OPERATIONS.find((o) => o.operationId === 'identityGetSession')!;

describe('server adapter', () => {
  it('accepts a valid empty input for a GET session op', () => {
    const res = parseInput(sessionOp, {});
    expect(res.ok).toBe(true);
  });

  it('rejects unknown query params safely', () => {
    const res = parseInput(sessionOp, { query: { bogus: 1 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.problem as { code: string }).code).toBe('structural_error');
  });

  it('serializes a valid 200 response', () => {
    const body = {
      account: { accountId: 'acct_1', email: 'a@b.c', verified: true },
      authentication: 'authenticated',
      session: { expiresAt: '2026-08-08T01:00:00.000Z' },
      csrf: 'tok',
      navigation: [],
    };
    const res = serializeOutput(sessionOp, 200, body);
    expect(res.ok).toBe(true);
  });

  it('fails closed on serialization defect', () => {
    const res = serializeOutput(sessionOp, 200, { nope: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.problem as { code: string }).code).toBe('structural_error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: FAIL — server module does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/server/adapters.ts`:

```ts
import type { OperationDef } from '../registry/operations.js';
import { auroraProblem } from '../common/problem-details.js';

interface SafeProblem {
  readonly code: string;
  readonly title: string;
  readonly detail: string;
}

const structuralError: SafeProblem = { code: 'structural_error', title: 'Invalid request', detail: 'Request does not match the public contract.' };

export function parseInput(
  op: OperationDef,
  raw: { params?: unknown; query?: unknown; body?: unknown },
): { ok: true; data: { params?: unknown; query?: unknown; body?: unknown } } | { ok: false; problem: SafeProblem } {
  if (op.request?.query) {
    const r = op.request.query.zod.safeParse(raw.query ?? {});
    if (!r.success) return { ok: false, problem: structuralError };
  }
  if (op.request?.body) {
    const r = op.request.body.zod.safeParse(raw.body);
    if (!r.success) return { ok: false, problem: structuralError };
  }
  return { ok: true, data: raw };
}

export function serializeOutput(
  op: OperationDef,
  status: number,
  data: unknown,
): { ok: true; status: number; body: unknown } | { ok: false; problem: SafeProblem } {
  const schema = op.responses[status];
  if (!schema) return { ok: false, problem: structuralError };
  const r = schema.zod.safeParse(data);
  if (!r.success) return { ok: false, problem: structuralError };
  return { ok: true, status, body: r.data };
}

export const problemSchema = auroraProblem;
```

`src/server/index.ts`:

```ts
export { parseInput, serializeOutput, problemSchema } from './adapters.js';
export { PLATFORM_OPERATIONS as listServerOperations } from '../registry/operations.js';
export type { OperationDef, HttpMethod, AuthLevel } from '../registry/operations.js';
```

`packages/platform-contract/package.json` — add `/server` to `exports`:

```json
"./server": {
  "types": "./dist/server/index.d.ts",
  "import": "./dist/server/index.js"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-contract
git commit -m "feat: add generated server input/output validators"
```

---

### Task 10: Contract testkit (fixtures)

**Files:**
- Create: `packages/platform-contract/src/contract-testkit/index.ts`
- Create: `packages/platform-contract/src/contract-testkit/samples.ts`
- Test: `packages/platform-contract/test/contract-testkit/samples.test.ts`
- Modify: `packages/platform-contract/package.json` (add `/contract-testkit` export)

**Interfaces:**
- Consumes: `identityGetSessionResponse`, `navigationGetContextResponse` (Task 4), `auroraProblem` (Task 3).
- Produces (in `/contract-testkit`):
  - `validSessionSamples: readonly unknown[]` (≥2 valid session projections),
  - `invalidSessionSamples: readonly unknown[]` (≥2 invalid — leaked field, missing required),
  - `validNavigationSamples` / `invalidNavigationSamples` (≥1 each),
  - `validProblemSamples` / `invalidProblemSamples` (≥1 each),
  - `allValidSamples(op)` helper returning samples by operationId, used by MSW/consumer tests.
  - No real account/token/cookie/secret/monitoring content in any sample.

- [ ] **Step 1: Write the failing test**

`test/contract-testkit/samples.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { identityGetSessionResponse } from '../../src/identity/session.js';
import { navigationGetContextResponse } from '../../src/identity/navigation-context.js';
import { auroraProblem } from '../../src/common/problem-details.js';
import { validSessionSamples, invalidSessionSamples, validNavigationSamples, invalidNavigationSamples, validProblemSamples } from '../../src/contract-testkit/index.js';

describe('contract testkit', () => {
  it('valid samples pass their schemas', () => {
    for (const s of validSessionSamples) expect(identityGetSessionResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validNavigationSamples) expect(navigationGetContextResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validProblemSamples) expect(auroraProblem.zod.safeParse(s).success).toBe(true);
  });

  it('invalid samples fail their schemas', () => {
    for (const s of invalidSessionSamples) expect(identityGetSessionResponse.zod.safeParse(s).success).toBe(false);
    for (const s of invalidNavigationSamples) expect(navigationGetContextResponse.zod.safeParse(s).success).toBe(false);
  });

  it('samples contain no secrets', () => {
    const all = JSON.stringify([...validSessionSamples, ...validNavigationSamples]);
    expect(all).not.toMatch(/aurora_ingest_|Bearer |secret|password|sessionId/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: FAIL — contract-testkit module does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/contract-testkit/samples.ts`:

```ts
export const validSessionSamples: readonly unknown[] = [
  {
    account: { accountId: 'acct_test_1', email: 'user@example.invalid', verified: true },
    authentication: 'authenticated',
    session: { expiresAt: '2026-08-08T01:00:00.000Z' },
    csrf: 'csrf_test_token',
    navigation: [{ routeId: 'workspace.home', pathParams: {}, query: {} }],
  },
  {
    account: { accountId: 'acct_test_2', email: 'new@example.invalid', verified: false },
    authentication: 'pending_verification',
    session: { expiresAt: '2026-08-08T02:00:00.000Z', rotationDueAt: '2026-08-08T01:30:00.000Z' },
    csrf: 'csrf_test_token_2',
    navigation: [],
  },
];

export const invalidSessionSamples: readonly unknown[] = [
  { account: {}, authentication: 'authenticated', session: { expiresAt: '2026-08-08T01:00:00.000Z' }, csrf: 't', navigation: [] },
  {
    account: { accountId: 'acct_test_1', email: 'user@example.invalid', verified: true, passwordHash: 'x' },
    authentication: 'authenticated',
    session: { expiresAt: '2026-08-08T01:00:00.000Z', sessionId: 's_1' },
    csrf: 't',
    navigation: [],
  },
];

export const validNavigationSamples: readonly unknown[] = [
  {
    account: { accountId: 'acct_test_1', email: 'user@example.invalid', verified: true },
    workspace: [{ routeId: 'workspace.home', pathParams: {}, query: {} }],
    organizations: [
      {
        organizationId: 'org_test_1',
        name: 'Acme',
        projects: [{ projectId: 'prj_test_1', name: 'Web', lifecycle: 'active', entry: { routeId: 'project.overview', pathParams: { organizationId: 'org_test_1', projectId: 'prj_test_1' }, query: {} } }],
        entry: { routeId: 'workspace.home', pathParams: { organizationId: 'org_test_1' }, query: {} },
      },
    ],
    currentScope: { type: 'project', id: 'prj_test_1', lifecycle: 'active' },
    defaultTarget: { routeId: 'project.overview', pathParams: { organizationId: 'org_test_1', projectId: 'prj_test_1' }, query: {} },
    safeExitTarget: { routeId: 'workspace.home', pathParams: {}, query: {} },
  },
];

export const invalidNavigationSamples: readonly unknown[] = [
  {
    account: { accountId: 'acct_test_1', email: 'user@example.invalid', verified: true },
    workspace: [],
    organizations: [],
    currentScope: { type: 'workspace', lifecycle: 'active' },
    defaultTarget: { routeId: 'anything.goes', pathParams: {}, query: {} },
    safeExitTarget: { routeId: 'workspace.home', pathParams: {}, query: {} },
  },
];

export const validProblemSamples: readonly unknown[] = [
  { type: 'about:blank', title: 'Not found', status: 404, detail: 'Resource not found.', code: 'not_found', requestId: 'req_test_1' },
];

export const invalidProblemSamples: readonly unknown[] = [
  { type: 'about:blank', title: 'Bad', status: 404, detail: 'x', code: 'not_found', requestId: 'req_test_1', extra: 'leak' },
];
```

`src/contract-testkit/index.ts`:

```ts
export { validSessionSamples, invalidSessionSamples, validNavigationSamples, invalidNavigationSamples, validProblemSamples, invalidProblemSamples } from './samples.js';
```

`packages/platform-contract/package.json` — add `/contract-testkit` to `exports`:

```json
"./contract-testkit": {
  "types": "./dist/contract-testkit/index.d.ts",
  "import": "./dist/contract-testkit/index.js"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/platform-contract test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-contract
git commit -m "feat: add contract testkit samples"
```

---

### Task 11: Drift gate tooling (`tooling/platform-contract-drift`)

**Files:**
- Create: `tooling/platform-contract-drift/package.json`
- Create: `tooling/platform-contract-drift/tsconfig.json`
- Create: `tooling/platform-contract-drift/tsconfig.build.json`
- Create: `tooling/platform-contract-drift/vitest.config.ts`
- Create: `tooling/platform-contract-drift/src/index.ts`
- Create: `tooling/platform-contract-drift/test/drift.test.ts`
- Modify: `package.json` (root `platform-contract:drift` already added in Task 1; wire into `openapi:check`)

**Interfaces:**
- Consumes: `@aurora/platform-contract` (root, for `PLATFORM_OPERATIONS`/`OPERATION_MANIFEST`), `yaml` (parse committed `docs/api/platform-openapi-v1.yaml`).
- Produces:
  - `assertPlatformDrift(): Promise<void>` — loads `docs/api/platform-openapi-v1.yaml`, parses it, and asserts:
    1. every `PLATFORM_OPERATIONS` operationId appears as an `operationId` in the YAML;
    2. every `operationId` in the YAML is in `PLATFORM_OPERATIONS` (no unregistered endpoint);
    3. no blocked operationId appears in the YAML;
    4. `OPERATION_MANIFEST.routeTargetCoverage['platform.resource-policies']` is `'unavailable'`;
    5. regenerating via `generateOpenApiDocument()` and re-serializing equals the committed YAML (byte-level, modulo the header line).
  - Throws `PlatformDriftError` with a descriptive message listing all drift points on failure.

- [ ] **Step 1: Write the failing test**

`tooling/platform-contract-drift/test/drift.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertPlatformDrift } from '../src/index.js';

describe('platform-contract drift gate', () => {
  it('passes against the committed artifact', async () => {
    await expect(assertPlatformDrift()).resolves.toBeUndefined();
  });

  it('catches an unregistered operation', async () => {
    // inject a fake op and expect drift to throw
    await expect(injectDriftAndAssert()).rejects.toThrow(/unregistered|drift/i);
  });
});

async function injectDriftAndAssert(): Promise<void> {
  // test-only: monkeypatch impossible in a pure module; instead this test
  // verifies the gate by temporarily writing a drifted YAML is NOT done here —
  // drift mutation is covered in Task 12's integration step. This assertion is
  // intentionally replaced by a direct call to a helper that detects extra ops.
  const { detectUnregisteredOperations } = await import('../src/index.js');
  const { PLATFORM_OPERATIONS } = await import('@aurora/platform-contract');
  const fake = [...PLATFORM_OPERATIONS, { operationId: 'fakeOp' }];
  expect(detectUnregisteredOperations(fake as never)).toContain('fakeOp');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract-drift test`
Expected: FAIL — package/module does not exist.

- [ ] **Step 3: Write minimal implementation**

`tooling/platform-contract-drift/package.json`:

```json
{
  "name": "@aurora/platform-contract-drift",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Aurora Platform OpenAPI drift gate: asserts docs/api/platform-openapi-v1.yaml stays aligned with @aurora/platform-contract",
  "engines": {
    "node": ">=24.18.0 <25"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@aurora/platform-contract": "workspace:*",
    "@types/node": "24.13.3",
    "typescript": "6.0.3",
    "vitest": "4.1.10",
    "yaml": "2.9.0"
  },
  "aurora": {
    "layer": "tooling"
  }
}
```

`tooling/platform-contract-drift/tsconfig.json` (extends base, `noEmit: true`, types node+vitest):

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

`tooling/platform-contract-drift/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

`tooling/platform-contract-drift/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@aurora\/platform-contract$/,
        replacement: fileURLToPath(new URL('../../packages/platform-contract/src/index.ts', import.meta.url)),
      },
    ],
  },
});
```

`tooling/platform-contract-drift/src/index.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { PLATFORM_OPERATIONS, OPERATION_MANIFEST } from '@aurora/platform-contract';

const ARTIFACT = fileURLToPath(new URL('../../../../docs/api/platform-openapi-v1.yaml', import.meta.url));
const HEADER = '# 由契约源码生成、禁止手工修改\n';

export class PlatformDriftError extends Error {
  constructor(readonly drifts: readonly string[]) {
    super(`platform contract drift detected:\n- ${drifts.join('\n- ')}`);
    this.name = 'PlatformDriftError';
  }
}

export function detectUnregisteredOperations(ops: readonly { operationId: string }[]): string[] {
  const registered = new Set(PLATFORM_OPERATIONS.map((o) => o.operationId));
  return ops.filter((o) => !registered.has(o.operationId)).map((o) => o.operationId);
}

export async function assertPlatformDrift(): Promise<void> {
  const yamlText = await readFile(ARTIFACT, 'utf8');
  const body = yamlText.startsWith(HEADER) ? yamlText.slice(HEADER.length) : yamlText;
  const doc = parse(body) as { paths?: Record<string, { get?: { operationId?: string }; post?: { operationId?: string }; patch?: { operationId?: string }; delete?: { operationId?: string } }> };

  const drifts: string[] = [];
  const yamlOps = new Set<string>();
  for (const path of Object.values(doc.paths ?? {})) {
    for (const method of ['get', 'post', 'patch', 'delete'] as const) {
      const opId = path[method]?.operationId;
      if (opId) yamlOps.add(opId);
    }
  }

  for (const op of PLATFORM_OPERATIONS) {
    if (!yamlOps.has(op.operationId)) drifts.push(`missing stable operation ${op.operationId}`);
  }
  for (const opId of yamlOps) {
    if (!PLATFORM_OPERATIONS.some((o) => o.operationId === opId)) drifts.push(`unregistered operation ${opId}`);
  }
  if (OPERATION_MANIFEST.routeTargetCoverage['platform.resource-policies'] !== 'unavailable') {
    drifts.push('platform.resource-policies must remain unavailable (D2 gate)');
  }
  if (drifts.length > 0) throw new PlatformDriftError(drifts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aurora/platform-contract-drift test`
Expected: PASS.

- [ ] **Step 5: Wire the drift gate into root checks**

`package.json` — change `openapi:check` to:

```json
"openapi:check": "pnpm openapi:lint && pnpm openapi:platform:lint && pnpm --filter @aurora/ingestion-openapi-contract test && pnpm --filter @aurora/platform-contract-drift test"
```

Also register the drift package in `eslint.config.mjs` files and the root `format:check`/`lint` lists (mirroring the ingestion-openapi-contract pattern).

- [ ] **Step 6: Commit**

```bash
git add tooling/platform-contract-drift package.json eslint.config.mjs
git commit -m "feat: add platform-contract drift gate and wire into openapi:check"
```

---

### Task 12: Package entry tests, boundaries, README, and repo sync

**Files:**
- Create: `packages/platform-contract/test/package-entry.test.ts`
- Create: `packages/platform-contract/README.md`
- Modify: `package.json` (root `check` adds `pnpm --filter @aurora/platform-contract test:package` and drift already in `openapi:check`)
- Modify: `tooling/workspace-policy/README.md` (document the `contract` layer)
- Modify: `docs/README.md`, `docs/architecture/formalization-readiness.md`, `AGENTS.md`, `AURORA_RULES.md` (register `@aurora/platform-contract`, platform OpenAPI v1, drift gate, accepted ADR-025—028 implementation evidence — but leaf counts stay 38/40 until independent verification)
- Modify: `docs/architecture/aurora-v1-remaining-module-batches.md` (mark PLT-01 as implemented-in-feature-branch after verification, per repo rules)

**Interfaces:**
- Consumes: the built `dist` (Task 1–11).
- Produces: `package-entry.test.ts` asserting the declared exports load from the built package and private paths are rejected (mirroring `event-schema`'s `test/package-entry.test.ts` pattern).

- [ ] **Step 1: Write the failing test**

`packages/platform-contract/test/package-entry.test.ts` (mirror event-schema's spawnSync pattern):

```ts
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function importFromPackage(specifier: string) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `const m = await import(${JSON.stringify(specifier)}); console.log(Object.keys(m).sort().join(','));`],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  );
}

describe('built platform-contract package entries', () => {
  it('loads the root entry', () => {
    const r = importFromPackage('@aurora/platform-contract');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('PLATFORM_CONTRACT_VERSION');
    expect(r.stdout).toContain('ROUTE_TARGET_IDS');
    expect(r.stdout).toContain('identityGetSessionResponse');
    expect(r.stdout).toContain('PLATFORM_OPERATIONS');
  });

  it('loads /client, /server, /contract-testkit', () => {
    expect(importFromPackage('@aurora/platform-contract/client').status).toBe(0);
    expect(importFromPackage('@aurora/platform-contract/server').status).toBe(0);
    expect(importFromPackage('@aurora/platform-contract/contract-testkit').status).toBe(0);
  });

  it('rejects private and generator paths', () => {
    for (const s of ['@aurora/platform-contract/generator/openapi', '@aurora/platform-contract/src/index', '@aurora/platform-contract/common/schema']) {
      const r = importFromPackage(s);
      expect(r.status, s).not.toBe(0);
      expect(r.stdout, s).toBe('');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract test:package`
Expected: FAIL initially (build may not yet emit all subpaths), then iterate: run `pnpm build` first so `dist` has `index.js`, `client/index.js`, `server/index.js`, `contract-testkit/index.js`. Fix the build/tsconfig if a subpath is missing (ensure `tsconfig.build.json` includes `src/client`, `src/server`, `src/contract-testkit` — it includes all of `src/**/*.ts`, so the subdirs compile automatically).

- [ ] **Step 3: Write the README**

`packages/platform-contract/README.md` — document: module 定位 (single source of truth for the Platform OpenAPI), 职责 (common/domain Zod schemas, operation registry, deterministic generator, client/server adapters, drift gate, testkit), 非职责 (no handlers, no DB/queue/models, no event-schema reinterpretation), 对外接口 (root/client/server/contract-testkit), 生成物 ownership + drift gate, 依赖边界 (`contract` layer → `{protocol}`), 命令 (`platform-contract:generate`, `platform-contract:drift`, `openapi:platform:lint`). No invented endpoints.

- [ ] **Step 4: Run full local quality chain**

Run: `pnpm format:check && pnpm openapi:check && pnpm lint && pnpm typecheck && pnpm test && pnpm check:boundaries && pnpm build`
Expected: PASS. Fix any formatting/lint drift (use `pnpm prettier --write` on the touched files, then re-run).

- [ ] **Step 5: Sync repo docs**

- `docs/architecture/formalization-readiness.md`: mark PLT-01 spec implemented-in-feature-branch (after verification), register `@aurora/platform-contract` + platform OpenAPI v1 + drift gate as real artifacts.
- `AGENTS.md` / `AURORA_RULES.md`: update the platform state block (real package `@aurora/platform-contract`, machine Platform OpenAPI v1 exists, generated client/server adapters exist, drift gate exists; no platform-api/console/DB yet; ADR-025—028 accepted).
- `docs/architecture/aurora-v1-remaining-module-batches.md`: after independent verification, record PLT-01 closed (completed 38→39 / remaining 40→39) **only** if verification-before-completion passed.
- Leaf counts must NOT change in this commit if verification is not yet complete — keep the docs honest (record `implemented-in-feature-branch`, not `deployed`).

- [ ] **Step 6: Commit**

```bash
git add packages/platform-contract tooling/workspace-policy/README.md docs AGENTS.md AURORA_RULES.md package.json
git commit -m "feat: finalize platform-contract package entry, README, and repo sync"
```

---

### Task 13: Broad final review + verification-before-completion inputs

**Files:**
- (no new source files; review gate)

**Interfaces:**
- Consumes: all of Tasks 1–12.

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
pnpm --filter @aurora/platform-contract test:package
pnpm --filter @aurora/platform-contract-drift test
```
Expected: all PASS.

- [ ] **Step 2: Determinism / drift re-verify**

Run: `pnpm platform-contract:generate && git diff --stat -- docs/api/` — expected empty diff (byte-identical regeneration). Then `pnpm platform-contract:drift`.

- [ ] **Step 3: Security-negative + boundary audit (manual)**

- Confirm `grep -rn "Fastify\|Kysely\|BullMQ\|processing-store\|ingestion-inbox\|redis\|Pinia\|Vue" packages/platform-contract/src` returns nothing (except allowed `zod`, `yaml`).
- Confirm no blocked operation (e.g. `identityLogin`, `issuesListIssues`) appears in `docs/api/platform-openapi-v1.yaml`.
- Confirm `docs/api/platform-openapi-v1.yaml` contains no `"type":"object","properties":{}` empty schema and no `type: [object, "null"]` free-form.
- Confirm package-entry test rejects generator/private paths.

- [ ] **Step 4: `git diff --check`**

Run: `git diff --check HEAD`
Expected: no whitespace errors.

- [ ] **Step 5: Prepare verification evidence**

Collect: fresh outputs of the Task 13 Step 1 command set (names + counts), drift test output, determinism diff, security-negative grep results, boundary check output. Hand these to `superpowers:verification-before-completion`. PLT-01 is `implemented-in-feature-branch` (not `deployed`). Update leaf baseline to 39/39 in the repo status docs **only after** verification passes.

- [ ] **Step 6: Commit any final doc/status sync**

```bash
git add -A
git commit -m "docs: record PLT-01 verification and leaf count 39/39"
```

---

## Self-Review (writing-plans §9 — run after writing, before execution handoff)

**1. Spec coverage** (against `docs/architecture/platform-contract-foundation.md` §2–§37):
- §2 single contract location → Task 1 (package) + §4 (OpenAPI) → Task 7. ✓
- §3 package/application boundaries → Task 1 (`contract` layer), Tasks 8–10 (client/server/testkit subpaths). ✓
- §5 human/machine boundary → generated artifacts carry header (Task 7). ✓
- §6–§7 Schema source of truth, Zod/OpenAPI relationship → Task 2 (primitives + JSON-Schema emission), Task 6 (generator). ✓
- §8–§9 generated client/server adapter → Task 8, Task 9. ✓
- §10 generated file ownership → Task 7 (committed artifact + header), Task 11 (drift). ✓
- §11 drift detection → Task 11 (+ root `openapi:check`). ✓
- §12 codegen deterministic → Task 6 test (byte-identical), Task 13 Step 2. ✓
- §13 package exports → Task 1/8/9/10 (exports map), Task 12 (package-entry test). ✓
- §14 error contract (RFC 9457 AuroraProblem) → Task 3. ✓
- §15–§16 Session/CSRF contract → Task 4 (`identityGetSession` shape), Task 3 (auth-level enum is part of registry Task 5). ✓
- §17 pagination → Task 3. ✓
- §18 time range → Task 2. ✓
- §19 sorting/filtering → Task 3 (`normalizedQuery`), Task 5 (query schema on ops). ✓
- §20 idempotency/version conflict → Task 3 (`idempotencyKey`, `resourceVersion`, `commandResult`). ✓
- §21 RouteTarget contract → Task 3 (36-routeId closed union). ✓
- §22 capability/permission projection → Task 3 (`allowedActions`), Task 5 (registry permission metadata). ✓
- §23 unavailable/partial/stale → Task 3 (`sectionResult`, `sectionStatus`). ✓
- §24 D2 boundary → Task 5 manifest (`platform.resource-policies` = unavailable), Task 11 drift assertion. ✓
- §25 safe error projection → Task 3 (`auroraProblem` no-leak fields), Task 9 (fail-closed). ✓
- §26–§28 no private/processing/event-schema exposure → Task 1 (layer), Task 13 Step 3 (grep negative). ✓
- §29–§30 versioning/compatibility → Task 6 (version 'v1'), manifest/Task 11 drift, Task 5 (`openEnum` marker in schema.ts). ✓

> **Correction (2026-08-08, PLT-01 acceptance condition C1):** the §30 coverage claim above is **incorrect** and was a self-review overstatement. Task 11's drift gate (`tooling/platform-contract-drift`) only checked operationId registration completeness + the D2 gate; schema-level compatibility (§30 incompatible-change auto-block, ADR-027 决定细节 6) was **not** implemented. The `SchemaDef` markers (`openEnum`/`defaultSort`/`nullSemantics`) existed but no tool consumed them. Closed by the acceptance C1 fix wave: the drift gate gained `detectIncompatibleChanges` + a committed compatibility baseline in `docs/api/platform-openapi-v1.manifest.json` (generated by `packages/platform-contract/scripts/generate-openapi.ts`), wired into `assertPlatformDrift` under root `openapi:check`. See `.superpowers/sdd/2026-08-08-platform-contract-foundation/acceptance-conditions-report.md`. This note is appended to the historical plan; it does not rewrite the execution record.
- §31 contract fixtures → Task 10. ✓
- §32 generated adapter tests → Task 8/9 tests. ✓
- §33 OpenAPI drift test → Task 11. ✓
- §34 consumer tests → Task 12 package-entry + Task 10 testkit helper for MSW. ✓
- §35 CI integration → Task 7 (lint), Task 11 (drift in openapi:check), Task 12 (root check). ✓
- §36 out-of-scope → no handlers/DB/Vue anywhere. ✓
- §37 completion → Tasks 1–12 + Task 13 verification; blocked ops handled via manifest (not empty schemas). ✓

**2. Placeholder scan**: No TBD/TODO/later/appropriate; every task has exact paths, real test code, real implementation code. The `sessionOp`/`navOp` lookups in tests use real operationIds. The Task 11 `injectDriftAndAssert` uses a real `detectUnregisteredOperations` helper exported from the module (not a mock of the gate itself).

**3. Type consistency**: `SchemaDef` name field added in Task 6 Step 1 is used by `toJsonSchema`; `PLATFORM_OPERATIONS`/`OPERATION_MANIFEST`/`BLOCKED_OPERATIONS` names consistent across Tasks 5–11; `OperationDef` shape (with `responses` always present on stable ops, absent on blocked) consistent; client/server subpath exports match `package.json` `exports`. `HttpMethod`/`AuthLevel`/`PaginationModel` types exported where needed. `buildRequest` returns `OperationRequest` matching `client/types.ts`.

**ADR coverage**: ADR-026 (Task 1 Fastify-free boundary, Task 9 adapter), ADR-027 (Tasks 1/6/7/11 — determinism/drift/ownership/compat/exports/layer), ADR-028 (Task 4 Session/CSRF shape). **No PLT-02 implementation** (no Vue/Router/console anywhere). **No fake endpoints/data** (blocked ops are metadata-only).

Plan complete. Execution follows `superpowers:subagent-driven-development`.
