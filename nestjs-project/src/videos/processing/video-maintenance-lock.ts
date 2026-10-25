import type { DataSource } from 'typeorm';

// Cooperative gate for scheduled maintenance and exclusive database fixture work.
export const VIDEO_MAINTENANCE_LOCK = 730319 as const;

export async function withVideoMaintenanceLock(
  dataSource: DataSource,
  action: () => Promise<void>,
): Promise<void> {
  const runner = dataSource.createQueryRunner();
  let locked = false;
  try {
    await runner.connect();
    const rows = (await runner.query(
      'SELECT pg_try_advisory_lock_shared($1) AS locked',
      [VIDEO_MAINTENANCE_LOCK],
    )) as { locked: boolean }[];
    locked = rows[0].locked;
    if (locked) await action();
  } finally {
    try {
      if (locked)
        await runner.query('SELECT pg_advisory_unlock_shared($1)', [
          VIDEO_MAINTENANCE_LOCK,
        ]);
    } finally {
      await runner.release();
    }
  }
}
