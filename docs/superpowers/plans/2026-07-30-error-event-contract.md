# Error Event Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@aurora/event-schema` with the first concrete error-event contract: strict JavaScript runtime, unhandled Promise rejection, and resource-load error bodies; safe runtime parsing; shared contract samples; and verified public/package/documentation boundaries without implementing error collection.

**Architecture:** Keep `@aurora/event-schema` as the zero-runtime-dependency protocol authority. The new `parseErrorEventEnvelope(input: unknown)` composes the existing `parseEventEnvelope` instead of duplicating envelope/version/timestamp rules, then narrows `EventType.Error` and delegates to a discriminated `ErrorEventBody` parser. Exact allowlists reject unknown fields; resource URLs are copied with query and fragment removed; non-standard Promise values reuse the existing bounded JSON rules and are recursively copied. Runtime contracts stay at the package root, while synthetic samples stay in the existing `contract-testkit` entry.

**Tech Stack:** Node.js 24.18.0, pnpm 11.17.0, TypeScript 6.0.3 strict mode, Vitest 4.1.10, `@vitest/coverage-v8` 4.1.10, ESLint 10.8.0, Prettier 3.9.6, existing `@aurora/workspace-policy`; no new dependency.

## Global Constraints

- Implement only the approved [error-event contract specification](../../protocol/error-event-contract.md) inside the existing `@aurora/event-schema` package plus its tests, documentation, indexes, and implementation evidence.
- Preserve every pre-existing user change. At the start of every task inspect `git status --short --branch` and `git diff --cached --stat`; do not clean, reset, discard, stage, commit, push, rebase, or rewrite unrelated work.
- Do not install or upgrade dependencies. `package.json`, `pnpm-lock.yaml`, TypeScript, ESLint, Vitest, and Workspace package topology remain unchanged except that the root `format:check` file list adds the new formal protocol document.
- Reuse `EventEnvelope`, `EventType.Error`, `CURRENT_PROTOCOL_VERSION`, `EVENT_SCHEMA_LIMITS`, `parseEventEnvelope`, `EventSchemaIssue`, `EventSchemaIssueCode`, and `appendIssue`. Do not create another envelope, timestamp, protocol version, issue shape, or version registry.
- Keep `parseEventEnvelope(input: unknown)` and `EventEnvelope.body: unknown` unchanged. Generic envelope success is not concrete error-body success.
- All three bodies use `eventType: EventType.Error`. `EventType.Resource` is not the resource-load error event type.
- Treat every parser input as `unknown`; all public functions have explicit parameter and return types and are synchronous.
- Ordinary invalid inputs return stable issues and do not throw, log, stringify, or echo input values. Catch property-access failures only to return a fixed, non-sensitive `invalid_type` issue.
- Never mutate the caller's input. Every successful body, descriptor, resource object, Promise reason, array, and plain object is newly allocated.
- Keep exact field allowlists. Missing, null, empty, wrong-type, oversized, unknown-field, invalid-enum, invalid-URL, mismatch, cyclic, too-deep, and too-large cases have black-box tests.
- Strip every resource URL query and fragment. Accept only lowercase absolute `http://` or `https://` URLs with non-empty authority and no credentials, whitespace, control characters, or backslash.
- Reuse whole-body limits for non-standard Promise values: strings 4096, arrays 100, object keys 100, total body depth 8, issues 50. Do not serialize arbitrary rejection values.
- Use strict TypeScript; no unexplained `any`, `Object`, `Function`, `Record<string, any>`, broad/double assertions, non-null assertions, `@ts-ignore`, or silent catch.
- Use `kebab-case` files, `PascalCase` types/interfaces, `camelCase` functions/variables, and `is`/`has`/`can`/`should` boolean names.
- Keep files and functions single-purpose. Do not create `utils`, `helpers`, `common`, `misc`, a generic Schema DSL, registry, event bus, hook framework, serializer framework, or compatibility converter.
- `@aurora/event-schema` retains zero runtime and zero local Workspace dependencies. Source must not use DOM or Node-exclusive runtime APIs.
- Cross-package consumers import only `@aurora/event-schema` or `@aurora/event-schema/contract-testkit`; private `src`, `internal`, test, and unexported paths remain rejected.
- Keep samples synthetic and free of real Cookie, Token, Authorization, password, request/response bodies, forms, DOM, page text, user input, Storage, IP, personal information, or full URL query values.
- Keep event-schema thresholds at lines `85`, branches `80`, functions `85`, statements `85`; do not exclude new logic files or lower thresholds.
- Each task follows: write failing test → confirm expected failure → write minimum implementation → confirm pass → run related regression → record a suggested commit boundary. Suggested Git commands are documentation only and require separate user authorization.
- Do not create browser listeners, `packages/plugin-error`, Core plugins, React/Vue adapters, error normalization, deduplication, grouping, fingerprints, Source Map handling, transport, sampling, queueing, retry, persistence, services, databases, management UI, CI workflows, release tooling, containers, IaC, or cloud resources.
- Browser real-engine tests are not run for this pure protocol increment; no DOM or browser behavior changes.

## Final Public API

After Task 5, `@aurora/event-schema` must additionally export exactly this contract:

```ts
export const ErrorCategory: {
  readonly JavaScript: 'javascript';
  readonly UnhandledRejection: 'unhandled_rejection';
  readonly Resource: 'resource';
};
export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

export const PromiseRejectionReasonKind: {
  readonly Error: 'error';
  readonly String: 'string';
  readonly NonStandard: 'non_standard';
};
export type PromiseRejectionReasonKind =
  (typeof PromiseRejectionReasonKind)[keyof typeof PromiseRejectionReasonKind];

export const ErrorResourceType: {
  readonly Script: 'script';
  readonly Stylesheet: 'stylesheet';
  readonly Image: 'image';
  readonly Font: 'font';
};
export type ErrorResourceType =
  (typeof ErrorResourceType)[keyof typeof ErrorResourceType];

export const ERROR_EVENT_LIMITS: {
  readonly maxErrorNameLength: 128;
  readonly maxErrorMessageLength: 2048;
  readonly maxStackLength: 4096;
  readonly maxResourceUrlLength: 2048;
  readonly maxRejectionStringLength: 2048;
};

export interface ErrorDescriptor {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
}
export interface JavaScriptErrorEventBody {
  readonly category: typeof ErrorCategory.JavaScript;
  readonly error: ErrorDescriptor;
}
export interface ErrorPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.Error;
  readonly error: ErrorDescriptor;
}
export interface StringPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.String;
  readonly value: string;
}
export type SafeErrorObject = { readonly [key: string]: SafeErrorValue };
export type SafeErrorValue =
  | null
  | boolean
  | number
  | string
  | readonly SafeErrorValue[]
  | SafeErrorObject;
export interface NonStandardPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.NonStandard;
  readonly value: SafeErrorValue;
}
export type PromiseRejectionReason =
  | ErrorPromiseRejectionReason
  | StringPromiseRejectionReason
  | NonStandardPromiseRejectionReason;
export interface UnhandledPromiseRejectionErrorEventBody {
  readonly category: typeof ErrorCategory.UnhandledRejection;
  readonly reason: PromiseRejectionReason;
}
export interface ResourceLoadError {
  readonly type: ErrorResourceType;
  readonly url: string;
}
export interface ResourceLoadErrorEventBody {
  readonly category: typeof ErrorCategory.Resource;
  readonly resource: ResourceLoadError;
}
export type ErrorEventBody =
  | JavaScriptErrorEventBody
  | UnhandledPromiseRejectionErrorEventBody
  | ResourceLoadErrorEventBody;
export type ErrorEventEnvelope = EventEnvelope & {
  readonly eventType: typeof EventType.Error;
  readonly body: ErrorEventBody;
};
export interface ErrorEventBodyParseSuccess {
  readonly success: true;
  readonly data: ErrorEventBody;
}
export type ErrorEventBodyParseFailure = EventEnvelopeParseFailure;
export type ErrorEventBodyParseResult =
  | ErrorEventBodyParseSuccess
  | ErrorEventBodyParseFailure;
export interface ErrorEventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: ErrorEventEnvelope;
}
export type ErrorEventEnvelopeParseFailure = EventEnvelopeParseFailure;
export type ErrorEventEnvelopeParseResult =
  | ErrorEventEnvelopeParseSuccess
  | ErrorEventEnvelopeParseFailure;
export function parseErrorEventBody(input: unknown): ErrorEventBodyParseResult;
export function parseErrorEventEnvelope(input: unknown): ErrorEventEnvelopeParseResult;
```

`EventSchemaIssueCode` additionally includes `'string_empty' | 'invalid_url' | 'event_type_mismatch'`.

`@aurora/event-schema/contract-testkit` additionally exports:

```ts
export interface ValidErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: ErrorEventEnvelope;
}
export interface InvalidErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}
export interface BoundaryErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: ErrorEventEnvelope;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}
export const validErrorEventSamples: readonly ValidErrorEventSample[];
export const invalidErrorEventSamples: readonly InvalidErrorEventSample[];
export const boundaryErrorEventSamples: readonly BoundaryErrorEventSample[];
```

## Complete File Tree and Responsibilities

```text
package.json                                             # Add the new formal protocol doc to format:check only
packages/event-schema/
├── README.md                                            # Implemented error contract, API, privacy, limits, exclusions
├── package.json                                         # Unchanged private ESM manifest and two public entries
├── tsconfig.json                                        # Unchanged strict source/test configuration
├── tsconfig.build.json                                  # Unchanged ES-only, types-free declaration build
├── vitest.config.ts                                     # Unchanged 85/80/85/85 thresholds and inclusion
├── src/
│   ├── constants.ts                                     # Existing envelope/version/body limits; unchanged
│   ├── error-descriptor.ts                              # Exact ErrorDescriptor parser
│   ├── error-event-body.ts                              # Public body parser and category dispatch
│   ├── error-event-envelope.ts                          # Existing envelope composition and mismatch handling
│   ├── error-event-types.ts                             # All error constants, limits, bodies, results, envelope types
│   ├── error-event-validation.ts                        # Error-domain field reads, allowlists, bounded strings, issues
│   ├── event-envelope.ts                                # Existing generic envelope parser; unchanged
│   ├── event-types.ts                                   # Existing EventType source; unchanged
│   ├── index.ts                                         # Minimal root exports
│   ├── javascript-error-event.ts                        # JavaScript body parser
│   ├── promise-rejection-error-event.ts                 # Promise reason parser and bounded recursive copy
│   ├── resource-error-event.ts                          # Resource type parser and query/fragment removal
│   ├── validation-issues.ts                             # Three additive stable issue codes
│   ├── value-boundaries.ts                              # Existing generic body limits/forbidden fields; reused
│   └── contract-testkit/
│       ├── boundary-error-event-samples.ts              # Exact-limit and compatibility cases
│       ├── boundary-samples.ts                          # Existing envelope samples; unchanged
│       ├── index.ts                                     # Preserve old samples; add error samples
│       ├── invalid-error-event-samples.ts               # One stable failure expectation per invalid case
│       ├── invalid-samples.ts                           # Existing envelope samples; unchanged
│       ├── valid-error-event-samples.ts                 # Inputs plus sanitized/copied expected envelopes
│       └── valid-samples.ts                             # Existing envelope samples; unchanged
└── test/
    ├── architecture-boundary.test.ts                    # Zero deps, ES-only source, no private consumer paths
    ├── documentation-contract.test.ts                   # Existing examples plus error README/spec examples
    ├── error-event-envelope.test.ts                     # Envelope composition, mismatch, versions, timestamp, copy
    ├── error-event-types.test.ts                        # Exact constants/limits and root public types
    ├── javascript-error-event.test.ts                   # JavaScript body legal/illegal/boundary behavior
    ├── package-entry.test.ts                            # Built runtime exports and rejected private paths
    ├── promise-rejection-error-event.test.ts            # Three reason kinds, hostile/bounded values, copy
    ├── public-error-api-consumer.ts                     # Compile-only root type consumer
    ├── resource-error-event.test.ts                     # Types, URL safety, query removal, exact fields
    └── consumers/
        ├── ingestion-error-event.contract.test.ts       # Shared invalid samples and stable issues
        ├── processing-error-event.contract.test.ts      # Shared boundaries and sanitized expected output
        └── sdk-error-event.contract.test.ts             # Shared legal producer samples
tooling/workspace-policy/
├── src/*                                                # Existing protocol zero-dependency/private-path policy; unchanged
└── test/
    ├── dependency-policy.test.ts                        # Existing protocol dependency negative; rerun
    └── event-schema-package-contract.test.ts            # Existing manifest/export/command contract; rerun
docs/
├── README.md                                            # Add the formal contract and implemented-state link
├── protocol/
│   ├── error-event-contract.md                          # Approved authority; verify implementation remains aligned
│   └── event-envelope-v1.md                             # Generic-versus-error parser layering
├── architecture/
│   ├── system-overview.md                               # Error machine contract exists; plugin absent
│   ├── sdk-architecture.md                              # Plugin consumes public error contract; plugin absent
│   └── formalization-readiness.md                       # A1 error contract evidence; other bodies/batches blocked
└── adr/
    ├── ADR-003-sdk-plugin-architecture.md               # Clarify prerequisite only; accepted/in-progress
    ├── ADR-005-event-schema-source-of-truth.md           # Append verified error-contract evidence
    ├── ADR-006-one-way-dependencies.md                  # Append verified dependency/environment evidence
    └── README.md                                        # Preserve exact dual-state table
AGENTS.md                                                # Update stage snapshot only after verified implementation
AURORA_RULES.md                                         # Update stage/queue only after verified implementation
README.md                                                # Honest repository implementation boundary
```

---

### Task 1: Error constants, public types, limits, and stable issue codes

**Files:**
- Create: `packages/event-schema/test/error-event-types.test.ts`
- Create: `packages/event-schema/test/public-error-api-consumer.ts`
- Create: `packages/event-schema/src/error-event-types.ts`
- Modify: `packages/event-schema/src/validation-issues.ts`
- Modify: `packages/event-schema/src/index.ts`

**Consumes:**
- Existing `EventEnvelope`, `EventEnvelopeParseFailure`, `EventSchemaIssueCode`, `EventType.Error`, strict package root alias, and the approved signatures above.

**Produces:**
- Exact error/category/resource/reason constants and types, five error limits, error body/envelope/result types, three additive issue codes, and compile-visible root exports. No parser behavior yet.

- [ ] **Step 1: Recheck protected worktree**

Run:

```powershell
git status --short --branch
git diff --cached --stat
```

Expected: the branch and all existing tracked/untracked changes are visible; the staged set is unchanged. Do not clean or reorganize anything.

- [ ] **Step 2: Write failing runtime and compile-only public contract tests**

Create `packages/event-schema/test/error-event-types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  PromiseRejectionReasonKind,
} from '@aurora/event-schema';

describe('error event public constants', () => {
  it('exposes exactly three approved error categories', () => {
    expect(ErrorCategory).toEqual({
      JavaScript: 'javascript',
      UnhandledRejection: 'unhandled_rejection',
      Resource: 'resource',
    });
  });

  it('exposes exactly three Promise reason kinds', () => {
    expect(PromiseRejectionReasonKind).toEqual({
      Error: 'error',
      String: 'string',
      NonStandard: 'non_standard',
    });
  });

  it('exposes only the four approved static resource types', () => {
    expect(ErrorResourceType).toEqual({
      Script: 'script',
      Stylesheet: 'stylesheet',
      Image: 'image',
      Font: 'font',
    });
  });

  it('exposes every exact error-event limit', () => {
    expect(ERROR_EVENT_LIMITS).toEqual({
      maxErrorNameLength: 128,
      maxErrorMessageLength: 2048,
      maxStackLength: 4096,
      maxResourceUrlLength: 2048,
      maxRejectionStringLength: 2048,
    });
  });
});
```

Create `packages/event-schema/test/public-error-api-consumer.ts`:

```ts
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  EventType,
  PromiseRejectionReasonKind,
  type ErrorDescriptor,
  type ErrorEventBody,
  type ErrorEventBodyParseResult,
  type ErrorEventEnvelope,
  type ErrorEventEnvelopeParseResult,
  type ErrorPromiseRejectionReason,
  type JavaScriptErrorEventBody,
  type NonStandardPromiseRejectionReason,
  type PromiseRejectionReason,
  type ResourceLoadError,
  type ResourceLoadErrorEventBody,
  type SafeErrorObject,
  type SafeErrorValue,
  type StringPromiseRejectionReason,
  type UnhandledPromiseRejectionErrorEventBody,
} from '@aurora/event-schema';

const descriptor: ErrorDescriptor = { message: 'Synthetic failure' };
const javascriptBody: JavaScriptErrorEventBody = {
  category: ErrorCategory.JavaScript,
  error: descriptor,
};
const errorReason: ErrorPromiseRejectionReason = {
  kind: PromiseRejectionReasonKind.Error,
  error: descriptor,
};
const stringReason: StringPromiseRejectionReason = {
  kind: PromiseRejectionReasonKind.String,
  value: 'Synthetic rejection',
};
const safeObject: SafeErrorObject = { attempt: 1, tags: ['synthetic'] };
const safeValue: SafeErrorValue = safeObject;
const nonStandardReason: NonStandardPromiseRejectionReason = {
  kind: PromiseRejectionReasonKind.NonStandard,
  value: safeValue,
};
const reason: PromiseRejectionReason = errorReason;
const promiseBody: UnhandledPromiseRejectionErrorEventBody = {
  category: ErrorCategory.UnhandledRejection,
  reason,
};
const resource: ResourceLoadError = {
  type: ErrorResourceType.Script,
  url: 'https://static.example.test/app.js',
};
const resourceBody: ResourceLoadErrorEventBody = {
  category: ErrorCategory.Resource,
  resource,
};
const body: ErrorEventBody = javascriptBody;
const envelope: ErrorEventEnvelope = {
  protocolVersion: 1,
  eventId: 'evt-public-type-synthetic',
  eventType: EventType.Error,
  occurredAt: 1_800_000_001_000,
  body,
};

export const publicErrorApiConsumer: {
  readonly bodyResult: ErrorEventBodyParseResult | null;
  readonly envelope: ErrorEventEnvelope;
  readonly envelopeResult: ErrorEventEnvelopeParseResult | null;
  readonly limit: number;
  readonly promiseBody: UnhandledPromiseRejectionErrorEventBody;
  readonly resourceBody: ResourceLoadErrorEventBody;
  readonly stringReason: StringPromiseRejectionReason;
  readonly nonStandardReason: NonStandardPromiseRejectionReason;
} = {
  bodyResult: null,
  envelope,
  envelopeResult: null,
  limit: ERROR_EVENT_LIMITS.maxStackLength,
  promiseBody,
  resourceBody,
  stringReason,
  nonStandardReason,
};
```

- [ ] **Step 3: Confirm the intended red state**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/error-event-types.test.ts
pnpm --filter @aurora/event-schema typecheck
```

Expected: both commands exit `1`; TypeScript/Vitest report that the new error constants and types are not exported from `@aurora/event-schema`. No unrelated test should be edited to manufacture this failure.

- [ ] **Step 4: Add the exact public constants and types**

Create `packages/event-schema/src/error-event-types.ts`:

```ts
import type { EventEnvelope } from './event-envelope.js';
import { EventType } from './event-types.js';
import type { EventEnvelopeParseFailure } from './validation-issues.js';

export const ErrorCategory = {
  JavaScript: 'javascript',
  UnhandledRejection: 'unhandled_rejection',
  Resource: 'resource',
} as const;

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

export const PromiseRejectionReasonKind = {
  Error: 'error',
  String: 'string',
  NonStandard: 'non_standard',
} as const;

export type PromiseRejectionReasonKind =
  (typeof PromiseRejectionReasonKind)[keyof typeof PromiseRejectionReasonKind];

export const ErrorResourceType = {
  Script: 'script',
  Stylesheet: 'stylesheet',
  Image: 'image',
  Font: 'font',
} as const;

export type ErrorResourceType =
  (typeof ErrorResourceType)[keyof typeof ErrorResourceType];

export const ERROR_EVENT_LIMITS = {
  maxErrorNameLength: 128,
  maxErrorMessageLength: 2048,
  maxStackLength: 4096,
  maxResourceUrlLength: 2048,
  maxRejectionStringLength: 2048,
} as const;

export interface ErrorDescriptor {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
}

export interface JavaScriptErrorEventBody {
  readonly category: typeof ErrorCategory.JavaScript;
  readonly error: ErrorDescriptor;
}

export interface ErrorPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.Error;
  readonly error: ErrorDescriptor;
}

export interface StringPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.String;
  readonly value: string;
}

export type SafeErrorObject = {
  readonly [key: string]: SafeErrorValue;
};

export type SafeErrorValue =
  | null
  | boolean
  | number
  | string
  | readonly SafeErrorValue[]
  | SafeErrorObject;

export interface NonStandardPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.NonStandard;
  readonly value: SafeErrorValue;
}

export type PromiseRejectionReason =
  | ErrorPromiseRejectionReason
  | StringPromiseRejectionReason
  | NonStandardPromiseRejectionReason;

export interface UnhandledPromiseRejectionErrorEventBody {
  readonly category: typeof ErrorCategory.UnhandledRejection;
  readonly reason: PromiseRejectionReason;
}

export interface ResourceLoadError {
  readonly type: ErrorResourceType;
  readonly url: string;
}

export interface ResourceLoadErrorEventBody {
  readonly category: typeof ErrorCategory.Resource;
  readonly resource: ResourceLoadError;
}

export type ErrorEventBody =
  | JavaScriptErrorEventBody
  | UnhandledPromiseRejectionErrorEventBody
  | ResourceLoadErrorEventBody;

export type ErrorEventEnvelope = EventEnvelope & {
  readonly eventType: typeof EventType.Error;
  readonly body: ErrorEventBody;
};

export interface ErrorEventBodyParseSuccess {
  readonly success: true;
  readonly data: ErrorEventBody;
}

export type ErrorEventBodyParseFailure = EventEnvelopeParseFailure;
export type ErrorEventBodyParseResult =
  | ErrorEventBodyParseSuccess
  | ErrorEventBodyParseFailure;

export interface ErrorEventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: ErrorEventEnvelope;
}

export type ErrorEventEnvelopeParseFailure = EventEnvelopeParseFailure;
export type ErrorEventEnvelopeParseResult =
  | ErrorEventEnvelopeParseSuccess
  | ErrorEventEnvelopeParseFailure;
```

In `packages/event-schema/src/validation-issues.ts`, replace the issue union with:

```ts
export type EventSchemaIssueCode =
  | 'missing_required_field'
  | 'invalid_type'
  | 'unknown_field'
  | 'invalid_enum'
  | 'string_empty'
  | 'string_too_long'
  | 'array_too_large'
  | 'object_too_large'
  | 'object_too_deep'
  | 'cyclic_reference'
  | 'invalid_number'
  | 'invalid_timestamp'
  | 'invalid_url'
  | 'event_type_mismatch'
  | 'unknown_event_type'
  | 'unsupported_protocol_version'
  | 'forbidden_field';
```

Append these exact export blocks to `packages/event-schema/src/index.ts`:

```ts
export {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  PromiseRejectionReasonKind,
} from './error-event-types.js';
export type {
  ErrorDescriptor,
  ErrorEventBody,
  ErrorEventBodyParseFailure,
  ErrorEventBodyParseResult,
  ErrorEventBodyParseSuccess,
  ErrorEventEnvelope,
  ErrorEventEnvelopeParseFailure,
  ErrorEventEnvelopeParseResult,
  ErrorEventEnvelopeParseSuccess,
  ErrorPromiseRejectionReason,
  JavaScriptErrorEventBody,
  NonStandardPromiseRejectionReason,
  PromiseRejectionReason,
  ResourceLoadError,
  ResourceLoadErrorEventBody,
  SafeErrorObject,
  SafeErrorValue,
  StringPromiseRejectionReason,
  UnhandledPromiseRejectionErrorEventBody,
} from './error-event-types.js';
```

- [ ] **Step 5: Confirm green and related regression**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/error-event-types.test.ts
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema exec vitest run test/version-and-event-type.test.ts test/event-envelope.test.ts
```

Expected: all commands exit `0`; the focused file reports `4 passed`; existing version/envelope tests remain green.

- [ ] **Step 6: Suggested commit boundary**

```bash
git add packages/event-schema/src/error-event-types.ts packages/event-schema/src/validation-issues.ts packages/event-schema/src/index.ts packages/event-schema/test/error-event-types.test.ts packages/event-schema/test/public-error-api-consumer.ts
git commit -m "feat(protocol): define error event contract types"
```

Do not execute these Git commands without separate authorization.

---

### Task 2: JavaScript runtime error body parser

**Files:**
- Create: `packages/event-schema/test/javascript-error-event.test.ts`
- Create: `packages/event-schema/src/error-event-validation.ts`
- Create: `packages/event-schema/src/error-descriptor.ts`
- Create: `packages/event-schema/src/javascript-error-event.ts`
- Create: `packages/event-schema/src/error-event-body.ts`
- Modify: `packages/event-schema/src/index.ts`

**Consumes:**
- Task 1 constants/types/issues, existing `validateBodyValue`, `appendIssue`, and fixed `['body']` issue paths.

**Produces:**
- Public `parseErrorEventBody(input: unknown)` with exact JavaScript body parsing, fixed non-sensitive getter-failure handling, fresh output objects, and explicit unsupported-category rejection until Tasks 3–4 add the other variants.

- [ ] **Step 1: Write the failing JavaScript public behavior tests**

Create `packages/event-schema/test/javascript-error-event.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  parseErrorEventBody,
  type EventSchemaIssueCode,
} from '@aurora/event-schema';

function issueCodes(input: unknown): readonly EventSchemaIssueCode[] {
  const result = parseErrorEventBody(input);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

describe('JavaScript runtime error body', () => {
  it('accepts the minimum body and returns a fresh object', () => {
    const input = {
      category: ErrorCategory.JavaScript,
      error: { message: 'Synthetic runtime failure' },
    };
    const result = parseErrorEventBody(input);
    expect(result).toEqual({ success: true, data: input });
    expect(parseErrorEventBody(input)).toEqual(result);
    if (result.success) {
      expect(result.data).not.toBe(input);
      expect(result.data.error).not.toBe(input.error);
    }
  });

  it('accepts bounded name, message, and raw stack', () => {
    expect(
      parseErrorEventBody({
        category: ErrorCategory.JavaScript,
        error: {
          name: 'TypeError',
          message: 'Synthetic runtime failure',
          stack: 'TypeError: Synthetic runtime failure\n    at app.js:1:1',
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    [{ error: { message: 'Synthetic' } }, 'missing_required_field'],
    [{ category: ErrorCategory.JavaScript }, 'missing_required_field'],
    [{ category: ErrorCategory.JavaScript, error: {} }, 'missing_required_field'],
    [{ category: ErrorCategory.JavaScript, error: null }, 'invalid_type'],
    [{ category: ErrorCategory.JavaScript, error: { message: null } }, 'invalid_type'],
    [{ category: ErrorCategory.JavaScript, error: { message: '' } }, 'string_empty'],
    [{ category: 'JavaScript', error: { message: 'Synthetic' } }, 'invalid_enum'],
  ] as const)('rejects malformed body %#', (input, code) => {
    expect(issueCodes(input)).toContain(code);
  });

  it('enforces exact string boundaries', () => {
    expect(
      parseErrorEventBody({
        category: ErrorCategory.JavaScript,
        error: {
          name: 'n'.repeat(ERROR_EVENT_LIMITS.maxErrorNameLength),
          message: 'm'.repeat(ERROR_EVENT_LIMITS.maxErrorMessageLength),
          stack: 's'.repeat(ERROR_EVENT_LIMITS.maxStackLength),
        },
      }).success,
    ).toBe(true);
    expect(
      issueCodes({
        category: ErrorCategory.JavaScript,
        error: { message: 'm'.repeat(ERROR_EVENT_LIMITS.maxErrorMessageLength + 1) },
      }),
    ).toContain('string_too_long');
    expect(
      issueCodes({
        category: ErrorCategory.JavaScript,
        error: {
          name: 'n'.repeat(ERROR_EVENT_LIMITS.maxErrorNameLength + 1),
          message: 'Synthetic',
        },
      }),
    ).toContain('string_too_long');
    expect(
      issueCodes({
        category: ErrorCategory.JavaScript,
        error: {
          message: 'Synthetic',
          stack: 's'.repeat(ERROR_EVENT_LIMITS.maxStackLength + 1),
        },
      }),
    ).toContain('string_too_long');
  });

  it('rejects unknown fields at both exact object levels', () => {
    expect(
      issueCodes({
        category: ErrorCategory.JavaScript,
        extra: true,
        error: { message: 'Synthetic' },
      }),
    ).toContain('unknown_field');
    expect(
      issueCodes({
        category: ErrorCategory.JavaScript,
        error: { message: 'Synthetic', line: 1 },
      }),
    ).toContain('unknown_field');
  });

  it('returns a fixed issue when a getter throws and does not throw or log', () => {
    const input = Object.defineProperty({}, 'category', {
      enumerable: true,
      get(): never {
        throw new Error('synthetic getter detail');
      },
    });
    expect(() => parseErrorEventBody(input)).not.toThrow();
    const result = parseErrorEventBody(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual([
        {
          code: 'invalid_type',
          path: ['body'],
          message: 'Error event body could not be read safely',
        },
      ]);
      expect(JSON.stringify(result.issues)).not.toContain('synthetic getter detail');
    }
  });
});
```

- [ ] **Step 2: Confirm the intended red state**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/javascript-error-event.test.ts
```

Expected: exit `1`; module import fails because `parseErrorEventBody` is not exported.

- [ ] **Step 3: Add domain-specific field validation**

Create `packages/event-schema/src/error-event-validation.ts`:

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

export function isPlainErrorRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

export function addErrorEventIssue(
  issues: EventSchemaIssue[],
  code: EventSchemaIssue['code'],
  path: readonly (string | number)[],
  message: string,
): void {
  appendIssue(issues, { code, path: [...path], message });
}

export function readRequiredErrorField(
  input: Record<string, unknown>,
  field: string,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): FieldReadResult {
  if (!Object.prototype.hasOwnProperty.call(input, field)) {
    addErrorEventIssue(issues, 'missing_required_field', [...path, field], 'Required field is missing');
    return { found: false };
  }
  return { found: true, value: input[field] };
}

export function rejectUnknownErrorFields(
  input: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): void {
  if (Object.getOwnPropertySymbols(input).length > 0) {
    addErrorEventIssue(
      issues,
      'unknown_field',
      [...path, '$symbol'],
      'Symbol fields are not allowed in error events',
    );
  }
  for (const field of Object.keys(input).sort()) {
    if (!allowedFields.has(field)) {
      addErrorEventIssue(issues, 'unknown_field', [...path, field], 'Unknown error event field');
    }
  }
}

export function parseBoundedErrorString(
  input: unknown,
  maximumLength: number,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): string | undefined {
  if (typeof input !== 'string') {
    addErrorEventIssue(issues, 'invalid_type', path, 'Error event field must be a string');
    return undefined;
  }
  if (input.length === 0) {
    addErrorEventIssue(issues, 'string_empty', path, 'Error event string must not be empty');
    return undefined;
  }
  if (input.length > maximumLength) {
    addErrorEventIssue(issues, 'string_too_long', path, 'Error event string exceeds maximum length');
    return undefined;
  }
  return input;
}
```

- [ ] **Step 4: Add ErrorDescriptor and JavaScript body parsing**

Create `packages/event-schema/src/error-descriptor.ts`:

```ts
import { ERROR_EVENT_LIMITS, type ErrorDescriptor } from './error-event-types.js';
import {
  addErrorEventIssue,
  isPlainErrorRecord,
  parseBoundedErrorString,
  readRequiredErrorField,
  rejectUnknownErrorFields,
} from './error-event-validation.js';
import type { EventSchemaIssue } from './validation-issues.js';

const ERROR_DESCRIPTOR_FIELDS: ReadonlySet<string> = new Set(['name', 'message', 'stack']);

export function parseErrorDescriptor(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): ErrorDescriptor | undefined {
  if (!isPlainErrorRecord(input)) {
    addErrorEventIssue(issues, 'invalid_type', path, 'Error descriptor must be a plain object');
    return undefined;
  }
  rejectUnknownErrorFields(input, ERROR_DESCRIPTOR_FIELDS, issues, path);
  const messageField = readRequiredErrorField(input, 'message', issues, path);
  const message = messageField.found
    ? parseBoundedErrorString(
        messageField.value,
        ERROR_EVENT_LIMITS.maxErrorMessageLength,
        issues,
        [...path, 'message'],
      )
    : undefined;
  const name =
    Object.prototype.hasOwnProperty.call(input, 'name')
      ? parseBoundedErrorString(
          input.name,
          ERROR_EVENT_LIMITS.maxErrorNameLength,
          issues,
          [...path, 'name'],
        )
      : undefined;
  const stack =
    Object.prototype.hasOwnProperty.call(input, 'stack')
      ? parseBoundedErrorString(
          input.stack,
          ERROR_EVENT_LIMITS.maxStackLength,
          issues,
          [...path, 'stack'],
        )
      : undefined;
  if (message === undefined) return undefined;
  return {
    ...(name === undefined ? {} : { name }),
    message,
    ...(stack === undefined ? {} : { stack }),
  };
}
```

Create `packages/event-schema/src/javascript-error-event.ts`:

```ts
import {
  ErrorCategory,
  type JavaScriptErrorEventBody,
} from './error-event-types.js';
import {
  addErrorEventIssue,
  isPlainErrorRecord,
  readRequiredErrorField,
  rejectUnknownErrorFields,
} from './error-event-validation.js';
import { parseErrorDescriptor } from './error-descriptor.js';
import type { EventSchemaIssue } from './validation-issues.js';

const JAVASCRIPT_BODY_FIELDS: ReadonlySet<string> = new Set(['category', 'error']);

export function parseJavaScriptErrorEventBody(
  input: Record<string, unknown>,
  issues: EventSchemaIssue[],
): JavaScriptErrorEventBody | undefined {
  rejectUnknownErrorFields(input, JAVASCRIPT_BODY_FIELDS, issues, ['body']);
  const errorField = readRequiredErrorField(input, 'error', issues, ['body']);
  const error = errorField.found
    ? parseErrorDescriptor(errorField.value, issues, ['body', 'error'])
    : undefined;
  if (error === undefined) return undefined;
  return { category: ErrorCategory.JavaScript, error };
}
```

Create `packages/event-schema/src/error-event-body.ts`:

```ts
import {
  ErrorCategory,
  type ErrorEventBodyParseResult,
} from './error-event-types.js';
import {
  addErrorEventIssue,
  isPlainErrorRecord,
  readRequiredErrorField,
} from './error-event-validation.js';
import { parseJavaScriptErrorEventBody } from './javascript-error-event.js';
import type { EventSchemaIssue } from './validation-issues.js';
import { validateBodyValue } from './value-boundaries.js';

function unsafeBodyFailure(): ErrorEventBodyParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: ['body'],
        message: 'Error event body could not be read safely',
      },
    ],
  };
}

function parseBody(input: unknown): ErrorEventBodyParseResult {
  const issues: EventSchemaIssue[] = [];
  validateBodyValue(input, issues);
  if (issues.length > 0) return { success: false, issues };
  if (!isPlainErrorRecord(input)) {
    addErrorEventIssue(issues, 'invalid_type', ['body'], 'Error event body must be a plain object');
    return { success: false, issues };
  }
  const categoryField = readRequiredErrorField(input, 'category', issues, ['body']);
  if (!categoryField.found) return { success: false, issues };
  if (typeof categoryField.value !== 'string') {
    addErrorEventIssue(
      issues,
      'invalid_type',
      ['body', 'category'],
      'Error category must be a string',
    );
    return { success: false, issues };
  }
  if (categoryField.value !== ErrorCategory.JavaScript) {
    addErrorEventIssue(
      issues,
      'invalid_enum',
      ['body', 'category'],
      'Error category is not supported',
    );
    return { success: false, issues };
  }
  const data = parseJavaScriptErrorEventBody(input, issues);
  return issues.length > 0 || data === undefined
    ? { success: false, issues }
    : { success: true, data };
}

export function parseErrorEventBody(input: unknown): ErrorEventBodyParseResult {
  try {
    return parseBody(input);
  } catch {
    return unsafeBodyFailure();
  }
}
```

Append to `packages/event-schema/src/index.ts`:

```ts
export { parseErrorEventBody } from './error-event-body.js';
```

- [ ] **Step 5: Confirm green and run related regression**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/javascript-error-event.test.ts
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema exec vitest run test/value-boundaries.test.ts test/event-envelope.test.ts
```

Expected: all commands exit `0`; JavaScript tests cover the minimum/full shapes, all malformed cases, exact limits, unknown fields, fresh objects, and throwing getter; existing body/envelope tests stay green.

- [ ] **Step 6: Suggested commit boundary**

```bash
git add packages/event-schema/src/error-event-validation.ts packages/event-schema/src/error-descriptor.ts packages/event-schema/src/javascript-error-event.ts packages/event-schema/src/error-event-body.ts packages/event-schema/src/index.ts packages/event-schema/test/javascript-error-event.test.ts
git commit -m "feat(protocol): parse javascript error bodies"
```

Do not execute these Git commands without separate authorization.

---

### Task 3: Promise rejection reason parser and bounded safe-value copy

**Files:**
- Create: `packages/event-schema/test/promise-rejection-error-event.test.ts`
- Create: `packages/event-schema/src/promise-rejection-error-event.ts`
- Modify: `packages/event-schema/src/error-event-body.ts`

**Consumes:**
- Existing whole-body resource validator, `ErrorDescriptor` parser, exact-field helpers, Promise reason constants/types, and JavaScript parser from Task 2.

**Produces:**
- Error-style, string-style, and non-standard Promise rejection bodies; safe failure for cyclic/non-JSON/oversized/deep values; recursive copied output; no raw serialization.

- [ ] **Step 1: Write failing Promise public behavior tests**

Create `packages/event-schema/test/promise-rejection-error-event.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ERROR_EVENT_LIMITS,
  EVENT_SCHEMA_LIMITS,
  ErrorCategory,
  PromiseRejectionReasonKind,
  parseErrorEventBody,
  type EventSchemaIssueCode,
} from '@aurora/event-schema';

function issueCodes(input: unknown): readonly EventSchemaIssueCode[] {
  const result = parseErrorEventBody(input);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

function nestedValue(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) value = { nested: value };
  return value;
}

describe('unhandled Promise rejection body', () => {
  it('accepts Error-style and string-style reasons', () => {
    expect(
      parseErrorEventBody({
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.Error,
          error: { name: 'Error', message: 'Synthetic rejection', stack: 'at app.js:1:1' },
        },
      }).success,
    ).toBe(true);
    expect(
      parseErrorEventBody({
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.String,
          value: 'Synthetic rejection',
        },
      }).success,
    ).toBe(true);
  });

  it.each([null, true, 42, ['synthetic', 1], { code: 7, tags: ['synthetic'] }])(
    'accepts and recursively copies bounded non-standard value %#',
    (value) => {
      const input = {
        category: ErrorCategory.UnhandledRejection,
        reason: { kind: PromiseRejectionReasonKind.NonStandard, value },
      };
      const result = parseErrorEventBody(input);
      expect(result.success).toBe(true);
      if (result.success && result.data.category === ErrorCategory.UnhandledRejection) {
        expect(result.data).not.toBe(input);
        expect(result.data.reason).not.toBe(input.reason);
        if (
          result.data.reason.kind === PromiseRejectionReasonKind.NonStandard &&
          typeof value === 'object' &&
          value !== null
        ) {
          expect(result.data.reason.value).not.toBe(value);
        }
      }
    },
  );

  it('does not retain nested caller arrays or objects', () => {
    const value = { tags: ['synthetic'] };
    const input = {
      category: ErrorCategory.UnhandledRejection,
      reason: { kind: PromiseRejectionReasonKind.NonStandard, value },
    };
    const result = parseErrorEventBody(input);
    expect(result.success).toBe(true);
    value.tags.push('changed-after-parse');
    if (
      result.success &&
      result.data.category === ErrorCategory.UnhandledRejection &&
      result.data.reason.kind === PromiseRejectionReasonKind.NonStandard
    ) {
      expect(result.data.reason.value).toEqual({ tags: ['synthetic'] });
    }
  });

  it('rejects missing, empty, non-canonical, and unknown reasons', () => {
    expect(
      issueCodes({ category: ErrorCategory.UnhandledRejection }),
    ).toContain('missing_required_field');
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        reason: { kind: PromiseRejectionReasonKind.String, value: '' },
      }),
    ).toContain('string_empty');
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        reason: { kind: PromiseRejectionReasonKind.NonStandard, value: 'synthetic' },
      }),
    ).toContain('invalid_type');
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        reason: { kind: 'unknown', value: null },
      }),
    ).toContain('invalid_enum');
  });

  it('enforces rejection-string boundary', () => {
    expect(
      parseErrorEventBody({
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.String,
          value: 'r'.repeat(ERROR_EVENT_LIMITS.maxRejectionStringLength),
        },
      }).success,
    ).toBe(true);
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.String,
          value: 'r'.repeat(ERROR_EVENT_LIMITS.maxRejectionStringLength + 1),
        },
      }),
    ).toContain('string_too_long');
  });

  it('rejects cyclic, too-deep, too-large, forbidden, and non-JSON values safely', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const base = {
      category: ErrorCategory.UnhandledRejection,
      reason: { kind: PromiseRejectionReasonKind.NonStandard },
    };
    expect(issueCodes({ ...base, reason: { ...base.reason, value: cyclic } })).toContain(
      'cyclic_reference',
    );
    expect(
      issueCodes({
        ...base,
        reason: { ...base.reason, value: nestedValue(EVENT_SCHEMA_LIMITS.maxObjectDepth) },
      }),
    ).toContain('object_too_deep');
    expect(
      issueCodes({
        ...base,
        reason: {
          ...base.reason,
          value: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength + 1 }, () => null),
        },
      }),
    ).toContain('array_too_large');
    expect(
      issueCodes({
        ...base,
        reason: {
          ...base.reason,
          value: Object.fromEntries(
            Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys + 1 }, (_, index) => [
              `field${String(index)}`,
              null,
            ]),
          ),
        },
      }),
    ).toContain('object_too_large');
    expect(
      issueCodes({
        ...base,
        reason: { ...base.reason, value: { nested: { authorization: 'synthetic' } } },
      }),
    ).toContain('forbidden_field');
    expect(
      issueCodes({
        ...base,
        reason: { ...base.reason, value: { access_token: 'synthetic' } },
      }),
    ).toContain('forbidden_field');
    for (const value of [undefined, 1n, Symbol('synthetic'), () => undefined, Number.NaN]) {
      expect(issueCodes({ ...base, reason: { ...base.reason, value } })).not.toEqual([]);
    }
  });

  it('rejects unknown fields in the body and reason variants', () => {
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        extra: true,
        reason: { kind: PromiseRejectionReasonKind.String, value: 'Synthetic' },
      }),
    ).toContain('unknown_field');
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.String,
          value: 'Synthetic',
          extra: true,
        },
      }),
    ).toContain('unknown_field');
  });
});
```

The depth case intentionally uses the entire error-body path: `body → reason → value` consumes two levels, so nesting `EVENT_SCHEMA_LIMITS.maxObjectDepth` inside `value` is over the global body depth.

- [ ] **Step 2: Confirm the intended red state**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/promise-rejection-error-event.test.ts
```

Expected: exit `1`; every Promise case currently receives `invalid_enum` because Task 2 only dispatches the JavaScript category.

- [ ] **Step 3: Add the bounded Promise parser**

Create `packages/event-schema/src/promise-rejection-error-event.ts`:

```ts
import { parseErrorDescriptor } from './error-descriptor.js';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  PromiseRejectionReasonKind,
  type PromiseRejectionReason,
  type SafeErrorValue,
  type UnhandledPromiseRejectionErrorEventBody,
} from './error-event-types.js';
import {
  addErrorEventIssue,
  isPlainErrorRecord,
  parseBoundedErrorString,
  readRequiredErrorField,
  rejectUnknownErrorFields,
} from './error-event-validation.js';
import type { EventSchemaIssue } from './validation-issues.js';

const PROMISE_BODY_FIELDS: ReadonlySet<string> = new Set(['category', 'reason']);
const ERROR_REASON_FIELDS: ReadonlySet<string> = new Set(['kind', 'error']);
const VALUE_REASON_FIELDS: ReadonlySet<string> = new Set(['kind', 'value']);
const FORBIDDEN_PROMISE_VALUE_FIELDS: ReadonlySet<string> = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
]);

function copySafeErrorValue(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): SafeErrorValue | undefined {
  if (
    input === null ||
    typeof input === 'boolean' ||
    typeof input === 'string' ||
    (typeof input === 'number' && Number.isFinite(input))
  ) {
    return input;
  }
  if (Array.isArray(input)) {
    const output: SafeErrorValue[] = [];
    for (const [index, item] of input.entries()) {
      const copied = copySafeErrorValue(item, issues, [...path, index]);
      if (copied === undefined) return undefined;
      output.push(copied);
    }
    return output;
  }
  if (!isPlainErrorRecord(input)) return undefined;
  if (Object.getOwnPropertySymbols(input).length > 0) return undefined;
  const output: Record<string, SafeErrorValue> = {};
  for (const key of Object.keys(input).sort()) {
    const normalizedKey = key.toLowerCase().replaceAll('_', '').replaceAll('-', '');
    if (FORBIDDEN_PROMISE_VALUE_FIELDS.has(normalizedKey)) {
      addErrorEventIssue(
        issues,
        'forbidden_field',
        [...path, key],
        'Promise rejection contains a forbidden field',
      );
      return undefined;
    }
    const copied = copySafeErrorValue(input[key], issues, [...path, key]);
    if (copied === undefined) return undefined;
    output[key] = copied;
  }
  return output;
}

function parseReason(
  input: unknown,
  issues: EventSchemaIssue[],
): PromiseRejectionReason | undefined {
  const path = ['body', 'reason'] as const;
  if (!isPlainErrorRecord(input)) {
    addErrorEventIssue(issues, 'invalid_type', path, 'Promise rejection reason must be an object');
    return undefined;
  }
  const kindField = readRequiredErrorField(input, 'kind', issues, path);
  if (!kindField.found) return undefined;
  if (typeof kindField.value !== 'string') {
    addErrorEventIssue(issues, 'invalid_type', [...path, 'kind'], 'Reason kind must be a string');
    return undefined;
  }
  if (kindField.value === PromiseRejectionReasonKind.Error) {
    rejectUnknownErrorFields(input, ERROR_REASON_FIELDS, issues, path);
    const errorField = readRequiredErrorField(input, 'error', issues, path);
    const error = errorField.found
      ? parseErrorDescriptor(errorField.value, issues, [...path, 'error'])
      : undefined;
    return error === undefined ? undefined : { kind: PromiseRejectionReasonKind.Error, error };
  }
  if (kindField.value === PromiseRejectionReasonKind.String) {
    rejectUnknownErrorFields(input, VALUE_REASON_FIELDS, issues, path);
    const valueField = readRequiredErrorField(input, 'value', issues, path);
    const value = valueField.found
      ? parseBoundedErrorString(
          valueField.value,
          ERROR_EVENT_LIMITS.maxRejectionStringLength,
          issues,
          [...path, 'value'],
        )
      : undefined;
    return value === undefined ? undefined : { kind: PromiseRejectionReasonKind.String, value };
  }
  if (kindField.value === PromiseRejectionReasonKind.NonStandard) {
    rejectUnknownErrorFields(input, VALUE_REASON_FIELDS, issues, path);
    const valueField = readRequiredErrorField(input, 'value', issues, path);
    if (!valueField.found) return undefined;
    if (typeof valueField.value === 'string') {
      addErrorEventIssue(
        issues,
        'invalid_type',
        [...path, 'value'],
        'Direct string rejection must use the string reason kind',
      );
      return undefined;
    }
    const issueCount = issues.length;
    const value = copySafeErrorValue(valueField.value, issues, [...path, 'value']);
    if (value === undefined) {
      if (issues.length === issueCount) {
        addErrorEventIssue(
          issues,
          'invalid_type',
          [...path, 'value'],
          'Non-standard rejection must be a safe JSON value',
        );
      }
      return undefined;
    }
    return { kind: PromiseRejectionReasonKind.NonStandard, value };
  }
  addErrorEventIssue(issues, 'invalid_enum', [...path, 'kind'], 'Reason kind is not supported');
  return undefined;
}

export function parsePromiseRejectionErrorEventBody(
  input: Record<string, unknown>,
  issues: EventSchemaIssue[],
): UnhandledPromiseRejectionErrorEventBody | undefined {
  rejectUnknownErrorFields(input, PROMISE_BODY_FIELDS, issues, ['body']);
  const reasonField = readRequiredErrorField(input, 'reason', issues, ['body']);
  const reason = reasonField.found ? parseReason(reasonField.value, issues) : undefined;
  return reason === undefined
    ? undefined
    : { category: ErrorCategory.UnhandledRejection, reason };
}
```

- [ ] **Step 4: Extend only the category dispatcher**

In `packages/event-schema/src/error-event-body.ts`, import:

```ts
import { parsePromiseRejectionErrorEventBody } from './promise-rejection-error-event.js';
```

Replace the JavaScript-only category branch with:

```ts
  let data: ErrorEventBody | undefined;
  if (categoryField.value === ErrorCategory.JavaScript) {
    data = parseJavaScriptErrorEventBody(input, issues);
  } else if (categoryField.value === ErrorCategory.UnhandledRejection) {
    data = parsePromiseRejectionErrorEventBody(input, issues);
  } else {
    addErrorEventIssue(
      issues,
      'invalid_enum',
      ['body', 'category'],
      'Error category is not supported',
    );
  }
  return issues.length > 0 || data === undefined
    ? { success: false, issues }
    : { success: true, data };
```

Add `type ErrorEventBody` to the existing import from `error-event-types.ts`.

- [ ] **Step 5: Confirm green and run related regression**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/promise-rejection-error-event.test.ts
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema exec vitest run test/javascript-error-event.test.ts test/value-boundaries.test.ts
```

Expected: all commands exit `0`; Promise cases pass without `JSON.stringify`; JavaScript and generic boundary behavior remain unchanged.

- [ ] **Step 6: Suggested commit boundary**

```bash
git add packages/event-schema/src/promise-rejection-error-event.ts packages/event-schema/src/error-event-body.ts packages/event-schema/test/promise-rejection-error-event.test.ts
git commit -m "feat(protocol): parse promise rejection errors"
```

Do not execute these Git commands without separate authorization.

---

### Task 4: Resource-load error parser and URL privacy boundary

**Files:**
- Create: `packages/event-schema/test/resource-error-event.test.ts`
- Create: `packages/event-schema/src/resource-error-event.ts`
- Modify: `packages/event-schema/src/error-event-body.ts`

**Consumes:**
- Task 1 resource types/limits, Task 2 exact-field helpers, existing whole-body limits, and the approved URL rule.

**Produces:**
- Four exact resource types, lowercase absolute HTTP(S) validation, total query/fragment removal, invalid-scheme/authority/credentials handling, fresh resource output, and the third body category.

- [ ] **Step 1: Write failing resource public behavior tests**

Create `packages/event-schema/test/resource-error-event.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  parseErrorEventBody,
  type EventSchemaIssueCode,
} from '@aurora/event-schema';

function issueCodes(input: unknown): readonly EventSchemaIssueCode[] {
  const result = parseErrorEventBody(input);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

function resourceBody(type: unknown, url: unknown): unknown {
  return { category: ErrorCategory.Resource, resource: { type, url } };
}

describe('resource-load error body', () => {
  it.each(Object.values(ErrorResourceType))('accepts resource type %s', (type) => {
    expect(parseErrorEventBody(resourceBody(type, 'https://static.example.test/app.js')).success)
      .toBe(true);
  });

  it('removes the complete query and fragment without modifying input', () => {
    const input = {
      category: ErrorCategory.Resource,
      resource: {
        type: ErrorResourceType.Script,
        url: 'https://static.example.test/app.js?token=synthetic#fragment',
      },
    };
    const result = parseErrorEventBody(input);
    expect(result).toEqual({
      success: true,
      data: {
        category: ErrorCategory.Resource,
        resource: {
          type: ErrorResourceType.Script,
          url: 'https://static.example.test/app.js',
        },
      },
    });
    expect(input.resource.url).toContain('?token=synthetic');
    if (result.success) {
      expect(result.data).not.toBe(input);
      expect(result.data.resource).not.toBe(input.resource);
    }
  });

  it('accepts an exact maximum URL and rejects one unit over', () => {
    const prefix = 'https://static.example.test/';
    const maximum = prefix + 'a'.repeat(ERROR_EVENT_LIMITS.maxResourceUrlLength - prefix.length);
    expect(parseErrorEventBody(resourceBody(ErrorResourceType.Image, maximum)).success).toBe(true);
    expect(
      issueCodes(resourceBody(ErrorResourceType.Image, `${maximum}a`)),
    ).toContain('string_too_long');
  });

  it.each([
    'data:text/plain,synthetic',
    'blob:https://static.example.test/synthetic',
    'file:///synthetic/app.js',
    '/relative/app.js',
    'HTTPS://static.example.test/app.js',
    'https:///app.js',
    'https://user:pass@static.example.test/app.js',
    'https://static.example.test:99999/app.js',
    'https://static.example.test\\app.js',
    'https://static.example.test/app file.js',
  ])('rejects unsafe URL %s', (url) => {
    expect(issueCodes(resourceBody(ErrorResourceType.Script, url))).toContain('invalid_url');
  });

  it('rejects missing URL, wrong URL type, unknown resource type, and unknown fields', () => {
    expect(
      issueCodes({
        category: ErrorCategory.Resource,
        resource: { type: ErrorResourceType.Script },
      }),
    ).toContain('missing_required_field');
    expect(issueCodes(resourceBody(ErrorResourceType.Script, null))).toContain('invalid_type');
    expect(issueCodes(resourceBody('video', 'https://static.example.test/app.mp4'))).toContain(
      'invalid_enum',
    );
    expect(
      issueCodes({
        category: ErrorCategory.Resource,
        extra: true,
        resource: {
          type: ErrorResourceType.Font,
          url: 'https://static.example.test/font.woff2',
        },
      }),
    ).toContain('unknown_field');
    expect(
      issueCodes({
        category: ErrorCategory.Resource,
        resource: {
          type: ErrorResourceType.Font,
          url: 'https://static.example.test/font.woff2',
          element: 'link',
        },
      }),
    ).toContain('unknown_field');
  });
});
```

- [ ] **Step 2: Confirm the intended red state**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/resource-error-event.test.ts
```

Expected: exit `1`; resource bodies are rejected as `invalid_enum` because the dispatcher has no resource parser.

- [ ] **Step 3: Add the minimum resource and URL parser**

Create `packages/event-schema/src/resource-error-event.ts`:

```ts
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  type ErrorResourceType as ErrorResourceTypeValue,
  type ResourceLoadErrorEventBody,
} from './error-event-types.js';
import {
  addErrorEventIssue,
  isPlainErrorRecord,
  parseBoundedErrorString,
  readRequiredErrorField,
  rejectUnknownErrorFields,
} from './error-event-validation.js';
import type { EventSchemaIssue } from './validation-issues.js';

const RESOURCE_BODY_FIELDS: ReadonlySet<string> = new Set(['category', 'resource']);
const RESOURCE_FIELDS: ReadonlySet<string> = new Set(['type', 'url']);
const resourceTypes: ReadonlySet<unknown> = new Set(Object.values(ErrorResourceType));
const unsafeUrlCharacter = /[\\\u0000-\u0020\u007f]/u;
const safeAuthority =
  /^(?:\[[0-9A-Fa-f:.]+\]|localhost|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?$/u;

function firstUrlSuffixIndex(input: string): number {
  const queryIndex = input.indexOf('?');
  const fragmentIndex = input.indexOf('#');
  if (queryIndex < 0) return fragmentIndex;
  if (fragmentIndex < 0) return queryIndex;
  return Math.min(queryIndex, fragmentIndex);
}

function sanitizeResourceUrl(
  input: unknown,
  issues: EventSchemaIssue[],
): string | undefined {
  const path = ['body', 'resource', 'url'] as const;
  const bounded = parseBoundedErrorString(
    input,
    ERROR_EVENT_LIMITS.maxResourceUrlLength,
    issues,
    path,
  );
  if (bounded === undefined) return undefined;
  const suffixIndex = firstUrlSuffixIndex(bounded);
  const sanitized = suffixIndex < 0 ? bounded : bounded.slice(0, suffixIndex);
  const schemeLength = sanitized.startsWith('https://')
    ? 'https://'.length
    : sanitized.startsWith('http://')
      ? 'http://'.length
      : 0;
  const pathIndex = sanitized.indexOf('/', schemeLength);
  const authority = sanitized.slice(
    schemeLength,
    pathIndex < 0 ? sanitized.length : pathIndex,
  );
  const authorityMatch = safeAuthority.exec(authority);
  const portText = authorityMatch?.[1];
  if (
    schemeLength === 0 ||
    authority.length === 0 ||
    authority.includes('@') ||
    unsafeUrlCharacter.test(sanitized) ||
    authorityMatch === null ||
    (portText !== undefined && Number(portText) > 65_535)
  ) {
    addErrorEventIssue(issues, 'invalid_url', path, 'Resource URL is not a safe HTTP URL');
    return undefined;
  }
  return sanitized;
}

function parseResourceType(
  input: unknown,
  issues: EventSchemaIssue[],
): ErrorResourceTypeValue | undefined {
  const path = ['body', 'resource', 'type'] as const;
  if (typeof input !== 'string') {
    addErrorEventIssue(issues, 'invalid_type', path, 'Resource type must be a string');
    return undefined;
  }
  if (!resourceTypes.has(input)) {
    addErrorEventIssue(issues, 'invalid_enum', path, 'Resource type is not supported');
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
  rejectUnknownErrorFields(input, RESOURCE_BODY_FIELDS, issues, ['body']);
  const resourceField = readRequiredErrorField(input, 'resource', issues, ['body']);
  if (!resourceField.found) return undefined;
  const path = ['body', 'resource'] as const;
  if (!isPlainErrorRecord(resourceField.value)) {
    addErrorEventIssue(issues, 'invalid_type', path, 'Resource error must be a plain object');
    return undefined;
  }
  rejectUnknownErrorFields(resourceField.value, RESOURCE_FIELDS, issues, path);
  const typeField = readRequiredErrorField(resourceField.value, 'type', issues, path);
  const urlField = readRequiredErrorField(resourceField.value, 'url', issues, path);
  const type = typeField.found ? parseResourceType(typeField.value, issues) : undefined;
  const url = urlField.found ? sanitizeResourceUrl(urlField.value, issues) : undefined;
  if (type === undefined || url === undefined) return undefined;
  return { category: ErrorCategory.Resource, resource: { type, url } };
}
```

The local alias `ErrorResourceTypeValue` is private and does not change the package-root public name.

- [ ] **Step 4: Complete the three-category dispatcher**

In `packages/event-schema/src/error-event-body.ts`, import:

```ts
import { parseResourceLoadErrorEventBody } from './resource-error-event.js';
```

Add the resource branch immediately before the final unsupported-category branch:

```ts
  } else if (categoryField.value === ErrorCategory.Resource) {
    data = parseResourceLoadErrorEventBody(input, issues);
```

- [ ] **Step 5: Confirm green and related regression**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/resource-error-event.test.ts
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema exec vitest run test/javascript-error-event.test.ts test/promise-rejection-error-event.test.ts
```

Expected: all commands exit `0`; all four resource types pass, every unsafe URL fails with `invalid_url`, query/fragment removal is exact, input objects remain unchanged, and the first two categories stay green.

- [ ] **Step 6: Suggested commit boundary**

```bash
git add packages/event-schema/src/resource-error-event.ts packages/event-schema/src/error-event-body.ts packages/event-schema/test/resource-error-event.test.ts
git commit -m "feat(protocol): parse resource load errors"
```

Do not execute these Git commands without separate authorization.

---

### Task 5: Error envelope composition, event-type match, and immutable output

**Files:**
- Create: `packages/event-schema/test/error-event-envelope.test.ts`
- Create: `packages/event-schema/src/error-event-envelope.ts`
- Modify: `packages/event-schema/src/index.ts`

**Consumes:**
- Existing `parseEventEnvelope`, `EventType`, Task 4 `parseErrorEventBody`, additive mismatch issue, and current version/timestamp rules.

**Produces:**
- Public `parseErrorEventEnvelope(input: unknown)`, exact `EventType.Error` match, generic issue preservation, fully rebuilt success envelopes, fixed getter-failure issue, and no Core changes.

- [ ] **Step 1: Write failing envelope-level tests**

Create `packages/event-schema/test/error-event-envelope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROTOCOL_VERSION,
  ErrorCategory,
  ErrorResourceType,
  EventType,
  parseErrorEventEnvelope,
  type EventSchemaIssueCode,
} from '@aurora/event-schema';

const validEnvelope = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId: 'evt-error-envelope-synthetic',
  eventType: EventType.Error,
  occurredAt: 1_800_000_002_000,
  body: {
    category: ErrorCategory.JavaScript,
    error: { message: 'Synthetic runtime failure' },
  },
} as const;

function issueCodes(input: unknown): readonly EventSchemaIssueCode[] {
  const result = parseErrorEventEnvelope(input);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

describe('parseErrorEventEnvelope', () => {
  it('composes the current envelope and exact body into fresh output', () => {
    const result = parseErrorEventEnvelope(validEnvelope);
    expect(result).toEqual({ success: true, data: validEnvelope });
    expect(parseErrorEventEnvelope(validEnvelope)).toEqual(result);
    if (result.success && result.data.body.category === ErrorCategory.JavaScript) {
      expect(result.data).not.toBe(validEnvelope);
      expect(result.data.body).not.toBe(validEnvelope.body);
      expect(result.data.body.error).not.toBe(validEnvelope.body.error);
    }
  });

  it.each([EventType.Request, EventType.Performance, EventType.Resource])(
    'rejects error body combined with %s',
    (eventType) => {
      expect(issueCodes({ ...validEnvelope, eventType })).toContain('event_type_mismatch');
    },
  );

  it('preserves existing version, timestamp, and envelope-field issues', () => {
    for (const protocolVersion of [0, 2]) {
      expect(issueCodes({ ...validEnvelope, protocolVersion })).toContain(
        'unsupported_protocol_version',
      );
    }
    expect(issueCodes({ ...validEnvelope, occurredAt: 0 })).toContain('invalid_timestamp');
    expect(issueCodes({ ...validEnvelope, extra: true })).toContain('unknown_field');
  });

  it('rejects an invalid exact body after generic envelope success', () => {
    expect(
      issueCodes({
        ...validEnvelope,
        body: { category: ErrorCategory.JavaScript, error: { message: '' } },
      }),
    ).toContain('string_empty');
  });

  it('returns sanitized resource URL and leaves the original unchanged', () => {
    const input = {
      ...validEnvelope,
      eventId: 'evt-resource-envelope-synthetic',
      body: {
        category: ErrorCategory.Resource,
        resource: {
          type: ErrorResourceType.Stylesheet,
          url: 'https://static.example.test/app.css?cache=synthetic#fragment',
        },
      },
    };
    const result = parseErrorEventEnvelope(input);
    expect(result.success).toBe(true);
    if (result.success && result.data.body.category === ErrorCategory.Resource) {
      expect(result.data.body.resource.url).toBe('https://static.example.test/app.css');
      expect(input.body.resource.url).toContain('?cache=synthetic');
    }
  });

  it('returns a fixed issue when generic envelope property access throws', () => {
    const input = Object.defineProperty({}, 'protocolVersion', {
      enumerable: true,
      get(): never {
        throw new Error('synthetic envelope getter');
      },
    });
    const result = parseErrorEventEnvelope(input);
    expect(result).toEqual({
      success: false,
      issues: [
        {
          code: 'invalid_type',
          path: [],
          message: 'Error event envelope could not be read safely',
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Confirm the intended red state**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/error-event-envelope.test.ts
```

Expected: exit `1`; the root does not export `parseErrorEventEnvelope`.

- [ ] **Step 3: Compose the existing envelope parser**

Create `packages/event-schema/src/error-event-envelope.ts`:

```ts
import { parseErrorEventBody } from './error-event-body.js';
import type { ErrorEventEnvelopeParseResult } from './error-event-types.js';
import { parseEventEnvelope } from './event-envelope.js';
import { EventType } from './event-types.js';

function unsafeEnvelopeFailure(): ErrorEventEnvelopeParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: [],
        message: 'Error event envelope could not be read safely',
      },
    ],
  };
}

function parseEnvelope(input: unknown): ErrorEventEnvelopeParseResult {
  const envelopeResult = parseEventEnvelope(input);
  if (!envelopeResult.success) return envelopeResult;
  if (envelopeResult.data.eventType !== EventType.Error) {
    return {
      success: false,
      issues: [
        {
          code: 'event_type_mismatch',
          path: ['eventType'],
          message: 'Error event body requires the error event type',
        },
      ],
    };
  }
  const bodyResult = parseErrorEventBody(envelopeResult.data.body);
  if (!bodyResult.success) return bodyResult;
  return {
    success: true,
    data: {
      protocolVersion: envelopeResult.data.protocolVersion,
      eventId: envelopeResult.data.eventId,
      eventType: EventType.Error,
      occurredAt: envelopeResult.data.occurredAt,
      body: bodyResult.data,
    },
  };
}

export function parseErrorEventEnvelope(input: unknown): ErrorEventEnvelopeParseResult {
  try {
    return parseEnvelope(input);
  } catch {
    return unsafeEnvelopeFailure();
  }
}
```

Append to `packages/event-schema/src/index.ts`:

```ts
export { parseErrorEventEnvelope } from './error-event-envelope.js';
```

- [ ] **Step 4: Confirm green and run all error parser regression**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/error-event-envelope.test.ts
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema exec vitest run test/error-event-types.test.ts test/javascript-error-event.test.ts test/promise-rejection-error-event.test.ts test/resource-error-event.test.ts
pnpm --filter @aurora/event-schema exec vitest run test/event-envelope.test.ts test/value-boundaries.test.ts
```

Expected: every command exits `0`; error-envelope tests pass for exact composition, three mismatches, generic issues, body issue, URL output, deep copies, and getter failure; generic parser behavior remains unchanged.

- [ ] **Step 5: Suggested commit boundary**

```bash
git add packages/event-schema/src/error-event-envelope.ts packages/event-schema/src/index.ts packages/event-schema/test/error-event-envelope.test.ts
git commit -m "feat(protocol): compose error event envelopes"
```

Do not execute these Git commands without separate authorization.

---

### Task 6: Shared legal, illegal, boundary samples and three consumers

**Files:**
- Create: `packages/event-schema/src/contract-testkit/valid-error-event-samples.ts`
- Create: `packages/event-schema/src/contract-testkit/invalid-error-event-samples.ts`
- Create: `packages/event-schema/src/contract-testkit/boundary-error-event-samples.ts`
- Modify: `packages/event-schema/src/contract-testkit/index.ts`
- Create: `packages/event-schema/test/consumers/sdk-error-event.contract.test.ts`
- Create: `packages/event-schema/test/consumers/ingestion-error-event.contract.test.ts`
- Create: `packages/event-schema/test/consumers/processing-error-event.contract.test.ts`

**Consumes:**
- Task 5 public error parser/types/constants, existing `contract-testkit` entry, current version and shared issue codes.

**Produces:**
- Six legal cases spanning every variant, an explicit invalid matrix, exact boundary cases, sanitized expected output, and SDK/ingestion/processing-shaped black-box consumers using one source.

- [ ] **Step 1: Write failing consumers against the public testkit**

Create `packages/event-schema/test/consumers/sdk-error-event.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseErrorEventEnvelope } from '@aurora/event-schema';
import { validErrorEventSamples } from '@aurora/event-schema/contract-testkit';

describe('SDK error-event producer contract', () => {
  it('produces every shared legal error envelope', () => {
    expect(validErrorEventSamples).toHaveLength(6);
    for (const sample of validErrorEventSamples) {
      expect(parseErrorEventEnvelope(sample.input), sample.name).toEqual({
        success: true,
        data: sample.expected,
      });
    }
  });
});
```

Create `packages/event-schema/test/consumers/ingestion-error-event.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseErrorEventEnvelope } from '@aurora/event-schema';
import { invalidErrorEventSamples } from '@aurora/event-schema/contract-testkit';

describe('ingestion error-event consumer contract', () => {
  it('rejects every shared illegal error envelope with its stable code', () => {
    for (const sample of invalidErrorEventSamples) {
      const result = parseErrorEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(false);
      if (!result.success) {
        expect(result.issues.map(({ code }) => code), sample.name).toContain(
          sample.expectedIssueCode,
        );
      }
    }
  });
});
```

Create `packages/event-schema/test/consumers/processing-error-event.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseErrorEventEnvelope } from '@aurora/event-schema';
import { boundaryErrorEventSamples } from '@aurora/event-schema/contract-testkit';

describe('processing error-event consumer contract', () => {
  it('agrees with every shared boundary and sanitized output', () => {
    for (const sample of boundaryErrorEventSamples) {
      const result = parseErrorEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(sample.isValid);
      if (sample.isValid) {
        expect(result, sample.name).toEqual({ success: true, data: sample.expected });
      } else if (!result.success) {
        expect(result.issues.map(({ code }) => code), sample.name).toContain(
          sample.expectedIssueCode,
        );
      }
    }
  });
});
```

- [ ] **Step 2: Confirm the intended red state**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/consumers/sdk-error-event.contract.test.ts test/consumers/ingestion-error-event.contract.test.ts test/consumers/processing-error-event.contract.test.ts
```

Expected: exit `1`; the existing `contract-testkit` entry has no error-event sample exports.

- [ ] **Step 3: Add six legal inputs and expected normalized envelopes**

Create `packages/event-schema/src/contract-testkit/valid-error-event-samples.ts`:

```ts
import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import {
  ErrorCategory,
  ErrorResourceType,
  PromiseRejectionReasonKind,
  type ErrorEventBody,
  type ErrorEventEnvelope,
} from '../error-event-types.js';
import { EventType } from '../event-types.js';

export interface ValidErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: ErrorEventEnvelope;
}

function envelope(
  eventId: string,
  body: ErrorEventBody,
  occurredAt: number,
): ErrorEventEnvelope {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Error,
    occurredAt,
    body,
  };
}

const javascriptMinimum = {
  category: ErrorCategory.JavaScript,
  error: { message: 'Synthetic runtime failure' },
} as const;
const javascriptFull = {
  category: ErrorCategory.JavaScript,
  error: {
    name: 'TypeError',
    message: 'Synthetic runtime failure',
    stack: 'TypeError: Synthetic runtime failure\n    at app.js:1:1',
  },
} as const;
const promiseError = {
  category: ErrorCategory.UnhandledRejection,
  reason: {
    kind: PromiseRejectionReasonKind.Error,
    error: { name: 'Error', message: 'Synthetic Promise rejection' },
  },
} as const;
const promiseString = {
  category: ErrorCategory.UnhandledRejection,
  reason: {
    kind: PromiseRejectionReasonKind.String,
    value: 'Synthetic Promise rejection',
  },
} as const;
const promiseNonStandard = {
  category: ErrorCategory.UnhandledRejection,
  reason: {
    kind: PromiseRejectionReasonKind.NonStandard,
    value: { code: 7, tags: ['synthetic'] },
  },
} as const;
const resourceInput = {
  category: ErrorCategory.Resource,
  resource: {
    type: ErrorResourceType.Script,
    url: 'https://static.example.test/app.js?cache=synthetic#fragment',
  },
} as const;
const resourceExpected = {
  category: ErrorCategory.Resource,
  resource: {
    type: ErrorResourceType.Script,
    url: 'https://static.example.test/app.js',
  },
} as const;

export const validErrorEventSamples: readonly ValidErrorEventSample[] = [
  {
    name: 'minimum JavaScript runtime error',
    input: envelope('evt-error-valid-js-minimum', javascriptMinimum, 1_800_000_003_001),
    expected: envelope('evt-error-valid-js-minimum', javascriptMinimum, 1_800_000_003_001),
  },
  {
    name: 'full JavaScript runtime error',
    input: envelope('evt-error-valid-js-full', javascriptFull, 1_800_000_003_002),
    expected: envelope('evt-error-valid-js-full', javascriptFull, 1_800_000_003_002),
  },
  {
    name: 'Error-style Promise rejection',
    input: envelope('evt-error-valid-promise-error', promiseError, 1_800_000_003_003),
    expected: envelope('evt-error-valid-promise-error', promiseError, 1_800_000_003_003),
  },
  {
    name: 'string Promise rejection',
    input: envelope('evt-error-valid-promise-string', promiseString, 1_800_000_003_004),
    expected: envelope('evt-error-valid-promise-string', promiseString, 1_800_000_003_004),
  },
  {
    name: 'non-standard Promise rejection',
    input: envelope(
      'evt-error-valid-promise-non-standard',
      promiseNonStandard,
      1_800_000_003_005,
    ),
    expected: envelope(
      'evt-error-valid-promise-non-standard',
      promiseNonStandard,
      1_800_000_003_005,
    ),
  },
  {
    name: 'resource URL with query and fragment',
    input: envelope('evt-error-valid-resource', resourceInput, 1_800_000_003_006),
    expected: envelope('evt-error-valid-resource', resourceExpected, 1_800_000_003_006),
  },
];
```

- [ ] **Step 4: Add explicit illegal cases**

Create `packages/event-schema/src/contract-testkit/invalid-error-event-samples.ts`:

```ts
import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import {
  ErrorCategory,
  ErrorResourceType,
  PromiseRejectionReasonKind,
} from '../error-event-types.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface InvalidErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

function envelope(body: unknown): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-error-invalid-synthetic',
    eventType: EventType.Error,
    occurredAt: 1_800_000_003_100,
    body,
  };
}

const cyclic: { self?: unknown } = {};
cyclic.self = cyclic;

export const invalidErrorEventSamples: readonly InvalidErrorEventSample[] = [
  {
    name: 'missing JavaScript message',
    input: envelope({ category: ErrorCategory.JavaScript, error: {} }),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'empty JavaScript message',
    input: envelope({ category: ErrorCategory.JavaScript, error: { message: '' } }),
    expectedIssueCode: 'string_empty',
  },
  {
    name: 'unknown body field',
    input: envelope({
      category: ErrorCategory.JavaScript,
      error: { message: 'Synthetic' },
      extra: true,
    }),
    expectedIssueCode: 'unknown_field',
  },
  {
    name: 'unknown error category',
    input: envelope({ category: 'framework', error: { message: 'Synthetic' } }),
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'missing Promise reason',
    input: envelope({ category: ErrorCategory.UnhandledRejection }),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'cyclic Promise reason',
    input: envelope({
      category: ErrorCategory.UnhandledRejection,
      reason: { kind: PromiseRejectionReasonKind.NonStandard, value: cyclic },
    }),
    expectedIssueCode: 'cyclic_reference',
  },
  {
    name: 'Promise reason forbidden field',
    input: envelope({
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: { authorization: 'synthetic' },
      },
    }),
    expectedIssueCode: 'forbidden_field',
  },
  {
    name: 'unknown resource type',
    input: envelope({
      category: ErrorCategory.Resource,
      resource: { type: 'video', url: 'https://static.example.test/app.mp4' },
    }),
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'resource URL has unsupported scheme',
    input: envelope({
      category: ErrorCategory.Resource,
      resource: { type: ErrorResourceType.Image, url: 'data:image/png,synthetic' },
    }),
    expectedIssueCode: 'invalid_url',
  },
  {
    name: 'error body uses request event type',
    input: {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      eventId: 'evt-error-invalid-mismatch',
      eventType: EventType.Request,
      occurredAt: 1_800_000_003_101,
      body: { category: ErrorCategory.JavaScript, error: { message: 'Synthetic' } },
    },
    expectedIssueCode: 'event_type_mismatch',
  },
  {
    name: 'unsupported protocol version',
    input: {
      protocolVersion: 2,
      eventId: 'evt-error-invalid-version',
      eventType: EventType.Error,
      occurredAt: 1_800_000_003_102,
      body: { category: ErrorCategory.JavaScript, error: { message: 'Synthetic' } },
    },
    expectedIssueCode: 'unsupported_protocol_version',
  },
];
```

- [ ] **Step 5: Add exact legal and illegal boundaries**

Create `packages/event-schema/src/contract-testkit/boundary-error-event-samples.ts`:

```ts
import {
  CURRENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_LIMITS,
} from '../constants.js';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  PromiseRejectionReasonKind,
  type ErrorEventBody,
  type ErrorEventEnvelope,
  type SafeErrorObject,
  type SafeErrorValue,
} from '../error-event-types.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface BoundaryErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: ErrorEventEnvelope;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

function envelope(eventId: string, body: unknown): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Error,
    occurredAt: 1_800_000_003_200,
    body,
  };
}

function expectedEnvelope(eventId: string, body: ErrorEventBody): ErrorEventEnvelope {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Error,
    occurredAt: 1_800_000_003_200,
    body,
  };
}

function nestedValue(depth: number): SafeErrorValue {
  let value: SafeErrorValue = null;
  for (let index = 0; index < depth; index += 1) value = { nested: value };
  return value;
}

const urlPrefix = 'https://static.example.test/';
const maximumUrl =
  urlPrefix + 'a'.repeat(ERROR_EVENT_LIMITS.maxResourceUrlLength - urlPrefix.length);
const maximumReasonNesting = EVENT_SCHEMA_LIMITS.maxObjectDepth - 2;
const maximumObjectValue: SafeErrorObject = Object.fromEntries(
  Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys }, (_, index) => [
    `field${String(index)}`,
    null,
  ]),
);

const maximumJavascriptBody = {
  category: ErrorCategory.JavaScript,
  error: {
    name: 'n'.repeat(ERROR_EVENT_LIMITS.maxErrorNameLength),
    message: 'm'.repeat(ERROR_EVENT_LIMITS.maxErrorMessageLength),
    stack: 's'.repeat(ERROR_EVENT_LIMITS.maxStackLength),
  },
} as const;
const maximumResourceBody = {
  category: ErrorCategory.Resource,
  resource: { type: ErrorResourceType.Font, url: maximumUrl },
} as const;

export const boundaryErrorEventSamples: readonly BoundaryErrorEventSample[] = [
  {
    name: 'all JavaScript strings at exact maximum',
    input: envelope('evt-error-boundary-js-max', maximumJavascriptBody),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-js-max', maximumJavascriptBody),
  },
  {
    name: 'JavaScript message one over maximum',
    input: envelope('evt-error-boundary-message-over', {
      category: ErrorCategory.JavaScript,
      error: { message: 'm'.repeat(ERROR_EVENT_LIMITS.maxErrorMessageLength + 1) },
    }),
    isValid: false,
    expectedIssueCode: 'string_too_long',
  },
  {
    name: 'Promise string at exact maximum',
    input: envelope('evt-error-boundary-promise-string-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.String,
        value: 'r'.repeat(ERROR_EVENT_LIMITS.maxRejectionStringLength),
      },
    }),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-promise-string-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.String,
        value: 'r'.repeat(ERROR_EVENT_LIMITS.maxRejectionStringLength),
      },
    }),
  },
  {
    name: 'Promise array at exact maximum',
    input: envelope('evt-error-boundary-array-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength }, () => null),
      },
    }),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-array-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength }, () => null),
      },
    }),
  },
  {
    name: 'Promise array one over maximum',
    input: envelope('evt-error-boundary-array-over', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength + 1 }, () => null),
      },
    }),
    isValid: false,
    expectedIssueCode: 'array_too_large',
  },
  {
    name: 'Promise object at exact maximum key count',
    input: envelope('evt-error-boundary-object-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: maximumObjectValue,
      },
    }),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-object-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: maximumObjectValue,
      },
    }),
  },
  {
    name: 'Promise object one over maximum key count',
    input: envelope('evt-error-boundary-object-over', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: Object.fromEntries(
          Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys + 1 }, (_, index) => [
            `field${String(index)}`,
            null,
          ]),
        ),
      },
    }),
    isValid: false,
    expectedIssueCode: 'object_too_large',
  },
  {
    name: 'Promise value at exact remaining body depth',
    input: envelope('evt-error-boundary-depth-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: nestedValue(maximumReasonNesting),
      },
    }),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-depth-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: nestedValue(maximumReasonNesting),
      },
    }),
  },
  {
    name: 'Promise value one over remaining body depth',
    input: envelope('evt-error-boundary-depth-over', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: nestedValue(maximumReasonNesting + 1),
      },
    }),
    isValid: false,
    expectedIssueCode: 'object_too_deep',
  },
  {
    name: 'resource URL at exact maximum',
    input: envelope('evt-error-boundary-url-max', maximumResourceBody),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-url-max', maximumResourceBody),
  },
  {
    name: 'resource URL one over maximum',
    input: envelope('evt-error-boundary-url-over', {
      category: ErrorCategory.Resource,
      resource: { type: ErrorResourceType.Font, url: `${maximumUrl}a` },
    }),
    isValid: false,
    expectedIssueCode: 'string_too_long',
  },
];
```

- [ ] **Step 6: Export only through the existing testkit entry**

Append to `packages/event-schema/src/contract-testkit/index.ts`:

```ts
export {
  boundaryErrorEventSamples,
  type BoundaryErrorEventSample,
} from './boundary-error-event-samples.js';
export {
  invalidErrorEventSamples,
  type InvalidErrorEventSample,
} from './invalid-error-event-samples.js';
export {
  validErrorEventSamples,
  type ValidErrorEventSample,
} from './valid-error-event-samples.js';
```

- [ ] **Step 7: Confirm green and run all consumer contracts**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/consumers/sdk-error-event.contract.test.ts test/consumers/ingestion-error-event.contract.test.ts test/consumers/processing-error-event.contract.test.ts
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema exec vitest run test/consumers
```

Expected: all commands exit `0`; six legal samples equal their parsed expected output, all illegal samples contain their stable issue, every boundary agrees, and all pre-existing envelope consumers remain green.

- [ ] **Step 8: Suggested commit boundary**

```bash
git add packages/event-schema/src/contract-testkit packages/event-schema/test/consumers
git commit -m "test(protocol): share error event contracts"
```

Do not execute these Git commands without separate authorization.

---

### Task 7: Package entry, protocol environment policy, and private-boundary proof

**Files:**
- Create: `packages/event-schema/test/architecture-boundary.test.ts`
- Modify: `packages/event-schema/test/package-entry.test.ts`
- Modify: `tooling/workspace-policy/test/environment.test.ts`
- Modify: `tooling/workspace-policy/src/environment.ts`

**Consumes:**
- Existing `protocol` zero-local-dependency matrix, two declared event-schema exports, private-path/cycle checks, ES-only build config, and Task 6 runtime/testkit exports.

**Produces:**
- Executable rejection of DOM and Node-exclusive runtime use in protocol source, built-entry proof for every runtime constant/parser and all three sample collections, private implementation-path rejection, and unchanged zero-dependency/cycle evidence.

- [ ] **Step 1: Write failing protocol environment policy tests**

Add this helper near the existing Core/Browser helpers in `tooling/workspace-policy/test/environment.test.ts`:

```ts
async function createProtocolSource(source: string): Promise<WorkspaceFixture> {
  const protocol = validManifest('@aurora/event-schema');
  protocol.aurora = { layer: 'protocol' };
  return createWorkspaceFixture([
    { directory: 'packages/event-schema', manifest: protocol, files: { 'src/index.ts': source } },
  ]);
}
```

Append:

```ts
describe('protocol source policy', () => {
  it.each([
    'export const leaked = window;',
    'export const leaked = document;',
    'export const leaked = navigator;',
    'export const leaked = fetch;',
    'export const leaked = process;',
    'export const leaked = Buffer;',
    "import { readFile } from 'node:fs/promises'; export { readFile };",
  ])('rejects environment-specific protocol source: %s', async (source) => {
    fixture = await createProtocolSource(source);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'forbidden-runtime-global',
          packageName: '@aurora/event-schema',
        }),
      ]),
    );
  });

  it('accepts environment-neutral protocol constants and pure functions', async () => {
    fixture = await createProtocolSource(
      "export const kind = 'error' as const; export function parse(input: unknown): boolean { return typeof input === 'string'; }",
    );
    await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({
      ok: true,
      violations: [],
    });
  });
});
```

- [ ] **Step 2: Confirm the intended red state**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts
```

Expected: exit `1`; protocol fixtures with DOM/Node APIs are not inspected because the current environment policy only scans `sdk-core` and `sdk-browser`.

- [ ] **Step 3: Extend the existing environment scanner to protocol source**

In `tooling/workspace-policy/src/environment.ts`, add:

```ts
const forbiddenProtocolRuntimeNames: ReadonlySet<string> = new Set([
  'window',
  'document',
  'navigator',
  'location',
  'fetch',
  'XMLHttpRequest',
  'localStorage',
  'sessionStorage',
  'process',
  'Buffer',
  'require',
  'module',
  '__dirname',
  '__filename',
]);

function isNodeRuntimeImport(node: ts.Node): boolean {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return false;
  const specifier = node.moduleSpecifier;
  return specifier !== undefined &&
    ts.isStringLiteralLike(specifier) &&
    specifier.text.startsWith('node:');
}
```

Extend the internal `inspectSource` layer parameter from:

```ts
layer: 'sdk-core' | 'sdk-browser',
```

to:

```ts
layer: 'protocol' | 'sdk-core' | 'sdk-browser',
```

Inside its AST visitor, before the existing Core/Browser branches, add:

```ts
    if (layer === 'protocol') {
      const isForbiddenIdentifier =
        ts.isIdentifier(node) &&
        forbiddenProtocolRuntimeNames.has(node.text) &&
        !ts.isImportSpecifier(node.parent) &&
        !ts.isImportClause(node.parent);
      if (isForbiddenIdentifier || isNodeRuntimeImport(node)) {
        violations.push({
          code: 'forbidden-runtime-global',
          packageName: workspacePackage.name,
          file: relative(workspacePackage.directory, file).replaceAll('\\', '/'),
          message: 'protocol source must remain independent of DOM and Node runtime APIs',
        });
      }
    }
```

Finally replace the early layer gate:

```ts
if (layer !== 'sdk-core' && layer !== 'sdk-browser') return [];
```

with:

```ts
if (layer !== 'protocol' && layer !== 'sdk-core' && layer !== 'sdk-browser') return [];
```

Do not alter Core or Browser forbidden sets or host-mutation semantics.

- [ ] **Step 4: Confirm the policy green state**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts test/dependency-policy.test.ts test/event-schema-package-contract.test.ts
```

Expected: exit `0`; all seven environment-specific protocol cases fail in fixtures, the pure protocol case passes, and existing Core/Browser/dependency/manifest cases remain green.

- [ ] **Step 5: Add package-local architecture evidence**

Create `packages/event-schema/test/architecture-boundary.test.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: URL): Promise<readonly URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) return sourceFiles(url);
      return entry.isFile() && entry.name.endsWith('.ts') ? [url] : [];
    }),
  );
  return nested.flat();
}

describe('event-schema architecture boundary', () => {
  it('keeps zero runtime dependency and exactly two public entries', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest).toMatchObject({
      dependencies: undefined,
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './contract-testkit': {
          types: './dist/contract-testkit/index.d.ts',
          import: './dist/contract-testkit/index.js',
        },
      },
      aurora: { layer: 'protocol' },
    });
  });

  it('uses an ES-only, runtime-types-free build', async () => {
    const config: unknown = JSON.parse(
      await readFile(new URL('../tsconfig.build.json', import.meta.url), 'utf8'),
    );
    expect(config).toMatchObject({
      compilerOptions: { types: [] },
      include: ['src/**/*.ts'],
    });
  });

  it('contains no consumer, DOM, Node runtime, console, or private cross-package source', async () => {
    const text = (
      await Promise.all(
        (await sourceFiles(new URL('../src/', import.meta.url))).map((file) =>
          readFile(file, 'utf8'),
        ),
      )
    ).join('\n');
    for (const forbidden of [
      '@aurora/core',
      '@aurora/browser',
      '@aurora/plugin-',
      "from 'node:",
      'window.',
      'document.',
      'navigator.',
      'process.',
      'Buffer.',
      'console.',
      '/src/',
      '/internal/',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});
```

The TypeScript build remains the authoritative DOM/Node type check; this source test provides a readable negative inventory without parsing implementation internals.

- [ ] **Step 6: Extend built-entry behavior**

In the root-entry test in `packages/event-schema/test/package-entry.test.ts`, append:

```ts
    expect(result.stdout).toContain('ErrorCategory');
    expect(result.stdout).toContain('ErrorResourceType');
    expect(result.stdout).toContain('PromiseRejectionReasonKind');
    expect(result.stdout).toContain('ERROR_EVENT_LIMITS');
    expect(result.stdout).toContain('parseErrorEventBody');
    expect(result.stdout).toContain('parseErrorEventEnvelope');
```

In the testkit-entry test, append:

```ts
    expect(result.stdout).toContain('validErrorEventSamples');
    expect(result.stdout).toContain('invalidErrorEventSamples');
    expect(result.stdout).toContain('boundaryErrorEventSamples');
```

Add these private paths to the existing rejection array:

```ts
      '@aurora/event-schema/error-event-body',
      '@aurora/event-schema/error-event-envelope',
      '@aurora/event-schema/resource-error-event',
```

- [ ] **Step 7: Build and verify public/private entries**

Run:

```powershell
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema test:package
pnpm --filter @aurora/event-schema exec vitest run test/architecture-boundary.test.ts
pnpm check:boundaries
```

Expected: all commands exit `0`; package-entry reports all cases passing; both public entries load; all old and new private paths report `ERR_PACKAGE_PATH_NOT_EXPORTED`; boundary CLI is silent.

- [ ] **Step 8: Suggested commit boundary**

```bash
git add tooling/workspace-policy/src/environment.ts tooling/workspace-policy/test/environment.test.ts packages/event-schema/test/architecture-boundary.test.ts packages/event-schema/test/package-entry.test.ts
git commit -m "test(protocol): enforce error contract boundaries"
```

Do not execute these Git commands without separate authorization.

---

### Task 8: README, executable protocol examples, coverage, and verified implementation evidence

**Files:**
- Modify: `packages/event-schema/test/documentation-contract.test.ts`
- Modify: `packages/event-schema/README.md`
- Modify: `docs/protocol/error-event-contract.md`
- Modify: `docs/protocol/event-envelope-v1.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/architecture/sdk-architecture.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/adr/ADR-003-sdk-plugin-architecture.md`
- Modify: `docs/adr/ADR-005-event-schema-source-of-truth.md`
- Modify: `docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `docs/adr/README.md`
- Modify: `AGENTS.md`
- Modify: `AURORA_RULES.md`
- Modify: `README.md`
- Modify: `package.json`

**Consumes:**
- Tasks 1–7 verified behavior, approved error contract, documentation metadata rules, current ADR dual states, root command contract, and actual command outputs.

**Produces:**
- Executable README/spec examples, an honest module README, generic-versus-exact parser documentation, formalization/architecture/entry synchronization, observed ADR implementation evidence, unchanged ADR decisions/states, coverage proof, and the complete root quality gate.

- [ ] **Step 1: Write failing documentation contract assertions**

In `packages/event-schema/test/documentation-contract.test.ts`, add `parseErrorEventEnvelope` to the existing root import and append:

```ts
  it('keeps the README explicit about the implemented error contract and absent plugin', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    expect(readme).toContain('## 错误事件契约');
    expect(readme).toContain('parseErrorEventBody(input: unknown)');
    expect(readme).toContain('parseErrorEventEnvelope(input: unknown)');
    expect(readme).toContain('JavaScript 运行时错误');
    expect(readme).toContain('未处理 Promise 拒绝');
    expect(readme).toContain('资源加载错误');
    expect(readme).toContain('不实现错误采集插件');
    expect(readme).not.toContain('错误采集插件已经实现');
  });

  it('executes valid and invalid README error examples', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    const valid = parseErrorEventEnvelope(contractExample(readme, 'valid-error-readme'));
    expect(valid.success).toBe(true);
    const invalid = parseErrorEventEnvelope(contractExample(readme, 'invalid-error-readme'));
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues.map(({ code }) => code)).toContain('invalid_url');
    }
  });

  it('executes valid and invalid formal error-contract examples', async () => {
    const protocol = await repositoryFile('docs/protocol/error-event-contract.md');
    const valid = parseErrorEventEnvelope(contractExample(protocol, 'valid-error-spec'));
    expect(valid.success).toBe(true);
    const invalid = parseErrorEventEnvelope(contractExample(protocol, 'invalid-error-spec'));
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues.map(({ code }) => code)).toContain('invalid_url');
    }
  });
```

- [ ] **Step 2: Confirm the intended red state**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/documentation-contract.test.ts
```

Expected: exit `1`; the module README still says concrete error bodies do not exist and lacks the two marked error examples.

- [ ] **Step 3: Update the module README with exact implemented behavior**

In `packages/event-schema/README.md`:

1. Preserve the title, private-package statement, protocol version, existing envelope API, existing examples, dependency boundary, compatibility rules, commands, coverage thresholds, and authority links.
2. Replace only the statements that all concrete bodies are absent.
3. Add this exact section after `## 输入与输出`:

````markdown
## 错误事件契约

本包已实现错误事件协议契约第一增量。它只定义 JavaScript 运行时错误、未处理 Promise 拒绝和资源加载错误的机器正文，不实现错误采集插件。

```ts
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  PromiseRejectionReasonKind,
  parseErrorEventBody,
  parseErrorEventEnvelope,
  type ErrorEventBody,
  type ErrorEventEnvelope,
} from '@aurora/event-schema';
```

`parseErrorEventBody(input: unknown)` 同步校验精确正文。`parseErrorEventEnvelope(input: unknown)` 先复用公共信封校验，再要求 `eventType: "error"`。成功结果是新对象；解析器不修改输入。

- JavaScript 运行时错误：必填有限 `message`，可选有限 `name` 和原始 `stack`；
- 未处理 Promise 拒绝：使用 `error`、`string` 或有界 `non_standard` 原因；
- 资源加载错误：只允许 `script`、`stylesheet`、`image`、`font`，并从 HTTP(S) URL 中移除全部查询和片段。

自由文本必须在进入协议前完成隐私过滤。协议拒绝未知字段、已知禁止字段、无限对象、循环、超界值和非 JSON Promise 值；issue 不回显输入。

<!-- contract-example:valid-error-readme -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-error-valid",
  "eventType": "error",
  "occurredAt": 1800000004001,
  "body": {
    "category": "javascript",
    "error": {
      "name": "TypeError",
      "message": "Synthetic runtime failure"
    }
  }
}
```

<!-- contract-example:invalid-error-readme -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-readme-error-invalid",
  "eventType": "error",
  "occurredAt": 1800000004002,
  "body": {
    "category": "resource",
    "resource": {
      "type": "image",
      "url": "data:image/png,synthetic"
    }
  }
}
```

错误协议不包含浏览器监听器、错误规范化、去重、分组、指纹、Source Map、传输、采样、队列、重试、持久化、服务端或管理平台。
````

4. Add [错误事件协议契约](../../docs/protocol/error-event-contract.md) to `## 关联文档`.
5. Keep the statement that request, performance, generic resource, batch, reception, and transport contracts are absent.

- [ ] **Step 4: Keep formal protocol examples executable**

In `docs/protocol/error-event-contract.md`, ensure these exact marked examples appear in the field-semantics section:

````markdown
<!-- contract-example:valid-error-spec -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-spec-error-valid",
  "eventType": "error",
  "occurredAt": 1800000004101,
  "body": {
    "category": "resource",
    "resource": {
      "type": "script",
      "url": "https://static.example.test/app.js?cache=synthetic#fragment"
    }
  }
}
```

该输入成功后，输出 `body.resource.url` 必须是 `https://static.example.test/app.js`。

<!-- contract-example:invalid-error-spec -->

```json
{
  "protocolVersion": 1,
  "eventId": "evt-spec-error-invalid",
  "eventType": "error",
  "occurredAt": 1800000004102,
  "body": {
    "category": "resource",
    "resource": {
      "type": "font",
      "url": "file:///synthetic/font.woff2"
    }
  }
}
```

该输入返回 `invalid_url`，issue 不包含 URL 值。
````

Do not change the document's `approved` status or expand its scope.

- [ ] **Step 5: Clarify generic and exact protocol layering**

Append this exact section to `docs/protocol/event-envelope-v1.md`:

```markdown
## 9. 精确错误事件解析

公共 `parseEventEnvelope(input: unknown)` 继续只校验信封和通用 `body` 资源边界，成功结果的 `body` 保持 `unknown`。

错误事件必须继续调用 `parseErrorEventEnvelope(input: unknown)`。该入口复用本信封的版本、编号、事件类型和时间戳规则，要求 `eventType` 为 `error`，再按[错误事件协议契约](error-event-contract.md)校验 JavaScript、未处理 Promise 拒绝或资源加载错误正文。

资源加载错误属于 `eventType: "error"` 与 `body.category: "resource"` 的组合，不使用公共 `eventType: "resource"`。通过通用信封解析不等于通过精确错误正文解析。
```

- [ ] **Step 6: Add the formal document to the existing format gate**

In the root `package.json` `format:check` script, insert:

```text
docs/protocol/error-event-contract.md
```

immediately after `docs/protocol/event-schema-foundation.md`. Do not change any command name, order, dependency, coverage threshold, or `check:ci` semantics.

- [ ] **Step 7: Run focused documentation, coverage, and boundary gates before evidence**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/documentation-contract.test.ts
pnpm --filter @aurora/event-schema test
pnpm --filter @aurora/event-schema test:coverage
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema test:package
pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts test/dependency-policy.test.ts test/event-schema-package-contract.test.ts
pnpm check:boundaries
```

Expected: every command exits `0`; all documentation examples execute; all event-schema tests pass; built entries pass; boundary CLI is silent; reported coverage is at least 85% lines, 80% branches, 85% functions, and 85% statements. If a threshold fails, add public-behavior tests for the uncovered branch; do not exclude a file or lower a threshold.

- [ ] **Step 8: Synchronize implementation facts without changing ADR decisions**

Only after Step 7 passes, make these exact semantic updates:

1. `docs/README.md`
   - link the approved error-event contract and real `@aurora/event-schema` module README;
   - state that the envelope foundation plus the three-category error contract exist;
   - keep request/performance/generic-resource/behavior bodies, batch/reception protocol, actual SDK/server consumers, plugins, CI, release, and infrastructure absent.

2. `docs/architecture/system-overview.md`
   - update the public-protocol implementation sentence to include the error-event contract;
   - keep error collection and every service-side capability absent.

3. `docs/architecture/sdk-architecture.md`
   - state that an error plugin may consume the error contract only from `@aurora/event-schema`;
   - keep the error plugin, listeners, normalization, transport, and adapters absent.

4. `docs/architecture/formalization-readiness.md`
   - update A1 to `partially implemented: envelope/version/runtime boundaries/shared envelope samples/error-event contract/error-event samples`;
   - keep request/performance/generic-resource/behavior bodies, batch Schema, compatibility conversion, and real system consumers blocked;
   - do not unblock plugin-error automatically.

5. `docs/adr/ADR-005-event-schema-source-of-truth.md`
   - keep `status: accepted` and `implementation-status: in-progress`;
   - append a dated evidence record naming the exact error files, public root/testkit symbols, focused commands, observed exit codes, observed test totals, observed four coverage values, package-entry results, and remaining protocol work;
   - do not claim a commit, PR, release, plugin, server consumer, or CI workflow unless one actually exists.

6. `docs/adr/ADR-006-one-way-dependencies.md`
   - keep `accepted / in-progress`;
   - append observed evidence for protocol zero local dependencies, protocol DOM/Node negative fixtures, ES-only build, public/private entry tests, cycle/private-path checks, command exit codes, and remaining dependency layers.

7. `docs/adr/ADR-003-sdk-plugin-architecture.md`
   - keep `accepted / in-progress`;
   - append only that the public error contract prerequisite is implemented and verified;
   - explicitly state that `packages/plugin-error`, browser listeners, plugin lifecycle integration, normalization, and submission behavior do not exist.

8. `docs/adr/README.md`
   - preserve ADR-003/005/006 as `accepted / in-progress`;
   - preserve ADR-007 as `accepted / implemented`;
   - do not alter any decision text.

9. `AGENTS.md` and `AURORA_RULES.md`
   - record the error-event contract as the fifth bounded implementation increment only after all gates pass;
   - keep plugin-error as the next separately specified consumer, not as implemented;
   - preserve the file-size/line-count limits and the ordered queue.

10. Root `README.md`
    - state that concrete error protocol types/validation/samples now exist;
    - state that error collection, plugins, transport, server, machine ingestion contract, CI, release, and infrastructure still do not exist.

Every evidence record uses values copied from fresh Step 7/9 output. Fixed expected thresholds and sample counts are not written as observed results.

- [ ] **Step 9: Run the complete fresh repository gate**

Run in this exact order:

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm build
pnpm --filter @aurora/event-schema test:package
pnpm check:ci
git diff --check
```

Expected:

- Node prints `v24.18.0`;
- pnpm prints `11.17.0`;
- frozen install exits `0` and leaves `pnpm-lock.yaml` unchanged;
- every remaining command exits `0`;
- coverage remains at or above 85/80/85/85;
- root/testkit entries load and private paths fail;
- `check:ci` remains the existing full non-interactive repository gate;
- `git diff --check` emits no whitespace errors.

Do not write an evidence claim for any command that did not run or did not exit `0`.

- [ ] **Step 10: Verify explicit negative scope**

Run:

```powershell
Get-ChildItem -LiteralPath packages -Directory | Select-Object -ExpandProperty Name
Select-String -Path packages/event-schema/package.json -Pattern '"dependencies"|workspace:' -CaseSensitive
Select-String -Path packages/event-schema/src/**/*.ts -Pattern '@aurora/core|@aurora/browser|@aurora/plugin-|window|document|navigator|fetch|XMLHttpRequest|process|Buffer|node:|console\.' -CaseSensitive
Select-String -Path packages/event-schema/src/**/*.ts -Pattern 'addEventListener|onerror|onunhandledrejection|sourceMap|fingerprint|transport|retry|queue' -CaseSensitive
git diff --name-only
git status --short --branch
git diff --cached --stat
```

Expected:

- packages remain `browser`, `core`, and `event-schema`; no `plugin-error` directory exists;
- event-schema manifest has no runtime `dependencies` or `workspace:` range;
- source searches return no forbidden consumer/environment/collection/network match;
- changed paths are limited to the files listed in this plan plus protected pre-existing user changes;
- the staged set remains exactly as it was before execution.

- [ ] **Step 11: Suggested documentation/evidence commit boundary**

```bash
git add packages/event-schema/README.md packages/event-schema/test/documentation-contract.test.ts docs/protocol/error-event-contract.md docs/protocol/event-envelope-v1.md docs/README.md docs/architecture/system-overview.md docs/architecture/sdk-architecture.md docs/architecture/formalization-readiness.md docs/adr/ADR-003-sdk-plugin-architecture.md docs/adr/ADR-005-event-schema-source-of-truth.md docs/adr/ADR-006-one-way-dependencies.md docs/adr/README.md AGENTS.md AURORA_RULES.md README.md package.json
git commit -m "docs(protocol): record error event contract evidence"
```

Do not execute these Git commands without separate authorization.

## Specification Traceability

| Approved specification requirement | Executable task evidence |
|---|---|
| 1. Status, owner, scope, authority | Planning document frontmatter; Task 8 documentation contract and index synchronization |
| 2. Responsibilities and non-responsibilities | Global Constraints; complete file tree; Task 8 negative-scope commands |
| 3. Relationship to `EventEnvelope` | Task 5 composition tests/implementation; Task 8 envelope documentation |
| 4. Supported error categories | Task 1 exact constants; Tasks 2–4 one parser per category |
| 5. Minimum semantics per category | Task 2 JavaScript tests; Task 3 Promise tests; Task 4 resource tests |
| 6. Public TypeScript types | Task 1 compile-only public consumer and exact root exports |
| 7. Runtime parsing entries | Task 2 `parseErrorEventBody`; Task 5 `parseErrorEventEnvelope` |
| 8. Required and optional fields | Tasks 2–4 missing/null/type/unknown-field matrices |
| 9. String, count, and depth limits | Task 1 named limits; Tasks 2–4 unit boundaries; Task 6 shared boundaries |
| 10. Empty, missing, null, and unknown semantics | Tasks 2–4 black-box failures and stable issues |
| 11. Non-standard exception values | Task 3 safe JSON union, bounded recursive copy, and non-JSON rejection |
| 12. Promise reason privacy boundary | Task 3 three reason kinds, forbidden-field checks, cycles, size, depth, and copies |
| 13. Resource URL redaction | Task 4 URL tests/parser; Task 6 sanitized expected sample; Task 8 executable examples |
| 14. Raw stack limit and privacy | Task 1 limit; Task 2 exact stack tests; Task 8 README privacy statement |
| 15. Forbidden fields | Existing generic scan plus Task 3 token variants and Task 8 negative privacy text |
| 16. Stable Schema issues | Task 1 additive codes; Tasks 2–5 path/code assertions |
| 17. Compatibility rules | Task 5 current/unsupported versions; Task 6 minimum/optional shapes; Task 8 protocol text |
| 18. Public exports | Task 1 root API; Task 6 testkit API; Task 7 built entry/private path checks |
| 19. Legal, illegal, and boundary samples | Task 6 three sample collections |
| 20. Contract-test consumers | Task 6 SDK, ingestion, and processing consumers |
| 21. Coverage | Existing thresholds preserved; Task 8 focused and root coverage gates |
| 22. Documentation synchronization | Task 8 README, protocol, architecture, readiness, ADR, and entry updates |
| 23. Explicit exclusions | Global Constraints; Task 8 source/path searches and Final Review Gate |
| 24. Error-plugin consumption boundary | Global Constraints and Task 8 architecture/ADR text; plugin directory remains absent |

## Final Review Gate

Before reporting implementation complete, inspect every changed file and answer each item with repository evidence:

- The root exports all approved runtime constants/parsers and all approved public types with exactly the names in `Final Public API`.
- `contract-testkit` preserves the three envelope sample collections and adds exactly the three error sample collections.
- `parseEventEnvelope` remains generic and unchanged; `parseErrorEventEnvelope` composes it.
- Every error body uses `EventType.Error`; resource-load errors do not use `EventType.Resource`.
- JavaScript, Promise, and resource variants each have minimum, full, missing, wrong-type, null, empty, over-limit, unknown-field, and invalid-enum coverage where applicable.
- Promise non-standard values cover safe primitives/arrays/objects, cycles, total depth, array/object limits, non-JSON values, forbidden fields, and recursive copied output.
- Resource URLs cover all four types, exact length, unsupported schemes, authority, credentials, query/fragment removal, unknown fields, and unchanged input.
- Current version and valid timestamp pass; versions `0`/`2`, invalid timestamp, and three non-error event types fail with stable issues.
- SDK, ingestion, and processing tests consume the same public sample source.
- No parser logs, stringifies arbitrary input, echoes values in issues, mutates input, or retains input arrays/plain objects in success output.
- The package has zero runtime/local dependency, no DOM/Node runtime source, no cycle, no consumer dependency, and no private cross-package import.
- Built root/testkit entries load; every listed private path is rejected.
- Coverage is at least lines 85%, branches 80%, functions 85%, statements 85%.
- README and formal protocol JSON examples execute through the public exact parser.
- ADR-003/005/006 remain `accepted / in-progress`; ADR-007 remains `accepted / implemented`; no decision text changes.
- Browser listeners, `packages/plugin-error`, normalization, deduplication, grouping, fingerprinting, Source Map handling, transport, sampling, queueing, retry, persistence, services, databases, management UI, CI, release, containers, IaC, and cloud resources remain absent.
- No unrelated user change is overwritten; no staging, commit, push, PR, release, or publication occurs without separate authorization.

Stop after this review. Do not start `packages/plugin-error` or plan another module.
