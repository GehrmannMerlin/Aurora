export async function withMigrationAdvisoryLock(client, lockValue, action) {
  const lock = await client.query('SELECT pg_try_advisory_lock($1) AS "lockObtained"', [lockValue]);
  if (lock.rows[0]?.lockObtained !== true) {
    throw new Error('Another migration is already running. Advisory lock mode is set to fail.');
  }

  try {
    return await action();
  } finally {
    const unlock = await client.query('SELECT pg_advisory_unlock($1) AS "lockReleased"', [
      lockValue,
    ]);
    if (unlock.rows[0]?.lockReleased !== true) {
      throw new Error('Failed to release migration lock');
    }
  }
}
