import { describe, expect, it } from 'vitest';
import { applySdkBeforeSend, type SdkEventDraft } from '../src/index.js';

const DRAFT: SdkEventDraft = Object.freeze({ eventType: 'error', body: { message: 'x' } });

describe('applySdkBeforeSend', () => {
  it('keeps the original draft when beforeSend is absent', () => {
    const result = applySdkBeforeSend(DRAFT, null as never);
    expect(result.code).toBe('kept');
  });

  it('keeps a valid returned draft and allows field modification', () => {
    const result = applySdkBeforeSend(DRAFT, (event) => ({ ...event, body: { message: 'y' } }));
    expect(result.code).toBe('kept');
    if (result.code === 'kept') expect(result.event?.body).toEqual({ message: 'y' });
  });

  it('drops on null or undefined return', () => {
    expect(applySdkBeforeSend(DRAFT, () => null).code).toBe('dropped');
    expect(applySdkBeforeSend(DRAFT, () => undefined).code).toBe('dropped');
  });

  it('rejects an invalid return shape', () => {
    expect(applySdkBeforeSend(DRAFT, () => 42).code).toBe('invalid_return');
    expect(applySdkBeforeSend(DRAFT, () => ({ eventType: 'nope', body: {} })).code).toBe('invalid_return');
    expect(applySdkBeforeSend(DRAFT, () => ({ body: {} })).code).toBe('invalid_return');
  });

  it('isolates callback exceptions and never propagates them', () => {
    const throwing = (): never => {
      throw new Error('boom');
    };
    const result = applySdkBeforeSend(DRAFT, throwing);
    expect(result.code).toBe('callback_threw');
  });

  it('treats a thenable return as a throw and swallows its rejection', async () => {
    const asyncFn = (): Promise<SdkEventDraft> => Promise.resolve(DRAFT);
    const result = applySdkBeforeSend(DRAFT, asyncFn);
    expect(result.code).toBe('callback_threw');
  });

  it('runs multiple callbacks in order and stops on drop', () => {
    const order: string[] = [];
    const result = applySdkBeforeSend(DRAFT, [
      (event) => {
        order.push('first');
        return event;
      },
      () => {
        order.push('second');
        return null;
      },
      () => {
        order.push('third');
        return DRAFT;
      },
    ]);
    expect(result.code).toBe('dropped');
    expect(order).toEqual(['first', 'second']);
  });

  it('does not mutate the input draft', () => {
    const result = applySdkBeforeSend(DRAFT, () => DRAFT);
    expect(result.code).toBe('kept');
    expect(DRAFT.body).toEqual({ message: 'x' });
  });
});
