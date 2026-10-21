# قاعدة بيانات Supabase (Postgres)

Tdrive يعمل الآن على Supabase/Postgres فقط. لا توجد قاعدة بيانات محلّية (SQLite) في وقت التشغيل.

## المخطّط

`migrations/20261015000000_initial_schema.sql` يُنشئ مخطّط `tdrive` وكل جداول التطبيق:

`users`, `sessions`, `folders`, `files`, `uploads`, `upload_chunks`, `file_chunks`,
`jobs`, `settings`, `shares`, `activity_log`, `api_keys`, `kv`, `schema_migrations`.

كل جدول عليه `ENABLE ROW LEVEL SECURITY` مع سياسة `service_role_all` كاملة. الوصول مُلغى عن
`anon` و`authenticated` (وعن `PUBLIC` على المخطّط)، وممنوح لـ `service_role` فقط. أبقِ مفتاح
service-role على الخادم ولا تعرضه في المتصفّح.

## الحالة المُطبَّقة

الهجرة **مُطبَّقة** على مشروع Supabase (`trkrurzgedscaawwkxyt`، منطقة `eu-west-1`) عبر أدوات
Supabase MCP، وليست ملفًّا مرجعيًّا فقط.

## تشغيل التطبيق

أضف سلسلة الاتصال إلى `.env`:

```
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
DB_SCHEMA=tdrive
DB_SSL=true
```

- استخدم **Session pooler** من `Project Settings → Database → Connection string` (يعمل مع IPv4).
- التطبيق يضبط `search_path=tdrive,public` على كل اتصال، ويُصنّف أسماء الجداول صراحةً بـ `"tdrive"."..."`.
- `npm run db:migrate` يتحقّق من وجود المخطّط والجداول وسياسات RLS ويسجّل الهجرة في
  `tdrive.schema_migrations`. لا يُنشئ الجداول؛ مصدر الحقيقة هو ملف الهجرة المُطبَّق عبر MCP.
- عند بدء التشغيل ينفّذ التطبيق نفس التحقّق، ويفشل مبكرًا برسالة واضحة إن كان المخطّط ناقصًا.

## تغيير المخطّط

1. أنشئ ملف هجرة جديدًا في `migrations/` بصيغة Postgres (`$1` placeholders، أسماء مُصنَّفة بـ `tdrive.`).
2. طبّقه عبر Supabase MCP (`apply_migration`).
3. حدّث `REQUIRED_TABLES` في `src/db/migrate.ts` إن أضفت جدولًا جديدًا.
