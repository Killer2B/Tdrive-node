/** أمر CLI لتطبيق الهجرات يدويًّا: npm run db:migrate */
import { getDb, closeDb } from './db.ts';
import { runMigrations } from './migrate.ts';

try {
  const db = getDb();
  const { applied } = runMigrations(db);
  if (applied.length === 0) console.log('لا هجرات جديدة. القاعدة محدّثة.');
  else console.log(`طُبّقت الهجرات: ${applied.join(', ')}`);
} catch (e) {
  console.error('فشل تطبيق الهجرات:', e);
  process.exitCode = 1;
} finally {
  closeDb();
}
