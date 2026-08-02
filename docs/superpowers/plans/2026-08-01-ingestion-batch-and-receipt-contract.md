# Ingestion Batch and Receipt Contract (数据接入批次与接收结果协议第一增量) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@aurora/event-schema` 中冻结并实施数据接入批次与接收结果协议第一增量：批次请求正文、请求级与逐事件接收结果、稳定状态枚举（`IngestionReceiptState`）、稳定错误码（`IngestionErrorCode`）、`parseIngestionBatchRequest`/`parseIngestionRequestReceipt`/`parseIngestionEventReceipt` 解析器与契约样本。本计划只在用户批准正式规格后执行；当前状态为 ready-for-implementation（等待用户审批）。

**Architecture:** 镜像已实施性能/请求事件契约的协议模式：新增 `ingestion-types.ts`（常量、限制、状态、错误码、批次/接收结果类型）、`ingestion-batch-request.ts`（批次请求正文解析器）、`ingestion-request-receipt.ts`（请求级与逐事件接收结果解析器），复用既有 `field-validation.ts`、`value-boundaries.ts` 中立助手与 `parseEventEnvelope`，不复制校验逻辑。`contract-testkit` 新增批次请求与请求级结果两组样本，包根新增批次导出。协议层零依赖，不接触 Inbox、数据库、OpenAPI、采样或限流。

**Tech Stack:** TypeScript 6.0.3（root `strict`/`exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`）、Vitest 4.1.10、@vitest/coverage-v8 4.1.10、pnpm Workspace 11.17.0、Node.js ≥24.18.0。

**Plan status:** ready-for-implementation（仅在用户批准 `docs/protocol/ingestion-batch-and-receipt-contract.md` 后执行；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 只修改 `packages/event-schema`，不修改 Core、Browser、plugin-error、plugin-request、plugin-performance 的公共接口，不创建新包。
- `event-schema` 保持零运行时依赖、零本地 Workspace 依赖、`aurora.layer: protocol`、`sideEffects: false`、恰好两个公共入口（`.` 与 `./contract-testkit`）。
- "已可靠接收"（`accepted`）严格对应 ADR-008 的 `event_inbox` 事务提交成功；本计划不实现 Inbox 写入、数据库、Migration、OpenAPI、采样、限流、队列或 Worker。
- 批次部分成功：逐事件独立结果；单条永久拒绝/暂时失败不回滚其他合法事件；请求级结果不掩盖逐事件结果。
- 重复事件返回 `duplicate_accepted`（`retryable: false`），不暴露数据库约束名称或错误。
- 永久拒绝 `retryable: false`；暂时失败 `retryable: true` + 可选 `retryAfterMs`。
- 解析器为同步、确定性、非抛出；不修改输入，不记录输入，成功结果全部新建。
- 复用 `field-validation.ts`（`isPlainRecord`、`readRequiredField`、`rejectUnknownFields`、`addValidationIssue`、`parseBoundedString`）与 `value-boundaries.ts`（`validateBodyValue`），不复制其逻辑。
- 不增加新 `EventSchemaIssueCode`；复用 `missing_required_field`、`invalid_type`、`unknown_field`、`invalid_enum`、`string_empty`、`string_too_long`、`array_too_large`、`invalid_number`、`invalid_timestamp`、`unsupported_protocol_version`。
- 文件 kebab-case，类型/接口 PascalCase，函数/变量 camelCase，布尔值 `is`/`has`/`can`/`should` 前缀。禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore`。
- 不创建 `utils`/`helpers`/`common`/`misc`。生产源码不使用 `console`、DOM、`PerformanceObserver`、`performance.*`、Node 运行时。
- 覆盖率阈值 lines ≥ 85 / branches ≥ 80 / functions ≥ 85 / statements ≥ 85，由 `packages/event-schema/vitest.config.ts` 固定，不得排除逻辑文件。
- 不定义 HTTP 路径/Header/状态码映射、OpenAPI security scheme、客户端上报密钥物理格式、精确批次数量（除 `BATCH_EVENT_LIMITS` 已冻结的普通实施细节外）、采样率/算法、租约、死信和保留期限。
- ADR-003/005/006 保持 `accepted / in-progress`，ADR-007 保持 `accepted / implemented`，ADR-008 保持 `accepted / not-started`，本计划不改变任何 ADR 状态。

---

## 文件树

```text
packages/event-schema/
├── src/
│   ├── index.ts                           # Modify：新增批次/接收结果导出
│   ├── ingestion-types.ts                 # Create：常量、限制、状态、错误码、批次/接收结果/事件结果类型
│   ├── ingestion-batch-request.ts         # Create：parseIngestionBatchRequest
│   ├── ingestion-request-receipt.ts       # Create：parseIngestionRequestReceipt + parseIngestionEventReceipt
│   └── contract-testkit/
│       ├── boundary-ingestion-samples.ts  # Create
│       ├── invalid-ingestion-samples.ts   # Create
│       ├── valid-ingestion-samples.ts     # Create
│       └── index.ts                       # Modify：新增批次/接收结果样本导出
└── test/
    ├── ingestion-batch-request.test.ts    # Create
    ├── ingestion-request-receipt.test.ts  # Create
    ├── ingestion-types.test.ts            # Create
    ├── package-entry.test.ts              # Modify：扩展根入口与样本入口断言
    ├── architecture-boundary.test.ts      # Modify：扩展禁止项
    └── consumers/
        ├── ingestion-ingestion.contract.test.ts    # Create
        ├── processing-ingestion.contract.test.ts   # Create
        └── sdk-ingestion.contract.test.ts          # Create
```

根文件修改（跨 Task 使用）：`packages/event-schema/README.md`、`docs/protocol/ingestion-batch-and-receipt-contract.md`（已存在，draft）、`docs/README.md`、`docs/architecture/formalization-readiness.md`、`docs/adr/ADR-005-event-schema-source-of-truth.md`、`docs/adr/ADR-008-ingestion-durable-buffering.md`、`docs/adr/ADR-006-one-way-dependencies.md`、`AGENTS.md`、`AURORA_RULES.md`、根 `README.md`。

---

### Task 1: 批次类型、限制、状态枚举与错误码常量

**Files:**
- Create: `packages/event-schema/src/ingestion-types.ts`
- Create: `packages/event-schema/test/ingestion-types.test.ts`

**Interfaces:**
- Consumes: 既有 `event-envelope.ts`（`EventEnvelope`）、`event-types.ts`（`EventType`）、`validation-issues.ts`（`EventEnvelopeParseFailure`）。
- Produces: `BATCH_EVENT_LIMITS`、`IngestionReceiptState`、`IngestionErrorCode`、`IngestionBatchRequest`、`IngestionRequestReceipt`、`IngestionEventReceipt` 及全部解析结果类型（后续 Task 依赖）。

- [ ] **Step 1: 写失败的类型与常量测试**

`packages/event-schema/test/ingestion-types.test.ts`：

```ts
import {
  BATCH_EVENT_LIMITS,
  IngestionErrorCode,
  IngestionReceiptState,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('ingestion types', () => {
  it('freezes exactly the approved batch limits', () => {
    expect(BATCH_EVENT_LIMITS).toEqual({
      maxEventsPerBatch: 50,
      maxEventIdLength: 128,
      maxErrorCodeLength: 64,
      maxRetryAfterMs: 86400000,
    });
  });
  it('exposes exactly the four receipt states', () => {
    expect(IngestionReceiptState).toEqual({
      Accepted: 'accepted',
      DuplicateAccepted: 'duplicate_accepted',
      PermanentlyRejected: 'permanently_rejected',
      TemporarilyFailed: 'temporarily_failed',
    });
  });
  it('exposes the approved error codes', () => {
    expect(IngestionErrorCode.UnsupportedProtocolVersion).toBe('unsupported_protocol_version');
    expect(IngestionErrorCode.InvalidSchema).toBe('invalid_schema');
    expect(IngestionErrorCode.FieldExceedsLimit).toBe('field_exceeds_limit');
    expect(IngestionErrorCode.ForbiddenField).toBe('forbidden_field');
    expect(IngestionErrorCode.InvalidEventType).toBe('invalid_event_type');
    expect(IngestionErrorCode.ProjectPermanentlyNotAllowed).toBe('project_permanently_not_allowed');
    expect(IngestionErrorCode.SourcePermanentlyNotAllowed).toBe('source_permanently_not_allowed');
    expect(IngestionErrorCode.ServiceTemporarilyUnavailable).toBe(
      'service_temporarily_unavailable',
    );
    expect(IngestionErrorCode.RateLimited).toBe('rate_limited');
    expect(IngestionErrorCode.CapacityProtected).toBe('capacity_protected');
  });
});
```

**预期失败原因：** `src/index.ts` 尚未导出 `BATCH_EVENT_LIMITS`、`IngestionReceiptState`、`IngestionErrorCode`，`ingestion-types.ts` 不存在，导入失败。

- [ ] **Step 2: 最小实现类型与常量**

`packages/event-schema/src/ingestion-types.ts`：

```ts
import type { EventEnvelope } from './event-envelope.js';
import type { ProtocolVersion } from './constants.js';
import type { EventEnvelopeParseFailure } from './validation-issues.js';

export const BATCH_EVENT_LIMITS = Object.freeze({
  readonly maxEventsPerBatch: 50,
  readonly maxEventIdLength: 128,
  readonly maxErrorCodeLength: 64,
  readonly maxRetryAfterMs: 86400000,
} as const);

export const IngestionReceiptState = Object.freeze({
  readonly Accepted: 'accepted',
  readonly DuplicateAccepted: 'duplicate_accepted',
  readonly PermanentlyRejected: 'permanently_rejected',
  readonly TemporarilyFailed: 'temporarily_failed',
} as const);
export type IngestionReceiptState =
  (typeof IngestionReceiptState)[keyof typeof IngestionReceiptState];

export const IngestionErrorCode = Object.freeze({
  readonly BatchAccepted: 'batch_accepted',
  readonly EventAccepted: 'event_accepted',
  readonly DuplicateAccepted: 'duplicate_accepted',
  readonly UnsupportedProtocolVersion: 'unsupported_protocol_version',
  readonly InvalidSchema: 'invalid_schema',
  readonly FieldExceedsLimit: 'field_exceeds_limit',
  readonly ForbiddenField: 'forbidden_field',
  readonly InvalidEventType: 'invalid_event_type',
  readonly ProjectPermanentlyNotAllowed: 'project_permanently_not_allowed',
  readonly SourcePermanentlyNotAllowed: 'source_permanently_not_allowed',
  readonly ServiceTemporarilyUnavailable: 'service_temporarily_unavailable',
  readonly RateLimited: 'rate_limited',
  readonly CapacityProtected: 'capacity_protected',
} as const);
export type IngestionErrorCode = (typeof IngestionErrorCode)[keyof typeof IngestionErrorCode];

export interface IngestionBatchRequest {
  readonly protocolVersion: ProtocolVersion;
  readonly events: readonly EventEnvelope[];
  readonly receivedAt?: number;
}

export interface IngestionEventReceipt {
  readonly eventId: string;
  readonly state: IngestionReceiptState;
  readonly errorCode?: IngestionErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

export interface IngestionRequestReceipt {
  readonly batchState: IngestionReceiptState;
  readonly errorCode?: IngestionErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly perEventResults: readonly IngestionEventReceipt[];
}

export type IngestionBatchRequestParseFailure = EventEnvelopeParseFailure;
export type IngestionBatchRequestParseResult =
  | { readonly success: true; readonly data: IngestionBatchRequest }
  | IngestionBatchRequestParseFailure;

export type IngestionRequestReceiptParseFailure = EventEnvelopeParseFailure;
export type IngestionRequestReceiptParseResult =
  | { readonly success: true; readonly data: IngestionRequestReceipt }
  | IngestionRequestReceiptParseFailure;

export type IngestionEventReceiptParseFailure = EventEnvelopeParseFailure;
export type IngestionEventReceiptParseResult =
  | { readonly success: true; readonly data: IngestionEventReceipt }
  | IngestionEventReceiptParseFailure;
```

- [ ] **Step 3: 在 `src/index.ts` 导出批次常量与类型**

在 `src/index.ts` 追加：

```ts
export {
  BATCH_EVENT_LIMITS,
  IngestionErrorCode,
  IngestionReceiptState,
} from './ingestion-types.js';
export type {
  IngestionBatchRequest,
  IngestionBatchRequestParseFailure,
  IngestionBatchRequestParseResult,
  IngestionEventReceipt,
  IngestionEventReceiptParseFailure,
  IngestionEventReceiptParseResult,
  IngestionRequestReceipt,
  IngestionRequestReceiptParseFailure,
  IngestionRequestReceiptParseResult,
} from './ingestion-types.js';
```

- [ ] **Step 4: 确认类型与常量测试通过**

运行：`pnpm --filter @aurora/event-schema exec vitest run test/ingestion-types.test.ts`。预期 exit 0，3 个测试全过。

- [ ] **Step 5: 相关回归**

运行：`pnpm --filter @aurora/event-schema test` 与 `pnpm --filter @aurora/event-schema typecheck`。预期 exit 0，既有 167 个测试保持通过，类型检查无诊断。

- [ ] **Step 6: 建议提交边界**

Task 1 成果：`src/ingestion-types.ts`、`test/ingestion-types.test.ts`、`src/index.ts`（常量与类型导出）。

---

### Task 2: 批次请求正文解析器

**Files:**
- Create: `packages/event-schema/src/ingestion-batch-request.ts`
- Create: `packages/event-schema/test/ingestion-batch-request.test.ts`

**Interfaces:**
- Consumes: `ingestion-types.ts`（`IngestionBatchRequest`、`IngestionBatchRequestParseResult`、`BATCH_EVENT_LIMITS`）、`constants.ts`（`CURRENT_PROTOCOL_VERSION`）、`field-validation.ts`（`isPlainRecord`、`readRequiredField`、`rejectUnknownFields`、`addValidationIssue`、`parseBoundedString`）、`event-envelope.ts`（`parseEventEnvelope`）、`validation-issues.ts`（`EventSchemaIssue`）。
- Produces: `parseIngestionBatchRequest(input: unknown): IngestionBatchRequestParseResult`。

- [ ] **Step 1: 写失败的批次请求解析测试**

`packages/event-schema/test/ingestion-batch-request.test.ts`：

```ts
import {
  CURRENT_PROTOCOL_VERSION,
  EventType,
  parseEventEnvelope,
} from '../src/index.js';
import { parseIngestionBatchRequest } from '../src/index.js';
import { describe, expect, it } from 'vitest';

const validEvent = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId: 'evt-batch-valid-001',
  eventType: EventType.Error,
  occurredAt: 1_800_000_005_100,
  body: {},
};

describe('parseIngestionBatchRequest', () => {
  it('parses a minimal valid batch with one event', () => {
    const input = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [validEvent],
    };
    const result = parseIngestionBatchRequest(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.protocolVersion).toBe(CURRENT_PROTOCOL_VERSION);
    expect(result.data.events).toHaveLength(1);
    expect(result.data.events[0]).toEqual(parseEventEnvelope(validEvent).data);
  });
  it('parses a full valid batch with receivedAt', () => {
    const input = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [validEvent, { ...validEvent, eventId: 'evt-batch-valid-002' }],
      receivedAt: 1_800_000_005_200,
    };
    const result = parseIngestionBatchRequest(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.events).toHaveLength(2);
    expect(result.data.receivedAt).toBe(1_800_000_005_200);
  });
  it('rejects an empty events array as missing required field', () => {
    const result = parseIngestionBatchRequest({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [],
    });
    expect(result.success).toBe(false);
  });
  it('rejects unsupported protocol version', () => {
    const result = parseIngestionBatchRequest({
      protocolVersion: 2,
      events: [validEvent],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some((i) => i.code === 'unsupported_protocol_version')).toBe(true);
  });
  it('does not mutate the input', () => {
    const input = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [validEvent],
    };
    const snapshot = JSON.stringify(input);
    parseIngestionBatchRequest(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
```

**预期失败原因：** `parseIngestionBatchRequest` 尚未实现，`ingestion-batch-request.ts` 不存在，导入/调用失败。

- [ ] **Step 2: 最小实现批次请求解析器**

`packages/event-schema/src/ingestion-batch-request.ts`：

```ts
import { CURRENT_PROTOCOL_VERSION } from './constants.js';
import { parseEventEnvelope, type EventEnvelope } from './event-envelope.js';
import {
  addValidationIssue,
  isPlainRecord,
  readRequiredField,
  rejectUnknownFields,
} from './field-validation.js';
import {
  BATCH_EVENT_LIMITS,
  type IngestionBatchRequest,
  type IngestionBatchRequestParseResult,
} from './ingestion-types.js';
import type { EventSchemaIssue } from './validation-issues.js';

const BATCH_REQUEST_FIELDS: ReadonlySet<string> = new Set([
  'protocolVersion',
  'events',
  'receivedAt',
]);

function parseTimestamp(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input <= 0) {
    addValidationIssue(issues, 'invalid_timestamp', ['receivedAt'], 'receivedAt must be a positive safe integer');
    return undefined;
  }
  return input;
}

export function parseIngestionBatchRequest(input: unknown): IngestionBatchRequestParseResult {
  if (!isPlainRecord(input)) {
    return {
      success: false,
      issues: [
        {
          code: 'invalid_type',
          path: [],
          message: 'Ingestion batch request must be a plain object',
        },
      ],
    };
  }
  const issues: EventSchemaIssue[] = [];
  rejectUnknownFields(input, BATCH_REQUEST_FIELDS, issues, []);
  const versionField = readRequiredField(input, 'protocolVersion', issues, []);
  const eventsField = readRequiredField(input, 'events', issues, []);
  const receivedAtField = readRequiredField(input, 'receivedAt', issues, []);

  let protocolVersion: 1 | undefined;
  if (versionField.found) {
    if (versionField.value !== CURRENT_PROTOCOL_VERSION) {
      addValidationIssue(
        issues,
        'unsupported_protocol_version',
        ['protocolVersion'],
        'Unsupported protocol version',
      );
    } else {
      protocolVersion = CURRENT_PROTOCOL_VERSION;
    }
  }

  let events: readonly EventEnvelope[] | undefined;
  if (eventsField.found) {
    if (!Array.isArray(eventsField.value)) {
      addValidationIssue(issues, 'invalid_type', ['events'], 'events must be an array');
    } else if (eventsField.value.length === 0) {
      addValidationIssue(
        issues,
        'missing_required_field',
        ['events'],
        'events must contain at least one event',
      );
    } else if (eventsField.value.length > BATCH_EVENT_LIMITS.maxEventsPerBatch) {
      addValidationIssue(
        issues,
        'array_too_large',
        ['events'],
        'events exceeds the maximum batch size',
      );
    } else {
      const parsedEvents: EventEnvelope[] = [];
      for (let index = 0; index < eventsField.value.length; index += 1) {
        const element = eventsField.value[index];
        const envelopeResult = parseEventEnvelope(element);
        if (!envelopeResult.success) {
          issues.push(...envelopeResult.issues);
        } else {
          parsedEvents.push({
            protocolVersion: envelopeResult.data.protocolVersion,
            eventId: envelopeResult.data.eventId,
            eventType: envelopeResult.data.eventType,
            occurredAt: envelopeResult.data.occurredAt,
            body: envelopeResult.data.body,
          });
        }
      }
      if (issues.length === 0) {
        events = parsedEvents;
      }
    }
  }

  let receivedAt: number | undefined;
  if (receivedAtField.found) {
    const parsed = parseTimestamp(receivedAtField.value, issues);
    if (parsed !== undefined) receivedAt = parsed;
  }

  if (protocolVersion === undefined || events === undefined) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: { protocolVersion, events, ...(receivedAt === undefined ? {} : { receivedAt }) },
  };
}
```

- [ ] **Step 3: 在 `src/index.ts` 导出批次请求解析器**

在 `src/index.ts` 追加：

```ts
export { parseIngestionBatchRequest } from './ingestion-batch-request.js';
```

- [ ] **Step 4: 确认批次请求测试通过**

运行：`pnpm --filter @aurora/event-schema exec vitest run test/ingestion-batch-request.test.ts`。预期 exit 0，5 个测试全过。

- [ ] **Step 5: 相关回归**

运行：`pnpm --filter @aurora/event-schema test` 与 `pnpm --filter @aurora/event-schema typecheck`。预期 exit 0，既有测试保持通过，类型检查无诊断。

- [ ] **Step 6: 建议提交边界**

Task 2 成果：`src/ingestion-batch-request.ts`、`test/ingestion-batch-request.test.ts`、`src/index.ts`（批次请求解析器导出）。

---

### Task 3: 请求级与逐事件接收结果解析器

**Files:**
- Create: `packages/event-schema/src/ingestion-request-receipt.ts`
- Create: `packages/event-schema/test/ingestion-request-receipt.test.ts`

**Interfaces:**
- Consumes: `ingestion-types.ts`（`IngestionRequestReceipt`、`IngestionEventReceipt`、`IngestionReceiptState`、`IngestionErrorCode`、`BATCH_EVENT_LIMITS`、各解析结果类型）、`field-validation.ts`、`validation-issues.ts`。
- Produces: `parseIngestionRequestReceipt(input: unknown): IngestionRequestReceiptParseResult`、`parseIngestionEventReceipt(input: unknown): IngestionEventReceiptParseResult`。

- [ ] **Step 1: 写失败的接收结果解析测试**

`packages/event-schema/test/ingestion-request-receipt.test.ts`：

```ts
import { IngestionErrorCode, IngestionReceiptState } from '../src/index.js';
import { parseIngestionEventReceipt, parseIngestionRequestReceipt } from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('parseIngestionEventReceipt', () => {
  it('parses an accepted event receipt', () => {
    const result = parseIngestionEventReceipt({
      eventId: 'evt-batch-valid-001',
      state: IngestionReceiptState.Accepted,
      retryable: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.eventId).toBe('evt-batch-valid-001');
    expect(result.data.state).toBe('accepted');
    expect(result.data.retryable).toBe(false);
  });
  it('parses a permanently rejected receipt with errorCode', () => {
    const result = parseIngestionEventReceipt({
      eventId: 'evt-batch-invalid-001',
      state: IngestionReceiptState.PermanentlyRejected,
      errorCode: IngestionErrorCode.InvalidSchema,
      retryable: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.errorCode).toBe('invalid_schema');
  });
  it('rejects an unknown state', () => {
    const result = parseIngestionEventReceipt({
      eventId: 'evt-x',
      state: 'unknown_state',
      retryable: false,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some((i) => i.code === 'invalid_enum')).toBe(true);
  });
});

describe('parseIngestionRequestReceipt', () => {
  it('parses a request receipt with per-event results', () => {
    const result = parseIngestionRequestReceipt({
      batchState: IngestionReceiptState.Accepted,
      retryable: false,
      perEventResults: [
        {
          eventId: 'evt-batch-valid-001',
          state: IngestionReceiptState.Accepted,
          retryable: false,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.perEventResults).toHaveLength(1);
    expect(result.data.batchState).toBe('accepted');
  });
  it('rejects retryAfterMs on a permanently rejected receipt (must be consistent with retryable:false)', () => {
    const result = parseIngestionRequestReceipt({
      batchState: IngestionReceiptState.PermanentlyRejected,
      retryable: false,
      perEventResults: [],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.retryAfterMs).toBeUndefined();
  });
  it('rejects an invalid retryAfterMs value', () => {
    const result = parseIngestionRequestReceipt({
      batchState: IngestionReceiptState.TemporarilyFailed,
      retryable: true,
      retryAfterMs: -1,
      perEventResults: [],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some((i) => i.code === 'invalid_number')).toBe(true);
  });
});
```

**预期失败原因：** `parseIngestionRequestReceipt`/`parseIngestionEventReceipt` 尚未实现，`ingestion-request-receipt.ts` 不存在。

- [ ] **Step 2: 最小实现接收结果解析器**

`packages/event-schema/src/ingestion-request-receipt.ts`：

```ts
import {
  addValidationIssue,
  isPlainRecord,
  readRequiredField,
  rejectUnknownFields,
  parseBoundedString,
} from './field-validation.js';
import {
  BATCH_EVENT_LIMITS,
  IngestionErrorCode,
  IngestionReceiptState,
  type IngestionEventReceipt,
  type IngestionEventReceiptParseResult,
  type IngestionRequestReceipt,
  type IngestionRequestReceiptParseResult,
} from './ingestion-types.js';
import type { EventSchemaIssue } from './validation-issues.js';

const EVENT_RECEIPT_FIELDS: ReadonlySet<string> = new Set([
  'eventId',
  'state',
  'errorCode',
  'retryable',
  'retryAfterMs',
]);
const REQUEST_RECEIPT_FIELDS: ReadonlySet<string> = new Set([
  'batchState',
  'errorCode',
  'retryable',
  'retryAfterMs',
  'perEventResults',
]);

const states: ReadonlySet<unknown> = new Set(Object.values(IngestionReceiptState));
const errorCodes: ReadonlySet<unknown> = new Set(Object.values(IngestionErrorCode));

function parseState(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): IngestionReceiptState | undefined {
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'State must be a string');
    return undefined;
  }
  if (!states.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'State is not supported');
    return undefined;
  }
  return input as IngestionReceiptState;
}

function parseErrorCode(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): IngestionErrorCode | undefined {
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Error code must be a string');
    return undefined;
  }
  if (!errorCodes.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Error code is not supported');
    return undefined;
  }
  return input as IngestionErrorCode;
}

function parseRetryable(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): boolean | undefined {
  if (typeof input !== 'boolean') {
    addValidationIssue(issues, 'invalid_type', path, 'retryable must be a boolean');
    return undefined;
  }
  return input;
}

function parseRetryAfterMs(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): number | undefined {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    addValidationIssue(issues, 'invalid_number', path, 'retryAfterMs must be a non-negative safe integer');
    return undefined;
  }
  if (input > BATCH_EVENT_LIMITS.maxRetryAfterMs) {
    addValidationIssue(issues, 'invalid_number', path, 'retryAfterMs exceeds the maximum');
    return undefined;
  }
  return input;
}

export function parseIngestionEventReceipt(input: unknown): IngestionEventReceiptParseResult {
  if (!isPlainRecord(input)) {
    return {
      success: false,
      issues: [
        { code: 'invalid_type', path: [], message: 'Event receipt must be a plain object' },
      ],
    };
  }
  const issues: EventSchemaIssue[] = [];
  rejectUnknownFields(input, EVENT_RECEIPT_FIELDS, issues, []);
  const eventIdField = readRequiredField(input, 'eventId', issues, []);
  const stateField = readRequiredField(input, 'state', issues, []);
  const errorCodeField = readRequiredField(input, 'errorCode', issues, []);
  const retryableField = readRequiredField(input, 'retryable', issues, []);
  const retryAfterMsField = readRequiredField(input, 'retryAfterMs', issues, []);

  const eventId = eventIdField.found
    ? parseBoundedString(eventIdField.value, BATCH_EVENT_LIMITS.maxEventIdLength, issues, [
        'eventId',
      ])
    : undefined;
  const state = stateField.found ? parseState(stateField.value, issues, ['state']) : undefined;
  const errorCode = errorCodeField.found
    ? parseErrorCode(errorCodeField.value, issues, ['errorCode'])
    : undefined;
  const retryable = retryableField.found
    ? parseRetryable(retryableField.value, issues, ['retryable'])
    : undefined;
  const retryAfterMs = retryAfterMsField.found
    ? parseRetryAfterMs(retryAfterMsField.value, issues, ['retryAfterMs'])
    : undefined;

  if (eventId === undefined || state === undefined || retryable === undefined) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: {
      eventId,
      state,
      ...(errorCode === undefined ? {} : { errorCode }),
      retryable,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
  };
}

export function parseIngestionRequestReceipt(input: unknown): IngestionRequestReceiptParseResult {
  if (!isPlainRecord(input)) {
    return {
      success: false,
      issues: [
        { code: 'invalid_type', path: [], message: 'Request receipt must be a plain object' },
      ],
    };
  }
  const issues: EventSchemaIssue[] = [];
  rejectUnknownFields(input, REQUEST_RECEIPT_FIELDS, issues, []);
  const batchStateField = readRequiredField(input, 'batchState', issues, []);
  const errorCodeField = readRequiredField(input, 'errorCode', issues, []);
  const retryableField = readRequiredField(input, 'retryable', issues, []);
  const retryAfterMsField = readRequiredField(input, 'retryAfterMs', issues, []);
  const perEventField = readRequiredField(input, 'perEventResults', issues, []);

  const batchState = batchStateField.found
    ? parseState(batchStateField.value, issues, ['batchState'])
    : undefined;
  const errorCode = errorCodeField.found
    ? parseErrorCode(errorCodeField.value, issues, ['errorCode'])
    : undefined;
  const retryable = retryableField.found
    ? parseRetryable(retryableField.value, issues, ['retryable'])
    : undefined;
  const retryAfterMs = retryAfterMsField.found
    ? parseRetryAfterMs(retryAfterMsField.value, issues, ['retryAfterMs'])
    : undefined;
  let perEventResults: IngestionEventReceipt[] | undefined;
  if (perEventField.found) {
    if (!Array.isArray(perEventField.value)) {
      addValidationIssue(
        issues,
        'invalid_type',
        ['perEventResults'],
        'perEventResults must be an array',
      );
    } else {
      const parsed: IngestionEventReceipt[] = [];
      for (let index = 0; index < perEventField.value.length; index += 1) {
        const element = perEventField.value[index];
        const receiptResult = parseIngestionEventReceipt(element);
        if (!receiptResult.success) {
          issues.push(...receiptResult.issues);
        } else {
          parsed.push(receiptResult.data);
        }
      }
      if (issues.length === 0) perEventResults = parsed;
    }
  }

  if (batchState === undefined || retryable === undefined || perEventResults === undefined) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: {
      batchState,
      ...(errorCode === undefined ? {} : { errorCode }),
      retryable,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      perEventResults,
    },
  };
}
```

- [ ] **Step 3: 在 `src/index.ts` 导出接收结果解析器**

在 `src/index.ts` 追加：

```ts
export {
  parseIngestionEventReceipt,
  parseIngestionRequestReceipt,
} from './ingestion-request-receipt.js';
```

- [ ] **Step 4: 确认接收结果测试通过**

运行：`pnpm --filter @aurora/event-schema exec vitest run test/ingestion-request-receipt.test.ts`。预期 exit 0，6 个测试全过。

- [ ] **Step 5: 相关回归**

运行：`pnpm --filter @aurora/event-schema test`、`pnpm --filter @aurora/event-schema typecheck`、`pnpm --filter @aurora/event-schema test:coverage`。预期 exit 0，既有测试保持通过，覆盖率门槛 85/80/85/85 满足。

- [ ] **Step 6: 建议提交边界**

Task 3 成果：`src/ingestion-request-receipt.ts`、`test/ingestion-request-receipt.test.ts`、`src/index.ts`（接收结果解析器导出）。

---

### Task 4: 合法、非法与边界契约样本

**Files:**
- Create: `packages/event-schema/src/contract-testkit/valid-ingestion-samples.ts`
- Create: `packages/event-schema/src/contract-testkit/invalid-ingestion-samples.ts`
- Create: `packages/event-schema/src/contract-testkit/boundary-ingestion-samples.ts`
- Modify: `packages/event-schema/src/contract-testkit/index.ts`

**Interfaces:**
- Consumes: `ingestion-types.ts`（`IngestionBatchRequest`、`IngestionRequestReceipt`、`IngestionEventReceipt`、`IngestionReceiptState`、`IngestionErrorCode`、`BATCH_EVENT_LIMITS`）、`constants.ts`、`event-types.ts`、既有 `field-validation` 无关。
- Produces: `validIngestionBatchRequestSamples`、`invalidIngestionBatchRequestSamples`、`boundaryIngestionBatchRequestSamples`、`validIngestionRequestReceiptSamples`、`invalidIngestionRequestReceiptSamples`、`boundaryIngestionRequestReceiptSamples` 及对应样本类型。

- [ ] **Step 1: 写合法样本**

`packages/event-schema/src/contract-testkit/valid-ingestion-samples.ts`：

```ts
import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import { EventType } from '../event-types.js';
import type { IngestionBatchRequest, IngestionRequestReceipt } from '../ingestion-types.js';
import { IngestionErrorCode, IngestionReceiptState } from '../ingestion-types.js';

export interface ValidIngestionBatchRequestSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: IngestionBatchRequest;
}
export interface ValidIngestionRequestReceiptSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: IngestionRequestReceipt;
}

const singleEvent = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId: 'evt-batch-valid-001',
  eventType: EventType.Error,
  occurredAt: 1_800_000_005_100,
  body: {},
} as const;

export const validIngestionBatchRequestSamples: readonly ValidIngestionBatchRequestSample[] = [
  {
    name: 'minimal batch with one event',
    input: { protocolVersion: CURRENT_PROTOCOL_VERSION, events: [singleEvent] },
    expected: { protocolVersion: CURRENT_PROTOCOL_VERSION, events: [singleEvent] },
  },
  {
    name: 'batch with two events and receivedAt',
    input: {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [singleEvent, { ...singleEvent, eventId: 'evt-batch-valid-002' }],
      receivedAt: 1_800_000_005_200,
    },
    expected: {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [singleEvent, { ...singleEvent, eventId: 'evt-batch-valid-002' }],
      receivedAt: 1_800_000_005_200,
    },
  },
];

export const validIngestionRequestReceiptSamples: readonly ValidIngestionRequestReceiptSample[] = [
  {
    name: 'request receipt with accepted per-event results',
    input: {
      batchState: IngestionReceiptState.Accepted,
      errorCode: IngestionErrorCode.EventAccepted,
      retryable: false,
      perEventResults: [
        {
          eventId: 'evt-batch-valid-001',
          state: IngestionReceiptState.Accepted,
          retryable: false,
        },
      ],
    },
    expected: {
      batchState: IngestionReceiptState.Accepted,
      errorCode: IngestionErrorCode.EventAccepted,
      retryable: false,
      perEventResults: [
        {
          eventId: 'evt-batch-valid-001',
          state: IngestionReceiptState.Accepted,
          retryable: false,
        },
      ],
    },
  },
  {
    name: 'request receipt with temporarily failed and retryAfterMs',
    input: {
      batchState: IngestionReceiptState.TemporarilyFailed,
      errorCode: IngestionErrorCode.RateLimited,
      retryable: true,
      retryAfterMs: 5_000,
      perEventResults: [],
    },
    expected: {
      batchState: IngestionReceiptState.TemporarilyFailed,
      errorCode: IngestionErrorCode.RateLimited,
      retryable: true,
      retryAfterMs: 5_000,
      perEventResults: [],
    },
  },
];
```

- [ ] **Step 2: 写非法样本**

`packages/event-schema/src/contract-testkit/invalid-ingestion-samples.ts`：

```ts
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface InvalidIngestionBatchRequestSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}
export interface InvalidIngestionRequestReceiptSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

export const invalidIngestionBatchRequestSamples: readonly InvalidIngestionBatchRequestSample[] = [
  {
    name: 'unsupported protocol version',
    input: { protocolVersion: 2, events: [] },
    expectedIssueCode: 'unsupported_protocol_version',
  },
  {
    name: 'empty events array',
    input: { protocolVersion: 1, events: [] },
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'events not an array',
    input: { protocolVersion: 1, events: 'not-array' },
    expectedIssueCode: 'invalid_type',
  },
  {
    name: 'event element not a plain envelope',
    input: { protocolVersion: 1, events: [{ protocolVersion: 1 }] },
    expectedIssueCode: 'missing_required_field',
  },
];

export const invalidIngestionRequestReceiptSamples: readonly InvalidIngestionRequestReceiptSample[] = [
  {
    name: 'unknown batch state',
    input: { batchState: 'unknown', retryable: false, perEventResults: [] },
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'retryable not boolean',
    input: { batchState: 'accepted', retryable: 'yes', perEventResults: [] },
    expectedIssueCode: 'invalid_type',
  },
  {
    name: 'negative retryAfterMs',
    input: { batchState: 'temporarily_failed', retryable: true, retryAfterMs: -1, perEventResults: [] },
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'missing perEventResults',
    input: { batchState: 'accepted', retryable: false },
    expectedIssueCode: 'missing_required_field',
  },
];
```

- [ ] **Step 3: 写边界样本**

`packages/event-schema/src/contract-testkit/boundary-ingestion-samples.ts`：

```ts
import type { EventSchemaIssueCode } from '../validation-issues.js';
import type { IngestionBatchRequest, IngestionRequestReceipt } from '../ingestion-types.js';

export interface BoundaryIngestionBatchRequestSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: IngestionBatchRequest;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}
export interface BoundaryIngestionRequestReceiptSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: IngestionRequestReceipt;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

export const boundaryIngestionBatchRequestSamples: readonly BoundaryIngestionBatchRequestSample[] = [
  {
    name: 'empty events array is invalid',
    input: { protocolVersion: 1, events: [] },
    isValid: false,
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'receivedAt of zero is invalid',
    input: {
      protocolVersion: 1,
      events: [],
      receivedAt: 0,
    },
    isValid: false,
    expectedIssueCode: 'invalid_timestamp',
  },
];

export const boundaryIngestionRequestReceiptSamples: readonly BoundaryIngestionRequestReceiptSample[] = [
  {
    name: 'empty perEventResults is valid only when batch-level covers all',
    input: { batchState: 'accepted', retryable: false, perEventResults: [] },
    isValid: true,
    expected: { batchState: 'accepted', retryable: false, perEventResults: [] },
  },
  {
    name: 'retryAfterMs at the maximum is valid',
    input: {
      batchState: 'temporarily_failed',
      retryable: true,
      retryAfterMs: 86_400_000,
      perEventResults: [],
    },
    isValid: true,
    expected: {
      batchState: 'temporarily_failed',
      retryable: true,
      retryAfterMs: 86_400_000,
      perEventResults: [],
    },
  },
];
```

- [ ] **Step 4: 在 `contract-testkit/index.ts` 导出批次样本**

在 `packages/event-schema/src/contract-testkit/index.ts` 追加：

```ts
export {
  boundaryIngestionBatchRequestSamples,
  type BoundaryIngestionBatchRequestSample,
} from './boundary-ingestion-samples.js';
export {
  boundaryIngestionRequestReceiptSamples,
  type BoundaryIngestionRequestReceiptSample,
} from './boundary-ingestion-samples.js';
export {
  invalidIngestionBatchRequestSamples,
  type InvalidIngestionBatchRequestSample,
} from './invalid-ingestion-samples.js';
export {
  invalidIngestionRequestReceiptSamples,
  type InvalidIngestionRequestReceiptSample,
} from './invalid-ingestion-samples.js';
export {
  validIngestionBatchRequestSamples,
  type ValidIngestionBatchRequestSample,
} from './valid-ingestion-samples.js';
export {
  validIngestionRequestReceiptSamples,
  type ValidIngestionRequestReceiptSample,
} from './valid-ingestion-samples.js';
```

- [ ] **Step 5: 确认样本编译**

运行：`pnpm --filter @aurora/event-schema typecheck`。预期 exit 0，样本类型与解析器类型一致。

- [ ] **Step 6: 相关回归**

运行：`pnpm --filter @aurora/event-schema test`。预期 exit 0，既有测试保持通过。

- [ ] **Step 7: 建议提交边界**

Task 4 成果：三个样本文件 + `contract-testkit/index.ts` 导出。

---

### Task 5: 三类消费者契约测试

**Files:**
- Create: `packages/event-schema/test/consumers/sdk-ingestion.contract.test.ts`
- Create: `packages/event-schema/test/consumers/ingestion-ingestion.contract.test.ts`
- Create: `packages/event-schema/test/consumers/processing-ingestion.contract.test.ts`

**Interfaces:**
- Consumes: `@aurora/event-schema` 根入口（`parseIngestionBatchRequest`、`parseIngestionRequestReceipt`）与 `@aurora/event-schema/contract-testkit`（样本）。
- Produces: 三个契约测试文件。

- [ ] **Step 1: 写 SDK 消费者契约测试**

`packages/event-schema/test/consumers/sdk-ingestion.contract.test.ts`：

```ts
import { parseIngestionBatchRequest, parseIngestionRequestReceipt } from '@aurora/event-schema';
import {
  validIngestionBatchRequestSamples,
  validIngestionRequestReceiptSamples,
} from '@aurora/event-schema/contract-testkit';
import { describe, expect, it } from 'vitest';

describe('SDK ingestion contract', () => {
  it('accepts every valid batch request sample', () => {
    for (const sample of validIngestionBatchRequestSamples) {
      const result = parseIngestionBatchRequest(sample.input);
      expect(result.success, sample.name).toBe(true);
    }
  });
  it('accepts every valid request receipt sample', () => {
    for (const sample of validIngestionRequestReceiptSamples) {
      const result = parseIngestionRequestReceipt(sample.input);
      expect(result.success, sample.name).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 写数据接入消费者契约测试**

`packages/event-schema/test/consumers/ingestion-ingestion.contract.test.ts`：

```ts
import { parseIngestionBatchRequest, parseIngestionRequestReceipt } from '@aurora/event-schema';
import {
  invalidIngestionBatchRequestSamples,
  invalidIngestionRequestReceiptSamples,
} from '@aurora/event-schema/contract-testkit';
import { describe, expect, it } from 'vitest';

describe('ingestion ingestion contract', () => {
  it('rejects every invalid batch request sample with the expected code', () => {
    for (const sample of invalidIngestionBatchRequestSamples) {
      const result = parseIngestionBatchRequest(sample.input);
      expect(result.success, sample.name).toBe(false);
      if (result.success) continue;
      expect(
        result.issues.some((issue) => issue.code === sample.expectedIssueCode),
        sample.name,
      ).toBe(true);
    }
  });
  it('rejects every invalid request receipt sample with the expected code', () => {
    for (const sample of invalidIngestionRequestReceiptSamples) {
      const result = parseIngestionRequestReceipt(sample.input);
      expect(result.success, sample.name).toBe(false);
      if (result.success) continue;
      expect(
        result.issues.some((issue) => issue.code === sample.expectedIssueCode),
        sample.name,
      ).toBe(true);
    }
  });
});
```

- [ ] **Step 3: 写数据处理消费者契约测试**

`packages/event-schema/test/consumers/processing-ingestion.contract.test.ts`：

```ts
import { parseIngestionBatchRequest, parseIngestionRequestReceipt } from '@aurora/event-schema';
import {
  boundaryIngestionBatchRequestSamples,
  boundaryIngestionRequestReceiptSamples,
} from '@aurora/event-schema/contract-testkit';
import { describe, expect, it } from 'vitest';

describe('processing ingestion contract', () => {
  it('accepts valid and rejects invalid boundary batch samples', () => {
    for (const sample of boundaryIngestionBatchRequestSamples) {
      const result = parseIngestionBatchRequest(sample.input);
      if (sample.isValid) {
        expect(result.success, sample.name).toBe(true);
      } else {
        expect(result.success, sample.name).toBe(false);
        if (result.success) continue;
        expect(
          result.issues.some((issue) => issue.code === sample.expectedIssueCode),
          sample.name,
        ).toBe(true);
      }
    }
  });
  it('accepts valid and rejects invalid boundary receipt samples', () => {
    for (const sample of boundaryIngestionRequestReceiptSamples) {
      const result = parseIngestionRequestReceipt(sample.input);
      if (sample.isValid) {
        expect(result.success, sample.name).toBe(true);
      } else {
        expect(result.success, sample.name).toBe(false);
        if (result.success) continue;
        expect(
          result.issues.some((issue) => issue.code === sample.expectedIssueCode),
          sample.name,
        ).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 4: 确认三类消费者契约测试通过**

运行：`pnpm --filter @aurora/event-schema exec vitest run test/consumers/sdk-ingestion.contract.test.ts test/consumers/ingestion-ingestion.contract.test.ts test/consumers/processing-ingestion.contract.test.ts`。预期 exit 0，全部通过。

- [ ] **Step 5: 相关回归**

运行：`pnpm --filter @aurora/event-schema test`。预期 exit 0，既有消费者契约（错误/请求/性能）保持通过。

- [ ] **Step 6: 建议提交边界**

Task 5 成果：三个消费者契约测试文件。

---

### Task 6: 包入口、私有路径与架构边界负例

**Files:**
- Modify: `packages/event-schema/test/package-entry.test.ts`
- Modify: `packages/event-schema/test/architecture-boundary.test.ts`

**Interfaces:**
- Consumes: 构建后的 `@aurora/event-schema` 根入口与 `contract-testkit` 入口。
- Produces: 包入口断言扩展、私有路径负例与架构边界负例扩展。

- [ ] **Step 1: 扩展包入口断言**

在 `packages/event-schema/test/package-entry.test.ts` 增加对 `BATCH_EVENT_LIMITS`、`IngestionReceiptState`、`IngestionErrorCode`、`parseIngestionBatchRequest`、`parseIngestionRequestReceipt`、`parseIngestionEventReceipt` 可从构建根入口导入的断言，并断言私有路径 `ingestion-types`、`ingestion-batch-request`、`ingestion-request-receipt` 以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝。

- [ ] **Step 2: 扩展架构边界负例**

在 `packages/event-schema/test/architecture-boundary.test.ts` 增加：新批次源码文件无 DOM/Node/console/消费者/私有跨包引用；`ingestion-*.ts` 不导入 `packages/core`、`packages/browser`、任何插件或数据库包。

- [ ] **Step 3: 确认包入口与架构边界测试通过**

运行：`pnpm --filter @aurora/event-schema test:package` 与 `pnpm --filter @aurora/event-schema exec vitest run test/architecture-boundary.test.ts`。预期 exit 0。

- [ ] **Step 4: 相关回归**

运行：`pnpm check:boundaries` 与 `pnpm --filter @aurora/event-schema test`。预期 exit 0，Workspace Policy 无违规。

- [ ] **Step 5: 建议提交边界**

Task 6 成果：`package-entry.test.ts`、`architecture-boundary.test.ts` 修改。

---

### Task 7: 文档示例、覆盖率与文档同步

**Files:**
- Modify: `packages/event-schema/test/documentation-contract.test.ts`
- Modify: `packages/event-schema/README.md`
- Modify: `docs/protocol/event-envelope-v1.md`（链接批次/接收结果协议）
- Modify: `docs/protocol/ingestion-batch-and-receipt-contract.md`（补 `implementation-status: implemented` 前的文档示例校验标记）
- Modify: `docs/README.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/adr/ADR-005-event-schema-source-of-truth.md`（追加批次/接收结果协议实施证据）
- Modify: `docs/adr/ADR-008-ingestion-durable-buffering.md`（追加后续依赖链第 1 项实施证据）
- Modify: `AGENTS.md`、`AURORA_RULES.md`、根 `README.md`

**Interfaces:**
- Consumes: `documentation-contract.test.ts` 既有提取模式。
- Produces: 文档示例被测试提取并通过解析器验证。

- [ ] **Step 1: 在规格中加入可执行文档示例**

在 `docs/protocol/ingestion-batch-and-receipt-contract.md` 加入 `<!-- contract-example:valid-ingestion-batch -->` 与 `<!-- contract-example:invalid-ingestion-batch -->` 标记包裹的 JSON 示例（最小合法批次与非法批次），并在 `documentation-contract.test.ts` 扩展提取并断言通过 `parseIngestionBatchRequest` 校验。

- [ ] **Step 2: 更新模块 README 与协议文档**

更新 `packages/event-schema/README.md` 与 `docs/protocol/event-envelope-v1.md`，加入批次/接收结果协议链接与语义摘要。

- [ ] **Step 3: 更新正式文档、追踪与 ADR 证据**

按 Global Constraints 与规格 §17 同步 `docs/README.md`、`docs/architecture/formalization-readiness.md`（A1 更新为"加批次/接收结果协议第一增量"）、ADR-005（追加批次单一来源证据）、ADR-008（追加后续依赖链第 1 项证据）、`AGENTS.md`、`AURORA_RULES.md`、根 `README.md`。

- [ ] **Step 4: 确认文档契约与覆盖率**

运行：`pnpm --filter @aurora/event-schema exec vitest run test/documentation-contract.test.ts` 与 `pnpm --filter @aurora/event-schema test:coverage`。预期 exit 0，覆盖率门槛 85/80/85/85 满足。

- [ ] **Step 5: 根级完整质量门禁**

运行：`pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:coverage && pnpm check:boundaries && pnpm build && pnpm check:ci && git diff --check`。预期全部 exit 0。

- [ ] **Step 6: 建议提交边界**

Task 7 成果：文档示例、README、协议文档、正式文档索引、formalization-readiness、ADR-005/008 追加证据、`AGENTS.md`/`AURORA_RULES.md`/根 `README.md` 状态同步。

---

## 完整质量门禁（根级）

实施完成前必须新鲜运行：

1. `pnpm install --frozen-lockfile`
2. `pnpm format:check`
3. `pnpm lint`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm test:coverage`
7. `pnpm check:boundaries`
8. `pnpm build`
9. `pnpm check:ci`
10. `git diff --check`

任何失败都必须停止完成声明并调查，不得伪造通过结果。

## 完成报告要求

实施完成并全部门禁通过后，报告必须包含：完成的 Task、创建和修改的文件、公共 API（`BATCH_EVENT_LIMITS`、`IngestionReceiptState`、`IngestionErrorCode`、三个解析器）、与错误/请求/性能事件契约的边界、批次部分成功/重复/永久拒绝/暂时失败语义、覆盖率、全部质量命令与退出码、与计划的偏差、ADR 状态（ADR-005 保持 in-progress、ADR-008 保持 not-started、其他不变）、Git 状态、建议提交边界，并明确说明未实施 Inbox/数据库/OpenAPI/采样/限流/队列/Worker，未提交或推送。
