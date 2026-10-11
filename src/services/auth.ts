/** المصادقة: تجزئة كلمة المرور، تهيئة المالك، وإدارة الجلسات. */
import { Users, Sessions, type UserRow } from '../db/repo.ts';
import { loadConfig } from '../config/env.ts';
import { getLogger } from '../lib/logger.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';

export { hashPassword, verifyPassword };

/** يُنشئ حساب المالك عند أول تشغيل إن لم يوجد أي مستخدم. */
export async function ensureOwner(): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger();
  if (Users.count() > 0) return;
  if (!cfg.owner.password) {
    log.warn(
      'لا يوجد مستخدمون ولم تُضبط OWNER_PASSWORD. اضبطها في .env ثم أعد التشغيل، أو استخدم: npm run owner:set -- <user> <pass>',
    );
    return;
  }
  const password_hash = await hashPassword(cfg.owner.password);
  Users.create({ username: cfg.owner.username, password_hash, role: 'owner' });
  log.info({ username: cfg.owner.username }, 'أُنشئ حساب المالك. غيّر كلمة المرور واحذف OWNER_PASSWORD من البيئة.');
}

/** إنشاء/تحديث مالك من سطر الأوامر. */
export async function setOwner(username: string, password: string): Promise<void> {
  const existing = Users.findByUsername(username);
  const password_hash = await hashPassword(password);
  if (existing) {
    Users.updatePassword(existing.id, password_hash);
  } else {
    Users.create({ username, password_hash, role: 'owner' });
  }
}

export interface LoginResult {
  user: UserRow;
  sessionId: string;
  expiresAt: number;
}

export async function login(
  username: string,
  password: string,
  meta: { userAgent?: string; ip?: string },
): Promise<LoginResult | null> {
  const user = Users.findByUsername(username);
  if (!user) {
    // ساوِ زمن الاستجابة بتكلفة تجزئة مكافئة لتقليل تسريب تعداد المستخدمين
    await hashPassword(password);
    return null;
  }
  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) return null;
  const cfg = loadConfig();
  const session = Sessions.create({
    user_id: user.id,
    ttlMs: cfg.session.ttlMs,
    user_agent: meta.userAgent,
    ip: meta.ip,
  });
  return { user, sessionId: session.id, expiresAt: session.expires_at };
}

export function logout(sessionId: string): void {
  Sessions.delete(sessionId);
}

/** يعيد المستخدم من جلسة صالحة أو null (ويحذف الجلسة المنتهية). */
export function getUserFromSession(sessionId: string): UserRow | null {
  const session = Sessions.find(sessionId);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    Sessions.delete(sessionId);
    return null;
  }
  const user = Users.findById(session.user_id);
  return user ?? null;
}
