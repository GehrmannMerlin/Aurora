import { arr, num, obj, optional, str, nullable } from './schema.js';
import { utcTimestamp } from './time.js';

// Informational closed set of stable AuroraProblem category codes. `auroraProblem.code`
// intentionally stays an open string so new codes can be added within a major version.
export const PROBLEM_CATEGORY_CODES = [
  'structural_error',
  'authentication',
  'authorization',
  'not_found',
  'field_validation',
  'business_validation',
  'idempotency_conflict',
  'version_conflict',
  'state_machine_conflict',
  'rate_limited',
  'processing',
  'downstream_partial_failure',
  'authority_unavailable',
] as const;
export type ProblemCategoryCode = (typeof PROBLEM_CATEGORY_CODES)[number];

const fieldError = obj({ field: str(1, 128), reason: str(1, 256) });

export const auroraProblem = obj({
  type: str(1, 256),
  title: str(1, 128),
  status: num(400, 599),
  detail: str(1, 1024),
  instance: optional(str(1, 128)),
  code: str(1, 64),
  requestId: str(1, 64),
  fieldErrors: optional(arr(fieldError, 0, 50)),
  retryAfter: optional(num(0)),
  resendAvailableAt: optional(utcTimestamp),
  currentVersion: optional(str(1, 64)),
  operationId: optional(str(1, 64)),
  recoveryTarget: optional(nullable(str(1, 128))),
});
