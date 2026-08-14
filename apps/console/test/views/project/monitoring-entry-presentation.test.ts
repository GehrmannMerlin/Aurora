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

  it('uses a numbered onboarding sequence with code surfaces', () => {
    expect(onboardingSource).toContain('class="mon-onboarding-sequence"');
    expect(onboardingSource).toContain('<ol');
    expect(onboardingSource).toContain('class="mon-code"');
  });

  it('does not claim a concrete environment when the onboarding projection is unavailable', () => {
    expect(onboardingSource).toContain('真实密钥投影尚未提供');
    expect(onboardingSource).not.toContain('environment: "production"');
  });

  it('groups C7 authority, reason, stages, trust evidence, and action targets', () => {
    for (const target of ['ds-authority', 'ds-stages', 'ds-actions']) {
      expect(dataStatusSource).toContain(`test-id="${target}"`);
    }
    expect(dataStatusSource).toContain('data-testid="ds-trust-evidence"');
    expect(dataStatusSource).toContain('AppTechnicalDetails');
  });
});
