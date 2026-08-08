import type { z } from 'zod';
import type { OperationDef } from '../registry/operations.js';
import { auroraProblem } from '../common/problem-details.js';
import type { OperationRequest, OperationResult } from './types.js';

export class ClientInputError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];
  constructor(message: string, issues: readonly z.core.$ZodIssue[]) {
    super(message);
    this.name = 'ClientInputError';
    this.issues = issues;
  }
}

export function buildRequest(
  op: OperationDef,
  input: { query?: unknown; body?: unknown },
): OperationRequest {
  if (op.request?.query) {
    const r = op.request.query.zod.safeParse(input.query ?? {});
    if (!r.success)
      throw new ClientInputError(`invalid query for ${op.operationId}`, r.error.issues);
  } else if (
    input.query !== undefined &&
    input.query !== null &&
    typeof input.query === 'object' &&
    !Array.isArray(input.query) &&
    Object.keys(input.query).length > 0
  ) {
    throw new ClientInputError(`operation ${op.operationId} accepts no query parameters`, []);
  }
  if (op.request?.body) {
    const r = op.request.body.zod.safeParse(input.body);
    if (!r.success)
      throw new ClientInputError(`invalid body for ${op.operationId}`, r.error.issues);
  } else if (input.body !== undefined) {
    throw new ClientInputError(`operation ${op.operationId} accepts no request body`, []);
  }
  return {
    operationId: op.operationId,
    method: op.method,
    path: op.path,
    body: input.body,
    query: input.query,
  };
}

export function parseResponse(op: OperationDef, raw: unknown, status: number): OperationResult {
  if (status >= 200 && status < 300) {
    const schema = op.responses[200];
    if (!schema)
      return { ok: false, operationId: op.operationId, status, problem: { code: 'processing' } };
    const r = schema.zod.safeParse(raw);
    if (!r.success)
      return {
        ok: false,
        operationId: op.operationId,
        status,
        problem: { code: 'structural_error' },
      };
    return { ok: true, operationId: op.operationId, status, data: r.data };
  }
  const problem = auroraProblem.zod.safeParse(raw);
  return problem.success
    ? { ok: false, operationId: op.operationId, status, problem: problem.data }
    : { ok: false, operationId: op.operationId, status, problem: { code: 'structural_error' } };
}
