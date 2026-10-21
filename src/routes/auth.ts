/** مسارات المصادقة العامّة: دخول/خروج/جلسة. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { login, logout } from '../services/auth.ts';
import { SESSION_COOKIE, attachUser } from '../plugins/auth.ts';
import { loadConfig } from '../config/env.ts';
import { errors } from '../lib/errors.ts';
import type { UserRow } from '../db/repo.ts';
import { Activity } from '../services/activity.ts';

function userPublic(u: UserRow): Record<string, unknown> {
  return { id: u.id, username: u.username, role: u.role };
}

const loginSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(1024),
});

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig();

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parse(loginSchema, request.body);
      const result = await login(body.username, body.password, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      if (!result) throw errors.unauthorized('اسم المستخدم أو كلمة المرور غير صحيحة.');
      await Activity.record({ userId: result.user.id, action: 'login', targetType: 'session', targetId: result.sessionId, ip: request.ip });
      reply.setCookie(SESSION_COOKIE, result.sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: cfg.isProd,
        path: '/',
        signed: true,
        maxAge: Math.floor(cfg.session.ttlMs / 1000),
      });
      return { user: userPublic(result.user) };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    await attachUser(request);
    if (request.user) {
      await Activity.record({
        userId: request.user.id,
        action: 'logout',
        targetType: 'session',
        targetId: request.sessionId,
        ip: request.ip,
      });
    }
    if (request.sessionId) await logout(request.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/session', async (request, reply) => {
    await attachUser(request);
    if (!request.user) {
      reply.code(401);
      return { user: null };
    }
    return { user: userPublic(request.user) };
  });
}
