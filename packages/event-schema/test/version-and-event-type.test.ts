import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_LIMITS,
  EventType,
  SUPPORTED_PROTOCOL_VERSIONS,
  isEventType,
  isSupportedProtocolVersion,
  negotiateProtocolVersion,
} from '../src/index.js';

describe('protocol version contract', () => {
  it('exposes only protocol version 1', () => {
    expect(CURRENT_PROTOCOL_VERSION).toBe(1);
    expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual([1]);
    expect(isSupportedProtocolVersion(1)).toBe(true);
    expect(isSupportedProtocolVersion(0)).toBe(false);
    expect(isSupportedProtocolVersion(2)).toBe(false);
    expect(isSupportedProtocolVersion('1')).toBe(false);
  });

  it('exposes a public version negotiation entry point', () => {
    expect(negotiateProtocolVersion(1)).toMatchObject({ ok: true, code: 'supported', version: 1 });
    expect(negotiateProtocolVersion(2)).toMatchObject({ ok: false, code: 'unsupported_version' });
  });
});

describe('event type contract', () => {
  it('exposes exactly the four approved event categories', () => {
    expect(EventType).toEqual({
      Error: 'error',
      Request: 'request',
      Performance: 'performance',
      Resource: 'resource',
    });
    for (const eventType of Object.values(EventType)) expect(isEventType(eventType)).toBe(true);
    expect(isEventType('behavior')).toBe(false);
    expect(isEventType('Error')).toBe(false);
    expect(isEventType(1)).toBe(false);
  });

  it('exports every exact validation limit', () => {
    expect(EVENT_SCHEMA_LIMITS).toEqual({
      maxEventIdLength: 128,
      maxStringLength: 4096,
      maxArrayLength: 100,
      maxObjectKeys: 100,
      maxObjectDepth: 8,
      maxIssues: 50,
    });
  });
});
