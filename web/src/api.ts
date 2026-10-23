/**
 * عميل الـ API للواجهة: مصادقة، ملفّات، مجلّدات، رفع مجزّأ قابل للاستئناف،
 * تحميل من الروابط، وبثّ الأحداث (SSE). كل الطلبات بالكوكي (credentials: include).
 */
import { FileItem, ActiveTransfer, ExternalLink, ClientNode } from './types';

export interface ApiFile {
  id: string;
  name: string;
  type: FileItem['type'];
  extension?: string | null;
  mime?: string | null;
  sizeBytes: number;
  sha256?: string | null;
  status: string;
  source: string;
  sourceUrl?: string | null;
  folderId?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  hasThumbnail: boolean;
  isStarred: boolean;
  isPinned: boolean;
  isDeleted: boolean;
  modified: number;
  created: number;
  trashedAt?: number | null;
}

export interface ApiJob {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  name: string;
  progress: number;
  speed?: string | null;
  eta?: string | null;
  stage?: string | null;
  totalBytes?: number | null;
  doneBytes?: number | null;
  error?: string | null;
  fileId?: string | null;
  attempts?: number;
  maxAttempts?: number;
}

export interface ApiFolder {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  modified: number;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const apiUrl = (path: string): string => `${API_BASE_URL}${path}`;

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof ArrayBuffer) && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(apiUrl(path), { ...options, credentials: 'include', headers });
  const text = await res.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(
        res.status,
        'BadResponse',
        res.ok
          ? 'استجابة غير متوقّعة من الخادم.'
          : `تعذّر إكمال الطلب (${res.status}). قد تكون المهلة انتهت أو هناك وسيط يعترض — حاول مجددًا.`,
      );
    }
  }
  if (!res.ok) {
    const err = data?.error ?? {};
    if (res.status === 401 && !path.includes('/api/auth/login') && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('tdrive:unauthorized'));
    }
    throw new ApiError(res.status, err.code ?? 'Error', err.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

// ===== المصادقة =====
export const auth = {
  session: () => req<{ user: { id: string; username: string; role: string } | null }>('/api/auth/session'),
  login: (username: string, password: string) =>
    req<{ user: { id: string; username: string; role: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
};

// ===== الملفّات =====
export const files = {
  list: (params: { view?: string; folderId?: string; sort?: string; order?: string; q?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return req<{ files: ApiFile[]; usage: { usedBytes: number } }>(`/api/files${qs ? `?${qs}` : ''}`);
  },
  patch: (id: string, patch: Record<string, unknown>) =>
    req<{ file: ApiFile }>(`/api/files/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  trash: (id: string) => req(`/api/files/${id}/trash`, { method: 'POST' }),
  restore: (id: string) => req(`/api/files/${id}/restore`, { method: 'POST' }),
  remove: (id: string) => req(`/api/files/${id}`, { method: 'DELETE' }),
  emptyTrash: () => req<{ removed: number }>('/api/files/trash/empty', { method: 'POST' }),
  purgeExpiredTrash: () => req<{ removed: number; freedBytes: number }>('/api/files/trash/purge-expired', { method: 'POST' }),
  storage: () => req<{ usedBytes: number }>('/api/storage'),
  streamUrl: (id: string) => `/api/files/${id}/stream`,
  downloadUrl: (id: string) => `/api/files/${id}/download`,
  thumbUrl: (id: string) => `/api/files/${id}/thumbnail`,
};

export const folders = {
  list: (parentId: string | null = null) =>
    req<{ folders: ApiFolder[] }>(`/api/folders?parentId=${encodeURIComponent(parentId ?? 'root')}`),
  create: (name: string, parentId: string | null = null) =>
    req<{ folder: ApiFolder }>('/api/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) }),
};

// ===== التحميل من الروابط =====
export const downloads = {
  probe: (url: string) =>
    req<{
      mode: 'direct' | 'media' | 'error';
      message?: string;
      title?: string;
      durationSec?: number;
      thumbnail?: string;
      uploader?: string;
      filename?: string;
      sizeBytes?: number;
      contentType?: string;
      qualities?: { id: string; label: string; ext: string; height?: number; filesize?: number }[];
    }>('/api/downloads/probe', { method: 'POST', body: JSON.stringify({ url }) }),
  enqueue: (payload: { url: string; mode: 'direct' | 'media'; formatId?: string; folderId?: string | null; name?: string; title?: string }) =>
    req<{ job: ApiJob }>('/api/downloads', { method: 'POST', body: JSON.stringify(payload) }),
  jobs: (status?: string) => req<{ jobs: ApiJob[] }>(`/api/downloads/jobs${status ? `?status=${status}` : ''}`),
  cancel: (id: string) => req(`/api/downloads/jobs/${id}/cancel`, { method: 'POST' }),
  retry: (id: string) => req(`/api/downloads/jobs/${id}/retry`, { method: 'POST' }),
};

export const system = () =>
  req<{ ytdlp: { installed: boolean; version: string | null }; ffmpeg: { installed: boolean }; storageDriver: string; contentBackend: string; chunkSizeMB: number; maxFileSizeGB: number; backupEnabled: boolean }>(
    '/api/system',
  );

// ===== كوكيز يوتيوب =====
export const ytCookies = {
  status: () => req<{ present: boolean; path: string }>('/api/system/cookies'),
  save: (content: string) =>
    req<{ ok: boolean; present: boolean }>('/api/system/cookies', { method: 'POST', body: JSON.stringify({ content }) }),
  clear: () => req<{ ok: boolean; present: boolean }>('/api/system/cookies', { method: 'DELETE' }),
};

// ===== المشاركات =====
export const shares = {
  create: (payload: { fileId: string; password?: string; expiresDays?: number; maxDownloads?: number; label?: string; ipAllow?: string }) =>
    req<{ link: ExternalLink }>('/api/shares', { method: 'POST', body: JSON.stringify(payload) }),
  list: () => req<{ links: ExternalLink[] }>('/api/shares'),
  forFile: (id: string) => req<{ shares: ExternalLink[] }>(`/api/files/${encodeURIComponent(id)}/shares`),
  revoke: (id: string) => req(`/api/shares/${id}/revoke`, { method: 'POST' }),
  remove: (id: string) => req(`/api/shares/${id}`, { method: 'DELETE' }),
};

// ===== الجلسات/الأجهزة =====
export const sessions = {
  list: () => req<{ nodes: ClientNode[] }>('/api/sessions'),
  revoke: (id: string) => req(`/api/sessions/${id}/revoke`, { method: 'POST' }),
};

// ===== الإعدادات =====
export const settings = {
  get: () => req<{ settings: Record<string, unknown> }>('/api/settings'),
  save: (values: Record<string, unknown>) =>
    req<{ settings: Record<string, unknown> }>('/api/settings', { method: 'PUT', body: JSON.stringify(values) }),
};

export interface ApiActivity {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  ip: string | null;
  at: number;
  meta: Record<string, unknown>;
}

export interface ApiVault {
  id: string;
  name: string;
  filesCount: number;
  bytes: number;
  sharesCount: number;
  shared: boolean;
  createdAt: number;
  updatedAt: number;
  activity: number[];
}

export interface OverviewStats {
  activeFiles: number;
  usedBytes: number;
  quotaBytes: number;
  byType: { type: string; count: number; bytes: number; pct: number }[];
  shares: { active: number; views: number; downloads: number };
  storage: { chunkedPct: number; backend: string };
  trash: { count: number; bytes: number };
  pinned: ApiFile[];
  recent: ApiFile[];
  retentionDays: number;
  defaultView: 'grid' | 'list';
}

export interface SecurityStats {
  usedBytes: number;
  quotaBytes: number;
  autoExpandBytes: number;
  byType: OverviewStats['byType'];
  growth: { month: string; label: string; bytes: number; cumulative: number }[];
  ingestPerDayBytes: number;
  runwayDays: number | null;
  dedup: { groups: number; duplicateFiles: number; reclaimableBytes: number; ratio: number };
  recommendations: { kind: string; count: number; bytes: number; sample?: string; olderThanDays?: number }[];
  posture: {
    kdf: string;
    dbDriver: string;
    storageDriver: string;
    contentBackend: string;
    ssrfProtection: boolean;
    cookie: { httpOnly: boolean; secure: boolean; sameSite: string };
    sessions: number;
    https: boolean;
  };
}

export const stats = {
  overview: () => req<OverviewStats>('/api/stats/overview'),
  security: () => req<SecurityStats>('/api/stats/security'),
  dedup: () =>
    req<{
      groups: {
        sha256: string;
        keep: { id: string; name: string; sizeBytes: number };
        duplicates: { id: string; name: string; sizeBytes: number; type: string }[];
        reclaimableBytes: number;
      }[];
      totalReclaimableBytes: number;
      duplicateFiles: number;
    }>('/api/stats/dedup'),
  purgeDuplicates: (ids: string[]) =>
    req<{ removed: number; freedBytes: number }>('/api/stats/dedup/purge', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
};

export const activity = {
  list: (params: { limit?: number; offset?: number; fileId?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    if (params.fileId) query.set('fileId', params.fileId);
    return req<{ items: ApiActivity[]; meta: { total: number; limit: number; offset: number } }>(
      `/api/activity${query.size ? `?${query}` : ''}`,
    );
  },
  exportUrl: (fileId?: string) =>
    apiUrl(`/api/activity/export.csv${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ''}`),
};

export const vaults = {
  list: () => req<{ meta: { activeSessions: number; shares: number }; vaults: ApiVault[] }>('/api/vaults'),
};

export const security = {
  wipePeers: () =>
    req<{ revokedSessions: number; revokedShares: number }>('/api/security/wipe-peers', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'WIPE-CONFIRM' }),
    }),
};

export const account = {
  changePassword: (current: string, next: string) =>
    req<{ ok: boolean }>('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({ current, next }),
    }),
  apiKeys: {
    list: () => req<{ keys: { id: string; label: string; prefix: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null }[] }>('/api/account/api-keys'),
    create: (label: string) =>
      req<{ key: string; metadata: { id: string; label: string; prefix: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null } }>(
        '/api/account/api-keys',
        { method: 'POST', body: JSON.stringify({ label }) },
      ),
    revoke: (id: string) => req<{ ok: boolean }>(`/api/account/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
};

// ===== المشاركة العامّة (بلا تسجيل دخول) =====
export interface PublicMeta {
  ok: boolean;
  reason?: string;
  hasPassword: boolean;
  needsPassword?: boolean;
  wrong?: boolean;
  name?: string;
  type?: string;
  mime?: string;
  sizeBytes?: number;
  inline?: boolean;
  isVideo?: boolean;
  isImage?: boolean;
}
export const publicShare = {
  meta: (token: string, pw?: string) =>
    req<PublicMeta>(`/api/public/${encodeURIComponent(token)}/meta${pw ? `?pw=${encodeURIComponent(pw)}` : ''}`),
  streamUrl: (token: string, pw?: string) =>
    `/api/public/${encodeURIComponent(token)}/stream${pw ? `?pw=${encodeURIComponent(pw)}` : ''}`,
  downloadUrl: (token: string, pw?: string) =>
    `/api/public/${encodeURIComponent(token)}/download${pw ? `?pw=${encodeURIComponent(pw)}` : ''}`,
};

// ===== الرفع المجزّأ القابل للاستئناف =====
async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function rangesToSet(ranges: [number, number][]): Set<number> {
  const s = new Set<number>();
  for (const [a, b] of ranges) for (let i = a; i <= b; i++) s.add(i);
  return s;
}

export interface UploadHandle {
  promise: Promise<ApiFile>;
  cancel: () => void;
}

export function uploadFile(
  file: File,
  opts: { folderId?: string | null; onProgress?: (fraction: number, speed: string) => void } = {},
): UploadHandle {
  const controller = new AbortController();
  const clientKey = `${opts.folderId ?? 'root'}:${file.size}:${file.lastModified}:${file.name}`.slice(0, 128).padEnd(8, '0');

  const run = async (): Promise<ApiFile> => {
    const init = await req<{
      uploadId: string;
      chunkSize: number;
      totalChunks: number;
      received: [number, number][];
      completed: boolean;
      file?: ApiFile;
    }>('/api/uploads/init', {
      method: 'POST',
      body: JSON.stringify({ clientKey, name: file.name, size: file.size, folderId: opts.folderId ?? null }),
    });

    if (init.completed && init.file) return init.file;

    const { uploadId, chunkSize, totalChunks } = init;
    const received = rangesToSet(init.received);
    let doneChunks = received.size;
    const startTs = Date.now();
    let sentBytes = 0;

    for (let idx = 0; idx < totalChunks; idx++) {
      if (controller.signal.aborted) throw new ApiError(0, 'Canceled', 'أُلغي الرفع');
      if (received.has(idx)) continue;
      const start = idx * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const blob = file.slice(start, end);
      const buf = await blob.arrayBuffer();
      const sha = await sha256Hex(buf);

      const res = await fetch(`/api/uploads/${uploadId}/parts/${idx}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream', 'x-chunk-sha256': sha },
        body: buf,
        signal: controller.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new ApiError(res.status, 'UploadPart', t || `فشل رفع الجزء ${idx}`);
      }
      doneChunks++;
      sentBytes += end - start;
      const elapsed = (Date.now() - startTs) / 1000;
      const speed = elapsed > 0 ? `${(sentBytes / 1024 / 1024 / elapsed).toFixed(1)} MB/s` : '';
      opts.onProgress?.(doneChunks / totalChunks, speed);
    }

    const done = await req<{ file: ApiFile }>(`/api/uploads/${uploadId}/complete`, { method: 'POST' });
    opts.onProgress?.(1, '');
    return done.file;
  };

  return { promise: run(), cancel: () => controller.abort() };
}

// ===== أحداث لحظية (SSE) =====
export function connectEvents(onJob: (job: ApiJob) => void): () => void {
  const es = new EventSource(apiUrl('/api/events'), { withCredentials: true });
  es.addEventListener('job', (e) => {
    try {
      onJob(JSON.parse((e as MessageEvent).data));
    } catch {
      /* تجاهل */
    }
  });
  return () => es.close();
}

// ===== محوّلات العرض =====
export function formatSize(bytes?: number | null): string {
  if (!bytes || bytes < 1) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${Number(val.toFixed(i === 0 ? 0 : 1))} ${units[i]}`;
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const d = Math.floor(h / 24);
  if (d < 30) return `قبل ${d} يوم`;
  return new Date(ts).toLocaleDateString();
}

export function toFileItem(f: ApiFile, retentionDays = 30): FileItem {
  const deletedDaysLeft =
    f.isDeleted && f.trashedAt
      ? Math.max(0, retentionDays - Math.floor((Date.now() - f.trashedAt) / 86_400_000))
      : undefined;
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    extension: f.extension ?? undefined,
    size: formatSize(f.sizeBytes),
    sizeBytes: f.sizeBytes,
    modified: formatRelative(f.modified),
    modifiedTs: f.modified,
    sha256: f.sha256 ?? '',
    parentId: f.folderId ?? undefined,
    isStarred: f.isStarred,
    isPinned: f.isPinned,
    isDeleted: f.isDeleted,
    trashedAt: f.trashedAt ?? undefined,
    deletedDaysLeft,
    previewUrl: f.hasThumbnail ? files.thumbUrl(f.id) : undefined,
    technicalSpecs: f.type === 'video' ? {
      resolution: f.width && f.height ? `${f.width} × ${f.height}` : undefined,
    } : undefined,
  };
}

export function jobToTransfer(j: ApiJob): ActiveTransfer {
  const status: ActiveTransfer['status'] =
    j.status === 'done' ? 'complete' : j.status === 'queued' ? 'queued' : j.status === 'running' ? 'uploading' : 'paused';
  return {
    id: j.id,
    name: j.name,
    progress: Math.round(j.progress),
    speed: j.speed ?? (j.stage ?? ''),
    currentSize: formatSize(j.doneBytes),
    totalSize: formatSize(j.totalBytes),
    status,
  };
}
