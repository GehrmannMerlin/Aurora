import { enum_, num, obj, optional, str } from '../common/schema.js';
import { queryResponse } from '../common/query.js';
import { utcTimestamp } from '../common/time.js';
import { OrganizationId } from '../common/identifiers.js';

export const OPERATION_ID_GET_USAGE_SUMMARY = 'usageGetSummary' as const;

export const usageGetSummaryPathParams = obj({
  organizationId: OrganizationId,
});

/**
 * Default periodic resource quota (PRD §15.4) — a free-tier placeholder the
 * platform administrator (D2, G13 blocked) will replace later. Usage is real
 * processed data only; no sampling extrapolation and no billing.
 */
export const DEFAULT_ORGANIZATION_QUOTA = 1_000_000;

export type UsageStage = 'normal' | 'near-limit' | 'degraded' | 'hard-limit';

export interface DegradationThresholds {
  readonly nearLimitRatio: number;
  readonly degradedRatio: number;
  readonly hardLimitRatio: number;
}

export const DEFAULT_DEGRADATION_THRESHOLDS: DegradationThresholds = Object.freeze({
  nearLimitRatio: 0.8, // PRD §15.5: warn at ~80% of the periodic quota
  degradedRatio: 0.9,
  hardLimitRatio: 1.0,
});

/**
 * Pure degradation projection (PRD §15.5 fixed order): normal → near-limit
 * (warning, degradation begins) → degraded → hard-limit (stop saving ordinary
 * full events; SDK told not to retry). Inputs are ratios, never raw counts.
 */
export function degradeForUsageRatio(
  ratio: number,
  thresholds: DegradationThresholds = DEFAULT_DEGRADATION_THRESHOLDS,
): UsageStage {
  if (ratio >= thresholds.hardLimitRatio) return 'hard-limit';
  if (ratio >= thresholds.degradedRatio) return 'degraded';
  if (ratio >= thresholds.nearLimitRatio) return 'near-limit';
  return 'normal';
}

export const usageGetSummaryResponse = queryResponse(
  obj({
    organizationId: OrganizationId,
    periodStart: utcTimestamp,
    periodEnd: utcTimestamp,
    acceptedEvents: num(0),
    processedEvents: num(0),
    quotaAcceptedEvents: num(0),
    /** acceptedEvents / quotaAcceptedEvents (0..hardLimit+); never a sampled estimate. */
    ratio: num(0),
    stage: enum_(['normal', 'near-limit', 'degraded', 'hard-limit']),
    note: optional(str(1, 512)),
  }),
);
