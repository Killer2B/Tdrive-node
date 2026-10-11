/** خدمة الملفّات: التصنيف، الإدخال للتخزين، البثّ، سلّة المهملات، والاستخدام. */
import { stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Files, FileChunks, type FileRow, type FileType, type FileSource } from '../db/repo.ts';
import { getStorage } from '../storage/index.ts';
import { sha256OfFile } from '../lib/hash.ts';
import { sanitizeFileName, splitExt } from '../lib/paths.ts';
import { loadConfig } from '../config/env.ts';
import { errors } from '../lib/errors.ts';
import { getLogger } from '../lib/logger.ts';
import { probeMedia, generateThumbnail, ffmpegAvailable } from './ffmpeg.ts';
import { newId } from '../lib/ids.ts';
import { splitFileIntoChunks, createRangeStream, deleteCacheChunks } from './chunkstore.ts';
import * as telegram from './telegram.ts';

const TYPE_BY_EXT: Record<string, FileType> = {};
const addTypes = (type: FileType, exts: string[]): void => {
  for (const e of exts) TYPE_BY_EXT[e] = type;
};
addTypes('video', ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'flv', 'wmv', 'ts', 'mpg', 'mpeg', '3gp']);
addTypes('design', ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'psd', 'ai', 'heic', 'avif']);
addTypes('code', ['js', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'json', 'html', 'css', 'sh', 'rb', 'php', 'yml', 'yaml']);
addTypes('doc', ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'rtf', 'odt']);
addTypes('archive', ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz']);

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime',
  avi: 'video/x-msvideo', m4v: 'video/x-m4v', ts: 'video/mp2t', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', heic: 'image/heic',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  json: 'application/json', csv: 'text/csv; charset=utf-8',
};

export function extOf(name: string): string {
  const { ext } = splitExt(name);
  return ext.replace(/^\./, '').toLowerCase();
}

export function classifyType(name: string): FileType {
  return TYPE_BY_EXT[extOf(name)] ?? 'bin';
}

export function mimeForName(name: string, fallback?: string | null): string {
  return MIME_BY_EXT[extOf(name)] ?? fallback ?? 'application/octet-stream';
}

/** أنواع يُسمح بعرضها inline في المتصفّح (الباقي يُنزَّل كمرفق). */
export function isInlineSafe(mime: string): boolean {
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return true;
  if (mime === 'application/pdf') return true;
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return true;
  return false;
}

/** يولّد اسمًا فريدًا داخل المجلّد بإلحاق (1)/(2) عند التصادم (إصلاح L7). */
export function uniqueName(userId: string, folderId: string | null, desired: string): string {
  const safe = sanitizeFileName(desired);
  if (!Files.findByFolderAndName(userId, folderId, safe)) return safe;
  const { stem, ext } = splitExt(safe);
  for (let i = 1; i < 10000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!Files.findByFolderAndName(userId, folderId, candidate)) return candidate;
  }
  return `${stem}-${newId()}${ext}`;
}

function storageKeyForUnused(): void {
  /* نمط التخزين الكامل القديم أُزيل لصالح نموذج القطع (Telegram + كاش). */
}
void storageKeyForUnused;

export interface IngestParams {
  userId: string;
  folderId: string | null;
  name: string;
  tempPath: string;
  source: FileSource;
  sourceUrl?: string;
  mime?: string;
  sha256?: string;
  computeSha?: boolean;
}

/**
 * ينقل ملفًّا مؤقّتًا على القرص إلى التخزين وينشئ صفّ ملف.
 * لا يقرأ الملف كاملًا في الذاكرة (putFile يستخدم rename/stream).
 */
export async function ingestLocalFile(params: IngestParams): Promise<FileRow> {
  const cfg = loadConfig();
  const log = getLogger();
  const storage = getStorage();

  const st = await stat(params.tempPath);
  if (cfg.upload.maxFileSize > 0 && st.size > cfg.upload.maxFileSize) {
    throw errors.payloadTooLarge('حجم الملف يتجاوز الحدّ الأقصى المسموح.');
  }

  const name = uniqueName(params.userId, params.folderId, params.name);
  const type = classifyType(name);
  const mime = mimeForName(name, params.mime);
  const fileId = newId('fil');
  const chunkSize = cfg.upload.chunkSize;
  const telegramBackend = cfg.content.backend === 'telegram';

  let sha = params.sha256 ?? null;
  if (!sha && params.computeSha) {
    sha = await sha256OfFile(params.tempPath);
  }

  // فحص الوسائط (المدّة/الأبعاد) قبل التقطيع
  let duration: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  if (type === 'video') {
    const info = await probeMedia(params.tempPath);
    duration = info.durationSec;
    width = info.width;
    height = info.height;
  }

  // صورة مصغّرة → تُحفظ في محوّل التخزين (ثابتة، صغيرة، غير مقطّعة)
  let thumbKey: string | null = null;
  if (type === 'video' && cfg.tools.thumbnailsEnabled && (await ffmpegAvailable())) {
    const thumbTmp = path.join(cfg.storage.tmpDir, `thumb-${fileId}.jpg`);
    const at = duration && duration > 2 ? Math.min(duration / 2, 5) : 1;
    try {
      if (await generateThumbnail(params.tempPath, thumbTmp, at)) {
        const tk = `thumbs/${fileId}.jpg`;
        await storage.putFile(tk, thumbTmp, { contentType: 'image/jpeg' });
        thumbKey = tk;
      }
    } catch (e) {
      log.debug({ err: String(e) }, 'فشل توليد الصورة المصغّرة');
    }
  }

  const row = Files.create({
    id: fileId,
    user_id: params.userId,
    folder_id: params.folderId,
    name,
    ext: extOf(name) || null,
    type,
    mime,
    size: st.size,
    storage_key: null,
    sha256: sha,
    status: telegramBackend ? 'processing' : 'ready',
    source: params.source,
    source_url: params.sourceUrl ?? null,
    thumb_key: thumbKey,
    duration: duration ?? null,
    width: width ?? null,
    height: height ?? null,
    backend: cfg.content.backend,
    chunk_size: chunkSize,
  });

  // تقطيع الملف إلى قطع في الكاش + تسجيل file_chunks، ثم حذف المؤقّت
  await splitFileIntoChunks(fileId, params.tempPath, st.size, chunkSize);
  await rm(params.tempPath, { force: true }).catch(() => {});

  log.info({ fileId, name, size: row.size, source: params.source, backend: cfg.content.backend }, 'أُدخل ملف جديد (مقطّع)');
  return row;
}

export interface OpenedStream {
  stream: Readable;
  size: number;
  contentType: string;
  isInline: boolean;
}

/** يفتح تدفّق قراءة لملف (كامل أو نطاق) عبر القطع (كاش أو Telegram). */
export async function openFileRange(
  file: FileRow,
  range?: { start: number; end: number },
): Promise<OpenedStream> {
  const mime = file.mime ?? mimeForName(file.name);
  const chunks = FileChunks.listByFile(file.id);

  if (chunks.length === 0) {
    // توافق مع ملفّات نمط الكائن الكامل القديم (إن وُجدت)
    if (file.storage_key) {
      const stream = await getStorage().createReadStream(file.storage_key, range);
      return { stream, size: file.size, contentType: mime, isInline: isInlineSafe(mime) };
    }
    throw errors.notFound('الملف غير جاهز للتنزيل بعد.');
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, file.size - 1);
  const stream = createRangeStream(file, chunks, start, end);
  return { stream, size: file.size, contentType: mime, isInline: isInlineSafe(mime) };
}

/** يفتح تدفّق الصورة المصغّرة أو null. */
export async function openThumbnail(file: FileRow): Promise<Readable | null> {
  if (!file.thumb_key) return null;
  try {
    return await getStorage().createReadStream(file.thumb_key);
  } catch {
    return null;
  }
}

export function trashFile(file: FileRow): void {
  Files.setTrashed(file.id, true);
}

export function restoreFile(file: FileRow): void {
  // تجنّب تصادم الاسم عند الاستعادة
  const name = uniqueName(file.user_id, file.folder_id, file.name);
  if (name !== file.name) Files.update(file.id, { name });
  Files.setTrashed(file.id, false);
}

export async function deleteFilePermanent(file: FileRow): Promise<void> {
  const storage = getStorage();
  const chunks = FileChunks.listByFile(file.id);
  await deleteCacheChunks(file.id, chunks);
  if (file.storage_key) await storage.delete(file.storage_key).catch(() => {});
  if (file.thumb_key) await storage.delete(file.thumb_key).catch(() => {});
  FileChunks.deleteByFile(file.id);
  Files.delete(file.id);

  // حذف رسائل Telegram في الخلفية (أفضل جهد؛ لا يُعطّل الاستجابة)
  if (file.backend === 'telegram') {
    const ids = chunks.map((c) => c.tg_message_id).filter((x): x is number => typeof x === 'number');
    if (ids.length > 0) {
      void (async () => {
        for (const id of ids) await telegram.deleteMessage(id).catch(() => {});
      })();
    }
  }
}

export interface StorageUsage {
  usedBytes: number;
}

export function storageUsage(userId: string): StorageUsage {
  return { usedBytes: Files.usedBytes(userId) };
}

/** يحوّل صفّ ملف إلى الشكل الذي تتوقّعه الواجهة. */
export function toApiFile(f: FileRow): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    extension: f.ext,
    mime: f.mime,
    size: f.size,
    sizeBytes: f.size,
    sha256: f.sha256,
    status: f.status,
    source: f.source,
    sourceUrl: f.source_url,
    folderId: f.folder_id,
    duration: f.duration,
    width: f.width,
    height: f.height,
    hasThumbnail: !!f.thumb_key,
    isStarred: !!f.starred,
    isPinned: !!f.pinned,
    isDeleted: !!f.trashed,
    modified: f.updated_at,
    created: f.created_at,
  };
}
