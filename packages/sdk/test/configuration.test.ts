import { describe, expect, it } from 'vitest';
import { createSafeDefaultSdkConfig, parseSdkConfig } from '../src/index.js';

describe('parseSdkConfig', () => {
  it('applies the full safe-default table when only clientKey is given', () => {
    const result = parseSdkConfig({ clientKey: 'key-1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toMatchObject({
        clientKey: 'key-1',
        environment: null,
        release: null,
        slowRequestThreshold: 3000,
        allowedRequestOrigins: [],
        requestPathRules: [],
        extraErrorStatusCodes: [],
        ignoredRequestUrls: [],
        excludeSameOriginRequests: false,
        interactionTrailEnabled: true,
        maxActivityTrailEntries: 30,
        beforeSend: null,
      });
      expect(result.config.sampleRates).toEqual({ errors: 1, slowRequests: 0.2, performance: 0.1 });
      expect(result.fixes).toEqual([]);
    }
  });

  it('rejects a missing or invalid clientKey', () => {
    for (const config of [{}, { clientKey: '' }, { clientKey: 42 }, { clientKey: 'x'.repeat(257) }]) {
      const result = parseSdkConfig(config);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.field === 'clientKey')).toBe(true);
      }
    }
  });

  it('normalizes each invalid optional field to its safe default with a fix', () => {
    const result = parseSdkConfig({
      clientKey: 'key',
      environment: 5,
      release: '',
      sampleRates: { errors: 2, slowRequests: 'x', performance: -0.5 },
      slowRequestThreshold: -1,
      allowedRequestOrigins: ['https://*.example.com', 'not-a-url', 'ftp://x.com', 'https://a.com/path'],
      requestPathRules: [{ pattern: '/api/:id', name: 'ok' }, { pattern: 5, name: 'bad' }],
      extraErrorStatusCodes: [418, 999, 'x'],
      ignoredRequestUrls: ['/api', 5],
      excludeSameOriginRequests: 'yes',
      interactionTrailEnabled: 1,
      maxActivityTrailEntries: 0,
      beforeSend: 'nope',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.environment).toBeNull();
      expect(result.config.release).toBeNull();
      expect(result.config.sampleRates).toEqual({ errors: 1, slowRequests: 0.2, performance: 0.1 });
      expect(result.config.slowRequestThreshold).toBe(3000);
      expect(result.config.allowedRequestOrigins).toEqual(['https://*.example.com']);
      expect(result.config.requestPathRules).toEqual([{ pattern: '/api/:id', name: 'ok' }]);
      expect(result.config.extraErrorStatusCodes).toEqual([418]);
      expect(result.config.ignoredRequestUrls).toEqual(['/api']);
      expect(result.config.excludeSameOriginRequests).toBe(false);
      expect(result.config.interactionTrailEnabled).toBe(true);
      expect(result.config.maxActivityTrailEntries).toBe(30);
      expect(result.config.beforeSend).toBeNull();
      expect(result.fixes.length).toBeGreaterThan(0);
    }
  });

  it('normalizes origins, ports, and host case', () => {
    const result = parseSdkConfig({
      clientKey: 'key',
      allowedRequestOrigins: ['HTTPS://Api.Example.com:443', 'http://example.com:80', 'https://example.com:8443'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.allowedRequestOrigins).toEqual([
        'https://api.example.com',
        'http://example.com',
        'https://example.com:8443',
      ]);
    }
  });

  it('accepts a beforeSend function and rejects invalid ones', () => {
    const fn = (): null => null;
    const ok = parseSdkConfig({ clientKey: 'key', beforeSend: fn });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.config.beforeSend).toBe(fn);
    const emptyArray = parseSdkConfig({ clientKey: 'key', beforeSend: [] });
    expect(emptyArray.ok).toBe(true);
    if (emptyArray.ok) expect(emptyArray.config.beforeSend).toBeNull();
  });

  it('returns frozen snapshots and does not retain the input object', () => {
    const input = { clientKey: 'key', slowRequestThreshold: 1234 };
    const result = parseSdkConfig(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.config)).toBe(true);
      expect(Object.isFrozen(result.config.sampleRates)).toBe(true);
      expect(result.config.slowRequestThreshold).toBe(1234);
      input.slowRequestThreshold = 9999;
      expect(result.config.slowRequestThreshold).toBe(1234);
    }
  });

  it('rejects a non-object config input', () => {
    for (const input of [null, 'x', 5, [], true]) {
      const result = parseSdkConfig(input);
      expect(result.ok).toBe(false);
    }
  });

  it('createSafeDefaultSdkConfig returns the safe-default snapshot', () => {
    const config = createSafeDefaultSdkConfig();
    expect(config.clientKey).toBe('');
    expect(config.sampleRates).toEqual({ errors: 1, slowRequests: 0.2, performance: 0.1 });
    expect(config.maxActivityTrailEntries).toBe(30);
    expect(Object.isFrozen(config)).toBe(true);
  });
});
