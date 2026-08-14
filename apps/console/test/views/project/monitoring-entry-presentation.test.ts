import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overviewSource = readFileSync(
  'src/views/project/ProjectOverviewView.vue',
  'utf8',
);
const onboardingSource = readFileSync(
  'src/views/project/ProjectOnboardingView.vue',
  'utf8',
);
const dataStatusSource = readFileSync(
  'src/views/project/ProjectDataStatusView.vue',
  'utf8',
);

describe('monitoring entry presentation', () => {
  it('renders C2 in status, evidence, then action order without unsupported visual claims', () => {
    const statusIndex = overviewSource.indexOf('test-id="overview-status"');
    const evidenceIndex = overviewSource.indexOf('data-testid="overview-evidence"');
    const actionsIndex = overviewSource.indexOf('test-id="overview-actions"');

    expect(statusIndex).toBeGreaterThan(-1);
    expect(evidenceIndex).toBeGreaterThan(statusIndex);
    expect(actionsIndex).toBeGreaterThan(evidenceIndex);
    expect(overviewSource).toContain('AppTechnicalDetails');
    expect(overviewSource).not.toMatch(/<svg[^>]+role=["']img["']/);
    expect(overviewSource).not.toContain('<canvas');
    expect(overviewSource).not.toContain('趋势');
    expect(overviewSource).not.toContain('健康分');
  });

  it('uses a numbered onboarding sequence with install, initialization and test code', () => {
    expect(onboardingSource).toContain('class="mon-onboarding-sequence"');
    expect(onboardingSource).toContain('<ol');
    expect(onboardingSource).toContain('class="mon-code"');
  });

  it('uses the one-time creation handoff instead of inventing a projected key or environment', () => {
    expect(onboardingSource).toContain('window.history.state');
    expect(onboardingSource).toContain('historyState?.clientKey');
    expect(onboardingSource).toContain('historyState?.environment');
    expect(onboardingSource).toContain('environment: ${JSON.stringify(environment)}');
    expect(onboardingSource).not.toContain('YOUR_CLIENT_KEY');
  });

  it('groups C7 authority, reason, stages, trust evidence, and action targets', () => {
    for (const target of ['ds-authority', 'ds-stages', 'ds-actions']) {
      expect(dataStatusSource).toContain(`test-id="${target}"`);
    }
    expect(dataStatusSource).toContain('data-testid="ds-trust-evidence"');
    expect(dataStatusSource).toContain('AppTechnicalDetails');
  });
});
