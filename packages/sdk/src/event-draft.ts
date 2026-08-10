import { isEventType, type EventType } from '@aurora/event-schema';

export interface SdkEventDraft {
  readonly eventType: EventType;
  readonly body: unknown;
}

export function isSdkEventDraft(input: unknown): input is SdkEventDraft {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const eventType: unknown = Reflect.get(input, 'eventType');
  if (!isEventType(eventType)) return false;
  return Object.prototype.hasOwnProperty.call(input, 'body');
}
