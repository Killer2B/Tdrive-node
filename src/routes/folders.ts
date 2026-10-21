/** مسارات المجلّدات: سرد/إنشاء/إعادة تسمية/حذف (المسار الافتراضيّ + تحديث الشجرة الفرعية). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { Folders, type FolderRow } from '../db/repo.ts';
import { exec, tb } from '../db/pg.ts';
import { requireUser } from '../plugins/auth.ts';
import { sanitizeFileName, normalizeVirtualPath } from '../lib/paths.ts';

function toApiFolder(f: FolderRow): Record<string, unknown> {
  return { id: f.id, name: f.name, parentId: f.parent_id, path: f.path, modified: f.updated_at };
}

async function uniqueFolderName(userId: string, parentId: string | null, desired: string): Promise<string> {
  const safe = sanitizeFileName(desired);
  if (!(await Folders.findByParentName(userId, parentId, safe))) return safe;
  for (let i = 1; i < 10000; i++) {
    const candidate = `${safe} (${i})`;
    if (!(await Folders.findByParentName(userId, parentId, candidate))) return candidate;
  }
  return `${safe}-${Date.now()}`;
}

const createBody = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().nullable().optional(),
});

export default async function folderRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/folders', async (request) => {
    const user = requireUser(request);
    const parentId = (request.query as { parentId?: string }).parentId;
    const pid = parentId === undefined || parentId === 'root' || parentId === '' ? null : parentId;
    return { folders: (await Folders.listChildren(user.id, pid)).map(toApiFolder) };
  });

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
    const name = await uniqueFolderName(user.id, parentId, body.name);
    const path = normalizeVirtualPath(`${parentPath}/${name}`);
    const folder = await Folders.create({ user_id: user.id, parent_id: parentId, name, path });
    return { folder: toApiFolder(folder) };
  });

  app.patch('/api/folders/:id', async (request) => {
    const user = requireUser(request);
    const id = (request.params as { id: string }).id;
    const body = parse(z.object({ name: z.string().min(1).max(200) }), request.body);
    const folder = await Folders.findById(id);
    if (!folder || folder.user_id !== user.id) throw errors.notFound('المجلّد غير موجود.');
    const name = await uniqueFolderName(user.id, folder.parent_id, body.name);
    const parentPath = folder.path.slice(0, folder.path.length - folder.name.length - 1) || '';
    const newPath = normalizeVirtualPath(`${parentPath}/${name}`);
    const oldPath = folder.path;

    await Folders.rename(folder.id, name, newPath);
    // حدّث مسارات الأحفاد
    await exec(
      `UPDATE ${tb('folders')} SET path = $1 || substr(path, $2::int + 1), updated_at = $3
       WHERE user_id = $4 AND path LIKE $5 ESCAPE '\\'`,
      [newPath, oldPath.length, Date.now(), user.id, `${oldPath.replace(/[%_]/g, (m) => '\\' + m)}/%`],
    );
    return { folder: toApiFolder((await Folders.findById(folder.id))!) };
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
