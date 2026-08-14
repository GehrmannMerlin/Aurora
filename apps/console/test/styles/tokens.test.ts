import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = join(import.meta.dirname, '../../src');

function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSources(full, acc);
    else if (/\.(css|vue|ts)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const sources = collectSources(srcDir);

describe('visual language foundation', () => {
  it('defines every approved token with its exact value', () => {
    const tokens = readFileSync(join(srcDir, 'styles/tokens.css'), 'utf8');
    const expected: readonly [string, string][] = [
      ['--color-rail-bg', '#101828'],
      ['--color-rail-fg', '#F9FAFB'],
      ['--color-rail-muted', '#98A2B3'],
      ['--color-context-bg', '#F2F4F7'],
      ['--color-page-bg', '#F7F8FA'],
      ['--color-surface-bg', '#FFFFFF'],
      ['--color-border-default', '#D0D5DD'],
      ['--color-text-primary', '#101828'],
      ['--color-text-secondary', '#475467'],
      ['--color-action-primary', '#3157D5'],
      ['--color-status-success', '#067647'],
      ['--color-status-warning', '#B54708'],
      ['--color-status-danger', '#B42318'],
      ['--color-status-info', '#175CD3'],
      ['--global-rail-width', '64px'],
      ['--context-sidebar-width', '232px'],
      ['--radius-control', '8px'],
      ['--radius-surface', '12px'],
    ];
    for (const [name, value] of expected) {
      expect(tokens, name).toContain(`${name}: ${value};`);
    }
  });

  it('forbids gradients across every source file', () => {
    for (const file of sources) {
      const content = readFileSync(file, 'utf8').toLowerCase();
      expect(content, file).not.toMatch(/(linear|radial|conic)-gradient/);
    }
  });

  it('allows background-image only as none on formal surfaces', () => {
    for (const file of sources) {
      const content = readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        if (/background-image\s*:/.test(line)) {
          expect(line, file).toMatch(/background-image\s*:\s*none\s*;/);
        }
      }
    }
  });

  it('does not retain legacy topbar or sidebar visual aliases in live Console sources', () => {
    const legacyPatterns: readonly RegExp[] = [
      /--color-topbar-/,
      /--color-sidebar-/,
      /#D47A16/i,
      /\.au-topbar\b/,
      /\.au-desktop-sidebar\b/,
    ];

    for (const file of sources) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of legacyPatterns) {
        expect(content, `${file} must not contain ${pattern.source}`).not.toMatch(pattern);
      }
    }
  });
});
