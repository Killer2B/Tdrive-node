import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildServer } from '../../src/server.ts';
import { loadConfig, resetConfigCache } from '../../src/config/env.ts';
import { setExecutor } from '../../src/db/pg.ts';
import { ApiKeys, Users, Sessions, Uploads, type FileRow, type FolderRow, type FileChunkRow, type UploadRow } from '../../src/db/repo.ts';
import { getStorage } from '../../src/storage/index.ts';
import { invalidateCredentialCache } from '../../src/services/credentials.ts';
import { SESSION_COOKIE } from '../../src/plugins/auth.ts';
import { deleteFilePermanent, openFileRange } from '../../src/services/files.ts';
import { initUpload } from '../../src/services/uploads.ts';

test('drive operations and API mirrors preserve ownership, hierarchy, and content', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'tdrive-operations-'));
  resetConfigCache();
  loadConfig({ SESSION_SECRET: 'isolated-operations-secret', DATABASE_URL: 'postgresql://unused/unused', CONTENT_BACKEND: 'local', NODE_ENV: 'test', LOG_LEVEL: 'silent', CHUNK_SIZE_MB: String(4 / 1024 / 1024), TMP_DIR: temp, THUMBNAILS_ENABLED: 'false' });
  invalidateCredentialCache();
  const user = { id: 'owner', username: 'owner', password_hash: '', role: 'owner', created_at: 1, updated_at: 1 };
  t.mock.method(Users, 'findById', async () => user);
  t.mock.method(Sessions, 'find', async (id: string) => ({ id, user_id: user.id, expires_at: Date.now() + 60_000, created_at: 1, user_agent: null, ip: null }));
  const apiKey = `tdk_${'a'.repeat(64)}`;
  t.mock.method(ApiKeys, 'findActiveByHash', async (hash: string) => hash === createHash('sha256').update(apiKey).digest('hex') ? { id: 'key', user_id: user.id, label: 'test', key_hash: hash, key_prefix: 'tdk_', created_at: 1, revoked_at: null, last_used_at: null } : undefined);
  t.mock.method(ApiKeys, 'touch', async () => {});
  let folders: FolderRow[] = [];
  let files: FileRow[] = [];
  let chunks: FileChunkRow[] = [];
  let jobs: Record<string, unknown>[] = [];
  const objects = new Map<string, Buffer>();
  const statements: { sql: string; params: unknown[] }[] = [];
  let inTransaction = false;
  let failFileInsert = false;
  let failFolderUpdate = false;
  let quotaBytes: number | undefined;
  let reserveBytesDuringCopy = false;
  let snapshot: { folders: FolderRow[]; files: FileRow[]; chunks: FileChunkRow[]; jobs: Record<string, unknown>[] } | undefined;
  const clone = <T>(value: T): T => structuredClone(value);
  const folder = (id: string, name: string, parent_id: string | null = null, owner = user.id): FolderRow => ({ id, name, parent_id, user_id: owner, path: `${parent_id ? folders.find((f) => f.id === parent_id)!.path : ''}/${name}`, created_at: 1, updated_at: 1 });
  const file = (id: string, name: string, folder_id: string | null = null, owner = user.id, size = 0): FileRow => ({ id, name, folder_id, user_id: owner, size, ext: null, type: 'bin', mime: 'application/octet-stream', storage_key: null, sha256: null, status: 'ready', source: 'upload', source_url: null, thumb_key: null, duration: null, width: null, height: null, starred: 0, pinned: 0, trashed: 0, trashed_at: null, backend: 'local', chunk_size: 4, thumb_tg_file_id: null, thumb_tg_message_id: null, created_at: 1, updated_at: 1 });
  const reset = () => { folders = []; files = []; chunks = []; jobs = []; objects.clear(); statements.length = 0; quotaBytes = undefined; reserveBytesDuringCopy = false; };
  const matchPrefix = (value: string, pattern: string): boolean => value.startsWith(pattern.slice(0, -1).replace(/\\([%_\\])/g, '$1'));
  const tableRows = (sql: string): (FileRow | FolderRow | FileChunkRow | Record<string, unknown>)[] => sql.includes('"file_chunks"') ? chunks : sql.includes('"folders"') ? folders : sql.includes('"jobs"') ? jobs : files;
  setExecutor({ async query(sql, params = []) {
    statements.push({ sql, params });
    if (sql === 'BEGIN') { assert.equal(inTransaction, false); inTransaction = true; snapshot = clone({ folders, files, chunks, jobs }); return { rows: [], rowCount: 0 }; }
    if (sql === 'COMMIT') { inTransaction = false; return { rows: [], rowCount: 0 }; }
    if (sql === 'ROLLBACK') { ({ folders, files, chunks, jobs } = snapshot!); inTransaction = false; return { rows: [], rowCount: 0 }; }
    if (sql.includes('FOR UPDATE') || sql.includes('"activity_log"')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('SELECT COALESCE((SELECT SUM')) return { rows: [{ used: files.filter((f) => f.user_id === params[0]).reduce((sum, f) => sum + f.size, 0), settings: quotaBytes === undefined ? null : { quotaBytes } }] as any, rowCount: 1 };
    if (sql.startsWith('WITH entries')) {
      const searching = sql.includes('ILIKE');
      const needle = String(params[1]).slice(1, -1).replace(/\\([%_\\])/g, '$1').toLowerCase();
      const entries = [
        ...folders.filter((f) => f.user_id === params[0] && (searching ? f.name.toLowerCase().includes(needle) : f.parent_id === params[1])).map((item) => ({ kind: 'folder', item })),
        ...files.filter((f) => f.user_id === params[0] && !f.trashed && (searching ? f.name.toLowerCase().includes(needle) : f.folder_id === params[1])).map((item) => ({ kind: 'file', item })),
      ];
      if (sql.includes('COUNT(*)')) return { rows: [{ total: entries.length }] as any, rowCount: 1 };
      assert.match(sql, /ORDER BY CASE WHEN kind = 'folder' THEN 0 ELSE 1 END/);
      const direction = /(?:lower\(name\)|updated_at|size) DESC/.test(sql) ? -1 : 1;
      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        const sort = sql.includes('lower(name)') ? a.item.name.localeCompare(b.item.name) : sql.includes(', updated_at') ? a.item.updated_at - b.item.updated_at : ('size' in a.item ? a.item.size : 0) - ('size' in b.item ? b.item.size : 0);
        return direction * sort || a.item.id.localeCompare(b.item.id);
      });
      return { rows: entries.slice(Number(params[3]), Number(params[3]) + Number(params[2])).map(clone) as any, rowCount: entries.length };
    }
    if (sql.startsWith('SELECT id') && sql.includes('UNION ALL')) {
      const occupied = folders.find((f) => f.user_id === params[0] && f.parent_id === params[1] && f.name === params[2] && f.id !== params[3]) ?? files.find((f) => f.user_id === params[0] && f.folder_id === params[1] && f.name === params[2] && !f.trashed && f.id !== params[3]);
      return { rows: occupied ? [{ id: occupied.id }] as any : [], rowCount: occupied ? 1 : 0 };
    }
    if (sql.startsWith('SELECT *')) {
      let rows = tableRows(sql);
      if (sql.includes('"file_chunks"')) rows = chunks.filter((c) => c.file_id === params[0]);
      else if (sql.includes('folder_id = ANY')) rows = files.filter((f) => f.user_id === params[0] && !f.trashed && (params[1] as string[]).includes(f.folder_id!));
      else if (sql.includes('id = $2 OR path LIKE')) rows = folders.filter((f) => f.user_id === params[0] && (f.id === params[1] || matchPrefix(f.path, String(params[2])))).sort((a, b) => a.path.length - b.path.length || a.id.localeCompare(b.id));
      else if (sql.includes('path LIKE')) rows = folders.filter((f) => f.user_id === params[0] && matchPrefix(f.path, String(params[1])));
      else if (sql.includes('COALESCE(parent_id')) rows = folders.filter((f) => f.user_id === params[0] && f.parent_id === params[1] && (params.length === 2 || f.name === params[2]));
      else if (sql.includes('COALESCE(folder_id')) rows = files.filter((f) => f.user_id === params[0] && f.folder_id === params[1] && f.name === params[2] && !f.trashed);
      else if (sql.includes('user_id = $1 AND id = $2')) rows = (rows as (FileRow | FolderRow)[]).filter((r) => r.user_id === params[0] && r.id === params[1]);
      else if (sql.includes('WHERE id = $1')) rows = (rows as (FileRow | FolderRow)[]).filter((r) => r.id === params[0]);
      return { rows: rows.map(clone) as any, rowCount: rows.length };
    }
    if (sql.startsWith('INSERT')) {
      if (failFileInsert && sql.includes('"files"')) throw new Error('injected insert failure');
      const names = /\(([^)]+)\)\s*VALUES/.exec(sql)![1].split(',').map((name) => name.trim());
      const values = /VALUES\s*\(([^)]+)\)/.exec(sql)![1].split(',').map((value) => value.trim());
      const inserted = Object.fromEntries(names.map((name, index) => {
        const marker = /^\$(\d+)/.exec(values[index]);
        return [name, marker ? params[Number(marker[1]) - 1] : /^'.*'$/.test(values[index]) ? values[index].slice(1, -1) : Number(values[index])];
      }));
      if (sql.includes('"file_chunks"')) Object.assign(inserted, { tg_file_id: inserted.tg_file_id ?? null, tg_message_id: inserted.tg_message_id ?? null });
      tableRows(sql).push(inserted);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE')) {
      if (sql.includes('substr(path')) {
        assert.match(String(params[4]), /\/%$/);
        for (const f of folders.filter((r) => r.user_id === params[3] && matchPrefix(r.path, String(params[4])))) { f.path = String(params[0]) + Array.from(f.path).slice(Number(params[1])).join(''); f.updated_at = Number(params[2]); }
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SET name = $1, parent_id')) {
        if (failFolderUpdate) throw new Error('injected folder update failure');
        const row = folders.find((f) => f.user_id === params[4] && f.id === params[5])!;
        Object.assign(row, { name: params[0], parent_id: params[1], path: params[2], updated_at: params[3] });
        return { rows: [clone(row)] as any, rowCount: 1 };
      }
      if (sql.includes('SET name = $1, folder_id')) {
        const row = files.find((f) => f.user_id === params[4] && f.id === params[5])!;
        Object.assign(row, { name: params[0], folder_id: params[1], ext: params[2], updated_at: params[3] });
        return { rows: [clone(row)] as any, rowCount: 1 };
      }
      if (sql.includes('SET trashed = 1')) {
        const row = files.find((f) => f.user_id === params[1] && f.id === params[2])!;
        Object.assign(row, { trashed: 1, trashed_at: params[0], updated_at: params[0] });
        return { rows: [clone(row)] as any, rowCount: 1 };
      }
      if (sql.includes('SET trashed = $1')) {
        const row = files.find((f) => f.id === params[3])!;
        Object.assign(row, { trashed: params[0], trashed_at: params[1], updated_at: params[2] });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE')) {
      if (sql.includes('"file_chunks"')) chunks = chunks.filter((c) => c.file_id !== params[0]);
      if (sql.includes('"files"')) files = files.filter((f) => f.id !== params[0]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unhandled test SQL: ${sql}`);
  } });
  const storage = getStorage();
  t.mock.method(storage, 'put', async (key: string, data: Readable | Buffer) => {
    assert.equal(inTransaction, false, 'storage IO must happen outside metadata transaction');
    const parts: Buffer[] = [];
    if (Buffer.isBuffer(data)) parts.push(data);
    else for await (const part of data) parts.push(Buffer.from(part));
    const bytes = Buffer.concat(parts); objects.set(key, bytes);
    if (reserveBytesDuringCopy) { reserveBytesDuringCopy = false; files.push({ ...file('reserved', 'Concurrent processing', null, user.id, 3), status: 'processing' }); }
    return { key, size: bytes.length };
  });
  t.mock.method(storage, 'get', async (key: string) => { assert.equal(inTransaction, false); return objects.get(key)!; });
  t.mock.method(storage, 'stat', async (key: string) => { assert.equal(inTransaction, false); return objects.has(key) ? { key, size: objects.get(key)!.length } : null; });
  t.mock.method(storage, 'createReadStream', async (key: string, range?: { start: number; end: number }) => { assert.equal(inTransaction, false); const bytes = objects.get(key); if (!bytes) throw new Error('Object not found'); return Readable.from(range ? bytes.subarray(range.start, range.end + 1) : bytes); });
  t.mock.method(storage, 'delete', async (key: string) => { assert.equal(inTransaction, false); objects.delete(key); });
  const app = await buildServer();
  t.after(async () => { await app.close(); setExecutor(null); invalidateCredentialCache(); resetConfigCache(); await rm(temp, { recursive: true, force: true }); });
  await app.ready();
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(app.signCookie('session'))}`;
  const headers = { cookie };
  const apiHeaders = { authorization: `Bearer ${apiKey}` };
  const operate = async (payload: unknown, v1 = false) => {
    const response = await app.inject({ method: 'POST', url: v1 ? '/api/v1/operations' : '/api/drive/operations', headers: v1 ? apiHeaders : headers, payload: payload as any });
    assert.equal(response.statusCode, 200, response.body);
    return v1 ? response.json().data.results : response.json().results;
  };

  await t.test('auth and body bounds are enforced in cookie and v1 routes', async () => {
    for (const url of ['/api/drive', '/api/v1/drive']) assert.equal((await app.inject(url)).statusCode, 401);
    for (const payload of [{ action: 'move', items: [{ type: 'file', id: 'x' }] }, { action: 'rename', items: [], name: 'x' }, { action: 'rename', items: [{ type: 'file', id: 'x' }, { type: 'file', id: 'y' }], name: 'x' }, { action: 'trash', items: [{ type: 'file', id: 'x' }], name: 'x' }, { action: 'trash', items: Array.from({ length: 101 }, () => ({ type: 'file', id: 'x' })) }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/drive/operations', headers, payload })).statusCode, 422);
    }
    for (const query of ['limit=0', 'limit=501', 'offset=-1', 'sort=bad', 'order=bad']) assert.equal((await app.inject({ url: `/api/drive?${query}`, headers })).statusCode, 422);
  });
  await t.test('folder-scoped paging, shared total, global literal search and ancestry are isolated', async () => {
    reset(); folders.push(folder('b', 'Beta'), folder('a', 'Alpha'), folder('foreign', 'Secret', null, 'other')); folders.push(folder('nested', 'Nested', 'b'));
    files.push(file('root', 'Root'), file('inside', '100%_literal', 'nested'), file('secret', '100%_literal', null, 'other'), { ...file('trash', '100%_literal'), trashed: 1 });
    const page = await app.inject({ url: '/api/drive?limit=2', headers });
    assert.equal(page.statusCode, 200); assert.deepEqual(page.json().folders.map((f: any) => f.id), ['a', 'b']); assert.equal(page.json().total, 3); assert.equal(page.json().nextOffset, 2);
    const next = await app.inject({ url: '/api/drive?limit=2&offset=2', headers }); assert.deepEqual(next.json().files.map((f: any) => f.id), ['root']); assert.equal(next.json().nextOffset, null);
    const search = await app.inject({ url: '/api/v1/drive?q=100%25_&folderId=b', headers: apiHeaders }); assert.equal(search.statusCode, 200); assert.deepEqual(search.json().data.files.map((f: any) => [f.id, f.folderId]), [['inside', 'nested']]);
    const details = await app.inject({ url: '/api/folders/nested', headers }); assert.deepEqual(details.json().breadcrumbs.map((f: any) => f.id), ['root', 'b', 'nested']);
    for (const url of ['/api/drive?folderId=foreign', '/api/folders/foreign', '/api/v1/folders/foreign']) assert.equal((await app.inject({ url, headers: url.startsWith('/api/v1') ? apiHeaders : headers })).statusCode, 404);
    assert.ok(statements.some(({ params }) => params[1] === '%100\\%\\_%'));
    const sorted = await app.inject({ url: '/api/drive?sort=name&order=desc&limit=1', headers }); assert.equal(sorted.json().folders[0].id, 'b');
    const empty = await app.inject({ url: '/api/drive?offset=99', headers }); assert.equal(empty.json().nextOffset, null); assert.equal(empty.json().total, 3);
  });
  await t.test('rename no-op, mixed namespace suffix, safe 200-character bounds, legacy PATCH and move conflict', async () => {
    reset(); folders.push(folder('target', 'Target')); files.push(file('f', 'Original'), file('other', 'Original', 'target')); folders.push(folder('collision', 'Document', 'target'));
    let result = await operate({ action: 'rename', items: [{ type: 'file', id: 'f' }], name: 'Original' }); assert.equal(result[0].item.name, 'Original');
    result = await operate({ action: 'move', items: [{ type: 'file', id: 'f' }], destinationId: 'target' }); assert.equal(result[0].item.name, 'Original (1)');
    const patch = await app.inject({ method: 'PATCH', url: '/api/files/f', headers, payload: { name: 'Document', folderId: 'target' } }); assert.equal(patch.statusCode, 200, patch.body); assert.equal(patch.json().file.name, 'Document (1)');
    const long = 'x'.repeat(200); files.push(file('long', long, 'target'));
    result = await operate({ action: 'rename', items: [{ type: 'file', id: 'f' }], name: long }); assert.equal(result[0].item.name.length, 200); assert.ok(result[0].item.name.endsWith(' (1)'));
    result = await operate({ action: 'rename', items: [{ type: 'file', id: 'f' }], name: '../evil\\name?.txt' }); assert.equal(result[0].item.name, 'name_.txt');
    const create = await app.inject({ method: 'POST', url: '/api/folders', headers, payload: { name: long, parentId: 'target' } }); assert.equal(create.statusCode, 200); assert.equal(create.json().folder.name.length, 200); assert.ok(create.json().folder.name.endsWith(' (1)'));
  });
  await t.test('foreign ownership failures do not abort valid items; foreign destinations and descendant transfers reject', async () => {
    reset(); folders.push(folder('src', 'Source'), folder('foreign', 'Foreign', null, 'other')); folders.push(folder('child', 'Child', 'src')); files.push(file('mine', 'Mine'), file('other', 'Private', null, 'other'));
    const results = await operate({ action: 'trash', items: [{ type: 'file', id: 'other' }, { type: 'file', id: 'missing' }, { type: 'file', id: 'mine' }, { type: 'folder', id: 'src' }] }, true);
    assert.deepEqual(results.map((r: any) => r.ok ? 'ok' : r.error.code), ['NotFound', 'NotFound', 'ok', 'FOLDER_TRASH_UNSUPPORTED']); assert.equal(files.find((f) => f.id === 'other')!.trashed, 0); assert.equal(folders.length, 3);
    for (const action of ['move', 'copy']) for (const destinationId of ['src', 'child', 'foreign']) {
      const result = await operate({ action, items: [{ type: 'folder', id: 'src' }], destinationId }); assert.equal(result[0].ok, false); assert.equal(result[0].error.code, destinationId === 'foreign' ? 'NotFound' : 'Conflict');
    }
  });
  await t.test('escaped unicode folder paths move atomically with descendant path rollback', async () => {
    reset(); folders.push(folder('src', '\u{1f600}%_Folder'), folder('target', 'Target'), folder('decoy', '\u{1f600}XXFolder')); folders.push(folder('child', 'Child', 'src'), folder('decoy-child', 'Child', 'decoy')); files.push(file('inside', 'Inside', 'child'));
    const original = clone(folders); failFolderUpdate = true;
    let result = await operate({ action: 'move', items: [{ type: 'folder', id: 'src' }], destinationId: 'target' }); assert.equal(result[0].ok, false); assert.deepEqual(folders, original); failFolderUpdate = false;
    const response = await app.inject({ method: 'PATCH', url: '/api/folders/src', headers, payload: { name: 'Renamed', parentId: 'target' } }); assert.equal(response.statusCode, 200, response.body);
    assert.equal(folders.find((f) => f.id === 'child')!.path, '/Target/Renamed/Child'); assert.equal(folders.find((f) => f.id === 'decoy-child')!.path, '/\u{1f600}XXFolder/Child'); assert.equal(files[0].folder_id, 'child');
    assert.ok(statements.some(({ sql, params }) => sql.includes('substr(path') && params[1] === Array.from('/\u{1f600}%_Folder').length && params[4] === '/\u{1f600}\\%\\_Folder/%'));
    result = await operate({ action: 'move', items: [{ type: 'folder', id: 'src' }, { type: 'folder', id: 'child' }, { type: 'file', id: 'inside' }], destinationId: null }); assert.deepEqual(result.map((r: any) => r.ok ? r.coveredBy ?? 'ok' : r.error.code), ['ok', 'src', 'src']);
    result = await operate({ action: 'move', items: [{ type: 'file', id: 'inside' }, { type: 'folder', id: 'child' }, { type: 'folder', id: 'src' }], destinationId: 'child' }); assert.deepEqual(result.map((r: any) => r.ok ? 'ok' : r.error.code), ['ANCESTOR_OPERATION_FAILED', 'ANCESTOR_OPERATION_FAILED', 'Conflict']);
  });
  await t.test('file copy creates independent chunk bytes; deleting original cannot invalidate copy', async () => {
    reset(); const original = file('original', 'Bytes.bin', null, user.id, 9); original.storage_key = 'legacy/original'; original.thumb_key = 'thumbs/original.jpg'; files.push(original); objects.set(original.storage_key, Buffer.from('123456789')); objects.set(original.thumb_key, Buffer.from('thumb'));
    const result = await operate({ action: 'copy', items: [{ type: 'file', id: original.id }], destinationId: null }); assert.equal(result[0].ok, true);
    const copied = files.find((f) => f.id === result[0].item.id)!; assert.notEqual(copied.id, original.id); assert.equal(copied.name, 'Bytes (1).bin'); assert.equal(copied.storage_key, null); assert.equal(copied.thumb_key, null); assert.equal(chunks.length, 3); assert.ok(chunks.every((c) => c.file_id === copied.id && c.tg_file_id === null));
    await deleteFilePermanent(original); const opened = await openFileRange(copied); const parts: Buffer[] = []; for await (const part of opened.stream) parts.push(Buffer.from(part)); assert.equal(Buffer.concat(parts).toString(), '123456789'); assert.equal(objects.has('legacy/original'), false);
  });
  await t.test('copy rollback cleans staged storage and leaves no partial folder hierarchy', async () => {
    reset(); folders.push(folder('src', 'Source'), folder('target', 'Target')); folders.push(folder('nested', 'Nested', 'src')); files.push({ ...file('f', 'File', 'nested', user.id, 3), storage_key: 'original' }); objects.set('original', Buffer.from('abc'));
    const original = clone(folders); failFileInsert = true;
    const result = await operate({ action: 'copy', items: [{ type: 'folder', id: 'src' }], destinationId: 'target' }); failFileInsert = false;
    assert.equal(result[0].ok, false); assert.deepEqual(folders, original); assert.deepEqual([...objects.keys()], ['original']); assert.equal(files.length, 1); assert.equal(chunks.length, 0);
  });
  await t.test('copy rejects unavailable/processing content and legacy v1 rename shares no-op logic', async () => {
    reset(); files.push({ ...file('pending', 'Pending'), status: 'processing' });
    const result = await operate({ action: 'copy', items: [{ type: 'file', id: 'pending' }], destinationId: null }); assert.equal(result[0].error.code, 'Conflict'); assert.equal(objects.size, 0);
    files[0].status = 'ready';
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/files/pending', headers: apiHeaders, payload: { name: 'Pending' } }); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().data.file.name, 'Pending');
  });
  await t.test('copy quota accounts for reserved/trashed bytes and rechecks before metadata commit', async () => {
    reset(); quotaBytes = 5; files.push({ ...file('source', 'Source', null, user.id, 3), storage_key: 'source' }, { ...file('busy', 'Busy', null, user.id, 1), status: 'processing', trashed: 1 }); objects.set('source', Buffer.from('abc'));
    let result = await operate({ action: 'copy', items: [{ type: 'file', id: 'source' }], destinationId: null }); assert.equal(result[0].error.code, 'QUOTA_EXCEEDED'); assert.deepEqual([...objects.keys()], ['source']);
    files = files.filter((f) => f.id !== 'busy'); quotaBytes = 7; reserveBytesDuringCopy = true;
    result = await operate({ action: 'copy', items: [{ type: 'file', id: 'source' }], destinationId: null }); assert.equal(result[0].error.code, 'QUOTA_EXCEEDED'); assert.deepEqual([...objects.keys()], ['source']); assert.ok(!files.some((f) => f.name.startsWith('Source (')));
  });
  await t.test('folder copy includes >2000 active files and preserves nested parent mappings', async () => {
    reset(); folders.push(folder('src', 'Source'), folder('target', 'Target')); folders.push(folder('nested', 'Nested', 'src'));
    for (let i = 0; i < 2001; i++) files.push(file(`f${String(i).padStart(4, '0')}`, `File${i}`, 'src'));
    files.push(file('nested-file', 'Nested file', 'nested'), { ...file('trashed', 'Trashed', 'src'), trashed: 1 });
    const result = await operate({ action: 'copy', items: [{ type: 'file', id: 'nested-file' }, { type: 'folder', id: 'src' }], destinationId: 'target' });
    assert.equal(result[0].coveredBy, 'src'); assert.equal(result[0].ok, true); assert.equal(result[1].ok, true);
    const rootId = result[1].item.id; const nested = folders.find((f) => f.parent_id === rootId)!; assert.equal(nested.path, '/Target/Source/Nested'); assert.equal(files.filter((f) => f.folder_id === rootId).length, 2001); assert.equal(files.filter((f) => f.folder_id === nested.id).length, 1); assert.equal(chunks.length, 2002);
    assert.ok(!statements.some(({ sql }) => sql.includes('folder_id = ANY') && sql.includes('LIMIT')));
  });
  await t.test('file trash restores and duplicate selections are explicit', async () => {
    reset(); files.push(file('f', 'File'));
    const result = await operate({ action: 'trash', items: [{ type: 'file', id: 'f' }, { type: 'file', id: 'f' }] }); assert.equal(result[0].item.isDeleted, true); assert.equal(result[1].error.code, 'DUPLICATE_SELECTION');
    const restored = await app.inject({ method: 'POST', url: '/api/files/f/restore', headers }); assert.equal(restored.statusCode, 200, restored.body); assert.equal(files[0].trashed, 0); assert.equal(files[0].name, 'File');
  });
  await t.test('Telegram copy queues durable flush in the same metadata transaction; DAV ingestion queues flush', async () => {
    reset(); resetConfigCache(); loadConfig({ SESSION_SECRET: 'isolated-operations-secret', DATABASE_URL: 'postgresql://unused/unused', CONTENT_BACKEND: 'telegram', TG_BOT_TOKEN: 'test:fake', TG_CHAT_ID: '-1', NODE_ENV: 'test', LOG_LEVEL: 'silent', CHUNK_SIZE_MB: String(4 / 1024 / 1024), TMP_DIR: temp, THUMBNAILS_ENABLED: 'false' });
    files.push(file('f', 'Empty'));
    const result = await operate({ action: 'copy', items: [{ type: 'file', id: 'f' }], destinationId: null }); assert.equal(result[0].item.status, 'processing'); assert.equal(jobs.length, 1); assert.equal(jobs[0].type, 'flush_telegram'); assert.equal(JSON.parse(String(jobs[0].payload)).fileId, result[0].item.id);
    const response = await app.inject({ method: 'PUT', url: '/dav/Dav.bin', headers: apiHeaders, payload: Buffer.from('dav-bytes') }); assert.equal(response.statusCode, 201, response.body); assert.equal(jobs.length, 2); assert.equal(jobs[1].type, 'flush_telegram');
    const queued = statements.findIndex(({ sql }) => sql.includes('INSERT') && sql.includes('"jobs"')); const commit = statements.findIndex(({ sql }) => sql === 'COMMIT'); assert.ok(queued < commit);
  });
  await t.test('new OpenAPI paths have response, parameter and request schemas plus Basic auth', async () => {
    const response = await app.inject('/api/v1/openapi.json'); assert.equal(response.statusCode, 200); const spec = response.json();
    assert.equal(spec.components.securitySchemes.BasicAuth.scheme, 'basic'); assert.ok(spec.paths['/api/v1/drive'].get.responses['200']); assert.equal(spec.paths['/api/v1/drive'].get.parameters.length, 6); assert.ok(spec.paths['/api/v1/operations'].post.requestBody.required); assert.ok(spec.paths['/api/v1/operations'].post.responses['200']); assert.ok(spec.paths['/api/v1/folders/{id}'].get.parameters[0].required);
    for (const [route, operations] of Object.entries(spec.paths)) for (const operation of Object.values(operations as Record<string, any>)) {
      assert.ok(operation.responses, `${route} requires responses`);
      for (const id of [...route.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])) assert.ok(operation.parameters.some((p: any) => p.in === 'path' && p.name === id && p.required), `${route} requires path parameter`);
    }
    const basic = { authorization: `Basic ${Buffer.from(`any:${apiKey}`).toString('base64')}` }; assert.equal((await app.inject({ url: '/api/v1/drive', headers: basic })).statusCode, 200);
    const caps = await app.inject({ url: '/api/v1', headers: apiHeaders }); assert.equal(caps.json().data.capabilities.folderTrashRestore, false); assert.equal(caps.json().data.capabilities.nativeOneDrive, false);
  });
  await t.test('upload initialization rejects foreign destinations and idempotency metadata mismatch before reuse', async (st) => {
    reset(); folders.push(folder('owned', 'Owned'), folder('foreign', 'Foreign', null, 'other'));
    const existing: UploadRow = { id: 'upload', user_id: user.id, client_key: 'same-client-key', folder_id: 'owned', name: 'File', mime: null, size: 4, chunk_size: 4, total_chunks: 1, fingerprint: 'hash', status: 'pending', file_id: null, created_at: 1, updated_at: 1, expires_at: Date.now() + 60_000 };
    st.mock.method(Uploads, 'findByClientKey', async () => existing);
    st.mock.method(Uploads, 'receivedIndexes', async () => []);
    const input = { userId: user.id, clientKey: existing.client_key, folderId: 'owned', name: 'File', size: 4, fingerprint: 'hash' };
    await assert.rejects(initUpload({ ...input, folderId: 'foreign' }), /Destination folder not found/);
    for (const patch of [{ name: 'Changed' }, { size: 5 }, { folderId: null }, { fingerprint: 'other' }]) await assert.rejects(initUpload({ ...input, ...patch }), /different upload metadata/);
    assert.equal((await initUpload(input)).uploadId, 'upload');
    existing.status = 'aborted'; await assert.rejects(initUpload(input), /aborted/);
  });
});
