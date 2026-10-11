/**
 * فتح قاعدة SQLite (WAL).
 * يفضّل better-sqlite3 (الإنتاج)، ويسقط تلقائيًّا إلى node:sqlite المدمج (تشغيل محلّي بلا بناء أصليّ).
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config/env.ts';
import { getLogger } from '../lib/logger.ts';

const require = createRequire(import.meta.url);

export interface Stmt {
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export interface DB {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  pragma(source: string): void;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  backup(destPath: string): Promise<unknown>;
  close(): void;
}

let singleton: DB | null = null;
let driverName = 'unknown';

function openBetterSqlite(dbPath: string): DB | null {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('temp_store = MEMORY');
    driverName = 'better-sqlite3';
    return db as unknown as DB;
  } catch {
    return null;
  }
}

/** غلاف يحاكي واجهة better-sqlite3 فوق node:sqlite المدمج. */
function openNodeSqlite(dbPath: string): DB {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const inner = new DatabaseSync(dbPath);
  const execPragma = (s: string): void => inner.exec(`PRAGMA ${s};`);
  execPragma('journal_mode = WAL');
  execPragma('synchronous = NORMAL');
  execPragma('foreign_keys = ON');
  execPragma('busy_timeout = 5000');
  execPragma('temp_store = MEMORY');
  driverName = 'node:sqlite';

  const wrapper: DB = {
    prepare(sql: string): Stmt {
      const st = inner.prepare(sql);
      return {
        get: (...params: unknown[]) => st.get(...(params as never[])),
        all: (...params: unknown[]) => st.all(...(params as never[])) as any[],
        run: (...params: unknown[]) => {
          const r = st.run(...(params as never[]));
          return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid as number | bigint };
        },
      };
    },
    exec: (sql: string) => inner.exec(sql),
    pragma: (source: string) => execPragma(source),
    transaction<T extends (...args: any[]) => any>(fn: T): T {
      return ((...args: unknown[]) => {
        inner.exec('BEGIN');
        try {
          const result = fn(...args);
          inner.exec('COMMIT');
          return result;
        } catch (e) {
          try {
            inner.exec('ROLLBACK');
          } catch {
            /* تجاهل */
          }
          throw e;
        }
      }) as T;
    },
    backup: async (destPath: string) => {
      inner.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
    },
    close: () => inner.close(),
  };
  return wrapper;
}

export function openDatabase(dbPath: string): DB {
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = openBetterSqlite(dbPath) ?? openNodeSqlite(dbPath);
  return db;
}

export function getDb(): DB {
  if (singleton) return singleton;
  const cfg = loadConfig();
  singleton = openDatabase(cfg.storage.dbPath);
  getLogger().info({ driver: driverName }, 'فُتحت قاعدة البيانات');
  return singleton;
}

export function closeDb(): void {
  if (singleton) {
    try {
      singleton.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* تجاهل */
    }
    singleton.close();
    singleton = null;
  }
}
