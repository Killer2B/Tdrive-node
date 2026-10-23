import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { PoolClient } from 'pg';
import { buildServer } from '../../src/server.ts';
import { loadConfig, resetConfigCache } from '../../src/config/env.ts';
import { hashPassword } from '../../src/lib/password.ts';
import { invalidateCredentialCache } from '../../src/services/credentials.ts';
import { ApiKeys, Files, Folders, Sessions, Settings, Users, Activity, type ApiKeyRow, type FolderRow, type UserRow } from '../../src/db/repo.ts';
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
