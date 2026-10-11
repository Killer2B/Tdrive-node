# SMOKE.md — اختبار الدخان اليدويّ (موثّق)

> هذه الخطوات تتطلّب تثبيت الاعتماديات (`npm install`) وأدوات `ffmpeg`/`yt-dlp`، واتصالًا
> بالإنترنت. **لم تُنفَّذ تلقائيًّا في هذه الجلسة** احترامًا لقيد الباقة المحدودة؛ نفّذها عندما
> تريد التحقّق الفعليّ. استبدل `$BASE` بعنوان الخادم (مثلاً `http://localhost:8080`).

## 0) تشغيل الخادم والدخول
```bash
cp .env.example .env   # اضبط SESSION_SECRET و OWNER_PASSWORD
npm install && npm run build && (cd web && npm install && npm run build) && npm start
```
```bash
BASE=http://localhost:8080
# دخول وحفظ الكوكي
curl -c jar.txt -b jar.txt -X POST $BASE/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"owner","password":"<OWNER_PASSWORD>"}'
curl -b jar.txt $BASE/api/auth/session         # يجب أن يعيد المستخدم
curl $BASE/health                              # {"status":"ok",...}
curl -b jar.txt $BASE/api/system               # توفّر yt-dlp/ffmpeg
```

## 1) تحميل رابط يوتيوب حقيقيّ
```bash
# معاينة
curl -b jar.txt -X POST $BASE/api/downloads/probe \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=XXXXXXXXXXX"}'
# بدء التحميل (mode=media)
curl -b jar.txt -X POST $BASE/api/downloads \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=XXXXXXXXXXX","mode":"media","formatId":"best"}'
# تابع التقدّم
curl -b jar.txt "$BASE/api/downloads/jobs?status=active"
curl -N -b jar.txt $BASE/api/events            # تدفّق SSE للتقدّم اللحظيّ
```
**المتوقّع:** مهمة تنتقل queued→running→done، ثم يظهر ملف جديد في `GET /api/files`.
إن كان المحتوى محميًّا (DRM) تظهر رسالة عربية واضحة والمهمّة تفشل بوضوح (لا تجاوز للحماية).

## 2) رفع ملف أكبر من 18MB (مجزّأ قابل للاستئناف)
أسهل طريقة: من الواجهة (تبويب «رفع من الجهاز») — تظهر أجزاء 18MB وتقدّم لحظيّ، وجرّب قطع
الاتصال ثم إعادته ليستأنف تلقائيًّا الأجزاء الناقصة. أو برمجيًّا:
```bash
# init
curl -b jar.txt -X POST $BASE/api/uploads/init -H 'content-type: application/json' \
  -d '{"clientKey":"smoke-20mb-0001","name":"big.bin","size":20971520}'
# ... استخدم uploadId و chunkSize من الردّ، ثم ارفع كل جزء:
# PUT البايتات الخام مع ترويسة x-chunk-sha256 (SHA-256 للجزء)، إلى:
#   POST $BASE/api/uploads/<id>/parts/<idx>   (content-type: application/octet-stream)
# ثم:
curl -b jar.txt -X POST $BASE/api/uploads/<id>/complete
```
**المتوقّع:** ملف واحد في `GET /api/files` بحجم 20MB وبصمة SHA‑256 صحيحة.

## 3) البثّ (Range/206)
```bash
FILE_ID=<id من /api/files>
curl -b jar.txt -D - -o /dev/null -H 'Range: bytes=0-1048575' \
  $BASE/api/files/$FILE_ID/stream
```
**المتوقّع:** `HTTP/1.1 206 Partial Content` + `Content-Range: bytes 0-1048575/<size>` +
`Accept-Ranges: bytes`. في الواجهة: مشغّل الفيديو يدعم التقديم/التأخير.

## 4) الحذف
```bash
curl -b jar.txt -X POST   $BASE/api/files/$FILE_ID/trash     # إلى السلّة
curl -b jar.txt -X POST   $BASE/api/files/$FILE_ID/restore   # استعادة
curl -b jar.txt -X DELETE $BASE/api/files/$FILE_ID           # حذف نهائيّ (يحذف من التخزين)
```
**المتوقّع:** يختفي الملف من `GET /api/files`، ويُحذف كائنه من التخزين.

## 5) النسخ الاحتياطيّ (اختياريّ — يستهلك شبكة)
```bash
BACKUP_ENABLED=true MYSQL_BACKUP_URL='mysql://...' npm run backup:now
```
**المتوقّع:** ملفّات `.gz` تحت `BACKUP_PREFIX` (`sqlite/` و`mysql/`) في نظام التخزين.
