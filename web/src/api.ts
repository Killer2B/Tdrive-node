/**
 * عميل الـ API للواجهة: مصادقة، ملفّات، مجلّدات، رفع مجزّأ قابل للاستئناف،
 * تحميل من الروابط، وبثّ الأحداث (SSE). كل الطلبات بالكوكي (credentials: include).
 */
import { FileItem, ActiveTransfer } from './types';

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

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: options.body && !(options.body instanceof ArrayBuffer) ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = data?.error ?? {};
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
  list: (params: { view?: string; folderId?: string; sort?: string; order?: string; q?: string } = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return req<{ files: ApiFile[]; usage: { usedBytes: number } }>(`/api/files${qs ? `?${qs}` : ''}`);
  },
  patch: (id: string, patch: Record<string, unknown>) =>
    req<{ file: ApiFile }>(`/api/files/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  trash: (id: string) => req(`/api/files/${id}/trash`, { method: 'POST' }),
  restore: (id: string) => req(`/api/files/${id}/restore`, { method: 'POST' }),
  remove: (id: string) => req(`/api/files/${id}`, { method: 'DELETE' }),
  emptyTrash: () => req<{ removed: number }>('/api/files/trash/empty', { method: 'POST' }),
  storage: () => req<{ usedBytes: number }>('/api/storage'),
  streamUrl: (id: string) => `/api/files/${id}/stream`,
  downloadUrl: (id: string) => `/api/files/${id}/download`,
  thumbUrl: (id: string) => `/api/files/${id}/thumbnail`,
};

// ===== التحميل من الروابط =====
export const downloads = {
  probe: (url: string) =>
    req<{
      mode: 'direct' | 'media';
      title?: string;
      durationSec?: number;
      thumbnail?: string;
      uploader?: string;
      filename?: string;
      sizeBytes?: number;
      qualities?: { id: string; label: string; ext: string; height?: number; filesize?: number }[];
    }>('/api/downloads/probe', { method: 'POST', body: JSON.stringify({ url }) }),
  enqueue: (payload: { url: string; mode: 'direct' | 'media'; formatId?: string; folderId?: string | null; name?: string; title?: string }) =>
    req<{ job: ApiJob }>('/api/downloads', { method: 'POST', body: JSON.stringify(payload) }),
  jobs: (status?: string) => req<{ jobs: ApiJob[] }>(`/api/downloads/jobs${status ? `?status=${status}` : ''}`),
  cancel: (id: string) => req(`/api/downloads/jobs/${id}/cancel`, { method: 'POST' }),
  retry: (id: string) => req(`/api/downloads/jobs/${id}/retry`, { method: 'POST' }),
};

export const system = () =>
  req<{ ytdlp: { installed: boolean; version: string | null }; ffmpeg: { installed: boolean }; storageDriver: string; chunkSizeMB: number; maxFileSizeGB: number; backupEnabled: boolean }>(
    '/api/system',
  );

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
  const clientKey = `${file.name}:${file.size}:${file.lastModified}`.slice(0, 128).padEnd(8, '0');

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
  const es = new EventSource('/api/events', { withCredentials: true });
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

export function toFileItem(f: ApiFile, username = 'المالك'): FileItem {
  const initials = username.slice(0, 2).toUpperCase();
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    extension: f.extension ?? undefined,
    size: formatSize(f.sizeBytes),
    sizeBytes: f.sizeBytes,
    modified: formatRelative(f.modified),
    securityTier: 'Zero-Knowledge',
    tags: f.source === 'ytdlp' || f.source === 'url' ? [{ label: 'تحميل', color: 'bg-surface-container-high text-secondary-fixed' }] : [],
    collaborators: [{ name: username, initials, role: 'Owner' }],
    sha256: f.sha256 ?? '',
    path: `/${f.name}`,
    parentId: f.folderId ?? undefined,
    isStarred: f.isStarred,
    isPinned: f.isPinned,
    isDeleted: f.isDeleted,
    deletedDaysLeft: f.isDeleted ? 30 : undefined,
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
