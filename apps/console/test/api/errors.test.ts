import { describe, expect, it } from 'vitest';
import { ApiError, normalizeProblem } from '../../src/api/errors.js';

describe('normalizeProblem', () => {
  it('maps a known problem code onto an ApiError with request metadata', () => {
    const error = normalizeProblem(
      {
        type: 'about:blank',
        title: 'Limited',
        status: 429,
        detail: 'slow down',
        code: 'rate_limited',
        requestId: 'req_test_2',
        retryAfter: 12,
      },
      429,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('rate_limited');
    expect(error.status).toBe(429);
    expect(error.requestId).toBe('req_test_2');
    expect(error.retryAfter).toBe(12);
  });

  it('maps an unknown problem code to structural_error', () => {
    const error = normalizeProblem(
      {
        type: 'about:blank',
        title: 'Unexpected',
        status: 400,
        detail: 'x',
        code: 'made_up_code',
        requestId: 'req_test_3',
      },
      400,
    );
    expect(error.code).toBe('structural_error');
    expect(error.message).toBe('Response does not match the public contract.');
    expect(error.status).toBe(400);
  });

  it('maps a non-problem response to structural_error', () => {
    const error = normalizeProblem({ hello: 'world' }, 502);
    expect(error.code).toBe('structural_error');
    expect(error.status).toBe(502);
  });
});
