/** Injectable sleep for tests; production uses the default based on setTimeout. */
export interface SleeperPort {
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
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
