import { describe, expect, it } from 'vitest';
import { generateClientKeyPair } from '../src/lifecycle-create.js';
import { KEY_ID_LENGTH, SECRET_LENGTH } from '../src/client-key.js';
import type {
  CreateIngestionClientCredentialInput,
  CreateIngestionClientCredentialResult,
  CredentialMetadata,
  MutateIngestionClientCredentialInput,
  MutateIngestionClientCredentialResult,
  RotateIngestionClientCredentialInput,
  RotateIngestionClientCredentialResult,
} from '../src/lifecycle-types.js';

describe('credential lifecycle types', () => {
  it('exposes credential metadata without a secret digest', () => {
    const metadata: CredentialMetadata = {
      credentialId: '11111111-1111-1111-1111-111111111111',
      projectId: '11111111-1111-1111-1111-111111111111',
      keyId: 'AAAAAAAAAAAAAAAAAAAAAA',
      status: 'active',
      allowNonBrowser: false,
      expiresAt: null,
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    };
    expect(metadata.keyId).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(metadata.status).toBe('active');
    expect(metadata.expiresAt).toBeNull();
    const hasDigest = 'secretDigest' in metadata;
    expect(hasDigest).toBe(false);
  });

  it('distinguishes create results', () => {
    const success: CreateIngestionClientCredentialResult = {
      status: 'success',
      metadata: {} as CredentialMetadata,
      clientKey: 'aurora_ingest_k_s',
    };
    const invalid: CreateIngestionClientCredentialResult = { status: 'invalid_input' };
    const temp: CreateIngestionClientCredentialResult = { status: 'temporarily_unavailable' };
    const genFailed: CreateIngestionClientCredentialResult = { status: 'generation_failed' };
    expect(success.status).toBe('success');
    expect(success.clientKey).toContain('aurora_ingest_');
    expect(invalid.status).toBe('invalid_input');
    expect(temp.status).toBe('temporarily_unavailable');
    expect(genFailed.status).toBe('generation_failed');
  });

  it('distinguishes rotate results', () => {
    const results: RotateIngestionClientCredentialResult[] = [
      { status: 'success', metadata: {} as CredentialMetadata, clientKey: 'aurora_ingest_x_y' },
      { status: 'not_found' },
      { status: 'invalid_state' },
      { status: 'expired' },
      { status: 'temporarily_unavailable' },
      { status: 'generation_failed' },
    ];
    expect(results.map((r) => r.status)).toEqual([
      'success',
      'not_found',
      'invalid_state',
      'expired',
      'temporarily_unavailable',
      'generation_failed',
    ]);
  });

  it('distinguishes mutate results', () => {
    const results: MutateIngestionClientCredentialResult[] = [
      { status: 'success', metadata: {} as CredentialMetadata },
      { status: 'not_found' },
      { status: 'invalid_state' },
      { status: 'expired' },
      { status: 'temporarily_unavailable' },
    ];
    expect(results.map((r) => r.status)).toEqual([
      'success',
      'not_found',
      'invalid_state',
      'expired',
      'temporarily_unavailable',
    ]);
  });

  it('create input does not allow providing keyId, secret, digest, or status', () => {
    const input: CreateIngestionClientCredentialInput = {
      projectId: '11111111-1111-1111-1111-111111111111',
      origins: ['https://a.example.com'],
      environments: ['production'],
      allowNonBrowser: false,
      expiresAt: null,
    };
    expect(input.projectId).toBeTruthy();
    const hasKeyId = 'keyId' in input;
    const hasSecret = 'secret' in input;
    const hasDigest = 'digest' in input;
    const hasStatus = 'status' in input;
    expect(hasKeyId).toBe(false);
    expect(hasSecret).toBe(false);
    expect(hasDigest).toBe(false);
    expect(hasStatus).toBe(false);
  });

  it('rotate and mutate inputs reference a credential by keyId', () => {
    const rotate: RotateIngestionClientCredentialInput = { keyId: 'AAAAAAAAAAAAAAAAAAAAAA' };
    const mutate: MutateIngestionClientCredentialInput = { keyId: 'AAAAAAAAAAAAAAAAAAAAAA' };
    expect(rotate.keyId).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(mutate.keyId).toBe('AAAAAAAAAAAAAAAAAAAAAA');
  });
});

describe('generateClientKeyPair', () => {
  it('produces a key with the exact encoded lengths and no padding', () => {
    const { keyId, secret, clientKey } = generateClientKeyPair();
    expect(keyId.length).toBe(KEY_ID_LENGTH);
    expect(secret.length).toBe(SECRET_LENGTH);
    expect(clientKey).toBe(`aurora_ingest_${keyId}_${secret}`);
    expect(keyId).not.toMatch(/[+/=]/);
    expect(secret).not.toMatch(/[+/=]/);
    expect(keyId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces different keyIds and secrets on successive calls', () => {
    const a = generateClientKeyPair();
    const b = generateClientKeyPair();
    expect(a.keyId).not.toBe(b.keyId);
    expect(a.secret).not.toBe(b.secret);
  });
});
