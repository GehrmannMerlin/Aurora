import { validEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';
import { EventType } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';

describe('AuroraCore event entry', () => {
  it('accepts a current EventEnvelope only while started', async () => {
    const core = createCore();
    const envelope = validEventEnvelopeSamples[0];
    expect(envelope).toBeDefined();
    expect(core.submitEvent(envelope)).toMatchObject({
      ok: false,
      code: 'not_started',
      state: 'created',
      diagnosticsAdded: 1,
    });
    await core.initialize();
    expect(core.submitEvent(envelope)).toMatchObject({ ok: false, code: 'not_started' });
    await core.start();
    expect(core.submitEvent(envelope)).toMatchObject({
      ok: true,
      code: 'accepted',
      state: 'started',
      diagnosticsAdded: 0,
    });
  });

  it('returns event-schema issues for invalid and unsupported input', async () => {
    const core = createCore();
    await core.initialize();
    await core.start();
    const invalid = core.submitEvent({ protocolVersion: 2 });
    expect(invalid).toMatchObject({ ok: false, code: 'invalid_event', diagnosticsAdded: 1 });
    if (invalid.code !== 'invalid_event') throw new Error('expected invalid_event');
    expect(invalid.issues.map(({ code }) => code)).toContain('unsupported_protocol_version');
    expect(Object.isFrozen(invalid.issues)).toBe(true);
  });

  it('does not mutate a valid protocol object', async () => {
    const core = createCore();
    await core.initialize();
    await core.start();
    const envelope = {
      protocolVersion: 1,
      eventId: 'event-non-mutation',
      eventType: 'error',
      occurredAt: 1,
      body: { message: 'safe summary' },
    };
    const before = JSON.stringify(envelope);
    expect(core.submitEvent(envelope).code).toBe('accepted');
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('rejects events after stop and destroy', async () => {
    const core = createCore();
    const envelope = validEventEnvelopeSamples[0];
    await core.initialize();
    await core.start();
    await core.stop();
    expect(core.submitEvent(envelope)).toMatchObject({ ok: false, code: 'not_started' });
    await core.destroy();
    expect(core.submitEvent(envelope)).toMatchObject({
      ok: false,
      code: 'destroyed',
      state: 'destroyed',
    });
  });

  it('contains an unexpected parser exception from a hostile proxy', async () => {
    const core = createCore();
    await core.initialize();
    await core.start();
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf(): never {
          throw new Error('event-body-secret');
        },
      },
    );
    expect(() => core.submitEvent(hostile)).not.toThrow();
    expect(core.submitEvent(hostile)).toEqual({
      ok: false,
      code: 'internal_error',
      state: 'started',
      diagnosticsAdded: 1,
    });
    expect(JSON.stringify(core.getDiagnostics())).not.toContain('event-body-secret');
  });

  it('does not expose retention or delivery behavior through acceptance', async () => {
    const core = createCore();
    await core.initialize();
    await core.start();
    expect(core.submitEvent(validEventEnvelopeSamples[0])).toMatchObject({ code: 'accepted' });
    expect(Object.keys(core).sort()).toEqual([
      'destroy',
      'getConfig',
      'getDiagnostics',
      'getState',
      'initialize',
      'registerPlugin',
      'start',
      'stop',
      'submitEvent',
      'submitEventDraft',
      'updateConfig',
    ]);
  });
});

describe('AuroraCore draft submission', () => {
  it('creates and submits a draft while preserving the low-level envelope entry', async () => {
    const core = createCore({
      eventIdProvider: { createEventId: () => 'public-event' },
      eventTimeProvider: { now: () => 1_800_000_000_000 },
    });
    await core.initialize();
    await core.start();
    expect(core.submitEventDraft({ eventType: EventType.Error, body: {} })).toMatchObject({
      ok: true,
      code: 'accepted',
      state: 'started',
      diagnosticsAdded: 0,
    });
    expect(core.submitEvent(validEventEnvelopeSamples[0])).toMatchObject({ code: 'accepted' });
  });

  it('exposes the created envelope with a stable eventId on accepted draft submission', async () => {
    const core = createCore({
      eventIdProvider: { createEventId: () => 'evt-0001' },
      eventTimeProvider: { now: () => 1_800_000_000_000 },
    });
    await core.initialize();
    await core.start();
    const result = core.submitEventDraft({ eventType: EventType.Error, body: { message: 'x' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event?.eventId).toBe('evt-0001');
    expect(result.event?.eventType).toBe(EventType.Error);
    expect(result.event?.protocolVersion).toBe(1);
    expect(result.event?.occurredAt).toBe(1_800_000_000_000);
    expect(result.event?.body).toEqual({ message: 'x' });
  });

  it.each([
    { eventType: EventType.Error },
    { eventType: EventType.Error, body: {}, eventId: 'forged' },
    { eventType: EventType.Error, body: {}, occurredAt: 1 },
    { eventType: EventType.Error, body: {}, protocolVersion: 1 },
  ])('rejects invalid or system-field draft %#', async (input) => {
    const core = createCore({
      eventIdProvider: { createEventId: () => 'unused' },
      eventTimeProvider: { now: () => 1 },
    });
    await core.initialize();
    await core.start();
    expect(core.submitEventDraft(input)).toEqual({
      ok: false,
      code: 'invalid_event_draft',
      state: 'started',
      diagnosticsAdded: 1,
    });
  });

  it('maps Provider throws without leaking or blocking the next submit', async () => {
    let calls = 0;
    const core = createCore({
      eventIdProvider: {
        createEventId: (): string => {
          calls += 1;
          if (calls === 1) throw new Error('authorization=secret');
          return 'recovered-event';
        },
      },
      eventTimeProvider: { now: () => 1 },
    });
    await core.initialize();
    await core.start();
    expect(core.submitEventDraft({ eventType: EventType.Error, body: {} })).toMatchObject({
      ok: false,
      code: 'event_creation_failed',
    });
    expect(core.submitEventDraft({ eventType: EventType.Error, body: {} })).toMatchObject({
      ok: true,
      code: 'accepted',
    });
    expect(JSON.stringify(core.getDiagnostics())).not.toContain('secret');
  });
});

describe('AuroraCore draft lifecycle and isolation', () => {
  it('never calls Providers outside started and rejects after destroy', async () => {
    let idCalls = 0;
    let timeCalls = 0;
    const core = createCore({
      eventIdProvider: {
        createEventId: (): string => {
          idCalls += 1;
          return `event-${String(idCalls)}`;
        },
      },
      eventTimeProvider: {
        now: (): number => {
          timeCalls += 1;
          return timeCalls;
        },
      },
    });
    const draft = { eventType: EventType.Error, body: {} };
    expect(core.submitEventDraft(draft).code).toBe('not_started');
    await core.initialize();
    expect(core.submitEventDraft(draft).code).toBe('not_started');
    await core.start();
    expect(core.submitEventDraft(draft).code).toBe('accepted');
    await core.stop();
    expect(core.submitEventDraft(draft).code).toBe('not_started');
    await core.destroy();
    expect(core.submitEventDraft(draft).code).toBe('destroyed');
    expect({ idCalls, timeCalls }).toEqual({ idCalls: 1, timeCalls: 1 });
  });

  it('treats repeat and concurrent calls as distinct events', async () => {
    let next = 0;
    const core = createCore({
      eventIdProvider: { createEventId: () => `event-${String(++next)}` },
      eventTimeProvider: { now: () => next },
    });
    await core.initialize();
    await core.start();
    const draft = { eventType: EventType.Error, body: {} };
    const results = await Promise.all([
      Promise.resolve(core.submitEventDraft(draft)),
      Promise.resolve(core.submitEventDraft(draft)),
      Promise.resolve(core.submitEventDraft(draft)),
    ]);
    expect(results.every(({ code }) => code === 'accepted')).toBe(true);
    expect(next).toBe(3);
  });

  it('rejects invalid body values with event-schema issues', async () => {
    const core = createCore({
      eventIdProvider: { createEventId: () => 'body-test' },
      eventTimeProvider: { now: () => 1 },
    });
    await core.initialize();
    await core.start();
    for (const body of [undefined, () => undefined, NaN, Symbol('s')]) {
      const result = core.submitEventDraft({ eventType: EventType.Error, body });
      expect(result).toMatchObject({ ok: false, code: 'invalid_event' });
    }
  });

  it('does not mutate a frozen nested body across submission', async () => {
    const core = createCore({
      eventIdProvider: { createEventId: () => 'immutable-test' },
      eventTimeProvider: { now: () => 1 },
    });
    await core.initialize();
    await core.start();
    const body = Object.freeze({ nested: Object.freeze(['a', 'b']) });
    const before = JSON.stringify(body);
    expect(core.submitEventDraft({ eventType: EventType.Error, body }).code).toBe('accepted');
    expect(JSON.stringify(body)).toBe(before);
  });
});
