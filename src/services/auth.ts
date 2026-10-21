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
  if ((await Users.count()) > 0) return;
  if (!cfg.owner.password) {
    log.warn(
      'لا يوجد مستخدمون ولم تُضبط OWNER_PASSWORD. اضبطها في .env ثم أعد التشغيل، أو استخدم: npm run owner:set -- <user> <pass>',
    );
    return;
  }
  const password_hash = await hashPassword(cfg.owner.password);
  await Users.create({ username: cfg.owner.username, password_hash, role: 'owner' });
  log.info({ username: cfg.owner.username }, 'أُنشئ حساب المالك. غيّر كلمة المرور واحذف OWNER_PASSWORD من البيئة.');
}

/** إنشاء/تحديث مالك من سطر الأوامر. */
export async function setOwner(username: string, password: string): Promise<void> {
  const existing = await Users.findByUsername(username);
  const password_hash = await hashPassword(password);
  if (existing) {
    await Users.updatePassword(existing.id, password_hash);
  } else {
    await Users.create({ username, password_hash, role: 'owner' });
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
  const user = await Users.findByUsername(username);
  if (!user) {
    // ساوِ زمن الاستجابة بتكلفة تجزئة مكافئة لتقليل تسريب تعداد المستخدمين
    await hashPassword(password);
    return null;
  }
  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) return null;
  const cfg = loadConfig();
  const session = await Sessions.create({
    user_id: user.id,
    ttlMs: cfg.session.ttlMs,
    user_agent: meta.userAgent,
    ip: meta.ip,
  });
  return { user, sessionId: session.id, expiresAt: session.expires_at };
}

export async function logout(sessionId: string): Promise<void> {
  await Sessions.delete(sessionId);
}

/** يعيد المستخدم من جلسة صالحة أو null (ويحذف الجلسة المنتهية). */
export async function getUserFromSession(sessionId: string): Promise<UserRow | null> {
  const session = await Sessions.find(sessionId);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    await Sessions.delete(sessionId);
    return null;
  }
  const user = await Users.findById(session.user_id);
  return user ?? null;
}
