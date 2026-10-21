/** أمر CLI للتحقّق من مخطّط Supabase: npm run db:migrate */
import { closePool, getSchema, ping } from './pg.ts';
import { runMigrations } from './migrate.ts';

try {
  await ping();
  const { applied } = await runMigrations();
  if (applied.length === 0) console.log(`مخطّط Supabase "${getSchema()}" سليم ومُسجَّل.`);
  else console.log(`سُجّلت: ${applied.join(', ')}`);
} catch (e) {
  console.error('فشل التحقّق من مخطّط Supabase:', e);
  process.exitCode = 1;
} finally {
  await closePool();
}
