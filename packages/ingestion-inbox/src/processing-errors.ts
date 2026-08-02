import type { InboxLeaseMutationResult } from './processing-types.js';

/** Stable lease_lost result: the caller's lease is no longer the current valid one. */
export function leaseLostResult(): InboxLeaseMutationResult {
  return { status: 'lease_lost' };
}

/** Stable not_found result: no row matches the internal id. */
export function notFoundResult(): InboxLeaseMutationResult {
  return { status: 'not_found' };
}

/** Stable success result. */
export function successResult(): InboxLeaseMutationResult {
  return { status: 'success' };
}
