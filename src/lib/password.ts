/**
 * تجزئة كلمة المرور: تفضّل argon2id (الإنتاج) وتسقط إلى scrypt المدمج (node:crypto)
 * عند عدم توفّر argon2 (تشغيل محلّي بلا وحدات أصلية). التجزئة ذاتية الوصف بالبادئة.
 */
import { createRequire } from 'node:module';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const require = createRequire(import.meta.url);

interface Argon2Like {
  argon2id: number;
  hash(password: string, options: Record<string, unknown>): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

let argon2: Argon2Like | null = null;
try {
  argon2 = require('argon2') as Argon2Like;
} catch {
  argon2 = null;
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  if (argon2) {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  if (stored.startsWith('$argon2')) {
    if (!argon2) return false;
    try {
      return await argon2.verify(stored, password);
    } catch {
      return false;
    }
  }
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    const N = Number(parts[1]);
    const salt = Buffer.from(parts[2], 'base64');
    const expected = Buffer.from(parts[3], 'base64');
    const actual = scryptSync(password, salt, expected.length, { N, r: SCRYPT.r, p: SCRYPT.p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  return false;
}
