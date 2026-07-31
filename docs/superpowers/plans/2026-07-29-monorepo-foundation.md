# Private Monorepo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Aurora’s private pnpm Workspace, reproducible local toolchain, stable quality commands, and a tested internal Workspace boundary checker without creating any business module.

**Architecture:** A private root package owns cross-platform command entrypoints and exact tool versions. One real internal package, `@aurora/workspace-policy`, discovers direct Workspace packages, validates manifest and import boundaries, detects cycles, and exposes both a typed API and a deterministic CLI. Root commands use native pnpm scripts; no task orchestrator, remote cache, CI workflow, release system, or business package is introduced.

**Tech Stack:** Node.js 24.18.0 LTS, pnpm 11.17.0, TypeScript 6.0.3, ESLint 10.8.0, typescript-eslint 8.65.0, Vitest 4.1.10, Prettier 3.9.6, tsx 4.23.1.

## Global Constraints

- Implement only the private root Workspace and `tooling/workspace-policy`; do not create `apps/*`, `packages/*`, `examples/*`, `event-schema`, SDK, service, frontend, CI, release, container, IaC, or cloud files.
- Keep the root package and `@aurora/workspace-policy` private; this plan produces no publishable artifact.
- Pin `.node-version` and pnpm `nodeVersion` to `24.18.0`; set `engines.node` to `>=24.18.0 <25` and `packageManager` to `pnpm@11.17.0`.
- Commit one `pnpm-lock.yaml`; every automated install uses `pnpm install --frozen-lockfile`.
- Use `workspace:*` for every local Workspace dependency; reject undeclared, cyclic, and private-path imports.
- Keep `strictDepBuilds: true`; approve only `esbuild: true` in `allowBuilds`; never enable `dangerouslyAllowAllBuilds`.
- Keep `format:check`, `lint`, `typecheck`, `test`, `check:boundaries`, `build`, `check`, and `check:ci` non-interactive and cross-platform.
- `check:ci` is only a local command contract for a separate CI module; do not create `.github/workflows`.
- Follow TDD in every task and preserve all pre-existing documentation changes, especially `Aurora 文档规范.md`.
- Do not change any ADR to `implemented` without the final full verification in Task 5; ADR-001 and ADR-006 remain `in-progress` because future real modules must extend their coverage, while ADR-007 may become `implemented` after all Task 5 gates pass.

---

## Planned File Responsibilities

| File | Responsibility |
|---|---|
| `package.json` | Private root manifest, exact package-manager/runtime contract, and stable root command interface |
| `pnpm-workspace.yaml` | Workspace globs, Node/install safety settings, cycle policy, and explicit dependency build approval |
| `pnpm-lock.yaml` | Sole reproducible dependency lock |
| `.node-version` | Machine-readable exact Node.js pin |
| `.editorconfig` | Cross-platform text defaults for newly managed engineering files |
| `.gitignore` | Ignore dependency, build, coverage, cache, and local environment artifacts |
| `.prettierrc.json` | Formatting rules for this module’s managed files |
| `.prettierignore` | Exclude generated, dependency, historical design, and append-only governance material from bulk formatting |
| `eslint.config.mjs` | Strict typed ESLint configuration for the internal TypeScript tool |
| `tsconfig.base.json` | Shared strict TypeScript compiler baseline |
| `tooling/workspace-policy/package.json` | Private internal package manifest and package-level commands |
| `tooling/workspace-policy/tsconfig.json` | No-emit typecheck/test configuration |
| `tooling/workspace-policy/tsconfig.build.json` | Production build configuration for the internal CLI/library |
| `tooling/workspace-policy/src/types.ts` | Public immutable policy result and violation types |
| `tooling/workspace-policy/src/discover.ts` | Direct Workspace package discovery and safe manifest parsing |
| `tooling/workspace-policy/src/manifest.ts` | Required-field, package-name, local-range, and dependency-map rules |
| `tooling/workspace-policy/src/imports.ts` | TypeScript import/export specifier extraction |
| `tooling/workspace-policy/src/graph.ts` | Local dependency graph, cycle, declaration, and private export validation |
| `tooling/workspace-policy/src/check-workspace.ts` | Top-level `checkWorkspace(rootDir)` orchestration |
| `tooling/workspace-policy/src/format.ts` | Stable, secret-free violation formatting |
| `tooling/workspace-policy/src/cli.ts` | Exact `--root <path>` CLI and exit-code contract |
| `tooling/workspace-policy/src/index.ts` | Public exports for the internal package |
| `tooling/workspace-policy/test/fixtures.ts` | Temporary Workspace fixture builder; never creates committed business packages |
| `tooling/workspace-policy/test/root-contract.test.ts` | Root version, scripts, globs, and supply-chain configuration contract |
| `tooling/workspace-policy/test/manifest-policy.test.ts` | Package-name, required-field, and `workspace:*` tests |
| `tooling/workspace-policy/test/dependency-policy.test.ts` | Undeclared, cyclic, private-path, and exported-subpath tests |
| `tooling/workspace-policy/test/cli.test.ts` | Exit code, stdout/stderr, ordering, argument, and path tests |
| `tooling/workspace-policy/test/documentation-contract.test.ts` | Root/module documentation links and ADR implementation-state evidence |
| `tooling/workspace-policy/README.md` | Real module responsibilities, interfaces, commands, failure semantics, and authority links |
| `README.md` | Replace the “no commands exist” statement with verified bootstrap/quality commands after implementation |
| `docs/README.md` | Link the real internal module and its formal authority without copying details |
| `docs/architecture/monorepo-and-build.md` | Record actual implementation evidence and exact verification output |
| `docs/architecture/formalization-readiness.md` | Mark only this module implemented and keep every downstream module blocked by its own inputs |
| `docs/adr/ADR-001-use-monorepo.md` | Append `in-progress` implementation evidence after the Workspace exists |
| `docs/adr/ADR-006-one-way-dependencies.md` | Append `in-progress` implementation evidence for the initial universal checks |
| `docs/adr/ADR-007-workspace-package-and-task-tooling.md` | Append `implemented` evidence only after every Task 5 gate passes |
| `AGENTS.md` / `AURORA_RULES.md` | Update the operational snapshot with real commands and accurate ADR implementation states |

### Task 1: Reproducible root Workspace contract

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `pnpm-lock.yaml`
- Create: `.node-version`
- Create: `.editorconfig`
- Create: `.gitignore`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `eslint.config.mjs`
- Create: `tsconfig.base.json`
- Create: `tooling/workspace-policy/package.json`
- Create: `tooling/workspace-policy/tsconfig.json`
- Create: `tooling/workspace-policy/tsconfig.build.json`
- Create: `tooling/workspace-policy/test/root-contract.test.ts`

**Interfaces:**
- Consumes: accepted ADR-001, ADR-006, ADR-007 and `docs/architecture/monorepo-and-build.md` sections 4—7.
- Produces: exact Node/pnpm/tool versions, one lock file, root script names, `@aurora/workspace-policy` package identity, and a runnable Vitest harness used by Tasks 2—5.

- [ ] **Step 1: Add the minimal package-manager and test-runner bootstrap**

Create the initial root `package.json`:

```json
{
  "name": "@aurora/root",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.17.0",
  "engines": {
    "node": ">=24.18.0 <25"
  },
  "scripts": {
    "test": "pnpm --filter @aurora/workspace-policy test"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "eslint": "10.8.0",
    "prettier": "3.9.6",
    "tsx": "4.23.1",
    "typescript-eslint": "8.65.0"
  }
}
```

Create the initial `pnpm-workspace.yaml` before installation:

```yaml
packages:
  - apps/*
  - packages/*
  - examples/*
  - tooling/*

nodeVersion: 24.18.0
engineStrict: true
strictPeerDependencies: true
strictDepBuilds: true
allowBuilds:
  esbuild: true
minimumReleaseAge: 1440
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
blockExoticSubdeps: true
trustLockfile: false
verifyDepsBeforeRun: error
linkWorkspacePackages: false
disallowWorkspaceCycles: true
```

Create `tooling/workspace-policy/package.json`:

```json
{
  "name": "@aurora/workspace-policy",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Aurora private Workspace boundary validator",
  "engines": {
    "node": ">=24.18.0 <25"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "bin": {
    "aurora-check-workspace": "./dist/cli.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "typescript": "6.0.3",
    "vitest": "4.1.10"
  },
  "aurora": {
    "layer": "tooling"
  }
}
```

- [ ] **Step 2: Activate the pinned toolchain and create the first lock file**

Run:

```powershell
node --version
corepack enable pnpm
corepack use pnpm@11.17.0
pnpm --version
pnpm install
```

Expected: before activation, `node --version` must be `v24.18.0`; stop if it is not. After activation, pnpm prints `11.17.0`, install succeeds with only `esbuild` approved to run an install script, and one `pnpm-lock.yaml` is created. No `apps`, `packages`, or `examples` directory is created.

- [ ] **Step 3: Write the failing root contract test**

Create `tooling/workspace-policy/test/root-contract.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = fileURLToPath(new URL('../../../', import.meta.url));

async function readRootFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('root Workspace contract', () => {
  it('pins Node and pnpm exactly', async () => {
    const parsed: unknown = JSON.parse(await readRootFile('package.json'));
    if (!isRecord(parsed)) throw new TypeError('Root package.json must be an object');
    const engines = isRecord(parsed.engines) ? parsed.engines : {};

    await expect(readRootFile('.node-version')).resolves.toBe('24.18.0\n');
    expect(parsed.packageManager).toBe('pnpm@11.17.0');
    expect(engines.node).toBe('>=24.18.0 <25');
    expect(rootDir.endsWith('Aurora')).toBe(true);
  });

  it('declares every stable root command', async () => {
    const parsed: unknown = JSON.parse(await readRootFile('package.json'));
    if (!isRecord(parsed) || !isRecord(parsed.scripts)) {
      throw new TypeError('Root package.json scripts must be an object');
    }
    expect(Object.keys(parsed.scripts).sort()).toEqual([
      'build',
      'check',
      'check:boundaries',
      'check:ci',
      'format:check',
      'lint',
      'test',
      'typecheck',
    ]);
  });

  it('keeps Workspace and dependency execution policies explicit', async () => {
    const workspace = await readRootFile('pnpm-workspace.yaml');
    expect(workspace).toContain('nodeVersion: 24.18.0');
    expect(workspace).toContain('strictDepBuilds: true');
    expect(workspace).toContain('allowBuilds:\n  esbuild: true');
    expect(workspace).toContain('dangerouslyAllowAllBuilds: true');
    expect(workspace).not.toContain('dangerouslyAllowAllBuilds: true');
    for (const pattern of ['apps/*', 'packages/*', 'examples/*', 'tooling/*']) {
      expect(workspace).toContain(`- ${pattern}`);
    }
  });
});
```

The deliberately contradictory `dangerouslyAllowAllBuilds` assertion is the red test; remove only the positive assertion during the implementation step.

- [ ] **Step 4: Run the root test and confirm the intended failures**

Run: `pnpm --filter @aurora/workspace-policy exec vitest run test/root-contract.test.ts`

Expected: FAIL because `.node-version` and the complete root scripts do not exist, and because the test deliberately expects the forbidden global build-script setting.

- [ ] **Step 5: Implement the complete root contract**

Replace the root scripts in `package.json` with:

```json
{
  "format:check": "prettier --check package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json tooling/workspace-policy/package.json tooling/workspace-policy/tsconfig.json tooling/workspace-policy/tsconfig.build.json \"tooling/workspace-policy/src/**/*.ts\" \"tooling/workspace-policy/test/**/*.ts\" tooling/workspace-policy/README.md README.md docs/architecture/monorepo-and-build.md",
  "lint": "eslint tooling/workspace-policy/src tooling/workspace-policy/test",
  "typecheck": "pnpm --filter @aurora/workspace-policy typecheck",
  "test": "pnpm --filter @aurora/workspace-policy test",
  "check:boundaries": "tsx tooling/workspace-policy/src/cli.ts --root .",
  "build": "pnpm --filter @aurora/workspace-policy build",
  "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm check:boundaries && pnpm build",
  "check:ci": "pnpm check"
}
```

Keep the rest of the root manifest from Step 1. Create `.node-version` with exactly:

```text
24.18.0
```

Create `.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.vitest/
.pnpm-store/
*.tsbuildinfo
.env
.env.*
!.env.example
```

Create `.prettierrc.json`:

```json
{
  "arrowParens": "always",
  "endOfLine": "lf",
  "printWidth": 100,
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "all",
  "useTabs": false
}
```

Create `.prettierignore`:

```text
node_modules
dist
coverage
docs/superpowers/specs
docs/superpowers/plans
AGENTS.md
AURORA_RULES.md
Aurora 架构规范.md
Aurora 代码规范.md
Aurora 测试规范.md
Aurora 文档规范.md
Aurora ADR 规范.md
Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,
    "declaration": true,
    "declarationMap": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "lib": ["ES2024"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "resolveJsonModule": true,
    "strict": true,
    "target": "ES2024",
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true
  }
}
```

Create `tooling/workspace-policy/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Create `tooling/workspace-policy/tsconfig.build.json`:

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
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test/**/*.ts"]
}
```

Create `eslint.config.mjs`:

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/coverage/**', '**/dist/**', '**/node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['tooling/workspace-policy/**/*.ts'],
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
);
```

Remove the deliberately positive `dangerouslyAllowAllBuilds` expectation from `root-contract.test.ts`; retain the negative assertion.

- [ ] **Step 6: Verify the root contract and frozen install**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/root-contract.test.ts
pnpm install --frozen-lockfile
git diff --exit-code -- pnpm-lock.yaml
```

Expected: the test PASSes; frozen install exits 0; the lock-file diff command exits 0. If the lock file was newly created and therefore untracked, first record its SHA-256 with `Get-FileHash pnpm-lock.yaml -Algorithm SHA256`, run frozen install again, and confirm the hash is unchanged.

- [ ] **Step 7: Commit the reproducible Workspace contract**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .node-version .editorconfig .gitignore .prettierrc.json .prettierignore eslint.config.mjs tsconfig.base.json tooling/workspace-policy/package.json tooling/workspace-policy/tsconfig.json tooling/workspace-policy/tsconfig.build.json tooling/workspace-policy/test/root-contract.test.ts
git commit -m "build: establish reproducible pnpm workspace"
```

### Task 2: Package discovery and manifest policy

**Files:**
- Create: `tooling/workspace-policy/src/types.ts`
- Create: `tooling/workspace-policy/src/discover.ts`
- Create: `tooling/workspace-policy/src/manifest.ts`
- Create: `tooling/workspace-policy/src/check-workspace.ts`
- Create: `tooling/workspace-policy/src/index.ts`
- Create: `tooling/workspace-policy/test/fixtures.ts`
- Create: `tooling/workspace-policy/test/manifest-policy.test.ts`

**Interfaces:**
- Consumes: Task 1’s `@aurora/workspace-policy` package and Workspace globs.
- Produces: `WorkspaceViolationCode`, `WorkspaceViolation`, `WorkspaceCheckResult`, `WorkspacePackage`, `discoverWorkspacePackages(rootDir)`, `dependencyMap(manifest)`, `manifestViolations(package, localNames)`, and the first working `checkWorkspace(rootDir)` implementation. Task 3 extends `checkWorkspace` without changing its signature.

- [ ] **Step 1: Write fixture helpers and failing manifest tests**

Create `tooling/workspace-policy/test/fixtures.ts`:

```ts
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FixturePackage {
  readonly directory: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly files?: Readonly<Record<string, string>>;
}

export interface WorkspaceFixture {
  readonly rootDir: string;
  readonly dispose: () => Promise<void>;
}

export function validManifest(name: string): Record<string, unknown> {
  return {
    name,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: { '.': './src/index.ts' },
    files: ['dist'],
    engines: { node: '>=24.18.0 <25' },
    scripts: { build: 'tsc -p tsconfig.build.json', test: 'vitest run' },
    aurora: { layer: 'tooling' },
  };
}

export async function createWorkspaceFixture(
  packages: readonly FixturePackage[],
): Promise<WorkspaceFixture> {
  const rootDir = await mkdtemp(join(tmpdir(), 'aurora-workspace-policy-'));
  await writeFile(
    join(rootDir, 'pnpm-workspace.yaml'),
    ['packages:', '  - apps/*', '  - packages/*', '  - examples/*', '  - tooling/*', ''].join('\n'),
    'utf8',
  );

  for (const fixturePackage of packages) {
    const packageDir = join(rootDir, fixturePackage.directory);
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, 'package.json'),
      `${JSON.stringify(fixturePackage.manifest, null, 2)}\n`,
      'utf8',
    );
    for (const [relativePath, content] of Object.entries(fixturePackage.files ?? {})) {
      const filePath = join(packageDir, relativePath);
      await mkdir(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, content, 'utf8');
    }
  }

  return {
    rootDir,
    dispose: () => rm(rootDir, { force: true, recursive: true }),
  };
}
```

Create `tooling/workspace-policy/test/manifest-policy.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { checkWorkspace } from '../src/check-workspace.js';
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
  validManifest,
} from './fixtures.js';

let fixture: WorkspaceFixture | undefined;

afterEach(async () => fixture?.dispose());

describe('Workspace manifest policy', () => {
  it('accepts an empty Workspace and a valid private tooling package', async () => {
    fixture = await createWorkspaceFixture([
      {
        directory: 'tooling/workspace-policy',
        manifest: validManifest('@aurora/workspace-policy'),
      },
    ]);

    await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({ ok: true, violations: [] });
  });

  it('reports invalid names and every missing required field', async () => {
    fixture = await createWorkspaceFixture([
      { directory: 'packages/bad', manifest: { name: 'bad name' } },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.ok).toBe(false);
    expect(result.violations.map(({ code }) => code)).toEqual([
      'invalid-package-name',
      'missing-package-field',
      'missing-package-field',
      'missing-package-field',
      'missing-package-field',
      'missing-package-field',
      'missing-package-field',
    ]);
  });

  it('requires workspace protocol for local dependencies', async () => {
    const consumer = validManifest('@aurora/consumer');
    consumer.dependencies = { '@aurora/provider': '0.0.0' };
    fixture = await createWorkspaceFixture([
      { directory: 'tooling/consumer', manifest: consumer },
      { directory: 'tooling/provider', manifest: validManifest('@aurora/provider') },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toMatchObject([
      {
        code: 'non-workspace-local-dependency',
        packageName: '@aurora/consumer',
        dependency: '@aurora/provider',
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the manifest test and verify the missing-module failure**

Run: `pnpm --filter @aurora/workspace-policy exec vitest run test/manifest-policy.test.ts`

Expected: FAIL with module-not-found for `../src/check-workspace.js`.

- [ ] **Step 3: Implement public types, discovery, and manifest checks**

Create `tooling/workspace-policy/src/types.ts`:

```ts
export type WorkspaceViolationCode =
  | 'invalid-package-name'
  | 'missing-package-field'
  | 'non-workspace-local-dependency'
  | 'undeclared-dependency'
  | 'dependency-cycle'
  | 'private-path-import';

export interface WorkspaceViolation {
  readonly code: WorkspaceViolationCode;
  readonly packageName: string;
  readonly file?: string;
  readonly dependency?: string;
  readonly message: string;
}

export interface WorkspaceCheckResult {
  readonly ok: boolean;
  readonly violations: readonly WorkspaceViolation[];
}

export interface PackageManifest {
  readonly name?: unknown;
  readonly private?: unknown;
  readonly type?: unknown;
  readonly exports?: unknown;
  readonly files?: unknown;
  readonly engines?: unknown;
  readonly scripts?: unknown;
  readonly aurora?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly peerDependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly [key: string]: unknown;
}

export interface WorkspacePackage {
  readonly directory: string;
  readonly manifestPath: string;
  readonly manifest: PackageManifest;
  readonly name: string;
}
```

Create `tooling/workspace-policy/src/discover.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { PackageManifest, WorkspacePackage } from './types.js';

const workspaceRoots = ['apps', 'packages', 'examples', 'tooling'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readManifest(manifestPath: string): Promise<PackageManifest> {
  const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(`Package manifest is not an object: ${manifestPath}`);
  }
  return parsed;
}

export async function discoverWorkspacePackages(rootDir: string): Promise<readonly WorkspacePackage[]> {
  const discovered: WorkspacePackage[] = [];
  for (const workspaceRoot of workspaceRoots) {
    const directory = join(rootDir, workspaceRoot);
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if (isRecord(error) && error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageDirectory = join(directory, entry.name);
      const manifestPath = join(packageDirectory, 'package.json');
      const manifest = await readManifest(manifestPath);
      const name = typeof manifest.name === 'string' ? manifest.name : `<${relative(rootDir, packageDirectory)}>`;
      discovered.push({
        directory: packageDirectory,
        manifest,
        manifestPath,
        name,
      });
    }
  }
  return discovered.sort((left, right) => left.name.localeCompare(right.name));
}
```

Create `tooling/workspace-policy/src/manifest.ts`:

```ts
import type {
  PackageManifest,
  WorkspacePackage,
  WorkspaceViolation,
} from './types.js';

const packageNamePattern = /^@aurora\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const requiredFields = ['private', 'type', 'exports', 'files', 'engines', 'scripts', 'aurora'] as const;
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function asStringMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export function manifestViolations(
  workspacePackage: WorkspacePackage,
  localNames: ReadonlySet<string>,
): readonly WorkspaceViolation[] {
  const { manifest, name } = workspacePackage;
  const violations: WorkspaceViolation[] = [];
  if (!packageNamePattern.test(name)) {
    violations.push({ code: 'invalid-package-name', packageName: name, message: `Invalid package name: ${name}` });
  }
  for (const field of requiredFields) {
    if (!(field in manifest)) {
      violations.push({
        code: 'missing-package-field',
        packageName: name,
        message: `Missing package.json field: ${field}`,
      });
    }
  }
  for (const field of dependencyFields) {
    for (const [dependency, range] of Object.entries(asStringMap(manifest[field]))) {
      if (localNames.has(dependency) && !range.startsWith('workspace:')) {
        violations.push({
          code: 'non-workspace-local-dependency',
          dependency,
          packageName: name,
          message: `Local dependency ${dependency} must use workspace: protocol`,
        });
      }
    }
  }
  return violations;
}

export function dependencyMap(manifest: PackageManifest): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const field of dependencyFields) Object.assign(result, asStringMap(manifest[field]));
  return result;
}
```

Create `tooling/workspace-policy/src/check-workspace.ts`:

```ts
import { discoverWorkspacePackages } from './discover.js';
import { manifestViolations } from './manifest.js';
import type { WorkspaceCheckResult, WorkspaceViolation } from './types.js';

export function sortViolations(
  violations: readonly WorkspaceViolation[],
): readonly WorkspaceViolation[] {
  return [...violations].sort((left, right) =>
    [left.packageName, left.code, left.file ?? '', left.dependency ?? '']
      .join('\0')
      .localeCompare([right.packageName, right.code, right.file ?? '', right.dependency ?? ''].join('\0')),
  );
}

export async function checkWorkspace(rootDir: string): Promise<WorkspaceCheckResult> {
  const packages = await discoverWorkspacePackages(rootDir);
  const localNames = new Set(packages.map(({ name }) => name));
  const violations = sortViolations(packages.flatMap((item) => manifestViolations(item, localNames)));
  return { ok: violations.length === 0, violations };
}

```

Create `tooling/workspace-policy/src/index.ts`:

```ts
export { checkWorkspace } from './check-workspace.js';
export { discoverWorkspacePackages } from './discover.js';
export type {
  WorkspaceCheckResult,
  WorkspacePackage,
  WorkspaceViolation,
  WorkspaceViolationCode,
} from './types.js';
```

- [ ] **Step 4: Run manifest tests and strict typechecking**

Run:

```powershell
pnpm test -- --run tooling/workspace-policy/test/manifest-policy.test.ts
pnpm typecheck
```

Expected: manifest tests PASS and strict TypeScript exits 0. If the exact count of missing-field violations differs, fix the implementation to emit one violation for each of the seven required fields; do not weaken the assertion.

- [ ] **Step 5: Commit package discovery and manifest policy**

```bash
git add tooling/workspace-policy/src/types.ts tooling/workspace-policy/src/discover.ts tooling/workspace-policy/src/manifest.ts tooling/workspace-policy/src/check-workspace.ts tooling/workspace-policy/src/index.ts tooling/workspace-policy/test/fixtures.ts tooling/workspace-policy/test/manifest-policy.test.ts
git commit -m "feat(tooling): validate workspace manifests"
```

### Task 3: Dependency graph and private import enforcement

**Files:**
- Create: `tooling/workspace-policy/src/imports.ts`
- Create: `tooling/workspace-policy/src/graph.ts`
- Modify: `tooling/workspace-policy/src/check-workspace.ts`
- Create: `tooling/workspace-policy/test/dependency-policy.test.ts`

**Interfaces:**
- Consumes: Task 2’s `WorkspacePackage`, `WorkspaceViolation`, `dependencyMap()`, discovery, and temporary fixture builder.
- Produces: `collectAuroraImports(packageDirectory)`, `dependencyViolations(packages, rootDir)`, and `checkWorkspace()` coverage for undeclared local imports, non-exported/private subpaths, and cycles.

- [ ] **Step 1: Write failing dependency policy tests**

Create `tooling/workspace-policy/test/dependency-policy.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { checkWorkspace } from '../src/check-workspace.js';
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
  validManifest,
} from './fixtures.js';

let fixture: WorkspaceFixture | undefined;

afterEach(async () => fixture?.dispose());

describe('Workspace dependency policy', () => {
  it('rejects an undeclared local package import', async () => {
    fixture = await createWorkspaceFixture([
      {
        directory: 'tooling/consumer',
        manifest: validManifest('@aurora/consumer'),
        files: { 'src/index.ts': "import '@aurora/provider';\n" },
      },
      { directory: 'tooling/provider', manifest: validManifest('@aurora/provider') },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toMatchObject([
      {
        code: 'undeclared-dependency',
        dependency: '@aurora/provider',
        packageName: '@aurora/consumer',
      },
    ]);
  });

  it('rejects a cycle formed by declared local dependencies', async () => {
    const left = validManifest('@aurora/left');
    const right = validManifest('@aurora/right');
    left.dependencies = { '@aurora/right': 'workspace:*' };
    right.dependencies = { '@aurora/left': 'workspace:*' };
    fixture = await createWorkspaceFixture([
      { directory: 'tooling/left', manifest: left },
      { directory: 'tooling/right', manifest: right },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations.map(({ code }) => code)).toEqual([
      'dependency-cycle',
      'dependency-cycle',
    ]);
  });

  it('rejects private and unexported subpaths but accepts an exported subpath', async () => {
    const consumer = validManifest('@aurora/consumer');
    consumer.dependencies = { '@aurora/provider': 'workspace:*' };
    const provider = validManifest('@aurora/provider');
    provider.exports = { '.': './src/index.ts', './public': './src/public.ts' };
    fixture = await createWorkspaceFixture([
      {
        directory: 'tooling/consumer',
        manifest: consumer,
        files: {
          'src/index.ts': [
            "export { ok } from '@aurora/provider/public';",
            "export { hidden } from '@aurora/provider/internal/hidden';",
            "export { missing } from '@aurora/provider/missing';",
            '',
          ].join('\n'),
        },
      },
      { directory: 'tooling/provider', manifest: provider },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations.map(({ code }) => code)).toEqual([
      'private-path-import',
      'private-path-import',
    ]);
    expect(result.violations.map(({ dependency }) => dependency)).toEqual([
      '@aurora/provider/internal/hidden',
      '@aurora/provider/missing',
    ]);
  });
});
```

- [ ] **Step 2: Run the dependency test and confirm all three behaviors are absent**

Run: `pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts`

Expected: FAIL because Task 2 validates manifests only and emits none of the expected dependency violations.

- [ ] **Step 3: Implement TypeScript import collection**

Create `tooling/workspace-policy/src/imports.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from 'typescript';

export interface PackageImport {
  readonly file: string;
  readonly specifier: string;
}

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  });
  const nested = await Promise.all(
    entries
      .filter(({ name }) => name !== 'dist' && name !== 'node_modules')
      .map((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return entry.isFile() && path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : [];
      }),
  );
  return nested.flat();
}

function literalText(node: ts.Node | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
}

export async function collectAuroraImports(packageDirectory: string): Promise<readonly PackageImport[]> {
  const imports: PackageImport[] = [];
  for (const filePath of await sourceFiles(packageDirectory)) {
    const source = ts.createSourceFile(
      filePath,
      await readFile(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      let specifier: string | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        specifier = literalText(node.moduleSpecifier);
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        specifier = literalText(node.arguments[0]);
      }
      if (specifier?.startsWith('@aurora/')) {
        imports.push({ file: relative(packageDirectory, filePath).replaceAll('\\', '/'), specifier });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return imports.sort((left, right) =>
    `${left.file}\0${left.specifier}`.localeCompare(`${right.file}\0${right.specifier}`),
  );
}
```

- [ ] **Step 4: Implement cycle, declaration, and export checks**

Create `tooling/workspace-policy/src/graph.ts`:

```ts
import { dependencyMap } from './manifest.js';
import { collectAuroraImports } from './imports.js';
import type { WorkspacePackage, WorkspaceViolation } from './types.js';

function auroraPackageName(specifier: string): string {
  return specifier.split('/').slice(0, 2).join('/');
}

function exportedSubpaths(workspacePackage: WorkspacePackage): ReadonlySet<string> {
  const value = workspacePackage.manifest.exports;
  if (typeof value === 'string') return new Set(['.']);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return new Set();
  return new Set(Object.keys(value));
}

function cycleMembers(graph: ReadonlyMap<string, ReadonlySet<string>>): ReadonlySet<string> {
  const members = new Set<string>();
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      const start = stack.indexOf(name);
      for (const member of stack.slice(start)) members.add(member);
      return;
    }
    visiting.add(name);
    stack.push(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of graph.keys()) visit(name);
  return members;
}

export async function dependencyViolations(
  packages: readonly WorkspacePackage[],
): Promise<readonly WorkspaceViolation[]> {
  const byName = new Map(packages.map((item) => [item.name, item]));
  const graph = new Map<string, ReadonlySet<string>>();
  const violations: WorkspaceViolation[] = [];

  for (const workspacePackage of packages) {
    const declared = dependencyMap(workspacePackage.manifest);
    const localDependencies = new Set(
      Object.keys(declared).filter((dependency) => byName.has(dependency)),
    );
    graph.set(workspacePackage.name, localDependencies);

    for (const packageImport of await collectAuroraImports(workspacePackage.directory)) {
      const dependency = auroraPackageName(packageImport.specifier);
      const target = byName.get(dependency);
      if (target === undefined) continue;
      if (!(dependency in declared)) {
        violations.push({
          code: 'undeclared-dependency',
          dependency,
          file: packageImport.file,
          packageName: workspacePackage.name,
          message: `Import ${packageImport.specifier} is not declared in package.json`,
        });
        continue;
      }

      const suffix = packageImport.specifier.slice(dependency.length);
      const subpath = suffix === '' ? '.' : `.${suffix}`;
      const explicitlyPrivate = suffix.includes('/src/') || suffix.includes('/internal/');
      if (explicitlyPrivate || !exportedSubpaths(target).has(subpath)) {
        violations.push({
          code: 'private-path-import',
          dependency: packageImport.specifier,
          file: packageImport.file,
          packageName: workspacePackage.name,
          message: `Import ${packageImport.specifier} is not a public export`,
        });
      }
    }
  }

  for (const packageName of cycleMembers(graph)) {
    violations.push({
      code: 'dependency-cycle',
      packageName,
      message: `Package participates in a local dependency cycle: ${packageName}`,
    });
  }
  return violations;
}
```

Update `checkWorkspace()` in `tooling/workspace-policy/src/check-workspace.ts` to import and merge graph violations:

```ts
import { dependencyViolations } from './graph.js';

export async function checkWorkspace(rootDir: string): Promise<WorkspaceCheckResult> {
  const packages = await discoverWorkspacePackages(rootDir);
  const localNames = new Set(packages.map(({ name }) => name));
  const violations = sortViolations([
    ...packages.flatMap((item) => manifestViolations(item, localNames)),
    ...(await dependencyViolations(packages)),
  ]);
  return { ok: violations.length === 0, violations };
}
```

Keep every other Task 2 function unchanged.

- [ ] **Step 5: Run dependency tests, manifest regression tests, and typechecking**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/manifest-policy.test.ts
pnpm typecheck
```

Expected: both test files PASS and TypeScript exits 0. The exported `@aurora/provider/public` import is accepted; the two private/unexported imports are rejected in stable order.

- [ ] **Step 6: Commit automatic dependency policy**

```bash
git add tooling/workspace-policy/src/imports.ts tooling/workspace-policy/src/graph.ts tooling/workspace-policy/src/check-workspace.ts tooling/workspace-policy/test/dependency-policy.test.ts
git commit -m "feat(tooling): enforce workspace dependency boundaries"
```

### Task 4: Deterministic CLI, build, and CI-ready command contract

**Files:**
- Create: `tooling/workspace-policy/src/format.ts`
- Create: `tooling/workspace-policy/src/cli.ts`
- Modify: `tooling/workspace-policy/src/index.ts`
- Create: `tooling/workspace-policy/test/cli.test.ts`

**Interfaces:**
- Consumes: Task 3’s complete `checkWorkspace(rootDir)` and stable violation sorting.
- Produces: `formatViolations(result)`, exact `aurora-check-workspace --root <path>` behavior, exit codes `0/1/2`, buildable ESM output, and the root `check:boundaries`/`check:ci` interface.

- [ ] **Step 1: Write failing formatter and CLI integration tests**

Create `tooling/workspace-policy/test/cli.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { formatViolations } from '../src/format.js';
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
  validManifest,
} from './fixtures.js';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
let fixture: WorkspaceFixture | undefined;

afterEach(async () => fixture?.dispose());

function runCli(args: readonly string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    encoding: 'utf8',
  });
}

describe('Workspace policy CLI', () => {
  it('formats violations in stable, secret-free lines', () => {
    expect(
      formatViolations({
        ok: false,
        violations: [
          {
            code: 'undeclared-dependency',
            dependency: '@aurora/zeta',
            file: 'src/index.ts',
            message: 'ignored free-form text',
            packageName: '@aurora/alpha',
          },
        ],
      }),
    ).toBe('@aurora/alpha [undeclared-dependency] src/index.ts -> @aurora/zeta\n');
  });

  it('returns 0 with no output for a valid Workspace', async () => {
    fixture = await createWorkspaceFixture([
      { directory: 'tooling/valid', manifest: validManifest('@aurora/valid') },
    ]);
    const result = runCli(['--root', fixture.rootDir]);
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 0,
      stdout: '',
      stderr: '',
    });
  });

  it('returns 1 and deterministic stderr for policy violations', async () => {
    fixture = await createWorkspaceFixture([
      { directory: 'tooling/bad', manifest: { name: 'bad name' } },
    ]);
    const result = runCli(['--root', fixture.rootDir]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('bad name [invalid-package-name]');
    expect(result.stderr).not.toContain(fixture.rootDir);
  });

  it('returns 2 for invalid arguments and unreadable roots', () => {
    const missingRoot = runCli([]);
    expect(missingRoot.status).toBe(2);
    expect(missingRoot.stderr).toBe('workspace-policy: expected --root <path>\n');

    const unreadable = runCli(['--root', 'does-not-exist']);
    expect(unreadable.status).toBe(2);
    expect(unreadable.stderr).toBe('workspace-policy: unable to read Workspace\n');
  });
});
```

- [ ] **Step 2: Run the CLI test and confirm module-not-found**

Run: `pnpm --filter @aurora/workspace-policy exec vitest run test/cli.test.ts`

Expected: FAIL because `src/format.ts` and `src/cli.ts` do not exist.

- [ ] **Step 3: Implement deterministic formatting and CLI exit semantics**

Create `tooling/workspace-policy/src/format.ts`:

```ts
import type { WorkspaceCheckResult } from './types.js';

export function formatViolations(result: WorkspaceCheckResult): string {
  return result.violations
    .map((violation) => {
      const file = violation.file === undefined ? '' : ` ${violation.file.replaceAll('\\', '/')}`;
      const dependency = violation.dependency === undefined ? '' : ` -> ${violation.dependency}`;
      return `${violation.packageName} [${violation.code}]${file}${dependency}`;
    })
    .join('\n')
    .concat(result.violations.length === 0 ? '' : '\n');
}
```

Create `tooling/workspace-policy/src/cli.ts`:

```ts
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkWorkspace } from './check-workspace.js';
import { formatViolations } from './format.js';

export interface CliIo {
  readonly stderr: (message: string) => void;
}

export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  if (args.length !== 2 || args[0] !== '--root' || args[1] === undefined) {
    io.stderr('workspace-policy: expected --root <path>\n');
    return 2;
  }
  try {
    const result = await checkWorkspace(resolve(args[1]));
    if (result.ok) return 0;
    io.stderr(formatViolations(result));
    return 1;
  } catch {
    io.stderr('workspace-policy: unable to read Workspace\n');
    return 2;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await runCli(process.argv.slice(2), {
    stderr: (message) => process.stderr.write(message),
  });
}
```

Add these exports to `tooling/workspace-policy/src/index.ts`:

```ts
export { runCli, type CliIo } from './cli.js';
export { formatViolations } from './format.js';
```

- [ ] **Step 4: Run CLI tests and build the package**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/cli.test.ts
pnpm typecheck
pnpm build
node tooling/workspace-policy/dist/cli.js --root .
```

Expected: tests PASS; typecheck and build exit 0; the built CLI exits 0 with empty stdout/stderr for the real repository. The build creates only `tooling/workspace-policy/dist`.

- [ ] **Step 5: Prove the root CI-ready entrypoint and negative fixtures fail closed**

Run:

```powershell
pnpm check:boundaries
pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/cli.test.ts
```

Expected: the real repository boundary command exits 0 with no output; fixture tests PASS by proving undeclared, cyclic, private/unexported, invalid-argument, and unreadable-root cases produce their specified non-zero outcomes. This is a local command contract, not evidence that a CI workflow exists.

- [ ] **Step 6: Commit the CLI and build interface**

```bash
git add tooling/workspace-policy/src/format.ts tooling/workspace-policy/src/cli.ts tooling/workspace-policy/src/index.ts tooling/workspace-policy/test/cli.test.ts
git commit -m "feat(tooling): expose workspace policy cli"
```

### Task 5: Documentation contract, full quality gate, and ADR implementation evidence

**Files:**
- Create: `tooling/workspace-policy/test/documentation-contract.test.ts`
- Create: `tooling/workspace-policy/README.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/monorepo-and-build.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/adr/ADR-001-use-monorepo.md`
- Modify: `docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `docs/adr/ADR-007-workspace-package-and-task-tooling.md`
- Modify: `docs/adr/README.md`
- Modify: `AGENTS.md`
- Modify: `AURORA_RULES.md`

**Interfaces:**
- Consumes: every Task 1—4 file and the successful frozen-install, test, type, lint, boundary, and build commands.
- Produces: one accurate real-module README, user-facing root commands, bidirectional authority links, implementation evidence, ADR-001/006 `in-progress`, ADR-007 `implemented`, and a final `pnpm check:ci` gate. No downstream module becomes ready by implication.

- [ ] **Step 1: Write the failing documentation and implementation-state contract**

Create `tooling/workspace-policy/test/documentation-contract.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function rootFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

describe('Monorepo foundation documentation contract', () => {
  it('documents real commands without claiming CI or business modules exist', async () => {
    const readme = await rootFile('README.md');
    expect(readme).toContain('pnpm install --frozen-lockfile');
    expect(readme).toContain('pnpm check:ci');
    expect(readme).toContain('当前没有 CI 工作流');
    expect(readme).not.toContain('仓库目前没有 SDK、服务端或管理平台代码，没有机器 OpenAPI、事件 Schema、可执行数据模型、CI、IaC、云资源或部署。');
  });

  it('gives the real internal module one complete README', async () => {
    const moduleReadme = await rootFile('tooling/workspace-policy/README.md');
    for (const heading of [
      '## 职责',
      '## 非职责',
      '## 公开接口',
      '## CLI 与失败语义',
      '## 测试',
      '## 权威来源',
    ]) {
      expect(moduleReadme).toContain(heading);
    }
  });

  it('records only accurate ADR implementation states', async () => {
    await expect(rootFile('docs/adr/ADR-001-use-monorepo.md')).resolves.toContain(
      'implementation-status: in-progress',
    );
    await expect(rootFile('docs/adr/ADR-006-one-way-dependencies.md')).resolves.toContain(
      'implementation-status: in-progress',
    );
    await expect(rootFile('docs/adr/ADR-007-workspace-package-and-task-tooling.md')).resolves.toContain(
      'implementation-status: implemented',
    );
  });
});
```

- [ ] **Step 2: Run the documentation test and confirm it fails on absent/stale evidence**

Run: `pnpm --filter @aurora/workspace-policy exec vitest run test/documentation-contract.test.ts`

Expected: FAIL because the module README is absent, root README still says no commands exist, and all three ADR implementation states are `not-started`.

- [ ] **Step 3: Write the real module README**

Create `tooling/workspace-policy/README.md` with this complete content:

```markdown
# Workspace Policy

`@aurora/workspace-policy` is a private internal package that validates Aurora Workspace manifests and universal dependency boundaries. It is not published.

## 职责

- Discover direct packages under `apps/*`, `packages/*`, `examples/*`, and `tooling/*`.
- Validate required manifest fields, `@aurora/<kebab-case>` names, and `workspace:*` local dependencies.
- Reject undeclared local imports, dependency cycles, `/src/`, `/internal/`, and unexported subpaths.
- Expose deterministic API results and a secret-free CLI for local and future CI use.

## 非职责

- It does not define Aurora business architecture, protocol fields, SDK APIs, release versions, CI workflows, or deployment policy.
- It does not create packages or repair violations automatically.
- Domain-specific layer rules are added only when the corresponding real module and accepted ADR/spec exist.

## 公开接口

```ts
export function checkWorkspace(rootDir: string): Promise<WorkspaceCheckResult>;
export function formatViolations(result: WorkspaceCheckResult): string;
```

`WorkspaceCheckResult.ok` is true only when `violations` is empty. Violations use the stable codes documented by `WorkspaceViolationCode` in `src/types.ts`.

## CLI 与失败语义

Run `pnpm check:boundaries` from the repository root, or run the built command as `aurora-check-workspace --root <path>`.

- Exit 0: policy passes; stdout and stderr are empty.
- Exit 1: policy violations; deterministic diagnostics are written to stderr.
- Exit 2: invalid arguments or unreadable Workspace; a generic error is written without leaking paths or secrets.

## 测试

- `pnpm --filter @aurora/workspace-policy test`
- `pnpm --filter @aurora/workspace-policy typecheck`
- `pnpm --filter @aurora/workspace-policy build`
- `pnpm check:ci` runs the complete repository-local gate.

Tests use temporary directories. No fixture is a real Aurora business package.

## 权威来源

- [Monorepo 与基础工程工具](../../docs/architecture/monorepo-and-build.md)
- [ADR-001](../../docs/adr/ADR-001-use-monorepo.md)
- [ADR-006](../../docs/adr/ADR-006-one-way-dependencies.md)
- [ADR-007](../../docs/adr/ADR-007-workspace-package-and-task-tooling.md)
- [测试策略](../../docs/testing/test-strategy.md)
```

- [ ] **Step 4: Update root and formal documentation using verified facts only**

Make these exact semantic changes:

- `README.md`: preserve the statement that SDK, services, OpenAPI, event Schema, data models, CI, IaC, cloud resources, and deployments do not exist; add a “本地工程命令” section containing `corepack enable pnpm`, `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm check:ci`, and `pnpm --filter @aurora/workspace-policy test`; explicitly state “当前没有 CI 工作流，`check:ci` 只是未来 CI 复用的本地非交互入口”.
- `docs/README.md`: add `tooling/workspace-policy/README.md` as the sole module-level authority for the real internal tool; keep `event-schema`, SDK, services, CI, release, and IaC absent.
- `docs/architecture/monorepo-and-build.md`: append a dated implementation-evidence record listing exact Node/pnpm versions, lock-file SHA-256, test counts, command exit codes, and the fact that no business package/CI workflow exists. Copy only values from the fresh Task 5 command output.
- `docs/architecture/formalization-readiness.md`: mark module A0 implemented and A1/A2 plus every business/cloud module still blocked; do not change their missing inputs.
- `docs/adr/README.md`: show ADR-001/006 as accepted/in-progress and ADR-007 as accepted/implemented; leave ADR-002—005 accepted/not-started.
- `AGENTS.md` and `AURORA_RULES.md`: add the verified root command entrypoint and the same dual states; preserve the per-module planning and execution gates.

Append implementation records to the three ADRs, then update their frontmatter/body implementation states:

- ADR-001: `in-progress` because the unified Workspace exists but Aurora’s real application/package inventory is not built.
- ADR-006: `in-progress` because universal manifest/import/cycle checks exist but domain-specific layer rules have no real modules to validate.
- ADR-007: `implemented` only if frozen install, full tests, lint, typecheck, boundary check, build, formatting, and docs checks all pass; record no CI evidence because no workflow exists.

Each ADR record must include the implementation commit hash produced by the executor, exact commands, exit codes, and evidence paths. Use `none` for Issue/PR if none exists; do not invent identifiers or performance results.

Format only the module-managed paths from the approved spec:

```powershell
pnpm exec prettier --write package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json tooling/workspace-policy/package.json tooling/workspace-policy/tsconfig.json tooling/workspace-policy/tsconfig.build.json "tooling/workspace-policy/src/**/*.ts" "tooling/workspace-policy/test/**/*.ts" tooling/workspace-policy/README.md README.md docs/architecture/monorepo-and-build.md
```

Expected: Prettier does not touch the six append-only root norms, PRD, approved design-history specs, or this plan.

- [ ] **Step 5: Run the documentation test and the complete local gate**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/documentation-contract.test.ts
pnpm install --frozen-lockfile
pnpm check:ci
git diff --check
git status --short
```

Expected: documentation test PASS; frozen install exits 0 without lock-file changes; `check:ci` runs format, ESLint, strict TypeScript, all Vitest tests, real Workspace boundaries, and build with exit 0; `git diff --check` exits 0; status contains only this plan’s intended files plus the user’s protected pre-existing documentation changes.

- [ ] **Step 6: Verify architecture and scope negative assertions**

Run:

```powershell
Get-ChildItem -Recurse -File package.json,pnpm-workspace.yaml,pnpm-lock.yaml,*.ts,*.mjs,*.json | Select-Object -ExpandProperty FullName
Get-ChildItem -Force -Name apps,packages,examples,.github -ErrorAction SilentlyContinue
Select-String -Path package.json,pnpm-workspace.yaml -Pattern 'turbo|nx|changesets|remoteCache|dangerouslyAllowAllBuilds' -CaseSensitive:$false
```

Expected: engineering files exist only at the root and under `tooling/workspace-policy`; the second command returns no directories; the third command returns no matches. `pnpm-workspace.yaml` may list future globs, but those directories do not exist.

- [ ] **Step 7: Commit the verified module documentation and evidence**

```bash
git add README.md AGENTS.md AURORA_RULES.md docs/README.md docs/architecture/monorepo-and-build.md docs/architecture/formalization-readiness.md docs/adr/README.md docs/adr/ADR-001-use-monorepo.md docs/adr/ADR-006-one-way-dependencies.md docs/adr/ADR-007-workspace-package-and-task-tooling.md tooling/workspace-policy/README.md tooling/workspace-policy/test/documentation-contract.test.ts
git commit -m "docs: record monorepo foundation evidence"
```

## Final Review Gate

Before handing off the implementation, inspect `git log --oneline -5`, `git diff <base>...HEAD --stat`, every changed ADR implementation record, and the complete `pnpm check:ci` output. Confirm all of the following:

- Exactly one real internal package exists: `@aurora/workspace-policy`.
- No business package, machine contract, CI workflow, release configuration, remote cache, container, IaC, or cloud resource was created.
- ADR-001 and ADR-006 are `accepted / in-progress`; ADR-007 is `accepted / implemented`; ADR-002—005 remain `accepted / not-started`.
- `pnpm-lock.yaml` is unchanged by a second frozen install.
- Every negative fixture fails for the documented violation code and the real repository passes.
- Root commands and module README link back to the approved spec and accepted ADRs without copying business rules.

Stop after this review. Do not start `event-schema`, SDK Core, CI, release, or infrastructure work.
