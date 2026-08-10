import { describe, expect, it } from 'vitest';
import { validateStateTransition } from '../src/index.js';

describe('validateStateTransition (PRD §10.1)', () => {
  it('allows the four-state forward transitions and reopen via open', () => {
    expect(validateStateTransition('open', 'in_progress')).toBe(true);
    expect(validateStateTransition('open', 'resolved')).toBe(true);
    expect(validateStateTransition('open', 'ignored')).toBe(true);
    expect(validateStateTransition('in_progress', 'open')).toBe(true);
    expect(validateStateTransition('in_progress', 'resolved')).toBe(true);
    expect(validateStateTransition('in_progress', 'ignored')).toBe(true);
    expect(validateStateTransition('resolved', 'open')).toBe(true);
    expect(validateStateTransition('ignored', 'open')).toBe(true);
  });

  it('rejects invalid transitions (resolved/ignored must reopen via open)', () => {
    expect(validateStateTransition('resolved', 'in_progress')).toBe(false);
    expect(validateStateTransition('resolved', 'ignored')).toBe(false);
    expect(validateStateTransition('ignored', 'resolved')).toBe(false);
    expect(validateStateTransition('ignored', 'in_progress')).toBe(false);
    expect(validateStateTransition('open', 'bogus')).toBe(false);
    expect(validateStateTransition('bogus', 'open')).toBe(false);
  });
});
