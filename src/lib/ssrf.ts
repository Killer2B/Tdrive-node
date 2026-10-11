/**
 * تصنيف عناوين IP ومنع SSRF.
 * نقي (node: فقط) حتى يُختبر دون شبكة. دوال حلّ DNS منفصلة في الأسفل.
 */
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/** يحوّل IPv4 نصيًّا إلى عدد 32-بت أو null. */
export function parseIpv4(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  let out = 0;
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = out * 256 + n;
  }
  return out >>> 0;
}

/** يوسّع IPv6 (يشمل الصيغة المختصرة والمدمجة بـ IPv4) إلى BigInt 128-بت أو null. */
export function parseIpv6(ip: string): bigint | null {
  let s = ip;
  // أزل نطاق الواجهة (zone id) مثل fe80::1%eth0
  const pct = s.indexOf('%');
  if (pct !== -1) s = s.slice(0, pct);
  if (s.length === 0) return null;

  // التعامل مع IPv4 المدمجة في النهاية (::ffff:1.2.3.4)
  let v4Tail: number | null = null;
  const lastColon = s.lastIndexOf(':');
  if (lastColon !== -1 && s.slice(lastColon + 1).includes('.')) {
    v4Tail = parseIpv4(s.slice(lastColon + 1));
    if (v4Tail === null) return null;
    s = s.slice(0, lastColon + 1) + '0:0';
  }

  const parts = s.split('::');
  if (parts.length > 2) return null;

  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];

  const hextets: number[] = [];
  const pushHex = (h: string): boolean => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return false;
    hextets.push(parseInt(h, 16));
    return true;
  };

  for (const h of head) if (!pushHex(h)) return null;
  let middleZeros = 0;
  if (parts.length === 2) {
    middleZeros = 8 - head.length - tail.length;
    if (middleZeros < 1) return null;
  } else if (head.length !== 8) {
    return null;
  }
  for (let i = 0; i < middleZeros; i++) hextets.push(0);
  for (const h of tail) if (!pushHex(h)) return null;

  if (hextets.length !== 8) return null;

  let out = 0n;
  for (const h of hextets) out = (out << 16n) | BigInt(h);

  // لو كان الأصل IPv4 مدمجة، ادمج القيمة الحقيقية في آخر 32 بت
  if (v4Tail !== null) {
    out = (out >> 32n) << 32n;
    out |= BigInt(v4Tail >>> 0);
  }
  return out;
}

function v4InCidr(ip: number, base: string, bits: number): boolean {
  const b = parseIpv4(base);
  if (b === null) return false;
  if (bits === 0) return true;
  const mask = bits >= 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (b & mask) >>> 0;
}

function v6InCidr(ip: bigint, base: string, bits: number): boolean {
  const b = parseIpv6(base);
  if (b === null) return false;
  if (bits === 0) return true;
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (ip & mask) === (b & mask);
}

// نطاقات IPv4 المحظورة (غير قابلة للتوجيه عالميًّا/داخلية).
const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

const V6_BLOCKS: Array<[string, number]> = [
  ['::', 128], // غير محدّد
  ['::1', 128], // loopback
  ['fc00::', 7], // unique-local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  ['2001:db8::', 32], // توثيق
];
// ملاحظة: عناوين IPv4-mapped (::ffff:a.b.c.d) تُكتشف وتُصنَّف عبر القيمة المدمجة
// في isBlockedIp، لا عبر حظر النطاق كاملًا (حتى تمرّ العناوين العامّة المدمجة).

/** هل العنوان محظور (خاص/داخلي/غير قابل للتوجيه)؟ */
export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) {
    const n = parseIpv4(ip);
    if (n === null) return true; // غير صالح ⇒ احظر احتياطًا
    return V4_BLOCKS.some(([b, bits]) => v4InCidr(n, b, bits));
  }
  if (fam === 6) {
    const n = parseIpv6(ip);
    if (n === null) return true;
    // لو كان IPv4-mapped، استخرج آخر 32 بت وافحصها كـ IPv4
    if (v6InCidr(n, '::ffff:0:0', 96)) {
      const v4 = Number(n & 0xffffffffn) >>> 0;
      if (V4_BLOCKS.some(([b, bits]) => v4InCidr(v4, b, bits))) return true;
    }
    return V6_BLOCKS.some(([b, bits]) => v6InCidr(n, b, bits));
  }
  return true; // ليس IP صالحًا
}

export interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
  /** العناوين التي حُلّت لها المضيف (للتثبيت على الاتصال). */
  addresses: string[];
}

/**
 * يتحقّق أن المضيف يحلّ إلى عناوين عامّة فقط.
 * يرفض أسماء المضيف الحرفية التي هي IP محظور، ويحلّ DNS ويرفض أي عنوان خاص.
 * يُعيد العناوين المسموحة لتثبيت الاتصال عليها (حماية من DNS rebinding/TOCTOU).
 */
export async function assertPublicHost(hostname: string): Promise<SsrfCheckResult> {
  const host = hostname.trim().replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, reason: 'empty-host', addresses: [] };

  // لو كان المضيف عنوان IP حرفيًّا
  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) return { ok: false, reason: 'blocked-literal-ip', addresses: [] };
    return { ok: true, addresses: [host] };
  }

  // ارفض الأسماء المحليّة الواضحة
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) {
    return { ok: false, reason: 'local-hostname', addresses: [] };
  }

  let results: Array<{ address: string }>;
  try {
    results = await lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: 'dns-failed', addresses: [] };
  }
  if (results.length === 0) return { ok: false, reason: 'no-dns-records', addresses: [] };

  for (const r of results) {
    if (isBlockedIp(r.address)) {
      return { ok: false, reason: `resolves-to-blocked:${r.address}`, addresses: [] };
    }
  }
  return { ok: true, addresses: results.map((r) => r.address) };
}
