import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/db.ts';
import { Files, Settings, Shares, type FileRow } from '../db/repo.ts';
import { errors } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { requireUser } from '../plugins/auth.ts';
import { toApiFile, deleteFilePermanent } from '../services/files.ts';
import { Activity } from '../services/activity.ts';
import { loadConfig } from '../config/env.ts';
import { toApiShare } from './shares.ts';

const DEFAULT_QUOTA_BYTES = 5_000_000_000_000;

function workspaceSettings(userId: string): Record<string, unknown> {
  const value = Settings.get(userId, 'workspace');
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function quotaBytes(userId: string): number {
  const value = workspaceSettings(userId).quotaBytes;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_QUOTA_BYTES;
}

function retentionDays(userId: string): number {
  const value = workspaceSettings(userId).retentionDays;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3650 ? value : 30;
}

function aggregateTypes(userId: string): Array<{ type: string; count: number; bytes: number; pct: number }> {
  const rows = getDb()
    .prepare(
      `SELECT type, COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
       FROM files WHERE user_id = ? AND trashed = 0 AND status = 'ready'
       GROUP BY type ORDER BY bytes DESC`,
    )
    .all(userId) as Array<{ type: string; count: number; bytes: number }>;
  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  return rows.map((row) => ({
    ...row,
    pct: total ? Math.round((row.bytes / total) * 1000) / 10 : 0,
  }));
}

function duplicateGroups(userId: string) {
  const db = getDb();
  const hashes = db
    .prepare(
      `SELECT sha256 FROM files
       WHERE user_id = ? AND trashed = 0 AND status = 'ready' AND sha256 IS NOT NULL AND sha256 != ''
       GROUP BY sha256 HAVING COUNT(*) > 1`,
    )
    .all(userId) as Array<{ sha256: string }>;
  return hashes.map(({ sha256 }) => {
    const files = db
      .prepare(
        `SELECT id, name, type, size, created_at FROM files
         WHERE user_id = ? AND sha256 = ? AND trashed = 0 AND status = 'ready'
         ORDER BY created_at ASC, id ASC`,
      )
      .all(userId, sha256) as Array<{ id: string; name: string; type: string; size: number; created_at: number }>;
    const [keep, ...duplicates] = files;
    return {
      sha256,
      keep: { id: keep.id, name: keep.name, sizeBytes: keep.size },
      duplicates: duplicates.map((file) => ({
        id: file.id,
        name: file.name,
        sizeBytes: file.size,
        type: file.type,
      })),
      reclaimableBytes: duplicates.reduce((sum, file) => sum + file.size, 0),
    };
  });
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

const activityQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  fileId: z.string().min(1).max(128).optional(),
});

export default async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stats/overview', async (request) => {
    const user = requireUser(request);
    const db = getDb();
    const types = aggregateTypes(user.id);
    const usage = Files.usedBytes(user.id);
    const shares = db
      .prepare(
        `SELECT COUNT(*) AS active, COALESCE(SUM(views_count), 0) AS views,
                COALESCE(SUM(download_count), 0) AS downloads
         FROM shares WHERE user_id = ? AND revoked = 0
           AND (expires_at IS NULL OR expires_at >= ?)
           AND (max_downloads IS NULL OR download_count < max_downloads)`,
      )
      .get(user.id, Date.now()) as { active: number; views: number; downloads: number };
    const trash = db
      .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM files WHERE user_id = ? AND trashed = 1')
      .get(user.id) as { count: number; bytes: number };
    const pinned = db
      .prepare(
        `SELECT * FROM files WHERE user_id = ? AND trashed = 0 AND status = 'ready' AND pinned = 1
         ORDER BY updated_at DESC LIMIT 8`,
      )
      .all(user.id) as FileRow[];
    const recent = db
      .prepare(
        `SELECT * FROM files WHERE user_id = ? AND trashed = 0 AND status = 'ready'
         ORDER BY updated_at DESC LIMIT 8`,
      )
      .all(user.id) as FileRow[];
    const settings = workspaceSettings(user.id);
    const cfg = loadConfig();
    const chunks = db
      .prepare(
        `SELECT COUNT(DISTINCT f.id) AS total, COUNT(DISTINCT fc.file_id) AS chunked
         FROM files f LEFT JOIN file_chunks fc ON fc.file_id = f.id
         WHERE f.user_id = ? AND f.trashed = 0 AND f.status = 'ready'`,
      )
      .get(user.id) as { total: number; chunked: number | null };
    return {
      activeFiles: (db
        .prepare("SELECT COUNT(*) AS count FROM files WHERE user_id = ? AND trashed = 0 AND status = 'ready'")
        .get(user.id) as { count: number }).count,
      usedBytes: usage,
      quotaBytes: quotaBytes(user.id),
      byType: types,
      shares: { active: shares.active, views: shares.views, downloads: shares.downloads },
      storage: {
        chunkedPct: chunks.total ? Math.round(((chunks.chunked ?? 0) / chunks.total) * 100) : 0,
        backend: cfg.content.backend,
      },
      trash,
      pinned: pinned.map(toApiFile),
      recent: recent.map(toApiFile),
      retentionDays: retentionDays(user.id),
      defaultView: settings.defaultView === 'list' ? 'list' : 'grid',
    };
  });

  app.get('/api/stats/security', async (request) => {
    const user = requireUser(request);
    const db = getDb();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime();
    const monthly = db
      .prepare(
        `SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch', 'localtime') AS month,
                COALESCE(SUM(size), 0) AS bytes
         FROM files WHERE user_id = ? AND trashed = 0 AND status = 'ready' AND created_at >= ?
         GROUP BY month ORDER BY month ASC`,
      )
      .all(user.id, monthStart) as Array<{ month: string; bytes: number }>;
    const monthlyByKey = new Map(monthly.map((item) => [item.month, item.bytes]));
    let cumulative = 0;
    const growth = Array.from({ length: 6 }, (_, index) => {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
      const month = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
      const bytes = monthlyByKey.get(month) ?? 0;
      cumulative += bytes;
      return { month, label: monthDate.toLocaleString('en', { month: 'short' }), bytes, cumulative };
    });
    const ingest = db
      .prepare(
        `SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(DISTINCT date(created_at / 1000, 'unixepoch')) AS days
         FROM files WHERE user_id = ? AND trashed = 0 AND status = 'ready' AND created_at >= ?`,
      )
      .get(user.id, Date.now() - 30 * 86_400_000) as { bytes: number; days: number };
    const ingestPerDayBytes = ingest.days ? Math.round(ingest.bytes / Math.min(30, ingest.days)) : 0;
    const usedBytes = Files.usedBytes(user.id);
    const quota = quotaBytes(user.id);
    const groups = duplicateGroups(user.id);
    const dedup = {
      groups: groups.length,
      duplicateFiles: groups.reduce((sum, group) => sum + group.duplicates.length, 0),
      reclaimableBytes: groups.reduce((sum, group) => sum + group.reclaimableBytes, 0),
      ratio: usedBytes ? Math.round(((usedBytes + groups.reduce((sum, group) => sum + group.reclaimableBytes, 0)) / usedBytes) * 100) / 100 : 1,
    };
    const cutoff = Date.now() - retentionDays(user.id) * 86_400_000;
    const staleTrash = db
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM files WHERE user_id = ? AND trashed = 1 AND trashed_at <= ?',
      )
      .get(user.id, cutoff) as { count: number; bytes: number };
    const largest = db
      .prepare(
        `SELECT name, size FROM files WHERE user_id = ? AND trashed = 0 AND status = 'ready'
         ORDER BY size DESC LIMIT 1`,
      )
      .get(user.id) as { name: string; size: number } | undefined;
    const recommendation = [];
    if (dedup.duplicateFiles) {
      const first = groups.find((group) => group.duplicates.length)?.duplicates[0];
      recommendation.push({ kind: 'duplicates', count: dedup.duplicateFiles, bytes: dedup.reclaimableBytes, sample: first?.name ?? '' });
    }
    if (staleTrash.count) {
      recommendation.push({ kind: 'stale_trash', count: staleTrash.count, bytes: staleTrash.bytes, olderThanDays: retentionDays(user.id) });
    }
    if (largest) recommendation.push({ kind: 'large_files', count: 1, bytes: largest.size, sample: largest.name });
    const sessions = (db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(user.id) as { count: number }).count;
    const hashRow = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    const cfg = loadConfig();
    return {
      usedBytes,
      quotaBytes: quota,
      autoExpandBytes: Math.round(quota * 0.9),
      byType: aggregateTypes(user.id),
      growth,
      ingestPerDayBytes,
      runwayDays: ingestPerDayBytes ? Math.max(0, Math.floor((quota - usedBytes) / ingestPerDayBytes)) : null,
      dedup,
      recommendations: recommendation,
      posture: {
        kdf: hashRow.password_hash.startsWith('$argon2') ? 'argon2id' : 'scrypt',
        dbDriver: 'SQLite',
        storageDriver: cfg.storage.driver,
        contentBackend: cfg.content.backend,
        ssrfProtection: true,
        cookie: { httpOnly: true, secure: cfg.isProd, sameSite: 'lax' },
        sessions,
        https: new URL(cfg.publicUrl).protocol === 'https:',
      },
    };
  });

  app.get('/api/stats/dedup', async (request) => {
    const user = requireUser(request);
    const groups = duplicateGroups(user.id);
    return {
      groups,
      totalReclaimableBytes: groups.reduce((sum, group) => sum + group.reclaimableBytes, 0),
      duplicateFiles: groups.reduce((sum, group) => sum + group.duplicates.length, 0),
    };
  });

  app.post('/api/stats/dedup/purge', async (request) => {
    const user = requireUser(request);
    const body = parse(z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(500) }), request.body);
    const ids = [...new Set(body.ids)];
    const allowedIds = new Set(duplicateGroups(user.id).flatMap((group) => group.duplicates.map((item) => item.id)));
    if (ids.some((id) => !allowedIds.has(id))) throw errors.badRequest('يمكن حذف النسخ المكرّرة فقط.');
    let freedBytes = 0;
    for (const id of ids) {
      const file = Files.findById(id);
      if (!file || file.user_id !== user.id || file.trashed) throw errors.conflict('تغيّرت قائمة الملفات؛ أعد تحميلها.');
      await deleteFilePermanent(file);
      freedBytes += file.size;
    }
    Activity.record({ userId: user.id, action: 'dedup_purge', targetType: 'file', meta: { removed: ids.length, freedBytes } });
    return { removed: ids.length, freedBytes };
  });

  app.get('/api/vaults', async (request) => {
    const user = requireUser(request);
    const db = getDb();
    const folders = db
      .prepare(
        `SELECT f.id, f.name, f.created_at, f.updated_at,
          (SELECT COUNT(*) FROM files x WHERE x.user_id = f.user_id AND x.folder_id = f.id AND x.trashed = 0) AS filesCount,
          (SELECT COALESCE(SUM(x.size), 0) FROM files x WHERE x.user_id = f.user_id AND x.folder_id = f.id AND x.trashed = 0) AS bytes,
          (SELECT COUNT(*) FROM shares s WHERE s.user_id = f.user_id AND s.folder_id = f.id AND s.revoked = 0
            AND (s.expires_at IS NULL OR s.expires_at >= ?)
            AND (s.max_downloads IS NULL OR s.download_count < s.max_downloads)) AS sharesCount
         FROM folders f WHERE f.user_id = ? ORDER BY f.updated_at DESC`,
      )
      .all(Date.now(), user.id) as Array<{ id: string; name: string; created_at: number; updated_at: number; filesCount: number; bytes: number; sharesCount: number }>;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const activityStart = today.getTime() - 6 * 86_400_000;
    const vaults = folders.map((folder) => {
      const activity = db
        .prepare(
          `SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS count FROM files
           WHERE user_id = ? AND folder_id = ? AND trashed = 0 AND created_at >= ?
           GROUP BY day`,
        )
        .all(user.id, folder.id, activityStart) as Array<{ day: string; count: number }>;
      const activityByDay = new Map(activity.map((item) => [item.day, item.count]));
      return {
        id: folder.id,
        name: folder.name,
        filesCount: folder.filesCount,
        bytes: folder.bytes,
        sharesCount: folder.sharesCount,
        shared: folder.sharesCount > 0,
        createdAt: folder.created_at,
        updatedAt: folder.updated_at,
        activity: Array.from({ length: 7 }, (_, index) => {
          const day = new Date(activityStart + index * 86_400_000).toISOString().slice(0, 10);
          return activityByDay.get(day) ?? 0;
        }),
      };
    });
    const activeSessions = (db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(user.id) as { count: number }).count;
    const activeShares = (db.prepare(
      `SELECT COUNT(*) AS count FROM shares WHERE user_id = ? AND revoked = 0
       AND (expires_at IS NULL OR expires_at >= ?)
       AND (max_downloads IS NULL OR download_count < max_downloads)`,
    ).get(user.id, Date.now()) as { count: number }).count;
    return { meta: { activeSessions, shares: activeShares }, vaults };
  });

  app.get('/api/activity', async (request) => {
    const user = requireUser(request);
    const query = parse(activityQuery, request.query);
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    return {
      items: Activity.list(user.id, { fileId: query.fileId, limit, offset }),
      meta: { total: Activity.count(user.id, query.fileId), limit, offset },
    };
  });

  app.get('/api/activity/export.csv', async (request, reply) => {
    const user = requireUser(request);
    const query = parse(activityQuery.extend({ limit: z.coerce.number().int().min(1).max(5000).default(5000) }), request.query);
    const rows = Activity.list(user.id, { fileId: query.fileId, limit: query.limit ?? 5000, offset: query.offset ?? 0 });
    const csv = [
      ['id', 'action', 'targetType', 'targetId', 'targetName', 'ip', 'at', 'meta'].map(csvCell).join(','),
      ...rows.map((item) =>
        [item.id, item.action, item.targetType, item.targetId, item.targetName, item.ip, item.at, item.meta].map(csvCell).join(','),
      ),
    ].join('\r\n');
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="tdrive-activity.csv"')
      .send(`\uFEFF${csv}`);
  });

  app.post('/api/security/wipe-peers', async (request) => {
    const user = requireUser(request);
    const { confirm } = parse(z.object({ confirm: z.literal('WIPE-CONFIRM') }), request.body);
    void confirm;
    const db = getDb();
    const currentSession = request.sessionId ?? '';
    const revokedSessions = db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
      .run(user.id, currentSession).changes;
    const revokedShares = db
      .prepare('UPDATE shares SET revoked = 1 WHERE user_id = ? AND revoked = 0')
      .run(user.id).changes;
    Activity.record({
      userId: user.id,
      action: 'wipe_peers',
      targetType: 'account',
      ip: request.ip,
      meta: { revokedSessions, revokedShares },
    });
    return { revokedSessions, revokedShares };
  });

  app.get('/api/files/:id/shares', async (request) => {
    const user = requireUser(request);
    const id = (request.params as { id: string }).id;
    const file = Files.findById(id);
    if (!file || file.user_id !== user.id) throw errors.notFound('الملف غير موجود.');
    return { shares: Shares.listByFile(user.id, id).map(toApiShare) };
  });
}

export { DEFAULT_QUOTA_BYTES, quotaBytes, retentionDays };
