import { describe, expect, it } from 'vitest';
import { WorkerDiagnostics, MAX_DIAGNOSTIC_MESSAGE_LENGTH } from '../src/diagnostics.js';

describe('WorkerDiagnostics', () => {
  it('records a diagnostic with the stable allowed fields', () => {
    const diagnostics = new WorkerDiagnostics('worker-1', 100);
    diagnostics.record({ operation: 'claim', code: 'claim_ok', workerId: 'worker-1' });
    diagnostics.record({
      operation: 'process',
      code: 'processor_failed',
      workerId: 'worker-1',
      inboxId: 7,
      eventType: 'error',
      attemptCount: 2,
      leaseLost: true,
    });
    const snapshot = diagnostics.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]).toMatchObject({ operation: 'claim', code: 'claim_ok' });
    expect(snapshot[1]).toMatchObject({
      operation: 'process',
      inboxId: 7,
      eventType: 'error',
      attemptCount: 2,
      leaseLost: true,
    });
    expect(snapshot[0]?.timestamp).toBeInstanceOf(Date);
  });

  it('keeps the ring buffer bounded by discarding the oldest entries', () => {
    const diagnostics = new WorkerDiagnostics('worker-1', 3);
    for (let i = 0; i < 5; i += 1) {
      diagnostics.record({ operation: 'claim', code: `c${String(i)}`, workerId: 'worker-1' });
    }
    const snapshot = diagnostics.snapshot();
    expect(snapshot).toHaveLength(3);
    expect(snapshot[0]?.code).toBe('c2');
    expect(snapshot[2]?.code).toBe('c4');
  });

  it('returns a frozen immutable snapshot', () => {
    const diagnostics = new WorkerDiagnostics('worker-1', 5);
    diagnostics.record({ operation: 'claim', code: 'a', workerId: 'worker-1' });
    const snapshot = diagnostics.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
  });

  it('caps the message length for a single entry', () => {
    const diagnostics = new WorkerDiagnostics('worker-1', 5);
    const longMessage = 'x'.repeat(MAX_DIAGNOSTIC_MESSAGE_LENGTH + 100);
    diagnostics.record({
      operation: 'claim',
      code: 'a',
      workerId: 'worker-1',
      message: longMessage,
    });
    const snapshot = diagnostics.snapshot();
    const recorded = snapshot[0]?.message ?? '';
    expect(recorded.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_MESSAGE_LENGTH);
  });
});
