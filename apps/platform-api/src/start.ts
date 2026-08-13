import type { Pool } from 'pg';
import { buildPlatformServer } from './index.js';
import { runPlatformAdminBootstrap } from './bootstrap.js';
import type { PlatformApiConfig } from './config.js';

export interface StartPlatformApiOptions {
  readonly config: PlatformApiConfig;
}

export interface RunningPlatformApi {
  readonly close: () => Promise<void>;
}

/**
 * Server start: wire the composition root, listen, and register shutdown so the
 * Pool + Redis session store are closed exactly once after Fastify stops
 * accepting and drains in-flight requests.
 */
export async function startPlatformApi(
  options: StartPlatformApiOptions,
): Promise<RunningPlatformApi> {
  const handle = await buildPlatformServer({ config: options.config });
  await bootstrapPlatformAdminsWhenConfigured(handle.pool, options.config);
  await handle.app.listen({ host: options.config.host, port: options.config.port });
  return {
    close: async () => {
      await handle.close();
    },
  };
}

/**
 * PLT-10a Task 6: before accepting traffic, seed the platform admin set when
 * `PLATFORM_ADMIN_BOOTSTRAP_ACCOUNT_IDS` is configured. The first configured
 * account id is the `bootstrapBy` actor (it must be a real account, satisfying
 * the `accounts` FK). Empty config → no-op; a failure is bounded-logged by
 * `runPlatformAdminBootstrap` and never crashes startup.
 */
async function bootstrapPlatformAdminsWhenConfigured(
  pool: Pool,
  config: PlatformApiConfig,
): Promise<void> {
  const accountIds = config.platformAdminBootstrapAccountIds;
  const bootstrapBy = accountIds[0];
  if (bootstrapBy === undefined) return;
  await runPlatformAdminBootstrap(pool, { accountIds, bootstrapBy });
}
