/**
 * الهجرات (migrations) كوحدات TS حتى تعمل في التطوير (tsx) والإنتاج (dist) بلا نسخ ملفات .sql.
 * كل هجرة تعمل داخل معاملة واحدة وتُسجَّل في schema_migrations.
 */
export interface Migration {
  id: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '0001_init',
    up: /* sql */ `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'owner',
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        user_agent TEXT,
        ip         TEXT
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);

      CREATE TABLE folders (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        path       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_folders_unique ON folders(user_id, IFNULL(parent_id, ''), name);
      CREATE INDEX idx_folders_parent ON folders(user_id, parent_id);
      CREATE INDEX idx_folders_path ON folders(user_id, path);

      CREATE TABLE files (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
        name        TEXT NOT NULL,
        ext         TEXT,
        type        TEXT NOT NULL DEFAULT 'bin',
        mime        TEXT,
        size        INTEGER NOT NULL DEFAULT 0,
        storage_key TEXT,
        sha256      TEXT,
        status      TEXT NOT NULL DEFAULT 'ready',
        source      TEXT NOT NULL DEFAULT 'upload',
        source_url  TEXT,
        thumb_key   TEXT,
        duration    REAL,
        width       INTEGER,
        height      INTEGER,
        starred     INTEGER NOT NULL DEFAULT 0,
        pinned      INTEGER NOT NULL DEFAULT 0,
        trashed     INTEGER NOT NULL DEFAULT 0,
        trashed_at  INTEGER,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_files_listing ON files(user_id, folder_id, trashed, updated_at);
      CREATE INDEX idx_files_trash ON files(user_id, trashed, trashed_at);
      CREATE INDEX idx_files_name ON files(user_id, name);
      CREATE INDEX idx_files_status ON files(status);

      CREATE TABLE uploads (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_key   TEXT NOT NULL,
        folder_id    TEXT REFERENCES folders(id) ON DELETE SET NULL,
        name         TEXT NOT NULL,
        size         INTEGER NOT NULL,
        chunk_size   INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        fingerprint  TEXT,
        status       TEXT NOT NULL DEFAULT 'pending',
        file_id      TEXT REFERENCES files(id) ON DELETE SET NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_uploads_clientkey ON uploads(user_id, client_key);
      CREATE INDEX idx_uploads_status ON uploads(status, expires_at);

      CREATE TABLE upload_chunks (
        upload_id   TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
        idx         INTEGER NOT NULL,
        size        INTEGER NOT NULL,
        sha256      TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        PRIMARY KEY (upload_id, idx)
      );

      CREATE TABLE jobs (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'queued',
        payload      TEXT NOT NULL DEFAULT '{}',
        title        TEXT,
        progress     REAL NOT NULL DEFAULT 0,
        speed        TEXT,
        eta          TEXT,
        stage        TEXT,
        total_bytes  INTEGER,
        done_bytes   INTEGER,
        attempts     INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        lease_until  INTEGER,
        lease_owner  TEXT,
        cancel_req   INTEGER NOT NULL DEFAULT 0,
        error        TEXT,
        result       TEXT,
        file_id      TEXT REFERENCES files(id) ON DELETE SET NULL,
        run_after    INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX idx_jobs_claim ON jobs(status, run_after);
      CREATE INDEX idx_jobs_user ON jobs(user_id, status, updated_at);

      CREATE TABLE settings (
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      );

      CREATE TABLE shares (
        id             TEXT PRIMARY KEY,
        user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        file_id        TEXT REFERENCES files(id) ON DELETE CASCADE,
        folder_id      TEXT REFERENCES folders(id) ON DELETE CASCADE,
        token          TEXT NOT NULL UNIQUE,
        label          TEXT,
        password_hash  TEXT,
        expires_at     INTEGER,
        max_downloads  INTEGER,
        download_count INTEGER NOT NULL DEFAULT 0,
        views_count    INTEGER NOT NULL DEFAULT 0,
        revoked        INTEGER NOT NULL DEFAULT 0,
        created_at     INTEGER NOT NULL
      );
      CREATE INDEX idx_shares_user ON shares(user_id, revoked);

      CREATE TABLE kv (
        k          TEXT PRIMARY KEY,
        v          TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];
