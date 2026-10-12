/** غلاف yt-dlp: المعاينة (metadata)، التحميل مع تقدّم لحظي، النسخة والتحديث. */
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { runCapture } from '../lib/spawn.ts';
import { loadConfig } from '../config/env.ts';
import { ffmpegAvailable } from './ffmpeg.ts';

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
  title?: string;
  duration?: number;
  thumbnail?: string;
  uploader?: string;
  extractor?: string;
  is_live?: boolean;
  formats?: RawFormat[];
}

/** مسار ملف كوكيز YouTube: من الإعداد YTDLP_COOKIES أو الافتراضيّ ./data/cookies.txt. */
export function cookiesFilePath(): string {
  const cfg = loadConfig();
  return cfg.tools.cookies ?? path.resolve(process.cwd(), 'data', 'cookies.txt');
}

/** وسائط مشتركة: كوكيز YouTube (لتجاوز فحص الروبوت على الخوادم) + وسائط إضافية من الإعداد. */
function commonArgs(): string[] {
  const cfg = loadConfig();
  const a: string[] = [];
  const cookies = cookiesFilePath();
  if (existsSync(cookies)) a.push('--cookies', cookies);
  if (cfg.tools.extraArgs.length) a.push(...cfg.tools.extraArgs);
  return a;
}

/** يجلب بيانات الرابط الوصفية (عنوان/مدّة/جودات) دون تنزيل. */
export async function probe(url: string, signal?: AbortSignal): Promise<YtProbe> {
  const cfg = loadConfig();
  const { stdout, code, stderr } = await runCapture(
    cfg.tools.ytdlpPath,
    ['-J', '--no-playlist', '--no-warnings', ...commonArgs(), '--', url],
    { timeoutMs: 15_000, signal },
  );
  if (code !== 0) {
    const hint = /Sign in to confirm|not a bot|cookies/i.test(stderr)
      ? ' (يوتيوب يطلب تأكيد الحساب على هذا الخادم — أضف ملف كوكيز عبر YTDLP_COOKIES)'
      : '';
    throw new Error(`yt-dlp فشل في قراءة الرابط${hint}: ${stderr.slice(0, 500)}`);
  }
  const info = JSON.parse(stdout) as RawInfo;

  const qualities: YtQuality[] = [];
  const seen = new Set<string>();
  const videoFormats = (info.formats ?? [])
    .filter((f) => f.vcodec && f.vcodec !== 'none' && f.height)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
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
  // خيار افتراضي "أفضل جودة"
  qualities.unshift({ id: 'best', label: 'أفضل جودة', ext: info.formats?.[0]?.ext ?? 'mp4' });

  return {
    title: info.title ?? 'بدون عنوان',
    durationSec: info.duration,
    thumbnail: info.thumbnail,
    uploader: info.uploader,
    extractor: info.extractor,
    isLive: info.is_live,
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

/** يختار تعبير التنسيق المناسب حسب توفّر ffmpeg (الدمج يتطلّب ffmpeg). */
async function formatExpr(formatId?: string): Promise<string> {
  if (formatId && formatId !== 'best') {
    return (await ffmpegAvailable()) ? `${formatId}+ba/b` : formatId;
  }
  return (await ffmpegAvailable()) ? 'bv*+ba/b' : 'b';
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
  const fmt = await formatExpr(opts.formatId);
  const outTemplate = path.join(opts.outDir, '%(id)s.%(ext)s');

  const args = [
    '--no-playlist',
    '--newline',
    '--no-warnings',
    '--restrict-filenames',
    '--no-mtime',
    '-f', fmt,
    '-o', outTemplate,
    '--progress-template',
    'PROGRESS:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
    '--print', 'after_move:FILEPATH:%(filepath)s',
  ];
  if (cfg.tools.ffmpegPath && cfg.tools.ffmpegPath !== 'ffmpeg') {
    args.push('--ffmpeg-location', cfg.tools.ffmpegPath);
  }
  args.push(...commonArgs());
  args.push('--', url);

  return new Promise<DownloadResult>((resolve, reject) => {
    const child = spawn(cfg.tools.ytdlpPath, args, { shell: false, windowsHide: true });
    let finalPath = '';
    let stderr = '';

    const onAbort = (): void => child.kill('SIGKILL');
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (line.startsWith('PROGRESS:')) {
        const parts = line.slice('PROGRESS:'.length).split('|');
        const num = (s: string | undefined): number | undefined => {
          if (!s || s === 'NA') return undefined;
          const n = Number(s);
          return Number.isFinite(n) ? n : undefined;
        };
        const downloaded = num(parts[0]);
        const total = num(parts[1]) ?? num(parts[2]);
        const speed = num(parts[3]);
        const eta = num(parts[4]);
        const percent = downloaded && total ? Math.min(99, (downloaded / total) * 100) : undefined;
        opts.onProgress?.({ downloadedBytes: downloaded, totalBytes: total, speed, eta, percent });
      } else if (line.startsWith('FILEPATH:')) {
        finalPath = line.slice('FILEPATH:'.length).trim();
      }
    });

    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000);
    });

    child.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', async (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      rl.close();
      if (opts.signal?.aborted) return reject(new Error('أُلغي التحميل'));
      if (code !== 0) {
        const msg = /Sign in to confirm|not a bot/i.test(stderr)
          ? 'يوتيوب يطلب تأكيد الحساب على هذا الخادم. أضف ملف كوكيز عبر YTDLP_COOKIES ثم أعد المحاولة.'
          : /DRM|protected|unavailable|Private video|members-only|Sign in/i.test(stderr)
            ? 'تعذّر التحميل: المحتوى محميّ (DRM) أو خاص أو غير متاح.'
            : `فشل التحميل (رمز ${code}). ${stderr.slice(-300)}`;
        return reject(new Error(msg));
      }
      if (!finalPath) {
        // محاولة أخيرة: ابحث عن أحدث ملف في المجلّد
        try {
          const files = await readdir(opts.outDir);
          if (files.length === 1) finalPath = path.join(opts.outDir, files[0]);
        } catch {
          /* تجاهل */
        }
      }
      if (!finalPath) return reject(new Error('تعذّر تحديد مسار الملف الناتج'));
      resolve({ filePath: finalPath });
    });
  });
}

export async function version(): Promise<string | null> {
  const cfg = loadConfig();
  try {
    const { stdout, code } = await runCapture(cfg.tools.ytdlpPath, ['--version'], { timeoutMs: 10_000 });
    return code === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
}

export async function update(): Promise<{ ok: boolean; message: string }> {
  const cfg = loadConfig();
  try {
    const { stdout, stderr, code } = await runCapture(cfg.tools.ytdlpPath, ['-U'], { timeoutMs: 120_000 });
    return { ok: code === 0, message: (stdout + stderr).trim().slice(-500) };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}
