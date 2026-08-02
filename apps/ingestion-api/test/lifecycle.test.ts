import { describe, it } from 'vitest';
import { startIngestionApi } from '../src/start.js';
import { loadIngestionApiConfig } from '../src/configuration.js';
import { allowAllIngestionAdmissionPolicy } from '../src/admission-policy.js';
import type {
  AuthorizeIngestionRequestResult,
  IngestionRequestAuthorizer,
} from '../src/access-policy.js';

const projectA = '11111111-1111-1111-1111-111111111111';

const authorizer: IngestionRequestAuthorizer = {
  authorize: (): Promise<AuthorizeIngestionRequestResult> =>
    Promise.resolve({
      status: 'authorized',
      projectId: projectA,
      allowedOrigin: undefined,
    }),
};

function configWith(databaseUrl: string) {
  return loadIngestionApiConfig({
    HOST: '127.0.0.1',
    PORT: '0',
    REQUEST_BODY_LIMIT_BYTES: '1048576',
    GRACEFUL_SHUTDOWN_TIMEOUT_MS: '5000',
    DATABASE_URL: databaseUrl,
    LOG_ENABLED: 'false',
  });
}

describe('ingestion-api lifecycle and Pool ownership', () => {
  it('starts and closes cleanly on an ephemeral loopback port with a lazy Pool', async () => {
    // pg.Pool is lazy; with an unreachable URL the app still listens and
    // closes cleanly, and repeated close is safe (Pool end() runs at most once).
    const running = await startIngestionApi({
      config: configWith('postgresql://127.0.0.1:1/nonexistent'),
      authorizer,
      admissionPolicy: allowAllIngestionAdmissionPolicy,
    });
    await running.close();
    await running.close();
  });
});
