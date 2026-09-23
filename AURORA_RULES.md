# Aurora current repository rules

This is a compact snapshot of the current source tree, not a progress ledger.
Use [`docs/README.md`](docs/README.md) and the module READMEs for stable
documentation.

## System shape

Aurora is a private TypeScript monorepo for browser observability, durable
ingestion, event processing, and a Vue 3 management console. The dependency
layers are enforced by `tooling/workspace-policy`.

1. Browser SDK packages collect privacy-filtered facts.
2. Ingestion HTTP and client-credential packages authenticate and durably
   accept batches into the Inbox.
3. Worker and processing-store packages claim, process, and persist event data.
4. Platform API/worker packages expose authenticated management behavior.
5. The console consumes the versioned Platform contract.

The detailed current boundary map is [`docs/architecture/system-overview.md`](docs/architecture/system-overview.md).

## Current modules

The source tree includes `@aurora/event-schema`, `@aurora/core`,
`@aurora/browser`, the error/request/performance and Vue/React plugins,
`@aurora/ingestion-inbox`, `@aurora/ingestion-credentials`,
`@aurora/processing-store`, and the platform contract, identity,
organization, project, credential, audit, admin, policy, release, session,
and email packages. Applications include `apps/ingestion-api`,
`apps/ingestion-worker`, `apps/platform-api`, `apps/platform-worker`, and
`apps/console`.

Package and application READMEs are the authoritative local entry points for
exports, configuration, and commands. Do not infer end-to-end support from an
exported type alone; check its tests and the current public contract.

## Contracts and safety

- `docs/api/ingestion.openapi.yaml` is the ingestion HTTP contract.
- `docs/api/platform-openapi-v1.yaml` and its manifest are the Platform API
  contract.
- `@aurora/event-schema` owns event envelopes and runtime protocol validation.
- PostgreSQL migrations are schema history and must run in declared order.
- Secrets are one-time or hashed where applicable; never expose secret
  material in logs, ordinary responses, or committed fixtures.
- Cross-package imports use public package exports, never private source paths.

## Supported and bounded capability

Implemented source areas include versioned event envelopes; error, request,
performance, and ingestion-batch contracts; browser lifecycle and observation;
SDK plugin composition; authenticated ingestion; Inbox leases, retry budget,
backoff, and dead-letter replay; processing aggregates and bounded samples;
Platform API/client/server adapters; and the authenticated console foundation.

Resource and behavior event bodies, unbounded diagnostics, general search,
production cloud provisioning, and any feature without a tested package and
public contract remain outside the current supported surface.

## Deployment and release

`main` is the development and integration branch. Preview Continuous Delivery
deploys the exact SHA from a successful Main Quality Gates run. The `release`
branch is a stable mirror of a validated `main` SHA when it exists; it does
not change the preview deployment source. Current runbooks are in
[`docs/operations`](docs/operations) and release procedures are in
[`docs/releases`](docs/releases).

## Temporary files

Planning, scratch, progress, handoff, approval, and implementation-process
files belong under ignored `.work/` and must not be committed. Do not create a
new status ledger for routine work.
