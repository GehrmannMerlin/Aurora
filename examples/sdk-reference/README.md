# @aurora/sdk-reference

Aurora SDK reference fixture for the OPS-02 compatibility / device / accessibility /
performance reference validation. **Not a product application** — it exists only to give
browser, device, accessibility and performance reference validation a fixed, versioned,
repeatable host page.

## Scope

- **SDK reference composition**: `createAuroraSdk` + browser environment + the three
  capture plugins (error / request / performance) + the reliable delivery chain with a
  stub transport. Synthetic events only; no real reporting endpoint.
- **Cross-engine matrix**: the same reference page runs on Chromium, Firefox and WebKit
  (Playwright engines approved by `docs/testing/test-strategy.md` §4), plus two
  representative mobile viewports (Pixel 5 / Android Chrome, iPhone 14 / iOS Safari).
- **Performance reference**: a fixed-environment init-p95 harness against the approved
  budgets (`test-strategy.md` §5): desktop p95 ≤ 20 ms, mid-tier mobile p95 ≤ 50 ms.

## Scripts

| Script             | Runs                                 | Local | CI                     |
| ------------------ | ------------------------------------ | ----- | ---------------------- |
| `test`             | reference matrix contract unit test  | ✅    | PR / nightly / release |
| `test:browser`     | chromium-desktop SDK reference smoke | ✅    | PR / nightly / release |
| `test:matrix`      | full engine + device matrix          | ❌    | nightly / release      |
| `test:performance` | fixed init-p95 performance reference | ❌    | release                |

## Matrix contract

`src/matrix.ts` is the executable form of the approved matrix (browser engines, device
viewport classes, accessibility standard, performance budgets, CI placement). It is
verified against the approved sources by `test/matrix-contract.test.ts`. Do not change
these values without changing the approved documents they mirror.

## Non-goals

- No product business logic, no real data, no real ingestion endpoint.
- No SDK public behavior changes; the fixture composes the published `@aurora/*` API only.
- No Firefox / WebKit / full matrix / full performance run locally (CI only).
- Real Safari / real mobile device evidence remains deferred (`TDR-GAP-06`).
