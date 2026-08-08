/**
 * Aurora public-preview composition root for ingestion-api.
 *
 * Thin, deploy-only entrypoint (plain ESM so it runs on the pruned runtime
 * image). Reads the same typed env config as the repository start path, builds
 * the real credential-backed authorizer over an owned pg Pool, uses the
 * explicit allow-all admission policy (first increment has no real rate
 * limiter), and starts Fastify. Imports from this app's own dist/index.js;
 * mirrors the production wiring proven in the integration tests. Does not
 * invent new public API. Not part of the package build; lives in deploy/preview.
 */
import {
  startIngestionApi,
  loadIngestionApiConfig,
  allowAllIngestionAdmissionPolicy,
} from './index.js';

async function main() {
  const config = loadIngestionApiConfig(process.env);
  const running = await startIngestionApi({
    config,
    admissionPolicy: allowAllIngestionAdmissionPolicy,
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
  console.error(`ingestion-api preview failed to start: ${message}`);
  process.exit(1);
});
