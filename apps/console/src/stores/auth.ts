import { ref } from 'vue';
import { defineStore } from 'pinia';

/**
 * Client-side registration handoff (A1). The register response carries the
 * masked email, verification status, server cooldown and server time that the
 * /verify-email page needs. These are display metadata — never a raw token or
 * password — so holding them in a short-lived in-memory store is safe.
 */
export interface RegisterResult {
  readonly accountId: string;
  readonly workspaceId: { readonly organizationId: string };
  readonly emailMasked: string;
  readonly verificationStatus: { readonly verified: false; readonly reason: string };
  readonly resendAvailableAt?: string;
  readonly serverTime: string;
}

export const useAuthStore = defineStore('auth', () => {
  const registration = ref<RegisterResult | null>(null);

  function setRegistration(value: RegisterResult): void {
    registration.value = value;
  }

  function clear(): void {
    registration.value = null;
  }

  return { registration, setRegistration, clear };
});
