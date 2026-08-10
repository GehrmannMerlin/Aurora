import { describe, expect, it } from 'vitest';
import { createSdkActivityTrail } from '../src/index.js';

const OCCURRED_AT = 1;

describe('createSdkActivityTrail', () => {
  it('defaults capacity to 30 and records a safe page_enter entry', () => {
    const trail = createSdkActivityTrail();
    expect(trail.capacity).toBe(30);
    const result = trail.record({ kind: 'page_enter', occurredAt: OCCURRED_AT, origin: 'https://shop.example.com', pathname: '/' });
    expect(result).toEqual({ ok: true, code: 'recorded', sequence: 1, droppedOldest: 0 });
    expect(trail.entries).toHaveLength(1);
    expect(trail.entries[0]).toMatchObject({ kind: 'page_enter', origin: 'https://shop.example.com', sequence: 1 });
  });

  it('drops the oldest entry when at capacity', () => {
    const trail = createSdkActivityTrail({ capacity: 2 });
    trail.record({ kind: 'sdk_report', occurredAt: OCCURRED_AT, action: 'a' });
    trail.record({ kind: 'sdk_report', occurredAt: OCCURRED_AT, action: 'b' });
    const third = trail.record({ kind: 'sdk_report', occurredAt: OCCURRED_AT, action: 'c' });
    expect(third).toEqual({ ok: true, code: 'recorded', sequence: 3, droppedOldest: 1 });
    expect(trail.entries.map((e) => e.sequence)).toEqual([2, 3]);
  });

  it('rejects invalid entries without consuming a sequence', () => {
    const trail = createSdkActivityTrail();
    const badKind = trail.record({ kind: 'nope', occurredAt: OCCURRED_AT });
    expect(badKind.code).toBe('invalid_entry');
    const extraField = trail.record({ kind: 'sdk_report', occurredAt: OCCURRED_AT, action: 'a', message: 'secret' });
    expect(extraField.code).toBe('invalid_entry');
    const missingField = trail.record({ kind: 'page_enter', occurredAt: OCCURRED_AT, origin: 'x' });
    expect(missingField.code).toBe('invalid_entry');
    const wrongType = trail.record({ kind: 'request_summary', occurredAt: OCCURRED_AT, method: 5, normalizedUrl: 'u', outcome: 'o', durationMs: 1 });
    expect(wrongType.code).toBe('invalid_entry');
    const badTimestamp = trail.record({ kind: 'sdk_report', occurredAt: 0, action: 'a' });
    expect(badTimestamp.code).toBe('invalid_entry');
    const first = trail.record({ kind: 'sdk_report', occurredAt: OCCURRED_AT, action: 'ok' });
    expect(first.sequence).toBe(1);
  });

  it('accepts every safe entry kind', () => {
    const trail = createSdkActivityTrail();
    const entries: unknown[] = [
      { kind: 'page_enter', occurredAt: OCCURRED_AT, origin: 'https://a.com', pathname: '/x' },
      { kind: 'route_change', occurredAt: OCCURRED_AT, pathname: '/y' },
      { kind: 'request_summary', occurredAt: OCCURRED_AT, method: 'GET', normalizedUrl: 'https://a.com/x', outcome: 'success', statusCode: 200, durationMs: 10 },
      { kind: 'resource_error', occurredAt: OCCURRED_AT, normalizedUrl: 'https://a.com/logo.png' },
      { kind: 'sdk_report', occurredAt: OCCURRED_AT, action: 'event_submitted' },
      { kind: 'prior_error', occurredAt: OCCURRED_AT, errorClass: 'javascript', normalizedUrl: 'https://a.com/x' },
    ];
    for (const entry of entries) {
      expect(trail.record(entry).code).toBe('recorded');
    }
    expect(trail.entries).toHaveLength(6);
  });

  it('honors the enabled flag and destroy lifecycle', () => {
    const disabled = createSdkActivityTrail({ enabled: false });
    expect(disabled.record({ kind: 'sdk_report', occurredAt: OCCURRED_AT, action: 'a' }).code).toBe('disabled');

    const trail = createSdkActivityTrail();
    trail.destroy();
    expect(trail.entries).toEqual([]);
    expect(trail.record({ kind: 'sdk_report', occurredAt: OCCURRED_AT, action: 'a' }).code).toBe('destroyed');
  });

  it('returns frozen new arrays and isolates instances', () => {
    const trail = createSdkActivityTrail();
    trail.record({ kind: 'sdk_report', occurredAt: OCCURRED_AT, action: 'a' });
    const snapshot = trail.entries;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).not.toBe(trail.entries);

    const other = createSdkActivityTrail();
    expect(other.entries).toEqual([]);
    trail.record({ kind: 'sdk_report', occurredAt: OCCURRED_AT, action: 'b' });
    expect(other.entries).toEqual([]);
  });

  it('normalizes capacity to the safe range', () => {
    expect(createSdkActivityTrail({ capacity: 0 }).capacity).toBe(30);
    expect(createSdkActivityTrail({ capacity: 1001 }).capacity).toBe(30);
    expect(createSdkActivityTrail({ capacity: 5 }).capacity).toBe(5);
  });
});
