import { describe, expect, it } from 'vitest';
import { listServerOperations, parseInput, serializeOutput } from '../../src/server/index.js';
import { PLATFORM_OPERATIONS, type OperationDef } from '../../src/registry/operations.js';

function findOp(operationId: string): OperationDef {
  const op = PLATFORM_OPERATIONS.find((o) => o.operationId === operationId);
  if (!op) throw new Error(`operation not in registry: ${operationId}`);
  return op;
}

const sessionOp = findOp('identityGetSession');

describe('server adapter', () => {
  it('lists the same server operations as the registry', () => {
    expect(listServerOperations).toEqual(PLATFORM_OPERATIONS);
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
});
