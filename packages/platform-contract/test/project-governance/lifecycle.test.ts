import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_LIFECYCLE_ARCHIVE,
  OPERATION_ID_LIFECYCLE_MOVE_TO_TRASH,
  OPERATION_ID_LIFECYCLE_RESTORE,
  lifecycleArchiveProjectBody,
  lifecycleMoveToTrashBody,
  lifecycleMoveToTrashResponse,
  lifecycleRestoreProjectBody,
} from '../../src/project-governance/lifecycle.js';

describe('C16 lifecycle contract', () => {
  it('freezes the operation ids', () => {
    expect(OPERATION_ID_LIFECYCLE_ARCHIVE).toBe('lifecycleArchiveProject');
    expect(OPERATION_ID_LIFECYCLE_RESTORE).toBe('lifecycleRestoreProject');
    expect(OPERATION_ID_LIFECYCLE_MOVE_TO_TRASH).toBe('lifecycleMoveToTrash');
  });

  it('archive/restore bodies carry only an idempotency key', () => {
    expect(
      lifecycleArchiveProjectBody.zod.safeParse({ idempotencyKey: 'k'.repeat(36) }).success,
    ).toBe(true);
    expect(
      lifecycleRestoreProjectBody.zod.safeParse({ idempotencyKey: 'k'.repeat(36) }).success,
    ).toBe(true);
  });

  it('move-to-trash requires the optimistic resourceVersion', () => {
    expect(
      lifecycleMoveToTrashBody.zod.safeParse({
        resourceVersion: '1',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
    expect(lifecycleMoveToTrashBody.zod.safeParse({ idempotencyKey: 'k'.repeat(36) }).success).toBe(
      false,
    );
  });

  it('move-to-trash response carries trashedAt + recoverableUntil', () => {
    expect(
      lifecycleMoveToTrashResponse.zod.safeParse({
        data: {
          status: 'trashed',
          projectId: 'prj_1',
          trashedAt: '2026-08-12T00:00:00.000Z',
          recoverableUntil: '2026-08-19T00:00:00.000Z',
        },
      }).success,
    ).toBe(true);
    expect(
      lifecycleMoveToTrashResponse.zod.safeParse({
        data: { status: 'trashed', projectId: 'prj_1' },
      }).success,
    ).toBe(false);
  });
});
