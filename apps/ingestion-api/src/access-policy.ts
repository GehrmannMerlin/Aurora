export interface AuthorizeIngestionRequestInput {
  readonly clientKey: string;
  readonly environment: string;
  readonly origin: string | undefined;
  readonly requestId: string;
}

export type AuthorizeIngestionRequestResult =
  | {
      readonly status: 'authorized';
      readonly projectId: string;
      readonly allowedOrigin: string | undefined;
    }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'originForbidden' }
  | { readonly status: 'environmentForbidden' }
  | { readonly status: 'temporarilyUnavailable' };

/**
 * Service-internal credential and access policy port. This module does not
 * implement persistence; a future real credential module will. It must never
 * return database rows, secret digests, sessions, or grant read/manage rights.
 */
export interface IngestionRequestAuthorizer {
  authorize(input: AuthorizeIngestionRequestInput): Promise<AuthorizeIngestionRequestResult>;
}
