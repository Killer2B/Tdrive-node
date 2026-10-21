import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exec, one, query, tb } from '../db/pg.ts';
import { Files, Settings, Shares, type FileRow } from '../db/repo.ts';
import { errors } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { requireUser } from '../plugins/auth.ts';
import { toApiFile, deleteFilePermanent } from '../services/files.ts';
import { Activity } from '../services/activity.ts';
import { loadConfig } from '../config/env.ts';
import { toApiShare } from './shares.ts';

const DEFAULT_QUOTA_BYTES = 5_000_000_000_000;

async function workspaceSettings(userId: string): Promise<Record<string, unknown>> {
  const value = await Settings.get(userId, 'workspace');
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function quotaBytes(userId: string): Promise<number> {
  const value = (await workspaceSettings(userId)).quotaBytes;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_QUOTA_BYTES;
}

async function retentionDays(userId: string): Promise<number> {
  const value = (await workspaceSettings(userId)).retentionDays;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3650 ? value : 30;
}

async function aggregateTypes(userId: string): Promise<Array<{ type: string; count: number; bytes: number; pct: number }>> {
  const rows = await query<{ type: string; count: number; bytes: number }>(
    `SELECT type, COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
     FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 AND status = 'ready'
     GROUP BY type ORDER BY bytes DESC`,
    [userId],
  );
  const total = rows.reduce((sum, row) => sum + Number(row.bytes), 0);
  return rows.map((row) => ({
    type: row.type,
    count: Number(row.count),
    bytes: Number(row.bytes),
    pct: total ? Math.round((Number(row.bytes) / total) * 1000) / 10 : 0,
  }));
}

async function duplicateGroups(userId: string) {
  const hashes = await query<{ sha256: string }>(
    `SELECT sha256 FROM ${tb('files')}
     WHERE user_id = $1 AND trashed = 0 AND status = 'ready' AND sha256 IS NOT NULL AND sha256 != ''
     GROUP BY sha256 HAVING COUNT(*) > 1`,
    [userId],
  );
  const groups = [];
  for (const { sha256 } of hashes) {
    const files = await query<{ id: string; name: string; type: string; size: number; created_at: number }>(
      `SELECT id, name, type, size, created_at FROM ${tb('files')}
       WHERE user_id = $1 AND sha256 = $2 AND trashed = 0 AND status = 'ready'
       ORDER BY created_at ASC, id ASC`,
      [userId, sha256],
    );
    const [keep, ...duplicates] = files;
    if (!keep) continue;
    groups.push({
      sha256,
      keep: { id: keep.id, name: keep.name, sizeBytes: Number(keep.size) },
      duplicates: duplicates.map((file) => ({
        id: file.id,
        name: file.name,
        sizeBytes: Number(file.size),
        type: file.type,
      })),
      reclaimableBytes: duplicates.reduce((sum, file) => sum + Number(file.size), 0),
    });
  }
  return groups;
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
    const types = await aggregateTypes(user.id);
    const usage = await Files.usedBytes(user.id);
    const shares = (await one<{ active: number; views: number; downloads: number }>(
      `SELECT COUNT(*) AS active, COALESCE(SUM(views_count), 0) AS views,
              COALESCE(SUM(download_count), 0) AS downloads
       FROM ${tb('shares')} WHERE user_id = $1 AND revoked = 0
         AND (expires_at IS NULL OR expires_at >= $2)
         AND (max_downloads IS NULL OR download_count < max_downloads)`,
      [user.id, Date.now()],
    )) ?? { active: 0, views: 0, downloads: 0 };
    const trash = (await one<{ count: number; bytes: number }>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
       FROM ${tb('files')} WHERE user_id = $1 AND trashed = 1`,
      [user.id],
    )) ?? { count: 0, bytes: 0 };
    const pinned = await query<FileRow>(
      `SELECT * FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 AND status = 'ready' AND pinned = 1
       ORDER BY updated_at DESC LIMIT 8`,
      [user.id],
    );
    const recent = await query<FileRow>(
      `SELECT * FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 AND status = 'ready'
       ORDER BY updated_at DESC LIMIT 8`,
      [user.id],
    );
    const settings = await workspaceSettings(user.id);
    const cfg = loadConfig();
    const chunks = (await one<{ total: number; chunked: number }>(
      `SELECT COUNT(DISTINCT f.id) AS total, COUNT(DISTINCT fc.file_id) AS chunked
       FROM ${tb('files')} f LEFT JOIN ${tb('file_chunks')} fc ON fc.file_id = f.id
       WHERE f.user_id = $1 AND f.trashed = 0 AND f.status = 'ready'`,
      [user.id],
    )) ?? { total: 0, chunked: 0 };
    const activeFiles = await one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 AND status = 'ready'`,
      [user.id],
    );
    return {
      activeFiles: Number(activeFiles?.count ?? 0),
      usedBytes: usage,
      quotaBytes: await quotaBytes(user.id),
      byType: types,
      shares: {
        active: Number(shares.active),
        views: Number(shares.views),
        downloads: Number(shares.downloads),
      },
      storage: {
        chunkedPct: chunks.total ? Math.round((Number(chunks.chunked) / Number(chunks.total)) * 100) : 0,
        backend: cfg.content.backend,
      },
      trash: { count: Number(trash.count), bytes: Number(trash.bytes) },
      pinned: pinned.map(toApiFile),
      recent: recent.map(toApiFile),
      retentionDays: await retentionDays(user.id),
      defaultView: settings.defaultView === 'list' ? 'list' : 'grid',
    };
  });

  app.get('/api/stats/security', async (request) => {
    const user = requireUser(request);
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1);
    // نجمّع بالأشهر بتوقيت UTC — يطابق مفاتيح JS أدناه ويتجنّب اختلاف المنطقة الزمنيّة.
    const monthly = await query<{ month: string; bytes: number }>(
      `SELECT to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
              COALESCE(SUM(size), 0) AS bytes
       FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 AND status = 'ready' AND created_at >= $2
       GROUP BY month ORDER BY month ASC`,
      [user.id, monthStart],
    );
    const monthlyByKey = new Map(monthly.map((item) => [item.month, Number(item.bytes)]));
    let cumulative = 0;
    const growth = Array.from({ length: 6 }, (_, index) => {
      const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
      const month = monthDate.toISOString().slice(0, 7);
      const bytes = monthlyByKey.get(month) ?? 0;
      cumulative += bytes;
      return { month, label: monthDate.toLocaleString('en', { month: 'short', timeZone: 'UTC' }), bytes, cumulative };
    });
    const ingest = (await one<{ bytes: number; days: number }>(
      `SELECT COALESCE(SUM(size), 0) AS bytes,
              COUNT(DISTINCT to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD')) AS days
       FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 AND status = 'ready' AND created_at >= $2`,
      [user.id, Date.now() - 30 * 86_400_000],
    )) ?? { bytes: 0, days: 0 };
    const ingestPerDayBytes = Number(ingest.days) ? Math.round(Number(ingest.bytes) / Math.min(30, Number(ingest.days))) : 0;
    const usedBytes = await Files.usedBytes(user.id);
    const quota = await quotaBytes(user.id);
    const groups = await duplicateGroups(user.id);
    const dedup = {
      groups: groups.length,
      duplicateFiles: groups.reduce((sum, group) => sum + group.duplicates.length, 0),
      reclaimableBytes: groups.reduce((sum, group) => sum + group.reclaimableBytes, 0),
      ratio: usedBytes
        ? Math.round(
            ((usedBytes + groups.reduce((sum, group) => sum + group.reclaimableBytes, 0)) / usedBytes) * 100,
          ) / 100
        : 1,
    };
    const retention = await retentionDays(user.id);
    const cutoff = Date.now() - retention * 86_400_000;
    const staleTrash = (await one<{ count: number; bytes: number }>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
       FROM ${tb('files')} WHERE user_id = $1 AND trashed = 1 AND trashed_at <= $2`,
      [user.id, cutoff],
    )) ?? { count: 0, bytes: 0 };
    const largest = await one<{ name: string; size: number }>(
      `SELECT name, size FROM ${tb('files')} WHERE user_id = $1 AND trashed = 0 AND status = 'ready'
       ORDER BY size DESC LIMIT 1`,
      [user.id],
    );
    const recommendation = [];
    if (dedup.duplicateFiles) {
      const first = groups.find((group) => group.duplicates.length)?.duplicates[0];
      recommendation.push({ kind: 'duplicates', count: dedup.duplicateFiles, bytes: dedup.reclaimableBytes, sample: first?.name ?? '' });
    }
    if (Number(staleTrash.count)) {
      recommendation.push({ kind: 'stale_trash', count: Number(staleTrash.count), bytes: Number(staleTrash.bytes), olderThanDays: retention });
    }
    if (largest) recommendation.push({ kind: 'large_files', count: 1, bytes: Number(largest.size), sample: largest.name });
    const sessions = Number(
      (await one<{ count: number }>(`SELECT COUNT(*) AS count FROM ${tb('sessions')} WHERE user_id = $1`, [user.id]))?.count ?? 0,
    );
    const hashRow = await one<{ password_hash: string }>(
      `SELECT password_hash FROM ${tb('users')} WHERE id = $1`,
      [user.id],
    );
    const cfg = loadConfig();
    return {
      usedBytes,
      quotaBytes: quota,
      autoExpandBytes: Math.round(quota * 0.9),
      byType: await aggregateTypes(user.id),
      growth,
      ingestPerDayBytes,
      runwayDays: ingestPerDayBytes ? Math.max(0, Math.floor((quota - usedBytes) / ingestPerDayBytes)) : null,
      dedup,
      recommendations: recommendation,
      posture: {
        kdf: hashRow?.password_hash?.startsWith('$argon2') ? 'argon2id' : 'scrypt',
        dbDriver: 'Postgres (Supabase)',
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
    const groups = await duplicateGroups(user.id);
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
    const allowedIds = new Set((await duplicateGroups(user.id)).flatMap((group) => group.duplicates.map((item) => item.id)));
    if (ids.some((id) => !allowedIds.has(id))) throw errors.badRequest('يمكن حذف النسخ المكرّرة فقط.');
    let freedBytes = 0;
    for (const id of ids) {
      const file = await Files.findById(id);
      if (!file || file.user_id !== user.id || file.trashed) throw errors.conflict('تغيّرت قائمة الملفات؛ أعد تحميلها.');
      await deleteFilePermanent(file);
      freedBytes += file.size;
    }
    await Activity.record({ userId: user.id, action: 'dedup_purge', targetType: 'file', meta: { removed: ids.length, freedBytes } });
    return { removed: ids.length, freedBytes };
  });

  app.get('/api/vaults', async (request) => {
    const user = requireUser(request);
    const folders = await query<{
      id: string;
      name: string;
      created_at: number;
      updated_at: number;
      filesCount: number;
      bytes: number;
      sharesCount: number;
    }>(
      `SELECT f.id, f.name, f.created_at, f.updated_at,
        (SELECT COUNT(*) FROM ${tb('files')} x WHERE x.user_id = f.user_id AND x.folder_id = f.id AND x.trashed = 0) AS "filesCount",
        (SELECT COALESCE(SUM(x.size), 0) FROM ${tb('files')} x WHERE x.user_id = f.user_id AND x.folder_id = f.id AND x.trashed = 0) AS bytes,
        (SELECT COUNT(*) FROM ${tb('shares')} s WHERE s.user_id = f.user_id AND s.folder_id = f.id AND s.revoked = 0
          AND (s.expires_at IS NULL OR s.expires_at >= $1)
          AND (s.max_downloads IS NULL OR s.download_count < s.max_downloads)) AS "sharesCount"
       FROM ${tb('folders')} f WHERE f.user_id = $2 ORDER BY f.updated_at DESC`,
      [Date.now(), user.id],
    );
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const activityStart = today.getTime() - 6 * 86_400_000;
    const vaults = [];
    for (const folder of folders) {
      const activity = await query<{ day: string; count: number }>(
        `SELECT to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*) AS count
         FROM ${tb('files')}
         WHERE user_id = $1 AND folder_id = $2 AND trashed = 0 AND created_at >= $3
         GROUP BY day`,
        [user.id, folder.id, activityStart],
      );
      const activityByDay = new Map(activity.map((item) => [item.day, Number(item.count)]));
      vaults.push({
        id: folder.id,
        name: folder.name,
        filesCount: Number(folder.filesCount),
        bytes: Number(folder.bytes),
        sharesCount: Number(folder.sharesCount),
        shared: Number(folder.sharesCount) > 0,
        createdAt: Number(folder.created_at),
        updatedAt: Number(folder.updated_at),
        activity: Array.from({ length: 7 }, (_, index) => {
          const day = new Date(activityStart + index * 86_400_000).toISOString().slice(0, 10);
          return activityByDay.get(day) ?? 0;
        }),
      });
    }
    const activeSessions = Number(
      (await one<{ count: number }>(`SELECT COUNT(*) AS count FROM ${tb('sessions')} WHERE user_id = $1`, [user.id]))?.count ?? 0,
    );
    const activeShares = Number(
      (await one<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${tb('shares')} WHERE user_id = $1 AND revoked = 0
         AND (expires_at IS NULL OR expires_at >= $2)
         AND (max_downloads IS NULL OR download_count < max_downloads)`,
        [user.id, Date.now()],
      ))?.count ?? 0,
    );
    return { meta: { activeSessions, shares: activeShares }, vaults };
  });

  app.get('/api/activity', async (request) => {
    const user = requireUser(request);
    const params = parse(activityQuery, request.query);
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const [items, total] = await Promise.all([
      Activity.list(user.id, { fileId: params.fileId, limit, offset }),
      Activity.count(user.id, params.fileId),
    ]);
    return { items, meta: { total, limit, offset } };
  });

  app.get('/api/activity/export.csv', async (request, reply) => {
    const user = requireUser(request);
    const params = parse(activityQuery.extend({ limit: z.coerce.number().int().min(1).max(5000).default(5000) }), request.query);
    const rows = await Activity.list(user.id, {
      fileId: params.fileId,
      limit: params.limit ?? 5000,
      offset: params.offset ?? 0,
    });
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
    const currentSession = request.sessionId ?? '';
    const revokedSessions = await exec(
      `DELETE FROM ${tb('sessions')} WHERE user_id = $1 AND id != $2`,
      [user.id, currentSession],
    );
    const revokedShares = await exec(
      `UPDATE ${tb('shares')} SET revoked = 1 WHERE user_id = $1 AND revoked = 0`,
      [user.id],
    );
    await Activity.record({
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
    const file = await Files.findById(id);
    if (!file || file.user_id !== user.id) throw errors.notFound('الملف غير موجود.');
    return { shares: (await Shares.listByFile(user.id, id)).map(toApiShare) };
  });
}

export { DEFAULT_QUOTA_BYTES, quotaBytes, retentionDays };
