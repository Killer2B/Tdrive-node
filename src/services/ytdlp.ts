/**
 * غلاف yt-dlp: المعاينة (metadata)، التحميل مع تقدّم لحظي، النسخة والتحديث.
 *
 * مبادئ التصميم:
 * - لا نفترض وجود yt-dlp في PATH: نبحث في ./bin أولًا (ما يهيّئه provision/start)،
 *   ثم في المسار المضبوط، ثم في PATH — ونُخطئ برسالة عربيّة قابلة للتنفيذ.
 * - نضيف الوسائط الاختياريّة فقط بعد التأكّد من دعم النسخة (capability detection)
 *   حتى لا تنكسر النسخ الأقدم بسبب علم غير معروف.
 * - كل خطأ شائع (بوت/كوكيز/DRM/بثّ مباشر/403/429) يُترجم إلى رسالة مفهومة،
 *   والأخطاء الدائمة تُوسَم كي لا يعيد الطابور المحاولة عبثًا.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { runCapture, commandExists, killTree } from '../lib/spawn.ts';
import { loadConfig } from '../config/env.ts';
import { getLogger } from '../lib/logger.ts';
import { ffmpegAvailable, ffmpegBin, resetFfmpegCache } from './ffmpeg.ts';

export interface YtQuality {
  id: string;
  label: string;
  ext: string;
  height?: number;
  filesize?: number;
}

export interface YtProbe {
  title: string;
  durationSec?: number;
  thumbnail?: string;
  uploader?: string;
  extractor?: string;
  isLive?: boolean;
  qualities: YtQuality[];
}

/** yt-dlp غير موجود/غير قابل للتشغيل — خطأ دائم، لا فائدة من إعادة المحاولة. */
export class YtdlpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YtdlpUnavailableError';
  }
}

/** خطأ دائم في المحتوى نفسه (DRM/خاص/بثّ مباشر/صيغة غير متاحة) — لا إعادة محاولة. */
export class YtdlpPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YtdlpPermanentError';
  }
}

interface RawFormat {
  format_id: string;
  ext: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  filesize?: number;
  filesize_approx?: number;
  format_note?: string;
  tbr?: number;
}

interface RawInfo {
  _type?: string;
  entries?: unknown[];
  title?: string;
  duration?: number;
  thumbnail?: string;
  uploader?: string;
  extractor?: string;
  is_live?: boolean;
  live_status?: string;
  formats?: RawFormat[];
}

const EXE = process.platform === 'win32' ? '.exe' : '';
const RESOLVE_TTL_MS = 60_000;
const CAPS_TTL_MS = 10 * 60_000;
const MEDIA_EXT = new Set([
  '.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.m4a', '.mp3', '.opus', '.ogg', '.wav', '.ts',
]);

let binCache: { value: string | null; at: number } | null = null;
let capsCache: { bin: string; flags: Set<string>; at: number } | null = null;

/** يفيد ما إذا كانت القيمة مسارًا (مطلق أو نسبيّ) لا مجرّد اسم برنامج في PATH. */
function isPathLike(value: string): boolean {
  return path.isAbsolute(value) || value.includes('/') || value.includes('\\');
}

/** ملف موجود وحجمه أكبر من صفر (يكشف التنزيل الفاشل الذي يترك ملفًا فارغًا). */
function usableFile(file: string): boolean {
  try {
    const s = statSync(file);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

/**
 * يحلّ مسار yt-dlp التنفيذي بالترتيب:
 * 1) المسار المضبوط صراحةً (إن كان مسارًا)، 2) ./bin/yt-dlp، 3) الاسم في PATH.
 */
export async function resolveYtdlp(): Promise<string | null> {
  if (binCache && Date.now() - binCache.at < RESOLVE_TTL_MS) return binCache.value;
  const configured = (loadConfig().tools.ytdlpPath || 'yt-dlp').trim();
  const candidates: string[] = [];
  if (isPathLike(configured)) candidates.push(configured);
  candidates.push(path.resolve(process.cwd(), 'bin', `yt-dlp${EXE}`));
  if (!isPathLike(configured)) candidates.push(configured);

  let found: string | null = null;
  for (const candidate of candidates) {
    if (isPathLike(candidate)) {
      if (usableFile(candidate)) {
        found = path.resolve(candidate);
        break;
      }
    } else if (await commandExists(candidate, '--version')) {
      found = candidate;
      break;
    }
  }
  binCache = { value: found, at: Date.now() };
  return found;
}

/** يُعيد مسار yt-dlp أو يرمي خطأً دائمًا برسالة قابلة للتنفيذ. */
async function ensureBinary(): Promise<string> {
  const bin = await resolveYtdlp();
  if (bin) return bin;
  throw new YtdlpUnavailableError(
    'أداة yt-dlp غير مثبّتة على الخادم (لا في ./bin ولا في PATH). ' +
      'شغّل «npm run ytdlp:update» أو «node scripts/provision.mjs» ثم أعد المحاولة، ' +
      'أو اضبط YTDLP_PATH على مسار الملفّ التنفيذي.',
  );
}

/** يقرأ أعلام yt-dlp المدعومة من --help مرّة واحدة (للتفاوض على الوسائط الاختياريّة). */
async function capabilityFlags(bin: string): Promise<Set<string>> {
  if (capsCache && capsCache.bin === bin && Date.now() - capsCache.at < CAPS_TTL_MS) return capsCache.flags;
  let flags = new Set<string>();
  try {
    const { stdout, stderr } = await runCapture(bin, ['--help'], {
      timeoutMs: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    for (const m of `${stdout}\n${stderr}`.matchAll(/(?:^|[\s,])(--[a-z][a-z0-9-]*)/g)) flags.add(m[1]);
  } catch {
    flags = new Set();
  }
  capsCache = { bin, flags, at: Date.now() };
  return flags;
}

/** وسائط اختياريّة تُضاف فقط إن كانت النسخة تدعمها. */
async function optionalArgs(bin: string): Promise<string[]> {
  const flags = await capabilityFlags(bin);
  const cfg = loadConfig();
  const extra = cfg.tools.extraArgs.join(' ');
  const out: string[] = [];
  // YouTube الحديث يحتاج محرّك JS لحلّ تحدي nsig؛ Node متوفّر دائمًا هنا.
  if (flags.has('--js-runtimes') && !extra.includes('--js-runtimes')) out.push('--js-runtimes', 'node');
  return out;
}

/** مسار ملف كوكيز YouTube: من الإعداد YTDLP_COOKIES أو الافتراضيّ ./data/cookies.txt. */
export function cookiesFilePath(): string {
  const cfg = loadConfig();
  const configured = cfg.tools.cookies?.trim();
  return configured ? path.resolve(process.cwd(), configured) : path.resolve(process.cwd(), 'data', 'cookies.txt');
}

/** حالة ملف الكوكيز (للواجهة والتشخيص). */
export function cookiesInfo(): { path: string; present: boolean; bytes: number; cookies: number } {
  const file = cookiesFilePath();
  try {
    const s = statSync(file);
    if (!s.isFile() || s.size === 0) return { path: file, present: false, bytes: 0, cookies: 0 };
    const text = readFileSync(file, 'utf8');
    const cookies = text
      .split(/\r?\n/)
      .filter((l) => l.trim() && (l.startsWith('#HttpOnly_') || !l.startsWith('#')))
      .filter((l) => l.split('\t').length >= 7).length;
    return { path: file, present: true, bytes: s.size, cookies };
  } catch {
    return { path: file, present: false, bytes: 0, cookies: 0 };
  }
}

/** وسائط مشتركة: كوكيز YouTube + ثبات الشبكة + وسائط إضافية من الإعداد. */
function commonArgs(withCookies = true): string[] {
  const cfg = loadConfig();
  const a: string[] = ['--no-warnings', '--socket-timeout', '20', '--retries', '10', '--fragment-retries', '10'];
  const cookies = cookiesFilePath();
  if (withCookies && usableFile(cookies)) a.push('--cookies', cookies);
  a.push(...cfg.tools.extraArgs);
  return a;
}

/**
 * بديل بلا كوكيز: عملاء YouTube الذين يعطون روابط تشغيل مقبولة من عناوين مراكز البيانات
 * دون PO token. اختبرنا فعليًّا: `mweb` و`tv_simply` و`web_embedded` تعمل، بينما
 * `android_vr`/`tv` وحدها تُرجع 403 عند تنزيل البيانات.
 */
const YOUTUBE_FALLBACK_ARGS = ['--extractor-args', 'youtube:player_client=mweb,tv_simply,web_embedded'];

/** هل الرابط يوتيوب؟ (البديل خاصّ به) */
function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host);
  } catch {
    return false;
  }
}

/** أخطاء قد يعالجها تغيير عميل YouTube: 403، فحص البوت، صيغة غير متاحة، فشل فكّ التشفير. */
function isAuthOrFormatFailure(message: string): boolean {
  return /403|Forbidden|not a bot|تأكيد الحساب|Sign in|الصيغة المطلوبة|format|تشفير|nsig|403/i.test(message);
}

/** رسالة مفهومة لأخطاء الاستخراج (فارغة إن لم نعرف السبب). */
function friendlyProbeError(stderr: string, cookiesPresent: boolean): string {
  if (/Sign in to confirm|not a bot|confirm you.?re not a bot/i.test(stderr)) {
    return cookiesPresent
      ? 'يوتيوب يطلب تأكيد الحساب: ملفّ الكوكيز الموجود منتهي أو غير صالح — أعد تصديره من متصفّح مسجّل الدخول.'
      : 'يوتيوب يطلب تأكيد الحساب (لست روبوتًا). أضف ملفّ كوكيز من الإعدادات، أو اضبط YTDLP_COOKIES.';
  }
  if (/age.?restricted|confirm your age/i.test(stderr)) return 'المحتوى مقيّد بالعمر — يحتاج كوكيز حساب موثّق.';
  if (/Private video|members-only|Join this channel|login required|Sign in/i.test(stderr)) {
    return 'المحتوى خاص أو يتطلّب تسجيل الدخول.';
  }
  if (/not available in your country|geo.?restrict|blocked it in your country/i.test(stderr)) {
    return 'المحتوى محجوب جغرافيًّا عن الخادم.';
  }
  if (/Video unavailable|This video is unavailable|has been removed|does not exist|Incomplete YouTube ID/i.test(stderr)) {
    return 'الرابط غير متاح أو المحتوى محذوف.';
  }
  if (/Unsupported URL|is not a valid URL/i.test(stderr)) return 'الموقع غير مدعوم من yt-dlp.';
  if (/HTTP Error 429|Too Many Requests/i.test(stderr)) return 'طلبات كثيرة إلى المصدر (429) — انتظر قليلًا أو أضف كوكيز.';
  if (/HTTP Error 403|Forbidden/i.test(stderr)) {
    return 'المصدر رفض الطلب (403) — حدّث yt-dlp أو أضف كوكيز حديثة.';
  }
  if (/Unable to extract|nsig|signature|player response/i.test(stderr)) {
    return 'تعذّر فكّ تشفير يوتيوب (تغيّر الموقع) — حدّث yt-dlp من الإعدادات أو «npm run ytdlp:update».';
  }
  return '';
}

/** يستخرج أوّل كائن JSON صالح من الإخراج (بعض المواقع تطبع أسطرًا قبله). */
function extractJson(stdout: string): RawInfo | null {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as RawInfo;
  } catch {
    return null;
  }
}

/** يجلب بيانات الرابط الوصفية (عنوان/مدّة/جودات) دون تنزيل. */
export async function probe(url: string, signal?: AbortSignal): Promise<YtProbe> {
  const cfg = loadConfig();
  const bin = await ensureBinary();
  const opt = await optionalArgs(bin);
  const base = ['-J', '--no-playlist'];
  const attempts: string[][] = [[...base, ...commonArgs(true), ...opt, '--', url]];
  if (isYouTubeUrl(url)) {
    // محاولة ثانية بلا كوكيز وبعميل مختلف — تحلّ 403/فحص البوت على خوادم البيانات
    attempts.push([...base, ...commonArgs(false), ...opt, ...YOUTUBE_FALLBACK_ARGS, '--', url]);
  }

  let res: Awaited<ReturnType<typeof runCapture>> | null = null;
  for (const args of attempts) {
    try {
      res = await runCapture(bin, args, { timeoutMs: cfg.tools.probeTimeoutMs, signal });
    } catch (e) {
      if (e instanceof YtdlpUnavailableError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/مهلة/.test(msg)) {
        throw new Error('انتهت مهلة قراءة الرابط — قد يكون الموقع بطيئًا أو الرابط بثًّا مباشرًا.');
      }
      throw new Error(`تعذّر تشغيل yt-dlp: ${msg}`);
    }
    if (res.code === 0) break;
    if (!isYouTubeUrl(url) || !isAuthOrFormatFailure(res.stderr)) break;
  }

  if (!res || res.code !== 0) {
    const stderr = res?.stderr ?? '';
    const friendly = friendlyProbeError(stderr, cookiesInfo().present);
    const detail = stderr.trim().slice(0, 400) || `رمز الخروج ${res?.code ?? 'غير معروف'}`;
    throw new Error(friendly || `yt-dlp فشل في قراءة الرابط: ${detail}`);
  }

  const info = extractJson(res.stdout);
  if (!info) throw new Error('استجابة yt-dlp غير مفهومة (ليست JSON).');
  // --no-playlist يمنع القوائم المرفقة بفيديو، لكن رابط قائمة صريحًا يعود قائمة كاملة.
  // نرفضه بوضوح بدل تنزيل مئات العناصر في مهمة واحدة ثم فقدانها.
  if (info._type === 'playlist' || (Array.isArray(info.entries) && !info.formats)) {
    throw new YtdlpPermanentError('روابط قوائم التشغيل غير مدعومة — ألصق رابط فيديو واحد.');
  }

  const qualities: YtQuality[] = [];
  const seen = new Set<string>();
  const videoFormats = (info.formats ?? [])
    .filter((f) => f.vcodec && f.vcodec !== 'none' && f.height)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0));
  for (const f of videoFormats) {
    const key = `${f.height}p`;
    if (seen.has(key)) continue;
    seen.add(key);
    qualities.push({
      id: f.format_id,
      label: `${f.height}p${f.format_note ? ` ${f.format_note}` : ''}`,
      ext: f.ext,
      height: f.height,
      filesize: f.filesize ?? f.filesize_approx,
    });
  }
  qualities.unshift({ id: 'best', label: 'أفضل جودة', ext: info.formats?.[0]?.ext ?? 'mp4' });

  return {
    title: info.title ?? 'بدون عنوان',
    durationSec: info.duration,
    thumbnail: info.thumbnail,
    uploader: info.uploader,
    extractor: info.extractor,
    isLive: info.is_live === true || info.live_status === 'is_live' || info.live_status === 'is_upcoming',
    qualities,
  };
}

export interface DownloadProgress {
  downloadedBytes?: number;
  totalBytes?: number;
  speed?: number; // bytes/s
  eta?: number; // seconds
  percent?: number;
}

export interface DownloadResult {
  filePath: string;
}

/**
 * يختار تعبير التنسيق المناسب.
 * لصيغة محدّدة نجرب «الصيغة + أفضل صوت» ثم نرجع إلى الصيغة نفسها (لو كانت مدمجة أصلًا)،
 * حتى لا يفشل الاختيار من قائمة الجودات. تعبير المستخدم يُنظَّف من أي محارف غير آمنة.
 * بلا ffmpeg لا يمكن الدمج، لذا نطلب صيغة مدمجة فقط (b) ونُخطئ برسالة واضحة إن لم توجد.
 */
function formatExpr(hasFfmpeg: boolean, formatId?: string): string {
  if (!formatId || formatId === 'best') return hasFfmpeg ? 'bv*+ba/b' : 'b';
  const id = formatId.replace(/[^0-9A-Za-z_.-]/g, '');
  if (!id) return hasFfmpeg ? 'bv*+ba/b' : 'b';
  return hasFfmpeg ? `${id}+ba/${id}` : id;
}

/** يبحث عن أكبر ملف وسائط ناتج في المجلّد (احتياط إن لم يطبع yt-dlp المسار). */
async function findProducedFile(dir: string): Promise<string | null> {
  const names = await readdir(dir).catch(() => [] as string[]);
  let best: { file: string; size: number } | null = null;
  for (const name of names) {
    if (name.endsWith('.part') || name.endsWith('.ytdl') || name.endsWith('.temp')) continue;
    if (!MEDIA_EXT.has(path.extname(name).toLowerCase())) continue;
    const file = path.join(dir, name);
    try {
      const s = statSync(file);
      if (!s.isFile() || s.size === 0) continue;
      if (!best || s.size > best.size) best = { file, size: s.size };
    } catch {
      /* تجاهل */
    }
  }
  return best ? best.file : null;
}

/** يحوّل حجمًا نصيًّا من إخراج yt-dlp (مثل 1.23GiB) إلى بايت. */
function parseSize(value: string, unit: string): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const mult: Record<string, number> = { B: 1, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
  return Math.round(n * (mult[unit.toUpperCase()] ?? 1));
}

/** تصنيف أخطاء التحميل: رسالة عربيّة + هل الخطأ دائم؟ */
function classifyDownloadError(
  stderr: string,
  code: number | null,
  cookiesPresent: boolean,
  hasFfmpeg: boolean,
): { message: string; permanent: boolean } {
  const friendly = friendlyProbeError(stderr, cookiesPresent);
  if (friendly) {
    const retryable = /429|Too Many Requests/i.test(stderr);
    return { message: friendly, permanent: !retryable };
  }
  if (/is live|live event|Premieres in|live stream/i.test(stderr)) {
    return { message: 'البثّ المباشر غير مدعوم — انتظر انتهاء البثّ ثم أعد المحاولة.', permanent: true };
  }
  if (/Requested format is not available|format is not available/i.test(stderr)) {
    return {
      message: hasFfmpeg
        ? 'الصيغة المطلوبة غير متاحة لهذا الرابط — اختر جودة أخرى.'
        : 'هذا الرابط لا يوفّر صيغة مدمجة (صوت+فيديو)، ودمجها يحتاج ffmpeg غير المثبّت — ثبّته أو أعد تشغيل الخادم لتثبيته تلقائيًّا.',
      permanent: true,
    };
  }
  if (/No space left on device|ENOSPC/i.test(stderr)) {
    return { message: 'لا توجد مساحة كافية على القرص لإتمام التحميل.', permanent: true };
  }
  if (/ffmpeg|ffprobe/i.test(stderr) && /not found|not installed|No such file/i.test(stderr)) {
    return { message: 'دمج الصوت والفيديو يحتاج ffmpeg غير المثبّت — ثبّته أو اختر جودة بصيغة مدمجة.', permanent: true };
  }
  if (/Unable to download|Connection reset|timed out|Temporary failure|EOF occurred|Network is unreachable/i.test(stderr)) {
    return { message: `تعذّر التحميل لسبب شبكي (سيُعاد تلقائيًّا): ${stderr.trim().slice(-200)}`, permanent: false };
  }
  return { message: `فشل التحميل (رمز ${code ?? 'غير معروف'}). ${stderr.trim().slice(-300)}`, permanent: false };
}

/** يحمّل الرابط عبر yt-dlp مع بثّ التقدّم. يُلغى عبر signal. */
export async function download(
  url: string,
  opts: {
    outDir: string;
    formatId?: string;
    signal?: AbortSignal;
    onProgress?: (p: DownloadProgress) => void;
  },
): Promise<DownloadResult> {
  const cfg = loadConfig();
  const bin = await ensureBinary();
  const hasFfmpeg = await ffmpegAvailable();
  const fmt = formatExpr(hasFfmpeg, opts.formatId);
  const flags = await capabilityFlags(bin);
  const opt = await optionalArgs(bin);
  const outDir = path.resolve(opts.outDir);

  /** يبني وسائط المحاولة: الكوكيز (أو بلا) + وسائط بديلة لعملاء YouTube. */
  const buildArgs = (withCookies: boolean, extra: string[]): string[] => {
    const outTemplate = path.join(outDir, '%(id)s.%(ext)s');
    const args = [
      '--no-playlist',
      // حزام أمان: رابط قائمة صريح لا يجب أن ينزّل أكثر من عنصر واحد
      '--playlist-items',
      '1',
      '--newline',
      // --print يجعل yt-dlp صامتًا؛ --progress يُعيد شريط التقدّم رغم ذلك
      '--progress',
      '--no-warnings',
      '--no-mtime',
      '--restrict-filenames',
      '--concurrent-fragments',
      '4',
      '-f',
      fmt,
      '-o',
      outTemplate,
      '--progress-template',
      'PROGRESS:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
    ];
    if (flags.has('--print')) args.push('--print', 'after_move:FILEPATH:%(filepath)s');
    if (flags.has('--no-simulate')) args.push('--no-simulate');
    // ffmpeg المهيّأ في ./bin ليس في PATH، وyt-dlp لا يعرف مكانه إلا بهذا العلم.
    const ffmpegPath = ffmpegBin();
    if (path.isAbsolute(ffmpegPath) || ffmpegPath.includes('/') || ffmpegPath.includes('\\')) {
      args.push('--ffmpeg-location', ffmpegPath);
    }
    args.push(...commonArgs(withCookies), ...opt, ...extra, '--', url);
    return args;
  };

  const runOnce = (args: string[]): Promise<DownloadResult> => new Promise<DownloadResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(bin, args, { shell: false, windowsHide: true });
    } catch (e) {
      reject(new YtdlpUnavailableError(`تعذّر تشغيل yt-dlp: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }

    let finalPath = '';
    let stderr = '';
    let lastActivity = Date.now();
    let stalled = false;
    let settled = false;
    // التحميل المدمج يمرّ بمرحلتين (فيديو ثم صوت) فيعود التقدّم للصفر — نُبقيه تصاعديًّا.
    let lastPercent = 0;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      opts.signal?.removeEventListener('abort', onAbort);
      rl.close();
      fn();
    };

    const onAbort = (): void => {
      killTree(child);
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    // حارس التوقّف: yt-dlp قد يعلّق بلا نهاية (بثّ مباشر/شبكة ميتة) فتبقى المهمة عالقة.
    // لا نقتل إلا عند انعدام أي إخراج لمدة stallTimeoutMs (الدمج الطويل يطبع تقدّمًا).
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > cfg.tools.stallTimeoutMs) {
        stalled = true;
        killTree(child);
      }
    }, Math.max(5_000, Math.min(15_000, Math.floor(cfg.tools.stallTimeoutMs / 4))));

    const rl = readline.createInterface({ input: child.stdout! });

    /**
     * ملاحظة مهمّة: عند استخدام --print يُحوِّل yt-dlp كلّ رسائل التقدّم (بما فيها
     * --progress-template) إلى stderr كي يبقى stdout نظيفًا للقيم المطبوعة فقط.
     * لذلك نحلّل الأسطر من القناتين، وإلا لا يتحرّك شريط التقدّم أبدًا.
     */
    const handleLine = (line: string): void => {
      lastActivity = Date.now();
      if (line.startsWith('PROGRESS:')) {
        const parts = line.slice('PROGRESS:'.length).split('|');
        const num = (s: string | undefined): number | undefined => {
          if (!s || s === 'NA' || s === 'None' || s === 'N/A') return undefined;
          const n = Number(s);
          return Number.isFinite(n) ? n : undefined;
        };
        const downloaded = num(parts[0]);
        const total = num(parts[1]) ?? num(parts[2]);
        const speed = num(parts[3]);
        const eta = num(parts[4]);
        let percent: number | undefined;
        if (downloaded !== undefined && total) {
          lastPercent = Math.max(lastPercent, Math.min(99, (downloaded / total) * 100));
          percent = lastPercent;
        }
        opts.onProgress?.({ downloadedBytes: downloaded, totalBytes: total, speed, eta, percent });
        return;
      }
      if (line.startsWith('FILEPATH:')) {
        finalPath = line.slice('FILEPATH:'.length).trim();
        return;
      }
      // احتياط للنسخ التي لا تدعم --progress-template
      const m = /^\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+)\s*([KMGTP]i?B)/i.exec(line);
      if (m) {
        lastPercent = Math.max(lastPercent, Math.min(99, Number(m[1])));
        const total = parseSize(m[2], m[3]);
        opts.onProgress?.({ totalBytes: total, percent: lastPercent });
      }
    };
    rl.on('line', handleLine);

    let stderrTail = '';
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      lastActivity = Date.now();
      stderr += text;
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000);
      stderrTail += text;
      let nl = stderrTail.indexOf('\n');
      while (nl !== -1) {
        const line = stderrTail.slice(0, nl).replace(/\r$/, '');
        stderrTail = stderrTail.slice(nl + 1);
        handleLine(line);
        nl = stderrTail.indexOf('\n');
      }
      if (stderrTail.length > 8192) stderrTail = stderrTail.slice(-8192);
    });

    child.on('error', (err) => {
      finish(() => {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          binCache = null;
          reject(new YtdlpUnavailableError('اختفى ملفّ yt-dlp أو ليس قابلًا للتنفيذ — أعد تثبيته بـ «npm run ytdlp:update».'));
        } else {
          reject(new Error(`تعذّر تشغيل yt-dlp: ${err.message}`));
        }
      });
    });

    child.on('close', (code) => {
      void (async () => {
        try {
          if (opts.signal?.aborted) throw new Error('أُلغي التحميل');
          if (stalled) {
            throw new Error('توقّف yt-dlp عن إرسال أي تقدّم لمدّة طويلة وأُنهي — أعد المحاولة أو تحقّق من الشبكة.');
          }
          if (code !== 0) {
            const c = classifyDownloadError(stderr, code, cookiesInfo().present, hasFfmpeg);
            throw c.permanent ? new YtdlpPermanentError(c.message) : new Error(c.message);
          }

          let produced = finalPath;
          if (produced) {
            const resolved = path.resolve(produced);
            // لا نثق بمسار قادم من الخارج: يجب أن يبقى داخل مجلّد العمل.
            produced = resolved.startsWith(outDir + path.sep) ? resolved : '';
          }
          if (!produced) produced = (await findProducedFile(outDir)) ?? '';
          if (!produced) {
            throw new YtdlpPermanentError(
              'انتهى yt-dlp بلا ملفّ ناتج — قد يكون البثّ مباشرًا أو المحتوى مقيّدًا. ' +
                `التفاصيل: ${stderr.trim().slice(-300) || 'لا شيء'}`,
            );
          }
          try {
            if (statSync(produced).size === 0) throw new Error('empty');
          } catch {
            throw new Error('الملفّ الناتج غير موجود أو فارغ.');
          }
          finish(() => resolve({ filePath: produced }));
        } catch (e) {
          finish(() => reject(e));
        }
      })();
    });
  });

  try {
    return await runOnce(buildArgs(true, []));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // YouTube من عناوين مراكز البيانات قد يرفض روابط التشغيل (403) أو يطلب تحقّقًا.
    // نعيد بعميل آخر بلا كوكيز (المسار المفضّل عند غياب/انتهاء الكوكيز).
    if (opts.signal?.aborted || !isYouTubeUrl(url) || !isAuthOrFormatFailure(message)) throw e;
    getLogger().warn({ err: message }, 'فشل تحميل YouTube — إعادة المحاولة بعميل بديل بلا كوكيز');
    const hadCookies = usableFile(cookiesFilePath());
    try {
      return await runOnce(buildArgs(false, YOUTUBE_FALLBACK_ARGS));
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      // إن كانت الكوكيز موجودة وأخطأ العميل البديل، نجرّبها معه (قد تكون لازمة للمحتوى المقيّد)
      if (opts.signal?.aborted || !hadCookies || !isAuthOrFormatFailure(fallbackMessage)) throw fallbackError;
      getLogger().warn({ err: fallbackMessage }, 'تعذّر البديل بلا كوكيز — إعادة المحاولة بالكوكيز');
      return await runOnce(buildArgs(true, YOUTUBE_FALLBACK_ARGS));
    }
  }
}

export async function version(): Promise<string | null> {
  const bin = await resolveYtdlp();
  if (!bin) return null;
  try {
    const { stdout, code } = await runCapture(bin, ['--version'], { timeoutMs: 10_000 });
    return code === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
}

/** يُعيد تشغيل provisioners لإعادة تثبيت الأدوات (يُستخدم حين يفشل التحديث الذاتي). */
async function reinstallTools(): Promise<{ ok: boolean; message: string; path?: string }> {
  const script = path.resolve(process.cwd(), 'scripts', 'provision.mjs');
  if (!existsSync(script)) return { ok: false, message: 'سكربت التثبيت scripts/provision.mjs غير موجود.' };
  try {
    const { stdout, stderr, code } = await runCapture(process.execPath, [script], {
      timeoutMs: 300_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, YTDLP_FORCE: '1' },
    });
    binCache = null;
    capsCache = null;
    resetFfmpegCache();
    const bin = await resolveYtdlp();
    const detail = `${stdout}\n${stderr}`.trim().split(/\r?\n/).slice(-3).join(' | ').slice(-400);
    if (code === 0 && bin) return { ok: true, message: `أُعيد تثبيت yt-dlp بنجاح. ${detail}`, path: bin };
    return { ok: false, message: `فشل إعادة التثبيت (رمز ${code}). ${detail}` };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

export async function update(): Promise<{ ok: boolean; message: string; path?: string }> {
  const bin = await resolveYtdlp();
  if (!bin) return reinstallTools();
  try {
    const { stdout, stderr, code } = await runCapture(bin, ['-U'], { timeoutMs: 180_000 });
    if (code === 0) {
      binCache = null;
      capsCache = null;
      return { ok: true, message: (stdout + stderr).trim().slice(-500), path: bin };
    }
  } catch {
    /* النسخ المستقلّة/غير القابلة للكتابة لا تدعم -U ⇒ نعيد التثبيت */
  }
  return reinstallTools();
}
