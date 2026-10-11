// تنزيل أحدث yt-dlp إلى ./bin (بلا تبعيات). الاستخدام: node scripts/update-ytdlp.mjs
// ثم اضبط YTDLP_PATH في .env على المسار المطبوع.
import { mkdirSync, createWriteStream, chmodSync } from 'node:fs';
import { get } from 'node:https';
import path from 'node:path';
import process from 'node:process';

const isWin = process.platform === 'win32';
const asset = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
const binDir = path.resolve('bin');
const dest = path.join(binDir, asset);

mkdirSync(binDir, { recursive: true });

function download(fromUrl, redirects = 0) {
  if (redirects > 5) {
    console.error('تجاوز عدد عمليات إعادة التوجيه.');
    process.exit(1);
  }
  get(fromUrl, { headers: { 'user-agent': 'tdrive-updater' } }, (res) => {
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      download(new URL(res.headers.location, fromUrl).toString(), redirects + 1);
      return;
    }
    if (res.statusCode !== 200) {
      console.error(`فشل التنزيل: HTTP ${res.statusCode}`);
      process.exit(1);
    }
    const out = createWriteStream(dest);
    res.pipe(out);
    out.on('finish', () => {
      out.close();
      if (!isWin) chmodSync(dest, 0o755);
      console.log(`تمّ تنزيل yt-dlp إلى: ${dest}`);
      console.log(`اضبط في .env:\n  YTDLP_PATH=${dest.replace(/\\/g, '/')}`);
    });
  }).on('error', (e) => {
    console.error('خطأ شبكة:', e.message);
    process.exit(1);
  });
}

console.log(`تنزيل ${asset} من يوتيوب-dlp ...`);
download(url);
