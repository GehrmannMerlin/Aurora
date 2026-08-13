import { describe, expect, it } from 'vitest';
import {
  bumpSemver,
  compareSemver,
  formatSemver,
  parseSemver,
  parseSemverResult,
  withPrerelease,
} from '../src/semver.js';

describe('parseSemver', () => {
  it('parses stable versions', () => {
    expect(parseSemver('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0, prerelease: null });
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
  });

  it('parses prerelease identifiers', () => {
    expect(parseSemver('0.1.0-alpha.1')?.prerelease).toEqual(['alpha', '1']);
    expect(parseSemver('1.0.0-beta.2')?.prerelease).toEqual(['beta', '2']);
  });

  it('rejects invalid versions', () => {
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('v1.2.3')).toBeNull();
    expect(parseSemver('1.2.3.4')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(parseSemverResult('nope').ok).toBe(false);
    expect(parseSemverResult('1.2.3').ok).toBe(true);
  });
});

describe('compareSemver', () => {
  it('orders stable versions numerically', () => {
    expect(compareSemver(parseSemver('0.1.0')!, parseSemver('0.2.0')!)).toBeLessThan(0);
    expect(compareSemver(parseSemver('1.0.0')!, parseSemver('0.9.9')!)).toBeGreaterThan(0);
    expect(compareSemver(parseSemver('1.2.3')!, parseSemver('1.2.3')!)).toBe(0);
  });

  it('orders stable after prerelease of the same core', () => {
    expect(compareSemver(parseSemver('1.0.0-alpha.1')!, parseSemver('1.0.0')!)).toBeLessThan(0);
  });
});

describe('bumpSemver', () => {
  it('bumps major/minor/patch from a stable core', () => {
    expect(formatSemver(bumpSemver(parseSemver('0.0.0')!, 'patch'))).toBe('0.0.1');
    expect(formatSemver(bumpSemver(parseSemver('0.0.0')!, 'minor'))).toBe('0.1.0');
    expect(formatSemver(bumpSemver(parseSemver('1.2.3')!, 'major'))).toBe('2.0.0');
  });

  it('treats a prerelease input as its stable core for the bump', () => {
    expect(formatSemver(bumpSemver(parseSemver('1.2.3-beta.1')!, 'patch'))).toBe('1.2.4');
  });

  it('attaches a prerelease identifier list', () => {
    expect(formatSemver(withPrerelease(parseSemver('1.2.3')!, ['alpha', '1']))).toBe('1.2.3-alpha.1');
  });
});
