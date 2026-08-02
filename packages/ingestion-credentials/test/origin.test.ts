import { describe, expect, it } from 'vitest';
import { normalizeOrigin } from '../src/origin.js';

describe('normalizeOrigin', () => {
  it('normalizes a plain HTTPS origin', () => {
    expect(normalizeOrigin('https://example.com')).toBe('https://example.com');
  });

  it('drops a trailing slash', () => {
    expect(normalizeOrigin('https://example.com/')).toBe('https://example.com');
  });

  it('folds default ports', () => {
    expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com');
    expect(normalizeOrigin('http://example.com:80')).toBe('http://example.com');
  });

  it('rejects userinfo', () => {
    expect(normalizeOrigin('https://user:pass@example.com')).toBeNull();
  });

  it('rejects a path', () => {
    expect(normalizeOrigin('https://example.com/path')).toBeNull();
  });

  it('rejects a query', () => {
    expect(normalizeOrigin('https://example.com?q=1')).toBeNull();
  });

  it('rejects a fragment', () => {
    expect(normalizeOrigin('https://example.com#frag')).toBeNull();
  });

  it('rejects non-http(s) schemes', () => {
    expect(normalizeOrigin('ftp://example.com')).toBeNull();
    expect(normalizeOrigin('file:///tmp/x')).toBeNull();
  });

  it('rejects null string, wildcard, empty, and non-string inputs', () => {
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('*')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin(undefined)).toBeNull();
    expect(normalizeOrigin(42)).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
  });

  it('rejects a URL without a host', () => {
    expect(normalizeOrigin('https://')).toBeNull();
  });

  it('rejects whitespace-padded input', () => {
    expect(normalizeOrigin(' https://example.com')).toBeNull();
  });
});
