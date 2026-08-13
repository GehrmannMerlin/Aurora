import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_PRODUCTION_ORDER,
  analyzeMigrationOrder,
  compareMigrationNames,
} from './migration-order.js';

const globallySortedBaseline = [...LEGACY_PRODUCTION_ORDER].sort(compareMigrationNames);
const sourceFiles = globallySortedBaseline.map((name) => `${name}.ts`);

test('fresh database uses strict global ordering', () => {
  const result = analyzeMigrationOrder(sourceFiles, []);
  assert.equal(result.compatibility, 'strict');
  assert.equal(result.checkOrder, true);
  assert.deepEqual(result.pendingNames, globallySortedBaseline);
});

test('normally upgraded database keeps strict order checking', () => {
  const executed = globallySortedBaseline.slice(0, 9);
  const result = analyzeMigrationOrder(sourceFiles, executed);
  assert.equal(result.checkOrder, true);
  assert.deepEqual(result.pendingNames, globallySortedBaseline.slice(9));
});

test('exact production ledger uses the frozen compatibility path', () => {
  const result = analyzeMigrationOrder(sourceFiles, [...LEGACY_PRODUCTION_ORDER]);
  assert.equal(result.compatibility, 'approved-production-legacy');
  assert.equal(result.checkOrder, false);
  assert.deepEqual(result.pendingNames, []);
});

test('future migrations remain globally ordered after the frozen baseline', () => {
  const future = ['1897000000002_future-a', '1897000000003_future-b'];
  const result = analyzeMigrationOrder(
    [...sourceFiles, ...future.map((name) => `${name}.ts`)],
    [...LEGACY_PRODUCTION_ORDER, future[0]],
  );
  assert.equal(result.compatibility, 'approved-production-legacy');
  assert.deepEqual(result.pendingNames, [future[1]]);
});

test('rejects a backdated migration added after the production baseline', () => {
  assert.throws(
    () =>
      analyzeMigrationOrder(
        [...sourceFiles, '1786800000000_backdated.ts'],
        [...LEGACY_PRODUCTION_ORDER],
      ),
    /sorts before the frozen production baseline/u,
  );
});

test('rejects missing, duplicate, and unknown ledger entries', () => {
  assert.throws(
    () => analyzeMigrationOrder([...sourceFiles, sourceFiles[0]], []),
    /duplicate migration/u,
  );
  assert.throws(
    () => analyzeMigrationOrder(sourceFiles, ['9999999999999_unknown']),
    /missing from release sources/u,
  );
});
