/** طابور المهام الدائم: تحميلات ثقيلة بتزامن قابل للضبط، إلغاء، وإعادة محاولة بتراجع أسّي. */
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { Jobs, Files, FileChunks, type JobRow } from '../db/repo.ts';
import { loadConfig } from '../config/env.ts';
import { getLogger } from '../lib/logger.ts';
import { newId } from '../lib/ids.ts';
import { backoffDelay, sleep } from '../lib/backoff.ts';
import { formatBytes } from '../lib/bytes.ts';
import { assertPublicHost } from '../lib/ssrf.ts';
import { errors } from '../lib/errors.ts';
import { publishJob } from './progress.ts';
import { directDownload } from './downloads.ts';
import * as ytdlp from './ytdlp.ts';
import { ingestLocalFile } from './files.ts';
import { flushChunkToTelegram } from './chunkstore.ts';
import { sanitizeFileName } from '../lib/paths.ts';

export const JobType = {
  DirectUrl: 'download_url',
  Media: 'download_media',
  FlushTelegram: 'flush_telegram',
} as const;

interface DownloadPayload {
  url: string;
  mode: 'direct' | 'media';
  formatId?: string;
  folderId?: string | null;
  name?: string;
  title?: string;
}

const LEASE_MS = 60_000;
const RENEW_MS = 20_000;
const POLL_MS = 1200;
const PROGRESS_MIN_INTERVAL = 500;

const workerId = newId('wrk');
let stopped = false;
const active = new Map<string, AbortController>();
const loops: Promise<void>[] = [];

function formatEta(sec?: number): string | undefined {
  if (sec === undefined || !Number.isFinite(sec)) return undefined;
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}د ${r}ث` : `${r}ث`;
}

/** يُنشئ مهمة تحميل جديدة ويُرجعها، مع بثّها للواجهة. */
export async function enqueueDownload(input: {
  userId: string;
  url: string;
  mode: 'direct' | 'media';
  formatId?: string;
  folderId?: string | null;
  name?: string;
  title?: string;
}): Promise<JobRow> {
  const cfg = loadConfig();
  const payload: DownloadPayload = {
    url: input.url,
    mode: input.mode,
    formatId: input.formatId,
    folderId: input.folderId ?? null,
    name: input.name,
    title: input.title,
  };
  const job = await Jobs.create({
    user_id: input.userId,
    type: input.mode === 'media' ? JobType.Media : JobType.DirectUrl,
    payload,
    title: input.title ?? input.name ?? input.url,
    max_attempts: cfg.queue.jobMaxAttempts,
  });
  publishJob(job);
  return job;
}

/** مهمة رفع قطع ملف من الكاش إلى Telegram (التخزين الدائم). */
export async function enqueueFlush(userId: string, fileId: string, title: string): Promise<JobRow> {
  const cfg = loadConfig();
  const job = await Jobs.create({
    user_id: userId,
    type: JobType.FlushTelegram,
    payload: { fileId },
    title,
    max_attempts: cfg.queue.jobMaxAttempts,
  });
  publishJob(job);
  return job;
}

export async function requestCancel(userId: string, jobId: string): Promise<boolean> {
  const job = await Jobs.findById(jobId);
  if (!job || job.user_id !== userId) return false;
  await Jobs.requestCancel(jobId);
  const ctrl = active.get(jobId);
  if (ctrl) ctrl.abort();
  return true;
}

/** يعيد مهمة فاشلة/ملغاة إلى الطابور. */
export async function retryJob(userId: string, jobId: string): Promise<boolean> {
  const job = await Jobs.findById(jobId);
  if (!job || job.user_id !== userId) return false;
  if (job.status === 'running' || job.status === 'queued') return false;
  await Jobs.requeue(jobId);
  await publishFresh(jobId);
  return true;
}

/** يجلب أحدث حالة للمهمة ويبثّها للواجهة. */
async function publishFresh(jobId: string): Promise<void> {
  const fresh = await Jobs.findById(jobId);
  if (fresh) publishJob(fresh);
}

/** يحوّل صفّ مهمة إلى شكل الواجهة. */
export function toApiJob(job: JobRow): Record<string, unknown> {
  let name = job.title ?? '';
  try {
    const p = JSON.parse(job.payload) as DownloadPayload;
    name = job.title ?? p.name ?? p.url;
  } catch {
    /* تجاهل */
  }
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    name,
    progress: job.progress,
    speed: job.speed,
    eta: job.eta,
    stage: job.stage,
    totalBytes: job.total_bytes,
    doneBytes: job.done_bytes,
    error: job.error,
    fileId: job.file_id,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

async function runJob(job: JobRow): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger();
  const controller = new AbortController();
  active.set(job.id, controller);

  const renew = setInterval(() => {
    void (async () => {
      if (await Jobs.isCancelRequested(job.id)) controller.abort();
      else await Jobs.renewLease(job.id, LEASE_MS);
    })().catch((e) => getLogger().error({ err: String(e) }, 'خطأ في تجديد إجارة المهمة'));
  }, RENEW_MS);

  let lastEmit = 0;
  const emit = async (patch: Parameters<typeof Jobs.progress>[1]): Promise<void> => {
    const now = Date.now();
    if (now - lastEmit < PROGRESS_MIN_INTERVAL) return;
    lastEmit = now;
    // لا نترك وعد التقدّم بلا معالجة: فشل الكتابة/البثّ لا يجب أن يُسقط العملية
    await Jobs.progress(job.id, patch)
      .then(() => publishFresh(job.id))
      .catch((e) => getLogger().warn({ err: String(e), jobId: job.id }, 'تعذّر تحديث تقدّم المهمة'));
  };

  const workDir = path.join(cfg.storage.tmpDir, 'downloads', job.id);

  try {
    if (await Jobs.isCancelRequested(job.id)) throw new Error('CANCELED');

    if (job.type === JobType.FlushTelegram) {
      await runFlush(job, controller.signal, emit);
      return;
    }

    const payload = JSON.parse(job.payload) as DownloadPayload;
    await mkdir(workDir, { recursive: true });

    await Jobs.progress(job.id, { stage: 'يبدأ التحميل', progress: 0 });
    await publishFresh(job.id);

    let producedPath: string;
    let suggestedName: string | undefined = payload.name;
    let mime: string | undefined;

    if (payload.mode === 'direct') {
      const check = await assertPublicHost(new URL(payload.url).hostname);
      if (!check.ok) throw errors.forbidden('رُفض الرابط لأسباب أمنية (SSRF).');
      const guessName = sanitizeFileName(payload.name ?? new URL(payload.url).pathname.split('/').pop() ?? 'download');
      producedPath = path.join(workDir, guessName);
      const res = await directDownload(payload.url, {
        destPath: producedPath,
        signal: controller.signal,
        connectTimeoutMs: cfg.queue.httpConnectTimeoutMs,
        idleTimeoutMs: cfg.queue.httpIdleTimeoutMs,
        onProgress: (p) => {
          const percent = p.totalBytes ? Math.min(99, (p.downloadedBytes / p.totalBytes) * 100) : undefined;
          emit({
            stage: 'تحميل',
            progress: percent ?? job.progress,
            total_bytes: p.totalBytes ?? null,
            done_bytes: p.downloadedBytes,
            speed: p.speed ? `${formatBytes(p.speed)}/ث` : null,
          });
        },
      });
      if (res.filename) suggestedName = payload.name ?? res.filename;
      mime = res.contentType ?? undefined;
    } else {
      // yt-dlp: تحقّق أوّليّ من المضيف (أفضل جهد؛ قد يتبع yt-dlp تحويلات داخليًّا)
      let host: string;
      try {
        host = new URL(payload.url).hostname;
      } catch {
        throw errors.badRequest('رابط غير صالح.');
      }
      const check = await assertPublicHost(host);
      if (!check.ok) throw errors.forbidden('رُفض الرابط لأسباب أمنية (SSRF).');
      const dl = await ytdlp.download(payload.url, {
        outDir: workDir,
        formatId: payload.formatId,
        signal: controller.signal,
        onProgress: (p) => {
          emit({
            stage: 'تحميل من المصدر',
            progress: p.percent ?? job.progress,
            total_bytes: p.totalBytes ?? null,
            done_bytes: p.downloadedBytes ?? null,
            speed: p.speed ? `${formatBytes(p.speed)}/ث` : null,
            eta: formatEta(p.eta) ?? null,
          });
        },
      });
      producedPath = dl.filePath;
      const base = path.basename(producedPath);
      const ext = path.extname(base);
      suggestedName = payload.name ?? (payload.title ? `${sanitizeFileName(payload.title)}${ext}` : base);
    }

    if (await Jobs.isCancelRequested(job.id)) throw new Error('CANCELED');

    await Jobs.progress(job.id, { stage: 'حفظ في التخزين', progress: 99 });
    await publishFresh(job.id);

    const file = await ingestLocalFile({
      userId: job.user_id,
      folderId: payload.folderId ?? null,
      name: suggestedName ?? 'download',
      tempPath: producedPath,
      source: payload.mode === 'media' ? 'ytdlp' : 'url',
      sourceUrl: payload.url,
      mime,
    });

    await Jobs.complete(job.id, { fileId: file.id }, file.id);
    await publishFresh(job.id);
    if (file.backend === 'telegram') await enqueueFlush(job.user_id, file.id, suggestedName ?? file.name);
    log.info({ jobId: job.id, fileId: file.id, backend: file.backend }, 'اكتملت مهمة التحميل');
  } catch (e) {
    const canceled = controller.signal.aborted || (e instanceof Error && e.message === 'CANCELED') || (await Jobs.isCancelRequested(job.id));
    if (canceled) {
      await Jobs.markCanceled(job.id);
      await publishFresh(job.id);
      log.info({ jobId: job.id }, 'أُلغيت المهمة');
    } else {
      const fresh = await Jobs.findById(job.id);
      const attempts = fresh?.attempts ?? job.attempts;
      const maxAttempts = fresh?.max_attempts ?? job.max_attempts;
      const message = e instanceof Error ? e.message : String(e);
      // أخطاء دائمة (أداة مفقودة/DRM/محتوى خاص) لا يُفيد إعادة المحاولة فيها
      const permanent = e instanceof ytdlp.YtdlpUnavailableError || e instanceof ytdlp.YtdlpPermanentError;
      if (!permanent && attempts < maxAttempts) {
        const delay = backoffDelay(attempts, { baseMs: 2000, maxMs: 120_000 });
        await Jobs.fail(job.id, message, Date.now() + delay);
        log.warn({ jobId: job.id, attempts, retryInMs: delay, err: message }, 'فشلت المهمة، إعادة محاولة');
      } else {
        await Jobs.fail(job.id, message);
        log.error({ jobId: job.id, err: message, permanent }, 'فشلت المهمة نهائيًّا');
      }
      await publishFresh(job.id);
    }
  } finally {
    clearInterval(renew);
    active.delete(job.id);
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runFlush(
  job: JobRow,
  signal: AbortSignal,
  emit: (patch: Parameters<typeof Jobs.progress>[1]) => Promise<void>,
): Promise<void> {
  const { fileId } = JSON.parse(job.payload) as { fileId: string };
  const file = await Files.findById(fileId);
  if (!file) throw new Error('الملف غير موجود للرفع الدائم.');

  const all = await FileChunks.listByFile(fileId);
  const pending = all.filter((c) => !c.tg_file_id);
  const total = Math.max(1, all.length);
  let done = total - pending.length;

  for (const c of pending) {
    if (signal.aborted || (await Jobs.isCancelRequested(job.id))) throw new Error('CANCELED');
    await flushChunkToTelegram(file, c, signal);
    done++;
    await emit({
      stage: 'رفع إلى التخزين الدائم',
      progress: Math.min(99, (done / total) * 100),
      total_bytes: file.size,
      done_bytes: Math.round(file.size * (done / total)),
    });
  }

  await Files.update(fileId, { status: 'ready' });
  await Jobs.complete(job.id, { fileId }, fileId);
  await publishFresh(job.id);
  getLogger().info({ jobId: job.id, fileId }, 'اكتمل الرفع إلى Telegram');
}

async function workerLoop(): Promise<void> {
  while (!stopped) {
    let job: JobRow | undefined;
    try {
      job = await Jobs.claimNext(workerId, LEASE_MS);
    } catch (e) {
      getLogger().error({ err: String(e) }, 'خطأ في سحب مهمة');
    }
    if (!job) {
      await sleep(POLL_MS).catch(() => {});
      continue;
    }
    publishJob(job);
    await runJob(job);
  }
}

/** يبدأ عمّال الطابور حسب التزامن المضبوط. */
export async function startQueue(): Promise<void> {
  const cfg = loadConfig();
  stopped = false;
  await Jobs.reclaimStale();
  for (let i = 0; i < cfg.queue.downloadConcurrency; i++) {
    loops.push(workerLoop());
  }
  getLogger().info({ concurrency: cfg.queue.downloadConcurrency }, 'بدأ طابور التحميل');
}

/** يوقف الطابور بلطف: يُلغي المهام الجارية (ستُستأنف لاحقًا عبر reclaimStale). */
export async function stopQueue(): Promise<void> {
  stopped = true;
  for (const ctrl of active.values()) ctrl.abort();
  await Promise.allSettled(loops);
  loops.length = 0;
}
