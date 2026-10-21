import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'tdrive-api-test-'));
process.env.SESSION_SECRET = 'test-session-secret-with-enough-length';
process.env.NODE_ENV = 'test';
process.env.PUBLIC_URL = 'http://localhost:8080';
process.env.DB_PATH = path.join(dataDir, 'tdrive.sqlite');
process.env.LOCAL_STORAGE_DIR = path.join(dataDir, 'storage');
process.env.TMP_DIR = path.join(dataDir, 'tmp');
process.env.STORAGE_DRIVER = 'local';
process.env.CONTENT_BACKEND = 'local';
process.env.CHUNK_SIZE_MB = '1';

const { getDb, closeDb } = await import('../../src/db/db.ts');
const { runMigrations } = await import('../../src/db/migrate.ts');
const { Users } = await import('../../src/db/repo.ts');
const { buildServer } = await import('../../src/server.ts');
const { createApiKey, listApiKeys, revokeApiKey } = await import('../../src/services/api-keys.ts');

let app: Awaited<ReturnType<typeof buildServer>>;
let userId: string;
let apiKey: string;

before(async () => {
  runMigrations(getDb());
  userId = Users.create({ username: 'api-test', password_hash: 'not-used' }).id;
  apiKey = createApiKey(userId, 'integration test').key;
  app = await buildServer();
});

after(async () => {
  if (app) await app.close();
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

test('API keys are shown once, hashed at rest, and revocable', () => {
  assert.match(apiKey, /^tdk_[a-f0-9]{64}$/);
  const rows = listApiKeys(userId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'integration test');
  assert.equal(JSON.stringify(rows).includes(apiKey), false);
  assert.equal(JSON.stringify(rows).includes('key_hash'), false);

  revokeApiKey(userId, rows[0].id);
  assert.equal(listApiKeys(userId)[0].revokedAt !== null, true);
});

test('REST authentication, envelopes, docs, and CORS preflight work', async () => {
  const denied = await app.inject({ method: 'GET', url: '/api/v1/me' });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.json().ok, false);

  const created = createApiKey(userId, 'REST integration');
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { 'x-api-key': created.key },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(response.headers['x-request-id']);

  const preflight = await app.inject({ method: 'OPTIONS', url: '/api/v1' });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], '*');

  const docs = await app.inject({ method: 'GET', url: '/developers' });
  assert.equal(docs.statusCode, 200);
  assert.match(docs.body, /Tdrive Developer API/);
  const openapi = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
  assert.equal(openapi.statusCode, 200);
  assert.equal(openapi.json().openapi, '3.1.0');
});

test('REST one-shot upload streams, supports Range, and enforces view-only shares', async () => {
  const key = createApiKey(userId, 'REST file integration').key;
  const headers = { 'x-api-key': key, 'content-type': 'application/octet-stream' };
  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/v1/files?name=api.txt&path=/',
    headers,
    payload: 'rest api file',
  });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const result = uploaded.json().data.file as { id: string; size: number };
  assert.equal(result.size, 13);

  const ranged = await app.inject({
    method: 'GET',
    url: `/api/v1/files/${result.id}/content`,
    headers: { 'x-api-key': key, range: 'bytes=0-2' },
  });
  assert.equal(ranged.statusCode, 206);
  assert.equal(ranged.body, 'res');
  assert.equal(ranged.headers['content-range'], 'bytes 0-2/13');

  const share = await app.inject({
    method: 'POST',
    url: `/api/v1/files/${result.id}/shares`,
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    payload: { permission: 'view' },
  });
  assert.equal(share.statusCode, 201, share.body);
  const token = share.json().data.token as string;
  const deniedDownload = await app.inject({ method: 'GET', url: `/api/public/${token}/download` });
  assert.equal(deniedDownload.statusCode, 403);
});

test('WebDAV can upload, list, and download a file with an API key', async () => {
  const key = createApiKey(userId, 'WebDAV integration').key;
  const authorization = `Basic ${Buffer.from(`tdrive:${key}`).toString('base64')}`;
  const put = await app.inject({
    method: 'PUT',
    url: '/dav/readme.txt',
    headers: { authorization, 'content-type': 'application/octet-stream' },
    payload: 'webdav smoke test',
  });
  assert.equal(put.statusCode, 201, put.body);

  const propfind = await app.inject({
    method: 'PROPFIND',
    url: '/dav/',
    headers: { authorization, depth: '1' },
  });
  assert.equal(propfind.statusCode, 207, propfind.body);
  assert.match(propfind.body, /readme\.txt/);

  const downloaded = await app.inject({
    method: 'GET',
    url: '/dav/readme.txt',
    headers: { authorization },
  });
  assert.equal(downloaded.statusCode, 200);
  assert.equal(downloaded.body, 'webdav smoke test');

  const collection = await app.inject({
    method: 'MKCOL',
    url: '/dav/docs',
    headers: { authorization },
  });
  assert.equal(collection.statusCode, 201);

  for (const method of ['MOVE', 'COPY'] as const) {
    const unsafe = await app.inject({
      method,
      url: '/dav/docs',
      headers: { authorization, destination: 'http://localhost:80/dav/docs/child' },
    });
    assert.equal(unsafe.statusCode, 400, unsafe.body);
  }

  const moved = await app.inject({
    method: 'MOVE',
    url: '/dav/readme.txt',
    headers: { authorization, destination: 'http://localhost:80/dav/docs/readme.txt' },
  });
  assert.equal(moved.statusCode, 204, moved.body);

  const copied = await app.inject({
    method: 'COPY',
    url: '/dav/docs/readme.txt',
    headers: { authorization, destination: 'http://localhost:80/dav/docs/copy.txt' },
  });
  assert.equal(copied.statusCode, 201, copied.body);
});
