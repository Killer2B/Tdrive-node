import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Activity } from '../services/activity.ts';
import { authenticateApiKey } from '../services/api-keys.ts';
import { createFolderAtPath, resolveFolderPath } from '../services/folders.ts';
import { deleteFilePermanent, ingestLocalFile, openFileRange, trashFile } from '../services/files.ts';
import { Files, Folders, Users, type FileRow, type FolderRow, type UserRow } from '../db/repo.ts';
import { tb, withTransaction } from '../db/pg.ts';
import { errors, isAppError } from '../lib/errors.ts';
import { isSafeSegment, normalizeVirtualPath, sanitizeFileName } from '../lib/paths.ts';
import { loadConfig } from '../config/env.ts';
import { serveFileRange } from './_serve.ts';

interface DavResource {
  path: string;
  file?: FileRow;
  folder?: FolderRow;
}

function requestApiKey(request: FastifyRequest): string | undefined {
  const auth = request.headers.authorization;
  if (typeof auth === 'string') {
    const bearer = auth.match(/^Bearer\s+(.+)$/i);
    if (bearer) return bearer[1].trim();
    const basic = auth.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
    if (basic) {
      const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator >= 0) return decoded.slice(separator + 1).trim();
    }
  }
  const apiKey = request.headers['x-api-key'];
  return typeof apiKey === 'string' ? apiKey.trim() : undefined;
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

function propResponse(pathname: string, file?: FileRow, folder?: FolderRow): string {
  const isCollection = !file;
  const name = file?.name ?? folder?.name ?? 'Tdrive';
  const modified = new Date(file?.updated_at ?? folder?.updated_at ?? Date.now()).toUTCString();
  const etag = file ? `"${file.sha256 ?? `${file.id}-${file.size}-${file.updated_at}`}"` : `"${folder?.id ?? 'root'}"`;
  return `<d:response><d:href>${xml(href(pathname, isCollection))}</d:href><d:propstat><d:prop>` +
    `<d:displayname>${xml(name)}</d:displayname><d:resourcetype>${isCollection ? '<d:collection/>' : ''}</d:resourcetype>` +
    `<d:getcontentlength>${file?.size ?? 0}</d:getcontentlength><d:getlastmodified>${xml(modified)}</d:getlastmodified>` +
    `<d:getetag>${xml(etag)}</d:getetag><d:getcontenttype>${xml(file?.mime ?? 'httpd/unix-directory')}</d:getcontenttype>` +
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
    for (const file of await Files.list(userId, { folderId: current.id, limit: 2000 })) {
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
): Promise<void> {
  if (source.path === destination) return;
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
  if (target && target.file?.id === source.file?.id) return;
  if (target) await deleteResource(userId, target, true);
  const { parentPath, name } = pathSegments(destination);
  const parent = await resolveFolderPath(userId, parentPath);
  const cleanName = sanitizeFileName(name);
  if (cleanName !== name) throw errors.badRequest('The destination name is invalid.');
  if (source.file) {
    await Files.update(source.file.id, { folder_id: parent?.id ?? null, name: cleanName });
    return;
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
      `UPDATE ${tb('folders')} SET path = $1 || substr(path, $2 + 1), updated_at = $3
       WHERE user_id = $4 AND starts_with(path, $5) AND path <> $5`,
      [newPath, folder.path.length, Date.now(), userId, prefix],
    );
  });
}

async function copyDirectory(user: UserRow, source: FolderRow, destination: string): Promise<void> {
  const created = await createFolderAtPath(user.id, pathSegments(destination).parentPath, pathSegments(destination).name);
  for (const file of await Files.list(user.id, { folderId: source.id, limit: 2000 })) {
    await copyFile(user, file, `${created.path}/${file.name}`, false);
  }
  for (const child of await Folders.listChildren(user.id, source.id)) {
    await copyDirectory(user, child, `${created.path}/${child.name}`);
  }
}

export default async function webDavRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig();
  for (const method of ['PROPFIND', 'COPY', 'MOVE', 'PROPPATCH', 'SEARCH'] as const) {
    app.addHttpMethod(method, { hasBody: true });
  }
  for (const method of ['MKCOL', 'LOCK', 'UNLOCK'] as const) {
    app.addHttpMethod(method);
  }
  app.setErrorHandler(davErrorHandler);
  app.addContentTypeParser(/^((?!application\/json|text\/plain).)*$/i, (_request, payload, done) => {
    done(null, payload);
  });
  app.addHook('preHandler', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    const key = requestApiKey(request);
    const authenticated = key ? await authenticateApiKey(key) : null;
    const user = authenticated ? await Users.findById(authenticated.userId) : undefined;
    if (!user) {
      reply.header('WWW-Authenticate', 'Basic realm="Tdrive WebDAV", Bearer');
      throw errors.unauthorized('Authenticate WebDAV with a Tdrive API key.');
    }
    request.user = user;
  });

  const options = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.code(204).header('DAV', '1').header('Allow', 'OPTIONS, PROPFIND, MKCOL, GET, HEAD, PUT, DELETE, MOVE, COPY').send();

  const handlers: Partial<Record<HTTPMethods, (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>>> = {
    OPTIONS: options,
    PROPFIND: async (request, reply) => {
      const user = requireDavUser(request);
      const targetPath = decodeDavPath(request);
      const depth = request.headers.depth ?? '1';
      if (depth !== '0' && depth !== '1') throw errors.badRequest('WebDAV Depth must be 0 or 1.');
      const resource = await resolveResource(user.id, targetPath);
      let responses = propResponse(targetPath, resource.file, resource.folder);
      if (depth === '1' && !resource.file) {
        const folderId = resource.folder?.id ?? null;
        for (const folder of await Folders.listChildren(user.id, folderId)) {
          responses += propResponse(folder.path, undefined, folder);
        }
        for (const file of await Files.list(user.id, { folderId, limit: 2000 })) {
          responses += propResponse(`${targetPath === '/' ? '' : targetPath}/${file.name}`, file);
        }
      }
      return reply.code(207).type('application/xml; charset=utf-8').send(
        `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`,
      );
    },
    MKCOL: async (request, reply) => {
      const user = requireDavUser(request);
      const targetPath = decodeDavPath(request);
      const { parentPath, name } = pathSegments(targetPath);
      const parent = await resolveFolderPath(user.id, parentPath);
      if (await Files.findByFolderAndName(user.id, parent?.id ?? null, name)) {
        throw errors.conflict('A file already exists at this destination.');
      }
      const folder = await createFolderAtPath(user.id, parentPath, name);
      return reply.code(201).header('Location', href(folder.path, true)).send();
    },
    GET: async (request, reply) => {
      const user = requireDavUser(request);
      const resource = await resolveResource(user.id, decodeDavPath(request));
      if (resource.folder) return reply.code(405).header('Allow', 'OPTIONS, PROPFIND, MKCOL, GET, HEAD, DELETE, MOVE, COPY').send();
      if (!resource.file) throw errors.notFound('WebDAV resource not found.');
      return serveFileRange(request, reply, resource.file, { attachment: true });
    },
    PUT: async (request, reply) => {
      const user = requireDavUser(request);
      const targetPath = decodeDavPath(request);
      const contentType = request.headers['content-type']?.split(';', 1)[0];
      const overwrite = singleHeader(request.headers.overwrite)?.toUpperCase() !== 'F';
      const result = await writeUpload(user, targetPath, request.body, contentType, overwrite);
      return reply.code(result.replaced ? 204 : 201).header('ETag', `"${result.file.sha256 ?? result.file.id}"`).send();
    },
    DELETE: async (request, reply) => {
      const user = requireDavUser(request);
      const resource = await resolveResource(user.id, decodeDavPath(request));
      if (!resource.file && !resource.folder) throw errors.forbidden('The WebDAV root cannot be deleted.');
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
      const overwrite = singleHeader(request.headers.overwrite)?.toUpperCase() !== 'F';
      await renameOrMove(user.id, source, dest, overwrite);
      return reply.code(204).header('Location', href(dest, !!source.folder)).send();
    },
    COPY: async (request, reply) => {
      const user = requireDavUser(request);
      const source = await resolveResource(user.id, decodeDavPath(request));
      const dest = destinationPath(request, singleHeader(request.headers.destination));
      if (source.path === dest) return reply.code(204).send();
      if (source.folder && pathsOverlap(source.folder.path, dest)) {
        throw errors.badRequest('A folder cannot be copied to an overlapping path.');
      }
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
  };

  const methods = Object.keys(handlers) as HTTPMethods[];
  for (const url of ['/dav', '/dav/*']) {
    for (const method of methods) {
      app.route({ method, url, bodyLimit: cfg.upload.maxFileSize || 2_147_483_647, handler: handlers[method]! });
    }
    app.route({
      method: ['POST', 'PROPPATCH', 'LOCK', 'UNLOCK', 'SEARCH'],
      url,
      handler: async (_request, reply) =>
        reply.code(405).header('Allow', 'OPTIONS, PROPFIND, MKCOL, GET, HEAD, PUT, DELETE, MOVE, COPY').send(),
    });
  }
}
