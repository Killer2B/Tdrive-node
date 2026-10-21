// تهيئة الأدوات الخارجية (yt-dlp + ffmpeg) داخل ./bin لبيئات Node المغلقة (بلا apt/root).
// idempotent: يتخطّى ما هو موجود. يُستدعى من scripts/launch.mjs أو: node scripts/provision.mjs
import { createWriteStream, existsSync, mkdirSync, statSync, chmodSync, copyFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { get } from 'node:https';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve(process.cwd(), 'bin');
const isWin = process.platform === 'win32';
const EXE = isWin ? '.exe' : '';
const FORCE = process.env.YTDLP_FORCE === '1' || process.argv.includes('--force');
// أقلّ من ذلك يعني تنزيلًا فاشلًا/تالفًا (الملفّ الحقيقي عشرات الميغابايت)
const MIN_BINARY_BYTES = 1024 * 1024;

function log(msg) {
  process.stdout.write(`[provision] ${msg}\n`);
}

let powerShellCache;
function findPowerShell() {
  if (process.platform !== 'win32') return null;
  if (powerShellCache !== undefined) return powerShellCache;
  const probe = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], {
    stdio: 'ignore',
  });
  powerShellCache = probe.status === 0 ? 'powershell' : null;
  return powerShellCache;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const run = (u, redirects) => {
      if (redirects > 6) return reject(new Error('too many redirects'));
      const req = get(u, { headers: { 'user-agent': 'tdrive-provision' }, timeout: 60_000 }, (res) => {
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
      });
      req.on('timeout', () => req.destroy(new Error('network timeout')));
      req.on('error', reject);
    };
    run(url, 0);
  });
}

function ytDlpAsset() {
  if (isWin) return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'linux') {
    if (process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (process.arch === 'arm') return 'yt-dlp_linux_armv7l';
    return 'yt-dlp_linux';
  }
  return null;
}

async function provisionYtDlp() {
  const dest = path.join(BIN, `yt-dlp${EXE}`);
  const current = existsSync(dest) ? statSync(dest).size : 0;
  if (!FORCE && current >= MIN_BINARY_BYTES) {
    log(`yt-dlp موجود مسبقًا: ${dest}`);
    return dest;
  }
  if (current > 0 && current < MIN_BINARY_BYTES) {
    log(`ملفّ yt-dlp تالف (${current} بايت) — يُعاد تنزيله`);
    rmSync(dest, { force: true });
  }
  const asset = ytDlpAsset();
  if (!asset) {
    log(`لا توجد نسخة yt-dlp جاهزة لـ ${process.platform}/${process.arch}`);
    return null;
  }
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
  const tmp = `${dest}.part`;
  log(`تنزيل yt-dlp (${asset}) ...`);
  rmSync(tmp, { force: true });
  await download(url, tmp);
  if (!existsSync(tmp) || statSync(tmp).size < MIN_BINARY_BYTES) {
    rmSync(tmp, { force: true });
    throw new Error('الملفّ المنزّل صغير جدًّا/تالف');
  }
  if (!isWin) chmodSync(tmp, 0o755);
  rmSync(dest, { force: true });
  renameSync(tmp, dest);
  log(`yt-dlp جاهز: ${dest}`);
  return dest;
}

/** مصدر ffmpeg الثابت حسب النظام (المصادر الرسمية: johnvansickle على Linux، gyan على Windows). */
function ffmpegSource() {
  if (process.platform === 'linux') {
    const asset =
      process.arch === 'arm64'
        ? 'ffmpeg-release-arm64-static.tar.xz'
        : process.arch === 'x64'
          ? 'ffmpeg-release-amd64-static.tar.xz'
          : null;
    if (!asset) return null;
    return { asset, kind: 'tar', url: `https://johnvansickle.com/ffmpeg/releases/${asset}` };
  }
  if (process.platform === 'win32') {
    return {
      asset: 'ffmpeg-release-essentials.zip',
      kind: 'zip',
      url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    };
  }
  return null; // macOS: ثبّت عبر brew
}

/** يبحث recursively عن ملف باسم محدّد. */
function findFile(root, name) {
  const stack = [root];
  const wanted = name.toLowerCase();
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === wanted) return full;
    }
  }
  return null;
}

async function provisionFfmpeg() {
  const ffmpeg = path.join(BIN, `ffmpeg${EXE}`);
  const ffprobe = path.join(BIN, `ffprobe${EXE}`);
  if (!FORCE && existsSync(ffmpeg) && existsSync(ffprobe)) {
    log('ffmpeg موجود مسبقًا');
    return { ffmpeg, ffprobe };
  }
  const source = ffmpegSource();
  if (!source) {
    log(`تخطّي ffmpeg (غير مدعوم تلقائيًّا لـ ${process.platform}/${process.arch}) — ثبّته يدويًّا لتفعيل الدمج/الصور المصغّرة`);
    return { ffmpeg: null, ffprobe: null };
  }
  if (source.kind === 'tar' && spawnSync('tar', ['--version'], { stdio: 'ignore' }).status !== 0) {
    log('tar غير متوفّر — تخطّي ffmpeg');
    return { ffmpeg: null, ffprobe: null };
  }
  if (source.kind === 'zip' && !findPowerShell()) {
    log('PowerShell غير متوفّر لفكّ ضغط ffmpeg — تخطّي ffmpeg');
    return { ffmpeg: null, ffprobe: null };
  }

  const tmp = path.join(os.tmpdir(), `ffmpeg-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const archive = path.join(tmp, source.asset);
  try {
    log(`تنزيل ffmpeg (${source.asset}) — قد يستغرق دقائق أوّل مرّة ...`);
    await download(source.url, archive);
    if (!existsSync(archive) || statSync(archive).size < 1024 * 1024) throw new Error('الأرشيف المنزّل تالف');

    if (source.kind === 'tar') {
      const ex = spawnSync('tar', ['-xf', archive, '-C', tmp], { stdio: 'ignore' });
      if (ex.status !== 0) throw new Error('فشل استخراج tar (xz غير مدعوم؟)');
    } else {
      const ex = spawnSync(
        findPowerShell(),
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`,
        ],
        { stdio: 'ignore' },
      );
      if (ex.status !== 0) throw new Error('فشل Expand-Archive');
    }

    const srcFfmpeg = findFile(tmp, `ffmpeg${EXE}`);
    const srcFfprobe = findFile(tmp, `ffprobe${EXE}`);
    if (!srcFfmpeg || !srcFfprobe) throw new Error('لم يُعثر على ffmpeg/ffprobe بعد الاستخراج');
    copyFileSync(srcFfmpeg, ffmpeg);
    copyFileSync(srcFfprobe, ffprobe);
    if (!isWin) {
      chmodSync(ffmpeg, 0o755);
      chmodSync(ffprobe, 0o755);
    }
    log(`ffmpeg جاهز: ${ffmpeg}`);
    return { ffmpeg, ffprobe };
  } catch (e) {
    log(`تعذّر تهيئة ffmpeg: ${e.message} — التطبيق يعمل بدونه (بلا دمج/صور مصغّرة)`);
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
