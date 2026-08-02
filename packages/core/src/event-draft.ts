import { isEventType, type EventType } from '@aurora/event-schema';

export interface CoreEventDraft {
  readonly eventType: EventType;
  readonly body: unknown;
}

export type CoreEventDraftParseResult =
  { readonly ok: true; readonly draft: CoreEventDraft } | { readonly ok: false };

const eventTypeKey = 'eventType';
const bodyKey = 'body';

function isPlainObject(input: unknown): input is object {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

export function parseCoreEventDraft(input: unknown): CoreEventDraftParseResult {
  try {
    if (!isPlainObject(input)) return { ok: false };
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== 2 ||
      !keys.includes(eventTypeKey) ||
      !keys.includes(bodyKey) ||
      keys.some((key) => typeof key !== 'string')
    )
      return { ok: false };
    const eventType: unknown = Reflect.get(input, eventTypeKey);
    if (!isEventType(eventType)) return { ok: false };
    const body: unknown = Reflect.get(input, bodyKey);
    return { ok: true, draft: Object.freeze({ eventType, body }) };
  } catch {
    return { ok: false };
  }
}
