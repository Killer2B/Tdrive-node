/** مسارات الرفع المجزّأ القابل للاستئناف. */
import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { requireUser } from '../plugins/auth.ts';
import { loadConfig } from '../config/env.ts';
import {
  initUpload,
  uploadPart,
  uploadStatus,
  completeUpload,
  abortUpload,
} from '../services/uploads.ts';

const initBody = z.object({
  clientKey: z.string().min(8).max(128),
  name: z.string().min(1).max(512),
  size: z.number().int().nonnegative(),
  folderId: z.string().nullable().optional(),
  fingerprint: z.string().max(128).optional(),
});

export default async function uploadRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig();

  app.post('/api/uploads/init', async (request) => {
    const user = requireUser(request);
    const body = parse(initBody, request.body);
    return initUpload({
      userId: user.id,
      clientKey: body.clientKey,
      folderId: body.folderId ?? null,
      name: body.name,
      size: body.size,
      fingerprint: body.fingerprint,
    });
  });

  app.post(
    '/api/uploads/:id/parts/:idx',
    {
      bodyLimit: cfg.upload.maxPartBody + 1024,
      config: { rateLimit: { max: 100_000, timeWindow: '1 minute' } },
    },
    async (request) => {
      const user = requireUser(request);
      const { id, idx } = request.params as { id: string; idx: string };
      const declaredSha = request.headers['x-chunk-sha256'];
      return uploadPart({
        userId: user.id,
        uploadId: id,
        idx: Number(idx),
        body: request.body as Readable,
        declaredSha: typeof declaredSha === 'string' ? declaredSha : undefined,
      });
    },
  );

  app.get('/api/uploads/:id/status', async (request) => {
    const user = requireUser(request);
    return uploadStatus(user.id, (request.params as { id: string }).id);
  });

  app.post('/api/uploads/:id/complete', async (request) => {
    const user = requireUser(request);
    const result = await completeUpload({ userId: user.id, uploadId: (request.params as { id: string }).id });
    return { file: result.file };
  });

  app.post('/api/uploads/:id/abort', async (request) => {
    const user = requireUser(request);
    await abortUpload(user.id, (request.params as { id: string }).id);
    return { ok: true };
  });
}
