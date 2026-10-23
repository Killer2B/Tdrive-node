import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { allocateDriveName, Files, Folders, type FileRow, type FolderRow, type FileChunkRow } from '../db/repo.ts';
import { query, tb, withTransaction, type DbExecutor } from '../db/pg.ts';
import { AppError, errors, isAppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { HashingPassThrough } from '../lib/hash.ts';
import { MAX_PATH_LENGTH, normalizeVirtualPath } from '../lib/paths.ts';
import { loadConfig } from '../config/env.ts';
import { getStorage } from '../storage/index.ts';
import { cacheKey } from './chunkstore.ts';
import { extOf, openFileRange, toApiFile } from './files.ts';
import { parse } from '../lib/validate.ts';
import { getLogger } from '../lib/logger.ts';

export const driveQuery = z.object({
  folderId: z.string().min(1).max(200).default('root'),
  q: z.string().max(256).optional(),
  sort: z.enum(['name', 'modified', 'size']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});
export const operationBody = z.object({
  action: z.enum(['rename', 'move', 'copy', 'trash']),
  items: z.array(z.object({ type: z.enum(['file', 'folder']), id: z.string().min(1).max(200) }).strict()).min(1).max(100),
  destinationId: z.string().min(1).max(200).nullable().optional(),
  name: z.string().min(1).max(200).optional(),
}).strict().superRefine((body, ctx) => {
  if (body.action === 'rename' && (body.items.length !== 1 || body.name === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Rename requires one item and a name.' });
  }
  if (body.action !== 'rename' && body.name !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Name is only supported for rename.' });
  }
  if ((body.action === 'move' || body.action === 'copy') && body.destinationId === undefined) {
    ctx.addIssue({ code: 'custom', message: 'Move/copy requires destinationId; use null for root.' });
  }
  if (body.action !== 'move' && body.action !== 'copy' && body.destinationId !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'destinationId is only supported for move/copy.' });
  }
});
type Selection = z.infer<typeof operationBody>['items'][number];
type Owned = { type: 'file'; row: FileRow } | { type: 'folder'; row: FolderRow };
export type OperationResult = Selection & ({ ok: true; item?: Record<string, unknown>; coveredBy?: string } | { ok: false; error: { code: string; message: string } });

export function toApiFolder(folder: FolderRow): Record<string, unknown> {
  return { id: folder.id, name: folder.name, parentId: folder.parent_id, path: folder.path, modified: folder.updated_at };
}
const escaped = (input: string): string => input.replace(/[%_\\]/g, (m) => `\\${m}`);
const rootFolder = (): Record<string, unknown> => ({ id: 'root', name: 'Root', parentId: null, path: '/', modified: 0 });

async function ownedFolder(userId: string, id: string | null, client?: DbExecutor): Promise<FolderRow | null> {
  if (id === null || id === 'root') return null;
  const folder = client
    ? (await client.query<FolderRow>(`SELECT * FROM ${tb('folders')} WHERE user_id = $1 AND id = $2`, [userId, id])).rows[0]
    : await Folders.findById(id);
  if (!folder || folder.user_id !== userId) throw errors.notFound('Folder not found.');
  return folder;
}

export async function folderDetails(userId: string, id: string): Promise<{ folder: Record<string, unknown>; breadcrumbs: Record<string, unknown>[] }> {
  const folder = await ownedFolder(userId, id);
  const breadcrumbs: Record<string, unknown>[] = [];
  const visited = new Set<string>();
  let current = folder;
  while (current) {
    if (visited.has(current.id) || visited.size > 1024) throw errors.conflict('Invalid folder hierarchy.');
    visited.add(current.id);
    breadcrumbs.unshift(toApiFolder(current));
    current = await ownedFolder(userId, current.parent_id);
  }
  breadcrumbs.unshift(rootFolder());
  return { folder: folder ? toApiFolder(folder) : rootFolder(), breadcrumbs };
}

export async function listDrive(userId: string, raw: z.input<typeof driveQuery>): Promise<Record<string, unknown>> {
  const input = driveQuery.parse(raw);
  const details = await folderDetails(userId, input.folderId);
  const folderId = input.folderId === 'root' ? null : input.folderId;
  const searching = input.q !== undefined;
  const filter = searching ? `name ILIKE $2 ESCAPE '\\'` : `COALESCE(parent_id, '') = COALESCE($2::text, '')`;
  const fileFilter = searching ? filter : `COALESCE(folder_id, '') = COALESCE($2::text, '')`;
  const params = [userId, searching ? `%${escaped(input.q!)}%` : folderId];
  // Sort and paginate the union, not each type independently. No workspace preload.
  const cte = `WITH entries AS (
    SELECT 'folder' AS kind, id, name, updated_at, 0::bigint AS size, to_jsonb(folders) AS item
      FROM ${tb('folders')} folders WHERE user_id = $1 AND ${filter}
    UNION ALL
    SELECT 'file' AS kind, id, name, updated_at, size, to_jsonb(files) AS item
      FROM ${tb('files')} files WHERE user_id = $1 AND trashed = 0 AND ${fileFilter}
  )`;
  const column = { name: 'lower(name)', modified: 'updated_at', size: 'size' }[input.sort];
  const direction = input.order === 'desc' ? 'DESC' : 'ASC';
  const [rows, counts] = await Promise.all([
    query<{ kind: 'file' | 'folder'; item: FileRow | FolderRow }>(`${cte} SELECT kind, item FROM entries ORDER BY CASE WHEN kind = 'folder' THEN 0 ELSE 1 END, ${column} ${direction}, id ASC LIMIT $3 OFFSET $4`, [...params, input.limit, input.offset]),
    query<{ total: number }>(`${cte} SELECT COUNT(*)::bigint AS total FROM entries`, params),
  ]);
  const total = Number(counts[0]?.total ?? 0);
  return {
    folders: rows.filter((r) => r.kind === 'folder').map((r) => toApiFolder(r.item as FolderRow)),
    files: rows.filter((r) => r.kind === 'file').map((r) => toApiFile(r.item as FileRow)),
    breadcrumbs: details.breadcrumbs,
    total,
    nextOffset: rows.length > 0 && input.offset + rows.length < total ? input.offset + rows.length : null,
  };
}

async function ownedItem(userId: string, selection: Selection, client?: DbExecutor): Promise<Owned> {
  if (selection.type === 'folder') {
    const row = await ownedFolder(userId, selection.id, client);
    if (!row) throw errors.badRequest('Root cannot be modified.');
    return { type: 'folder', row };
  }
  const row = client
    ? (await client.query<FileRow>(`SELECT * FROM ${tb('files')} WHERE user_id = $1 AND id = $2`, [userId, selection.id])).rows[0]
    : await Files.findById(selection.id);
  if (!row || row.user_id !== userId) throw errors.notFound('File not found.');
  return { type: 'file', row };
}

async function lockDrive(client: DbExecutor, userId: string): Promise<void> {
  // Row lock works with transaction-mode poolers and serializes shared operations per user.
  await client.query(`SELECT id FROM ${tb('users')} WHERE id = $1 FOR UPDATE`, [userId]);
}

function childPath(parent: FolderRow | null, name: string): string {
  try { return normalizeVirtualPath(`${parent?.path ?? ''}/${name}`); }
  catch { throw errors.badRequest('Destination path exceeds the supported length.'); }
}

async function validateDestination(userId: string, source: Owned, destinationId: string | null, client?: DbExecutor): Promise<FolderRow | null> {
  const destination = await ownedFolder(userId, destinationId, client);
  if (source.type === 'folder' && destination && (source.row.id === destination.id || destination.path.startsWith(`${source.row.path}/`))) {
    throw errors.conflict('A folder cannot be moved or copied into itself or a descendant.');
  }
  return destination;
}

/** Rename and move together for legacy PATCH endpoints, without intermediate mutations. */
export async function updateDriveItem(userId: string, selection: Selection, patch: { name?: string; destinationId?: string | null }): Promise<Record<string, unknown>> {
  return withTransaction(async (client) => {
    await lockDrive(client, userId);
    const source = await ownedItem(userId, selection, client);
    if (source.type === 'file' && source.row.trashed) throw errors.conflict('Restore the file before modifying it.');
    const parentId = patch.destinationId === undefined
      ? source.type === 'folder' ? source.row.parent_id : source.row.folder_id
      : patch.destinationId;
    const parent = await validateDestination(userId, source, parentId, client);
    const name = await allocateDriveName(client, userId, parent?.id ?? null, patch.name ?? source.row.name, source.type, source.row.id);
    if (name === source.row.name && (parent?.id ?? null) === (source.type === 'folder' ? source.row.parent_id : source.row.folder_id)) {
      return source.type === 'folder' ? toApiFolder(source.row) : toApiFile(source.row);
    }
    const ts = Date.now();
    if (source.type === 'file') {
      const result = await client.query<FileRow>(`UPDATE ${tb('files')} SET name = $1, folder_id = $2, ext = $3, updated_at = $4 WHERE user_id = $5 AND id = $6 RETURNING *`, [name, parent?.id ?? null, extOf(name) || null, ts, userId, source.row.id]);
      return toApiFile(result.rows[0]);
    }
    const oldPath = source.row.path;
    const newPath = childPath(parent, name);
    const descendants = await client.query<FolderRow>(`SELECT * FROM ${tb('folders')} WHERE user_id = $1 AND path LIKE $2 ESCAPE '\\'`, [userId, `${escaped(oldPath)}/%`]);
    if (descendants.rows.some((f) => newPath.length + f.path.length - oldPath.length > MAX_PATH_LENGTH)) {
      throw errors.badRequest('A descendant path exceeds the supported length.');
    }
    await client.query(`UPDATE ${tb('folders')} SET path = $1 || substr(path, $2::int + 1), updated_at = $3 WHERE user_id = $4 AND path LIKE $5 ESCAPE '\\'`, [newPath, Array.from(oldPath).length, ts, userId, `${escaped(oldPath)}/%`]);
    const result = await client.query<FolderRow>(`UPDATE ${tb('folders')} SET name = $1, parent_id = $2, path = $3, updated_at = $4 WHERE user_id = $5 AND id = $6 RETURNING *`, [name, parent?.id ?? null, newPath, ts, userId, source.row.id]);
    return toApiFolder(result.rows[0]);
  });
}

type PreparedFile = { source: FileRow; row: FileRow; chunks: FileChunkRow[] };
async function ensureCopyCapacity(userId: string, files: FileRow[], client?: DbExecutor): Promise<void> {
  const additional = files.reduce((sum, file) => sum + file.size, 0);
  const maxFileSize = loadConfig().upload.maxFileSize;
  if (!Number.isSafeInteger(additional) || additional < 0 || files.some((file) => maxFileSize > 0 && file.size > maxFileSize)) throw errors.payloadTooLarge('Copy exceeds the configured file-size limit.');
  const sql = `SELECT COALESCE((SELECT SUM(size) FROM ${tb('files')} WHERE user_id = $1), 0)::bigint AS used,
    (SELECT value FROM ${tb('settings')} WHERE user_id = $1 AND key = 'workspace') AS settings`;
  const row = (client ? (await client.query<{ used: number; settings: Record<string, unknown> | null }>(sql, [userId])).rows : await query<{ used: number; settings: Record<string, unknown> | null }>(sql, [userId]))[0];
  const configured = row?.settings?.quotaBytes;
  const quota = typeof configured === 'number' && Number.isSafeInteger(configured) && configured > 0 ? configured : 5_000_000_000_000;
  // Processing/pending/error and trashed rows still reserve physical bytes.
  const used = Number(row?.used ?? 0);
  if (additional > quota - used) throw new AppError({ code: 'QUOTA_EXCEEDED', statusCode: 413, userMessage: 'Copy would exceed the workspace storage quota.' });
}

async function copyItem(userId: string, selection: Selection, destinationId: string | null): Promise<Record<string, unknown>> {
  const source = await ownedItem(userId, selection);
  await validateDestination(userId, source, destinationId);
  const folders = source.type === 'folder'
    ? await query<FolderRow>(`SELECT * FROM ${tb('folders')} WHERE user_id = $1 AND (id = $2 OR path LIKE $3 ESCAPE '\\') ORDER BY length(path), id`, [userId, source.row.id, `${escaped(source.row.path)}/%`])
    : [];
  const sourceFiles = source.type === 'file' ? [source.row] : await query<FileRow>(`SELECT * FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 AND folder_id = ANY($2::text[]) ORDER BY id`, [userId, folders.map((f) => f.id)]);
  if (folders.length + sourceFiles.length > 10_000) throw errors.payloadTooLarge('Copy is limited to 10000 subtree entries per item.');
  if (sourceFiles.some((file) => file.trashed || file.status !== 'ready')) throw errors.conflict('Only active, ready files can be copied.');
  await ensureCopyCapacity(userId, sourceFiles);
  const storage = getStorage();
  const cfg = loadConfig();
  const keys: string[] = [];
  const prepared: PreparedFile[] = [];
  const folderIds = new Map(folders.map((f) => [f.id, newId('fld')]));
  try {
    // Independent streamed objects: deleting either copy cannot invalidate the other.
    // All storage/Telegram reads finish before opening the metadata transaction.
    for (const original of sourceFiles) {
      const id = newId('fil');
      const chunkSize = cfg.upload.chunkSize;
      const chunks: FileChunkRow[] = [];
      for (let idx = 0; idx < Math.max(1, Math.ceil(original.size / chunkSize)); idx++) {
        const size = Math.min(chunkSize, Math.max(0, original.size - idx * chunkSize));
        const input = size === 0 ? Readable.from([]) : (await openFileRange(original, { start: idx * chunkSize, end: idx * chunkSize + size - 1 })).stream;
        const hash = new HashingPassThrough();
        const key = cacheKey(id, idx);
        keys.push(key);
        const tasks = [pipeline(input, hash), storage.put(key, hash, { size })];
        try { await Promise.all(tasks); }
        catch (error) { input.destroy(); hash.destroy(); await Promise.allSettled(tasks); throw error; }
        if (hash.bytes !== size) throw errors.conflict('Source content length changed during copy.');
        chunks.push({ file_id: id, idx, size, sha256: hash.digestHex(), cached: 1, tg_file_id: null, tg_message_id: null });
      }
      const ts = Date.now();
      prepared.push({ source: original, chunks, row: { ...original, id, storage_key: null, thumb_key: null, thumb_tg_file_id: null, thumb_tg_message_id: null, backend: cfg.content.backend, chunk_size: chunkSize, status: cfg.content.backend === 'telegram' ? 'processing' : 'ready', starred: 0, pinned: 0, created_at: ts, updated_at: ts } });
    }
    return await withTransaction(async (client) => {
      await lockDrive(client, userId);
      await ensureCopyCapacity(userId, sourceFiles, client);
      const fresh = await ownedItem(userId, selection, client);
      const destination = await validateDestination(userId, fresh, destinationId, client);
      // Reject concurrent source changes instead of publishing a stale/incomplete subtree.
      const currentFolders = fresh.type === 'folder' ? (await client.query<FolderRow>(`SELECT * FROM ${tb('folders')} WHERE user_id = $1 AND (id = $2 OR path LIKE $3 ESCAPE '\\') ORDER BY length(path), id`, [userId, fresh.row.id, `${escaped(fresh.row.path)}/%`])).rows : [];
      const currentFiles = fresh.type === 'file' ? [fresh.row] : (await client.query<FileRow>(`SELECT * FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 AND folder_id = ANY($2::text[]) ORDER BY id`, [userId, currentFolders.map((f) => f.id)])).rows;
      if (JSON.stringify(currentFolders) !== JSON.stringify(folders) || JSON.stringify(currentFiles) !== JSON.stringify(sourceFiles)) throw errors.conflict('Source changed during copy; retry.');
      let root: Record<string, unknown> | undefined;
      const copiedFolders = new Map<string, FolderRow>();
      for (const original of folders) {
        const parent = original.id === selection.id ? destination : copiedFolders.get(original.parent_id!)!;
        if (original.id !== selection.id && !parent) throw errors.conflict('Invalid source hierarchy.');
        const name = await allocateDriveName(client, userId, parent?.id ?? null, original.name, 'folder');
        const created = await Folders.create({ id: folderIds.get(original.id), user_id: userId, parent_id: parent?.id ?? null, name, path: childPath(parent, name) }, client);
        copiedFolders.set(original.id, created);
        if (original.id === selection.id) root = toApiFolder(created);
      }
      for (const file of prepared) {
        const parentId = source.type === 'file' ? destination?.id ?? null : copiedFolders.get(file.source.folder_id!)!.id;
        const name = await allocateDriveName(client, userId, parentId, file.row.name, 'file');
        const created = await Files.create({ ...file.row, folder_id: parentId, name }, client);
        for (const chunk of file.chunks) await client.query(`INSERT INTO ${tb('file_chunks')} (file_id, idx, size, sha256, cached) VALUES ($1, $2, $3, $4, 1)`, [created.id, chunk.idx, chunk.size, chunk.sha256]);
        if (created.backend === 'telegram') {
          // Durable queue entry is committed with the copy, not a fallible post-commit side effect.
          await client.query(`INSERT INTO ${tb('jobs')} (id,user_id,type,status,payload,title,max_attempts,created_at,updated_at) VALUES ($1,$2,'flush_telegram','queued',$3::jsonb,$4,$5,$6,$6)`, [newId('job'), userId, JSON.stringify({ fileId: created.id }), name, cfg.queue.jobMaxAttempts, Date.now()]);
        }
        if (source.type === 'file') root = toApiFile(created);
      }
      return root!;
    });
  } catch (error) {
    await Promise.all(keys.map((key) => storage.delete(key).catch(() => {})));
    throw error;
  }
}

export async function driveOperations(userId: string, raw: z.input<typeof operationBody>): Promise<{ results: OperationResult[] }> {
  const body = parse(operationBody, raw);
  const results: OperationResult[] = [];
  const sources = new Map<string, Owned>();
  const failures = new Map<string, unknown>();
  const keyOf = (item: Selection): string => `${item.type}:${item.id}`;
  for (const item of body.items) {
    try { sources.set(keyOf(item), await ownedItem(userId, item)); }
    catch (error) { failures.set(keyOf(item), error); }
  }
  const seen = new Set<string>();
  const selectedFolders = [...sources.values()].filter((item): item is { type: 'folder'; row: FolderRow } => item.type === 'folder').sort((a, b) => a.row.path.length - b.row.path.length);
  const covered = new Map<string, string>();
  if (body.action === 'move' || body.action === 'copy') {
    // Resolve coverage from the original hierarchy before any selected ancestor moves.
    for (const [key, source] of sources) {
      try {
        const containing = source.type === 'folder' ? source.row.path : source.row.folder_id ? (await ownedFolder(userId, source.row.folder_id))?.path : undefined;
        const ancestor = selectedFolders.find((folder) => folder.row.id !== source.row.id && containing && (containing === folder.row.path || containing.startsWith(`${folder.row.path}/`)));
        if (ancestor) covered.set(key, ancestor.row.id);
      } catch (error) { failures.set(key, error); }
    }
  }
  for (const item of body.items) {
    try {
      const key = keyOf(item);
      if (failures.has(key)) throw failures.get(key);
      if (seen.has(key)) {
        results.push({ ...item, ok: false, error: { code: 'DUPLICATE_SELECTION', message: 'Duplicate selection skipped; see the first result for this item.' } });
        continue;
      }
      seen.add(key);
      if (body.action === 'move' || body.action === 'copy') {
        const ancestorId = covered.get(key);
        if (ancestorId) { results.push({ ...item, ok: false, error: { code: 'COVERED_BY_ANCESTOR', message: `Selection is covered by folder ${ancestorId}; see that folder's result.` } }); continue; }
      }
      let changed: Record<string, unknown> | undefined;
      if (body.action === 'copy') changed = await copyItem(userId, item, body.destinationId!);
      else if (body.action === 'rename' || body.action === 'move') changed = await updateDriveItem(userId, item, body.action === 'rename' ? { name: body.name } : { destinationId: body.destinationId });
      else {
        if (item.type === 'folder') throw new AppError({ code: 'FOLDER_TRASH_UNSUPPORTED', statusCode: 422, userMessage: 'Folder trash is not supported without hierarchy-preserving restore. No folders or contained files were changed.' });
        changed = await withTransaction(async (client) => {
          await lockDrive(client, userId);
          await ownedItem(userId, item, client);
          const result = await client.query<FileRow>(`UPDATE ${tb('files')} SET trashed = 1, trashed_at = $1, updated_at = $1 WHERE user_id = $2 AND id = $3 RETURNING *`, [Date.now(), userId, item.id]);
          return toApiFile(result.rows[0]);
        });
      }
      results.push({ ...item, ok: true, item: changed });
    } catch (error) {
      if (!isAppError(error)) getLogger().error({ err: error, userId, action: body.action, item }, 'Drive item operation failed');
      const failure = isAppError(error) ? error : (error as { code?: string })?.code === '23505' ? errors.conflict('Destination changed concurrently; retry.') : errors.internal();
      results.push({ ...item, ok: false, error: { code: failure.code, message: failure.userMessage } });
    }
  }
  return { results: results.map((result) => {
    if (result.ok || result.error.code !== 'COVERED_BY_ANCESTOR') return result;
    const ancestorId = covered.get(keyOf(result))!;
    const ancestor = results.find((r) => r.type === 'folder' && r.id === ancestorId);
    return ancestor?.ok
      ? { type: result.type, id: result.id, ok: true, coveredBy: ancestorId }
      : { ...result, error: { code: 'ANCESTOR_OPERATION_FAILED', message: `Selected ancestor folder ${ancestorId} failed; this item was not processed separately.` } };
  }) };
}
