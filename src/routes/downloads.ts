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
    const ext = extOf(pathname.split('/').pop() ?? '');
    const looksDirect = DIRECT_EXTS.has(ext);

    if (!looksDirect) {
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
        // محاولة أخيرة كرابط مباشر
        try {
          const d = await probeDirect(url);
          return { mode: 'direct', title: d.filename, filename: d.filename, sizeBytes: d.sizeBytes, contentType: d.contentType };
        } catch {
          throw errors.badGateway(
            `تعذّرت قراءة الرابط. ${e instanceof Error ? e.message : ''}`.trim(),
          );
        }
      }
    }

    const d = await probeDirect(url);
    return {
      mode: 'direct',
      title: d.filename,
      filename: d.filename,
      sizeBytes: d.sizeBytes,
      contentType: d.contentType,
    };
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
