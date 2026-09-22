# Aurora current repository rules

This is the compact snapshot of the repository as it exists today. It is not a
progress ledger. Detailed behavior and long-lived decisions live in the
documents linked from [`docs/README.md`](docs/README.md) and in accepted ADRs.

## Product and system shape

Aurora is a TypeScript private monorepo for browser observability collection,
durable ingestion, event processing, and a Vue 3 management console. The
workspace policy enforces layer-aware dependencies and package boundaries.

The stable system boundaries are:

1. Browser SDK and framework adapters collect privacy-filtered facts.
2. Ingestion HTTP and client credentials authenticate and durably accept event
   batches into the Inbox.
3. Worker processing claims Inbox rows with leases, applies bounded retry and
   dead-letter rules, and persists queryable processing data.
4. The platform API and worker expose authenticated management behavior through
   the versioned Platform OpenAPI contract.
5. The console is a Vue SPA that consumes the platform contract and provides
   workspace/project monitoring, onboarding, settings, access, releases, and
   policy surfaces.

Cross-boundary decisions are recorded in [`docs/adr`](docs/adr). Do not move a
database, credential, session, event, or deployment responsibility between
boundaries without an accepted ADR and updated stable documentation.

## Real modules

The main implemented packages and applications include:

- `@aurora/workspace-policy`, `@aurora/event-schema`, `@aurora/core`, and
  `@aurora/browser`;
- `@aurora/plugin-error`, `@aurora/plugin-request`, `@aurora/plugin-performance`,
  `@aurora/plugin-vue`, and `@aurora/plugin-react`;
- `@aurora/ingestion-inbox`, `@aurora/ingestion-credentials`,
  `@aurora/processing-store`, and `@aurora/ingestion-benchmark`;
- `@aurora/platform-contract`, `@aurora/platform-identity`,
  `@aurora/platform-organization`, `@aurora/platform-project-governance`,
  `@aurora/platform-credentials`, `@aurora/platform-audit`,
  `@aurora/platform-admin`, `@aurora/platform-policy`,
  `@aurora/platform-releases`, `@aurora/platform-session`, and
  `@aurora/platform-email`;
- `apps/ingestion-api`, `apps/ingestion-worker`, `apps/platform-api`,
  `apps/platform-worker`, and `apps/console`;
- `tooling/platform-contract-drift`, `tooling/ingestion-openapi-contract`,
  `tooling/ingestion-benchmark`, `tooling/workspace-policy`, and the checked-in
  release/IaC tooling under `tooling/`.

Package README files describe the public entry points and local test commands.
Do not infer that every exported design surface is production-complete; check
the package and the applicable stable specification.

## Supported and deferred capability

The repository currently has versioned event envelopes and error, request,
performance, and ingestion-batch contracts; browser lifecycle, error, request,
and performance observation; SDK plugin composition; authenticated ingestion;
Inbox leases, retry budget, backoff, dead-letter replay; processing stores for
the implemented event families; the Platform OpenAPI/client/server adapters;
and the authenticated console/platform foundations.

The following remain intentionally bounded or deferred unless a newer accepted
ADR and stable specification says otherwise: arbitrary resource-event bodies,
behavior-event bodies and behavior plugins, unrestricted event payloads,
unbounded diagnostic samples, percentile/histogram aggregation, source-map
symbolication beyond the implemented bounded flow, a general search service,
and production cloud/IaC changes not covered by the deployment documents.

The worker composition root must not claim complete routing for an event family
whose processor and storage contract are not approved and implemented. Current
deployment and operations facts are in [`docs/operations`](docs/operations),
not in this file.

## Data, security, and public contracts

- PostgreSQL migrations are the physical schema history. Run them in declared
  order; application startup must not silently mutate schema.
- Ingestion credentials use one-time client-key return, hashed verification,
  constant-time comparison, origin/environment checks, and explicit lifecycle
  transitions. Do not expose secret material in logs or APIs.
- Session, CSRF, account deletion, retention, audit, and object-storage rules
  are security decisions. Read the relevant ADR and security document before
  changing them.
- `docs/api/ingestion-openapi.yaml` and
  `docs/api/platform-openapi-v1.yaml` are machine contracts. Generated or
  manifest artifacts must remain in sync with their source and drift tests.
- `@aurora/event-schema` is the protocol source of truth. Consumers validate at
  runtime and preserve stable error/status semantics.

## Documentation map

- Product behavior and console UX: [`docs/prd`](docs/prd)
- Architecture and component boundaries: [`docs/architecture`](docs/architecture)
- Long-term decisions: [`docs/adr`](docs/adr)
- SDK and browser implementation: [`docs/sdk`](docs/sdk)
- Public API and generated contracts: [`docs/api`](docs/api)
- Event and ingestion protocols: [`docs/protocol`](docs/protocol)
- Security and lifecycle rules: [`docs/security`](docs/security)
- Testing and quality strategy: [`docs/testing`](docs/testing)
- Operations and deployment: [`docs/operations`](docs/operations)
- Release and rollback: [`docs/releases`](docs/releases)
- Package/application entry points: module `README.md` files

## Branch and release model

`main` is the development and integration branch. CI runs the Main Quality
Gates on `main`; pull-request checks target `main`. Preview Continuous Delivery
deploys the exact SHA from a successful Main Quality Gates `workflow_run` and
does not resolve “latest main” or use a mutable release checkout. Manual SDK
release validation is defined by `.github/workflows/release.yml` and the
release documents.

The repository may maintain a `release` branch as a stable mirror of a fully
validated `main` commit. Creating or advancing it requires green release
evidence; it does not by itself change preview/server deployment behavior.

## Current implementation limits

Some production concerns remain outside the repository’s implemented surface:
real cloud capacity evidence and cost validation, production secrets and
infrastructure provisioning, complete CI protection configuration, and any
event processor or platform feature not represented by a tested package and
contract. Report these as concrete limitations when relevant; do not create a
new status ledger or silently widen scope.
