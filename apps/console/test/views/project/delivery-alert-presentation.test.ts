import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const releasesSource = readFileSync('src/views/project/ProjectReleasesView.vue', 'utf8');
const releaseDetailSource = readFileSync('src/views/project/ProjectReleaseDetailView.vue', 'utf8');
const sourceMapsSource = readFileSync('src/views/project/ProjectSourceMapsView.vue', 'utf8');
const alertsSource = readFileSync('src/views/project/ProjectAlertsView.vue', 'utf8');
const ruleFormSource = readFileSync('src/views/project/ProjectAlertRuleFormView.vue', 'utf8');
const instanceDetailSource = readFileSync(
  'src/views/project/ProjectAlertInstanceDetailView.vue',
  'utf8',
);

describe('delivery and alerting workspace presentation', () => {
  it('uses primary-object list and detail workspaces for releases and Source Maps', () => {
    for (const source of [releasesSource, sourceMapsSource]) {
      expect(source).toContain('class="delivery-workspace"');
      expect(source).toContain('data-testid="delivery-list"');
      expect(source).toContain('data-testid="delivery-detail"');
    }
    expect(releaseDetailSource).toContain('data-testid="release-detail-evidence"');
    expect(sourceMapsSource).toContain('data-testid="source-map-file-actions"');
  });

  it('keeps the alert overview as URL-restorable rules and instances tabs with matching toolbars', () => {
    expect(alertsSource).toContain("raw === 'rules' ? 'rules' : 'instances'");
    expect(alertsSource).toContain('data-testid="tab-instances"');
    expect(alertsSource).toContain('data-testid="tab-rules"');
    expect(alertsSource).toContain('data-testid="alert-instances-toolbar"');
    expect(alertsSource).toContain('data-testid="alert-rules-toolbar"');
  });

  it('keeps C11 as one adaptive configuration form with grouped operational fields', () => {
    expect(ruleFormSource).toContain('data-testid="alert-rule-form"');
    expect(ruleFormSource).toContain('alert-rule-form-grid');
    expect(ruleFormSource).toContain('data-testid="alert-rule-threshold-group"');
    expect(ruleFormSource).toContain('data-testid="alert-rule-delivery-group"');
    expect(ruleFormSource).toContain('v-if="selectedCapability?.isRatio"');
  });

  it('leads C12 with state and evidence, keeping transitions as supporting history', () => {
    const statusIndex = instanceDetailSource.indexOf('data-testid="alert-instance-status"');
    const reasonIndex = instanceDetailSource.indexOf('data-testid="alert-instance-reason"');
    const snapshotIndex = instanceDetailSource.indexOf('data-testid="alert-instance-rule-snapshot"');
    const evidenceIndex = instanceDetailSource.indexOf('data-testid="alert-instance-evidence"');
    const transitionsIndex = instanceDetailSource.indexOf('data-testid="alert-instance-transitions"');

    expect(reasonIndex).toBeGreaterThan(statusIndex);
    expect(snapshotIndex).toBeGreaterThan(reasonIndex);
    expect(evidenceIndex).toBeGreaterThan(snapshotIndex);
    expect(transitionsIndex).toBeGreaterThan(evidenceIndex);
    expect(instanceDetailSource).not.toContain('class="mon-timeline"');
  });
});
