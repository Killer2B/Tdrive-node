// مشغّل بيئة Node المغلقة (HidenCloud/Pterodactyl): يهيّئ الأدوات ثم يشغّل الخادم من TypeScript
// مباشرةً عبر تجريد الأنواع في Node (بلا خطوة بناء). الأمر في اللوحة: node start.mjs
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { provision } from './scripts/provision.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, 'src', 'index.ts');
const BIN = path.resolve(process.cwd(), 'bin');

const [major, minor] = process.versions.node.split('.').map((n) => Number(n));
if (major < 22 || (major === 22 && minor < 6)) {
  process.stderr.write(
    `\n[start] إصدار Node ${process.versions.node} غير مدعوم. اختر Node 24 (مفضّل) أو 22.6+ في لوحة الاستضافة.\n\n`,
  );
  process.exit(1);
}

async function main() {
  // تهيئة yt-dlp/ffmpeg داخل ./bin (idempotent)
  try {
    await provision();
  } catch (e) {
    process.stderr.write(`[start] تحذير: فشلت تهيئة الأدوات: ${String(e)}\n`);
  }

  // وجّه التطبيق إلى الثنائيّات المحلّية إن وُجدت (دون تجاوز قيم مضبوطة صراحةً)
  const exe = process.platform === 'win32' ? '.exe' : '';
  const ytd = path.join(BIN, `yt-dlp${exe}`);
  const ff = path.join(BIN, 'ffmpeg');
  const fp = path.join(BIN, 'ffprobe');
  if (existsSync(ytd)) process.env.YTDLP_PATH ??= ytd;
  if (existsSync(ff)) process.env.FFMPEG_PATH ??= ff;
  if (existsSync(fp)) process.env.FFPROBE_PATH ??= fp;

  // أعلام حسب إصدار Node: 24+ يجرّد الأنواع ويدعم node:sqlite افتراضيًّا
  const flags = ['--disable-warning=ExperimentalWarning'];
  if (major < 24) flags.push('--experimental-strip-types', '--experimental-sqlite');

  const child = spawn(process.execPath, [...flags, entry], { stdio: 'inherit', env: process.env });

  const forward = (sig) => {
    try {
      child.kill(sig);
    } catch {
      /* تجاهل */
    }
  };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

main();
