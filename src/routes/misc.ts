/** مسارات متنوّعة محميّة: الإعدادات، النظام، كوكيز يوتيوب، وتغيير كلمة المرور. */
import type { FastifyInstance } from 'fastify';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { requireUser } from '../plugins/auth.ts';
import { Settings, Users, Sessions } from '../db/repo.ts';
import { loadConfig } from '../config/env.ts';
import { hashPassword, verifyPassword } from '../services/auth.ts';
import { version as ytdlpVersion, update as ytdlpUpdate, cookiesFilePath, cookiesInfo, resolveYtdlp } from '../services/ytdlp.ts';
import { ffmpegAvailable } from '../services/ffmpeg.ts';
import { checkConnection as tgCheck } from '../services/telegram.ts';
import { Files } from '../db/repo.ts';
import { Activity } from '../services/activity.ts';

const DEFAULT_SETTINGS = {
  theme: 'dark',
  defaultView: 'grid',
  thumbnailsEnabled: true,
  retentionDays: 30,
  quotaBytes: 5_000_000_000_000,
};
const settingsSchema = z
  .object({
    theme: z.enum(['dark', 'light']),
    defaultView: z.enum(['grid', 'list']),
    thumbnailsEnabled: z.boolean(),
    retentionDays: z.number().int().min(1).max(3650),
    quotaBytes: z.number().int().min(1_000_000).max(Number.MAX_SAFE_INTEGER),
  })
  .partial()
  .strict();

export default async function miscRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig();

  app.get('/api/settings', async (request) => {
    const user = requireUser(request);
    const stored = ((await Settings.get(user.id, 'workspace')) as Record<string, unknown>) ?? {};
    return { settings: { ...DEFAULT_SETTINGS, ...stored } };
  });

  app.put('/api/settings', async (request) => {
    const user = requireUser(request);
    const body = parse(settingsSchema, request.body);
    const current = ((await Settings.get(user.id, 'workspace')) as Record<string, unknown>) ?? {};
    const merged = { ...DEFAULT_SETTINGS, ...current, ...body };
    if (typeof merged.quotaBytes !== 'number' || merged.quotaBytes < (await Files.usedBytes(user.id))) {
      throw errors.badRequest('لا يمكن ضبط الحصة على قيمة أقل من المساحة المستخدمة.');
    }
    await Settings.set(user.id, 'workspace', merged);
    await Activity.record({ userId: user.id, action: 'settings_updated', targetType: 'account', ip: request.ip });
    return { settings: { ...DEFAULT_SETTINGS, ...merged } };
  });

  app.post('/api/account/password', async (request) => {
    const user = requireUser(request);
    const body = parse(
      z.object({ current: z.string().min(1), next: z.string().min(8).max(1024) }),
      request.body,
    );
    const ok = await verifyPassword(user.password_hash, body.current);
    if (!ok) throw errors.badRequest('كلمة المرور الحالية غير صحيحة.');
    await Users.updatePassword(user.id, await hashPassword(body.next));
    // أبطل كل الجلسات الأخرى لإجبار إعادة الدخول
    await Sessions.deleteAllForUser(user.id);
    await Activity.record({ userId: user.id, action: 'password_changed', targetType: 'account', ip: request.ip });
    return { ok: true };
  });

  app.get('/api/system', async (request) => {
    requireUser(request);
    const [ytdlp, ytdlpPath, ffmpeg, tg] = await Promise.all([
      ytdlpVersion(),
      resolveYtdlp(),
      ffmpegAvailable(),
      cfg.content.backend === 'telegram' ? tgCheck() : Promise.resolve({ ok: false, detail: 'disabled' }),
    ]);
    const cookies = cookiesInfo();
    return {
      ytdlp: {
        installed: !!ytdlpPath,
        version: ytdlp,
        path: ytdlpPath,
        hint: ytdlpPath
          ? ytdlp
            ? undefined
            : 'الملفّ موجود لكنه لا يستجيب — حدّثه أو أعد تثبيته.'
          : 'yt-dlp غير مثبّت: شغّل «npm run ytdlp:update» أو أعد تشغيل الخادم لتثبيته تلقائيًّا.',
      },
      cookies: { present: cookies.present, valid: cookies.cookies > 0, count: cookies.cookies, path: cookies.path },
      ffmpeg: { installed: ffmpeg },
      contentBackend: cfg.content.backend,
      telegram: { enabled: cfg.content.backend === 'telegram', connected: tg.ok, detail: tg.detail },
      storageDriver: cfg.storage.driver,
      chunkSizeMB: Math.round(cfg.upload.chunkSize / (1024 * 1024)),
      maxFileSizeGB: cfg.upload.maxFileSize > 0 ? Math.round(cfg.upload.maxFileSize / (1024 * 1024 * 1024)) : 0,
      backupEnabled: cfg.backup.enabled,
      backupIntervalHours: cfg.backup.intervalHours,
    };
  });

  app.post('/api/system/ytdlp-update', { config: { rateLimit: { max: 3, timeWindow: '5 minutes' } } }, async (request) => {
    const user = requireUser(request);
    if (user.role !== 'owner') throw errors.forbidden();
    return await ytdlpUpdate();
  });

  // ===== كوكيز يوتيوب (لتجاوز فحص الروبوت على الخوادم) =====
  app.get('/api/system/cookies', async (request) => {
    requireUser(request);
    const info = cookiesInfo();
    return { present: info.present, path: info.path, count: info.cookies, valid: info.cookies > 0 };
  });

  app.post('/api/system/cookies', async (request) => {
    const user = requireUser(request);
    if (user.role !== 'owner') throw errors.forbidden();
    const body = parse(z.object({ content: z.string().min(10).max(2 * 1024 * 1024) }), request.body);
    const content = body.content.replace(/^\uFEFF/, '');
    if (/^\s*<(!doctype|html)/i.test(content)) {
      throw errors.badRequest('المحتوى صفحة HTML لا ملفّ cookies.txt — صدّر الكوكيز بصيغة Netscape.');
    }
    const cookies = content
      .split(/\r?\n/)
      .filter((l) => l.trim() && (l.startsWith('#HttpOnly_') || !l.startsWith('#')))
      .filter((l) => l.split('\t').length >= 7);
    const netscape = /#\s*Netscape HTTP Cookie File/i.test(content) || cookies.length > 0;
    if (!netscape || cookies.length === 0) {
      throw errors.badRequest('المحتوى لا يبدو ملفّ cookies.txt صالحًا (صيغة Netscape: 7 حقول مفصولة بـ Tab).');
    }
    const file = cookiesFilePath();
    await mkdir(path.dirname(file), { recursive: true });
    // 0600: الكوكيز أسرار حساب — لا يجب أن يقرأها غير مالك العملية
    await writeFile(file, content, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, present: true, count: cookies.length };
  });

  app.delete('/api/system/cookies', async (request) => {
    const user = requireUser(request);
    if (user.role !== 'owner') throw errors.forbidden();
    await rm(cookiesFilePath(), { force: true }).catch(() => {});
    return { ok: true, present: false };
  });
}
