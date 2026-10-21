/**
 * التحقّق من مخطّط Supabase عند بدء التشغيل.
 *
 * مصدر الحقيقة للمخطّط هو ملف الهجرة المُطبَّق عبر Supabase MCP:
 *   supabase/migrations/20261015000000_initial_schema.sql
 *
 * لا يُنشئ هذا المُشغّل أيّ جداول؛ يتحقّق فقط من وجود المخطّط والجداول وسياسات RLS
 * ويسجّل الهجرة في `schema_migrations`، حتى يفشل التشغيل مبكرًا وبوضوح إن كان المشروع غير مُهيّأ.
 */
import { exec, getSchema, listSchemaTables, one, query, tb } from './pg.ts';
import { getLogger } from '../lib/logger.ts';

export const SCHEMA_MIGRATION_ID = 'supabase_initial_schema';

export const REQUIRED_TABLES = [
  'users',
  'sessions',
  'folders',
  'files',
  'uploads',
  'upload_chunks',
  'file_chunks',
  'jobs',
  'settings',
  'shares',
  'activity_log',
  'api_keys',
  'kv',
  'schema_migrations',
] as const;

export async function runMigrations(): Promise<{ applied: string[] }> {
  const log = getLogger();
  const schema = getSchema();
  const tables = new Set(await listSchemaTables());
  const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));

  if (missing.length > 0) {
    throw new Error(
      `مخطّط Supabase غير مكتمل في "${schema}": جداول مفقودة (${missing.join(', ')}). ` +
        'طبّق supabase/migrations/20261015000000_initial_schema.sql عبر Supabase MCP ثم أعد التشغيل.',
    );
  }

  const unprotected = await query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relrowsecurity = false`,
    [schema],
  );
  if (unprotected.length > 0) {
    log.warn(
      { tables: unprotected.map((r) => r.relname), schema },
      'جداول بلا RLS مفعّل — راجع سياسات المشروع في Supabase',
    );
  }

  await exec(`CREATE TABLE IF NOT EXISTS ${tb('schema_migrations')} (id text PRIMARY KEY, applied_at bigint NOT NULL)`);
  const existing = await one<{ id: string }>(`SELECT id FROM ${tb('schema_migrations')} WHERE id = $1`, [
    SCHEMA_MIGRATION_ID,
  ]);

  const applied: string[] = [];
  if (!existing) {
    await exec(`INSERT INTO ${tb('schema_migrations')} (id, applied_at) VALUES ($1, $2)`, [
      SCHEMA_MIGRATION_ID,
      Date.now(),
    ]);
    applied.push(SCHEMA_MIGRATION_ID);
    log.info({ migration: SCHEMA_MIGRATION_ID, schema }, 'سُجّلت هجرة مخطّط Supabase');
  }

  return { applied };
}
