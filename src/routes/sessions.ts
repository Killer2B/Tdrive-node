/** مسارات الجلسات/الأجهزة (محميّة): سرد الجلسات النشطة وإلغاؤها. */
import type { FastifyInstance } from 'fastify';
import { errors } from '../lib/errors.ts';
import { requireUser } from '../plugins/auth.ts';
import { Sessions, type SessionRow } from '../db/repo.ts';
import { Activity } from '../services/activity.ts';

function uaInfo(ua: string | null): { deviceType: 'laptop' | 'desktop' | 'tablet'; name: string } {
  const u = (ua ?? '').toLowerCase();
  const deviceType: 'laptop' | 'desktop' | 'tablet' = /mobile|iphone|android|ipad|tablet/.test(u) ? 'tablet' : 'laptop';
  const browser = /edg/.test(u)
    ? 'Edge'
    : /chrome|crios/.test(u)
      ? 'Chrome'
      : /firefox/.test(u)
        ? 'Firefox'
        : /safari/.test(u)
          ? 'Safari'
          : 'متصفّح';
  const os = /windows/.test(u)
    ? 'Windows'
    : /mac/.test(u)
      ? 'macOS'
      : /android/.test(u)
        ? 'Android'
        : /iphone|ipad/.test(u)
          ? 'iOS'
          : /linux|x11/.test(u)
            ? 'Linux'
            : '';
  return { deviceType, name: os ? `${browser} · ${os}` : browser };
}

function toClientNode(s: SessionRow, currentId?: string): Record<string, unknown> {
  const { deviceType, name } = uaInfo(s.user_agent);
  const isCurrent = s.id === currentId;
  return {
    id: s.id,
    name,
    location: s.ip ?? '—',
    ip: s.ip ?? '',
    enclaveId: `جلسة ${s.id.slice(-6)}`,
    activeStatus: isCurrent ? 'نشطة الآن' : new Date(s.created_at).toLocaleString(),
    isCurrent,
    isRevoked: false,
    deviceType,
  };
}

export default async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sessions', async (request) => {
    const user = requireUser(request);
    return { nodes: Sessions.listByUser(user.id).map((s) => toClientNode(s, request.sessionId)) };
  });

  app.post('/api/sessions/:id/revoke', async (request) => {
    const user = requireUser(request);
    const id = (request.params as { id: string }).id;
    const s = Sessions.find(id);
    if (!s || s.user_id !== user.id) throw errors.notFound('الجلسة غير موجودة.');
    Sessions.delete(id);
    Activity.record({ userId: user.id, action: 'session_revoked', targetType: 'session', targetId: id, ip: request.ip });
    return { ok: true };
  });
}
