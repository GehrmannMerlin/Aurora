import { enum_, obj, optional, str } from './schema.js';
import type { SchemaDef } from './schema.js';
import { OperationId } from './identifiers.js';
import { utcTimestamp } from './time.js';

export const operationStatus = enum_([
  'processing',
  'succeeded',
  'failed',
  'expired',
  'unavailable',
]);

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- <T> is part of the approved contract surface; SchemaDef erases it, so it is only pinned here
export function operationReference<T>(resultTarget?: SchemaDef): SchemaDef {
  void (0 as unknown as T);
  return obj({
    operationId: OperationId,
    status: enum_(['processing']),
    submittedAt: utcTimestamp,
    nextPollAfter: optional(utcTimestamp),
    resultTarget: optional(resultTarget ?? str(1, 128)),
  });
}
