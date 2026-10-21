/** مسارات المشاركة العامّة (بلا مصادقة): معاينة وبثّ وتنزيل الملف المشارَك مع ضوابطه. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errors } from '../lib/errors.ts';
import { Shares, Files, type ShareRow, type FileRow } from '../db/repo.ts';
import { verifyPassword } from '../lib/password.ts';
import { isInlineSafe, mimeForName } from '../services/files.ts';
import { serveFileRange } from './_serve.ts';
import { isIpAllowed } from '../lib/ip-allow.ts';
import { Activity } from '../services/activity.ts';

function pwOf(request: FastifyRequest): string | undefined {
  const q = (request.query as { pw?: string }).pw;
  const h = request.headers['x-share-password'];
  return q ?? (typeof h === 'string' ? h : undefined);
}

/** يتحقّق من صلاحية المشاركة ويعيد (المشاركة، الملف) أو يرمي خطأً مناسبًا. */
async function resolveShare(token: string, pw: string | undefined, ip: string): Promise<{ share: ShareRow; file: FileRow }> {
  const share = await Shares.findByToken(token);
  if (!share || share.revoked) throw errors.notFound('الرابط غير صالح أو مُلغى.');
  if (!isIpAllowed(ip, share.ip_allow)) throw errors.forbidden('عنوان IP غير مسموح لهذا الرابط.');
  if (share.expires_at && share.expires_at < Date.now()) throw errors.notFound('انتهت صلاحية الرابط.');
  if (share.max_downloads && share.download_count >= share.max_downloads) {
    throw errors.forbidden('استُنفد الحدّ الأقصى لتنزيلات هذا الرابط.');
  }
  if (share.password_hash) {
    if (!pw || !(await verifyPassword(share.password_hash, pw))) {
      throw errors.unauthorized('هذا الرابط محميّ بكلمة مرور.');
    }
  }
  const file = share.file_id ? await Files.findById(share.file_id) : undefined;
  if (!file) throw errors.notFound('الملف المشارَك لم يعد موجودًا.');
  return { share, file };
}

export default async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/public/:token/meta', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const token = (request.params as { token: string }).token;
    const share = await Shares.findByToken(token);
    if (!share || share.revoked) return { ok: false, reason: 'notfound', hasPassword: false };
    if (!isIpAllowed(request.ip, share.ip_allow)) throw errors.forbidden('عنوان IP غير مسموح لهذا الرابط.');
    if (share.expires_at && share.expires_at < Date.now()) return { ok: false, reason: 'expired', hasPassword: !!share.password_hash };
    if (share.max_downloads && share.download_count >= share.max_downloads) {
      return { ok: false, reason: 'exhausted', hasPassword: !!share.password_hash };
    }
    const pw = pwOf(request);
    if (share.password_hash && !(pw && (await verifyPassword(share.password_hash, pw)))) {
      return { ok: false, needsPassword: true, hasPassword: true, wrong: !!pw };
    }
    const file = share.file_id ? await Files.findById(share.file_id) : undefined;
    if (!file) return { ok: false, reason: 'notfound', hasPassword: !!share.password_hash };

    await Shares.incViews(share.id);
    await Activity.record({
      userId: share.user_id,
      action: 'share_view',
      targetType: 'file',
      targetId: file.id,
      targetName: file.name,
      ip: request.ip,
      meta: { shareId: share.id },
    });
    const mime = file.mime ?? mimeForName(file.name);
    return {
      ok: true,
      hasPassword: !!share.password_hash,
      name: file.name,
      type: file.type,
      mime,
      sizeBytes: file.size,
      inline: isInlineSafe(mime),
      isVideo: file.type === 'video',
      isImage: file.type === 'design',
    };
  });

  app.get('/api/public/:token/stream', async (request, reply) => {
    const { token } = request.params as { token: string };
    const { share, file } = await resolveShare(token, pwOf(request), request.ip);
    await Activity.record({
      userId: share.user_id,
      action: 'share_stream',
      targetType: 'file',
      targetId: file.id,
      targetName: file.name,
      ip: request.ip,
      meta: { shareId: share.id },
    });
    return await serveFileRange(request, reply, file, { attachment: false });
  });

  app.get('/api/public/:token/download', async (request, reply) => {
    const { token } = request.params as { token: string };
    const { share, file } = await resolveShare(token, pwOf(request), request.ip);
    if (share.permission === 'view') throw errors.forbidden('هذه المشاركة مخصّصة للعرض فقط.');
    // احتسب تنزيلًا واحدًا عند بدء التنزيل (لا لكل طلب Range تكميليّ)
    if (!request.headers.range) {
      await Shares.incDownloads(share.id);
      await Activity.record({
        userId: share.user_id,
        action: 'share_download',
        targetType: 'file',
        targetId: file.id,
        targetName: file.name,
        ip: request.ip,
        meta: { shareId: share.id, sizeBytes: file.size },
      });
    }
    return await serveFileRange(request, reply, file, { attachment: true });
  });
}
