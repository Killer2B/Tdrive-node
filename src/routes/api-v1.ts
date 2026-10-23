import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Activity } from '../services/activity.ts';
import { authenticateCredentials } from '../services/credentials.ts';
import { completeUpload, initUpload, uploadPart, uploadStatus, abortUpload } from '../services/uploads.ts';
import { deleteFilePermanent, restoreFile, storageUsage, trashFile } from '../services/files.ts';
import { createFolderAtPath, folderPath, resolveFolderPath } from '../services/folders.ts';
import { FileChunks, Files, Folders, Shares, Uploads, type FileRow, type UserRow } from '../db/repo.ts';
import { errors, isAppError } from '../lib/errors.ts';
import { normalizeVirtualPath } from '../lib/paths.ts';
import { randomBase64Url } from '../lib/ids.ts';
import { parse } from '../lib/validate.ts';
import { hashPassword } from '../lib/password.ts';
import { loadConfig } from '../config/env.ts';
import { serveFileRange } from './_serve.ts';
import { driveOperations, driveQuery, folderDetails, listDrive, operationBody, updateDriveItem } from '../services/drive.ts';
import { documentedPaths, drivePaths, driveSchemas } from '../services/drive-openapi.ts';

const API_ROOT = '/api/v1';
const MAX_KEYS = 500;
const API_DOC_PATH = fileURLToPath(new URL('../../DEVELOPER_API.md', import.meta.url));

function apiOk(data: unknown): { ok: true; data: unknown } {
  return { ok: true, data };
}

function apiError(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  return reply.code(status).send({ ok: false, error: { code, message } });
}

function apiPath(input: string): string {
  try {
    return normalizeVirtualPath(input);
  } catch (error) {
    if (error instanceof Error) throw errors.badRequest('مسار الملف أو المجلّد غير صالح.');
    throw error;
  }
}

function requestCredentials(request: FastifyRequest): { username?: string; secret: string } | null {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
    if (bearer) return { secret: bearer[1].trim() };
    // دعم Basic أيضًا: عملاء كثر لا يعرفون Bearer/X-API-Key
    const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(authorization);
    if (basic) {
      const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator >= 0) {
        return { username: decoded.slice(0, separator), secret: decoded.slice(separator + 1) };
      }
    }
  }
  const key = request.headers['x-api-key'];
  return typeof key === 'string' && key.trim() ? { secret: key.trim() } : null;
}

function requireApiUser(request: FastifyRequest): UserRow {
  if (!request.user) throw errors.unauthorized();
  return request.user;
}

async function apiFile(file: FileRow): Promise<Record<string, unknown>> {
  const chunks = await FileChunks.listByFile(file.id);
  return {
    id: file.id,
    name: file.name,
    path: await folderPath(file.user_id, file.folder_id),
    size: file.size,
    content_type: file.mime ?? 'application/octet-stream',
    created_at: new Date(file.created_at).toISOString(),
    updated_at: new Date(file.updated_at).toISOString(),
    cached: chunks.length > 0 && chunks.every((chunk) => chunk.cached === 1) ? 1 : 0,
    favorite: file.starred,
    checksum: file.sha256,
    status: file.status,
  };
}

/** يحوّل قائمة ملفّات إلى تمثيل الـ API بالتوازي. */
async function mapFiles(files: FileRow[]): Promise<Array<Record<string, unknown>>> {
  return Promise.all(files.map((file) => apiFile(file)));
}

async function ownFile(userId: string, id: string): Promise<FileRow> {
  const file = await Files.findById(id);
  if (!file || file.user_id !== userId) throw errors.notFound('الملف غير موجود.');
  return file;
}

function sortOptions(sort: string): { sort: 'name' | 'size' | 'modified' | 'created'; order: 'asc' | 'desc' } {
  switch (sort) {
    case 'oldest': return { sort: 'created', order: 'asc' };
    case 'name': return { sort: 'name', order: 'asc' };
    case 'name_desc': return { sort: 'name', order: 'desc' };
    case 'largest': return { sort: 'size', order: 'desc' };
    case 'smallest': return { sort: 'size', order: 'asc' };
    default: return { sort: 'modified', order: 'desc' };
  }
}

function offsetLimit(query: Record<string, unknown>): { offset: number; limit: number } {
  const parsed = parse(
    z.object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    }),
    query,
  );
  return { limit: parsed.limit ?? 100, offset: parsed.offset ?? 0 };
}

function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (isAppError(error)) {
    if (error.statusCode >= 500) request.log.error({ err: error, details: error.details }, error.code);
    else request.log.warn({ code: error.code }, error.userMessage);
    apiError(reply, error.statusCode, error.code, error.userMessage);
    return;
  }
  const status = error.statusCode ?? 500;
  if (status >= 500) request.log.error({ err: error }, 'Unhandled API v1 error');
  else request.log.warn({ err: error.message }, 'Rejected API v1 request');
  apiError(reply, status, error.code ?? 'Error', status >= 500 ? 'Unexpected server error.' : error.message);
}

export default async function apiV1Routes(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig();
  app.setErrorHandler(errorHandler);
  app.addHook('onRequest', async (_request, reply) => {
    reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS')
      .header('Access-Control-Allow-Headers', 'authorization,content-type,x-api-key,x-filename,x-content-sha256,idempotency-key,if-none-match,range')
      .header('Access-Control-Expose-Headers', 'content-range,accept-ranges,etag,content-disposition,retry-after,x-request-id')
      .header('Access-Control-Max-Age', '86400')
      .header('Cache-Control', 'no-store');
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-Id', request.id);
    return payload;
  });
  app.addHook('preHandler', async (request) => {
    if (
      request.method === 'GET' &&
      ['/developers', '/developers.md', `${API_ROOT}/openapi.json`].includes(request.url.split('?')[0])
    ) return;
    if (request.method === 'OPTIONS') return;
    const creds = requestCredentials(request);
    const user = creds ? await authenticateCredentials(creds.username, creds.secret) : null;
    if (!user) throw errors.unauthorized('Provide a valid API key or account credentials (Basic) / Bearer / X-API-Key.');
    request.user = user;
  });

  const options = async (_request: FastifyRequest, reply: FastifyReply) => reply.code(204).send();
  app.options(API_ROOT, options);
  app.options(`${API_ROOT}/*`, options);

  app.get('/developers', async (_request, reply) => reply.type('text/html; charset=utf-8').send(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>Tdrive Developer API</title><body style="font:16px system-ui;max-width:900px;margin:3rem auto;padding:0 1rem;line-height:1.6">' +
    '<h1>Tdrive Developer API · v1</h1><p>REST API for files, folders, resumable uploads, chunk manifests, trash, and shares.</p>' +
    '<h2>Authentication</h2><p>Create or revoke keys under Account → API keys. Send <code>Authorization: Bearer tdk_…</code> or <code>X-API-Key: tdk_…</code>.</p>' +
    '<h2>Response format</h2><p>JSON success: <code>{"ok":true,"data":…}</code>. JSON errors: <code>{"ok":false,"error":{"code":"…","message":"…"}}</code>. Content downloads are streamed bytes and support HTTP Range.</p>' +
    '<h2>Endpoints</h2><ul><li><code>GET /api/v1/me</code></li><li><code>GET/POST /api/v1/files</code></li>' +
    '<li><code>GET/PATCH/DELETE /api/v1/files/:id</code></li><li><code>GET /api/v1/files/:id/content</code></li>' +
    '<li><code>GET /api/v1/files/:id/chunks</code> · <code>POST /api/v1/files/:id/delta</code></li>' +
    '<li><code>GET/POST/PATCH/DELETE /api/v1/folders</code></li><li><code>POST /api/v1/uploads</code> · <code>PUT /api/v1/uploads/:id/parts/:idx</code> · <code>POST /api/v1/uploads/:id/complete</code></li>' +
    '<li><code>POST /api/v1/chunks/lookup</code></li><li><code>GET /api/v1/shares</code> · <code>POST /api/v1/files/:id/shares</code> · <code>DELETE /api/v1/shares/:token</code></li>' +
    '<li><code>GET /api/v1/recent</code> · <code>/favorites</code> · <code>/search?q=…</code> · <code>/trash</code></li>' +
    '</ul><p>WebDAV is available at <code>/dav/</code> with the same API keys. See the <a href="/developers.md">full reference</a> or <a href="/api/v1/openapi.json">OpenAPI document</a>.</p>' +
    '<p><strong>Not implemented:</strong> archived file versions, content revisions, and content-defined chunking.</p></body></html>',
  ));
  app.get('/developers.md', async (_request, reply) =>
    reply.type('text/markdown; charset=utf-8').send(await readFile(API_DOC_PATH, 'utf8')),
  );

  app.get(API_ROOT, async () => apiOk({
    name: 'Tdrive Developer API',
    version: 'v1',
    docs: '/developers',
    openapi: `${API_ROOT}/openapi.json`,
    capabilities: {
      resumableUploads: true,
      chunkManifests: true,
      deltaSync: true,
      shares: true,
      contentVersions: false,
      contentDefinedChunking: false,
      paginatedDrive: true,
      batchOperations: true,
      folderCopy: true,
      folderTrashRestore: false,
      nativeGoogleDrive: false,
      nativeOneDrive: false,
    },
    chunkSize: cfg.upload.chunkSize,
    maxUploadBytes: cfg.upload.maxFileSize || null,
  }));

  app.get(`${API_ROOT}/openapi.json`, async (_request, reply) => reply.type('application/vnd.oai.openapi+json;version=3.1').send({
    openapi: '3.1.0',
    info: { title: 'Tdrive Developer API', version: '1.0.0', description: 'REST API authenticated with a per-user API key.' },
    servers: [{ url: cfg.publicUrl }],
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }, { BasicAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        BearerAuth: { type: 'http', scheme: 'bearer' },
        BasicAuth: { type: 'http', scheme: 'basic', description: 'Account username/password, or any username with an API key as the password. HTTPS only.' },
      },
      schemas: driveSchemas,
    },
    paths: documentedPaths({
      ...drivePaths,
      [`${API_ROOT}`]: { get: { summary: 'API capabilities' } },
      [`${API_ROOT}/me`]: { get: { summary: 'Account profile and storage use' } },
      [`${API_ROOT}/files`]: { get: { summary: 'List files and folders by virtual path' }, post: { summary: 'Create a one-chunk upload' } },
      [`${API_ROOT}/files/{id}`]: { get: { summary: 'File metadata' }, patch: { summary: 'Update file metadata' }, delete: { summary: 'Trash or permanently delete a file' } },
      [`${API_ROOT}/files/{id}/content`]: { get: { summary: 'Download content with HTTP Range support' }, head: { summary: 'Read content headers' } },
      [`${API_ROOT}/files/{id}/chunks`]: { get: { summary: 'Get the chunk manifest' } },
      [`${API_ROOT}/files/{id}/delta`]: { post: { summary: 'Compare local chunk checksums' } },
      [`${API_ROOT}/folders`]: { get: { summary: 'List folders' }, post: { summary: 'Create a folder' }, patch: { summary: 'Rename a folder' }, delete: { summary: 'Trash folder contents and remove the folder' } },
      [`${API_ROOT}/uploads`]: { post: { summary: 'Start a resumable upload' } },
      [`${API_ROOT}/uploads/{id}/parts/{index}`]: { put: { summary: 'Upload a chunk' } },
      [`${API_ROOT}/uploads/{id}`]: { get: { summary: 'Check upload status' }, delete: { summary: 'Abort an upload' } },
      [`${API_ROOT}/uploads/{id}/complete`]: { post: { summary: 'Finalize an upload' } },
      [`${API_ROOT}/chunks/lookup`]: { post: { summary: 'Find stored chunk checksums' } },
      [`${API_ROOT}/shares`]: { get: { summary: 'List shares' } },
    }),
  }));

  app.get(`${API_ROOT}/drive`, async (request) => apiOk(await listDrive(requireApiUser(request).id, parse(driveQuery, request.query))));
  app.post(`${API_ROOT}/operations`, async (request) => apiOk(await driveOperations(requireApiUser(request).id, parse(operationBody, request.body))));
  app.get(`${API_ROOT}/folders/:id`, async (request) => apiOk(await folderDetails(requireApiUser(request).id, (request.params as { id: string }).id)));

  app.get(`${API_ROOT}/me`, async (request) => {
    const user = requireApiUser(request);
    return apiOk({ id: user.id, username: user.username, role: user.role, storage: await storageUsage(user.id) });
  });

  app.get(`${API_ROOT}/files`, async (request) => {
    const user = requireApiUser(request);
    const query = request.query as Record<string, unknown>;
    const params = parse(
      z.object({
        path: z.string().max(1024).default('/'),
        sort: z.enum(['newest', 'oldest', 'name', 'name_desc', 'largest', 'smallest']).default('newest'),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      query,
    );
    const path = apiPath(params.path ?? '/');
    const parent = await resolveFolderPath(user.id, path);
    const children = (await Folders.listChildren(user.id, parent?.id ?? null)).map((folder) => folder.name);
    const requestedSort = params.sort ?? 'newest';
    const sort = sortOptions(requestedSort);
    const rows = await Files.list(user.id, {
      folderId: parent?.id ?? null,
      sort: sort.sort,
      order: sort.order,
      limit: (params.limit ?? 100) + 1,
      offset: params.offset ?? 0,
    });
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const more = rows.length > limit;
    const files = rows.slice(0, limit);
    return apiOk({
      path,
      sort: requestedSort,
      folders: children,
      files: await mapFiles(files),
      nextOffset: more ? offset + limit : null,
    });
  });

  app.post(`${API_ROOT}/files`, {
    bodyLimit: cfg.upload.chunkSize + 1024,
    config: { rateLimit: { max: 100, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = requireApiUser(request);
    const query = request.query as Record<string, unknown>;
    const params = parse(
      z.object({
        name: z.string().min(1).max(512).optional(),
        path: z.string().max(1024).default('/'),
        contentType: z.string().max(256).optional(),
      }),
      query,
    );
    const nameHeader = request.headers['x-filename'];
    const name = params.name ?? (typeof nameHeader === 'string' ? nameHeader : undefined);
    if (!name) throw errors.badRequest('Provide a file name using the name query or X-Filename header.');
    const length = Number(request.headers['content-length']);
    if (!Number.isSafeInteger(length) || length < 0) throw errors.badRequest('A valid Content-Length header is required.');
    if (length > cfg.upload.chunkSize) throw errors.payloadTooLarge('One-shot uploads are limited to one configured chunk.');
    const folder = await resolveFolderPath(user.id, apiPath(params.path ?? '/'));
    const idempotency = request.headers['idempotency-key'];
    const clientKey = typeof idempotency === 'string' && idempotency.length >= 8
      ? `api:${idempotency.slice(0, 120)}`
      : `api:${randomBase64Url(24)}`;
    const previous = await Uploads.findByClientKey(user.id, clientKey);
    if (previous && (previous.name !== name || previous.size !== length || previous.folder_id !== (folder?.id ?? null))) {
      throw errors.conflict('Idempotency-Key was already used for a different upload.');
    }
    const started = await initUpload({
      userId: user.id,
      clientKey,
      folderId: folder?.id ?? null,
      name,
      mime: params.contentType ?? (typeof request.headers['content-type'] === 'string' ? request.headers['content-type'] : undefined),
      size: length,
    });
    if (started.completed && started.file) {
      const existing = await Files.findById(String(started.file.id));
      return reply.code(200).send(apiOk({ file: existing ? await apiFile(existing) : started.file }));
    }
    if (length > 0) {
      const body = request.body as Readable | undefined;
      if (!body || typeof body.pipe !== 'function') throw errors.badRequest('Expected a raw request body.');
      await uploadPart({
        userId: user.id,
        uploadId: started.uploadId,
        idx: 0,
        body,
        declaredSha: typeof request.headers['x-content-sha256'] === 'string'
          ? request.headers['x-content-sha256']
          : undefined,
      });
    }
    const result = await completeUpload({ userId: user.id, uploadId: started.uploadId });
    const file = await Files.findById(result.fileRow.id);
    await Activity.record({
      userId: user.id,
      action: 'upload',
      targetType: 'file',
      targetId: result.fileRow.id,
      targetName: result.fileRow.name,
      ip: request.ip,
      meta: { sizeBytes: result.fileRow.size },
    });
    return reply.code(201).send(apiOk({ file: file ? await apiFile(file) : result.file }));
  });

  app.get(`${API_ROOT}/files/:id`, async (request) => {
    const user = requireApiUser(request);
    const file = await ownFile(user.id, (request.params as { id: string }).id);
    return apiOk({ file: await apiFile(file) });
  });

  app.get(`${API_ROOT}/files/:id/chunks`, async (request) => {
    const user = requireApiUser(request);
    const file = await ownFile(user.id, (request.params as { id: string }).id);
    const chunks = await FileChunks.listByFile(file.id);
    let offset = 0;
    const manifest = chunks.map((chunk) => {
      const part = { idx: chunk.idx, offset, size: chunk.size, checksum: chunk.sha256 };
      offset += chunk.size;
      return part;
    });
    return apiOk({ fileId: file.id, version: file.updated_at, etag: `"${file.sha256 ?? `${file.id}-${file.size}-${file.updated_at}`}"`, chunks: manifest });
  });

  app.post(`${API_ROOT}/files/:id/delta`, async (request) => {
    const user = requireApiUser(request);
    const file = await ownFile(user.id, (request.params as { id: string }).id);
    const body = parse(z.object({ checksums: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).max(100_000) }), request.body);
    const chunks = await FileChunks.listByFile(file.id);
    const changed = chunks.filter((chunk) => body.checksums[chunk.idx]?.toLowerCase() !== chunk.sha256?.toLowerCase());
    const changedIndexes = changed.map((chunk) => chunk.idx);
    const ranges: Array<[number, number]> = [];
    for (const idx of changedIndexes) {
      const last = ranges[ranges.length - 1];
      if (last && idx === last[1] + 1) last[1] = idx;
      else ranges.push([idx, idx]);
    }
    return apiOk({
      version: file.updated_at,
      unchanged: chunks.length - changed.length,
      changed: changedIndexes,
      changedRanges: ranges,
    });
  });

  app.get(`${API_ROOT}/files/:id/content`, async (request, reply) => {
    const user = requireApiUser(request);
    const file = await ownFile(user.id, (request.params as { id: string }).id);
    return serveFileRange(request, reply, file, {
      attachment: (request.query as { download?: string }).download === '1',
    });
  });

  app.patch(`${API_ROOT}/files/:id`, async (request) => {
    const user = requireApiUser(request);
    const file = await ownFile(user.id, (request.params as { id: string }).id);
    const body = parse(
      z.object({
        name: z.string().min(1).max(200).optional(),
        path: z.string().max(1024).optional(),
        favorite: z.boolean().optional(),
      }).strict(),
      request.body,
    );
    const folder = body.path === undefined ? null : await resolveFolderPath(user.id, apiPath(body.path));
    const patch: Partial<FileRow> = {};
    if (body.favorite !== undefined) patch.starred = body.favorite ? 1 : 0;
    if (body.name === undefined && body.path === undefined && body.favorite === undefined) throw errors.badRequest('No supported metadata fields were provided.');
    if (body.name !== undefined || body.path !== undefined) await updateDriveItem(user.id, { type: 'file', id: file.id }, { name: body.name, destinationId: body.path === undefined ? undefined : folder?.id ?? null });
    await Files.update(file.id, patch);
    return apiOk({ file: await apiFile((await Files.findById(file.id))!) });
  });

  app.delete(`${API_ROOT}/files/:id`, async (request, reply) => {
    const user = requireApiUser(request);
    const file = await ownFile(user.id, (request.params as { id: string }).id);
    const permanent = (request.query as { permanent?: string }).permanent === '1';
    if (permanent) {
      await deleteFilePermanent(file);
      return reply.code(202).send(apiOk({ id: file.id, deleted: 'permanent', queued: false }));
    }
    await trashFile(file);
    return apiOk({ id: file.id, deleted: 'trash' });
  });

  app.get(`${API_ROOT}/folders`, async (request) => {
    const user = requireApiUser(request);
    const query = parse(z.object({ path: z.string().max(1024).default('/') }), request.query);
    const parent = await resolveFolderPath(user.id, apiPath(query.path ?? '/'));
    const folders = await Folders.listChildren(user.id, parent?.id ?? null);
    const folderPathValue = apiPath(query.path ?? '/');
    return apiOk({ path: folderPathValue, folders: folders.map((folder) => ({ id: folder.id, name: folder.name, path: folder.path, created_at: new Date(folder.created_at).toISOString() })) });
  });

  app.post(`${API_ROOT}/folders`, async (request, reply) => {
    const user = requireApiUser(request);
    const body = parse(z.object({ name: z.string().min(1).max(200), path: z.string().max(1024).default('/') }), request.body);
    const folder = await createFolderAtPath(user.id, apiPath(body.path ?? '/'), body.name);
    return reply.code(201).send(apiOk({ folder: { id: folder.id, name: folder.name, path: folder.path } }));
  });

  app.patch(`${API_ROOT}/folders`, async (request) => {
    const user = requireApiUser(request);
    const body = parse(
      z.object({ path: z.string().max(1024).default('/'), name: z.string().min(1).max(200), newName: z.string().min(1).max(200) }),
      request.body,
    );
    const parent = await resolveFolderPath(user.id, apiPath(body.path ?? '/'));
    const folder = await Folders.findByParentName(user.id, parent?.id ?? null, body.name);
    if (!folder) throw errors.notFound('المجلّد غير موجود.');
    return apiOk({ folder: await updateDriveItem(user.id, { type: 'folder', id: folder.id }, { name: body.newName }) });
  });

  app.delete(`${API_ROOT}/folders`, async (request) => {
    const user = requireApiUser(request);
    const query = parse(z.object({ path: z.string().max(1024).default('/'), name: z.string().min(1).max(200) }), request.query);
    const parent = await resolveFolderPath(user.id, apiPath(query.path ?? '/'));
    const folder = await Folders.findByParentName(user.id, parent?.id ?? null, query.name);
    if (!folder) throw errors.notFound('المجلّد غير موجود.');
    const descendants = await Folders.listChildren(user.id, folder.id);
    const pending = [...descendants, folder];
    for (let index = 0; index < pending.length; index++) {
      pending.push(...(await Folders.listChildren(user.id, pending[index].id)));
    }
    for (const child of pending) {
      for (const file of await Files.list(user.id, { folderId: child.id })) await trashFile(file);
    }
    await Folders.delete(folder.id);
    return apiOk({ deleted: 'trash' });
  });

  app.post(`${API_ROOT}/uploads`, async (request, reply) => {
    const user = requireApiUser(request);
    const body = parse(
      z.object({
        name: z.string().min(1).max(512),
        path: z.string().max(1024).default('/'),
        size: z.number().int().nonnegative(),
        contentType: z.string().max(256).optional(),
        fingerprint: z.string().max(128).optional(),
        clientKey: z.string().min(8).max(128).optional(),
      }),
      request.body,
    );
    const folder = await resolveFolderPath(user.id, apiPath(body.path ?? '/'));
    const result = await initUpload({
      userId: user.id,
      clientKey: body.clientKey ?? randomBase64Url(24),
      folderId: folder?.id ?? null,
      name: body.name,
      mime: body.contentType,
      size: body.size,
      fingerprint: body.fingerprint,
    });
    return reply.code(result.completed ? 200 : 201).send(apiOk(result));
  });

  app.put(`${API_ROOT}/uploads/:id/parts/:idx`, {
    bodyLimit: cfg.upload.maxPartBody + 1024,
    config: { rateLimit: { max: 100_000, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = requireApiUser(request);
    const { id, idx } = request.params as { id: string; idx: string };
    const body = request.body as Readable | undefined;
    if (!body || typeof body.pipe !== 'function') throw errors.badRequest('Expected a raw request body.');
    const declaredSha = request.headers['x-content-sha256'];
    const result = await uploadPart({
      userId: user.id,
      uploadId: id,
      idx: Number(idx),
      body,
      declaredSha: typeof declaredSha === 'string' ? declaredSha : undefined,
    });
    return apiOk(result);
  });

  app.get(`${API_ROOT}/uploads/:id`, async (request) => {
    const user = requireApiUser(request);
    const { id } = request.params as { id: string };
    const status = await uploadStatus(user.id, id);
    return apiOk({
      uploadId: status.uploadId,
      status: status.status,
      totalChunks: status.totalChunks,
      received: status.received,
      missing: status.missing,
      uncertain: [],
      inProgress: [],
    });
  });

  app.post(`${API_ROOT}/uploads/:id/complete`, async (request) => {
    const user = requireApiUser(request);
    const result = await completeUpload({ userId: user.id, uploadId: (request.params as { id: string }).id });
    const file = await Files.findById(result.fileRow.id);
    return apiOk({ file: file ? await apiFile(file) : result.file });
  });

  app.delete(`${API_ROOT}/uploads/:id`, async (request) => {
    const user = requireApiUser(request);
    await abortUpload(user.id, (request.params as { id: string }).id);
    return apiOk({});
  });

  app.post(`${API_ROOT}/chunks/lookup`, async (request) => {
    const user = requireApiUser(request);
    const body = parse(z.object({ checksums: z.array(z.string().regex(/^[a-f0-9]{64}$/i)).max(MAX_KEYS) }), request.body);
    const found = await FileChunks.lookupHashes(user.id, body.checksums.map((hash) => hash.toLowerCase()));
    const existing = new Set(found);
    return apiOk({ existing: [...existing], missing: body.checksums.filter((hash) => !existing.has(hash.toLowerCase())) });
  });

  app.get(`${API_ROOT}/recent`, async (request) => {
    const user = requireApiUser(request);
    const { limit, offset } = offsetLimit(request.query as Record<string, unknown>);
    const rows = await Files.recent(user.id, limit + 1, offset);
    const files = rows.slice(0, limit);
    return apiOk({ files: await mapFiles(files), nextOffset: rows.length > limit ? offset + limit : null });
  });

  app.get(`${API_ROOT}/favorites`, async (request) => {
    const user = requireApiUser(request);
    const { limit, offset } = offsetLimit(request.query as Record<string, unknown>);
    const rows = await Files.starred(user.id, limit + 1, offset);
    const files = rows.slice(0, limit);
    return apiOk({ files: await mapFiles(files), nextOffset: rows.length > limit ? offset + limit : null });
  });

  app.get(`${API_ROOT}/search`, async (request) => {
    const user = requireApiUser(request);
    const params = parse(z.object({ q: z.string().min(1).max(256), limit: z.coerce.number().int().min(1).max(500).default(100) }), request.query);
    return apiOk({ files: await mapFiles(await Files.search(user.id, params.q, params.limit)) });
  });

  app.get(`${API_ROOT}/trash`, async (request) => {
    const user = requireApiUser(request);
    return apiOk({ files: await mapFiles(await Files.trashList(user.id)) });
  });

  app.post(`${API_ROOT}/trash/:id/restore`, async (request) => {
    const user = requireApiUser(request);
    const file = await ownFile(user.id, (request.params as { id: string }).id);
    await restoreFile(file);
    return apiOk({ file: await apiFile((await Files.findById(file.id))!) });
  });

  app.post(`${API_ROOT}/trash/empty`, async (request) => {
    const user = requireApiUser(request);
    const items = await Files.trashList(user.id);
    let freedBytes = 0;
    for (const file of items) {
      await deleteFilePermanent(file);
      freedBytes += file.size;
    }
    return apiOk({ removed: items.length, freedBytes });
  });

  app.post(`${API_ROOT}/files/:id/shares`, async (request, reply) => {
    const user = requireApiUser(request);
    const file = await ownFile(user.id, (request.params as { id: string }).id);
    const body = parse(
      z.object({
        permission: z.enum(['view', 'download']).optional(),
        expiresInHours: z.number().int().positive().max(24 * 3650).optional(),
        maxDownloads: z.number().int().positive().max(1_000_000).optional(),
        password: z.string().max(256).optional(),
      }),
      request.body,
    );
    const share = await Shares.create({
      user_id: user.id,
      file_id: file.id,
      folder_id: null,
      token: randomBase64Url(18),
      password_hash: body.password ? await hashPassword(body.password) : null,
      expires_at: body.expiresInHours ? Date.now() + body.expiresInHours * 3_600_000 : null,
      max_downloads: body.maxDownloads ?? null,
      permission: body.permission ?? 'download',
    });
    return reply.code(201).send(apiOk({
      token: share.token,
      url: `${cfg.publicUrl}/s/${share.token}`,
      permission: body.permission ?? 'download',
      protected: !!share.password_hash,
    }));
  });

  app.get(`${API_ROOT}/shares`, async (request) => {
    const user = requireApiUser(request);
    const { limit, offset } = offsetLimit(request.query as Record<string, unknown>);
    const rows = (await Shares.listByUser(user.id)).slice(offset, offset + limit + 1);
    const more = rows.length > limit;
    const shares = await Promise.all(
      rows.slice(0, limit).map(async (share) => {
        const file = share.file_id ? await Files.findById(share.file_id) : undefined;
        return {
          token: share.token,
          file_id: share.file_id,
          expires_at: share.expires_at ? new Date(share.expires_at).toISOString() : null,
          max_downloads: share.max_downloads,
          download_count: share.download_count,
          view_count: share.views_count,
          created_at: new Date(share.created_at).toISOString(),
          disabled: !!share.revoked,
          protected: !!share.password_hash,
          permission: share.permission,
          name: file?.name ?? null,
          size: file?.size ?? null,
          content_type: file?.mime ?? null,
        };
      }),
    );
    return apiOk({ shares, nextOffset: more ? offset + limit : null });
  });

  app.get(`${API_ROOT}/files/:id/shares`, async (request) => {
    const user = requireApiUser(request);
    const file = await ownFile(user.id, (request.params as { id: string }).id);
    const shares = await Shares.listByFile(user.id, file.id);
    return apiOk({
      shares: shares.map((share) => ({
        token: share.token,
        file_id: share.file_id,
        expires_at: share.expires_at ? new Date(share.expires_at).toISOString() : null,
        max_downloads: share.max_downloads,
        download_count: share.download_count,
        view_count: share.views_count,
        created_at: new Date(share.created_at).toISOString(),
        disabled: !!share.revoked,
        protected: !!share.password_hash,
      })),
    });
  });

  app.delete(`${API_ROOT}/shares/:token`, async (request) => {
    const user = requireApiUser(request);
    const share = await Shares.findByToken((request.params as { token: string }).token);
    if (!share || share.user_id !== user.id) throw errors.notFound('المشاركة غير موجودة.');
    await Shares.revoke(share.id);
    return apiOk({});
  });
}
