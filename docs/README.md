# Aurora documentation

This directory contains the stable documentation needed to understand, use,
develop, test, deploy, operate, secure, and release Aurora. Historical planning
and agent execution artifacts are intentionally not part of the documentation
tree.

## Product and user behavior

- [Platform product domains](prd/platform-product-domains.md)
- [Console UX, UI, and accessibility](prd/console-ux-ui-and-accessibility.md)
- [Console UX/UI redesign](prd/console-ux-ui-redesign.md)
- [Console navigation shell](prd/console-navigation-shell.md)

## Architecture

- [System overview](architecture/system-overview.md)
- [Monorepo and build](architecture/monorepo-and-build.md)
- [SDK architecture](architecture/sdk-architecture.md)
- [Platform frontend](architecture/platform-frontend.md)
- [Platform frontend shell](architecture/platform-frontend-shell.md)
- [Platform backend](architecture/platform-backend.md)
- [Platform backend design](architecture/platform-backend-design.md)
- [Platform frontend technology stack](architecture/platform-frontend-technology-stack.md)
- [Platform workspace and organization governance](architecture/platform-workspace-organization-governance.md)
- [Console visual language](architecture/console-visual-language.md)
- [CI quality workflows](architecture/ci-quality-workflows.md)
- [Deployment architecture](architecture/deployment.md)
- [Processing, query, alert, issue, and retention architecture](architecture)

## ADRs

- [ADR index](adr/README.md)
- [ADR-001—ADR-036](adr)

## SDK and browser

- [SDK documents](sdk)
- [Core foundation](sdk/sdk-core-foundation.md)
- [Browser environment and lifecycle](sdk/browser-environment-foundation.md)
- [Error, request, and performance capture](sdk/error-capture-plugin.md)
- [Framework adapters](sdk/vue-framework-adapter.md)

## API and protocol

- [Ingestion OpenAPI](api/ingestion.openapi.yaml)
- [Platform OpenAPI v1](api/platform-openapi-v1.yaml)
- [Platform OpenAPI implementation](api/platform-openapi-and-implementation.md)
- [Event and ingestion protocols](protocol)

## Security

- [Security documents](security)
- [Account deletion and data lifecycle](security/account-deletion-and-data-lifecycle.md)
- [Ingestion credential storage and verification](security/ingestion-client-credential-storage-and-verification.md)
- [Platform identity and authentication](security/platform-identity-authentication.md)

## Testing and quality

- [Test strategy](testing/test-strategy.md)
- [Testing, deployment, and release](testing/testing-deployment-release.md)
- [Ingestion capacity and resilience benchmark](testing/ingestion-capacity-and-resilience-benchmark.md)

## Operations and release

- [Operations documents](operations)
- [Preview Continuous Delivery](operations/preview-continuous-delivery.md)
- [Public preview deployment](operations/public-preview-single-host-deployment.md)
- [Backup and recovery](operations/backup-and-recovery.md)
- [SDK release and package versioning](releases/sdk-package-versioning-and-release.md)
- [Migration and rollback](releases/release-migration-and-rollback.md)

## Module documentation

Every application, package, and maintained tooling area may have a local
`README.md` describing its boundary, exports, configuration, and tests. The
workspace packages are listed in the root [`README.md`](../README.md); use the
module README beside the code as the authoritative entry point for that module.
