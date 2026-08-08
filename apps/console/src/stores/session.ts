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
  verified: boolean;
}

interface SessionResponse {
  account: AccountSummary;
  authentication: 'pending_verification' | 'authenticated' | 'restricted';
  session: { expiresAt: string };
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
  const error = ref<string | null>(null);

  async function restore(): Promise<void> {
    if (status.value === 'loading' || status.value === 'authenticated') return;
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
    error.value = null;
  }

  return { status, account, expiresAt, csrf, error, restore, reset };
});
