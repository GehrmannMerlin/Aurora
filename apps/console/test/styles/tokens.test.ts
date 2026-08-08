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
    const expected: ReadonlyArray<[string, string]> = [
      ['--color-topbar-bg', '#111827'],
      ['--color-topbar-fg', '#F8FAFC'],
      ['--color-sidebar-bg', '#D47A16'],
      ['--color-sidebar-fg', '#17120D'],
      ['--color-sidebar-active-bg', '#FFF4DC'],
      ['--color-sidebar-active-fg', '#172033'],
      ['--color-sidebar-active-indicator', '#1D4ED8'],
      ['--color-page-bg', '#F8FAFC'],
      ['--color-surface-bg', '#FFFFFF'],
      ['--color-border-default', '#CBD5E1'],
      ['--color-text-primary', '#111827'],
      ['--color-text-secondary', '#475569'],
      ['--color-action-primary', '#2563EB'],
      ['--color-status-danger', '#D92D20'],
      ['--color-status-success', '#15803D'],
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
});
