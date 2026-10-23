/** مسارات المجلّدات: سرد/إنشاء/إعادة تسمية/حذف (المسار الافتراضيّ + تحديث الشجرة الفرعية). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { Folders } from '../db/repo.ts';
import { requireUser } from '../plugins/auth.ts';
import { normalizeVirtualPath, sanitizeFileName } from '../lib/paths.ts';
import { folderDetails, toApiFolder, updateDriveItem } from '../services/drive.ts';

const createBody = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().nullable().optional(),
});

export default async function folderRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/folders', async (request) => {
    const user = requireUser(request);
    const parentId = (request.query as { parentId?: string }).parentId;
    const pid = parentId === undefined || parentId === 'root' || parentId === '' ? null : parentId;
    if (pid) await folderDetails(user.id, pid);
    return { folders: (await Folders.listChildren(user.id, pid)).map(toApiFolder) };
  });

  app.get('/api/folders/:id', async (request) => folderDetails(requireUser(request).id, (request.params as { id: string }).id));

  app.post('/api/folders', async (request) => {
    const user = requireUser(request);
    const body = parse(createBody, request.body);
    const parentId = body.parentId ?? null;
    let parentPath = '/';
    if (parentId) {
      const parent = await Folders.findById(parentId);
      if (!parent || parent.user_id !== user.id) throw errors.badRequest('المجلّد الأب غير موجود.');
      parentPath = parent.path;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const name = sanitizeFileName(body.name);
      let path: string;
      try { path = normalizeVirtualPath(`${parentPath}/${name}`); }
      catch { throw errors.badRequest('Destination path exceeds the supported length.'); }
      try {
        const folder = await Folders.create({ user_id: user.id, parent_id: parentId, name, path });
        return { folder: toApiFolder(folder) };
      } catch (error) {
        if ((error as { code?: string })?.code !== '23505') throw error;
      }
    }
    throw errors.conflict('Destination changed concurrently; retry.');
  });

  app.patch('/api/folders/:id', async (request) => {
    const user = requireUser(request);
    const id = (request.params as { id: string }).id;
    const body = parse(z.object({ name: z.string().min(1).max(200).optional(), parentId: z.string().nullable().optional() }).strict(), request.body);
    if (body.name === undefined && body.parentId === undefined) throw errors.badRequest('Provide name or parentId.');
    return { folder: await updateDriveItem(user.id, { type: 'folder', id }, { name: body.name, destinationId: body.parentId }) };
  });

  app.delete('/api/folders/:id', async (request) => {
    const user = requireUser(request);
    const id = (request.params as { id: string }).id;
    const folder = await Folders.findById(id);
    if (!folder || folder.user_id !== user.id) throw errors.notFound('المجلّد غير موجود.');
    // الملفّات داخل المجلّدات المحذوفة تنتقل للجذر (FK ON DELETE SET NULL)؛ المجلّدات الفرعية تُحذف تعاقبيًّا.
    await Folders.delete(folder.id);
    return { ok: true };
  });
}
