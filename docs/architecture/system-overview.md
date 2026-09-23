# Aurora system overview

Aurora is a private TypeScript monorepo for browser observability collection,
durable ingestion, event processing, and a Vue management console. This page
describes the current source tree; it is not a development plan or decision
history.

## Runtime boundaries

- `@aurora/event-schema` owns versioned event envelopes, runtime validation,
  error/request/performance bodies, and ingestion batch/receipt contracts.
- `@aurora/core`, `@aurora/browser`, the capture plugins, and framework
  adapters collect privacy-filtered browser facts. They do not access server
  storage or platform internals.
- `apps/ingestion-api` authenticates and validates batches, then persists them
  to the Inbox through `@aurora/ingestion-inbox`.
- `apps/ingestion-worker` claims Inbox rows with leases, applies retry and
  dead-letter rules, and invokes the implemented event processors.
- `@aurora/processing-store` owns queryable processing facts, bounded samples,
  and aggregate storage for the implemented event families.
- `apps/platform-api` and `apps/platform-worker` provide authenticated
  management behavior. `@aurora/platform-contract` is the public Platform
  OpenAPI/client/server contract source.
- `apps/console` is the Vue 3 SPA. It consumes the Platform contract and does
  not import database models, queue types, or server-private modules.

## Dependency and data rules

Public package exports are the only cross-package integration boundary; imports
from `src` or `internal` paths are not allowed. Untrusted inputs are validated
at runtime, secrets are never returned in ordinary responses or logs, and
database migrations are applied in declared order by the owning package.

An ingestion receipt means that the batch was durably accepted by the Inbox;
it does not mean that processing, issue creation, aggregation, or queryability
has completed. Processing and management projections must preserve project
scope, idempotency, authorization, and explicit unavailable/stale semantics.

The checked-in contracts are:

- `docs/api/ingestion.openapi.yaml` for batch ingestion;
- `docs/api/platform-openapi-v1.yaml` and its manifest for the management API;
- `@aurora/event-schema` for event and receipt protocol validation.

## Deployment model

The repository's public preview uses the single-host deployment described in
[`docs/operations/public-preview-single-host-deployment.md`](../operations/public-preview-single-host-deployment.md).
Preview Continuous Delivery deploys the exact SHA from a successful Main
Quality Gates run; it does not resolve a mutable "latest" checkout. The
`release` branch, when present, is a stable mirror of a validated `main` SHA
and does not change the preview deployment source.

## Current limits

Resource and behavior event bodies, arbitrary search, unbounded diagnostic
payloads, and production cloud provisioning are outside the current source
contract. Check the relevant package README and machine contract before
assuming an exported name represents a supported end-to-end capability.
