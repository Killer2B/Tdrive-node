import { createHash } from 'node:crypto';
import { ApiKeys, Users, type ApiKeyRow } from '../db/repo.ts';
import { errors } from '../lib/errors.ts';
import { randomToken } from '../lib/ids.ts';

const KEY_PATTERN = /^tdk_[a-f0-9]{64}$/;
const MAX_ACTIVE_KEYS = 20;

export interface SafeApiKey {
  id: string;
  label: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

function toSafeKey(row: Omit<ApiKeyRow, 'key_hash'>): SafeApiKey {
  return {
    id: row.id,
    label: row.label,
    prefix: row.key_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export async function listApiKeys(userId: string): Promise<SafeApiKey[]> {
  return (await ApiKeys.listByUser(userId)).map(toSafeKey);
}

export async function createApiKey(userId: string, label: string): Promise<{ key: string; metadata: SafeApiKey }> {
  const normalizedLabel = label.trim();
  if (!normalizedLabel || normalizedLabel.length > 100) throw errors.badRequest('اسم المفتاح مطلوب وبحد أقصى 100 محرف.');
  if ((await ApiKeys.countActive(userId)) >= MAX_ACTIVE_KEYS) {
    throw errors.conflict(`لا يمكن أن يتجاوز عدد المفاتيح النشطة ${MAX_ACTIVE_KEYS}.`);
  }

  const key = `tdk_${randomToken(32)}`;
  const row = await ApiKeys.create({
    user_id: userId,
    label: normalizedLabel,
    key_hash: hashKey(key),
    key_prefix: key.slice(0, 12),
  });
  return { key, metadata: toSafeKey(row) };
}

export async function revokeApiKey(userId: string, id: string): Promise<void> {
  if (!(await ApiKeys.revoke(userId, id))) throw errors.notFound('مفتاح API غير موجود أو سبق إلغاؤه.');
}

export async function authenticateApiKey(key: string): Promise<{ userId: string; keyId: string } | null> {
  if (!KEY_PATTERN.test(key)) return null;
  const row = await ApiKeys.findActiveByHash(hashKey(key));
  if (!row || !(await Users.findById(row.user_id))) return null;
  await ApiKeys.touch(row.id);
  return { userId: row.user_id, keyId: row.id };
}
