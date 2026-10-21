/** تسجيل كل المسارات: عامّة + محميّة + خدمة الواجهة الثابتة (SPA). */
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { authGuard } from '../plugins/auth.ts';
import authRoutes from './auth.ts';
import publicRoutes from './public.ts';
import fileRoutes from './files.ts';
import folderRoutes from './folders.ts';
import uploadRoutes from './uploads.ts';
import downloadRoutes from './downloads.ts';
import eventRoutes from './events.ts';
import shareRoutes from './shares.ts';
import sessionRoutes from './sessions.ts';
import miscRoutes from './misc.ts';
import analyticsRoutes from './analytics.ts';
import apiKeyRoutes from './api-keys.ts';
import apiV1Routes from './api-v1.ts';
import webDavRoutes from './webdav.ts';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // صحّة عامّة
  app.get('/health', async () => ({ status: 'ok', time: Date.now() }));

  // عامّة (المصادقة + روابط المشاركة العامّة بلا تسجيل دخول)
  await app.register(authRoutes);
  await app.register(publicRoutes);
  await app.register(apiV1Routes);
  await app.register(webDavRoutes);

  // محميّة
  await app.register(async (secured) => {
    secured.addHook('preHandler', authGuard);
    await secured.register(fileRoutes);
    await secured.register(folderRoutes);
    await secured.register(uploadRoutes);
    await secured.register(downloadRoutes);
    await secured.register(eventRoutes);
    await secured.register(shareRoutes);
    await secured.register(sessionRoutes);
    await secured.register(miscRoutes);
    await secured.register(analyticsRoutes);
    await secured.register(apiKeyRoutes);
  });

  // خدمة الواجهة المبنيّة (web/dist) إن وُجدت
  const webDir = path.resolve(process.cwd(), 'web', 'dist');
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, {
      root: webDir,
      index: ['index.html'],
      wildcard: false,
      cacheControl: true,
      maxAge: '1h',
    });
    // توجيه مسارات SPA العميقة إلى index.html (عدا /api)
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url && (request.raw.url.startsWith('/api') || request.raw.url.startsWith('/health'))) {
        reply.code(404).send({ error: { code: 'NotFound', message: 'المسار غير موجود.' } });
        return;
      }
      reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url && request.raw.url.startsWith('/api')) {
        reply.code(404).send({ error: { code: 'NotFound', message: 'المسار غير موجود.' } });
        return;
      }
      reply
        .code(200)
        .type('text/html; charset=utf-8')
        .send(
          '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>Tdrive</title>' +
            '<body style="font-family:system-ui;background:#10131a;color:#e1e2eb;padding:3rem">' +
            '<h1>Tdrive يعمل ✓</h1><p>واجهة الويب لم تُبنَ بعد. نفّذ:</p>' +
            '<pre style="background:#1d2026;padding:1rem;border-radius:8px">cd web &amp;&amp; npm install &amp;&amp; npm run build</pre>' +
            '<p>الـ API متاح على <code>/api</code> و<code>/health</code>.</p></body></html>',
        );
    });
  }
}
