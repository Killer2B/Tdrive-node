/**
 * مصادقة موحّدة لاعتمادات التطبيق: كلمة مرور المستخدم (Basic) أو مفتاح API.
 *
 * WebDAV تصادق أصلًا بـ username/password، وليس بمفتاح API فقط. ندعم الاثنين:
 * - `Authorization: Basic base64(username:password)` ⇒ التحقّق من كلمة مرور المستخدم.
 * - `Authorization: Basic base64(anything:tdk_…)` أو Bearer/X-API-Key ⇒ مفتاح API.
 *
 * الكاش (60 ثانية) ضروري عمليًّا: عملاء المزامنة يرسلون آلاف الطلبات، وتحقّق
 * scrypt/argon2 مكلف. يُبطَل الكاش عند تغيير كلمة المرور أو إلغاء مفتاح.
 */
import { createHash } from 'node:crypto';
import { Users, type UserRow } from '../db/repo.ts';
import { verifyPassword } from '../lib/password.ts';
import { authenticateApiKey } from './api-keys.ts';

const API_KEY_PATTERN = /^tdk_[a-f0-9]{64}$/;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 256;

interface CachedUser {
  user: UserRow;
  expires: number;
}

const cache = new Map<string, CachedUser>();

export interface Credentials {
  username?: string;
  secret: string;
}

/** يُبطل كاش الاعتمادات (بعد تغيير كلمة المرور أو إنشاء/إلغاء مفتاح API). */
export function invalidateCredentialCache(): void {
  cache.clear();
}

/** يزيل نطاق Windows من اسم المستخدم: `DOMAIN\user` ⇒ `user`. */
function normalizeUsername(username: string | undefined): string {
  return (username ?? '').replace(/^.*\\/, '').trim();
}

function cacheKey(username: string, secret: string): string {
  return createHash('sha256').update(`${username}\u0000${secret}`, 'utf8').digest('hex');
}

/** نسخة آمنة للتخزين في الذاكرة دون تجزئة كلمة المرور. */
function safeUser(user: UserRow): UserRow {
  return { ...user, password_hash: '' };
}

/**
 * يتحقّق من الاعتمادات ويعيد المستخدم أو null.
 * `secret` إمّا كلمة مرور (مع username) أو مفتاح API (يُقبل مع أي username).
 */
export async function authenticateCredentials(username: string | undefined, secret: string): Promise<UserRow | null> {
  const user = normalizeUsername(username);
  if (!secret) return null;

  const key = cacheKey(user, secret);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.user;

  let resolved: UserRow | null = null;
  if (API_KEY_PATTERN.test(secret)) {
    const auth = await authenticateApiKey(secret);
    if (auth) resolved = (await Users.findById(auth.userId)) ?? null;
  } else if (user) {
    const candidate = await Users.findByUsername(user);
    if (candidate && (await verifyPassword(candidate.password_hash, secret))) resolved = candidate;
  }

  if (resolved) {
    if (cache.size >= CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
      if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
    }
    cache.set(key, { user: safeUser(resolved), expires: Date.now() + CACHE_TTL_MS });
  }
  return resolved;
}
