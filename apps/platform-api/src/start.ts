import { buildPlatformServer } from './index.js';
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
  await handle.app.listen({ host: options.config.host, port: options.config.port });
  return {
    close: async () => {
      await handle.close();
    },
  };
}
