import { describe, expect, it } from 'vitest';
import { listServerOperations, parseInput, serializeOutput } from '../../src/server/index.js';
import { PLATFORM_OPERATIONS, type OperationDef } from '../../src/registry/operations.js';
import { num, obj, str } from '../../src/common/schema.js';

function findOp(operationId: string): OperationDef {
  const op = PLATFORM_OPERATIONS.find((o) => o.operationId === operationId);
  if (!op) throw new Error(`operation not in registry: ${operationId}`);
  return op;
}

const sessionOp = findOp('identityGetSession');

// Synthetic registry-shaped operations that declare a query/body schema, so the declared-schema
// validation branches of parseInput can be exercised (no stable op declares one today).
const opWithQuery: OperationDef = {
  ...sessionOp,
  operationId: 'testOpWithQuery',
  request: { query: obj({ page: num(1, 100) }) },
};

const opWithBody: OperationDef = {
  ...sessionOp,
  operationId: 'testOpWithBody',
  request: { body: obj({ name: str(1, 10) }) },
};

describe('server adapter', () => {
  it('lists the same server operations as the registry', () => {
    expect(listServerOperations()).toEqual(PLATFORM_OPERATIONS);
  });

  it('accepts a valid empty input for a GET session op', () => {
    const res = parseInput(sessionOp, {});
    expect(res.ok).toBe(true);
  });

  it('rejects unknown query params safely', () => {
    const res = parseInput(sessionOp, { query: { bogus: 1 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.problem as { code: string }).code).toBe('structural_error');
  });

  it('fails closed on an undeclared request body', () => {
    const res = parseInput(sessionOp, { body: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.problem as { code: string }).code).toBe('structural_error');
  });

  it('accepts a valid query when the operation declares a query schema', () => {
    const res = parseInput(opWithQuery, { query: { page: 2 } });
    expect(res.ok).toBe(true);
  });

  it('fails closed on an invalid query against a declared query schema', () => {
    const res = parseInput(opWithQuery, { query: { page: 0 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.problem as { code: string }).code).toBe('structural_error');
  });

  it('accepts a valid body when the operation declares a body schema', () => {
    const res = parseInput(opWithBody, { body: { name: 'x' } });
    expect(res.ok).toBe(true);
  });

  it('fails closed on an invalid body against a declared body schema', () => {
    const res = parseInput(opWithBody, { body: { name: '' } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.problem as { code: string }).code).toBe('structural_error');
  });

  it('passes through non-plain-object query values (fail-closed only for real objects)', () => {
    for (const q of [5, [], null, {}]) {
      const res = parseInput(sessionOp, { query: q });
      expect(res.ok, `query ${JSON.stringify(q)}`).toBe(true);
    }
  });

  it('serializes a valid 200 response', () => {
    const body = {
      account: { accountId: 'acct_1', email: 'a@b.c', verified: true },
      authentication: 'authenticated',
      session: { expiresAt: '2026-08-08T01:00:00.000Z' },
      csrf: 'tok',
      navigation: [],
    };
    const res = serializeOutput(sessionOp, 200, body);
    expect(res.ok).toBe(true);
  });

  it('fails closed on serialization defect', () => {
    const res = serializeOutput(sessionOp, 200, { nope: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.problem as { code: string }).code).toBe('structural_error');
  });

  it('fails closed when no schema is registered for the response status', () => {
    const res = serializeOutput(sessionOp, 404, { nope: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect((res.problem as { code: string }).code).toBe('structural_error');
  });
});
