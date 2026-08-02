import { describe, expect, it } from 'vitest';
import type {
  IngestionCredentialVerificationResult,
  VerifyIngestionCredentialInput,
} from '../src/verification-types.js';

describe('verification types', () => {
  it('exposes the stable input shape with nullable origin', () => {
    const input: VerifyIngestionCredentialInput = {
      clientKey: 'aurora_ingest_key_secret',
      environment: 'production',
      origin: null,
    };
    expect(input.clientKey).toBe('aurora_ingest_key_secret');
    expect(input.environment).toBe('production');
    expect(input.origin).toBeNull();
  });

  it('distinguishes the five stable outcomes', () => {
    const authorized: IngestionCredentialVerificationResult = {
      status: 'authorized',
      projectId: '11111111-1111-1111-1111-111111111111',
      allowedOrigin: 'https://example.com',
    };
    const noOrigin: IngestionCredentialVerificationResult = {
      status: 'authorized',
      projectId: '11111111-1111-1111-1111-111111111111',
      allowedOrigin: null,
    };
    const unauthenticated: IngestionCredentialVerificationResult = { status: 'unauthenticated' };
    const originForbidden: IngestionCredentialVerificationResult = { status: 'origin_forbidden' };
    const envForbidden: IngestionCredentialVerificationResult = {
      status: 'environment_forbidden',
    };
    const tempUnavailable: IngestionCredentialVerificationResult = {
      status: 'temporarily_unavailable',
    };
    expect(authorized.status).toBe('authorized');
    expect(authorized.allowedOrigin).toBe('https://example.com');
    expect(noOrigin.allowedOrigin).toBeNull();
    expect(unauthenticated.status).toBe('unauthenticated');
    expect(originForbidden.status).toBe('origin_forbidden');
    expect(envForbidden.status).toBe('environment_forbidden');
    expect(tempUnavailable.status).toBe('temporarily_unavailable');
  });
});
