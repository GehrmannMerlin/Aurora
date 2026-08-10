import { DEFAULT_MAX_ISSUE_SAMPLES } from './issue-contribution-types.js';

/**
 * Deterministic bounded representative-sample policy (DAT-13 spec §5.2 /
 * PRD §9.3.2/§9.3.4/§9.3.5). Pure: no randomness, no I/O, no side effects.
 * Below the cap everything is stored; at the cap ordinary `regular` repeats are
 * skipped (they only update counts), while priority-retained kinds
 * (`first`/`latest`/`reappeared`) are stored by evicting the oldest evictable
 * sample — `first` is never evictable (ADR-033 decision detail 8).
 */
export interface DecideIssueSampleInput {
  readonly sampleCount: number;
  readonly eventSampleKind: string;
  /** Oldest `regular` sample id; else oldest `latest`/`reappeared`; null when only `first` remains. */
  readonly evictableSampleId: string | null;
}

export type IssueSampleDecision =
  | { readonly action: 'store' }
  | { readonly action: 'replace'; readonly replaceSampleId: string }
  | { readonly action: 'skip' };

export function decideIssueSample(input: DecideIssueSampleInput): IssueSampleDecision {
  if (input.sampleCount < DEFAULT_MAX_ISSUE_SAMPLES) {
    return { action: 'store' };
  }
  if (input.eventSampleKind === 'regular') {
    return { action: 'skip' };
  }
  if (input.evictableSampleId === null) {
    return { action: 'skip' };
  }
  return { action: 'replace', replaceSampleId: input.evictableSampleId };
}
