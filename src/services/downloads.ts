/** التحميل المباشر لرابط ملف عاديّ عبر undici مع حماية SSRF ودعم Range/الاستئناف. */
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { request } from 'undici';
import { assertPublicHost } from '../lib/ssrf.ts';
import { errors } from '../lib/errors.ts';

const MAX_REDIRECTS = 5;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export interface DirectProgress {
  downloadedBytes: number;
  totalBytes?: number;
  speed?: number;
}

export interface DirectResult {
  bytes: number;
  contentType?: string;
  filename?: string;
}

function filenameFromUrl(u: URL): string | undefined {
  const last = u.pathname.split('/').filter(Boolean).pop();
  return last ? decodeURIComponent(last) : undefined;
}

function filenameFromDisposition(cd: string | undefined): string | undefined {
  if (!cd) return undefined;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/^"|"$/g, ''));
    } catch {
      /* تجاهل */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1] : undefined;
}

/**
 * يحمّل رابطًا مباشرًا إلى مسار على القرص.
 * - يتحقّق أن كل مضيف (بما فيها بعد كل Redirect) يحلّ إلى عنوان عام (حماية SSRF).
 * - يدعم الاستئناف عبر Range إن وُجد ملف جزئيّ.
 * - يعتمد مهلات undici (headers/body) كحارس اتصال/خمول.
 */
export async function directDownload(
  startUrl: string,
  opts: {
    destPath: string;
    signal?: AbortSignal;
    connectTimeoutMs: number;
    idleTimeoutMs: number;
    onProgress?: (p: DirectProgress) => void;
  },
): Promise<DirectResult> {
  let current: URL;
  try {
    current = new URL(startUrl);
  } catch {
    throw errors.badRequest('رابط غير صالح.');
  }

  // استئناف: حجم الملف الجزئيّ الموجود
  let existing = 0;
  try {
    const st = await stat(opts.destPath);
    existing = st.size;
  } catch {
    existing = 0;
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw errors.badRequest('يُسمح فقط بروابط http/https.');
    }
    const check = await assertPublicHost(current.hostname);
    if (!check.ok) {
      throw errors.forbidden('رُفض الرابط لأسباب أمنية (SSRF): يشير إلى عنوان داخليّ/خاصّ.', { reason: check.reason });
    }

    const headers: Record<string, string> = {
      'user-agent': 'tdrive/1.0 (+https://localhost)',
      accept: '*/*',
    };
    if (existing > 0) headers['range'] = `bytes=${existing}-`;

    const res = await request(current, {
      method: 'GET',
      headers,
      maxRedirections: 0,
      headersTimeout: opts.connectTimeoutMs,
      bodyTimeout: opts.idleTimeoutMs,
      signal: opts.signal,
    });

    if (REDIRECT_CODES.has(res.statusCode)) {
      const loc = res.headers['location'];
      await res.body.arrayBuffer().catch(() => {});
      const locStr = Array.isArray(loc) ? loc[0] : loc;
      if (!locStr) throw errors.badGateway('إعادة توجيه بلا عنوان.');
      current = new URL(locStr, current);
      continue;
    }

    if (res.statusCode === 416) {
      // النطاق المطلوب غير قابل للتحقيق ⇒ الملف مكتمل مسبقًا
      await res.body.arrayBuffer().catch(() => {});
      return { bytes: existing, filename: filenameFromUrl(current) };
    }

    if (res.statusCode >= 400) {
      await res.body.arrayBuffer().catch(() => {});
      throw errors.badGateway(`تعذّر التحميل من المصدر (HTTP ${res.statusCode}).`);
    }

    const resuming = res.statusCode === 206 && existing > 0;
    const contentType = pickHeader(res.headers['content-type']);
    const contentLength = Number(pickHeader(res.headers['content-length']) ?? '0');
    const filename =
      filenameFromDisposition(pickHeader(res.headers['content-disposition'])) ?? filenameFromUrl(current);

    const totalBytes = contentLength > 0 ? contentLength + (resuming ? existing : 0) : undefined;

    let downloaded = resuming ? existing : 0;
    const startTs = Date.now();
    const body = res.body as unknown as Readable;
    body.on('data', (c: Buffer) => {
      downloaded += c.length;
      const elapsed = (Date.now() - startTs) / 1000;
      opts.onProgress?.({
        downloadedBytes: downloaded,
        totalBytes,
        speed: elapsed > 0 ? (downloaded - (resuming ? existing : 0)) / elapsed : undefined,
      });
    });

    const out = createWriteStream(opts.destPath, { flags: resuming ? 'a' : 'w' });
    await pipeline(body, out);
    return { bytes: downloaded, contentType, filename };
  }

  throw errors.badGateway('تجاوز عدد عمليات إعادة التوجيه المسموحة.');
}

function pickHeader(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export interface DirectProbe {
  sizeBytes?: number;
  contentType?: string;
  filename?: string;
  acceptRanges: boolean;
}

/** فحص رابط مباشر عبر HEAD (مع حماية SSRF وإعادة التحقّق بعد كل Redirect). */
export async function probeDirect(startUrl: string, signal?: AbortSignal): Promise<DirectProbe> {
  let current: URL;
  try {
    current = new URL(startUrl);
  } catch {
    throw errors.badRequest('رابط غير صالح.');
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw errors.badRequest('يُسمح فقط بروابط http/https.');
    }
    const check = await assertPublicHost(current.hostname);
    if (!check.ok) throw errors.forbidden('رُفض الرابط لأسباب أمنية (SSRF).', { reason: check.reason });

    const res = await request(current, {
      method: 'HEAD',
      maxRedirections: 0,
      headersTimeout: 15_000,
      signal,
      headers: { 'user-agent': 'tdrive/1.0' },
    });
    await res.body.arrayBuffer().catch(() => {});

    if (REDIRECT_CODES.has(res.statusCode)) {
      const loc = pickHeader(res.headers['location']);
      if (!loc) throw errors.badGateway('إعادة توجيه بلا عنوان.');
      current = new URL(loc, current);
      continue;
    }
    if (res.statusCode >= 400) throw errors.badGateway(`المصدر ردّ بـ HTTP ${res.statusCode}.`);

    const cl = Number(pickHeader(res.headers['content-length']) ?? '0');
    return {
      sizeBytes: cl > 0 ? cl : undefined,
      contentType: pickHeader(res.headers['content-type']),
      filename: filenameFromDisposition(pickHeader(res.headers['content-disposition'])) ?? filenameFromUrl(current),
      acceptRanges: pickHeader(res.headers['accept-ranges']) === 'bytes',
    };
  }
  throw errors.badGateway('تجاوز عدد عمليات إعادة التوجيه المسموحة.');
}
