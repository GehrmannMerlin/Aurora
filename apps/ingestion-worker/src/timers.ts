/** Injectable sleep for tests; production uses the default based on setTimeout. */
export interface SleeperPort {
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** Injectable timer registration/clear for tests. */
export interface TimerPort {
  set(fn: () => void, ms: number): { clear: () => void };
}

export const defaultSleeper: SleeperPort = {
  sleep(ms, signal) {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        const reason = signal?.reason instanceof Error ? signal.reason : new Error('aborted');
        reject(reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  },
};

export const defaultTimer: TimerPort = {
  set(fn, ms) {
    const handle = setTimeout(fn, ms);
    return {
      clear: () => {
        clearTimeout(handle);
      },
    };
  },
};

/** Combined injectable timing ports. */
export interface WorkerTimingPorts {
  readonly sleeper: SleeperPort;
  readonly timer: TimerPort;
}

export const defaultWorkerTimingPorts: WorkerTimingPorts = {
  sleeper: defaultSleeper,
  timer: defaultTimer,
};
