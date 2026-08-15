import assert from 'node:assert/strict';
import test from 'node:test';

import { withMigrationAdvisoryLock } from './migration-lock.js';

test('keeps the advisory lock held across validation and execution', async () => {
  const events = [];
  const client = {
    async query(text) {
      if (text.includes('pg_try_advisory_lock')) {
        events.push('lock');
        return { rows: [{ lockObtained: true }] };
      }
      if (text.includes('pg_advisory_unlock')) {
        events.push('unlock');
        return { rows: [{ lockReleased: true }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };

  const result = await withMigrationAdvisoryLock(client, 42, async () => {
    events.push('validate');
    events.push('execute');
    return 'done';
  });

  assert.equal(result, 'done');
  assert.deepEqual(events, ['lock', 'validate', 'execute', 'unlock']);
});

test('fails closed without running work when another migrator owns the lock', async () => {
  let actionCalled = false;
  const client = {
    async query(text) {
      assert.match(text, /pg_try_advisory_lock/u);
      return { rows: [{ lockObtained: false }] };
    },
  };

  await assert.rejects(
    withMigrationAdvisoryLock(client, 42, async () => {
      actionCalled = true;
    }),
    /Another migration is already running/u,
  );
  assert.equal(actionCalled, false);
});
