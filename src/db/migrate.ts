/** مُشغّل الهجرات: يطبّق الهجرات غير المطبّقة داخل معاملات، ويسجّلها. */
import type { DB } from './db.ts';
import { MIGRATIONS } from './migrations.ts';
import { getLogger } from '../lib/logger.ts';

export function runMigrations(db: DB): { applied: string[] } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const isApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?');
  const record = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  const applied: string[] = [];
  const log = getLogger();

  for (const migration of MIGRATIONS) {
    if (isApplied.get(migration.id)) continue;
    const tx = db.transaction(() => {
      db.exec(migration.up);
      record.run(migration.id, Date.now());
    });
    tx();
    applied.push(migration.id);
    log.info({ migration: migration.id }, 'تطبيق هجرة');
  }
  return { applied };
}
