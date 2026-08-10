import { describe, expect, it, vi } from 'vitest';
import {
  createSafeDefaultSdkConfig,
  createSdkControlPlane,
  parseSdkConfig,
  type SdkConfigSnapshot,
} from '../src/index.js';

function config(overrides: Partial<Record<string, unknown>> = {}): SdkConfigSnapshot {
  const parsed = parseSdkConfig({ clientKey: 'key', ...overrides });
  if (!parsed.ok) throw new TypeError('invalid test config');
  return parsed.config;
}

function errorDraft(body: unknown = { message: 'boom' }) {
  return { eventType: 'error' as const, body };
}

function requestDraft(url: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    eventType: 'request' as const,
    body: {
      method: 'GET',
      url,
      startedAt: 1,
      durationMs: 100,
      outcome: 'success',
      statusCode: 200,
      ...overrides,
    },
  };
}

describe('createSdkControlPlane', () => {
  it('runs the full pipeline and keeps a valid error event', () => {
    const plane = createSdkControlPlane(config(), { pageOrigin: 'https://shop.example.com' });
    const result = plane.processEvent(errorDraft());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sampledOut).toBe(false);
      expect(result.event.body).toEqual({ message: 'boom' });
    }
  });

  it('drops invalid drafts and forbidden fields', () => {
    const plane = createSdkControlPlane(config());
    expect(plane.processEvent({ eventType: 'nope', body: {} } as never).ok).toBe(false);
    expect(plane.processEvent(errorDraft({ token: 'secret' })).ok).toBe(false);
  });

  it('drops when beforeSend returns null and isolates callback errors', () => {
    const plane = createSdkControlPlane(config({ beforeSend: () => null }));
    const dropped = plane.processEvent(errorDraft());
    expect(dropped.ok).toBe(false);
    if (!dropped.ok) expect(dropped.code).toBe('dropped_by_before_send');

    const throwing = createSdkControlPlane(config({ beforeSend: () => {
      throw new Error('x');
    } }));
    const failed = throwing.processEvent(errorDraft());
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.code).toBe('dropped_by_before_send');
  });

  it('re-checks privacy after beforeSend to prevent re-adding filtered data', () => {
    const plane = createSdkControlPlane(
      config({ beforeSend: () => ({ eventType: 'error', body: { password: 'secret' } }) }),
    );
    const result = plane.processEvent(errorDraft());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('dropped_by_before_send');
  });

  it('classifies and normalizes request URLs before sampling', () => {
    const plane = createSdkControlPlane(config({ sampleRates: { errors: 1, slowRequests: 1, performance: 1 } }), {
      pageOrigin: 'https://shop.example.com',
    });
    const result = plane.processEvent(requestDraft('https://shop.example.com/api/orders/10001'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.body).toMatchObject({ url: 'https://shop.example.com/api/orders/:number' });
    }
  });

  it('drops disallowed cross-origin requests', () => {
    const plane = createSdkControlPlane(config(), { pageOrigin: 'https://shop.example.com' });
    const result = plane.processEvent(requestDraft('https://analytics.example.net/collect'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('disallowed_request');
  });

  it('samples out slow/performance events per rate and does not submit them', () => {
    const plane = createSdkControlPlane(
      config({ sampleRates: { errors: 1, slowRequests: 0, performance: 0 } }),
      { pageOrigin: 'https://shop.example.com' },
    );
    const slow = plane.processEvent(requestDraft('https://shop.example.com/api/x', { durationMs: 5000 }));
    expect(slow.ok).toBe(false);
    if (!slow.ok) expect(slow.code).toBe('sampled_out');

    const perf = plane.processEvent({ eventType: 'performance', body: { metric: 'lcp' } });
    expect(perf.ok).toBe(false);
    if (!perf.ok) expect(perf.code).toBe('sampled_out');
  });

  it('submit delegates to the core submitter only when the event is kept', () => {
    const plane = createSdkControlPlane(config(), { pageOrigin: 'https://shop.example.com' });
    const submitter = vi.fn(() => ({ ok: true, code: 'accepted' }));
    const kept = plane.submit(errorDraft(), submitter);
    expect(submitter).toHaveBeenCalledTimes(1);
    expect(kept.code).toBe('accepted');

    const submitter2 = vi.fn(() => ({ ok: true, code: 'accepted' }));
    const dropped = plane.submit(requestDraft('https://analytics.example.net/collect'), submitter2);
    expect(submitter2).not.toHaveBeenCalled();
    expect(dropped.ok).toBe(false);
  });

  it('exposes a frozen config snapshot and isolates instances', () => {
    const a = createSdkControlPlane(config());
    const b = createSdkControlPlane(createSafeDefaultSdkConfig());
    expect(a.getConfig().clientKey).toBe('key');
    expect(b.getConfig().clientKey).toBe('');
    expect(Object.isFrozen(a.getConfig())).toBe(true);
    a.destroy();
    b.destroy();
  });
});
