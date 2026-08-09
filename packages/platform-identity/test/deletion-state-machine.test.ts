import { describe, expect, it } from 'vitest';
import { decideDeletionFinalization } from '../src/deletion-state-machine.js';

/** A stable fake-clock instant; all tests inject `now` (never Date.now()). */
const COOLING_ENDS_AT = '2026-08-16T00:00:00.000Z';

function at(msOffset: number): Date {
  return new Date(new Date(COOLING_ENDS_AT).getTime() + msOffset);
}

describe('decideDeletionFinalization', () => {
  it('returns not_due before the cooling deadline', () => {
    const decision = decideDeletionFinalization({
      status: 'deletion_cooling',
      deletionCoolingEndsAt: COOLING_ENDS_AT,
      now: at(-1),
      ownerBlocked: false,
    });
    expect(decision).toBe('not_due');
  });

  it('returns not_due at exactly the cooling deadline when the owner re-check blocks', () => {
    const decision = decideDeletionFinalization({
      status: 'deletion_cooling',
      deletionCoolingEndsAt: COOLING_ENDS_AT,
      now: at(0),
      ownerBlocked: true,
    });
    expect(decision).toBe('keep_cooling');
  });

  it('finalizes exactly at the cooling deadline when not blocked (inclusive boundary)', () => {
    const decision = decideDeletionFinalization({
      status: 'deletion_cooling',
      deletionCoolingEndsAt: COOLING_ENDS_AT,
      now: at(0),
      ownerBlocked: false,
    });
    expect(decision).toBe('finalize');
  });

  it('finalizes after the deadline when not blocked', () => {
    const decision = decideDeletionFinalization({
      status: 'deletion_cooling',
      deletionCoolingEndsAt: COOLING_ENDS_AT,
      now: at(60_000),
      ownerBlocked: false,
    });
    expect(decision).toBe('finalize');
  });

  it('keeps cooling after the deadline when the owner re-check blocks', () => {
    const decision = decideDeletionFinalization({
      status: 'deletion_cooling',
      deletionCoolingEndsAt: COOLING_ENDS_AT,
      now: at(7 * 86_400_000),
      ownerBlocked: true,
    });
    expect(decision).toBe('keep_cooling');
  });

  it('returns not_due for any non-cooling status even when the deadline has passed', () => {
    for (const status of ['active', 'pending_verification', 'terminated', 'bogus']) {
      const decision = decideDeletionFinalization({
        status,
        deletionCoolingEndsAt: COOLING_ENDS_AT,
        now: at(7 * 86_400_000),
        ownerBlocked: false,
      });
      expect(decision).toBe('not_due');
    }
  });

  it('returns not_due when no cooling deadline is recorded', () => {
    const decision = decideDeletionFinalization({
      status: 'deletion_cooling',
      deletionCoolingEndsAt: null,
      now: at(0),
      ownerBlocked: false,
    });
    expect(decision).toBe('not_due');
  });

  it('is pure: same inputs always produce the same decision', () => {
    const input = {
      status: 'deletion_cooling',
      deletionCoolingEndsAt: COOLING_ENDS_AT,
      now: at(5_000),
      ownerBlocked: false,
    };
    const first = decideDeletionFinalization(input);
    const second = decideDeletionFinalization(input);
    expect(second).toBe(first);
  });
});
