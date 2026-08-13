import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEGRADATION_THRESHOLDS,
  DEFAULT_ORGANIZATION_QUOTA,
  OPERATION_ID_GET_USAGE_SUMMARY,
  degradeForUsageRatio,
} from '../../src/usage-and-policy/usage.js';

describe('DAT-21 usage / quota / degradation', () => {
  it('exposes the usageGetSummary operation id and a free-tier quota placeholder', () => {
    expect(OPERATION_ID_GET_USAGE_SUMMARY).toBe('usageGetSummary');
    expect(DEFAULT_ORGANIZATION_QUOTA).toBeGreaterThan(0);
  });

  it('projects the fixed PRD §15.5 degradation stages from the usage ratio', () => {
    expect(degradeForUsageRatio(0.5)).toBe('normal');
    expect(degradeForUsageRatio(DEFAULT_DEGRADATION_THRESHOLDS.nearLimitRatio)).toBe('near-limit');
    expect(degradeForUsageRatio(DEFAULT_DEGRADATION_THRESHOLDS.degradedRatio)).toBe('degraded');
    expect(degradeForUsageRatio(DEFAULT_DEGRADATION_THRESHOLDS.hardLimitRatio)).toBe('hard-limit');
    expect(degradeForUsageRatio(1.2)).toBe('hard-limit');
  });

  it('keeps near-limit at 80% and hard-limit at 100% by default (PRD §15.5)', () => {
    expect(DEFAULT_DEGRADATION_THRESHOLDS.nearLimitRatio).toBe(0.8);
    expect(DEFAULT_DEGRADATION_THRESHOLDS.hardLimitRatio).toBe(1.0);
  });

  it('never extrapolates: a ratio is computed only from real counts', () => {
    // ratio is derived by the handler from real accepted/quota counts; the pure
    // function only maps a given ratio — there is no sampling or estimation here.
    expect(degradeForUsageRatio(0)).toBe('normal');
  });
});
