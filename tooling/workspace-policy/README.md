# Workspace Policy

`@aurora/workspace-policy` is a private internal package that validates Aurora Workspace manifests and universal dependency boundaries. It is not published.

## 职责

- Discover direct packages under `apps/*`, `packages/*`, `examples/*`, and `tooling/*`.
- Validate required manifest fields, `@aurora/<kebab-case>` names, and `workspace:*` local dependencies.
- Reject undeclared local imports, dependency cycles, `/src/`, `/internal/`, and unexported subpaths.
- Enforce layer dependency rules: `protocol` rejects every local runtime dependency; `sdk-core` accepts only `protocol`.
- Scan `sdk-core` source for forbidden browser globals and module-level mutable state.
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

## 层级与环境规则

- `protocol` 层（如 `@aurora/event-schema`）声明的任何本地运行时依赖都被 `forbidden-layer-dependency` 拒绝。
- `sdk-core` 层（如 `@aurora/core`）只允许依赖 `protocol` 层；依赖 `sdk-browser`、`sdk-plugin`、`framework` 或 `tooling` 层被拒绝。
- 跨包导入 `@aurora/<name>/src/*`、`@aurora/<name>/internal/*` 或未导出子路径被 `private-path-import` 拒绝；依赖图循环被 `dependency-cycle` 拒绝，检查覆盖全部 Workspace 包。
- `sdk-core` 源码引用 `window`、`document`、`navigator`、`location`、`fetch`、`XMLHttpRequest`、`localStorage`、`sessionStorage` 及 DOM 类型标识符被 `forbidden-runtime-global` 拒绝。
- `sdk-core` 源码顶层 `let`/`var` 或顶层可变容器（`new`、数组字面量、对象字面量）被 `mutable-module-state` 拒绝。

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
