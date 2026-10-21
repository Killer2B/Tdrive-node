// تنزيل/تحديث yt-dlp المستقل إلى ./bin (بلا تبعيات).
// الاستخدام: node scripts/update-ytdlp.mjs [--force]
// - يختار الملف التنفيذي المستقل الصحيح للنظام/المعمارية (لا zipapp يحتاج Python).
// - يُنزّل إلى ملفّ مؤقّت ثم يبدّله ذرّيًّا، فلا يبقى ملفّ ناقص عند انقطاع الشبكة.
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { get } from 'node:https';
import path from 'node:path';
import process from 'node:process';

const force = process.argv.includes('--force') || process.env.YTDLP_FORCE === '1';
const isWin = process.platform === 'win32';
const exe = isWin ? '.exe' : '';

function assetName() {
  if (isWin) return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'linux') {
    if (process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (process.arch === 'arm') return 'yt-dlp_linux_armv7l';
    return 'yt-dlp_linux';
  }
  return null;
}

const asset = assetName();
if (!asset) {
  console.error(`لا توجد نسخة yt-dlp مستقلّة لـ ${process.platform}/${process.arch}.`);
  console.error('ثبّت yt-dlp يدويًّا ثم اضبط YTDLP_PATH على مساره.');
  process.exit(1);
}

const binDir = path.resolve('bin');
const dest = path.join(binDir, `yt-dlp${exe}`);
const tmp = `${dest}.part`;
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;

if (!force && existsSync(dest) && statSync(dest).size > 1024) {
  console.log(`yt-dlp موجود مسبقًا: ${dest}`);
  console.log('لإجبار التحديث: node scripts/update-ytdlp.mjs --force');
  process.exit(0);
}

mkdirSync(binDir, { recursive: true });
rmSync(tmp, { force: true });

function download(fromUrl, redirects = 0) {
  if (redirects > 8) throw new Error('عدد عمليات إعادة التوجيه كبير جدًّا');
  return new Promise((resolve, reject) => {
    const req = get(
      fromUrl,
      { headers: { 'user-agent': 'tdrive-updater', accept: 'application/octet-stream' }, timeout: 60_000 },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          download(new URL(res.headers.location, fromUrl).toString(), redirects + 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`فشل التنزيل: HTTP ${status}`));
          return;
        }
        const type = String(res.headers['content-type'] ?? '');
        if (/text\/html/i.test(type)) {
          res.resume();
          reject(new Error('أعاد الخادم صفحة HTML بدل الملف التنفيذي'));
          return;
        }
        const expected = Number(res.headers['content-length'] ?? 0);
        let received = 0;
        const out = createWriteStream(tmp);
        res.on('data', (chunk) => {
          received += chunk.length;
        });
        res.pipe(out);
        out.on('error', reject);
        out.on('finish', () => {
          out.close(() => {
            if (received < 1024) return reject(new Error('الملف المنزّل صغير جدًّا/تالف'));
            if (expected > 0 && received !== expected) {
              return reject(new Error(`تنزيل ناقص (${received}/${expected} بايت)`));
            }
            resolve();
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('انتهت مهلة الشبكة')));
    req.on('error', reject);
  });
}

console.log(`تنزيل ${asset} (${process.platform}/${process.arch}) …`);
download(url)
  .then(() => {
    if (!isWin) chmodSync(tmp, 0o755);
    // على Windows قد يفشل الاستبدال إن كان الملف قيد التشغيل
    try {
      renameSync(tmp, dest);
    } catch (e) {
      throw new Error(
        `تعذّر استبدال ${dest} (قد يكون yt-dlp قيد التشغيل — أوقف الخادم وأعد المحاولة): ${e.message}`,
      );
    }
    console.log(`تمّ تثبيت yt-dlp في: ${dest}`);
    console.log('أعد تشغيل الخادم، أو اضبط في .env:');
    console.log(`  YTDLP_PATH=${dest.replace(/\\/g, '/')}`);
  })
  .catch((e) => {
    rmSync(tmp, { force: true });
    console.error(`فشل التحديث: ${e.message}`);
    process.exit(1);
  });
