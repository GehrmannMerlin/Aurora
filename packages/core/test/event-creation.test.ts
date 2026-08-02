import { CURRENT_PROTOCOL_VERSION } from '@aurora/event-schema';
import { EventType } from '@aurora/event-schema';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  CoreEventDraft,
  CoreEventDraftResult,
  CoreEventIdProvider,
  CoreEventProviders,
  CoreEventTimeProvider,
  createCore,
} from '../src/index.js';
import { parseCoreEventDraft } from '../src/event-draft.js';

describe('Core event draft contract', () => {
  it('publishes exact draft and Provider types', () => {
    expectTypeOf<CoreEventDraft>().toEqualTypeOf<{
      readonly eventType: 'error' | 'request' | 'performance' | 'resource';
      readonly body: unknown;
    }>();
    expectTypeOf<CoreEventIdProvider['createEventId']>().returns.toEqualTypeOf<string>();
    expectTypeOf<CoreEventTimeProvider['now']>().returns.toEqualTypeOf<number>();
    expectTypeOf<CoreEventProviders>().toMatchObjectType<{
      readonly eventIdProvider?: CoreEventIdProvider;
      readonly eventTimeProvider?: CoreEventTimeProvider;
    }>();
    expectTypeOf<
      ReturnType<ReturnType<typeof createCore>['submitEventDraft']>
    >().toEqualTypeOf<CoreEventDraftResult>();
  });

  it('accepts exactly eventType and body without retaining the wrapper', () => {
    const body = { message: 'safe' };
    const input = { eventType: EventType.Error, body };
    const parsed = parseCoreEventDraft(input);
    expect(parsed).toEqual({ ok: true, draft: { eventType: EventType.Error, body } });
    expect(parsed.ok && parsed.draft).not.toBe(input);
  });

  it.each([
    null,
    [],
    {},
    { eventType: EventType.Error },
    { body: {} },
    { eventType: 'ERROR', body: {} },
    { eventType: EventType.Error, body: {}, eventId: 'forged' },
    { eventType: EventType.Error, body: {}, occurredAt: 1 },
    { eventType: EventType.Error, body: {}, protocolVersion: 1 },
    { eventType: EventType.Error, body: {}, [Symbol('extra')]: true },
  ])('rejects expanded or invalid runtime draft %#', (input) => {
    expect(parseCoreEventDraft(input)).toEqual({ ok: false });
  });

  it('contains hostile reflection without reading its exception text', () => {
    const input = new Proxy(
      {},
      {
        ownKeys: (): never => {
          throw new Error('token=hidden');
        },
      },
    );
    expect(() => parseCoreEventDraft(input)).not.toThrow();
    expect(parseCoreEventDraft(input)).toEqual({ ok: false });
  });
});

import { createCoreEventEnvelope } from '../src/event-creation.js';

describe('Core EventEnvelope creation', () => {
  it('fills the one protocol version, ID, time, event type, and body', () => {
    const body = Object.freeze({ message: 'safe' });
    const result = createCoreEventEnvelope(
      { eventType: EventType.Error, body },
      { createEventId: () => 'event-0001', now: () => 1_800_000_000_000 },
    );
    expect(result).toEqual({
      ok: true,
      event: {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        eventId: 'event-0001',
        eventType: EventType.Error,
        occurredAt: 1_800_000_000_000,
        body,
      },
    });
  });

  it.each([
    [{ eventType: EventType.Error }, 'invalid_event_draft'],
    [{ eventType: EventType.Error, body: {}, eventId: 'forged' }, 'invalid_event_draft'],
  ] as const)('rejects invalid draft %#', (input, code) => {
    expect(
      createCoreEventEnvelope(input, {
        createEventId: () => 'unused',
        now: () => 1,
      }),
    ).toEqual({ ok: false, code });
  });

  it('does not call time after the ID Provider throws', () => {
    let timeCalls = 0;
    expect(
      createCoreEventEnvelope(
        { eventType: EventType.Error, body: {} },
        {
          createEventId: (): never => {
            throw new Error('secret');
          },
          now: (): number => {
            timeCalls += 1;
            return 1;
          },
        },
      ),
    ).toEqual({ ok: false, code: 'event_id_provider_failed' });
    expect(timeCalls).toBe(0);
  });

  it('returns distinct time-provider failure', () => {
    expect(
      createCoreEventEnvelope(
        { eventType: EventType.Error, body: {} },
        {
          createEventId: () => 'event-0002',
          now: (): never => {
            throw new Error('private');
          },
        },
      ),
    ).toEqual({ ok: false, code: 'event_time_provider_failed' });
  });

  it.each([
    ['', 1, 'eventId'],
    ['x'.repeat(129), 1, 'eventId'],
    ['event-0003', 0, 'occurredAt'],
    ['event-0003', Number.NaN, 'occurredAt'],
  ] as const)('returns event-schema issues for invalid generated values', (eventId, time, path) => {
    const result = createCoreEventEnvelope(
      { eventType: EventType.Error, body: {} },
      { createEventId: () => eventId, now: () => time },
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid_event' });
    if (result.ok || result.code !== 'invalid_event') throw new Error('expected invalid_event');
    expect(result.issues.some((issue) => issue.path[0] === path)).toBe(true);
  });

  it('leaves the draft and body byte-for-byte unchanged', () => {
    const input = { eventType: EventType.Error, body: { nested: ['value'] } };
    const before = JSON.stringify(input);
    createCoreEventEnvelope(input, { createEventId: () => 'event-0004', now: () => 2 });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('contains parser-time hostile body access', () => {
    const body = new Proxy(
      {},
      {
        ownKeys: (): never => {
          throw new Error('body-secret');
        },
      },
    );
    expect(
      createCoreEventEnvelope(
        { eventType: EventType.Error, body },
        { createEventId: () => 'event-0005', now: () => 3 },
      ),
    ).toEqual({ ok: false, code: 'internal_error' });
  });
});
