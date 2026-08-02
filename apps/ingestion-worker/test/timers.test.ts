import { describe, expect, it } from 'vitest';
import { defaultSleeper, defaultTimer, defaultWorkerTimingPorts } from '../src/timers.js';

describe('timers ports', () => {
  it('defaultSleeper resolves after the requested delay', async () => {
    const started = Date.now();
    await defaultSleeper.sleep(5);
    expect(Date.now() - started).toBeGreaterThanOrEqual(0);
  });

  it('defaultSleeper rejects with an abort error when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(defaultSleeper.sleep(10_000, controller.signal)).rejects.toBeTruthy();
  });

  it('defaultSleeper rejects when aborted mid-sleep and stops waiting', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = defaultSleeper.sleep(10_000, controller.signal).then(
      () => null,
      (error: unknown) => error,
    );
    setTimeout(() => {
      controller.abort();
    }, 5);
    const error = await pending;
    expect(error).toBeTruthy();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('defaultTimer set registers a callback and clear cancels it', async () => {
    let fired = 0;
    const handle = defaultTimer.set(() => {
      fired += 1;
    }, 5);
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
    expect(fired).toBe(1);
    handle.clear();
  });

  it('defaultTimer clear prevents a pending callback from firing', async () => {
    let fired = 0;
    const handle = defaultTimer.set(() => {
      fired += 1;
    }, 5);
    handle.clear();
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
    expect(fired).toBe(0);
  });

  it('defaultWorkerTimingPorts exposes both production ports', () => {
    expect(defaultWorkerTimingPorts.sleeper).toBe(defaultSleeper);
    expect(defaultWorkerTimingPorts.timer).toBe(defaultTimer);
  });
});
