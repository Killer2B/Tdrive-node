/** غلاف ffmpeg/ffprobe: فحص الوسائط وتوليد الصور المصغّرة. */
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

let ffmpegOk: boolean | null = null;

export async function ffmpegAvailable(): Promise<boolean> {
  if (ffmpegOk !== null) return ffmpegOk;
  const cfg = loadConfig();
  ffmpegOk = (await commandExists(cfg.tools.ffmpegPath, '-version')) && (await commandExists(cfg.tools.ffprobePath, '-version'));
  return ffmpegOk;
}

/** يفحص ملف وسائط عبر ffprobe ويعيد المدّة والأبعاد والترميز. */
export async function probeMedia(filePath: string): Promise<MediaInfo> {
  const cfg = loadConfig();
  try {
    const { stdout, code } = await runCapture(
      cfg.tools.ffprobePath,
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
  const cfg = loadConfig();
  if (!(await ffmpegAvailable())) return false;
  try {
    const { code } = await runCapture(
      cfg.tools.ffmpegPath,
      [
        '-y',
        '-ss', String(Math.max(0, atSec)),
        '-i', inputPath,
        '-frames:v', '1',
        '-vf', "scale='min(640,iw)':-2",
        '-q:v', '4',
        '--',
        outputPath,
      ].filter((a) => a !== '--'),
      { timeoutMs: 60_000 },
    );
    return code === 0;
  } catch {
    return false;
  }
}
