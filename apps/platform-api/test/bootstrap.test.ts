import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

const { countPlatformAdminsMock, bootstrapPlatformAdminsMock } = vi.hoisted(() => ({
  countPlatformAdminsMock: vi.fn(),
  bootstrapPlatformAdminsMock: vi.fn(),
}));
vi.mock('@aurora/platform-admin', () => ({
  countPlatformAdmins: countPlatformAdminsMock,
  bootstrapPlatformAdmins: bootstrapPlatformAdminsMock,
}));

import { runPlatformAdminBootstrap } from '../src/bootstrap.js';

const pool = {} as Pool;
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';

describe('runPlatformAdminBootstrap', () => {
  afterEach(() => {
    countPlatformAdminsMock.mockReset();
    bootstrapPlatformAdminsMock.mockReset();
  });

  it('skips without querying when no account ids are configured', async () => {
    const result = await runPlatformAdminBootstrap(pool, {
      accountIds: [],
      bootstrapBy: ACCOUNT_A,
    });
    expect(result).toEqual({ status: 'skipped' });
    expect(countPlatformAdminsMock).not.toHaveBeenCalled();
    expect(bootstrapPlatformAdminsMock).not.toHaveBeenCalled();
  });

  it('skips when the platform admin set is not empty', async () => {
    countPlatformAdminsMock.mockResolvedValue(2);
    const result = await runPlatformAdminBootstrap(pool, {
      accountIds: [ACCOUNT_A],
      bootstrapBy: ACCOUNT_A,
    });
    expect(result).toEqual({ status: 'skipped' });
    expect(bootstrapPlatformAdminsMock).not.toHaveBeenCalled();
  });

  it('seeds when the set is empty and returns the seeded count', async () => {
    countPlatformAdminsMock.mockResolvedValue(0);
    bootstrapPlatformAdminsMock.mockResolvedValue({ seeded: 2 });
    const result = await runPlatformAdminBootstrap(pool, {
      accountIds: [ACCOUNT_A, ACCOUNT_B],
      bootstrapBy: ACCOUNT_A,
    });
    expect(result).toEqual({ status: 'seeded', seeded: 2 });
    expect(bootstrapPlatformAdminsMock).toHaveBeenCalledWith(pool, {
      accountIds: [ACCOUNT_A, ACCOUNT_B],
      bootstrapBy: ACCOUNT_A,
    });
  });

  it('warns with a bounded message (no account ids) when bootstrap seeds zero admins', async () => {
    countPlatformAdminsMock.mockResolvedValue(0);
    bootstrapPlatformAdminsMock.mockResolvedValue({ seeded: 0 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await runPlatformAdminBootstrap(pool, {
        accountIds: [ACCOUNT_A, ACCOUNT_B],
        bootstrapBy: ACCOUNT_A,
      });
      expect(result).toEqual({ status: 'seeded', seeded: 0 });
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toContain('no admins');
      expect(warnSpy.mock.calls[0]?.[0]).not.toContain(ACCOUNT_A);
      expect(warnSpy.mock.calls[0]?.[0]).not.toContain(ACCOUNT_B);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns failed with a bounded log when counting fails', async () => {
    countPlatformAdminsMock.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await runPlatformAdminBootstrap(pool, {
        accountIds: [ACCOUNT_A],
        bootstrapBy: ACCOUNT_A,
      });
      expect(result).toEqual({ status: 'failed' });
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]?.[0]).not.toContain(ACCOUNT_A);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns failed with a bounded log when seeding fails', async () => {
    countPlatformAdminsMock.mockResolvedValue(0);
    bootstrapPlatformAdminsMock.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await runPlatformAdminBootstrap(pool, {
        accountIds: [ACCOUNT_A],
        bootstrapBy: ACCOUNT_A,
      });
      expect(result).toEqual({ status: 'failed' });
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]?.[0]).not.toContain(ACCOUNT_A);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
