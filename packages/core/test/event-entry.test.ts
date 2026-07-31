import { validEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';
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
    expect(core.submitEvent(envelope)).toEqual({
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
      'updateConfig',
    ]);
  });
});
