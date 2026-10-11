// تهيئة الأدوات الخارجية (yt-dlp + ffmpeg) داخل ./bin لبيئات Node المغلقة (بلا apt/root).
// idempotent: يتخطّى ما هو موجود. يُستدعى من scripts/launch.mjs أو: node scripts/provision.mjs
import { createWriteStream, existsSync, mkdirSync, statSync, chmodSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { get } from 'node:https';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve(process.cwd(), 'bin');
const isWin = process.platform === 'win32';
const EXE = isWin ? '.exe' : '';

function log(msg) {
  process.stdout.write(`[provision] ${msg}\n`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const run = (u, redirects) => {
      if (redirects > 6) return reject(new Error('too many redirects'));
      get(u, { headers: { 'user-agent': 'tdrive-provision' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return run(new URL(res.headers.location, u).toString(), redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const out = createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve()));
        out.on('error', reject);
      }).on('error', reject);
    };
    run(url, 0);
  });
}

function ytDlpAsset() {
  if (isWin) return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  return null;
}

async function provisionYtDlp() {
  const dest = path.join(BIN, `yt-dlp${EXE}`);
  if (existsSync(dest) && statSync(dest).size > 0) {
    log(`yt-dlp موجود مسبقًا: ${dest}`);
    return dest;
  }
  const asset = ytDlpAsset();
  if (!asset) {
    log(`لا توجد نسخة yt-dlp جاهزة لـ ${process.platform}/${process.arch}`);
    return null;
  }
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
  log(`تنزيل yt-dlp (${asset}) ...`);
  await download(url, dest);
  if (!isWin) chmodSync(dest, 0o755);
  log(`yt-dlp جاهز: ${dest}`);
  return dest;
}

function ffmpegAsset() {
  if (process.platform !== 'linux') return null; // ffmpeg الثابت يُهيّأ على Linux فقط
  if (process.arch === 'arm64') return 'ffmpeg-release-arm64-static.tar.xz';
  if (process.arch === 'x64') return 'ffmpeg-release-amd64-static.tar.xz';
  return null;
}

async function provisionFfmpeg() {
  const ffmpeg = path.join(BIN, 'ffmpeg');
  const ffprobe = path.join(BIN, 'ffprobe');
  if (existsSync(ffmpeg) && existsSync(ffprobe)) {
    log('ffmpeg موجود مسبقًا');
    return { ffmpeg, ffprobe };
  }
  const asset = ffmpegAsset();
  if (!asset) {
    log(`تخطّي ffmpeg (غير مدعوم تلقائيًّا لـ ${process.platform}/${process.arch}) — التطبيق يعمل بدونه`);
    return { ffmpeg: null, ffprobe: null };
  }
  // يتطلّب الاستخراج أداة tar مع دعم xz في الحاوية
  const tarCheck = spawnSync('tar', ['--version'], { stdio: 'ignore' });
  if (tarCheck.status !== 0) {
    log('tar غير متوفّر — تخطّي ffmpeg (التطبيق يعمل بدونه)');
    return { ffmpeg: null, ffprobe: null };
  }
  const tmp = path.join(os.tmpdir(), `ffmpeg-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const archive = path.join(tmp, asset);
  try {
    log(`تنزيل ffmpeg (${asset}) ...`);
    await download(`https://johnvansickle.com/ffmpeg/releases/${asset}`, archive);
    const ex = spawnSync('tar', ['-xf', archive, '-C', tmp], { stdio: 'ignore' });
    if (ex.status !== 0) throw new Error('فشل استخراج tar (xz غير مدعوم؟)');
    const dir = readdirSync(tmp).find((d) => d.startsWith('ffmpeg-') && statSync(path.join(tmp, d)).isDirectory());
    if (!dir) throw new Error('مجلّد ffmpeg غير موجود بعد الاستخراج');
    copyFileSync(path.join(tmp, dir, 'ffmpeg'), ffmpeg);
    copyFileSync(path.join(tmp, dir, 'ffprobe'), ffprobe);
    chmodSync(ffmpeg, 0o755);
    chmodSync(ffprobe, 0o755);
    log(`ffmpeg جاهز: ${ffmpeg}`);
    return { ffmpeg, ffprobe };
  } catch (e) {
    log(`تعذّر تهيئة ffmpeg: ${e.message} — التطبيق يعمل بدونه (بلا صور مصغّرة/دمج)`);
    return { ffmpeg: null, ffprobe: null };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function provision() {
  mkdirSync(BIN, { recursive: true });
  const ytdlp = await provisionYtDlp().catch((e) => {
    log(`تعذّر تهيئة yt-dlp: ${e.message}`);
    return null;
  });
  const { ffmpeg, ffprobe } = await provisionFfmpeg();
  return { ytdlp, ffmpeg, ffprobe };
}

// التشغيل المباشر
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('provision.mjs')) {
  provision().then((r) => log(`انتهى: ${JSON.stringify(r)}`));
}
