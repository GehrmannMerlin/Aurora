#!/usr/bin/env node

/**
 * Lightweight repository documentation hygiene gate.
 *
 * It intentionally checks only stable, mechanical invariants: process-only
 * directories must not be tracked, known retired paths must not be referenced,
 * and relative Markdown links must resolve to a file or directory in the tree.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const markdown = tracked.filter((file) => file.toLowerCase().endsWith('.md'));
const errors = [];

for (const file of tracked) {
  if (file === '.superpowers' || file.startsWith('.superpowers/')) {
    errors.push(`${file}: process directory must not be tracked`);
  }
  if (file === 'docs/superpowers/plans' || file.startsWith('docs/superpowers/plans/')) {
    errors.push(`${file}: process plan directory must not be tracked`);
  }
  if (file === 'docs/superpowers/specs' || file.startsWith('docs/superpowers/specs/')) {
    errors.push(`${file}: process spec directory must not be tracked`);
  }
}

const retiredTokens = [
  'docs/superpowers/plans/',
  'docs/superpowers/specs/',
  'formalization-readiness.md',
  'aurora-v1-remaining-module-batches.md',
  'approval-package',
  'implemented-in-feature-branch',
  'release-pending',
];

for (const file of markdown) {
  const text = readFileSync(resolve(root, file), 'utf8');
  if (file !== 'AGENTS.md') {
    for (const token of retiredTokens) {
      if (text.includes(token)) errors.push(`${file}: retired process reference ${token}`);
    }
  }

  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of text.matchAll(linkPattern)) {
    const raw = match[1].trim().replace(/^<|>$/g, '');
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(raw)) continue;
    const encodedTarget = raw.split('#', 1)[0].split('?', 1)[0];
    let target;
    try {
      target = decodeURIComponent(encodedTarget);
    } catch {
      errors.push(`${file}: invalid encoded relative link ${raw}`);
      continue;
    }
    if (!target || target.startsWith('/')) continue;
    const resolved = resolve(dirname(resolve(root, file)), target);
    if (!existsSync(resolved)) errors.push(`${file}: broken relative link ${raw}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`documentation hygiene ok (${markdown.length} Markdown files checked)`);
}
