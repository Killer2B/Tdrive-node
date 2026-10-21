/** النسخ الاحتياطي الدوريّ: Postgres (التطبيق) + MySQL الخارجية إلى نظام التخزين الداخلي. */
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { getPool, getSchema, tb } from '../db/pg.ts';
import { getStorage } from '../storage/index.ts';
import { loadConfig } from '../config/env.ts';
import { getLogger } from '../lib/logger.ts';

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** تفريغ مخطّط Postgres (التطبيق) وبياناته إلى ملف SQL مضغوط عبر قراءة متّسقة. */
async function backupPostgres(ts: string): Promise<{ key: string; bytes: number } | null> {
  const cfg = loadConfig();
  const log = getLogger();
  const tmpDir = path.join(cfg.storage.tmpDir, 'backup');
  await mkdir(tmpDir, { recursive: true });
  const dumpGz = path.join(tmpDir, `postgres-${ts}.sql.gz`);

  const gzip = createGzip();
  const out = createWriteStream(dumpGz);
  const writePipe = pipeline(gzip, out);

  const write = async (s: string): Promise<void> => {
    if (!gzip.write(s)) await once(gzip, 'drain');
  };

  const client = await getPool().connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await write(`-- Tdrive Postgres backup\n-- ${new Date().toISOString()}\n\n`);

    const schema = getSchema();
    const { rows: tableRows } = await client.query<{ table_name: string }>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = $2 ORDER BY table_name',
      [schema, 'BASE TABLE'],
    );
    const tables = tableRows.map((r) => r.table_name).filter((n) => n !== 'schema_migrations');

    for (const name of tables) {
      await write(`\n-- ----- ${name} -----\nTRUNCATE TABLE ${tb(name)} CASCADE;\n`);
      const { rows } = await client.query(`SELECT * FROM ${tb(name)}`);
      if (rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      const colSql = cols.map((c) => `"${c}"`).join(', ');
      const values = rows
        .map((r) => `(${cols.map((c) => sqlLiteral((r as Record<string, unknown>)[c])).join(', ')})`)
        .join(',\n');
      await write(`INSERT INTO ${tb(name)} (${colSql}) VALUES\n${values};\n`);
    }

    await client.query('COMMIT');
    gzip.end();
    await writePipe;

    const key = `${cfg.backup.prefix}/postgres/postgres-${ts}.sql.gz`;
    const res = await getStorage().putFile(key, dumpGz, { contentType: 'application/gzip' });
    log.info({ key, bytes: res.size }, 'نسخة Postgres احتياطية');
    return { key, bytes: res.size };
  } catch (e) {
    log.error({ err: String(e) }, 'فشل النسخ الاحتياطي لـ Postgres');
    await client.query('ROLLBACK').catch(() => {});
    gzip.destroy();
    await rm(dumpGz, { force: true }).catch(() => {});
    return null;
  } finally {
    client.release();
  }
}

/** تفريغ MySQL الخارجية (مخطّط + بيانات) إلى ملف SQL مضغوط، على دفعات لحدّ الذاكرة. */
async function backupMysql(ts: string, url: string): Promise<{ key: string; bytes: number } | null> {
  const cfg = loadConfig();
  const log = getLogger();
  const tmpDir = path.join(cfg.storage.tmpDir, 'backup');
  await mkdir(tmpDir, { recursive: true });
  const dumpGz = path.join(tmpDir, `mysql-${ts}.sql.gz`);

  const mysql = await import('mysql2/promise');
  let conn: Awaited<ReturnType<typeof mysql.createConnection>> | null = null;
  const gzip = createGzip();
  const out = createWriteStream(dumpGz);
  const writePipe = pipeline(gzip, out);

  const write = async (s: string): Promise<void> => {
    if (!gzip.write(s)) await once(gzip, 'drain');
  };

  try {
    conn = await mysql.createConnection(url);
    await write(`-- Tdrive MySQL backup\n-- ${new Date().toISOString()}\nSET FOREIGN_KEY_CHECKS=0;\n\n`);

    const [tablesRaw] = await conn.query('SHOW FULL TABLES');
    const tables = (tablesRaw as Record<string, string>[]).map((row) => {
      const keys = Object.keys(row);
      return { name: row[keys[0]], type: row[keys[1]] ?? 'BASE TABLE' };
    });

    for (const t of tables) {
      const [createRows] = await conn.query('SHOW CREATE TABLE ??', [t.name]);
      const createRow = (createRows as Record<string, string>[])[0] ?? {};
      const createSql = createRow['Create Table'] ?? createRow['Create View'];
      await write(`\n-- ----- ${t.name} -----\nDROP TABLE IF EXISTS \`${t.name}\`;\n`);
      if (createSql) await write(`${createSql};\n`);
      if (t.type.includes('VIEW')) continue;

      const batch = 500;
      let offset = 0;
      for (;;) {
        const [rows] = await conn.query('SELECT * FROM ?? LIMIT ? OFFSET ?', [t.name, batch, offset]);
        const list = rows as Record<string, unknown>[];
        if (list.length === 0) break;
        const cols = Object.keys(list[0]);
        const colSql = cols.map((c) => `\`${c}\``).join(',');
        const values = list
          .map((r) => `(${cols.map((c) => conn!.escape(r[c])).join(',')})`)
          .join(',\n');
        await write(`INSERT INTO \`${t.name}\` (${colSql}) VALUES\n${values};\n`);
        offset += list.length;
        if (list.length < batch) break;
      }
    }

    await write('\nSET FOREIGN_KEY_CHECKS=1;\n');
    gzip.end();
    await writePipe;

    const key = `${cfg.backup.prefix}/mysql/mysql-${ts}.sql.gz`;
    const res = await getStorage().putFile(key, dumpGz, { contentType: 'application/gzip' });
    log.info({ key, bytes: res.size }, 'نسخة MySQL احتياطية');
    return { key, bytes: res.size };
  } catch (e) {
    log.error({ err: String(e) }, 'فشل النسخ الاحتياطي لـ MySQL');
    gzip.destroy();
    await rm(dumpGz, { force: true }).catch(() => {});
    return null;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

/** يحتفظ بأحدث `keep` نسخة لكل نوع ويحذف الأقدم. */
async function enforceRetention(subPrefix: string, keep: number): Promise<void> {
  const cfg = loadConfig();
  const storage = getStorage();
  const items = await storage.list(`${cfg.backup.prefix}/${subPrefix}`);
  const sorted = items.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
  for (const old of sorted.slice(keep)) {
    await storage.delete(old.key).catch(() => {});
  }
}

export interface BackupSummary {
  ts: string;
  results: Array<{ kind: string; key: string; bytes: number }>;
}

/** يشغّل نسخة احتياطية كاملة (Postgres + MySQL إن ضُبطت). */
export async function runBackup(reason = 'scheduled'): Promise<BackupSummary> {
  const cfg = loadConfig();
  const log = getLogger();
  const ts = stamp();
  log.info({ reason, ts }, 'بدء النسخ الاحتياطي');
  const results: BackupSummary['results'] = [];

  const postgresRes = await backupPostgres(ts);
  if (postgresRes) {
    results.push({ kind: 'postgres', ...postgresRes });
    await enforceRetention('postgres', cfg.backup.retention).catch(() => {});
  }

  if (cfg.backup.mysqlUrl) {
    const mysqlRes = await backupMysql(ts, cfg.backup.mysqlUrl);
    if (mysqlRes) {
      results.push({ kind: 'mysql', ...mysqlRes });
      await enforceRetention('mysql', cfg.backup.retention).catch(() => {});
    }
  }

  // تنظيف المجلّد المؤقّت للنسخ
  const tmpDir = path.join(cfg.storage.tmpDir, 'backup');
  for (const r of results) {
    const local = path.join(tmpDir, path.basename(r.key));
    await rm(local, { force: true }).catch(() => {});
  }
  await stat(tmpDir).then(() => rm(tmpDir, { recursive: true, force: true })).catch(() => {});

  log.info({ ts, count: results.length }, 'انتهى النسخ الاحتياطي');
  return { ts, results };
}
