import { Activity as ActivityRepo } from '../db/repo.ts';
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
  async record(input: ActivityInput): Promise<void> {
    await ActivityRepo.insert({
      id: newId('act'),
      user_id: input.userId,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_name: input.targetName ?? null,
      ip: input.ip ?? null,
      meta: input.meta ?? {},
    });
  },

  async list(userId: string, options: { fileId?: string; limit: number; offset: number }): Promise<ActivityRow[]> {
    const rows = await ActivityRepo.list(userId, {
      fileId: options.fileId,
      limit: options.offset + options.limit,
    });

    return rows.slice(options.offset).map((row) => {
      let meta: Record<string, unknown> = {};
      if (typeof row.meta === 'string') {
        const parsed: unknown = JSON.parse(row.meta);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
      } else if (row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)) {
        meta = row.meta as Record<string, unknown>;
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

  async count(userId: string, fileId?: string): Promise<number> {
    return ActivityRepo.count(userId, fileId ?? null);
  },
};
