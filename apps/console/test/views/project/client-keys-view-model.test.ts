import { describe, expect, it } from 'vitest';
import {
  buildClientKeysView,
  clientKeyStatusLabel,
  isRevoked,
} from '../../../src/views/project/client-keys-view-model.js';
import type { ClientKeyMetadata } from '../../../src/monitoring/queries.js';

const activeKey: ClientKeyMetadata = {
  credentialId: 'cred_1',
  keyId: 'ck_abcdefgh',
  status: 'active',
  allowNonBrowser: false,
  origins: ['https://app.example.invalid'],
  environments: ['production'],
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
};

describe('buildClientKeysView', () => {
  it('keeps the one-time create phase separate from the list', () => {
    const view = buildClientKeysView({
      loading: false,
      error: null,
      keys: { status: 'available', data: { items: [activeKey] } },
      create: { kind: 'revealed', clientKey: 'aurora_ingest_xxx', keyId: 'ck_abcdefgh' },
    });
    expect(view.keys.kind).toBe('available');
    expect(view.create).toMatchObject({ kind: 'revealed', clientKey: 'aurora_ingest_xxx' });
  });

  it('surfaces missing list and error honestly', () => {
    const unavailable = buildClientKeysView({
      loading: false,
      error: null,
      keys: null,
      create: { kind: 'idle' },
    });
    expect(unavailable.keys.kind).toBe('unavailable');
    const errorView = buildClientKeysView({
      loading: false,
      error: '加载失败',
      keys: null,
      create: { kind: 'idle' },
    });
    expect(errorView.keys.kind).toBe('error');
  });
});

describe('status labels', () => {
  it('maps active/disabled/revoked and marks revoked terminal', () => {
    expect(clientKeyStatusLabel('active')).toBe('启用');
    expect(clientKeyStatusLabel('disabled')).toBe('已停用');
    expect(clientKeyStatusLabel('revoked')).toBe('已撤销');
    expect(isRevoked({ ...activeKey, status: 'revoked' })).toBe(true);
    expect(isRevoked(activeKey)).toBe(false);
  });
});
