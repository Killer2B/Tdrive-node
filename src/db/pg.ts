/**
 * Ø·Ø¨Ù‚Ø© Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ù€ Postgres (Supabase) Ø¹Ø¨Ø± pg Pool.
 * ÙƒÙ„ Ø§Ù„ÙˆØµÙˆÙ„ Ù„Ù„Ø¨ÙŠØ§Ù†Ø§Øª ØºÙŠØ± Ù…ØªØ²Ø§Ù…Ù† (async) â€” Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ø£ÙŠÙ‘ ØªØ®Ø²ÙŠÙ† Ù…Ø­Ù„Ù‘ÙŠ.
 */
import pg from 'pg';
import type { Pool as PgPool, PoolClient, QueryResultRow } from 'pg';
import { loadConfig } from '../config/env.ts';
import { getLogger } from '../lib/logger.ts';

const { Pool, types } = pg;

// Postgres ÙŠÙØ±Ø¬Ø¹ bigint (int8) Ùˆ numeric ÙƒØ³Ù„Ø§Ø³Ù„ Ù†ØµÙ‘ÙŠØ© Ø§ÙØªØ±Ø§Ø¶ÙŠÙ‹Ù‘Ø§.
// ÙƒÙ„ Ø§Ù„Ù‚ÙŠÙ… Ø§Ù„Ø²Ù…Ù†ÙŠÙ‘Ø© ÙˆØ§Ù„Ø£Ø­Ø¬Ø§Ù… ÙÙŠ Tdrive Ø¶Ù…Ù† Ù†Ø·Ø§Ù‚ Number Ø§Ù„Ø¢Ù…Ù† â‡’ Ù†ÙØ¹ÙŠØ¯Ù‡Ø§ Ø£Ø±Ù‚Ø§Ù…Ù‹Ø§.
const toNumber = (v: string | null): number | null => (v === null ? null : Number(v));
types.setTypeParser(20, toNumber); // int8 / bigint
types.setTypeParser(1700, toNumber); // numeric
types.setTypeParser(700, toNumber); // float4
types.setTypeParser(701, toNumber); // float8

let pool: PgPool | null = null;
let schemaCache: string | null = null;

/** Ø§Ø³Ù… Ø§Ù„Ù…Ø®Ø·Ù‘Ø· Ø§Ù„Ø°ÙŠ ØªØ¹ÙŠØ´ ÙÙŠÙ‡ Ø¬Ø¯Ø§ÙˆÙ„ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ (tdrive). */
export function getSchema(): string {
  if (schemaCache) return schemaCache;
  schemaCache = loadConfig().db.schema;
  return schemaCache;
}

/** ÙŠÙØ±Ø¬Ø¹ Ø§Ø³Ù… Ø§Ù„Ø¬Ø¯ÙˆÙ„ Ù…ÙØµÙ†ÙŽÙ‘ÙÙ‹Ø§ Ø¨Ø§Ù„Ù…Ø®Ø·Ù‘Ø·: "tdrive"."files". */
export function tb(name: string): string {
  return `"${getSchema()}"."${name}"`;
}

export type Executor = PgPool | PoolClient;

export interface DbExecutor {
  query<R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

let executor: DbExecutor | null = null;

/** ÙŠØ¶Ø¨Ø· Ù…Ù†ÙÙ‘Ø°Ù‹Ø§ Ù…Ø®ØµÙ‘ØµÙ‹Ø§ (ÙŠÙØ³ØªØ®Ø¯Ù… ÙÙŠ Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø±Ø§Øª). */
export function setExecutor(next: DbExecutor | null): void {
  executor = next;
}

export function getPool(): PgPool {
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
  pool.on('error', (err: Error) => {
    getLogger().error({ err: String(err) }, 'Ø®Ø·Ø£ ÙÙŠ Ø§ØªØµØ§Ù„ Postgres Ø§Ù„Ø®Ø§Ù…Ù„');
  });
  return pool;
}

function run(sql: string, params: unknown[]): Promise<{ rows: QueryResultRow[]; rowCount: number | null }> {
  const target = executor ?? getPool();
  return target.query(sql, params);
}

/** ÙƒÙ„ Ø§Ù„ØµÙÙˆÙ. */
export async function query<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<R[]> {
  const res = await run(sql, params);
  return res.rows as R[];
}

/** ØµÙÙ‘ ÙˆØ§Ø­Ø¯ Ø£Ùˆ undefined. */
export async function one<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<R | undefined> {
  const rows = await query<R>(sql, params);
  return rows[0];
}

/** ØªÙ†ÙÙŠØ° Ø£Ù…Ø± ÙˆÙƒØªØ§Ø¨Ø©: ÙŠÙØ±Ø¬Ø¹ Ø¹Ø¯Ø¯ Ø§Ù„ØµÙÙˆÙ Ø§Ù„Ù…ØªØ£Ø«Ù‘Ø±Ø©. */
export async function exec(sql: string, params: unknown[] = []): Promise<number> {
  const res = await run(sql, params);
  return res.rowCount ?? 0;
}

/** Ù‚ÙŠÙ…Ø© Ø¹Ø¯Ø¯ÙŠÙ‘Ø© ÙˆØ§Ø­Ø¯Ø© (COUNT/SUM). */
export async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const row = await one<Record<string, unknown>>(sql, params);
  if (!row) return 0;
  const value = Object.values(row)[0];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

/** Ù…Ø¹Ø§Ù…Ù„Ø© (transaction) Ø¹Ù„Ù‰ Ø§ØªØµØ§Ù„ ÙˆØ§Ø­Ø¯. */
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
      /* ØªØ¬Ø§Ù‡Ù„ */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** ØªØ­Ù‚Ù‘Ù‚ Ù…Ù† Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ø§Ù„Ù‚Ø§Ø¹Ø¯Ø©. */
export async function ping(): Promise<void> {
  await getPool().query('SELECT 1');
}

/** Ø£Ø³Ù…Ø§Ø¡ Ø§Ù„Ø¬Ø¯Ø§ÙˆÙ„ Ø§Ù„Ù…ÙˆØ¬ÙˆØ¯Ø© ÙÙŠ Ø§Ù„Ù…Ø®Ø·Ù‘Ø·. */
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

