export const EventType = {
  Error: 'error',
  Request: 'request',
  Performance: 'performance',
  Resource: 'resource',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

const eventTypes: ReadonlySet<unknown> = new Set(Object.values(EventType));

export function isEventType(input: unknown): input is EventType {
  return eventTypes.has(input);
}
