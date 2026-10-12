/** مسارات متنوّعة محميّة: الإعدادات، النظام، كوكيز يوتيوب، وتغيير كلمة المرور. */
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { requireUser } from '../plugins/auth.ts';
import { Settings, Users, Sessions } from '../db/repo.ts';
import { loadConfig } from '../config/env.ts';
import { hashPassword, verifyPassword } from '../services/auth.ts';
import { version as ytdlpVersion, update as ytdlpUpdate, cookiesFilePath } from '../services/ytdlp.ts';
import { ffmpegAvailable } from '../services/ffmpeg.ts';
import { checkConnection as tgCheck } from '../services/telegram.ts';

const DEFAULT_SETTINGS = {
  theme: 'dark',
  defaultView: 'grid',
  thumbnailsEnabled: true,
};

export default async function miscRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig();

  app.get('/api/settings', async (request) => {
    const user = requireUser(request);
    const stored = (Settings.get(user.id, 'workspace') as Record<string, unknown>) ?? {};
    return { settings: { ...DEFAULT_SETTINGS, ...stored } };
  });

  app.put('/api/settings', async (request) => {
    const user = requireUser(request);
    const body = parse(z.record(z.string(), z.unknown()), request.body);
    const current = (Settings.get(user.id, 'workspace') as Record<string, unknown>) ?? {};
    const merged = { ...current, ...body };
    Settings.set(user.id, 'workspace', merged);
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
    Users.updatePassword(user.id, await hashPassword(body.next));
    // أبطل كل الجلسات الأخرى لإجبار إعادة الدخول
    Sessions.deleteAllForUser(user.id);
    return { ok: true };
  });

  app.get('/api/system', async (request) => {
    requireUser(request);
    const [ytdlp, ffmpeg, tg] = await Promise.all([
      ytdlpVersion(),
      ffmpegAvailable(),
      cfg.content.backend === 'telegram' ? tgCheck() : Promise.resolve({ ok: false, detail: 'disabled' }),
    ]);
    return {
      ytdlp: { installed: !!ytdlp, version: ytdlp },
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
    return ytdlpUpdate();
  });

  // ===== كوكيز يوتيوب (لتجاوز فحص الروبوت على الخوادم) =====
  app.get('/api/system/cookies', async (request) => {
    requireUser(request);
    return { present: existsSync(cookiesFilePath()), path: cookiesFilePath() };
  });

  app.post('/api/system/cookies', async (request) => {
    const user = requireUser(request);
    if (user.role !== 'owner') throw errors.forbidden();
    const body = parse(z.object({ content: z.string().min(10).max(2 * 1024 * 1024) }), request.body);
    const content = body.content;
    // تحقّق خفيف أنه ملف كوكيز (Netscape) أو يحوي نطاق يوتيوب
    if (!/#\s*Netscape|\.youtube\.com|\byoutube\.com\b|\t/.test(content)) {
      throw errors.badRequest('المحتوى لا يبدو ملف cookies.txt صالحًا (صيغة Netscape).');
    }
    const file = cookiesFilePath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
    return { ok: true, present: true };
  });

  app.delete('/api/system/cookies', async (request) => {
    const user = requireUser(request);
    if (user.role !== 'owner') throw errors.forbidden();
    await rm(cookiesFilePath(), { force: true }).catch(() => {});
    return { ok: true, present: false };
  });
}
