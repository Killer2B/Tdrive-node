/** خدمة الرفع المجزّأ القابل للاستئناف (init → part → complete/abort). */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Uploads, Files, type UploadRow, type FileRow } from '../db/repo.ts';
import { planChunks, sizeOfChunk, toRanges, missingChunks } from '../lib/chunking.ts';
import { HashingPassThrough, fingerprintFromChunkHashes, hashesEqual } from '../lib/hash.ts';
import { loadConfig } from '../config/env.ts';
import { errors } from '../lib/errors.ts';
import { sanitizeFileName } from '../lib/paths.ts';
import { ingestLocalFile, toApiFile } from './files.ts';
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

export function initUpload(input: {
  userId: string;
  clientKey: string;
  folderId: string | null;
  name: string;
  size: number;
  fingerprint?: string;
}): InitResult {
  const cfg = loadConfig();
  if (!Number.isInteger(input.size) || input.size < 0) throw errors.badRequest('حجم الملف غير صالح.');
  if (cfg.upload.maxFileSize > 0 && input.size > cfg.upload.maxFileSize) {
    throw errors.payloadTooLarge('حجم الملف يتجاوز الحدّ الأقصى المسموح.');
  }

  const existing = Uploads.findByClientKey(input.userId, input.clientKey);
  if (existing) {
    if (existing.status === 'completed' && existing.file_id) {
      const file = Files.findById(existing.file_id);
      return {
        uploadId: existing.id,
        chunkSize: existing.chunk_size,
        totalChunks: existing.total_chunks,
        received: toRanges(Uploads.receivedIndexes(existing.id)),
        completed: true,
        file: file ? toApiFile(file) : undefined,
      };
    }
    if (existing.status === 'pending') {
      return {
        uploadId: existing.id,
        chunkSize: existing.chunk_size,
        totalChunks: existing.total_chunks,
        received: toRanges(Uploads.receivedIndexes(existing.id)),
        completed: false,
      };
    }
  }

  const chunkSize = cfg.upload.chunkSize;
  const plan = planChunks(input.size, chunkSize);
  const upload = Uploads.create({
    user_id: input.userId,
    client_key: input.clientKey,
    folder_id: input.folderId,
    name: sanitizeFileName(input.name),
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

function requireOwnedPending(userId: string, uploadId: string): UploadRow {
  const upload = Uploads.findById(uploadId);
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
  const upload = requireOwnedPending(input.userId, input.uploadId);
  if (upload.status === 'completed') {
    return { idx: input.idx, received: upload.total_chunks, totalChunks: upload.total_chunks, duplicate: true };
  }
  const plan = planChunks(upload.size, upload.chunk_size);
  if (!Number.isInteger(input.idx) || input.idx < 0 || input.idx >= plan.totalChunks) {
    throw errors.badRequest('رقم الجزء خارج النطاق.');
  }
  const expected = sizeOfChunk(plan, input.idx);

  // تكرار: نفس البصمة المعلنة لجزء مخزَّن مسبقًا ⇒ تخطٍّ بلا إعادة كتابة
  const already = Uploads.getChunk(upload.id, input.idx);

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

  Uploads.addChunk(upload.id, input.idx, hasher.bytes, sha);
  Uploads.touch(upload.id);
  const received = Uploads.receivedIndexes(upload.id).length;
  return { idx: input.idx, received, totalChunks: plan.totalChunks, duplicate: !!already };
}

export interface StatusResult {
  uploadId: string;
  totalChunks: number;
  received: Array<[number, number]>;
  missing: number[];
  status: UploadRow['status'];
}

export function uploadStatus(userId: string, uploadId: string): StatusResult {
  const upload = requireOwnedPending(userId, uploadId);
  const indexes = Uploads.receivedIndexes(upload.id);
  return {
    uploadId: upload.id,
    totalChunks: upload.total_chunks,
    received: toRanges(indexes),
    missing: missingChunks(indexes, upload.total_chunks),
    status: upload.status,
  };
}

/** يدمج الأجزاء المرتّبة في ملف واحد ويحسب SHA-256 الكامل مع backpressure. */
async function assembleParts(uploadId: string, totalChunks: number, destPath: string): Promise<string> {
  const hash = createHash('sha256');
  const out = createWriteStream(destPath);
  for (let i = 0; i < totalChunks; i++) {
    const src = createReadStream(partPath(uploadId, i));
    await new Promise<void>((resolve, reject) => {
      src.on('data', (d: Buffer) => {
        hash.update(d);
        if (!out.write(d)) {
          src.pause();
          out.once('drain', () => src.resume());
        }
      });
      src.on('end', resolve);
      src.on('error', reject);
    });
  }
  out.end();
  await once(out, 'finish');
  return hash.digest('hex');
}

/** يُكمل الرفع: يتحقّق من اكتمال الأجزاء وسلامتها، يدمجها، وينشئ الملف. */
export async function completeUpload(input: {
  userId: string;
  uploadId: string;
}): Promise<{ file: Record<string, unknown>; fileRow: FileRow }> {
  const cfg = loadConfig();
  const log = getLogger();
  const upload = requireOwnedPending(input.userId, input.uploadId);
  if (upload.status === 'completed' && upload.file_id) {
    const existing = Files.findById(upload.file_id);
    if (existing) return { file: toApiFile(existing), fileRow: existing };
  }

  const chunks = Uploads.chunkHashesOrdered(upload.id);
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

  await mkdir(cfg.storage.tmpDir, { recursive: true });
  const assembledPath = path.join(cfg.storage.tmpDir, `assembled-${upload.id}`);
  let sha: string;
  try {
    sha = await assembleParts(upload.id, upload.total_chunks, assembledPath);
    const st = await stat(assembledPath);
    if (st.size !== upload.size) {
      throw errors.unprocessable(`الحجم المدموج (${st.size}) لا يطابق المعلن (${upload.size}).`);
    }
  } catch (e) {
    await rm(assembledPath, { force: true }).catch(() => {});
    throw e;
  }

  const fileRow = await ingestLocalFile({
    userId: upload.user_id,
    folderId: upload.folder_id,
    name: upload.name,
    tempPath: assembledPath,
    source: 'upload',
    sha256: sha,
  });

  Uploads.setStatus(upload.id, 'completed', fileRow.id);
  await rm(partDir(upload.id), { recursive: true, force: true }).catch(() => {});
  log.info({ uploadId: upload.id, fileId: fileRow.id }, 'اكتمل الرفع');
  return { file: toApiFile(fileRow), fileRow };
}

export async function abortUpload(userId: string, uploadId: string): Promise<void> {
  const upload = Uploads.findById(uploadId);
  if (!upload || upload.user_id !== userId) return;
  Uploads.setStatus(upload.id, 'aborted', null);
  await rm(partDir(upload.id), { recursive: true, force: true }).catch(() => {});
}

/** تنظيف جلسات الرفع المنتهية المهجورة (يستدعيه المجدوِل). */
export async function cleanupExpiredUploads(): Promise<number> {
  const expired = Uploads.listExpiredPending();
  for (const u of expired) {
    await rm(partDir(u.id), { recursive: true, force: true }).catch(() => {});
    Uploads.delete(u.id);
  }
  return expired.length;
}
