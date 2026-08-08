import { describe, expect, it } from 'vitest';
import { buildRequest, parseResponse, ClientInputError } from '../../src/client/index.js';
import { PLATFORM_OPERATIONS, type OperationDef } from '../../src/registry/operations.js';

function findOp(operationId: string): OperationDef {
  const op = PLATFORM_OPERATIONS.find((o) => o.operationId === operationId);
  if (!op) throw new Error(`operation not in registry: ${operationId}`);
  return op;
}

const sessionOp = findOp('identityGetSession');

describe('generated client', () => {
  it('builds a request for identityGetSession', () => {
    const req = buildRequest(sessionOp, {});
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/api/platform/v1/session');
  });

  it('rejects an invalid response body', () => {
    const res = parseResponse(sessionOp, { account: {} }, 200);
    expect(res.ok).toBe(false);
  });

  it('accepts a valid session response', () => {
    const body = {
      account: { accountId: 'acct_1', email: 'a@b.c', verified: true },
      authentication: 'authenticated',
      session: { expiresAt: '2026-08-08T01:00:00.000Z' },
      csrf: 'tok',
      navigation: [],
    };
    const res = parseResponse(sessionOp, body, 200);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(body);
  });

  it('throws ClientInputError on invalid input', () => {
    const navOp = findOp('navigationGetContext');
    expect(() => buildRequest(navOp, { query: { bogus: 1 } })).toThrow(ClientInputError);
  });

  it('fails closed on an undeclared request body', () => {
    expect(() => buildRequest(sessionOp, { body: {} })).toThrow(ClientInputError);
  });

  it('returns ok:false for non-2xx and schema-mismatched responses', () => {
    const problemRes = parseResponse(
      sessionOp,
      {
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'x',
        code: 'authentication',
        requestId: 'r_1',
      },
      401,
    );
    expect(problemRes.ok).toBe(false);
    if (!problemRes.ok)
      expect(problemRes.problem).toMatchObject({ code: 'authentication', status: 401 });

    const mismatchRes = parseResponse(sessionOp, { status: 'processing' }, 200);
    expect(mismatchRes.ok).toBe(false);
    if (!mismatchRes.ok) expect(mismatchRes.problem).toEqual({ code: 'structural_error' });
  });
});
