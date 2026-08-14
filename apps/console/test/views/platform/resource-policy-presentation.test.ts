import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/views/platform/ResourcePolicyView.vue', 'utf8');

describe('platform resource-policy workspace presentation', () => {
  it('leads with the platform-admin target selector and a policy evidence summary', () => {
    const targetIndex = source.indexOf('data-testid="rp-target-picker"');
    const summaryIndex = source.indexOf('data-testid="rp-effective-policy"');

    expect(targetIndex).toBeGreaterThan(-1);
    expect(summaryIndex).toBeGreaterThan(targetIndex);
    expect(source).toContain('class="resource-policy-workspace"');
    expect(source).toContain('data-testid="rp-policy-source"');
    expect(source).toContain('data-testid="rp-policy-propagation"');
  });

  it('keeps configured value, source, and effective value distinct in policy evidence', () => {
    expect(source).toContain('data-testid="rp-policy-evidence-table"');
    expect(source).toContain('<th>已配置值</th>');
    expect(source).toContain('<th>来源</th>');
    expect(source).toContain('<th>生效值</th>');
  });

  it('keeps default, organization override, and project limit editors separate without unsupported analytics', () => {
    expect(source).toContain("'rp-platform-default-editor'");
    expect(source).toContain("'rp-organization-override-editor'");
    expect(source).toContain('data-testid="rp-project-limit-editor"');
    expect(source).not.toMatch(/趋势|成本|预测|排名/);
  });
});
