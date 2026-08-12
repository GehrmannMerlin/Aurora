import type { Pool } from 'pg';
import { bootstrapPlatformAdmins, countPlatformAdmins } from '@aurora/platform-admin';

/**
 * PLT-10a Task 6: controlled platform-admin bootstrap (ADR-034 / spec §bootstrap).
 *
 * Only runs when the configured account-id list is non-empty AND the
 * `platform_admins` set is currently empty — once any admin exists the
 * capability is maintained exclusively through the admin routes (grant/revoke),
 * so bootstrap never re-seeds. The `admin_bootstrapped` platform-audit event is
 * written by `bootstrapPlatformAdmins` inside the same transaction.
 *
 * Failure is surfaced as a BOUNDED log (no account ids / tokens) and reported as
 * `{ status: 'failed' }` so startup continues; the operator is expected to seed
 * the set manually before any platform admin is required.
 */
export type PlatformAdminBootstrapResult =
  | { readonly status: 'skipped' }
  | { readonly status: 'seeded'; readonly seeded: number }
  | { readonly status: 'failed' };

export interface RunPlatformAdminBootstrapInput {
  readonly accountIds: readonly string[];
  readonly bootstrapBy: string;
}

export async function runPlatformAdminBootstrap(
  pool: Pool,
  input: RunPlatformAdminBootstrapInput,
): Promise<PlatformAdminBootstrapResult> {
  if (input.accountIds.length === 0) {
    return { status: 'skipped' };
  }
  try {
    const count = await countPlatformAdmins(pool);
    if (count > 0) {
      return { status: 'skipped' };
    }
    const { seeded } = await bootstrapPlatformAdmins(pool, {
      accountIds: input.accountIds,
      bootstrapBy: input.bootstrapBy,
    });
    return { status: 'seeded', seeded };
  } catch {
    console.error(
      '[platform-admin-bootstrap] failed to bootstrap platform admins; no platform admins were seeded and the set must be seeded manually before any platform admin is required.',
    );
    return { status: 'failed' };
  }
}
