/** مسارات المشاركة (محميّة): إنشاء/سرد/إلغاء/حذف روابط مشاركة لملفّات المالك. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { requireUser } from '../plugins/auth.ts';
import { Shares, Files, type ShareRow } from '../db/repo.ts';
import { randomBase64Url } from '../lib/ids.ts';
import { hashPassword } from '../lib/password.ts';
import { loadConfig } from '../config/env.ts';
import { Activity } from '../services/activity.ts';
import { validateIpAllow } from '../lib/ip-allow.ts';

function targetType(fileType: string): 'folder' | 'video' | 'doc' | 'bin' {
  if (fileType === 'video' || fileType === 'folder' || fileType === 'doc') return fileType;
  return 'bin';
}

export function toApiShare(s: ShareRow): Record<string, unknown> {
  const cfg = loadConfig();
  const file = s.file_id ? Files.findById(s.file_id) : undefined;
  const expired = !!s.expires_at && s.expires_at < Date.now();
  const safeguards: Array<{ label: string; icon: string; highlight?: boolean }> = [];
  if (s.password_hash) safeguards.push({ label: 'كلمة مرور', icon: 'key', highlight: true });
  if (s.expires_at) safeguards.push({ label: 'ينتهي', icon: 'timer' });
  if (s.max_downloads) safeguards.push({ label: `حدّ ${s.max_downloads}`, icon: 'download' });
  if (safeguards.length === 0) safeguards.push({ label: 'رابط عام', icon: 'link' });

  return {
    id: s.id,
    token: s.token,
    targetName: file?.name ?? 'ملف محذوف',
    targetPath: file?.name ?? 'Deleted file',
    targetType: targetType(file?.type ?? 'bin'),
    vanityEndpoint: `${cfg.publicUrl}/s/${s.token}`,
    safeguards,
    quotaUsed: s.download_count,
    quotaLimit: s.max_downloads ?? 'Unlimited',
    quotaUnit: 'تنزيل',
    viewsCount: s.views_count,
    telemetryNote: file ? `${file.type}` : '',
    expiry: s.expires_at ? new Date(s.expires_at).toLocaleDateString() : 'بلا انتهاء',
    isRevoked: !!s.revoked,
    isExpired: expired,
    ipAllow: s.ip_allow,
  };
}

const createBody = z.object({
  fileId: z.string().min(1),
  password: z.string().max(256).optional(),
  expiresDays: z.number().int().positive().max(3650).optional(),
  maxDownloads: z.number().int().positive().max(1_000_000).optional(),
  label: z.string().max(200).optional(),
  ipAllow: z.string().max(4096).optional(),
});

export default async function shareRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/shares', async (request) => {
    const user = requireUser(request);
    const body = parse(createBody, request.body);
    if (body.ipAllow && !validateIpAllow(body.ipAllow)) throw errors.badRequest('قائمة IP غير صالحة.');
    const file = Files.findById(body.fileId);
    if (!file || file.user_id !== user.id) throw errors.badRequest('الملف غير موجود.');

    const share = Shares.create({
      user_id: user.id,
      file_id: file.id,
      folder_id: null,
      token: randomBase64Url(18),
      label: body.label,
      password_hash: body.password ? await hashPassword(body.password) : null,
      expires_at: body.expiresDays ? Date.now() + body.expiresDays * 86_400_000 : null,
      max_downloads: body.maxDownloads ?? null,
      ip_allow: body.ipAllow?.trim() || null,
    });
    Activity.record({
      userId: user.id,
      action: 'share_created',
      targetType: 'share',
      targetId: share.id,
      targetName: file.name,
      ip: request.ip,
    });
    return { link: toApiShare(share) };
  });

  app.get('/api/shares', async (request) => {
    const user = requireUser(request);
    return { links: Shares.listByUser(user.id).map(toApiShare) };
  });

  app.post('/api/shares/:id/revoke', async (request) => {
    const user = requireUser(request);
    const share = Shares.findById((request.params as { id: string }).id);
    if (!share || share.user_id !== user.id) throw errors.notFound('المشاركة غير موجودة.');
    Shares.revoke(share.id);
    Activity.record({ userId: user.id, action: 'share_revoked', targetType: 'share', targetId: share.id, ip: request.ip });
    return { ok: true };
  });

  app.delete('/api/shares/:id', async (request) => {
    const user = requireUser(request);
    const share = Shares.findById((request.params as { id: string }).id);
    if (!share || share.user_id !== user.id) throw errors.notFound('المشاركة غير موجودة.');
    Shares.delete(share.id);
    Activity.record({ userId: user.id, action: 'share_deleted', targetType: 'share', targetId: share.id, ip: request.ip });
    return { ok: true };
  });
}
