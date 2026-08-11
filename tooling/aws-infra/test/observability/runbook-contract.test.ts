import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { OPERATIONAL_ALERT_RULES } from '../../src/observability/alert-rules.js';

const RUNBOOKS_DIR = fileURLToPath(
  new URL('../../../../docs/operations/runbooks/', import.meta.url),
);

function runbookPath(rule: (typeof OPERATIONAL_ALERT_RULES)[number]): string {
  const filename = rule.runbook.split('/').at(-1);
  if (filename === undefined) throw new Error(`runbook without filename: ${rule.id}`);
  return join(RUNBOOKS_DIR, filename);
}

describe('runbook contract', () => {
  it('every operational alert rule references an existing runbook', () => {
    for (const rule of OPERATIONAL_ALERT_RULES) {
      const path = runbookPath(rule);
      expect(existsSync(path), `missing runbook for ${rule.id}: ${rule.runbook}`).toBe(true);
    }
  });

  it('every referenced runbook carries the required frontmatter fields', () => {
    for (const rule of OPERATIONAL_ALERT_RULES) {
      const content = readFileSync(runbookPath(rule), 'utf8');
      expect(content, `frontmatter for ${rule.id}`).toMatch(/^---\n/);
      expect(content, `title for ${rule.id}`).toMatch(/^title: /m);
      expect(content, `alert-ids for ${rule.id}`).toMatch(/^alert-ids: /m);
      expect(content, `owner for ${rule.id}`).toMatch(/^owner: /m);
    }
  });
});
