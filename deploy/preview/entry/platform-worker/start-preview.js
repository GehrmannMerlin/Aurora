/**
 * Aurora public-preview composition root for platform-worker.
 *
 * Thin, deploy-only entrypoint (plain ESM so it runs on the pruned runtime
 * image). Reads the same typed env config as the repository start path,
 * creates the pg Pool it owns, and starts the outbox email consumer via
 * `startPlatformWorker` (SIGTERM/SIGINT registered internally). The worker is
 * stop-once/idempotent-close, so the entrypoint's own signal handlers are a
 * safe mirror of the ingestion-app pattern. `startPlatformWorker` lives in
 * the app's dist/start.js (not re-exported from index.js), so this entrypoint
 * imports from both modules. Does not invent new public API. Not part of the
 * package build; lives in deploy/preview.
 */
import { loadPlatformWorkerConfig } from './index.js';
import { startPlatformWorker } from './start.js';

async function main() {
  const config = loadPlatformWorkerConfig(process.env);
  const running = await startPlatformWorker({ config });
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
  console.error(`platform-worker preview failed to start: ${message}`);
  process.exit(1);
});
