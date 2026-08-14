export type ResendState =
  { readonly kind: 'ready' } | { readonly kind: 'cooldown'; readonly remainingSeconds: number };

export interface ServerClockAnchor {
  readonly serverTime: string;
  readonly observedClientTime: Date;
}

function validTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Advance an authoritative server timestamp by client elapsed time, preserving clock skew. */
export function estimateServerNow(input: ServerClockAnchor & { readonly clientNow: Date }): Date {
  const serverTime = validTimestamp(input.serverTime);
  if (serverTime === null) return new Date(input.clientNow);
  const elapsed = Math.max(0, input.clientNow.getTime() - input.observedClientTime.getTime());
  return new Date(serverTime + elapsed);
}

/** Derive a non-negative countdown from absolute server timestamps. */
export function deriveResendState(input: {
  readonly serverTime: string;
  readonly resendAvailableAt: string | null;
  readonly clientNow: Date;
}): ResendState {
  if (input.resendAvailableAt === null) return { kind: 'ready' };
  const resendAvailableAt = validTimestamp(input.resendAvailableAt);
  const serverTime = validTimestamp(input.serverTime);
  if (resendAvailableAt === null || serverTime === null) return { kind: 'ready' };

  const offsetMs = serverTime - input.clientNow.getTime();
  const estimatedServerNow = input.clientNow.getTime() + offsetMs;
  const remainingMs = resendAvailableAt - estimatedServerNow;
  if (remainingMs <= 0) return { kind: 'ready' };
  return { kind: 'cooldown', remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1000)) };
}
