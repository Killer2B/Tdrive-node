/** تجزئة SHA-256 دفقًا (بلا تحميل الملف كاملًا في الذاكرة). */
import { createHash, timingSafeEqual } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

/** يحسب SHA-256 (hex) لتدفّق قراءة. */
export async function sha256OfStream(readable: Readable): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(readable, hash);
  return hash.digest('hex');
}

/** يحسب SHA-256 (hex) لملف على القرص. */
export async function sha256OfFile(filePath: string): Promise<string> {
  return sha256OfStream(createReadStream(filePath));
}

/**
 * Transform يحسب SHA-256 أثناء مرور البايتات دون تجميعها.
 * استخدمه في مسار الرفع لحساب بصمة الجزء/الملف أثناء الكتابة للتخزين.
 */
export class HashingPassThrough extends Transform {
  private readonly hash = createHash('sha256');
  private byteCount = 0;

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.hash.update(chunk);
    this.byteCount += chunk.length;
    cb(null, chunk);
  }

  /** البصمة النهائية (تُستدعى بعد انتهاء التدفّق). */
  digestHex(): string {
    return this.hash.copy().digest('hex');
  }

  get bytes(): number {
    return this.byteCount;
  }
}

/** مقارنة ثابتة الزمن لبصمتين hex. */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** بصمة الملف الكاملة من بصمات الأجزاء (إصلاح رخيص عند complete). */
export function fingerprintFromChunkHashes(hashes: string[]): string {
  const hash = createHash('sha256');
  hash.update(hashes.join('\n'));
  return hash.digest('hex');
}
