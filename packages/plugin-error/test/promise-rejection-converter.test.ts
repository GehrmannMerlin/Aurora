import { BrowserErrorSourceEventType } from '@aurora/browser';
import { ErrorCategory, PromiseRejectionReasonKind } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { convertPromiseRejection } from '../src/promise-rejection-converter.js';

function event(reason: unknown) {
  return { type: BrowserErrorSourceEventType.UnhandledRejection, reason } as const;
}

describe('Promise rejection conversion', () => {
  it('normalizes Error and string reasons', () => {
    expect(convertPromiseRejection(event(new TypeError('Rejected token=private')))).toMatchObject({
      success: true,
      data: {
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.Error,
          error: { name: 'TypeError', message: 'Rejected token=[redacted]' },
        },
      },
    });
    expect(convertPromiseRejection(event('Rejected at https://x.test/a?token=x#f'))).toMatchObject({
      success: true,
      data: {
        reason: {
          kind: PromiseRejectionReasonKind.String,
          value: 'Rejected at https://x.test/a',
        },
      },
    });
  });

  it('delegates finite non-standard values to event-schema and returns a copy', () => {
    const reason = { code: 42, nested: [true, null] };
    const result = convertPromiseRejection(event(reason));
    expect(result).toMatchObject({
      success: true,
      data: {
        reason: {
          kind: PromiseRejectionReasonKind.NonStandard,
          value: { code: 42, nested: [true, null] },
        },
      },
    });
    if (!result.success || result.data.category !== ErrorCategory.UnhandledRejection) {
      throw new Error('conversion must pass');
    }
    const converted = result.data.reason;
    if (converted.kind !== PromiseRejectionReasonKind.NonStandard) {
      throw new Error('non-standard reason required');
    }
    expect(converted.value).not.toBe(reason);
  });

  it('rejects cycles, excessive depth, forbidden fields, and unsupported values', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    let deep: unknown = 'leaf';
    for (let index = 0; index < 10; index += 1) deep = { child: deep };
    for (const reason of [cyclic, deep, { token: 'private' }, undefined, 1n, () => undefined]) {
      expect(convertPromiseRejection(event(reason)).success).toBe(false);
    }
  });

  it('uses a stable fallback for an empty string and leaves input unchanged', () => {
    const reason = Object.freeze({ code: 'stable' });
    expect(convertPromiseRejection(event(''))).toMatchObject({
      success: true,
      data: { reason: { value: 'Unhandled promise rejection' } },
    });
    convertPromiseRejection(event(reason));
    expect(reason).toEqual({ code: 'stable' });
  });
});
