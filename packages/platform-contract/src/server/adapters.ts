import type { OperationDef } from '../registry/operations.js';
import { auroraProblem } from '../common/problem-details.js';

interface SafeProblem {
  readonly code: string;
  readonly title: string;
  readonly detail: string;
}

const structuralError: SafeProblem = {
  code: 'structural_error',
  title: 'Invalid request',
  detail: 'Request does not match the public contract.',
};

// Shape-safe guard: only a non-empty plain object counts as an undeclared payload. Primitives,
// arrays, null and empty objects pass through so the absence of a declared schema is not turned
// into a native TypeError for unrelated input shapes.
function isNonEmptyPlainObject(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

export function parseInput(
  op: OperationDef,
  raw: { params?: unknown; query?: unknown; body?: unknown },
):
  | { ok: true; data: { params?: unknown; query?: unknown; body?: unknown } }
  | { ok: false; problem: SafeProblem } {
  if (op.request?.query) {
    const r = op.request.query.zod.safeParse(raw.query ?? {});
    if (!r.success) return { ok: false, problem: structuralError };
  } else if (isNonEmptyPlainObject(raw.query)) {
    // Fail closed: the operation declares no query schema, so any non-empty query object is a
    // structural mismatch rather than being silently accepted.
    return { ok: false, problem: structuralError };
  }
  if (op.request?.body) {
    const r = op.request.body.zod.safeParse(raw.body);
    if (!r.success) return { ok: false, problem: structuralError };
  } else if (raw.body !== undefined) {
    // Fail closed: the operation declares no request body, so any present body is a structural
    // mismatch rather than being silently accepted.
    return { ok: false, problem: structuralError };
  }
  return { ok: true, data: raw };
}

export function serializeOutput(
  op: OperationDef,
  status: number,
  data: unknown,
): { ok: true; status: number; body: unknown } | { ok: false; problem: SafeProblem } {
  const schema = op.responses[status];
  if (!schema) return { ok: false, problem: structuralError };
  const r = schema.zod.safeParse(data);
  if (!r.success) return { ok: false, problem: structuralError };
  return { ok: true, status, body: r.data };
}

export const problemSchema = auroraProblem;
