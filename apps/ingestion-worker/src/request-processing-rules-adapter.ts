import { REQUEST_EVENT_LIMITS } from '@aurora/event-schema';

/** Immutable request classification rules snapshot consumed by the adapter. */
export interface RequestProcessingRules {
  /** Slow-request threshold in milliseconds. PRD 5.1.3 default is 3000; projects may override. */
  readonly slowRequestThresholdMs: number;
  /** Status codes classified as failures (default includes 429 and 500–599). */
  readonly failureStatusCodes: ReadonlySet<number>;
  /** Status codes explicitly classified as slow regardless of duration. */
  readonly slowStatusCodes: ReadonlySet<number>;
  /** Status codes the project explicitly monitors as request problems (default empty). */
  readonly additionalMonitoredStatusCodes: ReadonlySet<number>;
}

/** Stable failure kinds emitted by the adapter factory. */
export type RequestProcessingRulesAdapterErrorKind = 'invalid_rules';

/** Stable error thrown when rules are missing or invalid; never carries rule contents. */
export class RequestProcessingRulesAdapterError extends Error {
  readonly kind: RequestProcessingRulesAdapterErrorKind;

  constructor(kind: RequestProcessingRulesAdapterErrorKind, message: string) {
    super(message);
    this.name = 'RequestProcessingRulesAdapterError';
    this.kind = kind;
  }
}

/** PRD 5.1.2/5.1.3 defaults: slow threshold 3000 ms, failures 429 + 500–599, no extra monitored statuses. */
export const DEFAULT_REQUEST_PROCESSING_RULES: RequestProcessingRules = Object.freeze({
  slowRequestThresholdMs: 3000,
  failureStatusCodes: Object.freeze(new Set([429, 500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541, 542, 543, 544, 545, 546, 547, 548, 549, 550, 551, 552, 553, 554, 555, 556, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 567, 568, 569, 570, 571, 572, 573, 574, 575, 576, 577, 578, 579, 580, 581, 582, 583, 584, 585, 586, 587, 588, 589, 590, 591, 592, 593, 594, 595, 596, 597, 598, 599])),
  slowStatusCodes: Object.freeze(new Set<number>()),
  additionalMonitoredStatusCodes: Object.freeze(new Set<number>()),
});

import { RequestOutcome } from '@aurora/event-schema';
import type {
  RequestEventClassification,
  RequestEventClassificationInput,
} from './request-event-processor.js';

/** Adapter produced by the factory; implements the request processor classification port. */
export interface RequestProcessingRulesAdapter {
  classify(input: RequestEventClassificationInput): Promise<RequestEventClassification>;
}

export interface CreateRequestProcessingRulesAdapterInput {
  /** Immutable rules snapshot; copied and frozen at factory creation. */
  readonly rules: RequestProcessingRules;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidStatusCodeSet(value: unknown): value is ReadonlySet<number> {
  if (!(value instanceof Set)) return false;
  for (const code of value) {
    if (
      typeof code !== 'number' ||
      !Number.isSafeInteger(code) ||
      code < REQUEST_EVENT_LIMITS.minStatusCode ||
      code > REQUEST_EVENT_LIMITS.maxStatusCode
    ) {
      return false;
    }
  }
  return true;
}

function normalizeRules(rules: unknown): RequestProcessingRules {
  if (!isPlainRecord(rules)) {
    throw new RequestProcessingRulesAdapterError('invalid_rules', 'invalid request processing rules');
  }
  const threshold = rules.slowRequestThresholdMs;
  if (typeof threshold !== 'number' || !Number.isSafeInteger(threshold) || threshold <= 0) {
    throw new RequestProcessingRulesAdapterError('invalid_rules', 'invalid request processing rules');
  }
  for (const key of [
    'failureStatusCodes',
    'slowStatusCodes',
    'additionalMonitoredStatusCodes',
  ] as const) {
    if (!isValidStatusCodeSet(rules[key])) {
      throw new RequestProcessingRulesAdapterError('invalid_rules', 'invalid request processing rules');
    }
  }
  return {
    slowRequestThresholdMs: threshold,
    failureStatusCodes: Object.freeze(new Set(rules.failureStatusCodes as ReadonlySet<number>)),
    slowStatusCodes: Object.freeze(new Set(rules.slowStatusCodes as ReadonlySet<number>)),
    additionalMonitoredStatusCodes: Object.freeze(
      new Set(rules.additionalMonitoredStatusCodes as ReadonlySet<number>),
    ),
  };
}

/**
 * Create a deterministic request classification adapter implementing the
 * ClassifyRequestEvent port. The rules snapshot is copied and deeply frozen at
 * creation so a retry/replay using the same adapter sees the same classification.
 * Never reads configuration storage, never touches the database, never logs,
 * never mutates its input, never uses randomness or the clock, and throws a
 * stable RequestProcessingRulesAdapterError for missing/invalid rules.
 */
export function createRequestProcessingRulesAdapter(
  input: CreateRequestProcessingRulesAdapterInput,
): RequestProcessingRulesAdapter {
  if (!isPlainRecord(input) || !('rules' in input)) {
    throw new RequestProcessingRulesAdapterError('invalid_rules', 'invalid request processing rules');
  }
  const frozen = normalizeRules(input.rules);

  const classify = (requestInput: RequestEventClassificationInput): Promise<RequestEventClassification> => {
    const { outcome, statusCode, durationMs } = requestInput;
    const isFailure =
      outcome === RequestOutcome.NetworkError ||
      outcome === RequestOutcome.Timeout ||
      (outcome === RequestOutcome.HttpError &&
        statusCode !== undefined &&
        frozen.failureStatusCodes.has(statusCode));
    const isSlow =
      outcome !== RequestOutcome.Canceled &&
      (durationMs >= frozen.slowRequestThresholdMs ||
        (outcome === RequestOutcome.HttpError &&
          statusCode !== undefined &&
          frozen.slowStatusCodes.has(statusCode)));
    const isAdditionalMonitoredStatus =
      outcome === RequestOutcome.HttpError &&
      statusCode !== undefined &&
      frozen.additionalMonitoredStatusCodes.has(statusCode);
    return Promise.resolve({ isFailure, isSlow, isAdditionalMonitoredStatus });
  };

  return { classify };
}
