/** مجدوِل داخليّ: تنظيف دوريّ + نسخ احتياطي كل BACKUP_INTERVAL_HOURS. */
import { Kv, Sessions, Jobs } from '../db/repo.ts';
import { query, tb } from '../db/pg.ts';
import { loadConfig } from '../config/env.ts';
import { getLogger } from '../lib/logger.ts';
import { cleanupExpiredUploads } from './uploads.ts';
import { runBackup } from './backup.ts';
import { evictCache } from './chunkstore.ts';
import { purgeExpiredTrash } from './files.ts';

const TICK_MS = 5 * 60 * 1000; // كل 5 دقائق
const CLEANUP_INTERVAL_MS = 55 * 60 * 1000; // ~كل ساعة
const JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let ticking = false;

async function lastRun(key: string): Promise<number> {
  const v = await Kv.get(key);
  return v ? Number(v) : 0;
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  const cfg = loadConfig();
  const log = getLogger();
  const now = Date.now();
  try {
    if (now - (await lastRun('last_cleanup')) >= CLEANUP_INTERVAL_MS) {
      const sessions = await Sessions.deleteExpired();
      const uploads = await cleanupExpiredUploads();
      await Jobs.reclaimStale();
      const jobs = await Jobs.deleteDoneBefore(now - JOB_RETENTION_MS);
      const users = await query<{ id: string }>(`SELECT id FROM ${tb('users')}`);
      let purgedTrash = 0;
      for (const user of users) {
        const result = await purgeExpiredTrash(user.id);
        purgedTrash += result.removed;
      }
      await Kv.set('last_cleanup', String(now));
      log.debug({ sessions, uploads, jobs, purgedTrash }, 'تنظيف دوريّ');
    }

    // إخلاء كاش القطع المؤكّدة على Telegram عند تجاوز السقف
    if (cfg.content.backend === 'telegram') {
      try {
        const { evicted, freed } = await evictCache();
        if (evicted > 0) log.debug({ evicted, freed }, 'إخلاء كاش القطع');
      } catch (e) {
        log.debug({ err: String(e) }, 'تعذّر إخلاء الكاش');
      }
    }

    if (cfg.backup.enabled) {
      const intervalMs = cfg.backup.intervalHours * 60 * 60 * 1000;
      if (now - (await lastRun('last_backup')) >= intervalMs) {
        await Kv.set('last_backup', String(now)); // سجّل قبل التشغيل لمنع التكرار عند التداخل
        try {
          await runBackup('scheduled');
        } catch (e) {
          log.error({ err: String(e) }, 'فشل النسخ الاحتياطي المجدوَل');
        }
      }
    }
  } finally {
    ticking = false;
  }
}

export function startScheduler(): void {
  stopScheduler();
  timer = setInterval(() => void tick(), TICK_MS);
  if (timer.unref) timer.unref();
  // تشغيلة أوّلية بعد 15 ثانية (لالتقاط النسخ المتأخّرة والتنظيف)
  setTimeout(() => void tick(), 15_000).unref?.();
  getLogger().info('بدأ المجدوِل الداخليّ');
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
