import { ref } from 'vue';
import { defineStore } from 'pinia';
import { OPERATION_ID_SESSION } from '@aurora/platform-contract';
import { ApiError } from '../api/errors.js';
import { invalidateScope, executeQuery } from '../api/query.js';

export type SessionStatus =
  'idle' | 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable';

export interface AccountSummary {
  accountId: string;
  email: string;
  /** Always present in get-session; omitted only by the narrower login handoff. */
  emailMasked?: string;
  verified: boolean;
}

interface SessionResponse {
  account: AccountSummary;
  authentication: 'pending_verification' | 'authenticated' | 'restricted';
  session: { expiresAt: string };
  emailVerification?: { serverTime: string; resendAvailableAt?: string };
  csrf: string;
  navigation: readonly unknown[];
}

export function mapSessionError(error: ApiError): SessionStatus {
  if (error.code === 'authentication') return 'unauthenticated';
  return 'unavailable';
}

export const useSessionStore = defineStore('session', () => {
  // Generation counter: reset() bumps it so an in-flight restore can never
  // resurrect session state committed before the reset (same class as the
  // navigation store's clear()-during-load guard).
  let epoch = 0;
  const status = ref<SessionStatus>('idle');
  const account = ref<AccountSummary | null>(null);
  const expiresAt = ref<string | null>(null);
  const csrf = ref<string | null>(null);
  const emailVerification = ref<SessionResponse['emailVerification'] | null>(null);
  const error = ref<string | null>(null);

  async function restore(options: { readonly force?: boolean } = {}): Promise<void> {
    if (status.value === 'loading') return;
    if (status.value === 'authenticated' && options.force !== true) return;
    if (options.force === true) invalidateScope({ type: 'account' });
    status.value = 'loading';
    error.value = null;
    const startedEpoch = epoch;
    try {
      const data = await executeQuery<SessionResponse>({
        operationId: OPERATION_ID_SESSION,
        scope: { type: 'account' },
        input: {},
      });
      if (startedEpoch !== epoch) return; // reset() ran while the request was in flight
      account.value = data.account;
      expiresAt.value = data.session.expiresAt;
      csrf.value = data.csrf;
      emailVerification.value = data.emailVerification ?? null;
      status.value = 'authenticated';
    } catch (caught) {
      if (startedEpoch !== epoch) return; // do not overwrite a post-reset state
      if (caught instanceof ApiError) {
        status.value = mapSessionError(caught);
        error.value = caught.code;
      } else {
        status.value = 'unavailable';
        error.value = 'network_error';
      }
    }
  }

  function reset(): void {
    epoch += 1;
    invalidateScope({ type: 'account' });
    status.value = 'idle';
    account.value = null;
    expiresAt.value = null;
    csrf.value = null;
    emailVerification.value = null;
    error.value = null;
  }

  /**
   * Apply an authenticated session projection directly from a command response
   * (identityLogin). Bumps the epoch so an in-flight restore cannot resurrect
   * pre-login state, then commits the authenticated shape. The caller still
   * relies on a subsequent identityGetSession for the full navigation context.
   */
  function applyAuthenticated(data: SessionResponse): void {
    epoch += 1;
    account.value = data.account;
    expiresAt.value = data.session.expiresAt;
    csrf.value = data.csrf;
    emailVerification.value = data.emailVerification ?? null;
    status.value = 'authenticated';
    error.value = null;
  }

  return {
    status,
    account,
    expiresAt,
    csrf,
    emailVerification,
    error,
    restore,
    reset,
    applyAuthenticated,
  };
});
