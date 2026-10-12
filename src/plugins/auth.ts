/** حارس المصادقة: يقرأ كوكي الجلسة، يحمّل المستخدم، ويفرض الدخول على المسارات المحمية. */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getUserFromSession } from '../services/auth.ts';
import { loadConfig } from '../config/env.ts';
import { errors } from '../lib/errors.ts';
import { isAllowedOrigin } from '../lib/origin.ts';
import type { UserRow } from '../db/repo.ts';

export const SESSION_COOKIE = 'tdrive_sess';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow;
    sessionId?: string;
  }
}

/** يملأ request.user من كوكي موقّع صالح (لا يرمي). */
export function attachUser(request: FastifyRequest): void {
  const raw = request.cookies?.[SESSION_COOKIE];
  if (!raw) return;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return;
  const user = getUserFromSession(unsigned.value);
  if (user) {
    request.user = user;
    request.sessionId = unsigned.value;
  }
}

/** يتحقّق من مطابقة Origin (دفاع CSRF بالعمق) — متسامح ولا يرفض الطلبات نفس-الأصل خلف Proxy. */
function checkOrigin(request: FastifyRequest): void {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const cfg = loadConfig();
  // في التطوير نتساهل (الواجهة على منفذ Vite مختلف)؛ الحماية الأساسية SameSite + الكوكي.
  if (!cfg.isProd) return;
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
  const xfHost = request.headers['x-forwarded-host'];
  const reqHost = (typeof xfHost === 'string' ? xfHost.split(',')[0].trim() : undefined) ?? request.headers.host;
  const allowed = [cfg.publicUrl, ...cfg.security.corsOrigins, typeof reqHost === 'string' ? reqHost : undefined];
  if (!isAllowedOrigin(origin, allowed)) {
    throw errors.forbidden('أصل الطلب غير مسموح.');
  }
}

/** preHandler للمسارات المحمية. */
export async function authGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  attachUser(request);
  if (!request.user) throw errors.unauthorized();
  checkOrigin(request);
}

/** يُعيد المستخدم الحاليّ أو يرمي. */
export function requireUser(request: FastifyRequest): UserRow {
  if (!request.user) throw errors.unauthorized();
  return request.user;
}
