import type { Pool } from 'pg';
import {
  createIngestionClientCredential,
  revokeIngestionClientCredential,
  verifyIngestionCredential,
} from '@aurora/ingestion-credentials';
import type {
  AuthorizeIngestionRequestInput,
  AuthorizeIngestionRequestResult,
  IngestionRequestAuthorizer,
} from '@aurora/ingestion-api';

export interface BenchmarkCredential {
  readonly clientKey: string;
  readonly keyId: string;
  readonly projectId: string;
  readonly environment: string;
  readonly origin: string;
}

export function projectIdForRun(runId: string, variant = 0): string {
  const base = runId.replaceAll('-', '').slice(0, 10);
  const hex = variant.toString(16).padStart(2, '0');
  return `00000000-0000-4000-8000-${base}${hex}`;
}

/**
 * Create a temporary real client credential through the public lifecycle API.
 * The full client key is returned exactly once and kept only in memory. The
 * credential's policy allows exactly the benchmark origin/environment so the
 * HTTP authorizer authorizes the loopback load. A `variant` keeps each
 * scenario's project id distinct so Inbox rows never mix between scenarios.
 */
export async function createBenchmarkCredential(
  pool: Pool,
  runId: string,
  variant = 0,
): Promise<BenchmarkCredential> {
  const projectId = projectIdForRun(runId, variant);
  const suffix = runId.replaceAll('-', '').slice(0, 12);
  const environment = `bench-${suffix}-${String(variant)}`;
  const origin = `https://benchmark-${suffix}-${String(variant)}.invalid`;

  const result = await createIngestionClientCredential(pool, {
    projectId,
    origins: [origin],
    environments: [environment],
    allowNonBrowser: true,
    expiresAt: null,
  });
  if (result.status !== 'success') {
    throw new Error(`credential creation failed: ${result.status}`);
  }
  return {
    clientKey: result.clientKey,
    keyId: result.metadata.keyId,
    projectId,
    environment,
    origin,
  };
}

/** Revoke the benchmark credential through the public lifecycle API. */
export async function revokeBenchmarkCredential(
  pool: Pool,
  credential: BenchmarkCredential,
): Promise<void> {
  const result = await revokeIngestionClientCredential(pool, { keyId: credential.keyId });
  if (result.status === 'temporarily_unavailable') {
    throw new Error('credential revocation failed: temporarily_unavailable');
  }
  // success / not_found / invalid_state / expired all mean the key is no longer usable.
}

/**
 * Real credential-backed authorizer built only from public package-root APIs
 * (verifyIngestionCredential from @aurora/ingestion-credentials, and the
 * IngestionRequestAuthorizer port from @aurora/ingestion-api). Never records
 * raw keys, SQL, digests, or database details.
 */
export function createBenchmarkAuthorizer(pool: Pool): IngestionRequestAuthorizer {
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
      }
    },
  };
}
