/**
 * Telegram Bot API كطبقة تخزين دائمة للقطع (≤18MB لكل قطعة — حدّ getFile 20MB).
 * تنظيم المعدّل (pacing) بين عمليات الكتابة + معالجة 429 (flood-wait).
 * يستخدم fetch العالميّ (undici) لدعم multipart/FormData تلقائيًّا.
 */
import { Readable } from 'node:stream';
import { loadConfig } from '../config/env.ts';
import { getLogger } from '../lib/logger.ts';
import { sleep } from '../lib/backoff.ts';
import { errors } from '../lib/errors.ts';

export interface TgChunkRef {
  messageId: number;
  fileId: string;
  size: number;
}

const FILE_PATH_RE = /^[a-zA-Z0-9_./-]+$/;
const MAX_RETRIES = 5;

let writeChain: Promise<unknown> = Promise.resolve();
let lastWriteTs = 0;

function tg() {
  const cfg = loadConfig();
  return {
    base: `${cfg.telegram.apiBase}/bot${cfg.telegram.token}`,
    fileBase: `${cfg.telegram.apiBase}/file/bot${cfg.telegram.token}`,
    chatId: cfg.telegram.chatId ?? '',
    minGap: cfg.telegram.minGapMs,
  };
}

function timeoutSignal(ms: number, signal?: AbortSignal): AbortSignal {
  const signals = [AbortSignal.timeout(ms)];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

async function pacedWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const gap = tg().minGap - (Date.now() - lastWriteTs);
    if (gap > 0) await sleep(gap);
    try {
      return await fn();
    } finally {
      lastWriteTs = Date.now();
    }
  });
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<T>;
}

interface TgApiResult {
  ok?: boolean;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
  result?: { message_id?: number; document?: { file_id?: string }; file_path?: string };
}

async function callApi(
  method: string,
  body: FormData | Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TgApiResult> {
  const { base } = tg();
  const isForm = body instanceof FormData;
  const res = await fetch(`${base}/${method}`, {
    method: 'POST',
    headers: isForm ? undefined : { 'content-type': 'application/json' },
    body: isForm ? (body as FormData) : JSON.stringify(body),
    signal: timeoutSignal(timeoutMs, signal),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as TgApiResult;
  } catch {
    throw errors.badGateway('استجابة تخزين غير صالحة من Telegram.');
  }
}

function retryAfterMs(json: TgApiResult): number {
  const ra = json.parameters?.retry_after;
  return typeof ra === 'number' && ra > 0 ? Math.ceil(ra * 1000) : 0;
}

/** يرسل قطعة واحدة كمستند Telegram (مع pacing وإعادة محاولة على 429). */
export async function sendChunk(buffer: Buffer, filename: string, signal?: AbortSignal): Promise<TgChunkRef> {
  const log = getLogger();
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const json = await pacedWrite(async () => {
      const { chatId } = tg();
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('document', new Blob([buffer], { type: 'application/octet-stream' }), filename);
      return callApi('sendDocument', form, 180_000, signal);
    });

    if (json.ok && json.result?.message_id && json.result.document?.file_id) {
      return { messageId: json.result.message_id, fileId: json.result.document.file_id, size: buffer.length };
    }
    if (json.error_code === 429 || json.error_code === 420) {
      const waitMs = Math.max(1000, retryAfterMs(json));
      log.warn({ waitMs, attempt }, 'Telegram flood-wait، انتظار');
      await sleep(waitMs, signal);
      continue;
    }
    throw errors.badGateway(`فشل رفع القطعة إلى Telegram: ${json.description ?? json.error_code ?? 'غير معروف'}`);
  }
  throw errors.serviceUnavailable('Telegram مشغول (flood-wait) — تعذّر رفع القطعة بعد عدّة محاولات.');
}

async function resolveFilePath(fileId: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const json = await callApi('getFile', { file_id: fileId }, 60_000, signal);
    if (json.ok && json.result?.file_path && FILE_PATH_RE.test(json.result.file_path) && !json.result.file_path.includes('..')) {
      return json.result.file_path;
    }
    if (json.error_code === 429) {
      await sleep(Math.max(1000, retryAfterMs(json)), signal);
      continue;
    }
    throw errors.badGateway('تعذّر الحصول على مسار القطعة من Telegram.');
  }
  throw errors.serviceUnavailable('Telegram مشغول — تعذّر قراءة القطعة.');
}

/** يجلب قطعة كاملة كـ Buffer (≤ ~18MB). */
export async function getChunkBuffer(fileId: string, signal?: AbortSignal): Promise<Buffer> {
  const { fileBase } = tg();
  const path = await resolveFilePath(fileId, signal);
  const res = await fetch(`${fileBase}/${path}`, { signal: timeoutSignal(300_000, signal) });
  if (!res.ok) {
    if (res.status === 429) throw errors.serviceUnavailable('Telegram مشغول — أعد المحاولة.');
    throw errors.badGateway(`تعذّر تنزيل القطعة من Telegram (HTTP ${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** تدفّق قراءة قطعة كاملة من Telegram. */
export async function getChunkStream(fileId: string, signal?: AbortSignal): Promise<Readable> {
  const { fileBase } = tg();
  const path = await resolveFilePath(fileId, signal);
  const res = await fetch(`${fileBase}/${path}`, { signal: timeoutSignal(300_000, signal) });
  if (!res.ok || !res.body) {
    throw errors.badGateway(`تعذّر تنزيل القطعة من Telegram (HTTP ${res.status}).`);
  }
  return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
}

/** يحذف رسالة قطعة (best-effort؛ يتجاهل "غير موجودة/قديمة"). */
export async function deleteMessage(messageId: number, signal?: AbortSignal): Promise<void> {
  await pacedWrite(async () => {
    const { chatId } = tg();
    const json = await callApi('deleteMessage', { chat_id: chatId, message_id: messageId }, 30_000, signal);
    if (!json.ok && json.error_code === 429) await sleep(Math.max(1000, retryAfterMs(json)), signal);
    return json;
  }).catch(() => undefined);
}

/** فحص صحّة الإعداد (getMe). */
export async function checkConnection(): Promise<{ ok: boolean; detail?: string }> {
  try {
    const json = await callApi('getMe', {}, 15_000);
    return json.ok ? { ok: true } : { ok: false, detail: json.description };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
