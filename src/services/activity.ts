import { getDb } from '../db/db.ts';
import { newId } from '../lib/ids.ts';

export interface ActivityInput {
  userId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  ip?: string;
  meta?: Record<string, unknown>;
}

export interface ActivityRow {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  ip: string | null;
  at: number;
  meta: Record<string, unknown>;
}

export const Activity = {
  record(input: ActivityInput): void {
    getDb()
      .prepare(
        `INSERT INTO activity_log
          (id, user_id, action, target_type, target_id, target_name, ip, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId('act'),
        input.userId,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.targetName ?? null,
        input.ip ?? null,
        JSON.stringify(input.meta ?? {}),
        Date.now(),
      );
  },

  list(userId: string, options: { fileId?: string; limit: number; offset: number }): ActivityRow[] {
    const rows = options.fileId
      ? getDb()
          .prepare(
            `SELECT id, action, target_type, target_id, target_name, ip, meta, created_at
             FROM activity_log WHERE user_id = ? AND target_id = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(userId, options.fileId, options.limit, options.offset)
      : getDb()
          .prepare(
            `SELECT id, action, target_type, target_id, target_name, ip, meta, created_at
             FROM activity_log WHERE user_id = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(userId, options.limit, options.offset);

    return (rows as Array<Record<string, unknown>>).map((row) => {
      let meta: Record<string, unknown> = {};
      if (typeof row.meta === 'string') {
        const parsed: unknown = JSON.parse(row.meta);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
      }
      return {
        id: String(row.id),
        action: String(row.action),
        targetType: (row.target_type as string | null) ?? null,
        targetId: (row.target_id as string | null) ?? null,
        targetName: (row.target_name as string | null) ?? null,
        ip: (row.ip as string | null) ?? null,
        at: Number(row.created_at),
        meta,
      };
    });
  },

  count(userId: string, fileId?: string): number {
    const row = fileId
      ? (getDb()
          .prepare('SELECT COUNT(*) AS count FROM activity_log WHERE user_id = ? AND target_id = ?')
          .get(userId, fileId) as { count: number })
      : (getDb().prepare('SELECT COUNT(*) AS count FROM activity_log WHERE user_id = ?').get(userId) as {
          count: number;
        });
    return row.count;
  },
};
