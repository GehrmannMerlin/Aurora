# Request Event Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first `@aurora/event-schema` request-event increment: request method/outcome constants, a minimal safe request body (`method`, `url`, `startedAt`, `durationMs`, `outcome`, optional `statusCode`), a synchronous body parser, a request-envelope parser, shared contract samples, and SDK/ingestion/processing consumer contracts — all derived from the approved PRD request-monitoring rules, without touching Browser, Core, plugins, fetch/XHR proxying, queues, or transport.

**Architecture:** The request contract extends the existing `EventEnvelope` with `EventType.Request` (already approved). It mirrors the error-event contract structure exactly: `request-event-types.ts` owns constants and types; `request-event-body.ts` parses bodies; `request-event-envelope.ts` reuses `parseEventEnvelope` then requires `eventType: "request"`. Two neutral helpers are extracted from the error implementation (`field-validation.ts`, `safe-url.ts`) so error and request code share them without duplicating URL sanitization or field validation; `error-event-validation.ts` becomes a re-export shim so no existing error consumer changes. URL query/fragment are stripped before any query value is read; forbidden fields are rejected by the existing generic boundary scan plus an exact allow-list.

**Tech Stack:** TypeScript 6.0.3 strict mode, pnpm 11.17.0 Workspace, Node.js 24.18.x task runtime, Vitest 4.1.10, V8 coverage, ESLint 10.8.0, Prettier 3.9.6, existing `@aurora/workspace-policy`.

## Global Constraints

- Implement only inside `packages/event-schema`; do not add Browser request observation, `packages/plugin-request`, fetch/XHR proxying, Core, server, database, platform, CI, release, container, IaC, or cloud code.
- `@aurora/event-schema` remains zero-runtime-dependency, zero local Workspace dependency, `aurora.layer: protocol`, `sideEffects: false`, with exactly two public entries (`"."` and `"./contract-testkit"`).
- Do not change the public API of existing envelope, error-event, or contract-testkit symbols. `parseEventEnvelope`, `EventEnvelope.body: unknown`, `EventType`, `CURRENT_PROTOCOL_VERSION`, and all existing error sample entry names stay unchanged.
- Do not create a second envelope, protocol version, event ID, time, queue, batch, sender, retry path, sampler, deduplicator, grouping key, fingerprint, Source Map, or general event bus.
- Do not access `window`, `document`, DOM types, Node runtime modules, Core, Browser, plugins, or any cross-package `src`/`internal` path from production source.
- The request contract never collects Cookie, Authorization, Token, request/response body, request/response headers, request/response sizes, form data, DOM, page text, user input, Storage, full URL query/fragment, fingerprint, or IP.
- Diagnostics/issues contain no exception object/message/stack, event body, URL, or input value; production source does not call `console`.
- TypeScript remains `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`; public functions have explicit parameter and return types.
- Do not use unexplained `any`, `Object`, `Function`, `Record<string, any>`, double assertions, non-null assertions, or error-suppression directives.
- Files use `kebab-case`; types/interfaces use `PascalCase`; functions/variables use `camelCase`; booleans use `is`, `has`, `can`, or `should`.
- Do not create `utils`, `helpers`, `common`, or `misc`; every source file has the single responsibility listed below.
- Coverage thresholds stay lines 85%, branches 80%, functions 85%, statements 85%; do not exclude new production decision files or lower thresholds.
- Each task uses the red-green-minimal implementation-regression sequence and ends with a suggested, narrowly scoped commit boundary. Do not stage or commit unrelated pre-existing work.
- The specification is `docs/protocol/request-event-contract.md`; if code and this plan differ, stop and resolve the specification before broadening the implementation.

## Complete File Tree and Responsibilities

```text
packages/event-schema/
├── src/
│   ├── constants.ts                     # unchanged
│   ├── error-descriptor.ts              # unchanged (imports from error-event-validation shim)
│   ├── error-event-body.ts              # unchanged (imports from error-event-validation shim)
│   ├── error-event-envelope.ts          # unchanged
│   ├── error-event-types.ts             # unchanged
│   ├── error-event-validation.ts        # becomes a re-export shim over field-validation.ts (same names)
│   ├── event-envelope.ts                # unchanged
│   ├── event-types.ts                   # unchanged
│   ├── field-validation.ts              # NEW neutral field helpers (moved from error-event-validation.ts)
│   ├── index.ts                         # add request exports
│   ├── javascript-error-event.ts        # unchanged (imports from error-event-validation shim)
│   ├── promise-rejection-error-event.ts # unchanged (imports from error-event-validation shim)
│   ├── request-event-body.ts            # NEW parseRequestEventBody
│   ├── request-event-envelope.ts        # NEW parseRequestEventEnvelope
│   ├── request-event-types.ts           # NEW RequestMethod/RequestOutcome/REQUEST_EVENT_LIMITS/types
│   ├── resource-error-event.ts          # switch URL sanitizing to ./safe-url.js
│   ├── safe-url.ts                      # NEW neutral safe HTTP URL sanitizer (moved from resource-error-event.ts)
│   ├── validation-issues.ts             # unchanged
│   ├── value-boundaries.ts              # unchanged
│   └── contract-testkit/
│       ├── boundary-error-event-samples.ts   # unchanged
│       ├── boundary-request-event-samples.ts # NEW
│       ├── boundary-samples.ts               # unchanged
│       ├── index.ts                     # add request sample exports
│       ├── invalid-error-event-samples.ts    # unchanged
│       ├── invalid-request-event-samples.ts  # NEW
│       ├── invalid-samples.ts                # unchanged
│       ├── valid-error-event-samples.ts      # unchanged
│       ├── valid-request-event-samples.ts    # NEW
│       └── valid-samples.ts                  # unchanged
└── test/
    ├── architecture-boundary.test.ts    # extend source forbidden scan stays green; no new entries
    ├── error-event-envelope.test.ts     # unchanged (regression)
    ├── error-event-types.test.ts        # unchanged (regression)
    ├── javascript-error-event.test.ts   # unchanged (regression)
    ├── package-entry.test.ts            # extend root + contract-testkit + private paths
    ├── promise-rejection-error-event.test.ts # unchanged (regression)
    ├── request-event-body.test.ts       # NEW
    ├── request-event-envelope.test.ts   # NEW
    ├── request-event-types.test.ts      # NEW
    ├── resource-error-event.test.ts     # unchanged (regression)
    └── consumers/
        ├── ingestion-error-event.contract.test.ts   # unchanged (regression)
        ├── ingestion-request-event.contract.test.ts # NEW
        ├── processing-error-event.contract.test.ts  # unchanged (regression)
        ├── processing-request-event.contract.test.ts# NEW
        ├── sdk-error-event.contract.test.ts         # unchanged (regression)
        └── sdk-request-event.contract.test.ts       # NEW
```

Existing files modified by this plan:

```text
packages/event-schema/src/error-event-validation.ts
packages/event-schema/src/resource-error-event.ts
packages/event-schema/src/index.ts
packages/event-schema/src/contract-testkit/index.ts
packages/event-schema/test/package-entry.test.ts
packages/event-schema/test/documentation-contract.test.ts
packages/event-schema/README.md
docs/protocol/event-envelope-v1.md
docs/README.md
docs/architecture/system-overview.md
docs/architecture/sdk-architecture.md
docs/architecture/formalization-readiness.md
docs/adr/ADR-005-event-schema-source-of-truth.md
docs/adr/ADR-006-one-way-dependencies.md
docs/adr/ADR-003-sdk-plugin-architecture.md
AGENTS.md
AURORA_RULES.md
README.md
```

## Frozen Public Signatures

All symbols below export from the `@aurora/event-schema` root. Sample types export from `@aurora/event-schema/contract-testkit`.

```ts
export const RequestMethod = Object.freeze({
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Head: 'HEAD',
  Options: 'OPTIONS',
} as const);

export type RequestMethod = (typeof RequestMethod)[keyof typeof RequestMethod];

export const RequestOutcome = Object.freeze({
  Success: 'success',
  HttpError: 'http_error',
  NetworkError: 'network_error',
  Timeout: 'timeout',
  Canceled: 'canceled',
} as const);

export type RequestOutcome = (typeof RequestOutcome)[keyof typeof RequestOutcome];

export const REQUEST_EVENT_LIMITS = Object.freeze({
  maxRequestUrlLength: 2048,
  maxStatusCode: 599,
  minStatusCode: 100,
} as const);

export interface RequestEventBody {
  readonly method: RequestMethod;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: RequestOutcome;
  readonly statusCode?: number;
}

export interface RequestEventEnvelope extends EventEnvelope {
  readonly eventType: typeof EventType.Request;
  readonly body: RequestEventBody;
}

export interface RequestEventBodyParseSuccess {
  readonly success: true;
  readonly data: RequestEventBody;
}
export type RequestEventBodyParseFailure = EventEnvelopeParseFailure;
export type RequestEventBodyParseResult = RequestEventBodyParseSuccess | RequestEventBodyParseFailure;

export interface RequestEventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: RequestEventEnvelope;
}
export type RequestEventEnvelopeParseFailure = EventEnvelopeParseFailure;
export type RequestEventEnvelopeParseResult =
  RequestEventEnvelopeParseSuccess | RequestEventEnvelopeParseFailure;

export function parseRequestEventBody(input: unknown): RequestEventBodyParseResult;
export function parseRequestEventEnvelope(input: unknown): RequestEventEnvelopeParseResult;
```

Both parsers are synchronous, deterministic, non-throwing for ordinary invalid input. Successful results are newly constructed; inputs are never modified. The request body is an exact allow-list of six fields; `statusCode` is the only optional field.

---

### Task 1: Freeze Request Types, Constants, and Root Exports

**Files:**

- Create: `packages/event-schema/src/request-event-types.ts`
- Create: `packages/event-schema/test/request-event-types.test.ts`
- Modify: `packages/event-schema/src/index.ts`

**Interfaces:**

- Consumes: `EventEnvelope`, `EventType`, `EventType.Request`, `EventEnvelopeParseFailure`.
- Produces: `RequestMethod`, `RequestOutcome`, `REQUEST_EVENT_LIMITS`, and all request body/envelope/result types, exported from the root.

- [ ] **Step 1: Write the failing request-types test**

Create `packages/event-schema/test/request-event-types.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  REQUEST_EVENT_LIMITS,
  RequestMethod,
  RequestOutcome,
  type RequestEventBody,
  type RequestEventEnvelope,
} from '../src/index.js';

describe('request event contract types', () => {
  it('exports the exact stable runtime constants', () => {
    expect(RequestMethod).toEqual({
      Get: 'GET',
      Post: 'POST',
      Put: 'PUT',
      Patch: 'PATCH',
      Delete: 'DELETE',
      Head: 'HEAD',
      Options: 'OPTIONS',
    });
    expect(RequestOutcome).toEqual({
      Success: 'success',
      HttpError: 'http_error',
      NetworkError: 'network_error',
      Timeout: 'timeout',
      Canceled: 'canceled',
    });
    expect(REQUEST_EVENT_LIMITS).toEqual({
      maxRequestUrlLength: 2048,
      maxStatusCode: 599,
      minStatusCode: 100,
    });
    expect(Object.isFrozen(RequestMethod)).toBe(true);
    expect(Object.isFrozen(RequestOutcome)).toBe(true);
    expect(Object.isFrozen(REQUEST_EVENT_LIMITS)).toBe(true);
  });

  it('narrows the request envelope and body types', () => {
    expectTypeOf<RequestEventEnvelope['eventType']>().toEqualTypeOf<'request'>();
    expectTypeOf<RequestEventEnvelope['body']>().toEqualTypeOf<RequestEventBody>();
    expectTypeOf<RequestEventBody['statusCode']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<RequestMethod>().toEqualTypeOf<
      'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
    >();
    expectTypeOf<RequestOutcome>().toEqualTypeOf<
      'success' | 'http_error' | 'network_error' | 'timeout' | 'canceled'
    >();
  });
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/request-event-types.test.ts
```

Expected: exit 1 because `request-event-types.js` does not exist.

- [ ] **Step 3: Implement the request types**

Create `packages/event-schema/src/request-event-types.ts`:

```ts
import type { EventEnvelope } from './event-envelope.js';
import type { EventType } from './event-types.js';
import type { EventEnvelopeParseFailure } from './validation-issues.js';

export const RequestMethod = Object.freeze({
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Head: 'HEAD',
  Options: 'OPTIONS',
} as const);

export type RequestMethod = (typeof RequestMethod)[keyof typeof RequestMethod];

export const RequestOutcome = Object.freeze({
  Success: 'success',
  HttpError: 'http_error',
  NetworkError: 'network_error',
  Timeout: 'timeout',
  Canceled: 'canceled',
} as const);

export type RequestOutcome = (typeof RequestOutcome)[keyof typeof RequestOutcome];

export const REQUEST_EVENT_LIMITS = Object.freeze({
  maxRequestUrlLength: 2048,
  maxStatusCode: 599,
  minStatusCode: 100,
} as const);

export interface RequestEventBody {
  readonly method: RequestMethod;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: RequestOutcome;
  readonly statusCode?: number;
}

export interface RequestEventEnvelope extends EventEnvelope {
  readonly eventType: typeof EventType.Request;
  readonly body: RequestEventBody;
}

export interface RequestEventBodyParseSuccess {
  readonly success: true;
  readonly data: RequestEventBody;
}

export type RequestEventBodyParseFailure = EventEnvelopeParseFailure;
export type RequestEventBodyParseResult = RequestEventBodyParseSuccess | RequestEventBodyParseFailure;

export interface RequestEventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: RequestEventEnvelope;
}

export type RequestEventEnvelopeParseFailure = EventEnvelopeParseFailure;
export type RequestEventEnvelopeParseResult =
  RequestEventEnvelopeParseSuccess | RequestEventEnvelopeParseFailure;
```

Extend `packages/event-schema/src/index.ts`. The merged value+type exports must NOT be repeated in the type-only block (TS2300 under `verbatimModuleSyntax`); a single unqualified value export carries both.

```ts
export {
  REQUEST_EVENT_LIMITS,
  RequestMethod,
  RequestOutcome,
} from './request-event-types.js';
export type {
  RequestEventBody,
  RequestEventBodyParseFailure,
  RequestEventBodyParseResult,
  RequestEventBodyParseSuccess,
  RequestEventEnvelope,
  RequestEventEnvelopeParseFailure,
  RequestEventEnvelopeParseResult,
  RequestEventEnvelopeParseSuccess,
} from './request-event-types.js';
```

- [ ] **Step 4: Run and verify pass**

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/request-event-types.test.ts
pnpm --filter @aurora/event-schema typecheck
```

Expected: exit 0; both tests pass; no type diagnostics.

- [ ] **Step 5: Run package and error regression**

```powershell
pnpm --filter @aurora/event-schema test
```

Expected: exit 0; existing 16 test files / 102 tests remain green.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/event-schema/src/request-event-types.ts packages/event-schema/test/request-event-types.test.ts packages/event-schema/src/index.ts
git commit -m "feat: add request event contract types"
```

### Task 2: Extract Neutral Helpers and Parse the Request Body

**Files:**

- Create: `packages/event-schema/src/field-validation.ts`
- Create: `packages/event-schema/src/safe-url.ts`
- Create: `packages/event-schema/src/request-event-body.ts`
- Create: `packages/event-schema/test/request-event-body.test.ts`
- Modify: `packages/event-schema/src/error-event-validation.ts`
- Modify: `packages/event-schema/src/resource-error-event.ts`

**Interfaces:**

- Consumes: `REQUEST_EVENT_LIMITS`, `RequestMethod`, `RequestOutcome`, `RequestEventBody`, `EventSchemaIssue`, `validateBodyValue`, neutral field helpers, neutral `sanitizeHttpUrl`.
- Produces: `parseRequestEventBody(input: unknown): RequestEventBodyParseResult`, with exact six-field allow-list and safe URL output.

- [ ] **Step 1: Write the failing body-parser test**

Create `packages/event-schema/test/request-event-body.test.ts`:

```ts
import { REQUEST_EVENT_LIMITS } from '../src/index.js';
import { parseRequestEventBody } from '../src/request-event-body.js';
import { describe, expect, it } from 'vitest';

describe('request event body parsing', () => {
  it('parses a minimal successful request', () => {
    expect(
      parseRequestEventBody({
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1_800_000_005_000,
        durationMs: 120,
        outcome: 'success',
      }),
    ).toEqual({
      success: true,
      data: {
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1_800_000_005_000,
        durationMs: 120,
        outcome: 'success',
      },
    });
  });

  it('strips query and fragment from the URL before reading values', () => {
    expect(
      parseRequestEventBody({
        method: 'GET',
        url: 'https://api.example.test/search?token=private#fragment',
        startedAt: 1_800_000_005_001,
        durationMs: 0,
        outcome: 'success',
        statusCode: 200,
      }),
    ).toEqual({
      success: true,
      data: {
        method: 'GET',
        url: 'https://api.example.test/search',
        startedAt: 1_800_000_005_001,
        durationMs: 0,
        outcome: 'success',
        statusCode: 200,
      },
    });
  });

  it('accepts all five outcomes and optional status code absence', () => {
    for (const outcome of ['http_error', 'network_error', 'timeout', 'canceled'] as const) {
      expect(
        parseRequestEventBody({
          method: 'POST',
          url: 'https://api.example.test/actions',
          startedAt: 1_800_000_005_002,
          durationMs: 300,
          outcome,
        }).success,
      ).toBe(true);
    }
  });

  it.each([
    [{ url: 'https://api.example.test/orders', startedAt: 1, durationMs: 1, outcome: 'success' }, 'missing_required_field'],
    [{ method: 'get', url: 'https://api.example.test/orders', startedAt: 1, durationMs: 1, outcome: 'success' }, 'invalid_enum'],
    [{ method: 'GET', url: '', startedAt: 1, durationMs: 1, outcome: 'success' }, 'string_empty'],
    [{ method: 'GET', url: 'data:text/plain,synthetic', startedAt: 1, durationMs: 1, outcome: 'success' }, 'invalid_url'],
    [{ method: 'GET', url: '/orders', startedAt: 1, durationMs: 1, outcome: 'success' }, 'invalid_url'],
    [{ method: 'GET', url: 'https://api.example.test/orders', startedAt: 1, durationMs: 1 }, 'missing_required_field'],
    [{ method: 'GET', url: 'https://api.example.test/orders', startedAt: 1, durationMs: 1, outcome: 'failed' }, 'invalid_enum'],
    [{ method: 'GET', url: 'https://api.example.test/orders', startedAt: 1, durationMs: -1, outcome: 'success' }, 'invalid_number'],
    [{ method: 'GET', url: 'https://api.example.test/orders', startedAt: 1, durationMs: 1, outcome: 'success', statusCode: 600 }, 'invalid_number'],
    [{ method: 'GET', url: 'https://api.example.test/orders', startedAt: 0, durationMs: 1, outcome: 'success' }, 'invalid_timestamp'],
    [{ method: 'GET', url: 'https://api.example.test/orders', startedAt: 1, durationMs: 1, outcome: 'success', page: 'x' }, 'unknown_field'],
  ] as const)('rejects invalid body %# with %s', (input, issueCode) => {
    const result = parseRequestEventBody(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain(issueCode);
    }
  });

  it('does not modify the input object', () => {
    const input = Object.freeze({
      method: 'GET',
      url: 'https://api.example.test/orders?token=private',
      startedAt: 1_800_000_005_003,
      durationMs: 50,
      outcome: 'success' as const,
    });
    const before = { ...input };
    parseRequestEventBody(input);
    expect(input).toEqual(before);
  });

  it('enforces the URL maximum length boundary', () => {
    const prefix = 'https://api.example.test/';
    const atMaximum = prefix + 'a'.repeat(REQUEST_EVENT_LIMITS.maxRequestUrlLength - prefix.length);
    expect(
      parseRequestEventBody({
        method: 'GET',
        url: atMaximum,
        startedAt: 1,
        durationMs: 1,
        outcome: 'success',
      }).success,
    ).toBe(true);
    const overMaximum = `${atMaximum}a`;
    const result = parseRequestEventBody({
      method: 'GET',
      url: overMaximum,
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('string_too_long');
    }
  });
});
```

Note: the `as const` on `outcome: 'success'` inside the frozen input is a literal narrowing so the object remains a valid compile-time shape; the parser still treats every field as `unknown`.

- [ ] **Step 2: Run and verify the expected failure**

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/request-event-body.test.ts
```

Expected: exit 1 because `request-event-body.js` (and `field-validation.js` / `safe-url.js`) do not exist.

- [ ] **Step 3: Extract the neutral helpers (behavior-preserving)**

Create `packages/event-schema/src/field-validation.ts` by moving the implementations of `isPlainErrorRecord`, `addErrorEventIssue`, `readRequiredErrorField`, `rejectUnknownErrorFields`, and `parseBoundedErrorString` (and the `FieldRead*` types) out of `error-event-validation.ts`, renamed to neutral names. Reject/read/issue messages may drop the word "error" (e.g. "Unknown request or error event field") because no existing test asserts on message text — only codes and paths are asserted. Keep the sort order, symbol handling, `missing_required_field`/`invalid_type`/`unknown_field`/`string_empty`/`string_too_long` codes, and the exact `path` behavior identical.

```ts
import { appendIssue, type EventSchemaIssue } from './validation-issues.js';

export interface FieldReadSuccess {
  readonly found: true;
  readonly value: unknown;
}

export interface FieldReadFailure {
  readonly found: false;
}

export type FieldReadResult = FieldReadSuccess | FieldReadFailure;

export function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

export function addValidationIssue(
  issues: EventSchemaIssue[],
  code: EventSchemaIssue['code'],
  path: readonly (string | number)[],
  message: string,
): void {
  appendIssue(issues, { code, path: [...path], message });
}

export function readRequiredField(
  input: Record<string, unknown>,
  field: string,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): FieldReadResult {
  if (!Object.prototype.hasOwnProperty.call(input, field)) {
    addValidationIssue(
      issues,
      'missing_required_field',
      [...path, field],
      'Required field is missing',
    );
    return { found: false };
  }
  return { found: true, value: input[field] };
}

export function rejectUnknownFields(
  input: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): void {
  if (Object.getOwnPropertySymbols(input).length > 0) {
    addValidationIssue(
      issues,
      'unknown_field',
      [...path, '$symbol'],
      'Symbol fields are not allowed',
    );
  }
  for (const field of Object.keys(input).sort()) {
    if (!allowedFields.has(field)) {
      addValidationIssue(issues, 'unknown_field', [...path, field], 'Unknown event body field');
    }
  }
}

export function parseBoundedString(
  input: unknown,
  maximumLength: number,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): string | undefined {
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Event body field must be a string');
    return undefined;
  }
  if (input.length === 0) {
    addValidationIssue(issues, 'string_empty', path, 'Event body string must not be empty');
    return undefined;
  }
  if (input.length > maximumLength) {
    addValidationIssue(
      issues,
      'string_too_long',
      path,
      'Event body string exceeds maximum length',
    );
    return undefined;
  }
  return input;
}
```

Replace `packages/event-schema/src/error-event-validation.ts` with a re-export shim so all existing error consumers keep their imports unchanged:

```ts
export {
  addValidationIssue as addErrorEventIssue,
  isPlainRecord as isPlainErrorRecord,
  parseBoundedString as parseBoundedErrorString,
  readRequiredField as readRequiredErrorField,
  rejectUnknownFields as rejectUnknownErrorFields,
} from './field-validation.js';
export type {
  FieldReadFailure,
  FieldReadResult,
  FieldReadSuccess,
} from './field-validation.js';
```

Create `packages/event-schema/src/safe-url.ts` by moving the URL sanitizer out of `resource-error-event.ts` (including `containsUnsafeUrlCharacter`, `safeAuthority`, `firstUrlSuffixIndex`) with a neutral signature that takes the maximum length:

```ts
import type { EventSchemaIssue } from './validation-issues.js';
import { addValidationIssue, parseBoundedString } from './field-validation.js';

function containsUnsafeUrlCharacter(input: string): boolean {
  for (const char of input) {
    const code = char.charCodeAt(0);
    if (code === 0x5c || code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

const safeAuthority =
  /^(?:\[[0-9A-Fa-f:.]+\]|localhost|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?$/u;

function firstUrlSuffixIndex(input: string): number {
  const queryIndex = input.indexOf('?');
  const fragmentIndex = input.indexOf('#');
  if (queryIndex < 0) return fragmentIndex;
  if (fragmentIndex < 0) return queryIndex;
  return Math.min(queryIndex, fragmentIndex);
}

export function sanitizeHttpUrl(
  input: unknown,
  maxLength: number,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): string | undefined {
  const bounded = parseBoundedString(input, maxLength, issues, path);
  if (bounded === undefined) return undefined;
  const suffixIndex = firstUrlSuffixIndex(bounded);
  const sanitized = suffixIndex < 0 ? bounded : bounded.slice(0, suffixIndex);
  const schemeLength = sanitized.startsWith('https://')
    ? 'https://'.length
    : sanitized.startsWith('http://')
      ? 'http://'.length
      : 0;
  const pathIndex = sanitized.indexOf('/', schemeLength);
  const authority = sanitized.slice(schemeLength, pathIndex < 0 ? sanitized.length : pathIndex);
  const authorityMatch = safeAuthority.exec(authority);
  const portText = authorityMatch?.[1];
  if (
    schemeLength === 0 ||
    authority.length === 0 ||
    authority.includes('@') ||
    containsUnsafeUrlCharacter(sanitized) ||
    authorityMatch === null ||
    (portText !== undefined && Number(portText) > 65_535)
  ) {
    addValidationIssue(issues, 'invalid_url', path, 'URL is not a safe HTTP URL');
    return undefined;
  }
  return sanitized;
}
```

Rewrite `packages/event-schema/src/resource-error-event.ts` to use the shared sanitizer. Remove the local `containsUnsafeUrlCharacter`, `safeAuthority`, `firstUrlSuffixIndex`, and `sanitizeResourceUrl`; import `sanitizeHttpUrl` from `./safe-url.js` and keep the `resource` field allow-list and type parsing identical. The `path` passed to the sanitizer stays `['body', 'resource', 'url']` and the limit stays `ERROR_EVENT_LIMITS.maxResourceUrlLength`, so resource behavior is byte-for-byte unchanged:

```ts
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  type ErrorResourceType as ErrorResourceTypeValue,
  type ResourceLoadErrorEventBody,
} from './error-event-types.js';
import {
  addValidationIssue,
  isPlainRecord,
  readRequiredField,
  rejectUnknownFields,
} from './field-validation.js';
import { sanitizeHttpUrl } from './safe-url.js';
import type { EventSchemaIssue } from './validation-issues.js';

const RESOURCE_BODY_FIELDS: ReadonlySet<string> = new Set(['category', 'resource']);
const RESOURCE_FIELDS: ReadonlySet<string> = new Set(['type', 'url']);
const resourceTypes: ReadonlySet<unknown> = new Set(Object.values(ErrorResourceType));

function parseResourceType(
  input: unknown,
  issues: EventSchemaIssue[],
): ErrorResourceTypeValue | undefined {
  const path = ['body', 'resource', 'type'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Resource type must be a string');
    return undefined;
  }
  if (!resourceTypes.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Resource type is not supported');
    return undefined;
  }
  if (input === ErrorResourceType.Script) return ErrorResourceType.Script;
  if (input === ErrorResourceType.Stylesheet) return ErrorResourceType.Stylesheet;
  if (input === ErrorResourceType.Image) return ErrorResourceType.Image;
  return ErrorResourceType.Font;
}

export function parseResourceLoadErrorEventBody(
  input: Record<string, unknown>,
  issues: EventSchemaIssue[],
): ResourceLoadErrorEventBody | undefined {
  rejectUnknownFields(input, RESOURCE_BODY_FIELDS, issues, ['body']);
  const resourceField = readRequiredField(input, 'resource', issues, ['body']);
  if (!resourceField.found) return undefined;
  const path = ['body', 'resource'] as const;
  if (!isPlainRecord(resourceField.value)) {
    addValidationIssue(issues, 'invalid_type', path, 'Resource error must be a plain object');
    return undefined;
  }
  rejectUnknownFields(resourceField.value, RESOURCE_FIELDS, issues, path);
  const typeField = readRequiredField(resourceField.value, 'type', issues, path);
  const urlField = readRequiredField(resourceField.value, 'url', issues, path);
  const type = typeField.found ? parseResourceType(typeField.value, issues) : undefined;
  const url = urlField.found
    ? sanitizeHttpUrl(urlField.value, ERROR_EVENT_LIMITS.maxResourceUrlLength, issues, [
        ...path,
        'url',
      ])
    : undefined;
  if (type === undefined || url === undefined) return undefined;
  return { category: ErrorCategory.Resource, resource: { type, url } };
}
```

Then create `packages/event-schema/src/request-event-body.ts`:

```ts
import {
  REQUEST_EVENT_LIMITS,
  RequestMethod,
  RequestOutcome,
  type RequestEventBodyParseResult,
} from './request-event-types.js';
import {
  addValidationIssue,
  isPlainRecord,
  readRequiredField,
  rejectUnknownFields,
} from './field-validation.js';
import { sanitizeHttpUrl } from './safe-url.js';
import type { EventSchemaIssue } from './validation-issues.js';
import { validateBodyValue } from './value-boundaries.js';

const REQUEST_BODY_FIELDS: ReadonlySet<string> = new Set([
  'method',
  'url',
  'startedAt',
  'durationMs',
  'outcome',
  'statusCode',
]);
const requestMethods: ReadonlySet<unknown> = new Set(Object.values(RequestMethod));
const requestOutcomes: ReadonlySet<unknown> = new Set(Object.values(RequestOutcome));

function unsafeBodyFailure(): RequestEventBodyParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: ['body'],
        message: 'Request event body could not be read safely',
      },
    ],
  };
}

function parseMethod(input: unknown, issues: EventSchemaIssue[]): RequestMethod | undefined {
  const path = ['body', 'method'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Request method must be a string');
    return undefined;
  }
  if (!requestMethods.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Request method is not supported');
    return undefined;
  }
  if (input === RequestMethod.Get) return RequestMethod.Get;
  if (input === RequestMethod.Post) return RequestMethod.Post;
  if (input === RequestMethod.Put) return RequestMethod.Put;
  if (input === RequestMethod.Patch) return RequestMethod.Patch;
  if (input === RequestMethod.Delete) return RequestMethod.Delete;
  if (input === RequestMethod.Head) return RequestMethod.Head;
  return RequestMethod.Options;
}

function parseOutcome(input: unknown, issues: EventSchemaIssue[]): RequestOutcome | undefined {
  const path = ['body', 'outcome'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Request outcome must be a string');
    return undefined;
  }
  if (!requestOutcomes.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Request outcome is not supported');
    return undefined;
  }
  if (input === RequestOutcome.Success) return RequestOutcome.Success;
  if (input === RequestOutcome.HttpError) return RequestOutcome.HttpError;
  if (input === RequestOutcome.NetworkError) return RequestOutcome.NetworkError;
  if (input === RequestOutcome.Timeout) return RequestOutcome.Timeout;
  return RequestOutcome.Canceled;
}

function parseStartedAt(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  const path = ['body', 'startedAt'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'startedAt must be a number');
    return undefined;
  }
  if (!Number.isSafeInteger(input) || input <= 0) {
    addValidationIssue(
      issues,
      'invalid_timestamp',
      path,
      'startedAt must be a positive safe integer in Unix epoch milliseconds',
    );
    return undefined;
  }
  return input;
}

function parseDurationMs(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  const path = ['body', 'durationMs'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'durationMs must be a number');
    return undefined;
  }
  if (!Number.isSafeInteger(input) || input < 0) {
    addValidationIssue(
      issues,
      'invalid_number',
      path,
      'durationMs must be a non-negative safe integer',
    );
    return undefined;
  }
  return input;
}

function parseStatusCode(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  const path = ['body', 'statusCode'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'statusCode must be a number');
    return undefined;
  }
  if (
    !Number.isSafeInteger(input) ||
    input < REQUEST_EVENT_LIMITS.minStatusCode ||
    input > REQUEST_EVENT_LIMITS.maxStatusCode
  ) {
    addValidationIssue(
      issues,
      'invalid_number',
      path,
      'statusCode must be a safe integer between 100 and 599',
    );
    return undefined;
  }
  return input;
}

function parseBody(input: unknown): RequestEventBodyParseResult {
  const issues: EventSchemaIssue[] = [];
  validateBodyValue(input, issues);
  if (issues.length > 0) return { success: false, issues };
  if (!isPlainRecord(input)) {
    addValidationIssue(issues, 'invalid_type', ['body'], 'Request event body must be a plain object');
    return { success: false, issues };
  }
  rejectUnknownFields(input, REQUEST_BODY_FIELDS, issues, ['body']);
  const methodField = readRequiredField(input, 'method', issues, ['body']);
  const urlField = readRequiredField(input, 'url', issues, ['body']);
  const startedAtField = readRequiredField(input, 'startedAt', issues, ['body']);
  const durationMsField = readRequiredField(input, 'durationMs', issues, ['body']);
  const outcomeField = readRequiredField(input, 'outcome', issues, ['body']);
  const hasStatusCode = Object.prototype.hasOwnProperty.call(input, 'statusCode');
  const method = methodField.found ? parseMethod(methodField.value, issues) : undefined;
  const url = urlField.found
    ? sanitizeHttpUrl(urlField.value, REQUEST_EVENT_LIMITS.maxRequestUrlLength, issues, [
        'body',
        'url',
      ])
    : undefined;
  const startedAt = startedAtField.found ? parseStartedAt(startedAtField.value, issues) : undefined;
  const durationMs = durationMsField.found
    ? parseDurationMs(durationMsField.value, issues)
    : undefined;
  const outcome = outcomeField.found ? parseOutcome(outcomeField.value, issues) : undefined;
  const statusCode = hasStatusCode ? parseStatusCode(input.statusCode, issues) : undefined;
  if (
    issues.length > 0 ||
    method === undefined ||
    url === undefined ||
    startedAt === undefined ||
    durationMs === undefined ||
    outcome === undefined ||
    (hasStatusCode && statusCode === undefined)
  ) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: {
      method,
      url,
      startedAt,
      durationMs,
      outcome,
      ...(statusCode === undefined ? {} : { statusCode }),
    },
  };
}

export function parseRequestEventBody(input: unknown): RequestEventBodyParseResult {
  try {
    return parseBody(input);
  } catch {
    return unsafeBodyFailure();
  }
}
```

Then export `parseRequestEventBody` from `packages/event-schema/src/index.ts`:

```ts
export { parseRequestEventBody } from './request-event-body.js';
```

- [ ] **Step 4: Run and verify pass**

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/request-event-body.test.ts
pnpm --filter @aurora/event-schema typecheck
```

Expected: exit 0; all body tests pass; no type diagnostics.

- [ ] **Step 5: Run the full error regression (proves the extraction preserved behavior)**

```powershell
pnpm --filter @aurora/event-schema test
```

Expected: exit 0; all 16 files / 102 existing tests still pass, including every JavaScript/Promise/resource body and envelope test. This is the evidence that `field-validation.ts` and `safe-url.ts` are behavior-preserving.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/event-schema/src/field-validation.ts packages/event-schema/src/safe-url.ts packages/event-schema/src/request-event-body.ts packages/event-schema/test/request-event-body.test.ts packages/event-schema/src/error-event-validation.ts packages/event-schema/src/resource-error-event.ts packages/event-schema/src/index.ts
git commit -m "feat: parse request event bodies via shared helpers"
```

### Task 3: Parse the Request Event Envelope

**Files:**

- Create: `packages/event-schema/src/request-event-envelope.ts`
- Create: `packages/event-schema/test/request-event-envelope.test.ts`

**Interfaces:**

- Consumes: `parseEventEnvelope`, `EventType.Request`, `parseRequestEventBody`, `RequestEventEnvelopeParseResult`.
- Produces: `parseRequestEventEnvelope(input: unknown): RequestEventEnvelopeParseResult` with `event_type_mismatch` for non-request envelopes.

- [ ] **Step 1: Write the failing envelope test**

Create `packages/event-schema/test/request-event-envelope.test.ts`:

```ts
import { parseEventEnvelope } from '../src/index.js';
import { parseRequestEventEnvelope } from '../src/request-event-envelope.js';
import { describe, expect, it } from 'vitest';

function requestEnvelope(body: unknown, eventType = 'request'): Record<string, unknown> {
  return {
    protocolVersion: 1,
    eventId: 'evt-request-test-synthetic',
    eventType,
    occurredAt: 1_800_000_005_100,
    body,
  };
}

describe('request event envelope parsing', () => {
  it('accepts a current-version request envelope', () => {
    expect(
      parseRequestEventEnvelope(
        requestEnvelope({
          method: 'GET',
          url: 'https://api.example.test/orders',
          startedAt: 1_800_000_005_000,
          durationMs: 120,
          outcome: 'success',
          statusCode: 200,
        }),
      ),
    ).toEqual({
      success: true,
      data: {
        protocolVersion: 1,
        eventId: 'evt-request-test-synthetic',
        eventType: 'request',
        occurredAt: 1_800_000_005_100,
        body: {
          method: 'GET',
          url: 'https://api.example.test/orders',
          startedAt: 1_800_000_005_000,
          durationMs: 120,
          outcome: 'success',
          statusCode: 200,
        },
      },
    });
  });

  it('rejects a request body under the error event type', () => {
    const result = parseRequestEventEnvelope(requestEnvelope({ method: 'GET' }, 'error'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('event_type_mismatch');
    }
  });

  it('rejects an unsupported protocol version through the shared envelope parser', () => {
    const result = parseRequestEventEnvelope(
      {
        ...requestEnvelope({
          method: 'GET',
          url: 'https://api.example.test/orders',
          startedAt: 1,
          durationMs: 1,
          outcome: 'success',
        }),
        protocolVersion: 2,
      },
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('unsupported_protocol_version');
    }
  });

  it('keeps generic envelope issues unchanged when the body is wrong', () => {
    const input = requestEnvelope({
      method: 'GET',
      url: 'https://api.example.test/orders?token=private',
      startedAt: 1,
      durationMs: -5,
      outcome: 'success',
    });
    const requestResult = parseRequestEventEnvelope(input);
    const genericResult = parseEventEnvelope(input);
    expect(requestResult.success).toBe(false);
    expect(genericResult.success).toBe(true);
    if (!requestResult.success) {
      expect(requestResult.issues.map(({ code }) => code)).toContain('invalid_number');
    }
  });
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/request-event-envelope.test.ts
```

Expected: exit 1 because `request-event-envelope.js` does not exist.

- [ ] **Step 3: Implement the envelope parser**

Create `packages/event-schema/src/request-event-envelope.ts`:

```ts
import { parseRequestEventBody } from './request-event-body.js';
import type { RequestEventEnvelopeParseResult } from './request-event-types.js';
import { parseEventEnvelope } from './event-envelope.js';
import { EventType } from './event-types.js';

function unsafeEnvelopeFailure(): RequestEventEnvelopeParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: [],
        message: 'Request event envelope could not be read safely',
      },
    ],
  };
}

function parseEnvelope(input: unknown): RequestEventEnvelopeParseResult {
  const envelopeResult = parseEventEnvelope(input);
  if (!envelopeResult.success) return envelopeResult;
  if (envelopeResult.data.eventType !== EventType.Request) {
    return {
      success: false,
      issues: [
        {
          code: 'event_type_mismatch',
          path: ['eventType'],
          message: 'Request event body requires the request event type',
        },
      ],
    };
  }
  const bodyResult = parseRequestEventBody(envelopeResult.data.body);
  if (!bodyResult.success) return bodyResult;
  return {
    success: true,
    data: {
      protocolVersion: envelopeResult.data.protocolVersion,
      eventId: envelopeResult.data.eventId,
      eventType: EventType.Request,
      occurredAt: envelopeResult.data.occurredAt,
      body: bodyResult.data,
    },
  };
}

export function parseRequestEventEnvelope(input: unknown): RequestEventEnvelopeParseResult {
  try {
    return parseEnvelope(input);
  } catch {
    return unsafeEnvelopeFailure();
  }
}
```

Export from `packages/event-schema/src/index.ts`:

```ts
export { parseRequestEventEnvelope } from './request-event-envelope.js';
```

- [ ] **Step 4: Run and verify pass**

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/request-event-envelope.test.ts
pnpm --filter @aurora/event-schema typecheck
```

Expected: exit 0; all envelope tests pass; no type diagnostics.

- [ ] **Step 5: Run error envelope and package regression**

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/error-event-envelope.test.ts
pnpm --filter @aurora/event-schema test:package
```

Expected: exit 0; the error envelope suite stays green; the built root still lists only the declared entries (request parsers will appear after the next build).

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/event-schema/src/request-event-envelope.ts packages/event-schema/test/request-event-envelope.test.ts packages/event-schema/src/index.ts
git commit -m "feat: parse request event envelopes"
```

### Task 4: Add Shared Request Contract Samples and Extend the Entry Gates

**Files:**

- Create: `packages/event-schema/src/contract-testkit/valid-request-event-samples.ts`
- Create: `packages/event-schema/src/contract-testkit/invalid-request-event-samples.ts`
- Create: `packages/event-schema/src/contract-testkit/boundary-request-event-samples.ts`
- Modify: `packages/event-schema/src/contract-testkit/index.ts`
- Modify: `packages/event-schema/test/package-entry.test.ts`

**Interfaces:**

- Consumes: `CURRENT_PROTOCOL_VERSION`, `REQUEST_EVENT_LIMITS`, `RequestMethod`, `RequestOutcome`, `RequestEventBody`, `RequestEventEnvelope`, `EventType.Request`, `EventSchemaIssueCode`.
- Produces: `validRequestEventSamples`, `invalidRequestEventSamples`, `boundaryRequestEventSamples` exported from `contract-testkit`, and updated package-entry assertions.

- [ ] **Step 1: Write the failing sample-export test**

Extend `packages/event-schema/test/package-entry.test.ts`:

```ts
  it('loads the declared request contract-testkit samples', () => {
    const result = importFromPackage('@aurora/event-schema/contract-testkit');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('validRequestEventSamples');
    expect(result.stdout).toContain('invalidRequestEventSamples');
    expect(result.stdout).toContain('boundaryRequestEventSamples');
  });
```

Add the following specifiers to the private-path rejection list in the same test file:

```ts
      '@aurora/event-schema/request-event-body',
      '@aurora/event-schema/request-event-envelope',
      '@aurora/event-schema/request-event-types',
      '@aurora/event-schema/field-validation',
      '@aurora/event-schema/safe-url',
```

And extend the root-entry assertion with:

```ts
    expect(result.stdout).toContain('parseRequestEventBody');
    expect(result.stdout).toContain('parseRequestEventEnvelope');
    expect(result.stdout).toContain('RequestMethod');
    expect(result.stdout).toContain('RequestOutcome');
    expect(result.stdout).toContain('REQUEST_EVENT_LIMITS');
```

- [ ] **Step 2: Run and verify the expected failure**

```powershell
pnpm --filter @aurora/event-schema test:package
```

Expected: exit 1 because the request sample modules and exports do not exist.

- [ ] **Step 3: Implement the request samples**

Create `packages/event-schema/src/contract-testkit/valid-request-event-samples.ts`:

```ts
import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import {
  RequestMethod,
  RequestOutcome,
  type RequestEventBody,
  type RequestEventEnvelope,
} from '../request-event-types.js';
import { EventType } from '../event-types.js';

export interface ValidRequestEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: RequestEventEnvelope;
}

function envelope(eventId: string, body: RequestEventBody, occurredAt: number): RequestEventEnvelope {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Request,
    occurredAt,
    body,
  };
}

const getSuccess = {
  method: RequestMethod.Get,
  url: 'https://api.example.test/orders',
  startedAt: 1_800_000_005_000,
  durationMs: 120,
  outcome: RequestOutcome.Success,
  statusCode: 200,
} as const;
const postSuccess = {
  method: RequestMethod.Post,
  url: 'https://api.example.test/orders',
  startedAt: 1_800_000_005_001,
  durationMs: 45,
  outcome: RequestOutcome.Success,
} as const;
const deleteHttpError = {
  method: RequestMethod.Delete,
  url: 'https://api.example.test/orders/7',
  startedAt: 1_800_000_005_002,
  durationMs: 810,
  outcome: RequestOutcome.HttpError,
  statusCode: 500,
} as const;
const getNetworkError = {
  method: RequestMethod.Get,
  url: 'https://api.example.test/reports',
  startedAt: 1_800_000_005_003,
  durationMs: 1500,
  outcome: RequestOutcome.NetworkError,
} as const;
const postTimeout = {
  method: RequestMethod.Post,
  url: 'https://api.example.test/upload',
  startedAt: 1_800_000_005_004,
  durationMs: 3005,
  outcome: RequestOutcome.Timeout,
} as const;
const getCanceled = {
  method: RequestMethod.Get,
  url: 'https://api.example.test/search',
  startedAt: 1_800_000_005_005,
  durationMs: 210,
  outcome: RequestOutcome.Canceled,
} as const;
const queryInput = {
  method: RequestMethod.Get,
  url: 'https://api.example.test/search?token=private#fragment',
  startedAt: 1_800_000_005_006,
  durationMs: 90,
  outcome: RequestOutcome.Success,
  statusCode: 200,
} as const;
const queryExpected = {
  method: RequestMethod.Get,
  url: 'https://api.example.test/search',
  startedAt: 1_800_000_005_006,
  durationMs: 90,
  outcome: RequestOutcome.Success,
  statusCode: 200,
} as const;

export const validRequestEventSamples: readonly ValidRequestEventSample[] = [
  {
    name: 'successful GET with status code',
    input: envelope('evt-request-valid-get', getSuccess, 1_800_000_005_500),
    expected: envelope('evt-request-valid-get', getSuccess, 1_800_000_005_500),
  },
  {
    name: 'successful POST without status code',
    input: envelope('evt-request-valid-post', postSuccess, 1_800_000_005_501),
    expected: envelope('evt-request-valid-post', postSuccess, 1_800_000_005_501),
  },
  {
    name: 'HTTP 500 response',
    input: envelope('evt-request-valid-delete', deleteHttpError, 1_800_000_005_502),
    expected: envelope('evt-request-valid-delete', deleteHttpError, 1_800_000_005_502),
  },
  {
    name: 'network failure without status',
    input: envelope('evt-request-valid-network', getNetworkError, 1_800_000_005_503),
    expected: envelope('evt-request-valid-network', getNetworkError, 1_800_000_005_503),
  },
  {
    name: 'timeout without status',
    input: envelope('evt-request-valid-timeout', postTimeout, 1_800_000_005_504),
    expected: envelope('evt-request-valid-timeout', postTimeout, 1_800_000_005_504),
  },
  {
    name: 'canceled request',
    input: envelope('evt-request-valid-canceled', getCanceled, 1_800_000_005_505),
    expected: envelope('evt-request-valid-canceled', getCanceled, 1_800_000_005_505),
  },
  {
    name: 'GET with query and fragment stripped',
    input: envelope('evt-request-valid-query', queryInput, 1_800_000_005_506),
    expected: envelope('evt-request-valid-query', queryExpected, 1_800_000_005_506),
  },
];
```

Create `packages/event-schema/src/contract-testkit/invalid-request-event-samples.ts`:

```ts
import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface InvalidRequestEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

function envelope(body: unknown): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-request-invalid-synthetic',
    eventType: EventType.Request,
    occurredAt: 1_800_000_005_600,
    body,
  };
}

export const invalidRequestEventSamples: readonly InvalidRequestEventSample[] = [
  {
    name: 'missing method',
    input: envelope({
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'lowercase method',
    input: envelope({
      method: 'get',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'empty URL',
    input: envelope({
      method: 'GET',
      url: '',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'string_empty',
  },
  {
    name: 'data scheme URL',
    input: envelope({
      method: 'GET',
      url: 'data:text/plain,synthetic',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'invalid_url',
  },
  {
    name: 'relative URL',
    input: envelope({
      method: 'GET',
      url: '/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'invalid_url',
  },
  {
    name: 'missing outcome',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
    }),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'unknown outcome',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'failed',
    }),
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'negative duration',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: -1,
      outcome: 'success',
    }),
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'status code above range',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
      statusCode: 600,
    }),
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'zero startedAt',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 0,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'invalid_timestamp',
  },
  {
    name: 'unknown body field',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
      page: 'x',
    }),
    expectedIssueCode: 'unknown_field',
  },
  {
    name: 'request body uses error event type',
    input: {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      eventId: 'evt-request-invalid-mismatch',
      eventType: EventType.Error,
      occurredAt: 1_800_000_005_601,
      body: {
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1,
        durationMs: 1,
        outcome: 'success',
      },
    },
    expectedIssueCode: 'event_type_mismatch',
  },
];
```

Create `packages/event-schema/src/contract-testkit/boundary-request-event-samples.ts`:

```ts
import { CURRENT_PROTOCOL_VERSION, EVENT_SCHEMA_LIMITS } from '../constants.js';
import {
  REQUEST_EVENT_LIMITS,
  RequestMethod,
  RequestOutcome,
  type RequestEventBody,
  type RequestEventEnvelope,
} from '../request-event-types.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface BoundaryRequestEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: RequestEventEnvelope;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

function envelope(eventId: string, body: unknown): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Request,
    occurredAt: 1_800_000_005_700,
    body,
  };
}

function expectedEnvelope(eventId: string, body: RequestEventBody): RequestEventEnvelope {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Request,
    occurredAt: 1_800_000_005_700,
    body,
  };
}

const urlPrefix = 'https://api.example.test/';
const maximumUrl =
  urlPrefix + 'a'.repeat(REQUEST_EVENT_LIMITS.maxRequestUrlLength - urlPrefix.length);
const maximumSafeInteger = Number.MAX_SAFE_INTEGER;

export const boundaryRequestEventSamples: readonly BoundaryRequestEventSample[] = [
  {
    name: 'URL at exact maximum',
    input: envelope('evt-request-boundary-url-max', {
      method: RequestMethod.Get,
      url: maximumUrl,
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.Success,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-url-max', {
      method: RequestMethod.Get,
      url: maximumUrl,
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.Success,
    }),
  },
  {
    name: 'URL one over maximum',
    input: envelope('evt-request-boundary-url-over', {
      method: RequestMethod.Get,
      url: `${maximumUrl}a`,
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.Success,
    }),
    isValid: false,
    expectedIssueCode: 'string_too_long',
  },
  {
    name: 'zero duration is valid',
    input: envelope('evt-request-boundary-duration-zero', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/ping',
      startedAt: 1,
      durationMs: 0,
      outcome: RequestOutcome.Success,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-duration-zero', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/ping',
      startedAt: 1,
      durationMs: 0,
      outcome: RequestOutcome.Success,
    }),
  },
  {
    name: 'duration at maximum safe integer',
    input: envelope('evt-request-boundary-duration-max', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/slow',
      startedAt: 1,
      durationMs: maximumSafeInteger,
      outcome: RequestOutcome.Timeout,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-duration-max', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/slow',
      startedAt: 1,
      durationMs: maximumSafeInteger,
      outcome: RequestOutcome.Timeout,
    }),
  },
  {
    name: 'startedAt at maximum safe integer',
    input: envelope('evt-request-boundary-started-max', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/orders',
      startedAt: maximumSafeInteger,
      durationMs: 1,
      outcome: RequestOutcome.Success,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-started-max', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/orders',
      startedAt: maximumSafeInteger,
      durationMs: 1,
      outcome: RequestOutcome.Success,
    }),
  },
  {
    name: 'status code 100',
    input: envelope('evt-request-boundary-status-100', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/status',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.Success,
      statusCode: 100,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-status-100', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/status',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.Success,
      statusCode: 100,
    }),
  },
  {
    name: 'status code 599',
    input: envelope('evt-request-boundary-status-599', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/status',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.HttpError,
      statusCode: 599,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-status-599', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/status',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.HttpError,
      statusCode: 599,
    }),
  },
  {
    name: 'status code 600 rejected',
    input: envelope('evt-request-boundary-status-600', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/status',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.HttpError,
      statusCode: 600,
    }),
    isValid: false,
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'http_error without status code is allowed',
    input: envelope('evt-request-boundary-no-status', {
      method: RequestMethod.Delete,
      url: 'https://api.example.test/orders/7',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.HttpError,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-no-status', {
      method: RequestMethod.Delete,
      url: 'https://api.example.test/orders/7',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.HttpError,
    }),
  },
];
```

Extend `packages/event-schema/src/contract-testkit/index.ts` with:

```ts
export {
  boundaryRequestEventSamples,
  type BoundaryRequestEventSample,
} from './boundary-request-event-samples.js';
export {
  invalidRequestEventSamples,
  type InvalidRequestEventSample,
} from './invalid-request-event-samples.js';
export { validRequestEventSamples, type ValidRequestEventSample } from './valid-request-event-samples.js';
```

Note: `EVENT_SCHEMA_LIMITS` is imported in the boundary file but unused; remove that import (or keep it if a future boundary uses it — do not import unused symbols; the typecheck will reject `noUnusedLocals`).

- [ ] **Step 4: Run and verify pass**

```powershell
pnpm --filter @aurora/event-schema test:package
pnpm --filter @aurora/event-schema typecheck
```

Expected: exit 0; root lists the five request values; contract-testkit lists the three request sample arrays; all five private request paths reject with `ERR_PACKAGE_PATH_NOT_EXPORTED`; no type diagnostics.

- [ ] **Step 5: Run the full event-schema regression**

```powershell
pnpm --filter @aurora/event-schema test
```

Expected: exit 0; existing 16 files / 102 tests plus the new request tests all pass.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/event-schema/src/contract-testkit/valid-request-event-samples.ts packages/event-schema/src/contract-testkit/invalid-request-event-samples.ts packages/event-schema/src/contract-testkit/boundary-request-event-samples.ts packages/event-schema/src/contract-testkit/index.ts packages/event-schema/test/package-entry.test.ts
git commit -m "test: add shared request event contract samples"
```

### Task 5: Prove SDK, Ingestion, and Processing Consumer Contracts

**Files:**

- Create: `packages/event-schema/test/consumers/sdk-request-event.contract.test.ts`
- Create: `packages/event-schema/test/consumers/ingestion-request-event.contract.test.ts`
- Create: `packages/event-schema/test/consumers/processing-request-event.contract.test.ts`

**Interfaces:**

- Consumes: root `parseRequestEventEnvelope`, `contract-testkit` request sample arrays.
- Produces: three consumer-contract proofs that all consumers share the same request contract and agree on sanitized output.

- [ ] **Step 1: Write the failing consumer tests**

Create `packages/event-schema/test/consumers/sdk-request-event.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRequestEventEnvelope } from '@aurora/event-schema';
import { validRequestEventSamples } from '@aurora/event-schema/contract-testkit';

describe('SDK request-event producer contract', () => {
  it('produces every shared legal request envelope', () => {
    expect(validRequestEventSamples).toHaveLength(7);
    for (const sample of validRequestEventSamples) {
      expect(parseRequestEventEnvelope(sample.input), sample.name).toEqual({
        success: true,
        data: sample.expected,
      });
    }
  });
});
```

Create `packages/event-schema/test/consumers/ingestion-request-event.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRequestEventEnvelope } from '@aurora/event-schema';
import { invalidRequestEventSamples } from '@aurora/event-schema/contract-testkit';

describe('ingestion request-event consumer contract', () => {
  it('rejects every shared illegal request envelope with its stable code', () => {
    for (const sample of invalidRequestEventSamples) {
      const result = parseRequestEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(false);
      if (!result.success) {
        expect(
          result.issues.map(({ code }) => code),
          sample.name,
        ).toContain(sample.expectedIssueCode);
      }
    }
  });
});
```

Create `packages/event-schema/test/consumers/processing-request-event.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRequestEventEnvelope } from '@aurora/event-schema';
import { boundaryRequestEventSamples } from '@aurora/event-schema/contract-testkit';

describe('processing request-event consumer contract', () => {
  it('agrees with every shared boundary and sanitized output', () => {
    for (const sample of boundaryRequestEventSamples) {
      const result = parseRequestEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(sample.isValid);
      if (sample.isValid) {
        expect(result, sample.name).toEqual({ success: true, data: sample.expected });
      } else if (!result.success) {
        expect(
          result.issues.map(({ code }) => code),
          sample.name,
        ).toContain(sample.expectedIssueCode);
      }
    }
  });
});
```

- [ ] **Step 2: Run and verify pass (samples exist from Task 4)**

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/consumers/sdk-request-event.contract.test.ts test/consumers/ingestion-request-event.contract.test.ts test/consumers/processing-request-event.contract.test.ts
```

Expected: exit 0; all three consumer suites pass against the sample arrays.

- [ ] **Step 3: Extend the architecture-boundary source scan**

The existing `architecture-boundary.test.ts` scans all `src/**/*.ts` for forbidden strings. The new request source contains none of `@aurora/core`, `@aurora/browser`, `@aurora/plugin-`, `node:`, `window.`, `document.`, `navigator.`, `process.`, `Buffer.`, `console.`, `/src/`, `/internal/`. No change is required. Run it to confirm:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/architecture-boundary.test.ts
```

Expected: exit 0.

- [ ] **Step 4: Run the full event-schema regression**

```powershell
pnpm --filter @aurora/event-schema test
```

Expected: exit 0; all suites (error + request + consumers) pass.

- [ ] **Step 5: Run the workspace boundary check**

```powershell
pnpm check:boundaries
```

Expected: exit 0; no violations; protocol package remains zero-local-dependency.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/event-schema/test/consumers/sdk-request-event.contract.test.ts packages/event-schema/test/consumers/ingestion-request-event.contract.test.ts packages/event-schema/test/consumers/processing-request-event.contract.test.ts
git commit -m "test: add request event consumer contracts"
```

### Task 6: Update README, Documentation, and ADR Implementation Evidence

**Files:**

- Create: `packages/event-schema/README.md` content additions (no new file)
- Modify: `packages/event-schema/test/documentation-contract.test.ts`
- Modify: `docs/protocol/event-envelope-v1.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/architecture/sdk-architecture.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/adr/ADR-005-event-schema-source-of-truth.md`
- Modify: `docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `docs/adr/ADR-003-sdk-plugin-architecture.md`
- Modify: `AGENTS.md`
- Modify: `AURORA_RULES.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: final root exports, contract-testkit exports, sample counts, and the completed test/coverage/package output.
- Produces: an executable README example, honest doc state, bounded ADR evidence, and updated project snapshots.

- [ ] **Step 1: Write the failing README contract test additions**

Append to `packages/event-schema/test/documentation-contract.test.ts`:

```ts
  it('documents the request contract and keeps the plugin absent', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    expect(readme).toContain('## 请求事件契约');
    expect(readme).toContain('parseRequestEventBody(input: unknown)');
    expect(readme).toContain('parseRequestEventEnvelope(input: unknown)');
    expect(readme).toContain('不实现请求观测');
    expect(readme).toContain('不实现请求采集插件');
    expect(readme).not.toContain('请求观测已经实现');
  });

  it('executes valid and invalid README request examples', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    const valid = parseRequestEventEnvelope(contractExample(readme, 'valid-request-readme'));
    expect(valid.success).toBe(true);
    const invalid = parseRequestEventEnvelope(contractExample(readme, 'invalid-request-readme'));
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues.map(({ code }) => code)).toContain('invalid_url');
    }
  });

  it('executes valid and invalid formal request-contract examples', async () => {
    const protocol = await repositoryFile('docs/protocol/request-event-contract.md');
    const valid = parseRequestEventEnvelope(contractExample(protocol, 'valid-request-spec'));
    expect(valid.success).toBe(true);
    const invalid = parseRequestEventEnvelope(contractExample(protocol, 'invalid-request-spec'));
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues.map(({ code }) => code)).toContain('invalid_url');
    }
  });
```

The test imports `parseRequestEventEnvelope` at the top (update the existing import line to include it).

- [ ] **Step 2: Run and verify the expected README failure**

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/documentation-contract.test.ts
```

Expected: exit 1 because the README does not yet contain the request section or the `contract-example:valid-request-readme` / `invalid-request-readme` markers.

- [ ] **Step 3: Update the module README**

Add a `## 请求事件契约` section after the existing `## 错误事件契约` section in `packages/event-schema/README.md`:

```markdown
## 请求事件契约

本包已实现请求事件协议契约第一增量。它定义请求监控链路的最小安全正文，不实现请求观测能力或请求采集插件。

```ts
import {
  REQUEST_EVENT_LIMITS,
  RequestMethod,
  RequestOutcome,
  parseRequestEventBody,
  parseRequestEventEnvelope,
  type RequestEventBody,
  type RequestEventEnvelope,
} from '@aurora/event-schema';
```

`parseRequestEventBody(input: unknown)` 同步校验精确正文。`parseRequestEventEnvelope(input: unknown)` 先复用公共信封校验，再要求 `eventType: "request"`。成功结果是新对象；解析器不修改输入。

- 请求方法：`GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`；
- 安全 URL：只允许小写 HTTP(S) 绝对地址，移除全部查询参数和片段，拒绝 `data:`/`blob:`/`file:`/相对地址；
- 开始时间：正安全整数 Unix epoch 毫秒；
- 持续时间：非负安全整数毫秒；
- 结果类别：`success`、`http_error`、`network_error`、`timeout`、`canceled`；
- 可选 HTTP 状态码：`100..599`。

请求监控的允许来源、同源判断、跨域允许列表、路径动态段归一化和开发者路径模板不属于协议层。协议不采集请求/响应正文、请求头、响应头、Cookie、凭据或尺寸；URL 查询与片段不会进入成功结果。

<!-- contract-example:valid-request-readme -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-request-valid",
  "eventType": "request",
  "occurredAt": 1800000005000,
  "body": {
    "method": "GET",
    "url": "https://api.example.test/search?token=private#fragment",
    "startedAt": 1800000004000,
    "durationMs": 120,
    "outcome": "success",
    "statusCode": 200
  }
}
```

<!-- contract-example:invalid-request-readme -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-request-invalid",
  "eventType": "request",
  "occurredAt": 1800000005001,
  "body": {
    "method": "GET",
    "url": "data:text/plain,synthetic",
    "startedAt": 1800000004001,
    "durationMs": 120,
    "outcome": "success"
  }
}
```

请求协议不包含请求观测、fetch/XHR 代理、请求采集插件、去重、分组、指纹、传输、采样、队列、重试、持久化、服务端或管理平台。
```

Also update the `## 非职责` bullet `不定义请求、性能、通用资源或行为事件正文` to `不定义性能、通用资源或行为事件正文` and the `## 关联文档` list to add `[请求事件协议契约](../../docs/protocol/request-event-contract.md)`.

- [ ] **Step 4: Update the formal request-contract examples**

Add the two `contract-example` markers and JSON fences to `docs/protocol/request-event-contract.md` (section 5 field semantics already documents the minimal body; insert the markers after that section):

```markdown
<!-- contract-example:valid-request-spec -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-spec-request-valid",
  "eventType": "request",
  "occurredAt": 1800000005100,
  "body": {
    "method": "GET",
    "url": "https://api.example.test/search?token=private#fragment",
    "startedAt": 1800000005000,
    "durationMs": 120,
    "outcome": "success",
    "statusCode": 200
  }
}
```

该输入成功后，输出 `body.url` 必须是 `https://api.example.test/search`。

<!-- contract-example:invalid-request-spec -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-spec-request-invalid",
  "eventType": "request",
  "occurredAt": 1800000005101,
  "body": {
    "method": "GET",
    "url": "file:///synthetic/report.csv",
    "startedAt": 1800000005001,
    "durationMs": 120,
    "outcome": "success"
  }
}
```

该输入返回 `invalid_url`，issue 不包含 URL 值。
```

- [ ] **Step 5: Update the downstream docs truthfully**

- `docs/protocol/event-envelope-v1.md`: add a sentence linking the request contract and clarifying `parseEventEnvelope` stays the generic layer while `parseRequestEventEnvelope` narrows `EventType.Request`. Keep the table unchanged.
- `docs/README.md`: add `[请求事件协议契约](protocol/request-event-contract.md)` as an implemented row; keep request observation, request plugin, batch, and processing absent.
- `docs/architecture/system-overview.md`: note the request event machine contract exists; request observation and request plugin remain absent.
- `docs/architecture/sdk-architecture.md`: update the "具体插件与传输仍不存在" statements to note the request *contract* exists while request *observation* and the request *plugin* remain absent (mirror how the error plugin was described after the error contract).
- `docs/architecture/formalization-readiness.md`: update the A1 row, the `event-schema` machine-contract row, and section 12 conclusion to include the request event contract first increment as implemented while the request observation capability, request plugin, batch schema, compatibility conversion, and real system consumers remain blocked.

- [ ] **Step 6: Append ADR implementation evidence**

Append one dated record to each ADR. Do not edit earlier records or change decision status.

Append to ADR-005:

```markdown
### 2026-07-31：请求事件协议契约第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录覆盖[请求事件协议契约第一增量](../protocol/request-event-contract.md)。
- `@aurora/event-schema` 根入口新增 `RequestMethod`、`RequestOutcome`、`REQUEST_EVENT_LIMITS`、`parseRequestEventBody`、`parseRequestEventEnvelope` 与请求正文/信封类型；`contract-testkit` 新增 `valid/invalid/boundaryRequestEventSamples`。
- 请求正文为精确六字段允许列表（`method`、`url`、`startedAt`、`durationMs`、`outcome`、可选 `statusCode`）；URL 移除全部查询参数与片段；允许来源、同源、跨域、路径归一化判断没有进入协议层。
- 中立 `field-validation.ts` 与 `safe-url.ts` 被错误契约与请求契约共享；错误契约全部既有测试保持通过，`error-event-validation.ts` 与 `resource-error-event.ts` 只改为复用助手。
- 验证命令：`pnpm --filter @aurora/event-schema typecheck/test/test:coverage/test:package`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
```

Append to ADR-006:

```markdown
### 2026-07-31：请求事件契约协议层边界实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- 请求事件正文继续由 `@aurora/event-schema`（`aurora.layer: protocol`）唯一承载；包保持零运行时依赖、零本地 Workspace 依赖、`sideEffects: false`、恰好两个公共入口。
- 请求解析器、请求样本和共享字段/URL 助手均不进入根出口之外的新子路径；`request-event-body`、`request-event-envelope`、`request-event-types`、`field-validation`、`safe-url` 全部以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝。
- 生产源码不含 DOM/宿主全局、Node 运行时、Core/Browser/插件依赖或 console 输出；`pnpm check:boundaries` 通过。
- 验证命令：`pnpm --filter @aurora/event-schema typecheck/test/test:package`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
```

Append to ADR-003:

```markdown
### 2026-07-31：请求事件协议前置契约实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只澄清请求采集插件的前置协议契约已具备，不实施请求观测或请求插件。
- 关联：[请求事件协议契约第一增量](../protocol/request-event-contract.md)。
- 当前事实：`@aurora/event-schema` 已实施请求事件协议契约第一增量——`parseRequestEventBody`/`parseRequestEventEnvelope`、请求方法/结果常量、请求样本与三类消费者契约。
- 边界澄清：请求协议不是请求观测或请求插件。`packages/browser` 请求观测能力、`packages/plugin-request`、fetch/XHR 代理、请求去重、分组、指纹、Source Map、传输、采样、队列、重试与持久化均不存在；未来请求采集插件只能从 `@aurora/event-schema` 根入口导入请求契约常量、类型与解析器，把完整 `RequestEventEnvelope` 交给 Core 公开事件入口。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
- 剩余工作：请求观测与请求插件仍需独立规格并在上游前置全部实施后规划；ADR 保持 `in-progress`。
```

ADR-007 remains `accepted / implemented` and receives no record because its package manager and task-runner decision did not change.

- [ ] **Step 7: Update the project snapshots**

Only after Step 5–6 pass:

- `AGENTS.md`: update the `@aurora/event-schema` bullet and decision queue so the request event contract first increment is listed as implemented while request observation, request plugin, performance/resource/behavior bodies, batch, and transport remain absent.
- `AURORA_RULES.md`: mirror the same state in the "已具备" section, the ADR-005 row, and the decision queue.
- `README.md` (root): update the current-state paragraph to list the request event contract as implemented and keep request observation/request plugin/CI/release/server absent.

- [ ] **Step 8: Record the suggested commit boundary**

```powershell
git add packages/event-schema/README.md packages/event-schema/test/documentation-contract.test.ts docs/protocol/event-envelope-v1.md docs/README.md docs/architecture/system-overview.md docs/architecture/sdk-architecture.md docs/architecture/formalization-readiness.md docs/adr/ADR-005-event-schema-source-of-truth.md docs/adr/ADR-006-one-way-dependencies.md docs/adr/ADR-003-sdk-plugin-architecture.md AGENTS.md AURORA_RULES.md README.md
git commit -m "docs: record request event contract evidence"
```

### Task 7: Run the Root Complete Quality Gate, Coverage, and Audit

**Files:** none new (verification only).

- [ ] **Step 1: Run the module gates**

```powershell
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema test
pnpm --filter @aurora/event-schema test:coverage
pnpm --filter @aurora/event-schema test:package
```

Expected: every command exits 0; coverage reports statements ≥ 85%, branches ≥ 80%, functions ≥ 85%, lines ≥ 85%. The request parser files and the shared helpers must be above threshold (do not exclude them).

- [ ] **Step 2: Run the root complete quality gate in this exact order**

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm build
pnpm --filter @aurora/event-schema test:package
pnpm --filter @aurora/core test:package
pnpm --filter @aurora/browser test:package
pnpm --filter @aurora/plugin-error test:package
pnpm --filter @aurora/browser test:browser
pnpm --filter @aurora/plugin-error test:browser
pnpm check:ci
git diff --check
```

Expected: every command exits 0; both Chromium suites pass; all four event-schema coverage thresholds pass; package-private paths remain rejected; `pnpm check:ci` repeats the complete root gate successfully; `git diff --check` prints nothing.

If a command fails, do not update implementation status or ADR evidence. Fix only the failing task's owned file, rerun its targeted command, then rerun the complete sequence from the first command.

- [ ] **Step 3: Audit exclusions and the complete diff**

Run:

```powershell
git diff -- packages/event-schema docs/protocol docs/architecture docs/adr AGENTS.md AURORA_RULES.md README.md
git status --short --branch
```

Then run this negative production-source search (no match expected):

```powershell
Get-ChildItem -LiteralPath packages/event-schema/src -Filter *.ts -Recurse | Select-String -Pattern 'fetch\(|XMLHttpRequest|window\.|document\.|localStorage|sessionStorage|Cookie|Authorization|@aurora/(core|browser)|node:|console\.|queue|retry|persist|source.?map|fingerprint|dedup|requestbody|responsebody'
```

Expected: the scoped diff contains only this plan's implementation and documentation; status preserves all unrelated pre-existing work; the negative search returns no production match. Legitimate exclusions (e.g. `retry`/`queue`/`persist` words) may appear in README or docs, which are intentionally outside this production-source search.

- [ ] **Step 4: Record the final suggested commit boundary**

```powershell
git add docs/protocol/request-event-contract.md docs/superpowers/plans/2026-07-31-request-event-contract.md
git commit -m "docs: add request event contract specification and plan"
```

Do not push, create a PR, start another module, or change any ADR decision/status beyond the implementation evidence explicitly listed above without separate user authorization.

## Final Executor Self-check

Before claiming implementation completion, answer each item from fresh command output:

1. Only the existing `EventEnvelope`, `EventType.Request`, `CURRENT_PROTOCOL_VERSION`, and `EventSchemaIssueCode` sources are reused; no second envelope, version, ID, or time source exists.
2. URL query/fragment, forbidden fields, and non-finite numbers are rejected; the request body is an exact six-field allow-list.
3. Error contract behavior is unchanged after the neutral-helper extraction (full error suite green).
4. The request contract never collects Cookie, Authorization, Token, body, headers, sizes, form data, DOM, page text, user input, Storage, full URL query/fragment, fingerprint, or IP.
5. `@aurora/event-schema` remains zero-runtime-dependency, `protocol` layer, exactly two public entries, and private subpaths reject.
6. `parseRequestEventBody` and `parseRequestEventEnvelope` are non-throwing for ordinary invalid input and never modify input.
7. SDK, ingestion, and processing consumers share the same request sample source and agree on sanitized output.
8. Coverage meets lines 85%, branches 80%, functions 85%, statements 85%.
9. Package-entry, dependency-negative, consumer-contract, documentation-contract, and boundary checks pass; no Chromium suite is required for this protocol package.
10. Documentation and ADRs describe only evidence produced by the completed commands, and ADR-003/005/006 remain `accepted / in-progress` while ADR-007 remains `accepted / implemented`.
