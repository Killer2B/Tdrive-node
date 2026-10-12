/** تقديم ملف عبر HTTP مع دعم Range/206 وETag — مشترك بين المسارات المحميّة والعامّة. */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseRange } from '../lib/ranges.ts';
import { errors } from '../lib/errors.ts';
import type { FileRow } from '../db/repo.ts';
import { openFileRange, mimeForName, isInlineSafe } from '../services/files.ts';

function etagFor(file: FileRow): string {
  return `"${file.sha256 ?? `${file.id}-${file.size}-${file.updated_at}`}"`;
}

export async function serveFileRange(
  request: FastifyRequest,
  reply: FastifyReply,
  file: FileRow,
  opts: { attachment: boolean },
): Promise<unknown> {
  if (file.status !== 'ready' && file.status !== 'processing') throw errors.notFound('الملف غير جاهز بعد.');
  const mime = file.mime ?? mimeForName(file.name);
  const etag = etagFor(file);
  const inline = !opts.attachment && isInlineSafe(mime);
  const dispName = encodeURIComponent(file.name);

  reply
    .header('Content-Type', mime)
    .header('Accept-Ranges', 'bytes')
    .header('ETag', etag)
    .header('Cache-Control', 'private, max-age=3600')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${dispName}`);

  if (request.headers['if-none-match'] === etag) {
    return reply.code(304).send();
  }

  const r = parseRange(request.headers.range, file.size);
  if (r.type === 'unsatisfiable') {
    return reply.code(416).header('Content-Range', `bytes */${file.size}`).send();
  }
  if (r.type === 'ok') {
    const { start, end } = r.range;
    const { stream } = await openFileRange(file, { start, end });
    return reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${file.size}`)
      .header('Content-Length', end - start + 1)
      .send(stream);
  }
  const { stream } = await openFileRange(file);
  return reply.header('Content-Length', file.size).send(stream);
}
