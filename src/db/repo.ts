/** طبقة الوصول للبيانات (repositories) فوق better-sqlite3. كل الدوال متزامنة. */
import { getDb } from './db.ts';
import { newId } from '../lib/ids.ts';

const now = (): number => Date.now();
const bool = (v: boolean | undefined): number => (v ? 1 : 0);

// ===== أنواع الصفوف =====
export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  user_agent: string | null;
  ip: string | null;
}

export interface FolderRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
}

export type FileType = 'video' | 'design' | 'code' | 'doc' | 'archive' | 'bin' | 'folder';
export type FileStatus = 'pending' | 'processing' | 'ready' | 'error';
export type FileSource = 'upload' | 'url' | 'ytdlp';

export interface FileRow {
  id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  ext: string | null;
  type: FileType;
  mime: string | null;
  size: number;
  storage_key: string | null;
  sha256: string | null;
  status: FileStatus;
  source: FileSource;
  source_url: string | null;
  thumb_key: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  starred: number;
  pinned: number;
  trashed: number;
  trashed_at: number | null;
  backend: string;
  chunk_size: number | null;
  thumb_tg_file_id: string | null;
  thumb_tg_message_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface FileChunkRow {
  file_id: string;
  idx: number;
  size: number;
  sha256: string | null;
  tg_message_id: number | null;
  tg_file_id: string | null;
  cached: number;
}

export interface UploadRow {
  id: string;
  user_id: string;
  client_key: string;
  folder_id: string | null;
  name: string;
  size: number;
  chunk_size: number;
  total_chunks: number;
  fingerprint: string | null;
  status: 'pending' | 'completed' | 'aborted';
  file_id: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export interface JobRow {
  id: string;
  user_id: string;
  type: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  payload: string;
  title: string | null;
  progress: number;
  speed: string | null;
  eta: string | null;
  stage: string | null;
  total_bytes: number | null;
  done_bytes: number | null;
  attempts: number;
  max_attempts: number;
  lease_until: number | null;
  lease_owner: string | null;
  cancel_req: number;
  error: string | null;
  result: string | null;
  file_id: string | null;
  run_after: number;
  created_at: number;
  updated_at: number;
}

export interface ShareRow {
  id: string;
  user_id: string;
  file_id: string | null;
  folder_id: string | null;
  token: string;
  label: string | null;
  password_hash: string | null;
  expires_at: number | null;
  max_downloads: number | null;
  download_count: number;
  views_count: number;
  revoked: number;
  ip_allow: string | null;
  created_at: number;
}

// ===== المستخدمون =====
export const Users = {
  create(input: { username: string; password_hash: string; role?: string }): UserRow {
    const db = getDb();
    const row: UserRow = {
      id: newId('usr'),
      username: input.username,
      password_hash: input.password_hash,
      role: input.role ?? 'owner',
      created_at: now(),
      updated_at: now(),
    };
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (@id, @username, @password_hash, @role, @created_at, @updated_at)`,
    ).run(row);
    return row;
  },
  findByUsername(username: string): UserRow | undefined {
    return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  },
  findById(id: string): UserRow | undefined {
    return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  },
  updatePassword(id: string, password_hash: string): void {
    getDb().prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(password_hash, now(), id);
  },
  count(): number {
    return (getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  },
};

// ===== الجلسات =====
export const Sessions = {
  create(input: { user_id: string; ttlMs: number; user_agent?: string; ip?: string }): SessionRow {
    const db = getDb();
    const row: SessionRow = {
      id: newId('ses'),
      user_id: input.user_id,
      created_at: now(),
      expires_at: now() + input.ttlMs,
      user_agent: input.user_agent ?? null,
      ip: input.ip ?? null,
    };
    db.prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip)
       VALUES (@id, @user_id, @created_at, @expires_at, @user_agent, @ip)`,
    ).run(row);
    return row;
  },
  find(id: string): SessionRow | undefined {
    return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },
  deleteExpired(): number {
    return getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()).changes;
  },
  deleteAllForUser(user_id: string): void {
    getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id);
  },
  listByUser(user_id: string): SessionRow[] {
    return getDb()
      .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC')
      .all(user_id) as SessionRow[];
  },
};

// ===== المجلّدات =====
export const Folders = {
  create(input: { user_id: string; parent_id: string | null; name: string; path: string }): FolderRow {
    const db = getDb();
    const row: FolderRow = {
      id: newId('fld'),
      user_id: input.user_id,
      parent_id: input.parent_id,
      name: input.name,
      path: input.path,
      created_at: now(),
      updated_at: now(),
    };
    db.prepare(
      `INSERT INTO folders (id, user_id, parent_id, name, path, created_at, updated_at)
       VALUES (@id, @user_id, @parent_id, @name, @path, @created_at, @updated_at)`,
    ).run(row);
    return row;
  },
  findById(id: string): FolderRow | undefined {
    return getDb().prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined;
  },
  findByParentName(user_id: string, parent_id: string | null, name: string): FolderRow | undefined {
    return getDb()
      .prepare('SELECT * FROM folders WHERE user_id = ? AND IFNULL(parent_id, \'\') = IFNULL(?, \'\') AND name = ?')
      .get(user_id, parent_id, name) as FolderRow | undefined;
  },
  listChildren(user_id: string, parent_id: string | null): FolderRow[] {
    return getDb()
      .prepare(
        'SELECT * FROM folders WHERE user_id = ? AND IFNULL(parent_id, \'\') = IFNULL(?, \'\') ORDER BY name COLLATE NOCASE',
      )
      .all(user_id, parent_id) as FolderRow[];
  },
  rename(id: string, name: string, path: string): void {
    getDb().prepare('UPDATE folders SET name = ?, path = ?, updated_at = ? WHERE id = ?').run(name, path, now(), id);
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM folders WHERE id = ?').run(id);
  },
};

// ===== الملفّات =====
export interface FileListOptions {
  folderId?: string | null;
  trashed?: boolean;
  sort?: 'name' | 'size' | 'modified' | 'created';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

const SORT_COLUMN: Record<NonNullable<FileListOptions['sort']>, string> = {
  name: 'name COLLATE NOCASE',
  size: 'size',
  modified: 'updated_at',
  created: 'created_at',
};

export const Files = {
  create(input: Partial<FileRow> & { user_id: string; name: string }): FileRow {
    const db = getDb();
    const ts = now();
    const row: FileRow = {
      id: input.id ?? newId('fil'),
      user_id: input.user_id,
      folder_id: input.folder_id ?? null,
      name: input.name,
      ext: input.ext ?? null,
      type: input.type ?? 'bin',
      mime: input.mime ?? null,
      size: input.size ?? 0,
      storage_key: input.storage_key ?? null,
      sha256: input.sha256 ?? null,
      status: input.status ?? 'ready',
      source: input.source ?? 'upload',
      source_url: input.source_url ?? null,
      thumb_key: input.thumb_key ?? null,
      duration: input.duration ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      starred: input.starred ?? 0,
      pinned: input.pinned ?? 0,
      trashed: input.trashed ?? 0,
      trashed_at: input.trashed_at ?? null,
      backend: input.backend ?? 'telegram',
      chunk_size: input.chunk_size ?? null,
      thumb_tg_file_id: input.thumb_tg_file_id ?? null,
      thumb_tg_message_id: input.thumb_tg_message_id ?? null,
      created_at: input.created_at ?? ts,
      updated_at: input.updated_at ?? ts,
    };
    db.prepare(
      `INSERT INTO files (id,user_id,folder_id,name,ext,type,mime,size,storage_key,sha256,status,source,source_url,
          thumb_key,duration,width,height,starred,pinned,trashed,trashed_at,backend,chunk_size,thumb_tg_file_id,
          thumb_tg_message_id,created_at,updated_at)
       VALUES (@id,@user_id,@folder_id,@name,@ext,@type,@mime,@size,@storage_key,@sha256,@status,@source,@source_url,
          @thumb_key,@duration,@width,@height,@starred,@pinned,@trashed,@trashed_at,@backend,@chunk_size,@thumb_tg_file_id,
          @thumb_tg_message_id,@created_at,@updated_at)`,
    ).run(row);
    return row;
  },
  findById(id: string): FileRow | undefined {
    return getDb().prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;
  },
  findByFolderAndName(user_id: string, folder_id: string | null, name: string): FileRow | undefined {
    return getDb()
      .prepare(
        'SELECT * FROM files WHERE user_id = ? AND IFNULL(folder_id, \'\') = IFNULL(?, \'\') AND name = ? AND trashed = 0',
      )
      .get(user_id, folder_id, name) as FileRow | undefined;
  },
  list(user_id: string, opts: FileListOptions = {}): FileRow[] {
    const sort = SORT_COLUMN[opts.sort ?? 'modified'];
    const order = opts.order === 'asc' ? 'ASC' : 'DESC';
    const trashed = bool(opts.trashed);
    const limit = Math.min(opts.limit ?? 500, 2000);
    const offset = opts.offset ?? 0;
    if (opts.folderId === undefined) {
      return getDb()
        .prepare(`SELECT * FROM files WHERE user_id = ? AND trashed = ? ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`)
        .all(user_id, trashed, limit, offset) as FileRow[];
    }
    return getDb()
      .prepare(
        `SELECT * FROM files WHERE user_id = ? AND IFNULL(folder_id,'') = IFNULL(?, '') AND trashed = ?
         ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`,
      )
      .all(user_id, opts.folderId, trashed, limit, offset) as FileRow[];
  },
  search(user_id: string, q: string, limit = 100): FileRow[] {
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
    return getDb()
      .prepare(
        `SELECT * FROM files WHERE user_id = ? AND trashed = 0 AND name LIKE ? ESCAPE '\\'
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(user_id, like, limit) as FileRow[];
  },
  recent(user_id: string, limit = 50): FileRow[] {
    return getDb()
      .prepare('SELECT * FROM files WHERE user_id = ? AND trashed = 0 ORDER BY updated_at DESC LIMIT ?')
      .all(user_id, limit) as FileRow[];
  },
  starred(user_id: string, limit = 200): FileRow[] {
    return getDb()
      .prepare('SELECT * FROM files WHERE user_id = ? AND trashed = 0 AND starred = 1 ORDER BY updated_at DESC LIMIT ?')
      .all(user_id, limit) as FileRow[];
  },
  trashList(user_id: string): FileRow[] {
    return getDb()
      .prepare('SELECT * FROM files WHERE user_id = ? AND trashed = 1 ORDER BY trashed_at DESC')
      .all(user_id) as FileRow[];
  },
  update(id: string, patch: Partial<FileRow>): void {
    const allowed = [
      'folder_id', 'name', 'ext', 'type', 'mime', 'size', 'storage_key', 'sha256', 'status',
      'source_url', 'thumb_key', 'duration', 'width', 'height', 'starred', 'pinned', 'trashed', 'trashed_at',
      'backend', 'chunk_size', 'thumb_tg_file_id', 'thumb_tg_message_id',
    ] as const;
    const sets: string[] = [];
    const params: Record<string, unknown> = { id, updated_at: now() };
    for (const k of allowed) {
      if (k in patch) {
        sets.push(`${k} = @${k}`);
        params[k] = (patch as Record<string, unknown>)[k];
      }
    }
    if (sets.length === 0) return;
    getDb().prepare(`UPDATE files SET ${sets.join(', ')}, updated_at = @updated_at WHERE id = @id`).run(params);
  },
  setTrashed(id: string, trashed: boolean): void {
    getDb()
      .prepare('UPDATE files SET trashed = ?, trashed_at = ?, updated_at = ? WHERE id = ?')
      .run(bool(trashed), trashed ? now() : null, now(), id);
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM files WHERE id = ?').run(id);
  },
  usedBytes(user_id: string): number {
    const r = getDb()
      .prepare("SELECT IFNULL(SUM(size),0) AS s FROM files WHERE user_id = ? AND status = 'ready'")
      .get(user_id) as { s: number };
    return r.s;
  },
};

// ===== قطع المحتوى (Telegram/الكاش) =====
export const FileChunks = {
  add(input: {
    file_id: string;
    idx: number;
    size: number;
    sha256: string | null;
    cached?: boolean;
    tg_message_id?: number | null;
    tg_file_id?: string | null;
  }): void {
    getDb()
      .prepare(
        `INSERT INTO file_chunks (file_id, idx, size, sha256, tg_message_id, tg_file_id, cached)
         VALUES (@file_id, @idx, @size, @sha256, @tg_message_id, @tg_file_id, @cached)
         ON CONFLICT(file_id, idx) DO UPDATE SET size=excluded.size, sha256=excluded.sha256`,
      )
      .run({
        file_id: input.file_id,
        idx: input.idx,
        size: input.size,
        sha256: input.sha256,
        tg_message_id: input.tg_message_id ?? null,
        tg_file_id: input.tg_file_id ?? null,
        cached: input.cached === false ? 0 : 1,
      });
  },
  listByFile(file_id: string): FileChunkRow[] {
    return getDb()
      .prepare('SELECT * FROM file_chunks WHERE file_id = ? ORDER BY idx')
      .all(file_id) as FileChunkRow[];
  },
  get(file_id: string, idx: number): FileChunkRow | undefined {
    return getDb()
      .prepare('SELECT * FROM file_chunks WHERE file_id = ? AND idx = ?')
      .get(file_id, idx) as FileChunkRow | undefined;
  },
  setTg(file_id: string, idx: number, tg_message_id: number, tg_file_id: string): void {
    getDb()
      .prepare('UPDATE file_chunks SET tg_message_id = ?, tg_file_id = ? WHERE file_id = ? AND idx = ?')
      .run(tg_message_id, tg_file_id, file_id, idx);
  },
  setCached(file_id: string, idx: number, cached: boolean): void {
    getDb().prepare('UPDATE file_chunks SET cached = ? WHERE file_id = ? AND idx = ?').run(bool(cached), file_id, idx);
  },
  pending(file_id: string): FileChunkRow[] {
    return getDb()
      .prepare('SELECT * FROM file_chunks WHERE file_id = ? AND tg_file_id IS NULL ORDER BY idx')
      .all(file_id) as FileChunkRow[];
  },
  countPending(file_id: string): number {
    return (
      getDb().prepare('SELECT COUNT(*) AS c FROM file_chunks WHERE file_id = ? AND tg_file_id IS NULL').get(file_id) as {
        c: number;
      }
    ).c;
  },
  deleteByFile(file_id: string): void {
    getDb().prepare('DELETE FROM file_chunks WHERE file_id = ?').run(file_id);
  },
};

// ===== جلسات الرفع =====
export const Uploads = {
  create(input: {
    user_id: string;
    client_key: string;
    folder_id: string | null;
    name: string;
    size: number;
    chunk_size: number;
    total_chunks: number;
    fingerprint: string | null;
    ttlMs: number;
  }): UploadRow {
    const db = getDb();
    const ts = now();
    const row: UploadRow = {
      id: newId('upl'),
      user_id: input.user_id,
      client_key: input.client_key,
      folder_id: input.folder_id,
      name: input.name,
      size: input.size,
      chunk_size: input.chunk_size,
      total_chunks: input.total_chunks,
      fingerprint: input.fingerprint,
      status: 'pending',
      file_id: null,
      created_at: ts,
      updated_at: ts,
      expires_at: ts + input.ttlMs,
    };
    db.prepare(
      `INSERT INTO uploads (id,user_id,client_key,folder_id,name,size,chunk_size,total_chunks,fingerprint,status,file_id,created_at,updated_at,expires_at)
       VALUES (@id,@user_id,@client_key,@folder_id,@name,@size,@chunk_size,@total_chunks,@fingerprint,@status,@file_id,@created_at,@updated_at,@expires_at)`,
    ).run(row);
    return row;
  },
  findById(id: string): UploadRow | undefined {
    return getDb().prepare('SELECT * FROM uploads WHERE id = ?').get(id) as UploadRow | undefined;
  },
  findByClientKey(user_id: string, client_key: string): UploadRow | undefined {
    return getDb()
      .prepare('SELECT * FROM uploads WHERE user_id = ? AND client_key = ?')
      .get(user_id, client_key) as UploadRow | undefined;
  },
  touch(id: string): void {
    getDb().prepare('UPDATE uploads SET updated_at = ? WHERE id = ?').run(now(), id);
  },
  setStatus(id: string, status: UploadRow['status'], file_id?: string | null): void {
    getDb()
      .prepare('UPDATE uploads SET status = ?, file_id = ?, updated_at = ? WHERE id = ?')
      .run(status, file_id ?? null, now(), id);
  },
  addChunk(upload_id: string, idx: number, size: number, sha256: string): void {
    getDb()
      .prepare(
        `INSERT INTO upload_chunks (upload_id, idx, size, sha256, received_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(upload_id, idx) DO UPDATE SET size = excluded.size, sha256 = excluded.sha256, received_at = excluded.received_at`,
      )
      .run(upload_id, idx, size, sha256, now());
  },
  getChunk(upload_id: string, idx: number): { idx: number; size: number; sha256: string } | undefined {
    return getDb()
      .prepare('SELECT idx, size, sha256 FROM upload_chunks WHERE upload_id = ? AND idx = ?')
      .get(upload_id, idx) as { idx: number; size: number; sha256: string } | undefined;
  },
  receivedIndexes(upload_id: string): number[] {
    const rows = getDb()
      .prepare('SELECT idx FROM upload_chunks WHERE upload_id = ? ORDER BY idx')
      .all(upload_id) as Array<{ idx: number }>;
    return rows.map((r) => r.idx);
  },
  chunkHashesOrdered(upload_id: string): Array<{ idx: number; size: number; sha256: string }> {
    return getDb()
      .prepare('SELECT idx, size, sha256 FROM upload_chunks WHERE upload_id = ? ORDER BY idx')
      .all(upload_id) as Array<{ idx: number; size: number; sha256: string }>;
  },
  listExpiredPending(): UploadRow[] {
    return getDb()
      .prepare("SELECT * FROM uploads WHERE status = 'pending' AND expires_at < ?")
      .all(now()) as UploadRow[];
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM uploads WHERE id = ?').run(id);
  },
};

// ===== المهام (الطابور) =====
export const Jobs = {
  create(input: {
    user_id: string;
    type: string;
    payload: unknown;
    title?: string;
    max_attempts: number;
    run_after?: number;
  }): JobRow {
    const db = getDb();
    const ts = now();
    const row: JobRow = {
      id: newId('job'),
      user_id: input.user_id,
      type: input.type,
      status: 'queued',
      payload: JSON.stringify(input.payload ?? {}),
      title: input.title ?? null,
      progress: 0,
      speed: null,
      eta: null,
      stage: null,
      total_bytes: null,
      done_bytes: null,
      attempts: 0,
      max_attempts: input.max_attempts,
      lease_until: null,
      lease_owner: null,
      cancel_req: 0,
      error: null,
      result: null,
      file_id: null,
      run_after: input.run_after ?? 0,
      created_at: ts,
      updated_at: ts,
    };
    db.prepare(
      `INSERT INTO jobs (id,user_id,type,status,payload,title,progress,speed,eta,stage,total_bytes,done_bytes,
          attempts,max_attempts,lease_until,lease_owner,cancel_req,error,result,file_id,run_after,created_at,updated_at)
       VALUES (@id,@user_id,@type,@status,@payload,@title,@progress,@speed,@eta,@stage,@total_bytes,@done_bytes,
          @attempts,@max_attempts,@lease_until,@lease_owner,@cancel_req,@error,@result,@file_id,@run_after,@created_at,@updated_at)`,
    ).run(row);
    return row;
  },
  findById(id: string): JobRow | undefined {
    return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  },
  claimNext(leaseOwner: string, leaseMs: number): JobRow | undefined {
    const ts = now();
    return getDb()
      .prepare(
        `UPDATE jobs SET status='running', lease_owner=@owner, lease_until=@lease, attempts=attempts+1, updated_at=@ts
         WHERE id = (
           SELECT id FROM jobs WHERE status='queued' AND run_after <= @ts ORDER BY run_after, created_at LIMIT 1
         )
         RETURNING *`,
      )
      .get({ owner: leaseOwner, lease: ts + leaseMs, ts }) as JobRow | undefined;
  },
  renewLease(id: string, leaseMs: number): void {
    getDb().prepare('UPDATE jobs SET lease_until = ?, updated_at = ? WHERE id = ?').run(now() + leaseMs, now(), id);
  },
  reclaimStale(): number {
    return getDb()
      .prepare("UPDATE jobs SET status='queued', lease_owner=NULL WHERE status='running' AND lease_until < ?")
      .run(now()).changes;
  },
  progress(
    id: string,
    patch: Partial<Pick<JobRow, 'progress' | 'speed' | 'eta' | 'stage' | 'total_bytes' | 'done_bytes'>>,
  ): void {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id, updated_at: now() };
    for (const k of ['progress', 'speed', 'eta', 'stage', 'total_bytes', 'done_bytes'] as const) {
      if (k in patch) {
        sets.push(`${k} = @${k}`);
        params[k] = (patch as Record<string, unknown>)[k] ?? null;
      }
    }
    if (sets.length === 0) return;
    getDb().prepare(`UPDATE jobs SET ${sets.join(', ')}, updated_at = @updated_at WHERE id = @id`).run(params);
  },
  complete(id: string, result: unknown, file_id?: string | null): void {
    getDb()
      .prepare(
        "UPDATE jobs SET status='done', progress=100, result=@result, file_id=@file_id, error=NULL, lease_owner=NULL, lease_until=NULL, updated_at=@ts WHERE id=@id",
      )
      .run({ id, result: JSON.stringify(result ?? {}), file_id: file_id ?? null, ts: now() });
  },
  fail(id: string, error: string, retryAfter?: number): void {
    if (retryAfter !== undefined) {
      getDb()
        .prepare("UPDATE jobs SET status='queued', error=@error, run_after=@run_after, lease_owner=NULL, lease_until=NULL, updated_at=@ts WHERE id=@id")
        .run({ id, error, run_after: retryAfter, ts: now() });
    } else {
      getDb()
        .prepare("UPDATE jobs SET status='error', error=@error, lease_owner=NULL, lease_until=NULL, updated_at=@ts WHERE id=@id")
        .run({ id, error, ts: now() });
    }
  },
  requestCancel(id: string): void {
    getDb().prepare('UPDATE jobs SET cancel_req = 1, updated_at = ? WHERE id = ?').run(now(), id);
  },
  markCanceled(id: string): void {
    getDb()
      .prepare("UPDATE jobs SET status='canceled', lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=?")
      .run(now(), id);
  },
  requeue(id: string): void {
    getDb()
      .prepare(
        "UPDATE jobs SET status='queued', cancel_req=0, error=NULL, run_after=0, lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=?",
      )
      .run(now(), id);
  },
  isCancelRequested(id: string): boolean {
    const r = getDb().prepare('SELECT cancel_req FROM jobs WHERE id = ?').get(id) as { cancel_req: number } | undefined;
    return !!r && r.cancel_req === 1;
  },
  listByUser(user_id: string, statuses?: string[]): JobRow[] {
    if (statuses && statuses.length > 0) {
      const placeholders = statuses.map(() => '?').join(',');
      return getDb()
        .prepare(`SELECT * FROM jobs WHERE user_id = ? AND status IN (${placeholders}) ORDER BY created_at DESC LIMIT 500`)
        .all(user_id, ...statuses) as JobRow[];
    }
    return getDb()
      .prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 500')
      .all(user_id) as JobRow[];
  },
  deleteDoneBefore(ts: number): number {
    return getDb()
      .prepare("DELETE FROM jobs WHERE status IN ('done','canceled','error') AND updated_at < ?")
      .run(ts).changes;
  },
};

// ===== الإعدادات =====
export const Settings = {
  get(user_id: string, key: string): unknown {
    const r = getDb().prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(user_id, key) as
      | { value: string }
      | undefined;
    return r ? JSON.parse(r.value) : undefined;
  },
  getAll(user_id: string): Record<string, unknown> {
    const rows = getDb().prepare('SELECT key, value FROM settings WHERE user_id = ?').all(user_id) as Array<{
      key: string;
      value: string;
    }>;
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = JSON.parse(r.value);
    return out;
  },
  set(user_id: string, key: string, value: unknown): void {
    getDb()
      .prepare(
        `INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(user_id, key, JSON.stringify(value), now());
  },
};

// ===== المشاركات =====
export const Shares = {
  create(input: {
    user_id: string;
    file_id: string | null;
    folder_id: string | null;
    token: string;
    label?: string;
    password_hash?: string | null;
    expires_at?: number | null;
    max_downloads?: number | null;
    ip_allow?: string | null;
  }): ShareRow {
    const db = getDb();
    const row: ShareRow = {
      id: newId('shr'),
      user_id: input.user_id,
      file_id: input.file_id,
      folder_id: input.folder_id,
      token: input.token,
      label: input.label ?? null,
      password_hash: input.password_hash ?? null,
      expires_at: input.expires_at ?? null,
      max_downloads: input.max_downloads ?? null,
      download_count: 0,
      views_count: 0,
      revoked: 0,
      ip_allow: input.ip_allow ?? null,
      created_at: now(),
    };
    db.prepare(
      `INSERT INTO shares (id,user_id,file_id,folder_id,token,label,password_hash,expires_at,max_downloads,download_count,views_count,revoked,ip_allow,created_at)
       VALUES (@id,@user_id,@file_id,@folder_id,@token,@label,@password_hash,@expires_at,@max_downloads,@download_count,@views_count,@revoked,@ip_allow,@created_at)`,
    ).run(row);
    return row;
  },
  findByToken(token: string): ShareRow | undefined {
    return getDb().prepare('SELECT * FROM shares WHERE token = ?').get(token) as ShareRow | undefined;
  },
  findById(id: string): ShareRow | undefined {
    return getDb().prepare('SELECT * FROM shares WHERE id = ?').get(id) as ShareRow | undefined;
  },
  listByUser(user_id: string): ShareRow[] {
    return getDb().prepare('SELECT * FROM shares WHERE user_id = ? ORDER BY created_at DESC').all(user_id) as ShareRow[];
  },
  listByFile(user_id: string, file_id: string): ShareRow[] {
    return getDb()
      .prepare('SELECT * FROM shares WHERE user_id = ? AND file_id = ? ORDER BY created_at DESC')
      .all(user_id, file_id) as ShareRow[];
  },
  revoke(id: string): void {
    getDb().prepare('UPDATE shares SET revoked = 1 WHERE id = ?').run(id);
  },
  incViews(id: string): void {
    getDb().prepare('UPDATE shares SET views_count = views_count + 1 WHERE id = ?').run(id);
  },
  incDownloads(id: string): void {
    getDb().prepare('UPDATE shares SET download_count = download_count + 1 WHERE id = ?').run(id);
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM shares WHERE id = ?').run(id);
  },
};

// ===== مخزن مفاتيح/قيم عام =====
export const Kv = {
  get(k: string): string | undefined {
    const r = getDb().prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined;
    return r?.v;
  },
  set(k: string, v: string): void {
    getDb()
      .prepare('INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at')
      .run(k, v, now());
  },
};
