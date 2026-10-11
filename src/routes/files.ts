/** مسارات الملفّات: سرد/تفاصيل/تعديل/سلّة مهملات/حذف + بثّ Range وتنزيل وصورة مصغّرة. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { parseRange } from '../lib/ranges.ts';
import { errors } from '../lib/errors.ts';
import { Files, Folders, type FileRow } from '../db/repo.ts';
import { requireUser } from '../plugins/auth.ts';
import {
  toApiFile,
  openFileRange,
  openThumbnail,
  trashFile,
  restoreFile,
  deleteFilePermanent,
  storageUsage,
  mimeForName,
  isInlineSafe,
  uniqueName,
} from '../services/files.ts';

function ownFile(request: FastifyRequest, id: string): FileRow {
  const user = requireUser(request);
  const file = Files.findById(id);
  if (!file || file.user_id !== user.id) throw errors.notFound('الملف غير موجود.');
  return file;
}

function etagFor(file: FileRow): string {
  return `"${file.sha256 ?? `${file.id}-${file.size}-${file.updated_at}`}"`;
}

async function serveFile(
  request: FastifyRequest,
  reply: FastifyReply,
  file: FileRow,
  opts: { attachment: boolean },
): Promise<unknown> {
  if (file.status !== 'ready' || !file.storage_key) throw errors.notFound('الملف غير جاهز بعد.');
  const mime = file.mime ?? mimeForName(file.name);
  const etag = etagFor(file);
  const inline = !opts.attachment && isInlineSafe(mime);
  const dispName = encodeURIComponent(file.name);

  reply
    .header('Content-Type', mime)
    .header('Accept-Ranges', 'bytes')
    .header('ETag', etag)
    .header('Cache-Control', 'private, max-age=3600')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${dispName}`);

  if (request.headers['if-none-match'] === etag) {
    return reply.code(304).send();
  }

  const r = parseRange(request.headers.range, file.size);
  if (r.type === 'unsatisfiable') {
    return reply.code(416).header('Content-Range', `bytes */${file.size}`).send();
  }
  if (r.type === 'ok') {
    const { start, end } = r.range;
    const stream = await openFileRange(file, { start, end });
    return reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${file.size}`)
      .header('Content-Length', end - start + 1)
      .send(stream);
  }
  const stream = await openFileRange(file);
  return reply.header('Content-Length', file.size).send(stream);
}

const listQuery = z.object({
  folderId: z.string().optional(),
  trashed: z.coerce.boolean().optional(),
  sort: z.enum(['name', 'size', 'modified', 'created']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  q: z.string().max(256).optional(),
  view: z.enum(['all', 'recent', 'starred', 'trash']).optional(),
});

const patchBody = z.object({
  name: z.string().min(1).max(256).optional(),
  starred: z.boolean().optional(),
  pinned: z.boolean().optional(),
  folderId: z.string().nullable().optional(),
});

export default async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files', async (request) => {
    const user = requireUser(request);
    const q = parse(listQuery, request.query);
    let rows: FileRow[];
    if (q.q) rows = Files.search(user.id, q.q);
    else if (q.view === 'recent') rows = Files.recent(user.id);
    else if (q.view === 'starred') rows = Files.starred(user.id);
    else if (q.view === 'trash' || q.trashed) rows = Files.trashList(user.id);
    else {
      const folderId = q.folderId === undefined ? undefined : q.folderId === 'root' || q.folderId === '' ? null : q.folderId;
      rows = Files.list(user.id, { folderId, sort: q.sort, order: q.order });
    }
    return { files: rows.map(toApiFile), usage: storageUsage(user.id) };
  });

  app.get('/api/files/:id', async (request) => {
    const file = ownFile(request, (request.params as { id: string }).id);
    return { file: toApiFile(file) };
  });

  app.patch('/api/files/:id', async (request) => {
    const file = ownFile(request, (request.params as { id: string }).id);
    const body = parse(patchBody, request.body);
    const user = requireUser(request);
    const patch: Partial<FileRow> = {};
    if (body.starred !== undefined) patch.starred = body.starred ? 1 : 0;
    if (body.pinned !== undefined) patch.pinned = body.pinned ? 1 : 0;
    if (body.folderId !== undefined) {
      if (body.folderId !== null) {
        const folder = Folders.findById(body.folderId);
        if (!folder || folder.user_id !== user.id) throw errors.badRequest('المجلّد الوجهة غير موجود.');
      }
      patch.folder_id = body.folderId;
    }
    if (body.name !== undefined) {
      const targetFolder = body.folderId !== undefined ? body.folderId : file.folder_id;
      patch.name = uniqueName(user.id, targetFolder, body.name);
    }
    Files.update(file.id, patch);
    return { file: toApiFile(Files.findById(file.id)!) };
  });

  app.post('/api/files/:id/trash', async (request) => {
    const file = ownFile(request, (request.params as { id: string }).id);
    trashFile(file);
    return { ok: true };
  });

  app.post('/api/files/:id/restore', async (request) => {
    const file = ownFile(request, (request.params as { id: string }).id);
    restoreFile(file);
    return { ok: true };
  });

  app.delete('/api/files/:id', async (request) => {
    const file = ownFile(request, (request.params as { id: string }).id);
    await deleteFilePermanent(file);
    return { ok: true };
  });

  app.post('/api/files/trash/empty', async (request) => {
    const user = requireUser(request);
    const items = Files.trashList(user.id);
    for (const f of items) await deleteFilePermanent(f);
    return { ok: true, removed: items.length };
  });

  app.get('/api/files/:id/stream', async (request, reply) => {
    const file = ownFile(request, (request.params as { id: string }).id);
    return serveFile(request, reply, file, { attachment: false });
  });

  app.get('/api/files/:id/download', async (request, reply) => {
    const file = ownFile(request, (request.params as { id: string }).id);
    return serveFile(request, reply, file, { attachment: true });
  });

  app.get('/api/files/:id/thumbnail', async (request, reply) => {
    const file = ownFile(request, (request.params as { id: string }).id);
    const stream = await openThumbnail(file);
    if (!stream) return reply.code(404).send();
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'private, max-age=86400')
      .send(stream);
  });

  app.get('/api/storage', async (request) => {
    const user = requireUser(request);
    return storageUsage(user.id);
  });
}
