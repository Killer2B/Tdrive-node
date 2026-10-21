/**
 * مخزن القطع: يجسر بين الكاش (محوّل التخزين على القرص) والمخزن الدائم (Telegram) والبيانات.
 * المحتوى يُقسَّم إلى قطع ثابتة الحجم؛ القرص كاش قابل للإخلاء، وTelegram هو المصدر الدائم.
 */
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { getStorage } from '../storage/index.ts';
import { FileChunks, type FileChunkRow, type FileRow } from '../db/repo.ts';
import { HashingPassThrough } from '../lib/hash.ts';
import { loadConfig } from '../config/env.ts';
import * as telegram from './telegram.ts';

export function cacheKey(fileId: string, idx: number): string {
  return `cache/${fileId}/${idx}`;
}

/** حجم القطعة لملف (يرجع إلى الإعداد إن لم يُخزَّن). */
export function chunkSizeOf(file: FileRow): number {
  return file.chunk_size ?? loadConfig().upload.chunkSize;
}

/** يقسّم ملفًّا مؤقّتًا على القرص إلى قطع في الكاش ويُنشئ صفوف file_chunks. */
export async function splitFileIntoChunks(
  fileId: string,
  tempPath: string,
  size: number,
  chunkSize: number,
): Promise<void> {
  const storage = getStorage();
  const totalChunks = Math.max(1, Math.ceil(size / chunkSize));
  for (let idx = 0; idx < totalChunks; idx++) {
    const start = idx * chunkSize;
    const end = Math.min(size, start + chunkSize) - 1;
    const len = size === 0 ? 0 : end - start + 1;
    const hpt = new HashingPassThrough();
    const rs = size === 0 ? Readable.from([Buffer.alloc(0)]) : createReadStream(tempPath, { start, end });
    rs.pipe(hpt);
    await storage.put(cacheKey(fileId, idx), hpt, { size: len });
    await FileChunks.add({ file_id: fileId, idx, size: len, sha256: hpt.digestHex(), cached: true });
    if (totalChunks === 1 && size === 0) break;
  }
}

/** ينقل ملف جزء رفع من القرص إلى قطعة كاش (يستهلك المصدر). */
export async function cacheChunkFromPath(fileId: string, idx: number, sourcePath: string): Promise<void> {
  await getStorage().putFile(cacheKey(fileId, idx), sourcePath);
}

/** يقرأ بايتات قطعة: من الكاش إن وُجدت، وإلا من Telegram (مع إعادة التخزين في الكاش). */
export async function readChunkBuffer(file: FileRow, chunk: FileChunkRow, signal?: AbortSignal): Promise<Buffer> {
  const storage = getStorage();
  const key = cacheKey(file.id, chunk.idx);
  const stat = await storage.stat(key);
  if (stat) {
    return storage.get(key);
  }
  if (chunk.tg_file_id) {
    const buf = await telegram.getChunkBuffer(chunk.tg_file_id, signal);
    // write-through إلى الكاش (أفضل جهد)
    try {
      await storage.put(key, buf, { size: buf.length });
      await FileChunks.setCached(file.id, chunk.idx, true);
    } catch {
      /* تجاهل فشل التخزين المؤقّت */
    }
    return buf;
  }
  throw new Error(`قطعة غير متاحة: ${file.id}/${chunk.idx}`);
}

/** يبني تدفّق قراءة لنطاق بايتات عبر القطع (قطعة واحدة في الذاكرة كحدّ أقصى). */
export function createRangeStream(
  file: FileRow,
  chunks: FileChunkRow[],
  start: number,
  end: number,
  signal?: AbortSignal,
): Readable {
  const chunkSize = chunkSizeOf(file);
  async function* gen(): AsyncGenerator<Buffer> {
    for (const c of chunks) {
      const cStart = c.idx * chunkSize;
      const cEnd = cStart + c.size - 1;
      if (c.size === 0) continue;
      if (cEnd < start || cStart > end) continue;
      const buf = await readChunkBuffer(file, c, signal);
      const sliceStart = Math.max(0, start - cStart);
      const sliceEnd = Math.min(c.size - 1, end - cStart);
      yield buf.subarray(sliceStart, sliceEnd + 1);
    }
  }
  return Readable.from(gen(), { objectMode: false });
}

/** يرفع قطعة واحدة من الكاش إلى Telegram ويسجّل المرجع. */
export async function flushChunkToTelegram(file: FileRow, chunk: FileChunkRow, signal?: AbortSignal): Promise<void> {
  if (chunk.tg_file_id) return; // مرفوعة مسبقًا
  const storage = getStorage();
  const key = cacheKey(file.id, chunk.idx);
  const buf = await storage.get(key); // يجب أن تكون في الكاش قبل الرفع
  const ref = await telegram.sendChunk(buf, `${file.id}_${chunk.idx}.part`, signal);
  await FileChunks.setTg(file.id, chunk.idx, ref.messageId, ref.fileId);
}

/** يحذف قطع ملف من الكاش (ومن Telegram في الخلفية عبر المستدعي). */
export async function deleteCacheChunks(fileId: string, chunks: FileChunkRow[]): Promise<void> {
  const storage = getStorage();
  for (const c of chunks) {
    await storage.delete(cacheKey(fileId, c.idx)).catch(() => {});
  }
}

/** يُخلي كاش القطع المؤكّدة على Telegram عند تجاوز السقف (LRU بسيط حسب آخر تعديل). */
export async function evictCache(): Promise<{ evicted: number; freed: number }> {
  const cfg = loadConfig();
  const storage = getStorage();
  const cap = cfg.cache.capBytes;
  const items = await storage.list('cache');
  let total = items.reduce((s, i) => s + i.size, 0);
  if (total <= cap) return { evicted: 0, freed: 0 };

  items.sort((a, b) => (a.lastModified ?? 0) - (b.lastModified ?? 0));
  let evicted = 0;
  let freed = 0;
  for (const it of items) {
    if (total <= cap) break;
    const m = /^cache\/([^/]+)\/(\d+)$/.exec(it.key);
    if (!m) continue;
    const fileId = m[1];
    const idx = Number(m[2]);
    const chunk = await FileChunks.get(fileId, idx);
    if (!chunk || !chunk.tg_file_id) continue; // لا تُخلِ قطعة لم تُرفَع بعد
    await storage.delete(it.key).catch(() => {});
    await FileChunks.setCached(fileId, idx, false);
    total -= it.size;
    freed += it.size;
    evicted++;
  }
  return { evicted, freed };
}
