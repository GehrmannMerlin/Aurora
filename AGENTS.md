# Aurora contributor and agent rules

This file is the short execution entry point for the Aurora monorepo. It applies
to the repository root and all descendants. Stable product, architecture,
security, API, protocol, and operational facts belong in the linked documents,
not in this file.

## Authority and document routing

When rules conflict, use this order: higher-level instructions and explicit
user authorization, accepted ADRs, this file and `AURORA_RULES.md`, then module
README files and implementation notes. Stop and report a conflict that changes
the requested scope; do not pick the most convenient interpretation.

Read this file and `AURORA_RULES.md` at the start of every session. Then read
the complete document set for the work:

| Work | Read first |
| --- | --- |
| Product behavior, UX, permissions, lifecycle | [`docs/prd`](docs/prd) and the relevant product-domain document |
| System boundaries, dependencies, deployment architecture | [`docs/architecture`](docs/architecture), relevant ADRs |
| SDK, browser, plugin, or framework work | [`docs/sdk`](docs/sdk), [`docs/protocol`](docs/protocol), relevant package README |
| Public API or transport change | [`docs/api`](docs/api), [`docs/protocol`](docs/protocol), relevant ADR |
| Security, credentials, deletion, retention | [`docs/security`](docs/security), security ADRs, relevant operations docs |
| Test, CI, release, or rollback work | [`docs/testing`](docs/testing), [`docs/operations`](docs/operations), [`docs/releases`](docs/releases) |
| Code or refactoring | [`Aurora 代码规范.md`](Aurora%20代码规范.md), module README, applicable architecture/ADR |
| Documentation change | [`Aurora 文档规范.md`](Aurora%20文档规范.md) and [`docs/README.md`](docs/README.md) |

Accepted ADRs are long-term decisions. Proposed ADRs can explain a question,
but do not authorize implementation. Do not treat a capability name, a design
heading, or a test fixture as an existing API.

## Before changing code

1. Inspect `git status --short`, the current branch, and the relevant history.
   Preserve unrelated user changes; do not reset, checkout, or overwrite them.
2. Confirm the owning package, public exports, dependency-layer rule, migration
   order, and existing tests before editing.
3. For public behavior, update the source contract and its runtime validation,
   implementation, tests, generated artifacts, and documentation together.
4. For database work, use a new or explicitly disposable test database. Keep
   migration order deterministic and test rollback/duplicate behavior where the
   change requires it. Never modify production data during local verification.
5. For browser work, retain the supported browser/device matrix and use stable
   roles, labels, and state assertions. Fix application behavior or deterministic
   synchronization; do not hide failures with sleeps, skipped projects, or
   `continue-on-error`.

Temporary plans, scratch notes, progress reports, handoffs, and implementation
checklists are not repository documentation. Keep them under the ignored
`.work/` directory. Stable conclusions must be written directly to a README,
architecture/API/protocol/security/operations document, or ADR. Do not commit
`.superpowers/`, `docs/superpowers/plans/`, or equivalent process assets.

## Architecture and security guardrails

- Preserve the dependency direction and package layers defined in
  [`AURORA_RULES.md`](AURORA_RULES.md), ADR-006, and the workspace policy.
- Treat `@aurora/event-schema` and the checked-in OpenAPI documents as public
  contract sources. Run their drift/compatibility checks after contract edits.
- Do not add a migration, route, package export, credential flow, or deployment
  resource solely to make a test fixture pass. The owning ADR/specification
  must authorize the boundary.
- Never log or commit private keys, tokens, passwords, session secrets, cloud
  credentials, real database URLs, `.env` files, or user data. If a likely real
  secret is found, stop copying it, report only its path and type, and request
  rotation. This repository has no authorization for history rewriting.
- Keep sensitive values out of test output and final reports. Use redacted
  fixtures and disposable local infrastructure.
- Do not change production deployment sources, server data, or rollback state
  as part of a repository task unless the user explicitly scopes that action.

## Quality gates

Before claiming completion, run the gates applicable to the change and record
the exit status. The full repository gate includes formatting, OpenAPI and
contract drift checks, lint, typecheck, unit tests, coverage, dependency
boundaries, builds, package-entry tests, PostgreSQL integrations, platform
integrations, Chromium tests, the supported browser/device matrix,
accessibility checks, and release validation. GitHub Actions is authoritative
for checks that cannot be reproduced on the local host.

Never lower a threshold, remove a test, narrow a matrix, delete a migration,
or mask a failure to obtain a green result. A flaky test is a defect to make
deterministic and then rerun.

## Git safety and completion

- Do not rewrite history or force-push. Use a short-lived `codex/` or
  task-scoped branch/worktree for implementation when isolation is needed.
- Do not delete branches, tags, files, or migrations until their exact scope is
  verified and the user request clearly authorizes the deletion.
- For branch consolidation, compare tree/content, tests, migrations, CI, and
  deployment behavior in addition to ancestry; squash/rebase history is common.
- Keep commits cohesive and limited to the requested work. Review the staged
  diff before committing.

Work is complete only when the requested behavior is implemented, durable docs
and links are correct, applicable local and remote gates are green, security
hygiene is clean, and `git status --short` is empty in the task worktree. If a
required external check or permission is unavailable, state the exact blocker
and do not claim completion.
