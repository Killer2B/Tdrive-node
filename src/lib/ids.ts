/** توليد معرّفات وقيم عشوائية. */
import { randomBytes, randomUUID } from 'node:crypto';

const B36 = 36;

/**
 * معرّف قابل للترتيب زمنيًّا: طابع زمني base36 + عشوائيّ.
 * يبقى فريدًا وقابلًا للفرز حسب وقت الإنشاء.
 */
export function newId(prefix?: string): string {
  const ts = Date.now().toString(B36).padStart(9, '0');
  const rand = randomBytes(8).toString('hex');
  const id = `${ts}${rand}`;
  return prefix ? `${prefix}_${id}` : id;
}

/** رمز عشوائي hex (افتراضي 32 بايت ⇒ 64 محرفًا). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** رمز عشوائي base64url قصير وآمن للروابط. */
export function randomBase64Url(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}

/** UUID v4. */
export function uuid(): string {
  return randomUUID();
}
