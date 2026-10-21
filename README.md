# Tdrive — سحابة تخزين شخصية (نسخة Production بـ Node.js)

سحابة خاصّة بمالك واحد: تُعطيها **رابط يوتيوب** أو **رابط فيديو/ملف مباشر** فتحمّله على
الخادم وتحفظه في تخزينك، وتدعم **الرفع المجزّأ القابل للاستئناف** من جهازك، و**البثّ**
(Range/206)، والتنزيل، وإدارة الملفّات (مجلّدات، إعادة تسمية، حذف/سلّة، بحث، فرز).

الواجهة مبنيّة على تصميم **Vaulta** المرفق في `../Designs` (React + Vite + Tailwind v4)
وموصولة بالـ API الحقيقيّ. الخلفية **Node.js 20+ / Fastify** وقاعدة البيانات **Supabase
(Postgres)** — لا توجد قاعدة بيانات محلّية. التخزين الدائم
والنهائي للمحتوى هو **Telegram** (كل ملف يُقسَّم إلى قطع ≤18MB كمستندات)، والقرص (محوّل التخزين:
محلّي افتراضيًّا، أو S3/R2/MinIO) **مجرّد كاش قابل للإخلاء** أمام Telegram.

## آلية التخزين (Telegram أساسيّ + كاش القرص)
- عند الرفع/التحميل: يُقسَّم المحتوى إلى قطع 18MB (حدّ Telegram getFile = 20MB)، تُسجَّل في
  `file_chunks`، وتُحفَظ أولًا في كاش القرص ثم تُرفَع في الخلفية إلى Telegram (مهمّة «رفع إلى
  التخزين الدائم» بتقدّم SSE، مع تنظيم معدّل `TG_MIN_GAP_MS` ومعالجة flood-wait).
- عند البثّ/التنزيل: تُقرأ القطع اللازمة للنطاق المطلوب من الكاش إن وُجدت، وإلا من Telegram
  (`getFile`) مع إعادة تخزينها في الكاش. دعم `Range` كامل عبر تحديد القطع المتداخلة وتقطيع
  أطرافها فقط (قطعة واحدة في الذاكرة كحدّ أقصى).
- **الكاش يُخلى تلقائيًّا** للقطع المؤكّدة على Telegram عند تجاوز `CACHE_CAP_GB`؛ القطع التي لم
  تُرفَع بعد لا تُخلى أبدًا. الحذف النهائيّ يزيل رسائل Telegram في الخلفية.
- لتعطيل Telegram واستخدام القرص دائمًا: `CONTENT_BACKEND=local` (تبقى القطع في المحوّل دائمًا).

> هذا المشروع إعادة بناء إنتاجية للنموذج الأوّلي في `../webtest` (Cloudflare Worker + Telegram).
> انظر `AUDIT.md` لجرد عيوب النموذج وكيف عولجت، و`CHANGELOG.md` لأهمّ التغييرات.

---

## المزايا
- تحميل من **yt-dlp** (يوتيوب وآلاف المواقع) + **ffmpeg** للدمج والصور المصغّرة، عبر
  `child_process.spawn` بمصفوفة وسائط (لا صدفة — آمن ضدّ حقن الأوامر).
- تحميل الروابط المباشرة عبر `undici` مع **دعم Range والاستئناف** ومهلات.
- **رفع مجزّأ قابل للاستئناف**: `init → part → complete` مع فحص SHA‑256 لكل جزء على الخادم
  وفحص سلامة نهائيّ. حجم الجزء الافتراضي **18MB** (`CHUNK_SIZE_MB`). لا حدّ برمجيّ على حجم
  الملف الكلّي (يحدّه التخزين أو `MAX_FILE_SIZE_GB` اختياريًّا). لا يُقرأ ملف كاملًا في الذاكرة.
- **طابور مهام دائم** في Postgres: تزامن قابل للضبط، إلغاء، وإعادة محاولة بتراجع أسّيّ، يبقى
  بعد إعادة التشغيل.
- **تقدّم لحظيّ** عبر SSE (النسبة/السرعة/الوقت المتبقّي/الحالة).
- **بثّ** بدعم `Range`/`206` الكامل مع `ETag`/`Cache-Control` و`Content-Type` صحيح.
- **أمان**: مصادقة مالك بكلمة مرور `argon2id` + جلسات كوكي `HttpOnly`، حماية **SSRF** (حلّ DNS
  ورفض العناوين الخاصّة وإعادة التحقّق بعد كل Redirect)، تعقيم الأسماء/المسارات، `helmet`،
  `cors`، تقنين الطلبات، وتحقّق المدخلات بـ `zod`.
- **واجهة مطوّرين**: REST API v1 موثّق عبر OpenAPI و[مرجع المطوّرين](./DEVELOPER_API.md)، ومفاتيح API
  قابلة للإنشاء والإلغاء من الإعدادات. يدعم WebDAV في `/dav/` المصادقة بمفتاح API.
- **Supabase (Postgres)**: قاعدة البيانات الوحيدة للتشغيل. المخطّط `tdrive` (14 جدولًا) وسياسات RLS
  مُنشأة ومُطبَّقة عبر **Supabase MCP**، والتطبيق يتّصل بها عبر `SUPABASE_DB_URL` (كل الاستعلامات
  غير متزامنة). استخدم رابط **Session pooler** (`aws-0-<region>.pooler.supabase.com`) لأن الاتصال
  المباشر `db.<ref>.supabase.co` صار IPv6-only في المشاريع الحديثة. التفاصيل في
  [`supabase/README.md`](./supabase/README.md).
- **نسخ احتياطيّ دوريّ** كل 18 ساعة (قابل للضبط) لقاعدة **Postgres** و**قاعدة MySQL خارجية** إلى
  نظام التخزين الداخليّ (مضغوطة) مع سياسة احتفاظ.

---

## المتطلّبات
- **Node.js 20+** (LTS). يعمل أيضًا على إصدارات أحدث.
- **ffmpeg** و**ffprobe** (للدمج والصور المصغّرة) — يُثبَّتان تلقائيًّا في `./bin` عند التشغيل.
- **yt-dlp** (للتحميل من المواقع) — يُثبَّت تلقائيًّا في `./bin` عند التشغيل.
- (اختياريّ) تخزين متوافق مع S3 (R2/MinIO) بدل القرص المحلّي.

لا تحتاج تثبيتًا يدويًّا: `npm run dev` و`npm start` و`start.js` تشغّل `scripts/provision.mjs`
(idempotent) قبل الإقلاع، فيُنزَّل yt-dlp وffmpeg إلى `./bin` ويُستخدمان تلقائيًّا حتى لو لم يكونا في
PATH. لتحديث yt-dlp يدويًّا: `npm run ytdlp:update` (أو `--force`). على Windows بديل: winget.

---

## التثبيت والتشغيل (تطوير)
```bash
# 1) الخلفية
cp .env.example .env            # ثم عدّل القيم (SESSION_SECRET و SUPABASE_DB_URL و OWNER_PASSWORD على الأقل)
npm install
npm run db:migrate              # اختياريّ؛ يتحقّق من مخطّط Supabase (نفس التحقّق يجري عند الإقلاع)
npm run dev                     # يشغّل الخادم على http://localhost:8080

# 2) الواجهة (نافذة أخرى، أثناء التطوير فقط)
cd web
npm install
npm run dev                     # Vite على http://localhost:3000 ويحوّل /api إلى 8080
```

للإنتاج (خادم واحد يقدّم الواجهة والـ API):
```bash
cd web && npm install && npm run build && cd ..   # يبني web/dist
npm install
npm run build                                      # يبني dist/
npm start                                          # http://localhost:8080
```

أول تشغيل يُنشئ حساب المالك من `OWNER_USERNAME`/`OWNER_PASSWORD`. **غيّر كلمة المرور** من
الإعدادات بعد الدخول، ثم احذف `OWNER_PASSWORD` من `.env`. أو اضبطها يدويًّا:
```bash
npm run owner:set -- myuser "كلمة-مرور-قويّة"
```

---

## الإعدادات (`.env`)
كل المفاتيح موثّقة في `.env.example`. أهمّها:

| المفتاح | الافتراضي | المعنى |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | منفذ/مضيف الاستماع |
| `PUBLIC_URL` | `http://localhost:8080` | العنوان العام (للكوكيز وفحص Origin) |
| `SESSION_SECRET` | — (مطلوب) | سرّ توقيع الكوكيز (32+ محرفًا). `openssl rand -hex 32` |
| `OWNER_USERNAME`/`OWNER_PASSWORD` | `owner` / — | بيانات المالك لأول تشغيل |
| `STORAGE_DRIVER` | `local` | محوّل الكاش/التخزين: `local` أو `s3` |
| `CONTENT_BACKEND` | `telegram` | التخزين الدائم: `telegram` (أساسي) أو `local` (القرص دائم) |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | — (مطلوبة لـ telegram) | توكن البوت ومعرّف المجموعة لتخزين القطع |
| `TG_MIN_GAP_MS` | `3000` | أدنى فجوة بين عمليات الرفع إلى Telegram (flood-wait) |
| `CACHE_CAP_GB` | `4` | سقف كاش القطع على القرص (يُخلى تلقائيًّا) |
| `SUPABASE_DB_URL` | — (مطلوب) | سلسلة اتصال Postgres من Supabase (Session pooler) |
| `DB_SCHEMA` / `DB_SSL` / `DB_POOL_MAX` | `tdrive` / `true` / `10` | مخطّط التطبيق، TLS، وحجم حوض الاتصالات |
| `LOCAL_STORAGE_DIR` / `TMP_DIR` | تحت `./data` | مسارات التخزين والمؤقّت |
| `S3_*` | — | إعداد S3/R2/MinIO عند `STORAGE_DRIVER=s3` |
| `CHUNK_SIZE_MB` | `18` | حجم جزء الرفع |
| `MAX_FILE_SIZE_GB` | `0` | حدّ أقصى اختياريّ لحجم الملف (0 = بلا حدّ) |
| `MAX_PART_BODY_MB` | `20` | أقصى جسم لطلب جزء واحد |
| `DOWNLOAD_CONCURRENCY` | `2` | عدد التحميلات المتزامنة |
| `YTDLP_PATH`/`FFMPEG_PATH`/`FFPROBE_PATH` | في PATH | مسارات الأدوات |
| `THUMBNAILS_ENABLED` | `true` | توليد صور مصغّرة للفيديو |
| `BACKUP_ENABLED` | `false` | تفعيل النسخ الدوريّ |
| `BACKUP_INTERVAL_HOURS` | `18` | فترة النسخ |
| `MYSQL_BACKUP_URL` | — | رابط MySQL للنسخ (`mysql://user:pass@host:port/db`) |
| `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW` | `300` / `1 minute` | التقنين العام |

---

## الواجهة خلف Reverse Proxy
الرفع المجزّأ يرسل أجزاءً حتى **~20MB** للطلب الواحد. ارفع حدّ جسم الطلب:

**Nginx:**
```nginx
server {
  client_max_body_size 25m;            # >= MAX_PART_BODY_MB + هامش
  proxy_request_buffering off;         # مرّر الرفع تدفّقيًّا
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;               # مهمّ لـ SSE والبثّ
    proxy_read_timeout 3600s;          # للتحميلات/البثّ الطويل
  }
}
```
**Cloudflare:** الخطّة المجانية تحدّ جسم الطلب بـ 100MB (أكبر من 20MB، فلا مشكلة). عطّل أي
Buffering للـ SSE، وراعِ مهلة 100 ثانية لطلبات غير التدفّق. التطبيق يضبط `X-Accel-Buffering: no`
لمسار SSE. فعّل `trustProxy` مضبوط تلقائيًّا — تأكّد أنّ `PUBLIC_URL` يطابق نطاقك و`NODE_ENV=production`
حتى تُفعَّل كوكيز `Secure`.

---

## Docker
```bash
cp .env.example .env         # اضبط SESSION_SECRET و OWNER_PASSWORD
docker compose up -d --build
```
الصورة تتضمّن **ffmpeg** و**yt-dlp**. البيانات في الحجم الدائم `tdrive-data` (`/app/data`).
الواجهة تُبنى داخل الصورة وتُقدَّم من الخادم على `:8080`. `HEALTHCHECK` يفحص `/health`.

---

## النشر على HidenCloud (بيئة Node مغلقة / Pterodactyl — arm64)
مواصفات الخطة المجانية: 2 CPU (arm64)، 3GB RAM، 15GB NVMe، نطاق فرعيّ، منفذان، باندويدث غير محدود.
لا root ولا Docker ولا apt — لذا نشغّل من TypeScript مباشرةً (تجريد الأنواع في Node) ونهيّئ
`yt-dlp`/`ffmpeg` كثنائيّات arm64 داخل `./bin` تلقائيًّا.

1. **ارفع المشروع** إلى الخادم (Git أو مدير الملفّات). في اللوحة اختر **Node.js** و**إصدار Node 24**
   (أو 22.6+). مرحلة التثبيت تنفّذ `npm install`. ملاحظة: اللوحة قد تحظر بناء `argon2` الأصليّ؛
   لا مشكلة — التطبيق يسقط تلقائيًّا إلى `scrypt` المدمج. لا يوجد أيّ تخزين SQLite.
2. **ملف التشغيل (MAIN_FILE):** اضبط متغيّر `MAIN_FILE` في اللوحة على:
   ```
   start.js
   ```
   يجب أن ينتهي بـ `.js` حتى تشغّله اللوحة بـ `node` (لو كان بامتداد آخر تستخدم اللوحة `ts-node` ونحن
   لا نريده). `start.js` يهيّئ `./bin/yt-dlp` و`./bin/ffmpeg` (idempotent) ثم يشغّل الخادم من TypeScript
   عبر تجريد الأنواع في Node (مع علم strip عند اللزوم). اترك `NODE_ARGS` فارغًا.
3. **الإعدادات:** أنشئ ملف `.env` في جذر الخادم (انسخ من `.env.host.example`) واملأ: `SUPABASE_DB_URL`
   (سلسلة **Session pooler** من لوحة Supabase — الاتصال المباشر قد يكون IPv6 فقط)، `SESSION_SECRET`،
   `OWNER_PASSWORD`، `TG_BOT_TOKEN`، `TG_CHAT_ID`، و`PUBLIC_URL=https://tdrive.cc.cd`. اترك `PORT`
   فارغًا ليُؤخذ من `SERVER_PORT`، أو اضبطه على منفذ اللوحة (**24600**). `HOST=0.0.0.0`.
4. **الدومين:** اربط `tdrive.cc.cd` بمنفذ الخادم عبر النطاق الفرعيّ/الـ Proxy في اللوحة (HTTPS).
5. **الواجهة (اختياريّ):** لعرض واجهة React بنِها مرّة: `cd web && npm install && npm run build`
   (تُقدَّم من نفس الخادم). بدونها يعمل الـ API وصفحة بديلة على `/`.

**ملاحظات ملائمة للموارد:**
- **AUTO_UPDATE / git pull:** ملفّات `package-lock.json` خارج Git (مُتجاهَلة) حتى لا يتعارض `git pull`
  التلقائيّ مع النسخة التي يولّدها `npm install` على الخادم.
- القرص 15GB: الملف يُنزَّل كاملًا مؤقّتًا قبل تقطيعه ورفعه إلى Telegram، لذا `.env.host.example` يضبط
  `MAX_FILE_SIZE_GB=8`، `DOWNLOAD_CONCURRENCY=1`، و`CACHE_CAP_GB=3` ليبقى ضمن القرص. المحتوى الدائم
  على Telegram فالقرص لا يمتلئ.
- `ffmpeg` يُستخرج على Linux عبر `tar`/`xz` (وفي Windows عبر PowerShell/Expand-Archive)؛ إن تعذّر
  يبقى التطبيق صالحًا لكن **معظم فيديوهات يوتيوب تحتاج الدمج** (الصوت والفيديو منفصلان) وستظهر رسالة
  واضحة بدل تنزيل صامت بلا صوت. `yt-dlp` ثنائيّ مستقلّ لا يتطلّب Python.
- **يوتيوب على الخوادم** كثيرًا ما يطلب «تأكيد أنك لست روبوتًا» من عناوين مراكز البيانات. الحلّ:
  صدّر ملف `cookies.txt` من متصفّحك (إضافة «Get cookies.txt») ثم إمّا:
  - **الأسهل:** من **الإعدادات في التطبيق ← «كوكيز يوتيوب»** الصق محتوى الملف واحفظ (بلا إعادة تشغيل)، أو
  - ارفع الملف واضبط `YTDLP_COOKIES=/home/container/cookies.txt` في `.env` وأعد التشغيل.
  يُحفظ تلقائيًّا في `./data/cookies.txt` ويستخدمه yt-dlp فورًا. تظهر رسالة واضحة عند الحاجة.
- يمكن استخدام إحدى قاعدتي MySQL في اللوحة لميزة النسخ الاحتياطيّ (اضبط `MYSQL_BACKUP_URL` و`BACKUP_ENABLED=true`).

---

## النسخ الاحتياطيّ لقاعدة البيانات (كل 18 ساعة)
> قاعدة التطبيق التشغيليّة الوحيدة هي **Postgres (Supabase)** في المخطّط `tdrive`. لا SQLite ولا
> تخزين محلّي. يعمل الجدول الداخليّ على أخذ نسخة من **Postgres** (ومِن **MySQL** الخارجية إن
> ضُبطت) كل 18 ساعة.
>
> **شغّل نسخة واحدة فقط على القاعدة نفسها:** كاش القطع محليّ على القرص، لذا تشغيل نسختين
> (مثلًا محليًّا والإنتاج معًا) يجعل إحداهما تفشل في رفع قطع أنشأتها الأخرى.

التفعيل في `.env`:
```ini
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=18
# رمّز كلمة المرور URL-encoding. الصيغة فقط (ضع القيمة الحقيقية في .env غير المتتبَّع):
MYSQL_BACKUP_URL=mysql://USER:URL_ENCODED_PASSWORD@HOST:3306/DBNAME
BACKUP_RETENTION=14
BACKUP_PREFIX=_system/backups
```
- عند التفعيل يعمل المجدوِل الداخليّ: ينسخ **Postgres** (تفريغ مخطّط+بيانات) و**MySQL** (تفريغ
  مخطّط+بيانات)، يضغطهما `.gz`، ويحفظهما عبر محوّل التخزين تحت `BACKUP_PREFIX`
  (`postgres/` و`mysql/`)، مع حذف الأقدم وفق `BACKUP_RETENTION`.
- لتشغيل نسخة فورًا: `npm run backup:now`.
- الوقت الأخير محفوظ في جدول `kv`، فلا يتكرّر النسخ عند إعادة التشغيل، ويُستأنف الجدول بدقّة.

> **تنبيه الباقة المحدودة:** `BACKUP_ENABLED=false` افتراضيًّا كي لا يستهلك اتصالًا بالشبكة
> تلقائيًّا أثناء التطوير. فعّله فقط عندما تريد النسخ الفعليّ للـ MySQL البعيدة.

---

## الجودة والاختبارات
```bash
npm run typecheck     # tsc صارم
npm run lint          # eslint
npm test              # اختبارات node:test
npm run build         # ترجمة الإنتاج
```
اختبارات **بلا تبعيات** تعمل مباشرةً عبر تجريد الأنواع في Node (تُشغَّل بـ `npm run test:unit`):
- `ssrf` تصنيف العناوين الخاصّة/العامّة (IPv4/IPv6 وما فيها IPv4-mapped).
- `paths` تعقيم الأسماء ومنع `..` واحتواء الجذر.
- `ranges` تحليل `Range` (كامل/جزئي/suffix/غير قابل للتحقيق).
- `chunking` هندسة الأجزاء والاستئناف (مدَيات مضغوطة، ملف فارغ، off-by-one).
- `backoff` التراجع الأسّيّ وحدوده.
- `bytes`, `hash`, `sigv4` (متجه AWS الرسميّ get-vanilla), و`storage-local` (تخزين القرص فعليًّا).

> اختبارات الوحدة لا تحتاج قاعدة بيانات. اختبارات التكامل تحتاج قاعدة Postgres اختبارية معزولة
> (`TEST_DATABASE_URL`) ولا تُشغَّل على قاعدة الإنتاج؛ راجع `tests/` و`SMOKE.md`.

---

## البنية
```
tdrive/
├── src/
│   ├── index.ts            # الإقلاع + الإيقاف السلس
│   ├── server.ts           # مصنع Fastify + المعالجة المركزية للأخطاء
│   ├── config/env.ts       # إعدادات مُتحقّقة بـ zod (+ مُحمِّل .env)
│   ├── lib/                # ssrf, paths, ranges, chunking, hash, backoff, bytes, errors, spawn, logger
│   ├── db/                 # pg Pool (Supabase) + التحقّق من المخطّط + repositories
│   ├── storage/            # المحوّل: local + s3 (SigV4)
│   ├── services/           # auth, uploads, files, downloads, ytdlp, ffmpeg, queue, progress(SSE), backup, scheduler
│   ├── routes/             # auth, files, folders, uploads, downloads, events, misc + static
│   └── plugins/            # security (helmet/cors/rate-limit/multipart/cookie) + authGuard
├── web/                    # الواجهة (تصميم Vaulta موصول بالـ API)
├── tests/                  # اختبارات node:test
├── scripts/                # update-ytdlp.mjs
├── Dockerfile, docker-compose.yml, .env.example
└── AUDIT.md, CHANGELOG.md, README.md
```

---

## الأمان (ملخّص)
- جلسات كوكي `HttpOnly`+`SameSite=Lax` (+`Secure` في الإنتاج)، كلمات المرور `argon2id`.
- كل مسارات `/api` خلف المصادقة عدا الدخول و`/health`؛ فحص Origin للطلبات المتحوّلة.
- **SSRF**: قبل أي جلب لرابط المستخدم، يُحلّ DNS وتُرفض العناوين الخاصّة/الداخلية
  (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, `::1`, `fc00::/7`, link-local، ...)
  ويُعاد التحقّق **بعد كل Redirect**. مسار yt-dlp محصور في قائمة مواقع وسائط معروفة
  (`src/lib/media-hosts.ts`) حتى عند استدعاء الـ API مباشرةً، فلا يُستخدم كوسيط SSRF.
  التحميل المباشر محميّ كاملًا بتثبيت العناوين.
- `spawn` بمصفوفة وسائط فقط؛ لا `exec` ولا صدفة.
- تعقيم أسماء الملفّات ومنع Path Traversal وتأكيد الاحتواء داخل جذر التخزين.
- التنزيل بـ `Content-Disposition: attachment` للأنواع غير القابلة للمعاينة + `nosniff`.
- **لا نتجاوز DRM**؛ إن فشل التحميل بسبب حماية يظهر خطأ عربيّ واضح.
- لا أسرار في الكود — كلّها في `.env`.

---

## استكشاف الأخطاء
- **«واجهة الويب لم تُبنَ»** عند زيارة `/`: نفّذ `cd web && npm install && npm run build`.
- **التحميل من رابط يفشل بـ «yt-dlp غير مثبّت»**: أعد تشغيل الخادم (يثبّته تلقائيًّا في `./bin`) أو
  نفّذ `npm run ytdlp:update`. `YTDLP_PATH` الموجود في `.env` يُستخدم فقط إن كان ملفًّا تنفيذيًّا صالحًا؛
  وإلا يُستعمل `./bin` ثم PATH.
- **لا صور مصغّرة / لا دمج**: ثبّت ffmpeg (أو أعد التشغيل ليُثبَّت في `./bin`). لاحظ أن يوتيوب الحديث
  يقدّم الصوت والفيديو منفصلين، لذا **دمج ffmpeg ضروريّ** لمعظم الفيديوهات عالية الجودة.
- **413 عند الرفع خلف Nginx**: ارفع `client_max_body_size`.
- **كوكيز لا تُحفظ عبر HTTPS**: اضبط `NODE_ENV=production` و`PUBLIC_URL=https://...`.
- **تعذّر NSP/الدخول**: أعد ضبط المالك `npm run owner:set -- <user> <pass>`.

---

## القيود المعروفة (بصدق)
- التخزين الدائم عبر **Telegram** يتطلّب بوتًا (TG_BOT_TOKEN) ومجموعة يكون البوت مشرفًا فيها
  (TG_CHAT_ID). القطع ≤18MB بسبب حدّ `getFile` (20MB). الرفع منظَّم بالمعدّل (flood-wait) فقد
  يستغرق رفع الملفّات الكبيرة إلى Telegram وقتًا في الخلفية (الملف قابل للتشغيل من الكاش فورًا).
- محوّل **S3** (ككاش بديل للقرص) يرفع كـ `PutObject` واحد (مناسب حتى ~5GB/كائن)؛ لكن حجم القطعة
  18MB فأقلّ، فلا يُبلَغ هذا الحدّ عمليًّا.
- حماية SSRF في مسار **yt-dlp** على المضيف الابتدائيّ فقط (التحميل المباشر محميّ بالكامل).
- واجهة التصميم (Vaulta) تحتوي لوحات **زخرفيّة** (التحليلات، الطبقة التشفيرية، إزالة التكرار،
  المسح الطارئ، المشاركات) بقيت كعرض ثابت كما في التصميم؛ المسارات الوظيفيّة (الملفّات، الرفع،
  التحميل من رابط، البثّ، السلّة، البحث، الإعدادات، النظام) موصولة بالـ API الحقيقيّ.
- نصّ العلامة في التصميم «Vaulta»؛ يمكن تغييره في `web/src/components/Sidebar.tsx`.
