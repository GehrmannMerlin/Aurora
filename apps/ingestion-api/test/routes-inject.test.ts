import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildIngestionApi } from '../src/app.js';
import type {
  AuthorizeIngestionRequestResult,
  IngestionRequestAuthorizer,
} from '../src/access-policy.js';
import type {
  CheckIngestionAdmissionResult,
  IngestionAdmissionPolicy,
} from '../src/admission-policy.js';
import type { PersistIngestionBatchPort } from '../src/routes/ingestion-batches.js';
import type { PersistIngestionBatchResult } from '@aurora/ingestion-inbox';
import { IngestionInboxError } from '@aurora/ingestion-inbox';

const validConfig = {
  host: '127.0.0.1',
  port: 0,
  requestBodyLimitBytes: 1024 * 1024,
  gracefulShutdownTimeoutMs: 1000,
  databaseUrl: 'postgresql://placeholder',
  logEnabled: false,
  logLevel: 'info',
};

const projectA = '11111111-1111-1111-1111-111111111111';

function validBatch(): unknown {
  return {
    protocolVersion: 1,
    events: [
      {
        protocolVersion: 1,
        eventId: 'evt-http-001',
        eventType: 'error',
        occurredAt: 1_800_000_000_000,
        body: {},
      },
    ],
  };
}

type AuthorizerStatus =
  | 'authorized'
  | 'unauthenticated'
  | 'originForbidden'
  | 'environmentForbidden'
  | 'temporarilyUnavailable';

interface FakeAuthorizerOptions {
  readonly status?: AuthorizerStatus;
  readonly projectId?: string;
}

function makeAuthorizer(options: FakeAuthorizerOptions = {}): IngestionRequestAuthorizer {
  return {
    authorize: (): Promise<AuthorizeIngestionRequestResult> => {
      switch (options.status ?? 'authorized') {
        case 'authorized':
          return Promise.resolve({
            status: 'authorized',
            projectId: options.projectId ?? projectA,
            allowedOrigin: undefined,
          });
        case 'unauthenticated':
          return Promise.resolve({ status: 'unauthenticated' });
        case 'originForbidden':
          return Promise.resolve({ status: 'originForbidden' });
        case 'environmentForbidden':
          return Promise.resolve({ status: 'environmentForbidden' });
        case 'temporarilyUnavailable':
          return Promise.resolve({ status: 'temporarilyUnavailable' });
      }
    },
  };
}

function makePersist(result: PersistIngestionBatchResult): PersistIngestionBatchPort {
  return {
    persistBatch: (): Promise<PersistIngestionBatchResult> => Promise.resolve(result),
  };
}

function makeAdmission(result: 'allow' | { retryAfterMs: number }): IngestionAdmissionPolicy {
  return {
    check: (): Promise<CheckIngestionAdmissionResult> => {
      if (result === 'allow') return Promise.resolve({ status: 'allow' });
      return Promise.resolve({ status: 'temporarilyRejected', retryAfterMs: result.retryAfterMs });
    },
  };
}

function buildApp(
  deps: {
    authorizer?: IngestionRequestAuthorizer;
    persist?: PersistIngestionBatchPort;
    admission?: IngestionAdmissionPolicy;
    pool?: Pool;
  } = {},
): FastifyInstance {
  const pool = deps.pool ?? ({ query: () => Promise.resolve({ rows: [] }) } as unknown as Pool);
  return buildIngestionApi({
    config: validConfig,
    pool,
    authorizer: deps.authorizer ?? makeAuthorizer(),
    admissionPolicy: deps.admission ?? makeAdmission('allow'),
    persist: deps.persist ?? makePersist({ perEventResults: [] }),
  });
}

interface ReceiptBody {
  readonly batchState?: string;
  readonly perEventResults?: readonly { readonly state?: string }[];
}

function receiptBody(response: { json(): unknown }): ReceiptBody {
  return response.json() as ReceiptBody;
}

describe('ingestion-api POST /v1/batches', () => {
  it('returns 200 with accepted receipt for a valid authorized batch', async () => {
    const app = buildApp({
      persist: makePersist({
        perEventResults: [{ eventId: 'evt-http-001', outcome: 'inserted' }],
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
        'x-aurora-environment': 'production',
      },
      payload: JSON.stringify(validBatch()),
    });
    expect(response.statusCode).toBe(200);
    const body = receiptBody(response);
    expect(body.perEventResults ?? []).toHaveLength(1);
    expect(body.perEventResults?.[0]?.state).toBe('accepted');
    expect(response.headers['x-aurora-request-id']).toBeDefined();
    await app.close();
  });

  it('returns duplicate_accepted for a duplicate event', async () => {
    const app = buildApp({
      persist: makePersist({
        perEventResults: [{ eventId: 'evt-http-001', outcome: 'duplicate' }],
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
        'x-aurora-environment': 'production',
      },
      payload: JSON.stringify(validBatch()),
    });
    expect(response.statusCode).toBe(200);
    expect(receiptBody(response).perEventResults?.[0]?.state).toBe('duplicate_accepted');
    await app.close();
  });

  it('returns 401 for a missing client key', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-environment': 'production',
      },
      payload: JSON.stringify(validBatch()),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns 400 for missing environment header', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
      },
      payload: JSON.stringify(validBatch()),
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 401 when the authorizer says unauthenticated', async () => {
    const app = buildApp({ authorizer: makeAuthorizer({ status: 'unauthenticated' }) });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'bad-key',
        'x-aurora-environment': 'production',
      },
      payload: JSON.stringify(validBatch()),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns 403 for origin forbidden', async () => {
    const app = buildApp({ authorizer: makeAuthorizer({ status: 'originForbidden' }) });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
        'x-aurora-environment': 'production',
        origin: 'https://evil.example',
      },
      payload: JSON.stringify(validBatch()),
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('returns 403 for environment forbidden', async () => {
    const app = buildApp({ authorizer: makeAuthorizer({ status: 'environmentForbidden' }) });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
        'x-aurora-environment': 'staging',
      },
      payload: JSON.stringify(validBatch()),
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('returns 503 when the authorizer is temporarily unavailable', async () => {
    const app = buildApp({ authorizer: makeAuthorizer({ status: 'temporarilyUnavailable' }) });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
        'x-aurora-environment': 'production',
      },
      payload: JSON.stringify(validBatch()),
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it('returns 429 with Retry-After when admission rejects', async () => {
    const app = buildApp({ admission: makeAdmission({ retryAfterMs: 2500 }) });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
        'x-aurora-environment': 'production',
      },
      payload: JSON.stringify(validBatch()),
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('3');
    await app.close();
  });

  it('returns 400 for malformed JSON body', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
        'x-aurora-environment': 'production',
      },
      payload: 'not-json',
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for an invalid batch', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
        'x-aurora-environment': 'production',
      },
      payload: JSON.stringify({ protocolVersion: 2, events: [] }),
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 503 without accepted when persistBatch throws a stable error', async () => {
    const app = buildApp({
      persist: {
        persistBatch: (): Promise<PersistIngestionBatchResult> =>
          Promise.reject(
            new IngestionInboxError('database_unavailable', 'database is unavailable'),
          ),
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
        'x-aurora-environment': 'production',
      },
      payload: JSON.stringify(validBatch()),
    });
    expect(response.statusCode).toBe(503);
    const body = receiptBody(response);
    expect(JSON.stringify(body)).not.toContain('accepted');
    expect(JSON.stringify(body)).not.toContain('database is unavailable');
    await app.close();
  });

  it('handles a mixed batch with accepted and duplicate events', async () => {
    const app = buildApp({
      persist: makePersist({
        perEventResults: [
          { eventId: 'evt-http-001', outcome: 'inserted' },
          { eventId: 'evt-http-002', outcome: 'duplicate' },
        ],
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
        'x-aurora-environment': 'production',
      },
      payload: JSON.stringify({
        protocolVersion: 1,
        events: [
          {
            protocolVersion: 1,
            eventId: 'evt-http-001',
            eventType: 'error',
            occurredAt: 1_800_000_000_000,
            body: {},
          },
          {
            protocolVersion: 1,
            eventId: 'evt-http-002',
            eventType: 'error',
            occurredAt: 1_800_000_000_000,
            body: {},
          },
        ],
      }),
    });
    expect(response.statusCode).toBe(200);
    const results = receiptBody(response).perEventResults ?? [];
    expect(results.map((row) => row.state)).toEqual(['accepted', 'duplicate_accepted']);
    await app.close();
  });
});

describe('ingestion-api OPTIONS/CORS', () => {
  it('returns 204 with reflected origin for a valid preflight', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/batches',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-aurora-client-key, x-aurora-environment',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(response.headers.vary).toContain('Origin');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).not.toContain('*');
    await app.close();
  });

  it('rejects a preflight with a non-POST method', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/batches',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'GET',
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a preflight with a disallowed header', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/batches',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a preflight with a null origin', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/batches',
      headers: {
        origin: 'null',
        'access-control-request-method': 'POST',
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a preflight with an origin that has a path', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/batches',
      headers: {
        origin: 'https://app.example.com/some/path',
        'access-control-request-method': 'POST',
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
