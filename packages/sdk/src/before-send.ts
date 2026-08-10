import { isSdkEventDraft, type SdkEventDraft } from './event-draft.js';

export type SdkBeforeSendFunction = (event: Readonly<SdkEventDraft>) => unknown;
export type SdkBeforeSend = SdkBeforeSendFunction | readonly SdkBeforeSendFunction[];

export type SdkBeforeSendCode = 'kept' | 'dropped' | 'invalid_return' | 'callback_threw';

export interface SdkBeforeSendResult {
  readonly code: SdkBeforeSendCode;
  readonly event?: SdkEventDraft;
}

export function isValidBeforeSend(input: unknown): input is SdkBeforeSend {
  if (typeof input === 'function') return true;
  if (Array.isArray(input)) {
    if (input.length === 0) return false;
    return input.every((entry) => typeof entry === 'function');
  }
  return false;
}

function toDraftResult(draft: SdkEventDraft): SdkBeforeSendResult {
  return Object.freeze({ code: 'kept', event: Object.freeze({ eventType: draft.eventType, body: draft.body }) });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  return typeof Reflect.get(value, 'then') === 'function';
}

export function applySdkBeforeSend(draft: SdkEventDraft, beforeSend: SdkBeforeSend): SdkBeforeSendResult {
  if (typeof beforeSend !== 'function' && !Array.isArray(beforeSend)) {
    return toDraftResult(draft);
  }
  const functions: readonly SdkBeforeSendFunction[] =
    typeof beforeSend === 'function' ? [beforeSend] : beforeSend;
  let current: SdkEventDraft = draft;
  for (const fn of functions) {
    let returned: unknown;
    try {
      returned = fn(Object.freeze({ eventType: current.eventType, body: current.body }));
    } catch {
      return Object.freeze({ code: 'callback_threw' });
    }
    if (isThenable(returned)) {
      // The submit path is synchronous and cannot await; swallow any rejection to
      // avoid a host unhandledrejection, and treat the async return as a throw.
      void returned.then(undefined, () => undefined);
      return Object.freeze({ code: 'callback_threw' });
    }
    if (returned === null || returned === undefined) {
      return Object.freeze({ code: 'dropped' });
    }
    if (!isSdkEventDraft(returned)) {
      return Object.freeze({ code: 'invalid_return' });
    }
    current = returned;
  }
  return toDraftResult(current);
}
