/** أمر CLI لتشغيل نسخة احتياطية فورًا: npm run backup:now */
import { closePool, ping } from '../db/pg.ts';
import { runMigrations } from '../db/migrate.ts';
import { runBackup } from '../services/backup.ts';

try {
  await ping();
  await runMigrations();
  const summary = await runBackup('manual');
  if (summary.results.length === 0) console.log('لم تُنتَج أي نسخة (تحقّق من الإعدادات/السجلّ).');
  else {
    for (const r of summary.results) console.log(`${r.kind}: ${r.key} (${r.bytes} بايت)`);
  }
} catch (e) {
  console.error('فشل النسخ الاحتياطي:', e);
  process.exitCode = 1;
} finally {
  await closePool();
}
