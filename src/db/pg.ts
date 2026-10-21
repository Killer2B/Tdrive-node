/**
 * طبقة الاتصال بـ Postgres (Supabase) عبر pg Pool.
 * كل الوصول للبيانات غير متزامن (async) — لا يوجد أيّ تخزين محلّي.
 */
import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { loadConfig } from '../config/env.ts';
import { getLogger } from '../lib/logger.ts';

const { Pool, types } = pg;

// Postgres يُرجع bigint (int8) و numeric كسلاسل نصّية افتراضيًّا.
// كل القيم الزمنيّة والأحجام في Tdrive ضمن نطاق Number الآمن ⇒ نُعيدها أرقامًا.
const toNumber = (v: string | null): number | null => (v === null ? null : Number(v));
types.setTypeParser(20, toNumber); // int8 / bigint
types.setTypeParser(1700, toNumber); // numeric
types.setTypeParser(700, toNumber); // float4
types.setTypeParser(701, toNumber); // float8

let pool: Pool | null = null;
let schemaCache: string | null = null;

/** اسم المخطّط الذي تعيش فيه جداول التطبيق (tdrive). */
export function getSchema(): string {
  if (schemaCache) return schemaCache;
  schemaCache = loadConfig().db.schema;
  return schemaCache;
}

/** يُرجع اسم الجدول مُصنَّفًا بالمخطّط: "tdrive"."files". */
export function tb(name: string): string {
  return `"${getSchema()}"."${name}"`;
}

export type Executor = Pool | PoolClient;

export interface DbExecutor {
  query<R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

let executor: DbExecutor | null = null;

/** يضبط منفّذًا مخصّصًا (يُستخدم في الاختبارات). */
export function setExecutor(next: DbExecutor | null): void {
  executor = next;
}

export function getPool(): Pool {
  if (pool) return pool;
  const cfg = loadConfig();
  pool = new Pool({
    connectionString: cfg.db.url,
    max: cfg.db.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: cfg.db.connectTimeoutMs,
    ssl: cfg.db.ssl ? { rejectUnauthorized: false } : undefined,
    options: `-c search_path=${cfg.db.schema},public`,
    application_name: 'tdrive',
  });
  pool.on('error', (err) => {
    getLogger().error({ err: String(err) }, 'خطأ في اتصال Postgres الخامل');
  });
  return pool;
}

function run(sql: string, params: unknown[]): Promise<{ rows: QueryResultRow[]; rowCount: number | null }> {
  const target = executor ?? getPool();
  return target.query(sql, params);
}

/** كل الصفوف. */
export async function query<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<R[]> {
  const res = await run(sql, params);
  return res.rows as R[];
}

/** صفّ واحد أو undefined. */
export async function one<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<R | undefined> {
  const rows = await query<R>(sql, params);
  return rows[0];
}

/** تنفيذ أمر وكتابة: يُرجع عدد الصفوف المتأثّرة. */
export async function exec(sql: string, params: unknown[] = []): Promise<number> {
  const res = await run(sql, params);
  return res.rowCount ?? 0;
}

/** قيمة عدديّة واحدة (COUNT/SUM). */
export async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const row = await one<Record<string, unknown>>(sql, params);
  if (!row) return 0;
  const value = Object.values(row)[0];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

/** معاملة (transaction) على اتصال واحد. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* تجاهل */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** تحقّق من الاتصال بالقاعدة. */
export async function ping(): Promise<void> {
  await getPool().query('SELECT 1');
}

/** أسماء الجداول الموجودة في المخطّط. */
export async function listSchemaTables(): Promise<string[]> {
  const rows = await query<{ table_name: string }>(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
    [getSchema()],
  );
  return rows.map((r) => r.table_name);
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}
