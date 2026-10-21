import { test } from 'node:test';

/**
 * اختبار تكامل حقيقي لـ API v1 وWebDAV.
 * كان يعمل على SQLite المحلّي، وقد أُزيل التخزين المحلّي نهائيًّا لصالح Postgres (Supabase).
 * لا نكتب في قاعدة الإنتاج من الاختبارات، لذا يُتخطّى تلقائيًّا حتى تُضبط قاعدة اختبار معزولة
 * عبر TEST_DATABASE_URL + TEST_DB_SCHEMA ثم يُعاد تفعيله.
 */
test('API v1 / WebDAV integration (requires an isolated Postgres test database)', { skip: true }, () => {});
