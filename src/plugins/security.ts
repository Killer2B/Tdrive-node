/** تسجيل إضافات الأمان: cookie, helmet, cors, rate-limit, multipart + مُحلّل octet-stream. */
import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
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
