/**
 * Aurora public-preview composition root for ingestion-worker.
 *
 * Thin, deploy-only entrypoint (plain ESM so it runs on the pruned runtime
 * image). Wires the real production composition over one owned pg Pool, passes
 * the same Pool to the worker start path so the Pool is owned and closed
 * exactly once, and starts the worker. The production composition is
 * idempotent-close and never opens a Pool. Mirrors the wiring proven in the
 * integration tests. Does not invent new public API. Not part of the package
 * build; lives in deploy/preview.
 */
import pg from 'pg';
import {
  startIngestionWorker,
  loadIngestionWorkerConfig,
  createProductionIngestionWorker,
} from './index.js';

const { Pool } = pg;

async function main() {
  const config = loadIngestionWorkerConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const { processor } = createProductionIngestionWorker({ config, pool });
  const running = await startIngestionWorker({
    config,
    processor,
    poolFactory: () => pool,
  });
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
  console.error(`ingestion-worker preview failed to start: ${message}`);
  process.exit(1);
});
