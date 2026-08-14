// @vitest-environment node
//
// The console vitest suite otherwise runs under jsdom, where import.meta.url is
// rewritten to the jsdom origin (http://localhost:3000/...). This file only
// inspects the production build output on disk, so it opts into the node
// environment so fileURLToPath(import.meta.url) stays a real file URL.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const assetsDir = join(dist, 'assets');

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else acc.push(full);
  }
  return acc;
}

const files = collect(dist);

// Vite copies public/mockServiceWorker.js (the MSW init worker written by Task 5)
// verbatim into dist/ as an inert, self-contained worker script. It contains the
// string "msw" but no MSW library code and is never loaded by the app bundle. The
// production-bundle gate therefore targets only the hashed chunks under dist/assets/.
const bundleJs = files.filter(
  (file) => file.endsWith('.js') && !relative(assetsDir, file).startsWith('..'),
);

describe('built console production output', () => {
  it('emits an index.html entry that loads hashed assets', () => {
    const index = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(index).toMatch(/<script[^>]+src="\/assets\/[^"]+-[A-Za-z0-9_-]+\.js"/);
  });

  it('emits no source maps (no leak through Preview static serving)', () => {
    expect(files.filter((file) => file.endsWith('.map'))).toHaveLength(0);
  });

  it('contains no MSW or contract-testkit in the production bundle', () => {
    expect(bundleJs.length).toBeGreaterThan(0);
    for (const file of bundleJs) {
      const content = readFileSync(file, 'utf8');
      // Match real package/runtime markers, not an incidental `msw` sequence
      // inside a deterministic Vite asset hash (for example `...Qemsw2C.js`).
      expect(content, file).not.toMatch(
        /(?:["'/]msw["'/]|mockServiceWorker|contract-testkit|validSessionSamples|__mock\/scope)/,
      );
    }
  });

  // Regression gate: the approved stack (ADR-025) requires open-source PrimeVue.
  // PrimeVue 5.x switched to the commercial PrimeUI license and injects a
  // fixed-position "Invalid PrimeUI License" banner into every page when no
  // license key is configured (see @primeui/license-manager). No commercial
  // PrimeUI capability is in the approved scope, so any occurrence of its
  // banner string or license-check plumbing in the production bundle is a
  // defect and must fail the build.
  it('contains no PrimeUI commercial license machinery in the production bundle', () => {
    expect(bundleJs.length).toBeGreaterThan(0);
    for (const file of bundleJs) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/Invalid PrimeUI License|p-license-host|license-manager/);
    }
  });
});
