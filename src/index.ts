/** نقطة الدخول: تهيئة القاعدة، الهجرات، المالك، الخادم، الطابور، والمجدوِل + إيقاف سلس. */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config/env.ts';
import { getLogger } from './lib/logger.ts';
import { closePool, ping } from './db/pg.ts';
import { runMigrations } from './db/migrate.ts';
import { ensureOwner } from './services/auth.ts';
import { buildServer } from './server.ts';
import { startQueue, stopQueue } from './services/queue.ts';
import { startScheduler, stopScheduler } from './services/scheduler.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger();

  // تأكّد من وجود مجلّدات البيانات
  mkdirSync(path.resolve(cfg.storage.localDir), { recursive: true });
  mkdirSync(path.resolve(cfg.storage.tmpDir), { recursive: true });

  // القاعدة (Supabase/Postgres) + التحقّق من المخطّط + المالك
  await ping();
  await runMigrations();
  await ensureOwner();

  const app = await buildServer();
  startQueue();
  startScheduler();

  await app.listen({ host: cfg.host, port: cfg.port });
  log.info(`Tdrive يعمل: ${cfg.publicUrl} (التخزين: ${cfg.storage.driver})`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'بدء الإيقاف السلس');
    stopScheduler();
    try {
      await stopQueue();
      await app.close();
    } catch (e) {
      log.error({ err: String(e) }, 'خطأ أثناء الإيقاف');
    } finally {
      await closePool();
      process.exit(0);
    }
  };

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => void shutdown(sig));
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('فشل بدء التشغيل:', e);
  process.exit(1);
});
