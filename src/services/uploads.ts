/** خدمة الرفع المجزّأ القابل للاستئناف (init → part → complete/abort). */
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Uploads, Files, Folders, FileChunks, type UploadRow, type FileRow } from '../db/repo.ts';
import { planChunks, sizeOfChunk, toRanges, missingChunks } from '../lib/chunking.ts';
import { HashingPassThrough, fingerprintFromChunkHashes, hashesEqual } from '../lib/hash.ts';
import { loadConfig } from '../config/env.ts';
import { errors } from '../lib/errors.ts';
import { sanitizeFileName } from '../lib/paths.ts';
import { newId } from '../lib/ids.ts';
import { classifyType, mimeForName, extOf, uniqueName, toApiFile } from './files.ts';
import { cacheChunkFromPath } from './chunkstore.ts';
import { enqueueFlush } from './queue.ts';
import { getLogger } from '../lib/logger.ts';

const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

function partDir(uploadId: string): string {
  return path.join(loadConfig().storage.tmpDir, 'uploads', uploadId);
}
function partPath(uploadId: string, idx: number): string {
  return path.join(partDir(uploadId), `${idx}.part`);
}

export interface InitResult {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  received: Array<[number, number]>;
  completed: boolean;
  file?: Record<string, unknown>;
}

export async function initUpload(input: {
  userId: string;
  clientKey: string;
  folderId: string | null;
  name: string;
  mime?: string;
  size: number;
  fingerprint?: string;
}): Promise<InitResult> {
  const cfg = loadConfig();
  if (!Number.isSafeInteger(input.size) || input.size < 0) throw errors.badRequest('حجم الملف غير صالح.');
  if (cfg.upload.maxFileSize > 0 && input.size > cfg.upload.maxFileSize) {
    throw errors.payloadTooLarge('حجم الملف يتجاوز الحدّ الأقصى المسموح.');
  }

  if (input.folderId !== null) {
    const folder = await Folders.findById(input.folderId);
    if (!folder || folder.user_id !== input.userId) throw errors.notFound('Destination folder not found.');
  }
  const name = sanitizeFileName(input.name);
  const existing = await Uploads.findByClientKey(input.userId, input.clientKey);
  if (existing) {
    if (existing.user_id !== input.userId || existing.folder_id !== input.folderId || existing.name !== name || existing.size !== input.size || existing.fingerprint !== (input.fingerprint ?? null)) {
      throw errors.conflict('clientKey was already used for different upload metadata.');
    }
    if (existing.status === 'completed' && existing.file_id) {
      const file = await Files.findById(existing.file_id);
      if (file && file.user_id !== input.userId) throw errors.notFound('Uploaded file not found.');
      return {
        uploadId: existing.id,
        chunkSize: existing.chunk_size,
        totalChunks: existing.total_chunks,
        received: toRanges(await Uploads.receivedIndexes(existing.id)),
        completed: true,
        file: file ? toApiFile(file) : undefined,
      };
    }
    if (existing.status === 'pending') {
      return {
        uploadId: existing.id,
        chunkSize: existing.chunk_size,
        totalChunks: existing.total_chunks,
        received: toRanges(await Uploads.receivedIndexes(existing.id)),
        completed: false,
      };
    }
    throw errors.conflict('The previous upload was aborted; use a new clientKey.');
  }

  const chunkSize = cfg.upload.chunkSize;
  const plan = planChunks(input.size, chunkSize);
  const upload = await Uploads.create({
    user_id: input.userId,
    client_key: input.clientKey,
    folder_id: input.folderId,
    name,
    mime: input.mime ?? null,
    size: input.size,
    chunk_size: chunkSize,
    total_chunks: plan.totalChunks,
    fingerprint: input.fingerprint ?? null,
    ttlMs: UPLOAD_TTL_MS,
  });

  return {
    uploadId: upload.id,
    chunkSize,
    totalChunks: plan.totalChunks,
    received: [],
    completed: false,
  };
}

async function requireOwnedPending(userId: string, uploadId: string): Promise<UploadRow> {
  const upload = await Uploads.findById(uploadId);
  if (!upload || upload.user_id !== userId) throw errors.notFound('جلسة الرفع غير موجودة.');
  if (upload.status === 'aborted') throw errors.conflict('جلسة الرفع أُلغيت.');
  return upload;
}

export interface PartResult {
  idx: number;
  received: number;
  totalChunks: number;
  duplicate: boolean;
}

/** يستقبل جزءًا واحدًا، يحسب SHA-256 على الخادم (إصلاح L1)، ويتحقّق من الطول. */
export async function uploadPart(input: {
  userId: string;
  uploadId: string;
  idx: number;
  body: Readable;
  declaredSha?: string;
}): Promise<PartResult> {
  const upload = await requireOwnedPending(input.userId, input.uploadId);
  if (upload.status === 'completed') {
    return { idx: input.idx, received: upload.total_chunks, totalChunks: upload.total_chunks, duplicate: true };
  }
  const plan = planChunks(upload.size, upload.chunk_size);
  if (!Number.isInteger(input.idx) || input.idx < 0 || input.idx >= plan.totalChunks) {
    throw errors.badRequest('رقم الجزء خارج النطاق.');
  }
  const expected = sizeOfChunk(plan, input.idx);

  // تكرار: نفس البصمة المعلنة لجزء مخزَّن مسبقًا ⇒ تخطٍّ بلا إعادة كتابة
  const already = await Uploads.getChunk(upload.id, input.idx);

  await mkdir(partDir(upload.id), { recursive: true });
  const dest = partPath(upload.id, input.idx);
  const hasher = new HashingPassThrough();
  await pipeline(input.body, hasher, createWriteStream(dest));

  if (hasher.bytes !== expected) {
    await rm(dest, { force: true }).catch(() => {});
    throw errors.badRequest(`حجم الجزء ${input.idx} غير مطابق (المتوقّع ${expected}، المستلَم ${hasher.bytes}).`);
  }
  const sha = hasher.digestHex();

  // إصلاح L9: تصادم بصمة لنفس الفهرس ⇒ 409 (لا كتابة صامتة فوقه)
  if (input.declaredSha && !hashesEqual(sha, input.declaredSha)) {
    await rm(dest, { force: true }).catch(() => {});
    throw errors.conflict(`تعارض بصمة الجزء ${input.idx}: البايتات لا تطابق البصمة المعلنة.`);
  }
  if (already && !hashesEqual(already.sha256, sha)) {
    await rm(dest, { force: true }).catch(() => {});
    throw errors.conflict(`تعارض الجزء ${input.idx}: محتوى مختلف لنفس الفهرس.`);
  }

  await Uploads.addChunk(upload.id, input.idx, hasher.bytes, sha);
  await Uploads.touch(upload.id);
  const received = (await Uploads.receivedIndexes(upload.id)).length;
  return { idx: input.idx, received, totalChunks: plan.totalChunks, duplicate: !!already };
}

export interface StatusResult {
  uploadId: string;
  totalChunks: number;
  received: Array<[number, number]>;
  missing: number[];
  status: UploadRow['status'];
}

export async function uploadStatus(userId: string, uploadId: string): Promise<StatusResult> {
  const upload = await requireOwnedPending(userId, uploadId);
  const indexes = await Uploads.receivedIndexes(upload.id);
  return {
    uploadId: upload.id,
    totalChunks: upload.total_chunks,
    received: toRanges(indexes),
    missing: missingChunks(indexes, upload.total_chunks),
    status: upload.status,
  };
}

/** يُكمل الرفع: يتحقّق من اكتمال الأجزاء وسلامتها، ينقلها للكاش كقطع، وينشئ الملف. */
export async function completeUpload(input: {
  userId: string;
  uploadId: string;
}): Promise<{ file: Record<string, unknown>; fileRow: FileRow }> {
  const cfg = loadConfig();
  const log = getLogger();
  const upload = await requireOwnedPending(input.userId, input.uploadId);
  if (upload.status === 'completed' && upload.file_id) {
    const existing = await Files.findById(upload.file_id);
    if (existing) return { file: toApiFile(existing), fileRow: existing };
  }

  const chunks = await Uploads.chunkHashesOrdered(upload.id);
  if (chunks.length !== upload.total_chunks) {
    throw errors.badRequest(
      `الأجزاء غير مكتملة (${chunks.length}/${upload.total_chunks}). استأنف إرسال الأجزاء الناقصة.`,
    );
  }
  const plan = planChunks(upload.size, upload.chunk_size);
  for (const c of chunks) {
    if (c.size !== sizeOfChunk(plan, c.idx)) {
      throw errors.badRequest(`حجم الجزء ${c.idx} غير مطابق للخطّة.`);
    }
  }

  // تحقّق البصمة المعلنة (إن وُجدت) من بصمات الأجزاء المحسوبة على الخادم
  if (upload.fingerprint) {
    const fp = fingerprintFromChunkHashes(chunks.map((c) => c.sha256));
    if (!hashesEqual(fp, upload.fingerprint)) {
      throw errors.unprocessable('فشل تحقّق سلامة الملف (بصمة الأجزاء لا تطابق المعلنة).');
    }
  }

  const chunkSize = upload.chunk_size;
  const name = await uniqueName(upload.user_id, upload.folder_id, upload.name);
  const type = classifyType(name);
  const mime = mimeForName(name, upload.mime);
  const fileId = newId('fil');
  const telegramBackend = cfg.content.backend === 'telegram';
  const sha = upload.fingerprint ?? fingerprintFromChunkHashes(chunks.map((c) => c.sha256));

  const fileRow: FileRow = await Files.create({
    id: fileId,
    user_id: upload.user_id,
    folder_id: upload.folder_id,
    name,
    ext: extOf(name) || null,
    type,
    mime,
    size: upload.size,
    storage_key: null,
    sha256: sha,
    status: telegramBackend ? 'processing' : 'ready',
    source: 'upload',
    backend: cfg.content.backend,
    chunk_size: chunkSize,
  });

  // انقل ملفّات الأجزاء إلى قطع الكاش + سجّل file_chunks
  for (const c of chunks) {
    await cacheChunkFromPath(fileId, c.idx, partPath(upload.id, c.idx));
    await FileChunks.add({ file_id: fileId, idx: c.idx, size: c.size, sha256: c.sha256, cached: true });
  }

  await Uploads.setStatus(upload.id, 'completed', fileRow.id);
  await rm(partDir(upload.id), { recursive: true, force: true }).catch(() => {});
  if (telegramBackend) await enqueueFlush(upload.user_id, fileId, name);

  log.info({ uploadId: upload.id, fileId, backend: cfg.content.backend }, 'اكتمل الرفع (مقطّع)');
  return { file: toApiFile(fileRow), fileRow };
}

export async function abortUpload(userId: string, uploadId: string): Promise<void> {
  const upload = await Uploads.findById(uploadId);
  if (!upload || upload.user_id !== userId) return;
  await Uploads.setStatus(upload.id, 'aborted', null);
  await rm(partDir(upload.id), { recursive: true, force: true }).catch(() => {});
}

/** تنظيف جلسات الرفع المنتهية المهجورة (يستدعيه المجدوِل). */
export async function cleanupExpiredUploads(): Promise<number> {
  const expired = await Uploads.listExpiredPending();
  for (const u of expired) {
    await rm(partDir(u.id), { recursive: true, force: true }).catch(() => {});
    await Uploads.delete(u.id);
  }
  return expired.length;
}
