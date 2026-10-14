# API_CONTRACT.md — عقد الـ API للعناصر المُراد ربطها

> صيغة موحّدة. النجاح: الجسم المذكور مباشرةً (بنمط المشروع القائم `{ data... }`).
> الخطأ: `{ "error": { "code": string, "message": string } }` مع كود حالة مناسب (نمط `server.ts`).
> كل المسارات تحت `/api/*` محميّة بالجلسة (كوكي `tdrive_sess`) عدا `/api/public/*` و`/api/auth/*`.
> الحقول الزمنيّة بالمللي ثانية (epoch) ما لم يُذكر غير ذلك.

---

## 1) GET /api/stats/overview
مقاييس صفحة «النظرة العامّة» محسوبة من القاعدة.
```jsonc
{
  "activeFiles": 42,                 // عدد files (trashed=0)
  "usedBytes": 1234567890,           // SUM(size) للملفّات الجاهزة
  "quotaBytes": 5000000000000,       // حصة من الإعدادات (افتراضي 5TB)
  "byType": [                        // توزيع حسب النوع (للشريط والأسطورة)
    { "type": "video", "count": 10, "bytes": 900000000, "pct": 61.7 }
  ],
  "shares": { "active": 3, "views": 142, "downloads": 88 },
  "bandwidthBytes": 73400320,        // SUM(size*download_count) تقدير حركة التنزيل
  "collaborators": 3,                // عدد المشاركات النشطة (أطراف الوصول)
  "zeroKnowledge": { "chunkedPct": 100, "backend": "local", "connected": true },
  "trash": { "count": 2, "bytes": 10485760 },
  "pinned": [ /* ApiFile[] للملفّات pinned=1 (حتى 8) */ ],
  "recent": [ /* ApiFile[] أحدث 8 */ ],
  "retentionDays": 30
}
```

## 2) GET /api/stats/security
تحليلات صفحة «الأمان والتدقيق».
```jsonc
{
  "usedBytes": 1234567890,
  "quotaBytes": 5000000000000,
  "autoExpandBytes": 4500000000000, // 90% من الحصة (عتبة العرض)
  "byType": [ { "type":"video","count":10,"bytes":900000000,"pct":61.7 } ],
  "growth": [ { "month": "2026-05", "label":"May", "bytes": 1800000000, "cumulative": 1800000000 } ],
  "ingestPerDayBytes": 30500000,     // متوسّط الإدخال اليوميّ (آخر 30 يوم من created_at)
  "runwayDays": 54,                  // (quota-used)/ingestPerDay أو null
  "dedup": { "groups": 2, "duplicateFiles": 3, "reclaimableBytes": 42800000000, "ratio": 1.24 },
  "recommendations": [               // مُولّدة من بيانات حقيقية فقط (تُعرض فقط إن وُجدت)
    { "kind": "duplicates", "count": 3, "bytes": 42800000000, "sample": "name.mov" },
    { "kind": "stale_trash", "count": 2, "bytes": 10485760, "olderThanDays": 30 },
    { "kind": "large_files", "count": 5, "bytes": 6400000000, "sample": "big.bin" }
  ],
  "posture": {                       // وضع أمنيّ حقيقيّ من الباك إند
    "kdf": "scrypt",                 // argon2id أو scrypt (المحمَّل فعلًا)
    "dbDriver": "node:sqlite",       // better-sqlite3 أو node:sqlite
    "storageDriver": "local",
    "contentBackend": "local",
    "telegramConnected": false,
    "ssrfProtection": true,
    "cookie": { "httpOnly": true, "secure": true, "sameSite": "lax" },
    "sessions": 5,
    "https": true
  }
}
```

## 3) GET /api/stats/dedup
```jsonc
{
  "groups": [
    {
      "sha256": "de51...",
      "keep": { "id": "fil_x", "name": "a.mov", "sizeBytes": 100 },
      "duplicates": [ { "id": "fil_y", "name": "a-copy.mov", "sizeBytes": 100, "type": "video" } ],
      "reclaimableBytes": 100
    }
  ],
  "totalReclaimableBytes": 100,
  "duplicateFiles": 1
}
```
> المجموعات = ملفّات غير محذوفة لها `sha256` غير فارغ ويتكرّر. تُبقى الأقدم (`keep`) وتُقترح البقيّة للحذف.

## 4) POST /api/stats/dedup/purge
الجسم: `{ "ids": ["fil_y", ...] }` (نسخ مكرّرة فقط؛ يُرفض حذف ملف يُعدّ `keep` لمجموعته إن كان المعرّف الوحيد المتبقّي — تحقّق سلامة).
```jsonc
{ "removed": 2, "freedBytes": 200 }   // تُنقل إلى السلّة ثمّ تُحذف نهائيًّا (استرجاع مساحة فعليّ)
```
> **قرار:** الحذف نهائيّ (استرجاع المساحة هو الهدف)، مع تسجيل نشاط `dedup_purge`.

## 5) GET /api/vaults
المجلّدات كمساحات تعاون (مع ميتا الصفحة).
```jsonc
{
  "meta": { "activeSessions": 5, "e2ee": true, "shares": 3 },
  "vaults": [
    {
      "id": "fld_x", "name": "Project A",
      "filesCount": 12, "bytes": 900000000,
      "sharesCount": 1, "shared": true,
      "createdAt": 1790000000000, "updatedAt": 1791000000000,
      "activity": [1,3,2,5,4,6,8]   // عدّ ملفّات مُضافة آخر 7 أيّام (لرسم sparkline حقيقيّ) أو []
    }
  ]
}
```
> إن لم توجد مجلّدات ⇒ `vaults: []` (الواجهة تعرض حالة فارغة).

## 6) GET /api/activity?limit=&fileId=
سجلّ نشاط حقيقيّ.
```jsonc
{
  "items": [
    {
      "id": "act_x", "action": "upload", "targetType": "file",
      "targetId": "fil_x", "targetName": "a.png",
      "ip": "127.0.0.1", "at": 1791742297119,
      "meta": { "sizeBytes": 225567 }
    }
  ]
}
```
أنواع `action`: `login`, `logout`, `upload`, `download`, `url_download`, `share_created`, `share_revoked`,
`file_trashed`, `file_restored`, `file_deleted`, `trash_emptied`, `session_revoked`, `settings_updated`,
`dedup_purge`, `wipe_peers`.

### GET /api/activity/export.csv (نفس الفلاتر) → `text/csv` (تنزيل مباشر)

## 7) GET /api/files/:id/shares
```jsonc
{ "shares": [ /* نفس شكل ExternalLink في toApiShare */ ] }
```

## 8) POST /api/security/wipe-peers
الجسم: `{ "confirm": "WIPE-CONFIRM" }`.
```jsonc
{ "revokedSessions": 4, "revokedShares": 3 }   // يحذف كل الجلسات الأخرى + يُلغي كل المشاركات
```
> لا يحذف الملفّات. يُبقي الجلسة الحالية. يسجّل نشاط `wipe_peers`. كود 400 إن لم يطابق التأكيد.

## 9) توسعة GET/PUT /api/settings
تُضاف مفاتيح حقيقية إلى كائن `workspace`:
```jsonc
{
  "settings": {
    "theme": "dark", "defaultView": "grid", "thumbnailsEnabled": true,
    "retentionDays": 30,          // يُطبَّق فعلًا: المجدوِل يحذف السلّة الأقدم من هذا الحدّ
    "quotaBytes": 5000000000000   // حصة العرض عبر الواجهة
  }
}
```
التحقّق: `retentionDays ∈ [1,3650]`, `quotaBytes ≥ used`. القيم الخياليّة القديمة (Kyber…) تُزال من الواجهة.

## 10) POST /api/account/password (موجود — يُربط من الواجهة)
الجسم: `{ "current": "...", "next": "..." }` → `{ "ok": true }` (يُبطل الجلسات الأخرى).

## 11) توسعة المشاركات: قائمة سماح IP
`POST /api/shares` يقبل اختياريًّا `ipAllow: string` (قائمة IP/CIDR مفصولة بفواصل). تُخزَّن في عمود
`shares.ip_allow`. المشاركة العامّة (`/api/public/:token/*`) ترفض `403` إن لم يكن IP الزائر ضمن القائمة.
> watermark/steganography/vanity-slug: **غير قابلة للتنفيذ** في هذه المعماريّة ⇒ تُزال من النموذج (لا تُخترع).
> يُعرض رابط المشاركة الحقيقيّ `PUBLIC_URL/s/<token>` بدل vanity الوهميّ.

---

## 12) تغييرات المخطّط (migration جديدة `0003`)
```sql
CREATE TABLE activity_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  target_type TEXT,            -- file | folder | share | session | account | system
  target_id   TEXT,
  target_name TEXT,
  ip          TEXT,
  meta        TEXT,            -- JSON
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_activity_user ON activity_log(user_id, created_at);
CREATE INDEX idx_activity_target ON activity_log(user_id, target_id, created_at);

ALTER TABLE shares ADD COLUMN ip_allow TEXT;   -- قائمة IP/CIDR مسموحة (اختياريّ)
```

## 13) ملاحظات القرارات (توثيق صريح)
- **لا فوترة خارجية:** «الترقية» تضبط حصة عرض محليّة فقط (`quotaBytes`)، لأن لا بوّابة دفع متاحة. موثّق في الواجهة.
- **لا HSM/Kyber/Reed-Solomon/شهادات:** تُستبدل بوضع أمنيّ حقيقيّ من قدرات الخادم الفعلية (KDF، السائق، SSRF، الكوكي).
- **لا نظام إصدارات/علامات مائية/إخفاء معلومات:** تُزال عناصرها الوهمية بدل اختراع بيانات.
- **التكرار** يُكتشف بـ `sha256` الحقيقيّ المحسوب على الخادم عند الرفع (موجود).
- **احتفاظ السلّة** يصبح فعليًّا: المجدوِل يحذف الملفّات المحذوفة الأقدم من `retentionDays` نهائيًّا.
- **التحميل التجريبيّ (seed):** سكربت `scripts/seed.mjs` يُدخل بيانات واقعية **في القاعدة** (ملفّات بمحتوى
  حقيقيّ مقطّع في الكاش، مجلّدات، مشاركات، نشاط، نسخ مكرّرة، عناصر سلّة) — لا بيانات في الواجهة.
