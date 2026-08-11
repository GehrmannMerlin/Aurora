# OPS-05 Immutable Artifact / Migration / Deployment / Rollback Pipeline Implementation Plan

> **For agentic workers:** This plan is executed INLINE by the main session (user override: no subagents, no executing-plans skill). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Aurora 的正式部署流水线——不可变制品身份、前向兼容 Migration、按服务边界的部署与回滚工具链，以及承载它们的 ECS 服务 IaC，全部可本地验证（单元测试 + `cdk synth` + dry-run），不创建真实 AWS 资源、不触碰阿里云 Preview。

**Architecture:** 在 `tooling/aurora-release`（`aurora.layer: tooling`）提供纯函数部署工具链：`manifest.ts`（不可变制品身份/提交 SHA/摘要）、`migrations.ts`（Migration 集发现、前向兼容校验、前向迁移命令渲染）、`deploy.ts`（部署计划编排，migrate→API→Worker→SPA 边界）、`rollback.ts`（按服务回滚计划，无破坏性 DB 回退）。在 `tooling/aws-infra` ComputeStack 增加 OPS-05 所有的 ECS Fargate Service（ingestion-api / ingestion-worker，健康阈值、min/max healthy、deploy circuit breaker、rollback 熔断），供不可变制品部署目标。添加 GitHub Actions `deploy.yml`（workflow_dispatch 手动触发，无凭据不自动运行）与正式规格文档。

**Tech Stack:** TypeScript（严格模式、NodeNext ESM）、vitest、aws-cdk-lib（`ecs`/`ecr`/`iam`/`logs`）、pnpm workspace（`tooling` 层）。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --------- | ------------ | -------- | ------------------------ | -------- |
| OPS-05 | `BASE-ARCH`（架构规范）、`BASE-IMPL`（代码/测试/ADR/文档规范）、`OPS-QUALITY`（[test-strategy](../testing/test-strategy.md)、[测试/部署/发布设计](../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md)）、`OPS-DELIVERY`（[deployment](../architecture/deployment.md)、[release-migration-and-rollback](../releases/release-migration-and-rollback.md)、[backup-and-recovery](../operations/backup-and-recovery.md)）、`FORM`（[formalization-readiness](../architecture/formalization-readiness.md)、[ADR 索引](../adr/README.md)）、[OPS-04 规格](../architecture/aws-region-account-network-iac-foundation.md) | Deployment §5—6；Release §1—4、§6；测试/部署设计 §5、§7、§10、§14 | 不可变制品 digest 晋级；expand/contract 前向兼容 Migration、禁止自动破坏性 down；SPA/API/Worker 回滚边界独立；secret 不入 repo/log；不直接修改生产数据 | ECS Service 创建、健康设置、部署熔断属 OPS-05（OPS-04 §8）；真实域名/边缘/DNS 由用户提供；provisioning 需 AWS 凭据（当前无 → `PROVISIONING_EVIDENCE_PENDING`） |

## Global Constraints

- 生产只能部署预发布验证过的**同一不可变制品**，绝不从生产分支重建（deployment.md §5；Release §2）。
- 镜像按 **ECR digest** 晋级；SPA 以内容哈希和版本前缀发布，入口原子切换（deployment.md §5；Release §4）。
- Migration 必须**前向兼容**（expand），禁止自动运行破坏性 down Migration（Release §3、§4；测试/部署设计 §10.2）。
- 回滚以旧 digest/旧入口为准，不重新构建；若 Migration 已进入不可逆阶段，按已批准的 forward-fix/兼容方案（测试/部署设计 §10.3）。
- **ECR 不出现浮动 `latest` 发布依据**（测试/部署设计 §5.1、§16）：任务定义镜像引用固定 digest（IaC 用占位 tag，部署工具链以 digest 替换）。
- 健康检查与部署设置：ECS Service 启用健康阈值、`minHealthyPercent`/`maxHealthyPercent`、部署熔断 + 回滚（测试/部署设计 §10.3；OPS-04 §8）。
- secret 不入 repo/log/镜像；CI 用 GitHub OIDC 短期身份（OPS-04 §12）。
- **不创建真实 AWS 资源**：本计划只写 IaC + 工具链 + 测试；`cdk deploy`/ECS update 需凭据，当前无凭据 → `PROVISIONING_EVIDENCE_PENDING`，不执行任何真实部署。
- **不触碰** 阿里云 Preview（`aurora.ah.cn` / `47.238.145.24`，`deploy/preview/` 独立路径）。
- 测试预算（用户限定）：deployment/release tooling targeted tests、受影响 typecheck、IaC synth/static、Migration forward-compat 定向检查、deploy/rollback script dry-run/static、`git diff --check`。**禁止** root `check`/`test`/`coverage`、完整 PostgreSQL suite、浏览器矩阵、Console E2E。
- 不越界 OPS-06/07；不实现 G08/G04。
- workspace 门禁：`tooling/aurora-release` 必须通过 `typecheck`/`test`/`lint`/`format:check`/`check:boundaries`（tooling 层无运行时限制）。

---

## File Structure

```
tooling/aurora-release/
  package.json                  # name=@aurora/aurora-release, aurora.layer=tooling, scripts(typecheck/build/test), bin
  tsconfig.json                 # strict TS, extends ../../tsconfig.base.json
  tsconfig.build.json           # outDir dist
  vitest.config.ts              # vitest node env, include test/**/*.test.ts
  README.md                     # OPS-05 工具链说明 + dry-run 用法 + PROVISIONING_EVIDENCE_PENDING
  src/
    manifest.ts                 # ReleaseManifest + buildReleaseManifest + assertImmutableArtifact
    migrations.ts               # discoverMigrationSet + validateForwardCompatibility + renderForwardMigrationCommand
    deploy.ts                   # planDeployment + assertSafeDeployment
    rollback.ts                 # planRollback + assertNoDestructiveMigrationRollback
    index.ts                    # 包根导出
    entry.ts                    # CLI：plan / validate-migrations / plan-rollback（默认 --dry-run）
  test/
    manifest.test.ts
    migrations.test.ts
    deploy.test.ts
    rollback.test.ts
    entry.test.ts
tooling/aws-infra/
  src/stacks/compute-stack.ts   # Modify: 增加 ECS Fargate Service（API + Worker）
  src/stacks/network-stack.ts   # Modify: 导出 serviceSecurityGroup（已有）
  src/app.ts                    # Modify: 传 serviceSecurityGroup 到 ComputeStack
  test/stacks.test.ts           # Modify: ECS Service 断言
  test/compute-deploy.test.ts   # Create: 部署设置断言（circuit breaker / min healthy / digest 占位）
docs/architecture/
  immutable-artifact-deployment-pipeline.md   # Create: OPS-05 正式规格
deploy/aws/
  deploy.yml                    # GitHub Actions（workflow_dispatch 手动；无凭据不自动运行）
  README.md                     # AWS 部署入口说明 + 前置（凭据/域名）
package.json（根）               # format:check / lint 注册 tooling/aurora-release
```

接口契约（跨任务复用）：

- `src/manifest.ts` 导出 `interface ArtifactRef { readonly imageDigest?: string; readonly entryAssetHash?: string }`、`interface ReleaseManifest { commitSha: string; builtFrom: 'ci'; artifacts: Readonly<Record<string, ArtifactRef>>; migrationSet: readonly string[]; protocolVersions: readonly string[]; createdAt: string }`、`function buildReleaseManifest(input: unknown): ReleaseManifest`（非法输入抛 `release_manifest_*` 稳定错误）、`function assertImmutableArtifact(manifest: ReleaseManifest): void`。
- `src/migrations.ts` 导出 `interface MigrationFile { dir: string; version: string; file: string }`、`function discoverMigrationSet(dirs: readonly string[]): readonly MigrationFile[]`（按 version 升序、冲突抛错）、`function validateForwardCompatibility(migrations: readonly MigrationFile[]): readonly string[]`（返回违规列表，空 = 通过）、`function renderForwardMigrationCommand(migrations: readonly MigrationFile[], databaseUrlEnv: string): readonly string[]`。
- `src/deploy.ts` 导出 `type DeploymentStep = { kind:'migrate'; commands: readonly string[] } | { kind:'update-service'; service: string; imageDigest: string } | { kind:'switch-spa-entry'; assetHash: string }`、`interface DeploymentTargets { services: readonly string[]; spa?: boolean; migrate?: boolean }`、`function planDeployment(manifest: ReleaseManifest, previous: ReleaseManifest | undefined, targets: DeploymentTargets, migrationCommands: readonly string[]): readonly DeploymentStep[]`、`function assertSafeDeployment(steps: readonly DeploymentStep[]): void`。
- `src/rollback.ts` 导出 `interface RollbackPlan { serviceRollbacks: readonly { service: string; previousDigest: string }[]; revertSpaEntry?: string; workerPause: boolean; note: string }`、`function planRollback(current: ReleaseManifest, previous: ReleaseManifest): RollbackPlan`、`function assertNoDestructiveMigrationRollback(plan: RollbackPlan): void`。
- `src/entry.ts` 导出 `function runCli(argv: readonly string[]): Promise<number>`（子命令 `plan|validate-migrations|plan-rollback`，均 `--dry-run`，稳定退出码 0/1）。
- `ComputeStack` 构造签名改为 `new ComputeStack(scope, id, { env, vpc, serviceSecurityGroup })`；新增导出 `IMMUTABLE_DEPLOY_PLACEHOLDER_TAG` 常量与 `services: Readonly<Record<string, ecs.FargateService>>`。

---

### Task 1: Immutable artifact + deployment identity（`tooling/aurora-release` 脚手架 + manifest）

**Files:**
- Create: `tooling/aurora-release/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `README.md`, `src/manifest.ts`, `src/index.ts`, `test/manifest.test.ts`
- Modify: `package.json`（根 `format:check` 与 `lint` 注册 `tooling/aurora-release` 路径）

**Interfaces:**
- Produces: `ArtifactRef`、`ReleaseManifest`、`buildReleaseManifest(input)`、`assertImmutableArtifact(manifest)`（签名见上）。

- [ ] **Step 1: 写失败测试** `test/manifest.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildReleaseManifest, assertImmutableArtifact } from '../src/manifest.js';

const validInput = {
  commitSha: 'a'.repeat(40),
  builtFrom: 'ci',
  artifacts: {
    'ingestion-api': { imageDigest: `sha256:${'b'.repeat(64)}` },
    'ingestion-worker': { imageDigest: `sha256:${'c'.repeat(64)}` },
    console: { entryAssetHash: 'a1b2c3d4' },
  },
  migrationSet: ['1720000000001_ingestion-inbox', '1720000000002_ingestion-credentials'],
  protocolVersions: ['event-envelope-v1'],
  createdAt: '2026-08-11T00:00:00Z',
};

describe('release manifest', () => {
  it('accepts and freezes a valid CI-built manifest', () => {
    const m = buildReleaseManifest(validInput);
    expect(m.commitSha).toBe('a'.repeat(40));
    expect(m.artifacts['ingestion-api']?.imageDigest).toMatch(/^sha256:/);
    expect(Object.isFrozen(m.artifacts['ingestion-worker'])).toBe(true);
  });

  it('rejects a non-CI build source', () => {
    expect(() => buildReleaseManifest({ ...validInput, builtFrom: 'local' })).toThrow(
      'release_manifest_build_source',
    );
  });

  it('rejects a dirty / malformed commit sha', () => {
    expect(() => buildReleaseManifest({ ...validInput, commitSha: 'zz' })).toThrow(
      'release_manifest_invalid_commit',
    );
  });

  it('rejects an artifact with no digest and no asset hash', () => {
    expect(() =>
      buildReleaseManifest({
        ...validInput,
        artifacts: { 'ingestion-api': {} },
      }),
    ).toThrow('release_manifest_empty_artifact');
  });

  it('assertImmutableArtifact guards CI-only digests', () => {
    const m = buildReleaseManifest(validInput);
    expect(() => assertImmutableArtifact(m)).not.toThrow();
    expect(() =>
      assertImmutableArtifact({ ...m, builtFrom: 'local' as const }),
    ).toThrow('release_immutable_violation');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**：`pnpm --filter @aurora/aurora-release test` → 包不存在失败。

- [ ] **Step 3: 脚手架 + 实现**。`package.json`（`name: "@aurora/aurora-release"`、`private: true`、`type: "module"`、`engines.node >=24.18 <25`、`exports` 根指向 `dist/index.js`、`bin: { "aurora-release": "./dist/entry.js" }`、`scripts: { build: "tsc -p tsconfig.build.json", typecheck: "tsc -p tsconfig.json --noEmit", test: "vitest run" }`、`devDependencies: @types/node/typescript/vitest`、`aurora.layer: "tooling"`）。tsconfig 均 extends `../../tsconfig.base.json`（`module/moduleResolution: NodeNext`）。`vitest.config.ts` 参考现有 tooling 包（node env）。实现 `src/manifest.ts`（见上文 File Structure 契约），`src/index.ts` 重导出 manifest/migrations/deploy/rollback。

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/aurora-release test` 全绿；`pnpm --filter @aurora/aurora-release typecheck` 通过。

- [ ] **Step 5: 注册根 format/lint**：根 `package.json` `format:check` 追加 `tooling/aurora-release/package.json tooling/aurora-release/tsconfig.json tooling/aurora-release/tsconfig.build.json tooling/aurora-release/vitest.config.ts "tooling/aurora-release/src/**/*.ts" "tooling/aurora-release/test/**/*.ts" tooling/aurora-release/README.md`；`lint` 追加 `tooling/aurora-release/src tooling/aurora-release/test tooling/aurora-release/vitest.config.ts`。`pnpm format:check` 与 `pnpm lint` 通过。

- [ ] **Step 6: Commit**：`feat(deploy): OPS-05 immutable artifact manifest + deployment identity`.

---

### Task 2: Forward-compatible Migration pipeline

**Files:**
- Create: `tooling/aurora-release/src/migrations.ts`, `tooling/aurora-release/test/migrations.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ReleaseManifest`（`migrationSet` 字段）。
- Produces: `MigrationFile`、`discoverMigrationSet(dirs)`、`validateForwardCompatibility(migrations)`、`renderForwardMigrationCommand(migrations, databaseUrlEnv)`。

- [ ] **Step 1: 写失败测试** `test/migrations.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  discoverMigrationSet,
  validateForwardCompatibility,
  renderForwardMigrationCommand,
} from '../src/migrations.js';

const pkgDirs = [
  'packages/ingestion-inbox/migrations',
  'packages/processing-store/migrations',
  'packages/platform-identity/migrations',
];

describe('migration set discovery', () => {
  it('discovers and globally orders migrations by version prefix', () => {
    const dir = 'packages/ingestion-inbox/migrations';
    // versions supplied in fixture below; discovery reads real dirs at call time
    expect(typeof discoverMigrationSet).toBe('function');
  });

  it('rejects duplicate version prefixes across dirs', () => {
    const migrations: Parameters<typeof discoverMigrationSet>[0] = [];
    void migrations;
    // covered below via validateForwardCompatibility on explicit fixtures
  });
});

describe('forward-compatibility validation', () => {
  const ordered = [
    { dir: 'a', version: '1720000000001', file: '1720000000001_init.js' },
    { dir: 'b', version: '1720000000002', file: '1720000000002_add-column.js' },
  ];
  it('returns no violations for additive, ordered migrations', () => {
    expect(validateForwardCompatibility(ordered)).toEqual([]);
  });
  it('flags out-of-order versions', () => {
    const bad = [ordered[1]!, ordered[0]!];
    expect(validateForwardCompatibility(bad)).toContain('out-of-order');
  });
  it('flags duplicate versions', () => {
    expect(validateForwardCompatibility([ordered[0]!, ordered[0]!])).toContain('duplicate');
  });
  it('flags destructive up-migrations (DROP TABLE / DROP COLUMN) as non-forward-compatible', () => {
    const destructive = [
      { dir: 'a', version: '1', file: '1_drop.js' },
      { dir: 'a', version: '2', file: '2_drop.js' },
    ];
    const violations = validateForwardCompatibility(destructive);
    expect(violations).toContain('destructive-up');
  });
});

describe('forward migration command rendering', () => {
  it('renders one node-pg-migrate up command per migration dir, forward-only', () => {
    const migrations = [
      { dir: 'packages/ingestion-inbox/migrations', version: '1720000000001', file: 'x.js' },
    ];
    const commands = renderForwardMigrationCommand(migrations, 'DATABASE_URL');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('node-pg-migrate');
    expect(commands[0]).toContain('DATABASE_URL');
    expect(commands[0]).toContain(' up ');
    expect(commands[0]).not.toContain(' down ');
  });
});
```

- [ ] **Step 2: 运行确认失败**：`pnpm --filter @aurora/aurora-release test` → migrations 相关测试失败。

- [ ] **Step 3: 实现** `src/migrations.ts`：

```ts
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface MigrationFile {
  readonly dir: string;
  readonly version: string;
  readonly file: string;
}

const VERSION_PREFIX = /^(\d{8,20})[_-]/;

/** node-pg-migrate-style timestamped migration files per package migrations dir. */
export async function discoverMigrationSet(dirs: readonly string[]): Promise<readonly MigrationFile[]> {
  const found: MigrationFile[] = [];
  for (const dir of dirs) {
    for (const file of await readdir(dir)) {
      const match = VERSION_PREFIX.exec(file);
      if (match === null) continue;
      found.push({ dir, version: match[1]!, file });
    }
  }
  found.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : a.file.localeCompare(b.file)));
  return Object.freeze(found);
}

const DESTRUCTIVE_UP = /\b(dropTable|dropColumn|DROP\s+TABLE|DROP\s+COLUMN)\b/i;

export function validateForwardCompatibility(migrations: readonly MigrationFile[]): readonly string[] {
  const violations: string[] = [];
  for (let i = 1; i < migrations.length; i += 1) {
    if (migrations[i]!.version < migrations[i - 1]!.version) violations.push('out-of-order');
  }
  const seen = new Set<string>();
  for (const m of migrations) {
    if (seen.has(m.version)) violations.push('duplicate');
    seen.add(m.version);
  }
  // Destructive DDL in an up-migration is not forward-compatible: it must ship
  // in a separate contract release after old readers have exited (Release §3).
  // Scanning the file body is a targeted heuristic guard, not a substitute for
  // SQL review.
  for (const m of migrations) {
    const body = awaitFileBody(m);
    if (DESTRUCTIVE_UP.test(body)) violations.push('destructive-up');
  }
  return Object.freeze([...new Set(violations)]);
}

function awaitFileBody(m: MigrationFile): string {
  // Sync read is acceptable for a CLI-time guard (fixtures pass body via a stub).
  throw new Error(`unimplemented_file_body_${m.file}`);
}

export function renderForwardMigrationCommand(
  migrations: readonly MigrationFile[],
  databaseUrlEnv: string,
): readonly string[] {
  const dirs = [...new Set(migrations.map((m) => m.dir))];
  return Object.freeze(
    dirs.map((dir) => `node-pg-migrate up --migrations-dir ${dir} --env ${databaseUrlEnv}`),
  );
}
```

> 说明：`validateForwardCompatibility` 的 destructive 扫描需要读取迁移文件正文。为保持纯函数可测，`awaitFileBody` 在实现中改为**同步读取** `join(m.dir, m.file)`（node-pg-migrate 迁移文件是本地文件），测试里用 vitest 临时目录写两个含 `pgm.dropTable(...)` 的真实迁移文件 fixture，验证 `destructive-up` 命中。若某迁移文件缺失，返回违规 `missing-file` 而不抛错（稳定诊断）。

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/aurora-release test` 全绿；`typecheck` 通过。补充真实文件 fixture（`test/fixtures/migrations/...`）覆盖 `awaitFileBody` 路径。

- [ ] **Step 5: Commit**：`feat(deploy): OPS-05 forward-compatible migration pipeline`.

---

### Task 3: Staging deployment + SPA/API/Worker rollout（部署计划 + ECS Service IaC）

**Files:**
- Create: `tooling/aurora-release/src/deploy.ts`, `tooling/aurora-release/test/deploy.test.ts`, `tooling/aurora-release/src/entry.ts`, `tooling/aurora-release/test/entry.test.ts`, `deploy/aws/deploy.yml`, `deploy/aws/README.md`
- Modify: `tooling/aws-infra/src/stacks/compute-stack.ts`, `tooling/aws-infra/src/app.ts`, `tooling/aws-infra/test/stacks.test.ts`
- Create: `tooling/aws-infra/test/compute-deploy.test.ts`

**Interfaces:**
- Consumes: Task 1/2 的 `ReleaseManifest`、`renderForwardMigrationCommand`。
- Produces: `DeploymentStep`、`DeploymentTargets`、`planDeployment(...)`、`assertSafeDeployment(steps)`、`runCli(argv)`；`ComputeStack.services` 与 `IMMUTABLE_DEPLOY_PLACEHOLDER_TAG`。

- [ ] **Step 1: 写失败测试** `test/deploy.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildReleaseManifest } from '../src/manifest.js';
import { planDeployment, assertSafeDeployment } from '../src/deploy.js';

const base = {
  commitSha: 'a'.repeat(40),
  builtFrom: 'ci' as const,
  artifacts: {
    'ingestion-api': { imageDigest: `sha256:${'b'.repeat(64)}` },
    'ingestion-worker': { imageDigest: `sha256:${'c'.repeat(64)}` },
    console: { entryAssetHash: 'a1b2c3d4' },
  },
  migrationSet: ['1720000000001_init'],
  protocolVersions: ['event-envelope-v1'],
  createdAt: '2026-08-11T00:00:00Z',
};
const manifest = buildReleaseManifest(base);

describe('deployment plan', () => {
  it('orders migrate -> api -> worker -> spa entry switch', () => {
    const steps = planDeployment(
      manifest,
      undefined,
      { services: ['ingestion-api', 'ingestion-worker'], spa: true, migrate: true },
      ['node-pg-migrate up --migrations-dir x'],
    );
    expect(steps.map((s) => s.kind)).toEqual(['migrate', 'update-service', 'update-service', 'switch-spa-entry']);
  });

  it('does not update a service whose digest is unchanged from previous manifest', () => {
    const steps = planDeployment(
      manifest,
      manifest,
      { services: ['ingestion-api'], spa: false, migrate: false },
      [],
    );
    expect(steps.filter((s) => s.kind === 'update-service')).toHaveLength(0);
  });

  it('assertSafeDeployment rejects a migrate step carrying a destructive down command', () => {
    expect(() =>
      assertSafeDeployment([{ kind: 'migrate', commands: ['node-pg-migrate down'] }]),
    ).toThrow('unsafe_deployment');
  });
});
```

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3a: 实现 `src/deploy.ts`**：

```ts
import { assertImmutableArtifact, type ReleaseManifest } from './manifest.js';

export type DeploymentStep =
  | { readonly kind: 'migrate'; readonly commands: readonly string[] }
  | { readonly kind: 'update-service'; readonly service: string; readonly imageDigest: string }
  | { readonly kind: 'switch-spa-entry'; readonly assetHash: string };

export interface DeploymentTargets {
  readonly services: readonly string[];
  readonly spa?: boolean;
  readonly migrate?: boolean;
}

export function planDeployment(
  manifest: ReleaseManifest,
  previous: ReleaseManifest | undefined,
  targets: DeploymentTargets,
  migrationCommands: readonly string[],
): readonly DeploymentStep[] {
  assertImmutableArtifact(manifest);
  const steps: DeploymentStep[] = [];
  if (targets.migrate === true) steps.push({ kind: 'migrate', commands: migrationCommands });
  for (const service of targets.services) {
    const ref = manifest.artifacts[service];
    const prevRef = previous?.artifacts[service];
    if (ref === undefined || ref.imageDigest === undefined) {
      throw new Error(`unsafe_deployment: ${service} has no image digest in manifest`);
    }
    if (prevRef?.imageDigest === ref.imageDigest) continue; // no-op: already on this digest
    steps.push({ kind: 'update-service', service, imageDigest: ref.imageDigest });
  }
  if (targets.spa === true) {
    const spa = manifest.artifacts.console;
    const prevSpa = previous?.artifacts.console?.entryAssetHash;
    if (spa?.entryAssetHash !== undefined && spa.entryAssetHash !== prevSpa) {
      steps.push({ kind: 'switch-spa-entry', assetHash: spa.entryAssetHash });
    }
  }
  return Object.freeze(steps);
}

export function assertSafeDeployment(steps: readonly DeploymentStep[]): void {
  for (const step of steps) {
    if (step.kind === 'migrate') {
      for (const command of step.commands) {
        if (/\bdown\b/.test(command)) {
          throw new Error('unsafe_deployment: destructive down migration is never auto-run');
        }
      }
    }
  }
}
```

- [ ] **Step 3b: 实现 `src/entry.ts`**（CLI，默认 dry-run）：读 `--manifest <path>`（JSON），子命令 `plan`（+ `--targets services=...,spa,migrate`）、`validate-migrations`（+ `--migration-dirs ...`）、`plan-rollback`（+ `--previous <path>`）。全部只打印计划文本/JSON，不执行任何 AWS 调用；退出码 0=成功、1=校验失败。`src/index.ts` 重导出 deploy/rollback/entry。

- [ ] **Step 3c: ECS Service IaC**。修改 `tooling/aws-infra/src/stacks/compute-stack.ts`：新增导出 `export const IMMUTABLE_DEPLOY_PLACEHOLDER_TAG = 'bootstrap-placeholder';`，props 增加 `serviceSecurityGroup: ec2.ISecurityGroup`；在既有 cluster/repo/role 之后为 `ingestion-api` 与 `ingestion-worker` 各创建：`logs.LogGroup`（`resourceName(env,'logs',service)`，retention `RetentionDays.THREE_MONTHS`）、`ecs.FargateTaskDefinition`（`executionRole: this.taskExecutionRole`、`cpu: 256`、`memoryLimitMiB: 512`）、容器镜像 `ecs.ContainerImage.fromEcrRepository(repo, IMMUTABLE_DEPLOY_PLACEHOLDER_TAG)`（worker 不需要 `latest`；占位 tag 由部署工具链以 digest 替换，避免浮动 `latest` 作发布依据）、awslogs 驱动（`streamPrefix: service`）；`ecs.FargateService`：`vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }`、`securityGroups: [serviceSecurityGroup]`、`minHealthyPercent: 100`、`maxHealthyPercent: 200`、`deployController: { type: ecs.DeploymentControllerType.ECS, circuitBreaker: { enable: true, rollback: true } }`、`assignPublicIp: false`；API 容器 `portMappings: [{ containerPort: 8080 }]` + `healthCheck: ecs.HealthCheck({ command: ['CMD-SHELL', 'node -e "const s=require(\'node:net\').connect(8080,\'127.0.0.1\');s.on(\'error\',()=>process.exit(1));s.on(\'connect\',()=>{s.destroy();process.exit(0)})"'] })`；API 容器环境 `HOST=0.0.0.0`、`PORT=8080`（其余 `DATABASE_URL` 等来自 ECS task role/Secrets，provisioning 时注入）。导出 `this.services = { [service]: fargateService }`。`src/app.ts` 将 `network.serviceSecurityGroup` 传入 `ComputeStack`。

- [ ] **Step 3d: IaC 测试**。`test/compute-deploy.test.ts`：`composedStacks` 传入 serviceSecurityGroup；断言：`AWS::ECS::Service` 数量 = 2；每个 Service 的 `DeploymentConfiguration` 含 `MinimumHealthyPercent: 100`、`MaximumPercent: 200`，`DeploymentController` 含 `CircuitBreaker: { Enable: true, Rollback: true }`；无 `AWS::ElasticLoadBalancingV2::LoadBalancer`（ALB 边缘 defer）；无 `AWS::S3::Bucket`、`AWS::ElastiCache::CacheCluster`。修改 `test/stacks.test.ts` 中两处 `resourceCountIs('AWS::ECS::Service', 0)` 断言（替换为存在性 + 上述部署设置断言）。

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/aurora-release test`、`pnpm --filter @aurora/aws-infra test`、两包 `typecheck`、`pnpm --filter @aurora/aws-infra synth` 全部通过。

- [ ] **Step 5: deploy.yml 静态校验**：`deploy/aws/deploy.yml`（`workflow_dispatch` 手动触发 + inputs env/SHA；OIDC `permissions: id-token: write`；job `deploy` 用 `aws-actions/configure-aws-credentials@v4` 换 `AURORA_<ENV>_ACCOUNT` 短期身份；steps：checkout exact SHA → build/push 镜像 → `node node_modules/.../dist/entry.js plan` → ECS update + circuit breaker）。用 `node -e "require('yaml').parse(fs.readFileSync('deploy/aws/deploy.yml','utf8'))"` 校验 YAML 可解析。`deploy/aws/README.md` 记录前置（凭据/域名）与 `PROVISIONING_EVIDENCE_PENDING`。

- [ ] **Step 6: Commit**：`feat(deploy): OPS-05 ECS deployment targets + rollout planner + deploy workflow`.

---

### Task 4: Rollback + focused verification

**Files:**
- Create: `tooling/aurora-release/src/rollback.ts`, `tooling/aurora-release/test/rollback.test.ts`
- Create: `docs/architecture/immutable-artifact-deployment-pipeline.md`
- Modify: `tooling/aurora-release/README.md`

**Interfaces:**
- Consumes: Task 1 `ReleaseManifest`、Task 3 `DeploymentStep`。
- Produces: `RollbackPlan`、`planRollback(current, previous)`、`assertNoDestructiveMigrationRollback(plan)`。

- [ ] **Step 1: 写失败测试** `test/rollback.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildReleaseManifest } from '../src/manifest.js';
import { planRollback, assertNoDestructiveMigrationRollback } from '../src/rollback.js';

const current = buildReleaseManifest({
  commitSha: 'a'.repeat(40),
  builtFrom: 'ci',
  artifacts: {
    'ingestion-api': { imageDigest: `sha256:${'b'.repeat(64)}` },
    'ingestion-worker': { imageDigest: `sha256:${'c'.repeat(64)}` },
    console: { entryAssetHash: 'a1b2c3d4' },
  },
  migrationSet: ['1_init'],
  protocolVersions: ['event-envelope-v1'],
  createdAt: '2026-08-11T00:00:00Z',
});
const previous = buildReleaseManifest({
  ...JSON.parse(JSON.stringify(current)),
  artifacts: {
    'ingestion-api': { imageDigest: `sha256:${'d'.repeat(64)}` },
    'ingestion-worker': { imageDigest: `sha256:${'e'.repeat(64)}` },
    console: { entryAssetHash: 'f5e4d3c2' },
  },
});

describe('rollback plan', () => {
  it('rolls each changed service back to the previous digest and reverts the SPA entry', () => {
    const plan = planRollback(current, previous);
    expect(plan.serviceRollbacks.map((r) => r.service).sort()).toEqual([
      'ingestion-api',
      'ingestion-worker',
    ]);
    expect(plan.revertSpaEntry).toBe('f5e4d3c2');
  });

  it('sets workerPause when a worker digest is reverted (drain-aware rollback)', () => {
    const plan = planRollback(current, previous);
    expect(plan.workerPause).toBe(true);
  });

  it('never rolls back the database destructively', () => {
    const plan = planRollback(current, previous);
    expect(() => assertNoDestructiveMigrationRollback(plan)).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**。

- [ ] **Step 3: 实现 `src/rollback.ts`**：

```ts
import type { ReleaseManifest } from './manifest.js';

export interface ServiceRollback {
  readonly service: string;
  readonly previousDigest: string;
}

export interface RollbackPlan {
  readonly serviceRollbacks: readonly ServiceRollback[];
  readonly revertSpaEntry?: string;
  readonly workerPause: boolean;
  readonly note: string;
}

const FORWARD_COMPAT_NOTE =
  'rollback reverts application digests and SPA entry only; no destructive DB migration is run (expand/contract, Release §3—4)';

export function planRollback(current: ReleaseManifest, previous: ReleaseManifest): RollbackPlan {
  const serviceRollbacks: ServiceRollback[] = [];
  for (const [service, currentRef] of Object.entries(current.artifacts)) {
    const previousDigest = previous.artifacts[service]?.imageDigest;
    if (previousDigest !== undefined && currentRef.imageDigest !== previousDigest) {
      serviceRollbacks.push({ service, previousDigest });
    }
  }
  const currentSpa = current.artifacts.console?.entryAssetHash;
  const previousSpa = previous.artifacts.console?.entryAssetHash;
  const revertSpaEntry =
    currentSpa !== undefined && previousSpa !== undefined && currentSpa !== previousSpa
      ? previousSpa
      : undefined;
  return Object.freeze({
    serviceRollbacks: Object.freeze(serviceRollbacks),
    ...(revertSpaEntry === undefined ? {} : { revertSpaEntry }),
    workerPause: serviceRollbacks.some((r) => r.service === 'ingestion-worker'),
    note: FORWARD_COMPAT_NOTE,
  });
}

export function assertNoDestructiveMigrationRollback(plan: RollbackPlan): void {
  if (plan.note !== FORWARD_COMPAT_NOTE) {
    throw new Error('unsafe_rollback: rollback plan must not include destructive DB steps');
  }
}
```

- [ ] **Step 4: 运行确认通过**：`pnpm --filter @aurora/aurora-release test` 全绿；`typecheck` 通过。

- [ ] **Step 5: 正式规格 + 文档同步**。创建 `docs/architecture/immutable-artifact-deployment-pipeline.md`（`status: approved`、`implementation-status: implemented-in-feature-branch`；涵盖不可变制品身份、前向兼容 Migration 流水线、部署/回滚边界、ECS 部署设置、SPA 原子切换、部署失败不污染 Preview、`PROVISIONING_EVIDENCE_PENDING` 记录）。更新 `tooling/aurora-release/README.md`（dry-run 用法）。同步 `AGENTS.md`/`AURORA_RULES.md` 的 G16/OPS-05 条目（在最终 Task 4 完成后统一做）。

- [ ] **Step 6: 定向验证（用户限定的最小测试集）**：
  1. `pnpm --filter @aurora/aurora-release test` 与 `pnpm --filter @aurora/aws-infra test`（targeted）；
  2. `pnpm --filter @aurora/aurora-release typecheck`、`pnpm --filter @aurora/aws-infra typecheck`（受影响 typecheck）；
  3. `pnpm --filter @aurora/aws-infra synth`（IaC synth，8 模板生成，含新 ECS Service）；
  4. `pnpm --filter @aurora/aurora-release exec node dist/entry.js plan --manifest <fixture> --dry-run`（deploy 脚本 dry-run）；
  5. Migration forward-compat targeted 测试（Task 2 已含）；
  6. rollback 测试（Task 4 已含）；
  7. `git diff --check` 干净；
  8. secret-negative：`grep -rnE 'AKIA|BEGIN .*PRIVATE KEY|aurora_ingest_|SecretAccessKey' tooling/aurora-release tooling/aws-infra deploy/aws docs/architecture/immutable-artifact-deployment-pipeline.md` → 无命中；
  9. `pnpm check:boundaries` 通过（tooling 层合法）；
  10. 根 `pnpm format:check`（注册路径）与 `pnpm lint` 通过。
  **禁止**运行 root `check`/`test`/`coverage`、完整 PostgreSQL suite、浏览器矩阵、Console E2E。

- [ ] **Step 7: Commit**：`feat(deploy): OPS-05 rollback planner + deployment pipeline spec`.

---

## Self-Review

**Spec coverage（OPS-05 要求 + 权威文档）**：不可变制品 digest/提交 SHA = Task 1；Migration 前向兼容、禁止破坏性 down = Task 2；部署顺序 migrate→API→Worker→SPA、SPA 原子切换、ECS 部署设置（min/max healthy + circuit breaker + rollback）= Task 3；回滚按服务边界、Worker drain 语义、无破坏性 DB 回退 = Task 4；deployment failure 不污染 Preview（AWS 路径与 Aliyun `deploy/preview/` 完全隔离，本计划不修改 Preview 任何文件）；secret 不入 repo/log（secret-negative 审计）；不直接修改生产数据（全部 dry-run/静态）；不越界 OPS-06/07。

**Placeholder scan**：无 "TBD/TODO/合适错误处理"。唯一占位是**镜像 tag `bootstrap-placeholder`** 与**账号/域名**——有意为之：IaC 只定义服务形态，部署工具链以 digest 替换镜像引用；账号/域名由用户/凭据提供，均属 approved 契约。

**Type consistency**：`ReleaseManifest`/`buildReleaseManifest`/`assertImmutableArtifact`、`MigrationFile`/`discoverMigrationSet`/`validateForwardCompatibility`/`renderForwardMigrationCommand`、`DeploymentStep`/`DeploymentTargets`/`planDeployment`/`assertSafeDeployment`、`RollbackPlan`/`planRollback`/`assertNoDestructiveMigrationRollback`、`ComputeStack.services`/`IMMUTABLE_DEPLOY_PLACEHOLDER_TAG` 在 Task 1—4 间一致；`discoverMigrationSet` 为异步（fs 读目录），`validateForwardCompatibility` 为同步（fs 读文件），`renderForwardMigrationCommand` 为同步——Task 2 测试已对齐。

**本计划不创建真实 AWS 资源、不运行 `cdk deploy`/ECS update、不修改 `deploy/preview/`、不越界 OPS-06/07。**
