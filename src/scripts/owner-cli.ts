/** أمر CLI لإنشاء/تحديث كلمة مرور المالك: npm run owner:set -- <username> <password> */
import { getDb, closeDb } from '../db/db.ts';
import { runMigrations } from '../db/migrate.ts';
import { setOwner } from '../services/auth.ts';

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error('الاستخدام: npm run owner:set -- <username> <password>');
  process.exit(1);
}

try {
  runMigrations(getDb());
  await setOwner(username, password);
  console.log(`تمّ ضبط المالك: ${username}`);
} catch (e) {
  console.error('فشل:', e);
  process.exitCode = 1;
} finally {
  closeDb();
}
