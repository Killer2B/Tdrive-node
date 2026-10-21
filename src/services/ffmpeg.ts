/** غلاف ffmpeg/ffprobe: فحص الوسائط وتوليد الصور المصغّرة. */
import path from 'node:path';
import { statSync } from 'node:fs';
import { runCapture, commandExists } from '../lib/spawn.ts';
import { loadConfig } from '../config/env.ts';
import { getLogger } from '../lib/logger.ts';

export interface MediaInfo {
  durationSec?: number;
  width?: number;
  height?: number;
  vcodec?: string;
  acodec?: string;
}

const EXE = process.platform === 'win32' ? '.exe' : '';
let ffmpegOk: boolean | null = null;

/** ملفّ موجود وحجمه أكبر من صفر. */
function usable(file: string): boolean {
  try {
    return statSync(file).isFile() && statSync(file).size > 0;
  } catch {
    return false;
  }
}

/**
 * يحلّ أداة خارجية: المسار المضبوط إن كان مسارًا حقيقيًّا، ثم ./bin (ما يهيّئه provision)،
 * ثم الاسم المجرّد ليُبحث عنه في PATH. هذا ما يجعل التثبيت التلقائي في ./bin فعّالًا
 * دون تعديل .env.
 */
function resolveTool(configured: string, name: string): string {
  const value = configured.trim() || name;
  if (path.isAbsolute(value) || value.includes('/') || value.includes('\\')) return value;
  const local = path.resolve(process.cwd(), 'bin', `${name}${EXE}`);
  return usable(local) ? local : value;
}

export function ffmpegBin(): string {
  return resolveTool(loadConfig().tools.ffmpegPath, 'ffmpeg');
}

export function ffprobeBin(): string {
  return resolveTool(loadConfig().tools.ffprobePath, 'ffprobe');
}

/** يُبطل الذاكرة المخبّأة (بعد تثبيت/تحديث ffmpeg في وقت التشغيل). */
export function resetFfmpegCache(): void {
  ffmpegOk = null;
}

export async function ffmpegAvailable(): Promise<boolean> {
  if (ffmpegOk !== null) return ffmpegOk;
  // الدمج والصور المصغّرة يحتاجان ffmpeg فقط؛ ffprobe مطلوب لفحص الوسائط (ويُعالَج فشله بأمان).
  ffmpegOk = await commandExists(ffmpegBin(), '-version');
  return ffmpegOk;
}

/** يفحص ملف وسائط عبر ffprobe ويعيد المدّة والأبعاد والترميز. */
export async function probeMedia(filePath: string): Promise<MediaInfo> {
  try {
    const { stdout, code } = await runCapture(
      ffprobeBin(),
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '--', filePath],
      { timeoutMs: 30_000 },
    );
    if (code !== 0) return {};
    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
    };
    const video = data.streams?.find((s) => s.codec_type === 'video');
    const audio = data.streams?.find((s) => s.codec_type === 'audio');
    return {
      durationSec: data.format?.duration ? Number(data.format.duration) : undefined,
      width: video?.width,
      height: video?.height,
      vcodec: video?.codec_name,
      acodec: audio?.codec_name,
    };
  } catch (e) {
    getLogger().debug({ err: String(e) }, 'ffprobe فشل');
    return {};
  }
}

/** يولّد صورة مصغّرة JPG من الفيديو عند ثانية محدّدة. يعيد true عند النجاح. */
export async function generateThumbnail(inputPath: string, outputPath: string, atSec = 1): Promise<boolean> {
  if (!(await ffmpegAvailable())) return false;
  try {
    const { code } = await runCapture(
      ffmpegBin(),
      [
        '-y',
        '-ss', String(Math.max(0, atSec)),
        '-i', inputPath,
        '-frames:v', '1',
        '-vf', "scale='min(640,iw)':-2",
        '-q:v', '4',
        outputPath,
      ],
      { timeoutMs: 60_000 },
    );
    return code === 0;
  } catch {
    return false;
  }
}
