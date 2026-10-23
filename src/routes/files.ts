/** مسارات الملفّات: سرد/تفاصيل/تعديل/سلّة مهملات/حذف + بثّ Range وتنزيل وصورة مصغّرة. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { Files, type FileRow } from '../db/repo.ts';
import { requireUser } from '../plugins/auth.ts';
import { serveFileRange } from './_serve.ts';
import {
  toApiFile,
  openThumbnail,
  trashFile,
  restoreFile,
  deleteFilePermanent,
  storageUsage,
  purgeExpiredTrash,
} from '../services/files.ts';
import { Activity } from '../services/activity.ts';
import { updateDriveItem } from '../services/drive.ts';

async function ownFile(request: FastifyRequest, id: string): Promise<FileRow> {
  const user = requireUser(request);
  const file = await Files.findById(id);
  if (!file || file.user_id !== user.id) throw errors.notFound('الملف غير موجود.');
  return file;
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
  name: z.string().min(1).max(200).optional(),
  starred: z.boolean().optional(),
  pinned: z.boolean().optional(),
  folderId: z.string().nullable().optional(),
});

export default async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files', async (request) => {
    const user = requireUser(request);
    const q = parse(listQuery, request.query);
    let rows: FileRow[];
    if (q.q) rows = await Files.search(user.id, q.q);
    else if (q.view === 'recent') rows = await Files.recent(user.id);
    else if (q.view === 'starred') rows = await Files.starred(user.id);
    else if (q.view === 'trash' || q.trashed) rows = await Files.trashList(user.id);
    else {
      const folderId = q.folderId === undefined ? undefined : q.folderId === 'root' || q.folderId === '' ? null : q.folderId;
      rows = await Files.list(user.id, { folderId, sort: q.sort, order: q.order });
    }
    return { files: rows.map(toApiFile), usage: await storageUsage(user.id) };
  });

  app.get('/api/files/:id', async (request) => {
    const file = await ownFile(request, (request.params as { id: string }).id);
    return { file: toApiFile(file) };
  });

  app.patch('/api/files/:id', async (request) => {
    const file = await ownFile(request, (request.params as { id: string }).id);
    const body = parse(patchBody, request.body);
    const user = requireUser(request);
    const patch: Partial<FileRow> = {};
    if (body.starred !== undefined) patch.starred = body.starred ? 1 : 0;
    if (body.pinned !== undefined) patch.pinned = body.pinned ? 1 : 0;
    if (body.name !== undefined || body.folderId !== undefined) {
      await updateDriveItem(user.id, { type: 'file', id: file.id }, { name: body.name, destinationId: body.folderId });
    }
    await Files.update(file.id, patch);
    if (body.starred !== undefined || body.pinned !== undefined || body.name !== undefined || body.folderId !== undefined) {
      await Activity.record({
        userId: user.id,
        action: 'file_updated',
        targetType: 'file',
        targetId: file.id,
        targetName: body.name ?? file.name,
        ip: request.ip,
        meta: { starred: body.starred, pinned: body.pinned },
      });
    }
    return { file: toApiFile((await Files.findById(file.id))!) };
  });

  app.post('/api/files/:id/trash', async (request) => {
    const file = await ownFile(request, (request.params as { id: string }).id);
    await trashFile(file);
    await Activity.record({
      userId: requireUser(request).id,
      action: 'file_trashed',
      targetType: 'file',
      targetId: file.id,
      targetName: file.name,
      ip: request.ip,
    });
    return { ok: true };
  });

  app.post('/api/files/:id/restore', async (request) => {
    const file = await ownFile(request, (request.params as { id: string }).id);
    await restoreFile(file);
    await Activity.record({
      userId: requireUser(request).id,
      action: 'file_restored',
      targetType: 'file',
      targetId: file.id,
      targetName: file.name,
      ip: request.ip,
    });
    return { ok: true };
  });

  app.delete('/api/files/:id', async (request) => {
    const file = await ownFile(request, (request.params as { id: string }).id);
    await deleteFilePermanent(file);
    await Activity.record({
      userId: requireUser(request).id,
      action: 'file_deleted',
      targetType: 'file',
      targetId: file.id,
      targetName: file.name,
      ip: request.ip,
      meta: { sizeBytes: file.size },
    });
    return { ok: true };
  });

  app.post('/api/files/trash/empty', async (request) => {
    const user = requireUser(request);
    const items = await Files.trashList(user.id);
    for (const f of items) await deleteFilePermanent(f);
    await Activity.record({
      userId: user.id,
      action: 'trash_emptied',
      targetType: 'system',
      ip: request.ip,
      meta: { removed: items.length, freedBytes: items.reduce((sum, file) => sum + file.size, 0) },
    });
    return { ok: true, removed: items.length };
  });

  app.post('/api/files/trash/purge-expired', async (request) => {
    const user = requireUser(request);
    return await purgeExpiredTrash(user.id);
  });

  app.get('/api/files/:id/stream', async (request, reply) => {
    const file = await ownFile(request, (request.params as { id: string }).id);
    return await serveFileRange(request, reply, file, { attachment: false });
  });

  app.get('/api/files/:id/download', async (request, reply) => {
    const file = await ownFile(request, (request.params as { id: string }).id);
    if (!request.headers.range) {
      await Activity.record({
        userId: requireUser(request).id,
        action: 'download',
        targetType: 'file',
        targetId: file.id,
        targetName: file.name,
        ip: request.ip,
        meta: { sizeBytes: file.size },
      });
    }
    return await serveFileRange(request, reply, file, { attachment: true });
  });

  app.get('/api/files/:id/thumbnail', async (request, reply) => {
    const file = await ownFile(request, (request.params as { id: string }).id);
    const stream = await openThumbnail(file);
    if (!stream) return reply.code(404).send();
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'private, max-age=86400')
      .send(stream);
  });

  app.get('/api/storage', async (request) => {
    const user = requireUser(request);
    return await storageUsage(user.id);
  });
}
