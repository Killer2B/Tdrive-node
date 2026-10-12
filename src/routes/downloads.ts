/** مسارات التحميل من الروابط: معاينة + إضافة للطابور + إدارة المهام. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { requireUser } from '../plugins/auth.ts';
import { Jobs } from '../db/repo.ts';
import { assertPublicHost } from '../lib/ssrf.ts';
import { probeDirect } from '../services/downloads.ts';
import * as ytdlp from '../services/ytdlp.ts';
import { enqueueDownload, requestCancel, retryJob, toApiJob } from '../services/queue.ts';
import { extOf } from '../services/files.ts';

const DIRECT_EXTS = new Set([
  'mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'ts', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'pdf', 'zip', 'rar', '7z', 'tar', 'gz', 'iso',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'bin', 'apk', 'exe', 'dmg',
]);

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    throw errors.badRequest('رابط غير صالح.');
  }
}

// استنتاج امتداد من نوع المحتوى حين يكون اسم الملف بلا امتداد (مثل روابط CDN الموقّعة)
const CT_EXT: Record<string, string> = {
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z',
  'application/gzip': 'gz',
  'application/x-tar': 'tar',
  'application/x-iso9660-image': 'iso',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function ensureExt(name: string, contentType?: string): string {
  const base = name && name.trim() ? name.trim() : 'download';
  if (extOf(base)) return base;
  const ct = (contentType ?? '').toLowerCase().split(';')[0].trim();
  const e = CT_EXT[ct];
  return e ? `${base}.${e}` : base;
}

const probeBody = z.object({ url: z.string().url().max(2048) });
const enqueueBody = z.object({
  url: z.string().url().max(2048),
  mode: z.enum(['direct', 'media']),
  formatId: z.string().max(64).optional(),
  folderId: z.string().nullable().optional(),
  name: z.string().max(512).optional(),
  title: z.string().max(512).optional(),
});

export default async function downloadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/downloads/probe', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    requireUser(request);
    const { url } = parse(probeBody, request.body);
    const check = await assertPublicHost(hostnameOf(url));
    if (!check.ok) throw errors.forbidden('رُفض الرابط لأسباب أمنية (SSRF).');

    const pathname = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return '';
      }
    })();
    const basename = pathname.split('/').pop() ?? '';
    const urlExt = extOf(basename);

    // HEAD أولًا للتمييز بين ملف مباشر وصفحة ويب (ويمنحنا النوع/الاسم/الحجم بسرعة)
    let direct: Awaited<ReturnType<typeof probeDirect>> | null = null;
    try {
      direct = await probeDirect(url);
    } catch {
      direct = null;
    }
    const ct = (direct?.contentType ?? '').toLowerCase().split(';')[0].trim();
    const isHtml = ct === 'text/html' || ct === 'application/xhtml+xml';
    const dispExt = direct?.filename ? extOf(direct.filename) : '';
    const looksDirect =
      DIRECT_EXTS.has(urlExt) || DIRECT_EXTS.has(dispExt) || (!!direct && !!direct.contentType && !isHtml);

    if (looksDirect) {
      const d = direct ?? (await probeDirect(url));
      const filename = ensureExt(d.filename ?? basename, d.contentType);
      return { mode: 'direct', title: filename, filename, sizeBytes: d.sizeBytes, contentType: d.contentType };
    }

    // صفحة ويب (موقع وسائط) ⇒ yt-dlp
    try {
      const info = await ytdlp.probe(url);
      return {
        mode: 'media',
        title: info.title,
        durationSec: info.durationSec,
        thumbnail: info.thumbnail,
        uploader: info.uploader,
        isLive: info.isLive,
        qualities: info.qualities,
      };
    } catch (e) {
      throw errors.badGateway(e instanceof Error ? e.message : 'تعذّرت قراءة الرابط.');
    }
  });

  app.post('/api/downloads', async (request) => {
    const user = requireUser(request);
    const body = parse(enqueueBody, request.body);
    const check = await assertPublicHost(hostnameOf(body.url));
    if (!check.ok) throw errors.forbidden('رُفض الرابط لأسباب أمنية (SSRF).');
    const job = enqueueDownload({
      userId: user.id,
      url: body.url,
      mode: body.mode,
      formatId: body.formatId,
      folderId: body.folderId ?? null,
      name: body.name,
      title: body.title,
    });
    return { job: toApiJob(job) };
  });

  app.get('/api/downloads/jobs', async (request) => {
    const user = requireUser(request);
    const status = (request.query as { status?: string }).status;
    const statuses =
      status === 'active' ? ['queued', 'running'] : status === 'done' ? ['done'] : undefined;
    return { jobs: Jobs.listByUser(user.id, statuses).map(toApiJob) };
  });

  app.post('/api/downloads/jobs/:id/cancel', async (request) => {
    const user = requireUser(request);
    const ok = requestCancel(user.id, (request.params as { id: string }).id);
    if (!ok) throw errors.notFound('المهمة غير موجودة.');
    return { ok: true };
  });

  app.post('/api/downloads/jobs/:id/retry', async (request) => {
    const user = requireUser(request);
    const ok = retryJob(user.id, (request.params as { id: string }).id);
    if (!ok) throw errors.badRequest('تعذّرت إعادة المحاولة لهذه المهمة.');
    return { ok: true };
  });
}
