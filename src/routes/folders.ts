/** مسارات المجلّدات: سرد/إنشاء/إعادة تسمية/حذف (المسار الافتراضيّ + تحديث الشجرة الفرعية). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { Folders, type FolderRow } from '../db/repo.ts';
import { getDb } from '../db/db.ts';
import { requireUser } from '../plugins/auth.ts';
import { sanitizeFileName, normalizeVirtualPath } from '../lib/paths.ts';

function toApiFolder(f: FolderRow): Record<string, unknown> {
  return { id: f.id, name: f.name, parentId: f.parent_id, path: f.path, modified: f.updated_at };
}

function uniqueFolderName(userId: string, parentId: string | null, desired: string): string {
  const safe = sanitizeFileName(desired);
  if (!Folders.findByParentName(userId, parentId, safe)) return safe;
  for (let i = 1; i < 10000; i++) {
    const candidate = `${safe} (${i})`;
    if (!Folders.findByParentName(userId, parentId, candidate)) return candidate;
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
    return { folders: Folders.listChildren(user.id, pid).map(toApiFolder) };
  });

  app.post('/api/folders', async (request) => {
    const user = requireUser(request);
    const body = parse(createBody, request.body);
    const parentId = body.parentId ?? null;
    let parentPath = '/';
    if (parentId) {
      const parent = Folders.findById(parentId);
      if (!parent || parent.user_id !== user.id) throw errors.badRequest('المجلّد الأب غير موجود.');
      parentPath = parent.path;
    }
    const name = uniqueFolderName(user.id, parentId, body.name);
    const path = normalizeVirtualPath(`${parentPath}/${name}`);
    const folder = Folders.create({ user_id: user.id, parent_id: parentId, name, path });
    return { folder: toApiFolder(folder) };
  });

  app.patch('/api/folders/:id', async (request) => {
    const user = requireUser(request);
    const id = (request.params as { id: string }).id;
    const body = parse(z.object({ name: z.string().min(1).max(200) }), request.body);
    const folder = Folders.findById(id);
    if (!folder || folder.user_id !== user.id) throw errors.notFound('المجلّد غير موجود.');
    const name = uniqueFolderName(user.id, folder.parent_id, body.name);
    const parentPath = folder.path.slice(0, folder.path.length - folder.name.length - 1) || '';
    const newPath = normalizeVirtualPath(`${parentPath}/${name}`);
    const oldPath = folder.path;

    const db = getDb();
    const tx = db.transaction(() => {
      Folders.rename(folder.id, name, newPath);
      // حدّث مسارات الأحفاد
      db.prepare(
        `UPDATE folders SET path = @new || substr(path, @oldLen + 1), updated_at = @ts
         WHERE user_id = @uid AND path LIKE @like ESCAPE '\\'`,
      ).run({
        new: newPath,
        oldLen: oldPath.length,
        ts: Date.now(),
        uid: user.id,
        like: `${oldPath.replace(/[%_]/g, (m) => '\\' + m)}/%`,
      });
    });
    tx();
    return { folder: toApiFolder(Folders.findById(folder.id)!) };
  });

  app.delete('/api/folders/:id', async (request) => {
    const user = requireUser(request);
    const id = (request.params as { id: string }).id;
    const folder = Folders.findById(id);
    if (!folder || folder.user_id !== user.id) throw errors.notFound('المجلّد غير موجود.');
    // الملفّات داخل المجلّدات المحذوفة تنتقل للجذر (FK ON DELETE SET NULL)؛ المجلّدات الفرعية تُحذف تعاقبيًّا.
    Folders.delete(folder.id);
    return { ok: true };
  });
}
