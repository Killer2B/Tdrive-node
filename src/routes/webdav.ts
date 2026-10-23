import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Activity } from '../services/activity.ts';
import { authenticateCredentials } from '../services/credentials.ts';
import { createFolderAtPath, resolveFolderPath } from '../services/folders.ts';
import { deleteFilePermanent, ingestLocalFile, openFileRange, trashFile } from '../services/files.ts';
import { Files, Folders, Settings, type FileRow, type FolderRow, type UserRow } from '../db/repo.ts';
import { tb, withTransaction } from '../db/pg.ts';
import { errors, isAppError } from '../lib/errors.ts';
import { isSafeSegment, normalizeVirtualPath, sanitizeFileName } from '../lib/paths.ts';
import { loadConfig } from '../config/env.ts';
import { serveFileRange } from './_serve.ts';
import { enqueueFlush } from '../services/queue.ts';

interface DavResource {
  path: string;
  file?: FileRow;
  folder?: FolderRow;
}

function requestCredentials(request: FastifyRequest): { username?: string; secret: string } | null {
  const auth = request.headers.authorization;
  if (typeof auth === 'string') {
    const bearer = /^Bearer\s+(.+)$/i.exec(auth);
    if (bearer) return { secret: bearer[1].trim() };
    const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(auth);
    if (basic) {
      const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator >= 0) {
        return { username: decoded.slice(0, separator), secret: decoded.slice(separator + 1) };
      }
    }
  }
  const apiKey = request.headers['x-api-key'];
  return typeof apiKey === 'string' && apiKey.trim() ? { secret: apiKey.trim() } : null;
}

function requireDavUser(request: FastifyRequest): UserRow {
  if (!request.user) throw errors.unauthorized();
  return request.user;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) throw errors.badRequest('Repeated WebDAV request headers are not supported.');
  return value;
}

function decodeDavPath(request: FastifyRequest, value = new URL(request.url, 'http://localhost').pathname): string {
  if (value !== '/dav' && !value.startsWith('/dav/')) throw errors.badRequest('WebDAV paths must be under /dav.');
  const tail = value.slice('/dav'.length);
  const segments = tail.split('/').filter(Boolean).map((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw errors.badRequest('Malformed URL-encoded WebDAV path.');
    }
    if (!isSafeSegment(decoded)) throw errors.badRequest('Unsafe WebDAV path segment.');
    return decoded;
  });
  try {
    return normalizeVirtualPath(`/${segments.join('/')}`);
  } catch {
    throw errors.badRequest('Invalid WebDAV path.');
  }
}

function pathSegments(pathname: string): { parentPath: string; name: string } {
  if (pathname === '/') throw errors.badRequest('A file or collection name is required.');
  const parts = pathname.slice(1).split('/');
  const name = parts.pop()!;
  return { parentPath: parts.length ? `/${parts.join('/')}` : '/', name };
}

async function resolveResource(userId: string, pathname: string): Promise<DavResource> {
  if (pathname === '/') return { path: pathname };
  const { parentPath, name } = pathSegments(pathname);
  const parent = await resolveFolderPath(userId, parentPath);
  const folder = await Folders.findByParentName(userId, parent?.id ?? null, name);
  const file = await Files.findByFolderAndName(userId, parent?.id ?? null, name);
  if (folder) return { path: pathname, folder };
  if (file) return { path: pathname, file };
  throw errors.notFound('WebDAV resource not found.');
}

function href(pathname: string, collection: boolean): string {
  const encoded = pathname === '/' ? '' : pathname.slice(1).split('/').map(encodeURIComponent).join('/');
  return `/dav/${encoded}${collection ? (encoded ? '/' : '') : ''}`;
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[char]!);
}

function propResponse(
  pathname: string,
  file?: FileRow,
  folder?: FolderRow,
  quota?: { used: number; available: number },
): string {
  const isCollection = !file;
  const name = file?.name ?? folder?.name ?? 'Tdrive';
  const modified = new Date(file?.updated_at ?? folder?.updated_at ?? Date.now()).toUTCString();
  const etag = file ? etagOf(file) : `"${folder?.id ?? 'root'}"`;
  const quotaXml = quota
    ? `<d:quota-used-bytes>${quota.used}</d:quota-used-bytes><d:quota-available-bytes>${quota.available}</d:quota-available-bytes>`
    : '';
  return `<d:response><d:href>${xml(href(pathname, isCollection))}</d:href><d:propstat><d:prop>` +
    `<d:displayname>${xml(name)}</d:displayname><d:resourcetype>${isCollection ? '<d:collection/>' : ''}</d:resourcetype>` +
    `<d:getcontentlength>${file?.size ?? 0}</d:getcontentlength><d:getlastmodified>${xml(modified)}</d:getlastmodified>` +
    `<d:getetag>${xml(etag)}</d:getetag><d:getcontenttype>${xml(file?.mime ?? 'httpd/unix-directory')}</d:getcontenttype>` +
    `${quotaXml}` +
    `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

function davErrorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (isAppError(error)) {
    if (error.statusCode >= 500) request.log.error({ err: error, details: error.details }, error.code);
    reply.code(error.statusCode).send({ error: { code: error.code, message: error.userMessage } });
    return;
  }
  const status = error.statusCode ?? 500;
  if (status >= 500) request.log.error({ err: error }, 'Unhandled WebDAV error');
  reply.code(status).send({
    error: {
      code: error.code ?? 'Error',
      message: status >= 500 ? 'Unexpected server error.' : error.message,
    },
  });
}

function isReadableBody(body: unknown): body is Readable {
  return body instanceof Readable || (!!body && typeof body === 'object' && typeof (body as Readable).pipe === 'function');
}

function bodyStream(body: unknown): Readable {
  if (isReadableBody(body)) return body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) return Readable.from([body]);
  if (body === undefined || body === null) return Readable.from([]);
  throw errors.badRequest('Expected a raw WebDAV request body.');
}

// ===== أقفال WebDAV =====
// عملاء سطح المكتب (Windows/macOS/Office) تتطلّب LOCK/UNLOCK للمزامنة الكتابيّة.
// الأقفال في الذاكرة لأنّ التشغيل الموصى به نسخة واحدة على القاعدة.
interface DavLock {
  token: string;
  path: string;
  depth: '0' | 'infinity';
  expires: number;
  user: string;
}

const locks = new Map<string, DavLock>();
const LOCK_TTL_MS = 15 * 60_000;

function lockPath(pathname: string): string {
  return pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
}

function pruneLocks(): void {
  const now = Date.now();
  for (const [key, lock] of locks) if (lock.expires <= now) locks.delete(key);
}

function containsPath(parent: string, child: string): boolean {
  if (parent === '/') return true;
  return child === parent || child.startsWith(`${parent}/`);
}

function conflictingLocks(pathname: string): DavLock[] {
  pruneLocks();
  const target = lockPath(pathname);
  return [...locks.values()].filter((lock) =>
    lock.depth === 'infinity' ? containsPath(lock.path, target) : lock.path === target,
  );
}

function submittedLockTokens(request: FastifyRequest): string[] {
  const headers = [request.headers.if, request.headers['lock-token']].filter(
    (value): value is string => typeof value === 'string',
  );
  const tokens: string[] = [];
  for (const header of headers) {
    for (const match of header.matchAll(/<([^>]+)>/g)) tokens.push(match[1].replace(/^opaquelocktoken:/i, ''));
  }
  return tokens;
}

function lockedError(): Error {
  const error = new Error('The resource is locked by another client.') as Error & { statusCode: number; code: string };
  error.statusCode = 423;
  error.code = 'Locked';
  return error;
}

/** يرفض الكتابة على مسار مقفل ما لم يُقدَّم رمز القفل في If/Lock-Token. */
function assertUnlocked(request: FastifyRequest, pathname: string): void {
  const conflicts = conflictingLocks(pathname);
  if (conflicts.length === 0) return;
  const provided = submittedLockTokens(request);
  if (conflicts.some((lock) => !provided.includes(lock.token.replace(/^opaquelocktoken:/i, '')))) {
    throw lockedError();
  }
}

/** يحذف أقفال المسار وكل ما تحته (بعد DELETE/MOVE). */
function dropLocksUnder(pathname: string): void {
  const target = lockPath(pathname);
  for (const [key, lock] of locks) {
    if (lock.path === target || containsPath(target, lock.path)) locks.delete(key);
  }
}

function etagOf(file: FileRow): string {
  return `"${file.sha256 ?? `${file.id}-${file.size}-${file.updated_at}`}"`;
}

/** مطابقة If-Match مع ETag (يقبل القوائم وW/ و*). */
function etagMatches(header: string, etag: string): boolean {
  const expected = etag.replace(/^W\//, '').replace(/"/g, '');
  return header
    .split(',')
    .map((value) => value.trim().replace(/^W\//, '').replace(/"/g, ''))
    .some((value) => value === '*' || value === expected);
}

async function quotaFor(userId: string): Promise<{ used: number; available: number }> {
  const used = await Files.usedBytes(userId);
  const raw = await Settings.get(userId, 'workspace');
  const settings = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const quota =
    typeof settings.quotaBytes === 'number' && settings.quotaBytes > 0 ? settings.quotaBytes : 5_000_000_000_000;
  return { used, available: Math.max(0, quota - used) };
}

/** يجمع محتوى مجلّد Depth: infinity مع سقف آمن لتفادي استنزاف الذاكرة. */
async function collectTree(
  userId: string,
  rootPath: string,
  rootFolderId: string | null,
): Promise<Array<{ path: string; file?: FileRow; folder?: FolderRow }>> {
  const limit = 5000;
  const items: Array<{ path: string; file?: FileRow; folder?: FolderRow }> = [];
  const queue: Array<{ path: string; folderId: string | null }> = [{ path: rootPath, folderId: rootFolderId }];
  while (queue.length > 0 && items.length < limit) {
    const current = queue.shift()!;
    const base = current.path === '/' ? '' : current.path;
    for (const folder of await Folders.listChildren(userId, current.folderId)) {
      if (items.length >= limit) break;
      items.push({ path: folder.path || `${base}/${folder.name}`, folder });
      queue.push({ path: folder.path || `${base}/${folder.name}`, folderId: folder.id });
    }
    for (const file of await Files.list(userId, { folderId: current.folderId, limit: 10_000 })) {
      if (items.length >= limit) break;
      items.push({ path: `${base}/${file.name}`, file });
    }
  }
  return items;
}

async function writeUpload(
  user: UserRow,
  pathname: string,
  body: unknown,
  mime: string | undefined,
  overwrite: boolean,
): Promise<{ file: FileRow; replaced: boolean }> {
  const { parentPath, name } = pathSegments(pathname);
  const parent = await resolveFolderPath(user.id, parentPath);
  const safeName = sanitizeFileName(name);
  if (safeName !== name) throw errors.badRequest('The destination filename contains unsupported characters.');
  if (await Folders.findByParentName(user.id, parent?.id ?? null, name)) {
    throw errors.conflict('A collection already exists at this destination.');
  }
  const existing = await Files.findByFolderAndName(user.id, parent?.id ?? null, name);
  if (existing && !overwrite) throw errors.conflict('Destination exists and Overwrite is false.');
  const cfg = loadConfig();
  await mkdir(cfg.storage.tmpDir, { recursive: true });
  const tempDir = await mkdtemp(path.join(cfg.storage.tmpDir, 'webdav-'));
  const tempPath = path.join(tempDir, 'content');
  try {
    await pipeline(bodyStream(body), createWriteStream(tempPath, { flags: 'wx' }));
    const file = await ingestLocalFile({
      userId: user.id,
      folderId: parent?.id ?? null,
      name,
      tempPath,
      source: 'upload',
      mime,
      computeSha: true,
    });
    if (file.backend === 'telegram') await enqueueFlush(user.id, file.id, name);
    if (existing) {
      await Files.update(file.id, { name });
      await deleteFilePermanent(existing);
    }
    await Activity.record({
      userId: user.id,
      action: 'upload',
      targetType: 'file',
      targetId: file.id,
      targetName: name,
      ip: undefined,
      meta: { source: 'webdav', sizeBytes: file.size },
    });
    return { file: (await Files.findById(file.id)) ?? file, replaced: !!existing };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function deleteResource(userId: string, resource: DavResource, permanent: boolean): Promise<void> {
  dropLocksUnder(resource.path);
  if (resource.file) {
    if (permanent) await deleteFilePermanent(resource.file);
    else await trashFile(resource.file);
    return;
  }
  if (!resource.folder) return;
  const queue = [resource.folder];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    queue.push(...(await Folders.listChildren(userId, current.id)));
    for (const file of await Files.list(userId, { folderId: current.id, limit: 10_000 })) {
      if (permanent) await deleteFilePermanent(file);
      else await trashFile(file);
    }
  }
  await Folders.delete(resource.folder.id);
}

async function copyFile(
  user: UserRow,
  source: FileRow,
  destinationPath: string,
  overwrite: boolean,
): Promise<FileRow> {
  const stream = await openFileRange(source);
  const result = await writeUpload(user, destinationPath, stream.stream, source.mime ?? undefined, overwrite);
  return result.file;
}

function destinationPath(request: FastifyRequest, value: string | undefined): string {
  if (!value) throw errors.badRequest('The Destination header is required.');
  let dest: URL;
  try {
    dest = new URL(value, `${request.protocol}://${request.headers.host}`);
  } catch {
    throw errors.badRequest('The Destination header is invalid.');
  }
  const origin = new URL(`${request.protocol}://${request.headers.host}`).origin;
  if (dest.origin !== origin) throw errors.badRequest('Cross-origin WebDAV destinations are not allowed.');
  return decodeDavPath(request, dest.pathname);
}

function pathsOverlap(first: string, second: string): boolean {
  return first === second || first === '/' || second === '/'
    || first.startsWith(`${second}/`) || second.startsWith(`${first}/`);
}

async function renameOrMove(
  userId: string,
  source: DavResource,
  destination: string,
  overwrite: boolean,
): Promise<{ replaced: boolean }> {
  if (source.path === destination) return { replaced: false };
  if (source.folder && pathsOverlap(source.folder.path, destination)) {
    throw errors.badRequest('A folder cannot be moved inside itself.');
  }
  const target: DavResource | null = await (async () => {
    try {
      return await resolveResource(userId, destination);
    } catch (error) {
      if (isAppError(error) && error.statusCode === 404) return null;
      throw error;
    }
  })();
  if (target && !overwrite) throw errors.conflict('Destination exists and Overwrite is false.');
  if (target?.file && source.file && target.file.id === source.file.id) return { replaced: false };
  if (target) await deleteResource(userId, target, true);
  const { parentPath, name } = pathSegments(destination);
  const parent = await resolveFolderPath(userId, parentPath);
  const cleanName = sanitizeFileName(name);
  if (cleanName !== name) throw errors.badRequest('The destination name is invalid.');
  if (source.file) {
    await Files.update(source.file.id, { folder_id: parent?.id ?? null, name: cleanName });
    return { replaced: !!target };
  }
  if (!source.folder) throw errors.notFound('WebDAV resource not found.');
  const newPath = normalizeVirtualPath(`${parent?.path ?? ''}/${cleanName}`);
  const folder = source.folder;
  const prefix = `${folder.path}/`;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE ${tb('folders')} SET parent_id = $1, name = $2, path = $3, updated_at = $4 WHERE id = $5`,
      [parent?.id ?? null, cleanName, newPath, Date.now(), folder.id],
    );
    await client.query(
      `UPDATE ${tb('folders')} SET path = $1 || substr(path, $2::int + 1), updated_at = $3
       WHERE user_id = $4 AND starts_with(path, $5) AND path <> $5`,
      [newPath, folder.path.length, Date.now(), userId, prefix],
    );
  });
  return { replaced: !!target };
}

async function copyDirectory(user: UserRow, source: FolderRow, destination: string): Promise<void> {
  const created = await createFolderAtPath(user.id, pathSegments(destination).parentPath, pathSegments(destination).name);
  for (const file of await Files.list(user.id, { folderId: source.id, limit: 10_000 })) {
    await copyFile(user, file, `${created.path}/${file.name}`, false);
  }
  for (const child of await Folders.listChildren(user.id, source.id)) {
    await copyDirectory(user, child, `${created.path}/${child.name}`);
  }
}

export default async function webDavRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig();
  for (const method of ['PROPFIND', 'COPY', 'MOVE', 'PROPPATCH', 'SEARCH', 'LOCK'] as const) {
    app.addHttpMethod(method, { hasBody: true });
  }
  for (const method of ['MKCOL', 'UNLOCK'] as const) {
    app.addHttpMethod(method);
  }
  app.setErrorHandler(davErrorHandler);
  // DAV uploads are files, even when their media type is JSON or plain text.
  // Keep these parsers scoped here so the browser's JSON API is unaffected.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', (_request, payload, done) => {
    done(null, payload);
  });
  app.addHook('preHandler', async (request, reply) => {
    reply.header('DAV', '1, 2').header('MS-Author-Via', 'DAV');
    if (request.method === 'OPTIONS') return;
    const credentials = requestCredentials(request);
    const user = credentials ? await authenticateCredentials(credentials.username, credentials.secret) : null;
    if (!user) {
      // تأخير بسيط يحدّ من تخمين كلمات المرور عبر Basic
      await new Promise((resolve) => setTimeout(resolve, 250));
      reply.header('WWW-Authenticate', 'Basic realm="Tdrive WebDAV", charset="UTF-8"');
      throw errors.unauthorized('Authenticate WebDAV with your username and password, or a Tdrive API key.');
    }
    request.user = user;
  });

  const davAllow = 'OPTIONS, PROPFIND, PROPPATCH, MKCOL, GET, HEAD, PUT, DELETE, MOVE, COPY, LOCK, UNLOCK';
  const options = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.code(204).header('DAV', '1, 2').header('Allow', davAllow).send();

  const handlers: Partial<Record<HTTPMethods, (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>>> = {
    OPTIONS: options,
    PROPFIND: async (request, reply) => {
      const user = requireDavUser(request);
      const targetPath = decodeDavPath(request);
      const depth = (singleHeader(request.headers.depth) ?? '1').toLowerCase();
      if (depth !== '0' && depth !== '1' && depth !== 'infinity') {
        throw errors.badRequest('WebDAV Depth must be 0, 1, or infinity.');
      }
      const resource = await resolveResource(user.id, targetPath);
      const quota = await quotaFor(user.id);
      let responses = propResponse(targetPath, resource.file, resource.folder, quota);
      if (depth === '1' && !resource.file) {
        const folderId = resource.folder?.id ?? null;
        for (const folder of await Folders.listChildren(user.id, folderId)) {
          responses += propResponse(folder.path, undefined, folder, quota);
        }
        for (const file of await Files.list(user.id, { folderId, limit: 10_000 })) {
          responses += propResponse(`${targetPath === '/' ? '' : targetPath}/${file.name}`, file, undefined, quota);
        }
      } else if (depth === 'infinity' && !resource.file) {
        const tree = await collectTree(user.id, targetPath, resource.folder?.id ?? null);
        for (const item of tree) responses += propResponse(item.path, item.file, item.folder, quota);
      }
      return reply.code(207).type('application/xml; charset=utf-8').send(
        `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`,
      );
    },
    PROPPATCH: async (request, reply) => {
      const user = requireDavUser(request);
      const targetPath = decodeDavPath(request);
      assertUnlocked(request, targetPath);
      const resource = await resolveResource(user.id, targetPath);
      // لا نخزّن خصائص قابلة للكتابة (العملاء يطلبون displayname فقط)؛ نقرّ بالنجاح.
      return reply
        .code(207)
        .type('application/xml; charset=utf-8')
        .send(
          `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:"><d:response>` +
            `<d:href>${xml(href(targetPath, !resource.file))}</d:href>` +
            `<d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
        );
    },
    MKCOL: async (request, reply) => {
      const user = requireDavUser(request);
      const targetPath = decodeDavPath(request);
      assertUnlocked(request, targetPath);
      const { parentPath, name } = pathSegments(targetPath);
      const parent = await resolveFolderPath(user.id, parentPath);
      if (await Folders.findByParentName(user.id, parent?.id ?? null, name)) {
        return reply.code(405).header('Allow', davAllow).send();
      }
      if (await Files.findByFolderAndName(user.id, parent?.id ?? null, name)) {
        throw errors.conflict('A file already exists at this destination.');
      }
      const folder = await createFolderAtPath(user.id, parentPath, name);
      return reply.code(201).header('Location', href(folder.path, true)).send();
    },
    GET: async (request, reply) => {
      const user = requireDavUser(request);
      const resource = await resolveResource(user.id, decodeDavPath(request));
      if (!resource.file) {
        reply.type('text/html; charset=utf-8').header('Cache-Control', 'private, no-store');
        if (request.method === 'HEAD') return reply.code(200).send();
        const folderId = resource.folder?.id ?? null;
        const base = resource.path === '/' ? '' : resource.path;
        const folders = await Folders.listChildren(user.id, folderId);
        const files = await Files.list(user.id, { folderId, limit: 10_000 });
        const links = [
          ...folders.map((folder) => `<li><a href="${xml(href(folder.path, true))}">${xml(folder.name)}/</a></li>`),
          ...files.map((file) => `<li><a href="${xml(href(`${base}/${file.name}`, false))}">${xml(file.name)}</a></li>`),
        ];
        const parent = resource.path === '/' ? '' : `<p><a href="${xml(href(pathSegments(resource.path).parentPath, true))}">Parent directory</a></p>`;
        return reply.send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tdrive WebDAV</title><h1>${xml(resource.path)}</h1>${parent}<ul>${links.join('')}</ul></html>`);
      }
      return serveFileRange(request, reply, resource.file, { attachment: true });
    },
    PUT: async (request, reply) => {
      const user = requireDavUser(request);
      const targetPath = decodeDavPath(request);
      assertUnlocked(request, targetPath);
      const contentType = request.headers['content-type']?.split(';', 1)[0];
      const overwrite = singleHeader(request.headers.overwrite)?.toUpperCase() !== 'F';

      // شروط HTTP القياسيّة (If-Match/If-None-Match). ترويسة WebDAV `If` تخصّ الأقفال فقط.
      const ifNoneMatch = singleHeader(request.headers['if-none-match']);
      const ifMatch = singleHeader(request.headers['if-match']);
      if (ifNoneMatch || ifMatch) {
        let existing: DavResource | null = null;
        try {
          existing = await resolveResource(user.id, targetPath);
        } catch (error) {
          if (!(isAppError(error) && error.statusCode === 404)) throw error;
        }
        if (ifNoneMatch && existing && (ifNoneMatch === '*' || (existing.file && etagMatches(ifNoneMatch, etagOf(existing.file))))) {
          return reply.code(412).send();
        }
        if (ifMatch && (!existing?.file || !etagMatches(ifMatch, etagOf(existing.file)))) {
          return reply.code(412).send();
        }
      }

      const result = await writeUpload(user, targetPath, request.body, contentType, overwrite);
      return reply.code(result.replaced ? 204 : 201).header('ETag', etagOf(result.file)).send();
    },
    DELETE: async (request, reply) => {
      const user = requireDavUser(request);
      const resource = await resolveResource(user.id, decodeDavPath(request));
      if (!resource.file && !resource.folder) throw errors.forbidden('The WebDAV root cannot be deleted.');
      assertUnlocked(request, resource.path);
      await deleteResource(user.id, resource, false);
      return reply.code(204).send();
    },
    MOVE: async (request, reply) => {
      const user = requireDavUser(request);
      const source = await resolveResource(user.id, decodeDavPath(request));
      const dest = destinationPath(request, singleHeader(request.headers.destination));
      if (source.path === dest) return reply.code(204).send();
      if (source.folder && pathsOverlap(source.folder.path, dest)) {
        throw errors.badRequest('A folder cannot be moved to an overlapping path.');
      }
      assertUnlocked(request, source.path);
      assertUnlocked(request, dest);
      const overwrite = singleHeader(request.headers.overwrite)?.toUpperCase() !== 'F';
      const result = await renameOrMove(user.id, source, dest, overwrite);
      dropLocksUnder(source.path);
      return reply
        .code(result.replaced ? 204 : 201)
        .header('Location', href(dest, !!source.folder))
        .send();
    },
    COPY: async (request, reply) => {
      const user = requireDavUser(request);
      const source = await resolveResource(user.id, decodeDavPath(request));
      const dest = destinationPath(request, singleHeader(request.headers.destination));
      if (source.path === dest) return reply.code(204).send();
      if (source.folder && pathsOverlap(source.folder.path, dest)) {
        throw errors.badRequest('A folder cannot be copied to an overlapping path.');
      }
      assertUnlocked(request, dest);
      const overwrite = singleHeader(request.headers.overwrite)?.toUpperCase() !== 'F';
      const { parentPath } = pathSegments(dest);
      await resolveFolderPath(user.id, parentPath);
      const existing = await (async () => {
        try {
          return await resolveResource(user.id, dest);
        } catch (error) {
          if (isAppError(error) && error.statusCode === 404) return null;
          throw error;
        }
      })();
      if (existing && !overwrite) throw errors.conflict('Destination exists and Overwrite is false.');
      if (existing) await deleteResource(user.id, existing, true);
      if (source.file) await copyFile(user, source.file, dest, false);
      else if (source.folder) await copyDirectory(user, source.folder, dest);
      else throw errors.notFound('WebDAV resource not found.');
      return reply.code(existing ? 204 : 201).header('Location', href(dest, !!source.folder)).send();
    },
    LOCK: async (request, reply) => {
      const user = requireDavUser(request);
      const targetPath = decodeDavPath(request);
      // LOCK على مسار غير موجود (lock-null) مسموح: بعض العملاء يقفلون قبل PUT.
      let exists = true;
      try {
        await resolveResource(user.id, targetPath);
      } catch (error) {
        if (isAppError(error) && error.statusCode === 404) exists = false;
        else throw error;
      }
      const depth = (singleHeader(request.headers.depth) ?? 'infinity').toLowerCase() === '0' ? '0' : 'infinity';
      const conflicts = conflictingLocks(targetPath);
      const provided = submittedLockTokens(request);
      const held = conflicts.find((lock) => !provided.includes(lock.token.replace(/^opaquelocktoken:/i, '')));
      if (held) throw lockedError();
      const token = `opaquelocktoken:${randomUUID()}`;
      const expires = Date.now() + LOCK_TTL_MS;
      locks.set(token, { token, path: lockPath(targetPath), depth, expires, user: user.id });
      const timeout = Math.round(LOCK_TTL_MS / 1000);
      return reply
        .code(exists ? 200 : 201)
        .header('Lock-Token', `<${token}>`)
        .type('application/xml; charset=utf-8')
        .send(
          `<?xml version="1.0" encoding="utf-8"?><d:prop xmlns:d="DAV:"><d:lockdiscovery><d:activelock>` +
            `<d:locktype><d:write/></d:locktype><d:lockscope><d:exclusive/></d:lockscope>` +
            `<d:depth>${depth}</d:depth><d:timeout>Second-${timeout}</d:timeout>` +
            `<d:locktoken><d:href>${token}</d:href></d:locktoken>` +
            `</d:activelock></d:lockdiscovery></d:prop>`,
        );
    },
    UNLOCK: async (request, reply) => {
      const user = requireDavUser(request);
      const targetPath = decodeDavPath(request);
      const provided = submittedLockTokens(request);
      const match = [...locks.values()].find(
        (lock) => lock.path === lockPath(targetPath) && lock.user === user.id && provided.includes(lock.token.replace(/^opaquelocktoken:/i, '')),
      );
      if (!match) {
        throw errors.conflict('The lock token is missing or does not match this resource.');
      }
      locks.delete(match.token);
      return reply.code(204).send();
    },
  };

  // Windows WebClient probes the host root before opening the /dav share.
  // Expose discovery only here; keep GET / serving the normal web application.
  app.options('/', options);
  app.route({
    method: 'PROPFIND',
    url: '/',
    handler: async (request, reply) => {
      const depth = singleHeader(request.headers.depth) ?? '1';
      if (!['0', '1', 'infinity'].includes(depth.toLowerCase())) {
        throw errors.badRequest('WebDAV Depth must be 0, 1, or infinity.');
      }
      const root = propResponse('/').replace('<d:href>/dav/</d:href>', '<d:href>/</d:href>');
      const share = depth === '0' ? '' : propResponse('/');
      return reply.code(207).type('application/xml; charset=utf-8').send(
        `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${root}${share}</d:multistatus>`,
      );
    },
  });

  const methods = Object.keys(handlers) as HTTPMethods[];
  for (const url of ['/dav', '/dav/*']) {
    for (const method of methods) {
      app.route({
        method,
        url,
        bodyLimit:
          method === 'PUT' ? cfg.upload.maxFileSize || 2_147_483_647 : 2 * 1024 * 1024,
        config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
        handler: handlers[method]!,
      });
    }
    app.route({
      method: ['POST', 'SEARCH'],
      url,
      handler: async (_request, reply) => reply.code(405).header('Allow', davAllow).send(),
    });
  }
}
