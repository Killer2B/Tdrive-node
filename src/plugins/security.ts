/** تسجيل إضافات الأمان: cookie, helmet, cors, rate-limit, multipart + مُحلّل octet-stream. */
import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { createHash } from 'node:crypto';
import { loadConfig } from '../config/env.ts';

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig();

  await app.register(cookie, { secret: cfg.session.secret });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  await app.register(cors, {
    origin: cfg.security.corsOrigins.length > 0 ? cfg.security.corsOrigins : false,
    credentials: true,
  });

  await app.register(rateLimit, {
    global: true,
    max: cfg.security.rateLimitMax,
    timeWindow: cfg.security.rateLimitWindow,
    keyGenerator: (request) => {
      const isDav = request.url === '/dav' || request.url.startsWith('/dav/');
      if (!request.url.startsWith('/api/v1') && !isDav) return request.ip;
      const authorization = request.headers.authorization;
      // WebDAV بكلمة مرور: المفتاح لكل (IP + مستخدم) لا لكل كلمة مرور،
      // وإلا استطاع المهاجم تجاوز الحدّ بتغيير كلمة المرور في كل محاولة.
      if (isDav && typeof authorization === 'string') {
        const basic = authorization.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
        if (basic) {
          const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
          const separator = decoded.indexOf(':');
          const user = separator >= 0 ? decoded.slice(0, separator).replace(/^.*\\/, '').trim().toLowerCase() : '';
          return `dav:${request.ip}:${user}`;
        }
      }
      let key: string | undefined;
      if (typeof authorization === 'string') {
        const bearer = authorization.match(/^Bearer\s+(.+)$/i);
        if (bearer) key = bearer[1].trim();
      }
      const headerKey = request.headers['x-api-key'];
      if (!key && typeof headerKey === 'string') key = headerKey.trim();
      if (!key) return request.ip;
      const digest = createHash('sha256').update(key, 'utf8').digest('hex');
      return `${isDav ? 'dav-key' : 'api-key'}:${digest}`;
    },
    allowList: (req) => req.url === '/health' || req.url.startsWith('/api/events'),
  });

  await app.register(multipart, {
    limits: { fileSize: cfg.upload.maxPartBody, files: 1 },
  });

  // أجزاء الرفع تُرسَل كـ octet-stream خام ونقرؤها كتدفّق (بلا تجميع في الذاكرة).
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => {
    done(null, payload);
  });
}
