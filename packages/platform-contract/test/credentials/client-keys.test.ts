import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_CREDENTIALS_CREATE,
  OPERATION_ID_CREDENTIALS_DISABLE,
  OPERATION_ID_CREDENTIALS_ENABLE,
  OPERATION_ID_CREDENTIALS_LIST,
  OPERATION_ID_CREDENTIALS_REVOKE,
  credentialsCreateClientKeyBody,
  credentialsCreateClientKeyResponse,
  credentialsDisableClientKeyBody,
  credentialsListClientKeysResponse,
  credentialsRevokeClientKeyResponse,
} from '../../src/credentials/client-keys.js';

describe('C14 client-key contract', () => {
  it('freezes the operation ids', () => {
    expect(OPERATION_ID_CREDENTIALS_LIST).toBe('credentialsListClientKeys');
    expect(OPERATION_ID_CREDENTIALS_CREATE).toBe('credentialsCreateClientKey');
    expect(OPERATION_ID_CREDENTIALS_DISABLE).toBe('credentialsDisableClientKey');
    expect(OPERATION_ID_CREDENTIALS_ENABLE).toBe('credentialsEnableClientKey');
    expect(OPERATION_ID_CREDENTIALS_REVOKE).toBe('credentialsRevokeClientKey');
  });

  it('list response is metadata-only (no secret field)', () => {
    const result = credentialsListClientKeysResponse.zod.safeParse({
      data: {
        status: 'available',
        data: {
          items: [
            {
              credentialId: 'cred_1',
              keyId: 'ck_abcdefgh',
              status: 'active',
              allowNonBrowser: false,
              origins: ['https://app.example.invalid'],
              environments: ['production'],
              createdAt: '2026-08-12T00:00:00.000Z',
              updatedAt: '2026-08-12T00:00:00.000Z',
            },
          ],
        },
      },
      meta: { requestId: 'req_1', readAt: '2026-08-12T00:00:00.000Z', normalizedQuery: {} },
      allowedActions: ['read'],
      navigationTargets: [],
    });
    expect(result.success).toBe(true);
  });

  it('create body accepts origins/environments/allowNonBrowser/expiresAt', () => {
    expect(
      credentialsCreateClientKeyBody.zod.safeParse({
        origins: ['https://app.example.invalid'],
        environments: ['production'],
        allowNonBrowser: false,
        expiresAt: '2026-09-01T00:00:00.000Z',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
    expect(
      credentialsCreateClientKeyBody.zod.safeParse({
        origins: [],
        environments: ['production'],
        allowNonBrowser: false,
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('create response carries the one-time clientKey', () => {
    expect(
      credentialsCreateClientKeyResponse.zod.safeParse({
        data: {
          status: 'created',
          credentialId: 'cred_1',
          keyId: 'ck_abcdefgh',
          clientKey: 'aurora_ingest_abcdefgh_secretsecretsecret',
          origins: [],
          environments: ['production'],
        },
      }).success,
    ).toBe(true);
    // The one-time secret is required in the first response.
    expect(
      credentialsCreateClientKeyResponse.zod.safeParse({
        data: {
          status: 'created',
          credentialId: 'cred_1',
          keyId: 'ck_abcdefgh',
          origins: [],
          environments: [],
        },
      }).success,
    ).toBe(false);
  });

  it('mutation bodies carry an idempotency key', () => {
    expect(
      credentialsDisableClientKeyBody.zod.safeParse({ idempotencyKey: 'k'.repeat(36) }).success,
    ).toBe(true);
    expect(
      credentialsRevokeClientKeyResponse.zod.safeParse({
        data: { status: 'revoked', credentialId: 'cred_1', keyId: 'ck_abcdefgh' },
      }).success,
    ).toBe(true);
  });
});
