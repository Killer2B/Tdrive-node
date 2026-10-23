import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { buildServer } from '../../src/server.ts';
import { loadConfig, resetConfigCache } from '../../src/config/env.ts';
import { hashPassword } from '../../src/lib/password.ts';
import { invalidateCredentialCache } from '../../src/services/credentials.ts';
import { ApiKeys, Files, Folders, Sessions, Settings, Users, Activity, type ApiKeyRow, type FileListOptions, type FileRow, type FolderRow, type UserRow } from '../../src/db/repo.ts';
import { SESSION_COOKIE } from '../../src/plugins/auth.ts';
import { closePool, getPool, setExecutor } from '../../src/db/pg.ts';

test('drive routes authenticate, create folders/keys, and expose WebDAV collections', async (t) => {
  resetConfigCache();
  loadConfig({
    SESSION_SECRET: 'isolated-route-test-secret', DATABASE_URL: 'postgresql://unused/unused',
    CONTENT_BACKEND: 'local', NODE_ENV: 'production', LOG_LEVEL: 'silent', PUBLIC_URL: 'https://tdrive.cc.cd',
  });
  invalidateCredentialCache();
  const user: UserRow = {
    id: 'usr_test', username: 'route-test', password_hash: await hashPassword('route-password'),
    role: 'owner', created_at: Date.now(), updated_at: Date.now(),
  };
  const folders: FolderRow[] = [];
  const keys: ApiKeyRow[] = [];
  t.mock.method(Users, 'findByUsername', async (name: string) => name === user.username ? user : undefined);
  t.mock.method(Users, 'findById', async (id: string) => id === user.id ? user : undefined);
  t.mock.method(Sessions, 'find', async (id: string) => id === 'session-test' ? {
    id, user_id: user.id, created_at: Date.now(), expires_at: Date.now() + 60_000, user_agent: null, ip: null,
  } : undefined);
  t.mock.method(Folders, 'listChildren', async (id: string, parentId: string | null) => folders.filter((f) => f.user_id === id && f.parent_id === parentId));
  t.mock.method(Folders, 'findById', async (id: string) => folders.find((f) => f.id === id));
  t.mock.method(Folders, 'findByPath', async (id: string, path: string) => folders.find((f) => f.user_id === id && f.path === path));
  t.mock.method(Folders, 'findByParentName', async (id: string, parentId: string | null, name: string) => folders.find((f) => f.user_id === id && f.parent_id === parentId && f.name === name));
  t.mock.method(Folders, 'create', async (input: Omit<FolderRow, 'id' | 'created_at' | 'updated_at'>) => {
    const folder = { ...input, id: `fld_${folders.length}`, created_at: Date.now(), updated_at: Date.now() };
    folders.push(folder);
    return folder;
  });
  t.mock.method(Files, 'list', async () => []);
  t.mock.method(Files, 'usedBytes', async () => 0);
  t.mock.method(Files, 'findByFolderAndName', async () => undefined);
  t.mock.method(Settings, 'get', async () => null);
  t.mock.method(Activity, 'insert', async () => undefined);
  t.mock.method(ApiKeys, 'countActive', async () => keys.filter((k) => !k.revoked_at).length);
  t.mock.method(ApiKeys, 'create', async (input: { user_id: string; label: string; key_hash: string; key_prefix: string }) => {
    const row = { ...input, id: `key_${keys.length}`, created_at: Date.now(), last_used_at: null, revoked_at: null };
    keys.push(row);
    return row;
  });
  t.mock.method(ApiKeys, 'listByUser', async () => keys.map(({ key_hash: _hash, ...row }) => row));
  t.mock.method(ApiKeys, 'findActiveByHash', async (hash: string) => keys.find((k) => k.key_hash === hash && !k.revoked_at));
  t.mock.method(ApiKeys, 'touch', async () => undefined);
  t.mock.method(ApiKeys, 'revoke', async (id: string, keyId: string) => {
    const row = keys.find((k) => k.id === keyId && k.user_id === id && !k.revoked_at);
    if (!row) return false;
    row.revoked_at = Date.now();
    return true;
  });
  const app = await buildServer();
  t.after(async () => { await app.close(); invalidateCredentialCache(); resetConfigCache(); });
  await app.ready();
  const basic = { authorization: `Basic ${Buffer.from(`${user.username}:route-password`).toString('base64')}` };
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(app.signCookie('session-test'))}`;

  const shell = await app.inject({ method: 'GET', url: '/' });
  assert.equal(shell.statusCode, 200);
  if (shell.body.includes('/assets/')) assert.equal(shell.headers['cache-control'], 'no-cache');

  for (const url of ['/dav', '/dav/', '/']) {
    const options = await app.inject({ method: 'OPTIONS', url });
    assert.equal(options.statusCode, 204);
    assert.equal(options.headers.dav, '1, 2');
    assert.equal(options.headers['ms-author-via'], 'DAV');
    assert.ok(String(options.headers.allow).split(', ').includes('DELETE'));
  }
  const unauthorized = await app.inject({ method: 'PROPFIND', url: '/dav/', headers: { depth: '0' } });
  assert.equal(unauthorized.statusCode, 401);
  assert.match(String(unauthorized.headers['www-authenticate']), /^Basic /);
  for (const url of ['/dav', '/dav/']) {
    const get = await app.inject({ method: 'GET', url, headers: basic });
    assert.equal(get.statusCode, 200);
    assert.match(get.body, /Tdrive WebDAV/);
    const head = await app.inject({ method: 'HEAD', url, headers: basic });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, '');
  }
  const discovery = await app.inject({ method: 'PROPFIND', url: '/', headers: { ...basic, depth: '1' } });
  assert.equal(discovery.statusCode, 207);
  assert.match(discovery.body, /<d:href>\/<\/d:href>/);
  assert.match(discovery.body, /<d:href>\/dav\/<\/d:href>/);
  const create = await app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: 'Documents' } });
  assert.equal(create.statusCode, 200);
  const folderId = create.json().folder.id;
  const nested = await app.inject({ method: 'MKCOL', url: '/dav/Documents/Nested', headers: basic });
  assert.equal(nested.statusCode, 201);
  assert.equal(nested.headers.location, '/dav/Documents/Nested/');
  const children = await app.inject({ method: 'GET', url: `/api/folders?parentId=${folderId}`, headers: { cookie } });
  assert.deepEqual(children.json().folders.map((f: { name: string }) => f.name), ['Nested']);
  const propfind = await app.inject({ method: 'PROPFIND', url: '/dav/Documents/', headers: { ...basic, depth: '1' }, payload: '<?xml version="1.0"?><propfind xmlns="DAV:"><allprop/></propfind>' });
  assert.equal(propfind.statusCode, 207);
  assert.match(propfind.body, /\/dav\/Documents\/Nested\//);
  const missing = await app.inject({ method: 'GET', url: '/dav/missing', headers: basic });
  assert.equal(missing.statusCode, 404);
  assert.equal((await app.inject({ method: 'MKCOL', url: '/dav/Destination', headers: basic })).statusCode, 201);
  const deletedFolders: string[] = [];
  t.mock.method(Folders, 'delete', async (id: string) => { deletedFolders.push(id); });
  const statements: string[] = [];
  const transactionClient = {
    async query(sql: string) { statements.push(sql); return { rows: [], rowCount: 1 }; },
    release() {},
  } as unknown as PoolClient;
  t.mock.method(getPool(), 'connect', async () => transactionClient);
  t.after(closePool);
  const destinationFolder = folders.find((folder) => folder.path === '/Destination')!;
  const moved = await app.inject({
    method: 'MOVE', url: '/dav/Documents',
    headers: { ...basic, destination: '/dav/Destination', overwrite: 'T' },
  });
  assert.equal(moved.statusCode, 204, moved.body);
  assert.deepEqual(deletedFolders, [destinationFolder.id]);
  assert.ok(statements.some((sql) => sql.includes('SET parent_id')));
  assert.ok(statements.some((sql) => sql.includes('substr(path, $2::int + 1)')));

  const keyResult = await app.inject({ method: 'POST', url: '/api/account/api-keys', headers: { cookie }, payload: { label: 'Windows' } });
  assert.equal(keyResult.statusCode, 201);
  const { key, metadata } = keyResult.json();
  assert.match(key, /^tdk_[a-f0-9]{64}$/);
  assert.notEqual(keys[0].key_hash, key);
  const keyList = await app.inject({ method: 'GET', url: '/api/account/api-keys', headers: { cookie } });
  assert.ok(Array.isArray(keyList.json().keys));
  assert.equal(keyList.json().keys[0].label, 'Windows');
  assert.ok(!keyList.body.includes(key));
  const keyAuth = { authorization: `Basic ${Buffer.from(`Windows:${key}`).toString('base64')}` };
  assert.equal((await app.inject({ method: 'PROPFIND', url: '/dav/', headers: keyAuth })).statusCode, 207);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/account/api-keys/${metadata.id}`, headers: { cookie } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PROPFIND', url: '/dav/', headers: keyAuth })).statusCode, 401);
  const proxied = await app.inject({
    method: 'POST', url: '/api/account/api-keys',
    headers: { cookie, origin: 'https://tdrive.cc.cd', host: 'internal-host:24600' }, payload: { label: 'Proxied browser' },
  });
  assert.equal(proxied.statusCode, 201, proxied.body);
  const foreign = await app.inject({
    method: 'POST', url: '/api/account/api-keys',
    headers: { cookie, origin: 'https://untrusted.example', host: 'internal-host:24600' }, payload: { label: 'Must reject' },
  });
  assert.equal(foreign.statusCode, 403);
  const unknownMethod = await app.inject({ method: 'PROPFIND', url: '/not-a-share', headers: basic });
  assert.equal(unknownMethod.statusCode, 404);
  assert.match(unknownMethod.headers['content-type']!, /application\/json/);
});

test('WebDAV deletion trashes owned files and complete collections while respecting user-scoped locks', async (t) => {
  resetConfigCache();
  loadConfig({ SESSION_SECRET: 'isolated-delete-test-secret', DATABASE_URL: 'postgresql://unused/unused', CONTENT_BACKEND: 'local', NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  invalidateCredentialCache();
  const passwordHash = await hashPassword('delete-password');
  const users: UserRow[] = ['delete-owner', 'delete-member'].map((id, index) => ({
    id, username: id, password_hash: passwordHash, role: index === 0 ? 'owner' : 'user', created_at: 1, updated_at: 1,
  }));
  let folders: FolderRow[] = [];
  let files: FileRow[] = [];
  let failTrash = false;
  const file = (id: string, name: string, folderId: string | null = null, userId = users[0].id): FileRow => ({
    id, name, folder_id: folderId, user_id: userId, size: 0, ext: null, type: 'bin', mime: 'application/octet-stream',
    storage_key: null, sha256: null, status: 'ready', source: 'upload', source_url: null, thumb_key: null,
    duration: null, width: null, height: null, starred: 0, pinned: 0, trashed: 0, trashed_at: null,
    backend: 'local', chunk_size: null, thumb_tg_file_id: null, thumb_tg_message_id: null, created_at: 1, updated_at: 1,
  });
  t.mock.method(Users, 'findByUsername', async (name: string) => users.find((user) => user.username === name));
  t.mock.method(Users, 'findById', async (id: string) => users.find((user) => user.id === id));
  t.mock.method(Folders, 'findByPath', async (id: string, path: string) => folders.find((folder) => folder.user_id === id && folder.path === path));
  t.mock.method(Folders, 'findByParentName', async (id: string, parentId: string | null, name: string) => folders.find((folder) => folder.user_id === id && folder.parent_id === parentId && folder.name === name));
  t.mock.method(Folders, 'listChildren', async (id: string, parentId: string | null) => folders.filter((folder) => folder.user_id === id && folder.parent_id === parentId));
  t.mock.method(Folders, 'delete', async (id: string) => {
    const root = folders.find((folder) => folder.id === id)!;
    const removed = new Set(folders.filter((folder) => folder.user_id === root.user_id && (folder.path === root.path || folder.path.startsWith(`${root.path}/`))).map((folder) => folder.id));
    folders = folders.filter((folder) => !removed.has(folder.id));
    for (const item of files) if (item.folder_id && removed.has(item.folder_id)) item.folder_id = null;
  });
  t.mock.method(Files, 'findByFolderAndName', async (id: string, folderId: string | null, name: string) => files.find((item) => item.user_id === id && item.folder_id === folderId && item.name === name && !item.trashed));
  t.mock.method(Files, 'list', async (id: string, opts: FileListOptions = {}) => {
    const active = files.filter((item) => item.user_id === id && item.folder_id === opts.folderId && item.trashed === Number(!!opts.trashed));
    const offset = opts.offset ?? 0;
    return active.slice(offset, offset + Math.min(opts.limit ?? 500, 2000));
  });
  t.mock.method(Files, 'setTrashed', async (id: string, trashed: boolean) => {
    if (failTrash) throw new Error('Injected trash failure');
    Object.assign(files.find((item) => item.id === id)!, { trashed: Number(trashed), trashed_at: trashed ? Date.now() : null });
  });
  t.mock.method(Files, 'delete', async () => { assert.fail('WebDAV DELETE must not permanently delete files'); });
  const apiKey = `tdk_${'b'.repeat(64)}`;
  t.mock.method(ApiKeys, 'findActiveByHash', async (hash: string) => hash === createHash('sha256').update(apiKey).digest('hex') ? {
    id: 'delete-key', user_id: users[0].id, label: 'delete', key_hash: hash, key_prefix: 'tdk_', created_at: 1, last_used_at: null, revoked_at: null,
  } : undefined);
  t.mock.method(ApiKeys, 'touch', async () => undefined);
  const app = await buildServer();
  t.after(async () => { await app.close(); invalidateCredentialCache(); resetConfigCache(); });
  const basic = users.map((user) => ({ authorization: `Basic ${Buffer.from(`${user.username}:delete-password`).toString('base64')}` }));

  await t.test('Basic password and API key authentication permit file deletion', async () => {
    const credentials = [basic[0], { authorization: `Basic ${Buffer.from(`client:${apiKey}`).toString('base64')}` }, { authorization: `Bearer ${apiKey}` }, { 'x-api-key': apiKey }];
    for (const [index, headers] of credentials.entries()) {
      const item = file(`auth-${index}`, `Delete ${index}.txt`);
      files.push(item);
      const url = `/dav/${encodeURIComponent(item.name)}`;
      const response = await app.inject({ method: 'DELETE', url, headers });
      assert.equal(response.statusCode, 204, response.body);
      assert.equal(response.body, '');
      assert.equal(item.trashed, 1);
      assert.ok(item.trashed_at);
      assert.equal((await app.inject({ method: 'DELETE', url, headers })).statusCode, 404);
    }
  });
  await t.test('unauthenticated, foreign, missing, unsafe, and root deletion is rejected', async () => {
    const item = file('private-file', 'Private.txt', null, users[1].id);
    files.push(item);
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/Private.txt' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/Private.txt', headers: { authorization: `Bearer tdk_${'c'.repeat(64)}` } })).statusCode, 401);
    for (const url of ['/dav/Private.txt', '/dav/missing.txt']) {
      assert.equal((await app.inject({ method: 'DELETE', url, headers: basic[0] })).statusCode, 404);
    }
    for (const url of ['/dav', '/dav/']) {
      assert.equal((await app.inject({ method: 'DELETE', url, headers: basic[0] })).statusCode, 403);
    }
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/unsafe%2Fname', headers: basic[0] })).statusCode, 400);
    assert.equal(item.trashed, 0);
  });
  await t.test('recursive collection deletion includes every page and leaves other resources untouched', async () => {
    folders = [
      { id: 'delete-folder', user_id: users[0].id, parent_id: null, name: 'Large', path: '/Large', created_at: 1, updated_at: 1 },
      { id: 'delete-child', user_id: users[0].id, parent_id: 'delete-folder', name: 'Nested', path: '/Large/Nested', created_at: 1, updated_at: 1 },
      { id: 'other-folder', user_id: users[1].id, parent_id: null, name: 'Large', path: '/Large', created_at: 1, updated_at: 1 },
    ];
    const contents = Array.from({ length: 4001 }, (_, index) => file(`large-${index}`, `File ${index}`, 'delete-folder'));
    contents.push(...Array.from({ length: 2001 }, (_, index) => file(`nested-${index}`, `Nested ${index}`, 'delete-child')));
    const outside = file('outside', 'Outside.txt');
    const foreign = file('foreign', 'Foreign.txt', 'other-folder', users[1].id);
    const alreadyTrashed = { ...file('already-trashed', 'Trashed.txt', 'delete-folder'), trashed: 1, trashed_at: 42 };
    files = [...contents, outside, foreign, alreadyTrashed];
    const response = await app.inject({ method: 'DELETE', url: '/dav/Large/', headers: basic[0] });
    assert.equal(response.statusCode, 204, response.body);
    assert.ok(contents.every((item) => item.trashed === 1 && item.trashed_at !== null));
    assert.deepEqual(folders.map((folder) => folder.id), ['other-folder']);
    assert.equal(outside.trashed, 0);
    assert.equal(foreign.trashed, 0);
    assert.equal(alreadyTrashed.trashed_at, 42);
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/Large/', headers: basic[0] })).statusCode, 404);
  });
  await t.test('locks only block their user, require tokens, and survive failed deletion', async () => {
    files = [file('locked-owner', 'Locked.txt'), file('locked-member', 'Locked.txt', null, users[1].id)];
    const memberLock = await app.inject({ method: 'LOCK', url: '/dav/Locked.txt', headers: { ...basic[1], depth: '0' } });
    assert.equal(memberLock.statusCode, 200, memberLock.body);
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/Locked.txt', headers: basic[0] })).statusCode, 204);
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/Locked.txt', headers: basic[1] })).statusCode, 423);
    failTrash = true;
    const authorized = { ...basic[1], if: `(${memberLock.headers['lock-token']})` };
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/Locked.txt', headers: authorized })).statusCode, 500);
    failTrash = false;
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/Locked.txt', headers: basic[1] })).statusCode, 423);
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/Locked.txt', headers: authorized })).statusCode, 204);
    assert.ok(files.every((item) => item.trashed === 1));
    assert.equal((await app.inject({ method: 'UNLOCK', url: '/dav/Locked.txt', headers: { ...basic[1], 'lock-token': memberLock.headers['lock-token'] } })).statusCode, 409);
  });
  await t.test('collection deletion respects descendant and depth-infinity locks', async () => {
    folders = [{ id: 'locked-folder', user_id: users[0].id, parent_id: null, name: 'Locked', path: '/Locked', created_at: 1, updated_at: 1 }];
    files = [file('locked-child', 'Child.txt', 'locked-folder')];
    const childLock = await app.inject({ method: 'LOCK', url: '/dav/Locked/Child.txt', headers: { ...basic[0], depth: '0' } });
    assert.equal(childLock.statusCode, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/Locked/', headers: basic[0] })).statusCode, 423);
    assert.equal(files[0].trashed, 0);
    assert.equal(folders.length, 1);
    const response = await app.inject({ method: 'DELETE', url: '/dav/Locked/', headers: { ...basic[0], if: `(${childLock.headers['lock-token']})` } });
    assert.equal(response.statusCode, 204, response.body);
    assert.equal(files[0].trashed, 1);
    assert.equal(folders.length, 0);
    files.push(file('root-locked', 'Root-locked.txt'));
    const rootLock = await app.inject({ method: 'LOCK', url: '/dav/', headers: { ...basic[0], depth: 'infinity' } });
    assert.equal(rootLock.statusCode, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/Root-locked.txt', headers: basic[0] })).statusCode, 423);
    assert.equal((await app.inject({ method: 'DELETE', url: '/dav/Root-locked.txt', headers: { ...basic[0], 'lock-token': rootLock.headers['lock-token'] } })).statusCode, 204);
    assert.equal((await app.inject({ method: 'UNLOCK', url: '/dav/', headers: { ...basic[0], 'lock-token': rootLock.headers['lock-token'] } })).statusCode, 204);
  });
});

test('WebDAV keeps JSON, text, binary, and missing-content-type uploads as raw streams', async (t) => {
  resetConfigCache();
  loadConfig({ SESSION_SECRET: 'isolated-parser-test-secret', DATABASE_URL: 'postgresql://unused/unused', CONTENT_BACKEND: 'local', NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  invalidateCredentialCache();
  const user = { id: 'parser-user', username: 'parser-user', password_hash: await hashPassword('parser-password'), role: 'owner', created_at: 0, updated_at: 0 };
  t.mock.method(Users, 'findByUsername', async () => user);
  const app = await buildServer();
  t.after(async () => { await app.close(); invalidateCredentialCache(); resetConfigCache(); });
  // Intercept before file ingestion to isolate the DAV body parser from storage.
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'PUT' || !request.url.startsWith('/dav/')) return;
    assert.ok(request.body instanceof Readable);
    const chunks: Buffer[] = [];
    for await (const chunk of request.body) chunks.push(Buffer.from(chunk));
    return reply.send(Buffer.concat(chunks));
  });
  const payload = Buffer.from('{not-valid-json}\r\n\u0000');
  for (const contentType of ['application/json', 'text/plain; charset=utf-8', 'application/octet-stream', undefined]) {
    const headers: Record<string, string> = { authorization: `Basic ${Buffer.from('parser-user:parser-password').toString('base64')}` };
    if (contentType) headers['content-type'] = contentType;
    const response = await app.inject({ method: 'PUT', url: '/dav/raw.bin', headers, payload });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.rawPayload, payload);
  }
});

test('password change revokes other sessions but preserves the submitting session', async (t) => {
  resetConfigCache();
  loadConfig({ SESSION_SECRET: 'isolated-password-test-secret', DATABASE_URL: 'postgresql://unused/unused', CONTENT_BACKEND: 'local', NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  const user = { id: 'password-user', username: 'password-user', password_hash: await hashPassword('old-password'), role: 'owner', created_at: 0, updated_at: 0 };
  t.mock.method(Sessions, 'find', async (id: string) => ({ id, user_id: user.id, created_at: 0, expires_at: Date.now() + 60_000, user_agent: null, ip: null }));
  t.mock.method(Users, 'findById', async () => user);
  t.mock.method(Users, 'updatePassword', async () => undefined);
  t.mock.method(Activity, 'insert', async () => undefined);
  let deletion: { sql: string; params?: unknown[] } | undefined;
  setExecutor({ async query(sql, params) { deletion = { sql, params }; return { rows: [], rowCount: 1 }; } });
  const app = await buildServer();
  t.after(async () => { await app.close(); setExecutor(null); invalidateCredentialCache(); resetConfigCache(); });
  await app.ready();
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(app.signCookie('current-session'))}`;
  const response = await app.inject({ method: 'POST', url: '/api/account/password', headers: { cookie }, payload: { current: 'old-password', next: 'new-password' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(deletion!.sql, /AND id <> \$2/);
  assert.deepEqual(deletion!.params, [user.id, 'current-session']);
});
