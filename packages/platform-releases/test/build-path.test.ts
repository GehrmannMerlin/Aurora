import { describe, expect, it } from 'vitest';
import { normalizeBuildPath } from '../src/build-path.js';

describe('normalizeBuildPath (PRD §8.3.3)', () => {
  it('strips protocol and host from a CDN URL', () => {
    expect(normalizeBuildPath('https://cdn.example.com/assets/app.8f3a1.js')).toBe(
      '/assets/app.8f3a1.js',
    );
  });

  it('strips query and fragment but keeps the path and filename hash', () => {
    expect(normalizeBuildPath('/assets/app.8f3a1.js?v=2#frag')).toBe('/assets/app.8f3a1.js');
  });

  it('adds a leading slash and trims', () => {
    expect(normalizeBuildPath('assets/app.js')).toBe('/assets/app.js');
  });

  it('is deterministic and does not fuzzy-match', () => {
    expect(normalizeBuildPath('https://cdn.example.com/assets/app.8f3a1.js')).toBe(
      normalizeBuildPath('https://cdn.other.com/assets/app.8f3a1.js'),
    );
    expect(normalizeBuildPath('https://cdn.example.com/assets/app.8f3a1.js')).not.toBe(
      normalizeBuildPath('https://cdn.example.com/assets/app.9b2c4.js'),
    );
  });
});
