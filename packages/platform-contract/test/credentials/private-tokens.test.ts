import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_CREATE_PRIVATE_TOKEN,
  OPERATION_ID_LIST_PRIVATE_TOKENS,
  OPERATION_ID_REVOKE_PRIVATE_TOKEN,
  credentialsCreatePrivateTokenRequest,
  credentialsCreatePrivateTokenResponse,
  credentialsListPrivateTokensRequest,
  credentialsListPrivateTokensResponse,
  credentialsRevokePrivateTokenRequest,
  credentialsRevokePrivateTokenResponse,
} from '../../src/credentials/private-tokens.js';

const listResponse = {
  tokens: [
    {
      tokenId: 'pt_123',
      name: 'ci-token',
      scopes: ['source_maps.upload'],
      expiresAt: '2026-09-01T01:00:00.000Z',
      lastUsedAt: '2026-08-09T01:00:00.000Z',
    },
  ],
  navigationTargets: [],
};

describe('credentialsListPrivateTokens contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_LIST_PRIVATE_TOKENS).toBe('credentialsListPrivateTokens');
  });

  it('accepts a valid tokens request', () => {
    expect(
      credentialsListPrivateTokensRequest.zod.safeParse({ organizationId: 'org_1' }).success,
    ).toBe(true);
  });

  it('accepts a valid tokens response', () => {
    expect(credentialsListPrivateTokensResponse.zod.safeParse(listResponse).success).toBe(true);
  });

  it('rejects a leaked token plaintext in the list', () => {
    expect(
      credentialsListPrivateTokensResponse.zod.safeParse({
        tokens: [{ ...listResponse.tokens[0], tokenPlaintext: 'aurora_pt_secret' }],
        navigationTargets: [],
      }).success,
    ).toBe(false);
  });

  it('rejects a leaked token digest in the list', () => {
    expect(
      credentialsListPrivateTokensResponse.zod.safeParse({
        tokens: [{ ...listResponse.tokens[0], tokenDigest: 'sha256:abc' }],
        navigationTargets: [],
      }).success,
    ).toBe(false);
  });
});

describe('credentialsCreatePrivateToken contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_CREATE_PRIVATE_TOKEN).toBe('credentialsCreatePrivateToken');
  });

  it('accepts a valid create request', () => {
    expect(
      credentialsCreatePrivateTokenRequest.zod.safeParse({
        name: 'ci-token',
        scopes: ['source_maps.upload'],
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing scope allowlist', () => {
    expect(
      credentialsCreatePrivateTokenRequest.zod.safeParse({
        name: 'ci-token',
        scopes: [],
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(false);
  });

  it('accepts a valid create response with one-time plaintext', () => {
    expect(
      credentialsCreatePrivateTokenResponse.zod.safeParse({
        tokenId: 'pt_123',
        tokenPlaintext: 'aurora_pt_pt_123_abcdef1234567890',
        scopes: ['source_maps.upload'],
        expiresAt: '2026-09-01T01:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects a create response leaking a digest', () => {
    expect(
      credentialsCreatePrivateTokenResponse.zod.safeParse({
        tokenId: 'pt_123',
        tokenPlaintext: 'aurora_pt_pt_123_abcdef1234567890',
        tokenDigest: 'sha256:abc',
        scopes: [],
      }).success,
    ).toBe(false);
  });
});

describe('credentialsRevokePrivateToken contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_REVOKE_PRIVATE_TOKEN).toBe('credentialsRevokePrivateToken');
  });

  it('accepts a valid revoke request', () => {
    expect(
      credentialsRevokePrivateTokenRequest.zod.safeParse({
        organizationId: 'org_1',
        tokenId: 'pt_123',
      }).success,
    ).toBe(true);
  });

  it('accepts a valid revoke response', () => {
    expect(
      credentialsRevokePrivateTokenResponse.zod.safeParse({
        status: 'succeeded',
        tokenId: 'pt_123',
      }).success,
    ).toBe(true);
  });
});
