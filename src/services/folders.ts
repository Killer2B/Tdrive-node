import { Files, Folders, type FolderRow } from '../db/repo.ts';
import { errors } from '../lib/errors.ts';
import { normalizeVirtualPath, sanitizeFileName } from '../lib/paths.ts';

export async function resolveFolderPath(userId: string, input: string): Promise<FolderRow | null> {
  const normalized = normalizeVirtualPath(input);
  if (normalized === '/') return null;
  const folder = await Folders.findByPath(userId, normalized);
  if (!folder) throw errors.notFound('مسار المجلّد غير موجود.');
  return folder;
}

export async function createFolderAtPath(userId: string, parentPath: string, inputName: string): Promise<FolderRow> {
  const parent = await resolveFolderPath(userId, parentPath);
  const name = sanitizeFileName(inputName);
  if (await Folders.findByParentName(userId, parent?.id ?? null, name)) {
    throw errors.conflict('يوجد عنصر بهذا الاسم في المسار المحدد.');
  }
  if (await Files.findByFolderAndName(userId, parent?.id ?? null, name)) {
    throw errors.conflict('يوجد عنصر بهذا الاسم في المسار المحدد.');
  }
  const path = normalizeVirtualPath(`${parent?.path ?? ''}/${name}`);
  return await Folders.create({ user_id: userId, parent_id: parent?.id ?? null, name, path });
}

export async function folderPath(userId: string, folderId: string | null): Promise<string> {
  if (!folderId) return '/';
  const folder = await Folders.findById(folderId);
  if (!folder || folder.user_id !== userId) throw errors.notFound('المجلّد غير موجود.');
  return folder.path;
}
