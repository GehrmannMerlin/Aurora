export type IngestionCredentialVerificationResult =
  | {
      readonly status: 'authorized';
      readonly projectId: string;
      readonly allowedOrigin: string | null;
    }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'origin_forbidden' }
  | { readonly status: 'environment_forbidden' }
  | { readonly status: 'temporarily_unavailable' };

export interface VerifyIngestionCredentialInput {
  readonly clientKey: string;
  readonly environment: string;
  readonly origin: string | null;
}
