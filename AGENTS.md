# Aurora contributor and agent rules

This is the repository's short execution entry point. Stable product, API,
protocol, security, testing, deployment, and module facts belong in the linked
documentation, not in this file.

## Document routing

Read this file and [`AURORA_RULES.md`](AURORA_RULES.md) at the start of every
session. Then read the applicable current documents:

| Work | Read first |
| --- | --- |
| Architecture and boundaries | [`docs/architecture/system-overview.md`](docs/architecture/system-overview.md) |
| SDK, browser, plugin, or protocol work | the public package README, checked-in API contract, and tests |
| API or transport change | [`docs/api`](docs/api), the public package README, and tests |
| Security, credentials, deletion, or retention | the relevant package README and operations document |
| Testing, release, rollback, or deployment | [`docs/testing/test-strategy.md`](docs/testing/test-strategy.md), [`docs/operations`](docs/operations), and [`docs/releases`](docs/releases) |
| Code or refactoring | the relevant module README, source contract, and tests |
| Documentation change | [`docs/README.md`](docs/README.md) and the affected stable document |

When requirements conflict, stop and report the conflict. Do not infer an API
or capability from a name, a fixture, or an old document.

## Before changing code

1. Check `git status --short`, the current branch, the owning package, public
   exports, dependency boundaries, migration order, and relevant tests.
2. Preserve unrelated user changes. Never reset, force-push, or overwrite
   work that is outside the requested scope.
3. For public behavior, update the source contract, runtime validation,
   implementation, tests, generated artifacts, and stable documentation
   together.
4. For database work, use a disposable test database and keep migration order
   deterministic. Never modify production data during verification.
5. For browser work, preserve the supported device matrix and use deterministic
   state assertions; do not hide failures with sleeps, skips, or
   `continue-on-error`.

Temporary plans, scratch notes, progress reports, handoffs, approval packages,
and implementation checklists are not repository documentation. Keep them in
the ignored `.work/` directory. Do not commit `.superpowers/` or equivalent
agent-process assets; stable conclusions go directly into a README, the
architecture overview, an API/protocol document, or an operations document.

## Safety and quality

- Treat `@aurora/event-schema` and the checked-in OpenAPI files as public
  contract sources; run their checks after contract changes.
- Keep public package boundaries and dependency direction intact. Do not add a
  route, migration, credential flow, export, or deployment resource merely to
  satisfy a fixture.
- Never commit private keys, tokens, passwords, session secrets, cloud
  credentials, real database URLs, `.env` files, or user data. If a likely
  real secret is found, stop copying it, report only its path and type, and
  request rotation. History rewriting is out of scope.
- Do not change production deployment sources or server data unless the user
  explicitly includes that action.
- Do not lower a quality threshold, delete a test or migration, narrow a
  browser matrix, or mask a failure to obtain a green result.

Run the checks applicable to the requested change and record their exit status.
GitHub Actions is authoritative for checks that cannot be reproduced locally.

## Git and completion

Use a short-lived task branch when isolation is needed. Keep commits cohesive,
review the staged diff, and do not rewrite history. Destructive deletion is
allowed only when the exact targets are verified and the user has authorized
it. A task is complete only when the requested files and links are correct,
the applicable checks pass, and the task worktree is clean.
