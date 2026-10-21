/**
 * طبقة الوصول للبيانات (repositories) فوق Postgres/Supabase.
 * كل الدوال غير متزامنة (async) وتعمل على مخطّط `tdrive` المُنشأ عبر Supabase MCP.
 */
import { exec, one, query, scalar, tb } from './pg.ts';
import { newId } from '../lib/ids.ts';

const now = (): number => Date.now();
const bool = (v: boolean | undefined): number => (v ? 1 : 0);

/** jsonb يُقرأ ككائن من pg؛ نُبقيه نصًّا في واجهة repo كما كان في SQLite. */
const jsonText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v ?? {}));
const jsonTextOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : jsonText(v));

function buildSet(
  patch: Record<string, unknown>,
  allowed: readonly string[],
): { sets: string; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of allowed) {
    if (k in patch) {
      params.push(patch[k] ?? null);
      sets.push(`"${k}" = $${params.length}`);
    }
  }
  return { sets: sets.join(', '), params };
}

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
  mime: string | null;
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
  permission: 'view' | 'download';
  created_at: number;
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  label: string;
  key_hash: string;
  key_prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

/** يُعيد صفّ المهمّة بصيغة نصّية لحقول jsonb (توافقًا مع واجهة repo القديمة). */
function normalizeJob(row: JobRow): JobRow {
  return { ...row, payload: jsonText(row.payload), result: jsonTextOrNull(row.result) };
}

// ===== المستخدمون =====
export const Users = {
  async create(input: { username: string; password_hash: string; role?: string }): Promise<UserRow> {
    const row: UserRow = {
      id: newId('usr'),
      username: input.username,
      password_hash: input.password_hash,
      role: input.role ?? 'owner',
      created_at: now(),
      updated_at: now(),
    };
    await exec(
      `INSERT INTO ${tb('users')} (id, username, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, row.username, row.password_hash, row.role, row.created_at, row.updated_at],
    );
    return row;
  },
  async findByUsername(username: string): Promise<UserRow | undefined> {
    return one<UserRow>(`SELECT * FROM ${tb('users')} WHERE username = $1`, [username]);
  },
  async findById(id: string): Promise<UserRow | undefined> {
    return one<UserRow>(`SELECT * FROM ${tb('users')} WHERE id = $1`, [id]);
  },
  async updatePassword(id: string, password_hash: string): Promise<void> {
    await exec(`UPDATE ${tb('users')} SET password_hash = $1, updated_at = $2 WHERE id = $3`, [password_hash, now(), id]);
  },
  async count(): Promise<number> {
    return scalar(`SELECT COUNT(*) AS c FROM ${tb('users')}`);
  },
};

// ===== الجلسات =====
export const Sessions = {
  async create(input: { user_id: string; ttlMs: number; user_agent?: string; ip?: string }): Promise<SessionRow> {
    const row: SessionRow = {
      id: newId('ses'),
      user_id: input.user_id,
      created_at: now(),
      expires_at: now() + input.ttlMs,
      user_agent: input.user_agent ?? null,
      ip: input.ip ?? null,
    };
    await exec(
      `INSERT INTO ${tb('sessions')} (id, user_id, created_at, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, row.user_id, row.created_at, row.expires_at, row.user_agent, row.ip],
    );
    return row;
  },
  async find(id: string): Promise<SessionRow | undefined> {
    return one<SessionRow>(`SELECT * FROM ${tb('sessions')} WHERE id = $1`, [id]);
  },
  async delete(id: string): Promise<void> {
    await exec(`DELETE FROM ${tb('sessions')} WHERE id = $1`, [id]);
  },
  async deleteExpired(): Promise<number> {
    return exec(`DELETE FROM ${tb('sessions')} WHERE expires_at < $1`, [now()]);
  },
  async deleteAllForUser(user_id: string): Promise<void> {
    await exec(`DELETE FROM ${tb('sessions')} WHERE user_id = $1`, [user_id]);
  },
  async listByUser(user_id: string): Promise<SessionRow[]> {
    return query<SessionRow>(
      `SELECT * FROM ${tb('sessions')} WHERE user_id = $1 ORDER BY created_at DESC`,
      [user_id],
    );
  },
};

// ===== المجلّدات =====
export const Folders = {
  async create(input: { user_id: string; parent_id: string | null; name: string; path: string }): Promise<FolderRow> {
    const row: FolderRow = {
      id: newId('fld'),
      user_id: input.user_id,
      parent_id: input.parent_id,
      name: input.name,
      path: input.path,
      created_at: now(),
      updated_at: now(),
    };
    await exec(
      `INSERT INTO ${tb('folders')} (id, user_id, parent_id, name, path, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, row.user_id, row.parent_id, row.name, row.path, row.created_at, row.updated_at],
    );
    return row;
  },
  async findById(id: string): Promise<FolderRow | undefined> {
    return one<FolderRow>(`SELECT * FROM ${tb('folders')} WHERE id = $1`, [id]);
  },
  async findByParentName(user_id: string, parent_id: string | null, name: string): Promise<FolderRow | undefined> {
    return one<FolderRow>(
      `SELECT * FROM ${tb('folders')} WHERE user_id = $1 AND COALESCE(parent_id, '') = COALESCE($2::text, '') AND name = $3`,
      [user_id, parent_id, name],
    );
  },
  async findByPath(user_id: string, path: string): Promise<FolderRow | undefined> {
    return one<FolderRow>(`SELECT * FROM ${tb('folders')} WHERE user_id = $1 AND path = $2`, [user_id, path]);
  },
  async listChildren(user_id: string, parent_id: string | null): Promise<FolderRow[]> {
    return query<FolderRow>(
      `SELECT * FROM ${tb('folders')} WHERE user_id = $1 AND COALESCE(parent_id, '') = COALESCE($2::text, '') ORDER BY lower(name)`,
      [user_id, parent_id],
    );
  },
  async rename(id: string, name: string, path: string): Promise<void> {
    await exec(`UPDATE ${tb('folders')} SET name = $1, path = $2, updated_at = $3 WHERE id = $4`, [name, path, now(), id]);
  },
  async move(id: string, parent_id: string | null, name: string, path: string): Promise<void> {
    await exec(`UPDATE ${tb('folders')} SET parent_id = $1, name = $2, path = $3, updated_at = $4 WHERE id = $5`, [
      parent_id,
      name,
      path,
      now(),
      id,
    ]);
  },
  async delete(id: string): Promise<void> {
    await exec(`DELETE FROM ${tb('folders')} WHERE id = $1`, [id]);
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
  name: 'lower(name)',
  size: 'size',
  modified: 'updated_at',
  created: 'created_at',
};

export const Files = {
  async create(input: Partial<FileRow> & { user_id: string; name: string }): Promise<FileRow> {
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
    await exec(
      `INSERT INTO ${tb('files')} (id,user_id,folder_id,name,ext,type,mime,size,storage_key,sha256,status,source,source_url,
          thumb_key,duration,width,height,starred,pinned,trashed,trashed_at,backend,chunk_size,thumb_tg_file_id,
          thumb_tg_message_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [
        row.id, row.user_id, row.folder_id, row.name, row.ext, row.type, row.mime, row.size, row.storage_key,
        row.sha256, row.status, row.source, row.source_url, row.thumb_key, row.duration, row.width, row.height,
        row.starred, row.pinned, row.trashed, row.trashed_at, row.backend, row.chunk_size, row.thumb_tg_file_id,
        row.thumb_tg_message_id, row.created_at, row.updated_at,
      ],
    );
    return row;
  },
  async findById(id: string): Promise<FileRow | undefined> {
    return one<FileRow>(`SELECT * FROM ${tb('files')} WHERE id = $1`, [id]);
  },
  async findByFolderAndName(user_id: string, folder_id: string | null, name: string): Promise<FileRow | undefined> {
    return one<FileRow>(
      `SELECT * FROM ${tb('files')} WHERE user_id = $1 AND COALESCE(folder_id, '') = COALESCE($2::text, '') AND name = $3 AND trashed = 0`,
      [user_id, folder_id, name],
    );
  },
  async list(user_id: string, opts: FileListOptions = {}): Promise<FileRow[]> {
    const sort = SORT_COLUMN[opts.sort ?? 'modified'];
    const order = opts.order === 'asc' ? 'ASC' : 'DESC';
    const trashed = bool(opts.trashed);
    const limit = Math.min(opts.limit ?? 500, 2000);
    const offset = opts.offset ?? 0;
    if (opts.folderId === undefined) {
      return query<FileRow>(
        `SELECT * FROM ${tb('files')} WHERE user_id = $1 AND trashed = $2 ORDER BY ${sort} ${order} LIMIT $3 OFFSET $4`,
        [user_id, trashed, limit, offset],
      );
    }
    return query<FileRow>(
      `SELECT * FROM ${tb('files')} WHERE user_id = $1 AND COALESCE(folder_id,'') = COALESCE($2::text, '') AND trashed = $3
       ORDER BY ${sort} ${order} LIMIT $4 OFFSET $5`,
      [user_id, opts.folderId, trashed, limit, offset],
    );
  },
  async search(user_id: string, q: string, limit = 100): Promise<FileRow[]> {
    const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    return query<FileRow>(
      `SELECT * FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 AND name ILIKE $2 ESCAPE '\\'
       ORDER BY updated_at DESC LIMIT $3`,
      [user_id, like, limit],
    );
  },
  async recent(user_id: string, limit = 50, offset = 0): Promise<FileRow[]> {
    return query<FileRow>(
      `SELECT * FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
      [user_id, limit, offset],
    );
  },
  async starred(user_id: string, limit = 200, offset = 0): Promise<FileRow[]> {
    return query<FileRow>(
      `SELECT * FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 AND starred = 1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
      [user_id, limit, offset],
    );
  },
  async trashList(user_id: string): Promise<FileRow[]> {
    return query<FileRow>(
      `SELECT * FROM ${tb('files')} WHERE user_id = $1 AND trashed = 1 ORDER BY trashed_at DESC`,
      [user_id],
    );
  },
  async update(id: string, patch: Partial<FileRow>): Promise<void> {
    const allowed = [
      'folder_id', 'name', 'ext', 'type', 'mime', 'size', 'storage_key', 'sha256', 'status',
      'source_url', 'thumb_key', 'duration', 'width', 'height', 'starred', 'pinned', 'trashed', 'trashed_at',
      'backend', 'chunk_size', 'thumb_tg_file_id', 'thumb_tg_message_id',
    ] as const;
    const { sets, params } = buildSet(patch as Record<string, unknown>, allowed);
    if (sets.length === 0) return;
    params.push(now(), id);
    await exec(`UPDATE ${tb('files')} SET ${sets}, updated_at = $${params.length - 1} WHERE id = $${params.length}`, params);
  },
  async setTrashed(id: string, trashed: boolean): Promise<void> {
    await exec(`UPDATE ${tb('files')} SET trashed = $1, trashed_at = $2, updated_at = $3 WHERE id = $4`, [
      bool(trashed),
      trashed ? now() : null,
      now(),
      id,
    ]);
  },
  async delete(id: string): Promise<void> {
    await exec(`DELETE FROM ${tb('files')} WHERE id = $1`, [id]);
  },
  async usedBytes(user_id: string): Promise<number> {
    return scalar(
      `SELECT COALESCE(SUM(size), 0)::bigint AS s FROM ${tb('files')} WHERE user_id = $1 AND status = 'ready'`,
      [user_id],
    );
  },
};

// ===== قطع المحتوى (Telegram/الكاش) =====
export const FileChunks = {
  async add(input: {
    file_id: string;
    idx: number;
    size: number;
    sha256: string | null;
    cached?: boolean;
    tg_message_id?: number | null;
    tg_file_id?: string | null;
  }): Promise<void> {
    await exec(
      `INSERT INTO ${tb('file_chunks')} (file_id, idx, size, sha256, tg_message_id, tg_file_id, cached)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (file_id, idx) DO UPDATE SET size = EXCLUDED.size, sha256 = EXCLUDED.sha256`,
      [input.file_id, input.idx, input.size, input.sha256, input.tg_message_id ?? null, input.tg_file_id ?? null, input.cached === false ? 0 : 1],
    );
  },
  async listByFile(file_id: string): Promise<FileChunkRow[]> {
    return query<FileChunkRow>(`SELECT * FROM ${tb('file_chunks')} WHERE file_id = $1 ORDER BY idx`, [file_id]);
  },
  async lookupHashes(user_id: string, hashes: string[]): Promise<string[]> {
    if (hashes.length === 0) return [];
    const placeholders = hashes.map((_, i) => `$${i + 2}`).join(',');
    const rows = await query<{ sha256: string }>(
      `SELECT DISTINCT c.sha256 FROM ${tb('file_chunks')} c
       JOIN ${tb('files')} f ON f.id = c.file_id
       WHERE f.user_id = $1 AND f.trashed = 0 AND f.status = 'ready'
         AND c.sha256 IN (${placeholders})`,
      [user_id, ...hashes],
    );
    return rows.map((row) => row.sha256);
  },
  async get(file_id: string, idx: number): Promise<FileChunkRow | undefined> {
    return one<FileChunkRow>(`SELECT * FROM ${tb('file_chunks')} WHERE file_id = $1 AND idx = $2`, [file_id, idx]);
  },
  async setTg(file_id: string, idx: number, tg_message_id: number, tg_file_id: string): Promise<void> {
    await exec(`UPDATE ${tb('file_chunks')} SET tg_message_id = $1, tg_file_id = $2 WHERE file_id = $3 AND idx = $4`, [
      tg_message_id,
      tg_file_id,
      file_id,
      idx,
    ]);
  },
  async setCached(file_id: string, idx: number, cached: boolean): Promise<void> {
    await exec(`UPDATE ${tb('file_chunks')} SET cached = $1 WHERE file_id = $2 AND idx = $3`, [bool(cached), file_id, idx]);
  },
  async pending(file_id: string): Promise<FileChunkRow[]> {
    return query<FileChunkRow>(
      `SELECT * FROM ${tb('file_chunks')} WHERE file_id = $1 AND tg_file_id IS NULL ORDER BY idx`,
      [file_id],
    );
  },
  async countPending(file_id: string): Promise<number> {
    return scalar(
      `SELECT COUNT(*) AS c FROM ${tb('file_chunks')} WHERE file_id = $1 AND tg_file_id IS NULL`,
      [file_id],
    );
  },
  async deleteByFile(file_id: string): Promise<void> {
    await exec(`DELETE FROM ${tb('file_chunks')} WHERE file_id = $1`, [file_id]);
  },
};

// ===== جلسات الرفع =====
export const Uploads = {
  async create(input: {
    user_id: string;
    client_key: string;
    folder_id: string | null;
    name: string;
    mime?: string | null;
    size: number;
    chunk_size: number;
    total_chunks: number;
    fingerprint: string | null;
    ttlMs: number;
  }): Promise<UploadRow> {
    const ts = now();
    const row: UploadRow = {
      id: newId('upl'),
      user_id: input.user_id,
      client_key: input.client_key,
      folder_id: input.folder_id,
      name: input.name,
      mime: input.mime ?? null,
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
    await exec(
      `INSERT INTO ${tb('uploads')} (id,user_id,client_key,folder_id,name,mime,size,chunk_size,total_chunks,fingerprint,status,file_id,created_at,updated_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        row.id, row.user_id, row.client_key, row.folder_id, row.name, row.mime, row.size, row.chunk_size,
        row.total_chunks, row.fingerprint, row.status, row.file_id, row.created_at, row.updated_at, row.expires_at,
      ],
    );
    return row;
  },
  async findById(id: string): Promise<UploadRow | undefined> {
    return one<UploadRow>(`SELECT * FROM ${tb('uploads')} WHERE id = $1`, [id]);
  },
  async findByClientKey(user_id: string, client_key: string): Promise<UploadRow | undefined> {
    return one<UploadRow>(`SELECT * FROM ${tb('uploads')} WHERE user_id = $1 AND client_key = $2`, [user_id, client_key]);
  },
  async touch(id: string): Promise<void> {
    await exec(`UPDATE ${tb('uploads')} SET updated_at = $1 WHERE id = $2`, [now(), id]);
  },
  async setStatus(id: string, status: UploadRow['status'], file_id?: string | null): Promise<void> {
    await exec(`UPDATE ${tb('uploads')} SET status = $1, file_id = $2, updated_at = $3 WHERE id = $4`, [
      status,
      file_id ?? null,
      now(),
      id,
    ]);
  },
  async addChunk(upload_id: string, idx: number, size: number, sha256: string): Promise<void> {
    await exec(
      `INSERT INTO ${tb('upload_chunks')} (upload_id, idx, size, sha256, received_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (upload_id, idx) DO UPDATE SET size = EXCLUDED.size, sha256 = EXCLUDED.sha256, received_at = EXCLUDED.received_at`,
      [upload_id, idx, size, sha256, now()],
    );
  },
  async getChunk(upload_id: string, idx: number): Promise<{ idx: number; size: number; sha256: string } | undefined> {
    return one<{ idx: number; size: number; sha256: string }>(
      `SELECT idx, size, sha256 FROM ${tb('upload_chunks')} WHERE upload_id = $1 AND idx = $2`,
      [upload_id, idx],
    );
  },
  async receivedIndexes(upload_id: string): Promise<number[]> {
    const rows = await query<{ idx: number }>(
      `SELECT idx FROM ${tb('upload_chunks')} WHERE upload_id = $1 ORDER BY idx`,
      [upload_id],
    );
    return rows.map((r) => r.idx);
  },
  async chunkHashesOrdered(upload_id: string): Promise<Array<{ idx: number; size: number; sha256: string }>> {
    return query<{ idx: number; size: number; sha256: string }>(
      `SELECT idx, size, sha256 FROM ${tb('upload_chunks')} WHERE upload_id = $1 ORDER BY idx`,
      [upload_id],
    );
  },
  async listExpiredPending(): Promise<UploadRow[]> {
    return query<UploadRow>(
      `SELECT * FROM ${tb('uploads')} WHERE status = 'pending' AND expires_at < $1`,
      [now()],
    );
  },
  async delete(id: string): Promise<void> {
    await exec(`DELETE FROM ${tb('uploads')} WHERE id = $1`, [id]);
  },
};

// ===== المهام (الطابور) =====
export const Jobs = {
  async create(input: {
    user_id: string;
    type: string;
    payload: unknown;
    title?: string;
    max_attempts: number;
    run_after?: number;
  }): Promise<JobRow> {
    const ts = now();
    const payload = JSON.stringify(input.payload ?? {});
    const row: JobRow = {
      id: newId('job'),
      user_id: input.user_id,
      type: input.type,
      status: 'queued',
      payload,
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
    await exec(
      `INSERT INTO ${tb('jobs')} (id,user_id,type,status,payload,title,progress,speed,eta,stage,total_bytes,done_bytes,
          attempts,max_attempts,lease_until,lease_owner,cancel_req,error,result,file_id,run_after,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23)`,
      [
        row.id, row.user_id, row.type, row.status, payload, row.title, row.progress, row.speed, row.eta, row.stage,
        row.total_bytes, row.done_bytes, row.attempts, row.max_attempts, row.lease_until, row.lease_owner, row.cancel_req,
        row.error, null, row.file_id, row.run_after, row.created_at, row.updated_at,
      ],
    );
    return row;
  },
  async findById(id: string): Promise<JobRow | undefined> {
    const row = await one<JobRow>(`SELECT * FROM ${tb('jobs')} WHERE id = $1`, [id]);
    return row ? normalizeJob(row) : undefined;
  },
  async claimNext(leaseOwner: string, leaseMs: number): Promise<JobRow | undefined> {
    const ts = now();
    const rows = await query<JobRow>(
      `UPDATE ${tb('jobs')} SET status='running', lease_owner=$1, lease_until=$2, attempts=attempts+1, updated_at=$3
       WHERE id = (
         SELECT id FROM ${tb('jobs')} WHERE status='queued' AND run_after <= $3 ORDER BY run_after, created_at LIMIT 1
       )
       RETURNING *`,
      [leaseOwner, ts + leaseMs, ts],
    );
    return rows[0] ? normalizeJob(rows[0]) : undefined;
  },
  async renewLease(id: string, leaseMs: number): Promise<void> {
    await exec(`UPDATE ${tb('jobs')} SET lease_until = $1, updated_at = $2 WHERE id = $3`, [now() + leaseMs, now(), id]);
  },
  async reclaimStale(): Promise<number> {
    return exec(
      `UPDATE ${tb('jobs')} SET status='queued', lease_owner=NULL WHERE status='running' AND lease_until < $1`,
      [now()],
    );
  },
  async progress(
    id: string,
    patch: Partial<Pick<JobRow, 'progress' | 'speed' | 'eta' | 'stage' | 'total_bytes' | 'done_bytes'>>,
  ): Promise<void> {
    const { sets, params } = buildSet(patch as Record<string, unknown>, [
      'progress', 'speed', 'eta', 'stage', 'total_bytes', 'done_bytes',
    ]);
    if (sets.length === 0) return;
    params.push(now(), id);
    await exec(`UPDATE ${tb('jobs')} SET ${sets}, updated_at = $${params.length - 1} WHERE id = $${params.length}`, params);
  },
  async complete(id: string, result: unknown, file_id?: string | null): Promise<void> {
    await exec(
      `UPDATE ${tb('jobs')} SET status='done', progress=100, result=$1::jsonb, file_id=$2, error=NULL, lease_owner=NULL, lease_until=NULL, updated_at=$3 WHERE id=$4`,
      [JSON.stringify(result ?? {}), file_id ?? null, now(), id],
    );
  },
  async fail(id: string, error: string, retryAfter?: number): Promise<void> {
    if (retryAfter !== undefined) {
      await exec(
        `UPDATE ${tb('jobs')} SET status='queued', error=$1, run_after=$2, lease_owner=NULL, lease_until=NULL, updated_at=$3 WHERE id=$4`,
        [error, retryAfter, now(), id],
      );
    } else {
      await exec(
        `UPDATE ${tb('jobs')} SET status='error', error=$1, lease_owner=NULL, lease_until=NULL, updated_at=$2 WHERE id=$3`,
        [error, now(), id],
      );
    }
  },
  async requestCancel(id: string): Promise<void> {
    await exec(`UPDATE ${tb('jobs')} SET cancel_req = 1, updated_at = $1 WHERE id = $2`, [now(), id]);
  },
  async markCanceled(id: string): Promise<void> {
    await exec(`UPDATE ${tb('jobs')} SET status='canceled', lease_owner=NULL, lease_until=NULL, updated_at=$1 WHERE id=$2`, [
      now(),
      id,
    ]);
  },
  async requeue(id: string): Promise<void> {
    await exec(
      `UPDATE ${tb('jobs')} SET status='queued', cancel_req=0, error=NULL, run_after=0, lease_owner=NULL, lease_until=NULL, updated_at=$1 WHERE id=$2`,
      [now(), id],
    );
  },
  async isCancelRequested(id: string): Promise<boolean> {
    const r = await one<{ cancel_req: number }>(`SELECT cancel_req FROM ${tb('jobs')} WHERE id = $1`, [id]);
    return !!r && r.cancel_req === 1;
  },
  async listByUser(user_id: string, statuses?: string[]): Promise<JobRow[]> {
    if (statuses && statuses.length > 0) {
      const placeholders = statuses.map((_, i) => `$${i + 2}`).join(',');
      const rows = await query<JobRow>(
        `SELECT * FROM ${tb('jobs')} WHERE user_id = $1 AND status IN (${placeholders}) ORDER BY created_at DESC LIMIT 500`,
        [user_id, ...statuses],
      );
      return rows.map(normalizeJob);
    }
    const rows = await query<JobRow>(`SELECT * FROM ${tb('jobs')} WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`, [
      user_id,
    ]);
    return rows.map(normalizeJob);
  },
  async deleteDoneBefore(ts: number): Promise<number> {
    return exec(
      `DELETE FROM ${tb('jobs')} WHERE status IN ('done','canceled','error') AND updated_at < $1`,
      [ts],
    );
  },
};

// ===== الإعدادات =====
export const Settings = {
  async get(user_id: string, key: string): Promise<unknown> {
    const r = await one<{ value: unknown }>(
      `SELECT value FROM ${tb('settings')} WHERE user_id = $1 AND key = $2`,
      [user_id, key],
    );
    if (!r) return undefined;
    return typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
  },
  async getAll(user_id: string): Promise<Record<string, unknown>> {
    const rows = await query<{ key: string; value: unknown }>(
      `SELECT key, value FROM ${tb('settings')} WHERE user_id = $1`,
      [user_id],
    );
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
    return out;
  },
  async set(user_id: string, key: string, value: unknown): Promise<void> {
    await exec(
      `INSERT INTO ${tb('settings')} (user_id, key, value, updated_at) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [user_id, key, JSON.stringify(value), now()],
    );
  },
};

// ===== المشاركات =====
export const Shares = {
  async create(input: {
    user_id: string;
    file_id: string | null;
    folder_id: string | null;
    token: string;
    label?: string;
    password_hash?: string | null;
    expires_at?: number | null;
    max_downloads?: number | null;
    ip_allow?: string | null;
    permission?: 'view' | 'download';
  }): Promise<ShareRow> {
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
      permission: input.permission ?? 'download',
      created_at: now(),
    };
    await exec(
      `INSERT INTO ${tb('shares')} (id,user_id,file_id,folder_id,token,label,password_hash,expires_at,max_downloads,download_count,views_count,revoked,ip_allow,permission,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        row.id, row.user_id, row.file_id, row.folder_id, row.token, row.label, row.password_hash, row.expires_at,
        row.max_downloads, row.download_count, row.views_count, row.revoked, row.ip_allow, row.permission, row.created_at,
      ],
    );
    return row;
  },
  async findByToken(token: string): Promise<ShareRow | undefined> {
    return one<ShareRow>(`SELECT * FROM ${tb('shares')} WHERE token = $1`, [token]);
  },
  async findById(id: string): Promise<ShareRow | undefined> {
    return one<ShareRow>(`SELECT * FROM ${tb('shares')} WHERE id = $1`, [id]);
  },
  async listByUser(user_id: string): Promise<ShareRow[]> {
    return query<ShareRow>(`SELECT * FROM ${tb('shares')} WHERE user_id = $1 ORDER BY created_at DESC`, [user_id]);
  },
  async listByFile(user_id: string, file_id: string): Promise<ShareRow[]> {
    return query<ShareRow>(
      `SELECT * FROM ${tb('shares')} WHERE user_id = $1 AND file_id = $2 ORDER BY created_at DESC`,
      [user_id, file_id],
    );
  },
  async revoke(id: string): Promise<void> {
    await exec(`UPDATE ${tb('shares')} SET revoked = 1 WHERE id = $1`, [id]);
  },
  async incViews(id: string): Promise<void> {
    await exec(`UPDATE ${tb('shares')} SET views_count = views_count + 1 WHERE id = $1`, [id]);
  },
  async incDownloads(id: string): Promise<void> {
    await exec(`UPDATE ${tb('shares')} SET download_count = download_count + 1 WHERE id = $1`, [id]);
  },
  async delete(id: string): Promise<void> {
    await exec(`DELETE FROM ${tb('shares')} WHERE id = $1`, [id]);
  },
};

// ===== مفاتيح API =====
export const ApiKeys = {
  async create(input: { user_id: string; label: string; key_hash: string; key_prefix: string }): Promise<ApiKeyRow> {
    const row: ApiKeyRow = {
      id: newId('key'),
      user_id: input.user_id,
      label: input.label,
      key_hash: input.key_hash,
      key_prefix: input.key_prefix,
      created_at: now(),
      last_used_at: null,
      revoked_at: null,
    };
    await exec(
      `INSERT INTO ${tb('api_keys')} (id, user_id, label, key_hash, key_prefix, created_at, last_used_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.id, row.user_id, row.label, row.key_hash, row.key_prefix, row.created_at, row.last_used_at, row.revoked_at],
    );
    return row;
  },
  async findActiveByHash(key_hash: string): Promise<ApiKeyRow | undefined> {
    return one<ApiKeyRow>(`SELECT * FROM ${tb('api_keys')} WHERE key_hash = $1 AND revoked_at IS NULL`, [key_hash]);
  },
  async listByUser(user_id: string): Promise<Omit<ApiKeyRow, 'key_hash'>[]> {
    return query<Omit<ApiKeyRow, 'key_hash'>>(
      `SELECT id, user_id, label, key_prefix, created_at, last_used_at, revoked_at
       FROM ${tb('api_keys')} WHERE user_id = $1 ORDER BY created_at DESC`,
      [user_id],
    );
  },
  async countActive(user_id: string): Promise<number> {
    return scalar(
      `SELECT COUNT(*) AS count FROM ${tb('api_keys')} WHERE user_id = $1 AND revoked_at IS NULL`,
      [user_id],
    );
  },
  async touch(id: string): Promise<void> {
    await exec(`UPDATE ${tb('api_keys')} SET last_used_at = $1 WHERE id = $2 AND revoked_at IS NULL`, [now(), id]);
  },
  async revoke(user_id: string, id: string): Promise<boolean> {
    const changes = await exec(
      `UPDATE ${tb('api_keys')} SET revoked_at = $1 WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL`,
      [now(), id, user_id],
    );
    return changes > 0;
  },
};

// ===== سجلّ النشاط =====
export const Activity = {
  async insert(input: {
    user_id: string;
    id: string;
    action: string;
    target_type?: string | null;
    target_id?: string | null;
    target_name?: string | null;
    ip?: string | null;
    meta?: unknown;
  }): Promise<void> {
    await exec(
      `INSERT INTO ${tb('activity_log')} (id, user_id, action, target_type, target_id, target_name, ip, meta, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        input.id,
        input.user_id,
        input.action,
        input.target_type ?? null,
        input.target_id ?? null,
        input.target_name ?? null,
        input.ip ?? null,
        input.meta === undefined ? null : JSON.stringify(input.meta),
        now(),
      ],
    );
  },
  async list(user_id: string, opts: { limit: number; fileId?: string | null }): Promise<ActivityRow[]> {
    if (opts.fileId) {
      return query<ActivityRow>(
        `SELECT * FROM ${tb('activity_log')} WHERE user_id = $1 AND target_id = $2 ORDER BY created_at DESC LIMIT $3`,
        [user_id, opts.fileId, opts.limit],
      );
    }
    return query<ActivityRow>(
      `SELECT * FROM ${tb('activity_log')} WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [user_id, opts.limit],
    );
  },
  async count(user_id: string, targetId?: string | null): Promise<number> {
    if (targetId) {
      return scalar(
        `SELECT COUNT(*) AS count FROM ${tb('activity_log')} WHERE user_id = $1 AND target_id = $2`,
        [user_id, targetId],
      );
    }
    return scalar(`SELECT COUNT(*) AS count FROM ${tb('activity_log')} WHERE user_id = $1`, [user_id]);
  },
};

export interface ActivityRow {
  id: string;
  user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  ip: string | null;
  meta: unknown;
  created_at: number;
}

// ===== مخزن مفاتيح/قيم عام =====
export const Kv = {
  async get(k: string): Promise<string | undefined> {
    const r = await one<{ v: string }>(`SELECT v FROM ${tb('kv')} WHERE k = $1`, [k]);
    return r?.v;
  },
  async set(k: string, v: string): Promise<void> {
    await exec(
      `INSERT INTO ${tb('kv')} (k, v, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at`,
      [k, v, now()],
    );
  },
};
