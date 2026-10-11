/** فتح قاعدة SQLite (WAL) وتهيئة البراغماز. */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config/env.ts';

export type DB = Database.Database;

let singleton: DB | null = null;

/** يفتح قاعدة بيانات على مسار محدّد مع البراغماز الإنتاجية. */
export function openDatabase(dbPath: string): DB {
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');
  return db;
}

/** القاعدة المفردة (singleton) المعتمدة على الإعدادات. */
export function getDb(): DB {
  if (singleton) return singleton;
  const cfg = loadConfig();
  singleton = openDatabase(cfg.storage.dbPath);
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
