import { ErrorCategory, parseErrorEventBody, type ErrorEventBody } from '@aurora/event-schema';

export type VueErrorDraftFailureReason = 'no_error' | 'schema_rejected';

export type VueErrorDraftResult =
  | { readonly ok: true; readonly body: ErrorEventBody }
  | { readonly ok: false; readonly reason: VueErrorDraftFailureReason };

const UNKNOWN_ERROR_MESSAGE = 'Unknown Vue error';

function readSafeString(value: Record<string, unknown>, key: string): string | undefined {
  try {
    const raw = value[key];
    return typeof raw === 'string' ? raw : undefined;
  } catch {
    return undefined;
  }
}

function readErrorDescriptor(
  err: unknown,
): { readonly name?: string; readonly message: string; readonly stack?: string } | null {
  if (typeof err === 'string') {
    return { message: err === '' ? UNKNOWN_ERROR_MESSAGE : err };
  }
  if (err === null || typeof err !== 'object') return null;
  const record = err as Record<string, unknown>;
  const name = readSafeString(record, 'name');
  const message = readSafeString(record, 'message');
  const stack = readSafeString(record, 'stack');
  return {
    ...(name === undefined ? {} : { name }),
    message: message === undefined ? UNKNOWN_ERROR_MESSAGE : message,
    ...(stack === undefined ? {} : { stack }),
  };
}

export function buildVueErrorDraft(err: unknown): VueErrorDraftResult {
  const descriptor = readErrorDescriptor(err);
  if (descriptor === null) return { ok: false, reason: 'no_error' };
  const parsed = parseErrorEventBody({
    category: ErrorCategory.JavaScript,
    error: descriptor,
  });
  if (!parsed.success) return { ok: false, reason: 'schema_rejected' };
  return { ok: true, body: parsed.data };
}
