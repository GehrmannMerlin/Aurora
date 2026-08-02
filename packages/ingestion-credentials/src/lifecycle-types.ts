/** Stable credential metadata; never contains a digest or any secret material. */
export interface CredentialMetadata {
  readonly credentialId: string;
  readonly projectId: string;
  readonly keyId: string;
  readonly status: 'active' | 'disabled' | 'revoked';
  readonly allowNonBrowser: boolean;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateIngestionClientCredentialInput {
  readonly projectId: string;
  readonly origins: readonly string[];
  readonly environments: readonly string[];
  readonly allowNonBrowser: boolean;
  readonly expiresAt: Date | null;
}

export type CreateIngestionClientCredentialResult =
  | {
      readonly status: 'success';
      readonly metadata: CredentialMetadata;
      readonly clientKey: string;
    }
  | { readonly status: 'invalid_input' }
  | { readonly status: 'temporarily_unavailable' }
  | { readonly status: 'generation_failed' };

export interface RotateIngestionClientCredentialInput {
  readonly keyId: string;
}

export type RotateIngestionClientCredentialResult =
  | {
      readonly status: 'success';
      readonly metadata: CredentialMetadata;
      readonly clientKey: string;
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'invalid_state' }
  | { readonly status: 'expired' }
  | { readonly status: 'temporarily_unavailable' }
  | { readonly status: 'generation_failed' };

export interface MutateIngestionClientCredentialInput {
  readonly keyId: string;
}

export type MutateIngestionClientCredentialResult =
  | { readonly status: 'success'; readonly metadata: CredentialMetadata }
  | { readonly status: 'not_found' }
  | { readonly status: 'invalid_state' }
  | { readonly status: 'expired' }
  | { readonly status: 'temporarily_unavailable' };
