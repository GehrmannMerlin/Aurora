/**
 * Aurora public-preview composition root for platform-api.
 *
 * Thin, deploy-only entrypoint (plain ESM so it runs on the pruned runtime
 * image). Reads the same typed env config as the repository start path, builds
 * the real Fastify server over an owned pg Pool + the Redis session store
 * (`buildPlatformServer`), and starts it. `startPlatformApi` lives in the
 * app's dist/start.js (not re-exported from index.js), so this entrypoint
 * imports from both modules. Imports from this app's own dist; mirrors the
 * production wiring proven in the integration tests. Does not invent new
 * public API. Not part of the package build; lives in deploy/preview.
 */
import { loadPlatformApiConfig } from './index.js';
import { startPlatformApi } from './start.js';

async function main() {
  const config = loadPlatformApiConfig(process.env);
  const running = await startPlatformApi({ config });
  const onSignal = async () => {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    await running.close();
    process.exit(0);
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`platform-api preview failed to start: ${message}`);
  process.exit(1);
});
