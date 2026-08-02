import type { Pool } from 'pg';
import { verifyIngestionCredential } from '@aurora/ingestion-credentials';
import type {
  AuthorizeIngestionRequestInput,
  AuthorizeIngestionRequestResult,
  IngestionRequestAuthorizer,
} from './access-policy.js';

/**
 * Real credential-backed authorizer for the ingestion HTTP service. Maps the
 * credential package's stable results onto the service-internal authorizer
 * port. Never records raw keys, SQL, digests, or database details.
 */
export function createPostgresRequestAuthorizer(pool: Pool): IngestionRequestAuthorizer {
  return {
    async authorize(
      input: AuthorizeIngestionRequestInput,
    ): Promise<AuthorizeIngestionRequestResult> {
      const result = await verifyIngestionCredential(pool, {
        clientKey: input.clientKey,
        environment: input.environment,
        origin: input.origin ?? null,
      });
      switch (result.status) {
        case 'authorized':
          return {
            status: 'authorized' as const,
            projectId: result.projectId,
            allowedOrigin: result.allowedOrigin ?? undefined,
          };
        case 'unauthenticated':
          return { status: 'unauthenticated' };
        case 'origin_forbidden':
          return { status: 'originForbidden' };
        case 'environment_forbidden':
          return { status: 'environmentForbidden' };
        case 'temporarily_unavailable':
          return { status: 'temporarilyUnavailable' };
        default:
          return { status: 'temporarilyUnavailable' };
      }
    },
  };
}
