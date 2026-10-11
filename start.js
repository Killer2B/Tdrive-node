// مشغّل بيئة Node المغلقة (HidenCloud/Pterodactyl). اضبط في اللوحة: MAIN_FILE = start.js
// ينتهي بـ .js حتى تشغّله اللوحة بـ `node` (لا ts-node). يهيّئ الأدوات ثم يشغّل الخادم من
// TypeScript عبر تجريد الأنواع في Node (بلا بناء)، ويضيف أعلام node:sqlite/strip عند اللزوم.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { provision } from './scripts/provision.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, 'src', 'index.ts');
const BIN = path.resolve(process.cwd(), 'bin');

const [major, minor] = process.versions.node.split('.').map((n) => Number(n));
if (major < 22 || (major === 22 && minor < 6)) {
  process.stderr.write(
    `\n[start] إصدار Node ${process.versions.node} غير مدعوم. اختر Node 24 (مفضّل) أو 22.6+ في اللوحة.\n\n`,
  );
  process.exit(1);
}

// هل يحتاج node:sqlite علمًا تجريبيًّا على هذا الإصدار؟ (نكتشفه بمحاولة التحميل)
let needSqliteFlag = false;
try {
  require('node:sqlite');
} catch {
  needSqliteFlag = true;
}

async function main() {
  try {
    await provision();
  } catch (e) {
    process.stderr.write(`[start] تحذير: فشلت تهيئة الأدوات: ${String(e)}\n`);
  }

  const exe = process.platform === 'win32' ? '.exe' : '';
  const ytd = path.join(BIN, `yt-dlp${exe}`);
  const ff = path.join(BIN, 'ffmpeg');
  const fp = path.join(BIN, 'ffprobe');
  if (existsSync(ytd)) process.env.YTDLP_PATH ??= ytd;
  if (existsSync(ff)) process.env.FFMPEG_PATH ??= ff;
  if (existsSync(fp)) process.env.FFPROBE_PATH ??= fp;

  const flags = ['--disable-warning=ExperimentalWarning'];
  if (major < 24) flags.push('--experimental-strip-types'); // 23.6+ يجرّد افتراضيًّا
  if (needSqliteFlag) flags.push('--experimental-sqlite');

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
