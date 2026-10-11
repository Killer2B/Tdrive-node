/** تعقيم أسماء الملفات والمسارات + ضمان الاحتواء داخل جذر التخزين. */
import path from 'node:path';

const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export const MAX_NAME_LENGTH = 200;
export const MAX_PATH_LENGTH = 1024;

/** يفصل الاسم إلى (الجذع، الامتداد مع النقطة). */
export function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * يعقّم اسم ملف ليكون آمنًا على كل أنظمة الملفّات:
 * - يأخذ آخر مقطع فقط (يمنع أي فاصل مسار أو `..`)
 * - يزيل محارف التحكّم والمحارف غير القانونية
 * - يقلّم المسافات/النقاط الطرفية ويتجنّب الأسماء المحجوزة على Windows
 * - يحدّ الطول مع الحفاظ على الامتداد
 */
export function sanitizeFileName(input: string, fallback = 'file'): string {
  let name = String(input ?? '');
  // آخر مقطع فقط (يمنع traversal)
  name = name.split(/[/\\]/).pop() ?? '';
  // أزل محارف التحكّم والمحارف غير القانونية
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_');
  // قلّم المسافات والنقاط الطرفية
  name = name.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
  // لا يُسمح بـ ".." أو "."
  if (name === '' || name === '.' || name === '..') name = fallback;

  // تجنّب الأسماء المحجوزة على Windows
  const { stem, ext } = splitExt(name);
  if (WINDOWS_RESERVED.has(stem.toLowerCase())) {
    name = `_${name}`;
  }

  // حدّ الطول مع الحفاظ على الامتداد
  if (name.length > MAX_NAME_LENGTH) {
    const parts = splitExt(name);
    const keepExt = parts.ext.length <= 16 ? parts.ext : '';
    name = parts.stem.slice(0, MAX_NAME_LENGTH - keepExt.length) + keepExt;
  }
  return name || fallback;
}

/** هل المقطع آمن (لا فواصل، لا `..`)؟ */
export function isSafeSegment(seg: string): boolean {
  if (!seg || seg === '.' || seg === '..') return false;
  if (seg.length > MAX_NAME_LENGTH) return false;
  // eslint-disable-next-line no-control-regex
  return !/[/\\\u0000]/.test(seg);
}

/**
 * يطبّع مسارًا افتراضيًّا للمجلّدات (عمود `path` في القاعدة):
 * يبدأ بـ `/`، بلا `..`، بلا شُرَط مكرّرة، بلا مسافات طرفية في المقاطع.
 */
export function normalizeVirtualPath(input: string): string {
  const raw = String(input ?? '/').replace(/\\/g, '/');
  const segments = raw.split('/').filter((s) => s.length > 0);
  const out: string[] = [];
  for (const seg of segments) {
    const clean = seg.trim();
    if (clean === '' || clean === '.') continue;
    if (clean === '..') {
      out.pop();
      continue;
    }
    if (!isSafeSegment(clean)) throw new Error(`segment غير صالح في المسار: ${seg}`);
    out.push(clean);
  }
  const joined = '/' + out.join('/');
  if (joined.length > MAX_PATH_LENGTH) throw new Error('المسار أطول من الحدّ المسموح');
  return joined === '/' ? '/' : joined;
}

/**
 * يحلّ مسارًا داخل جذر ويؤكّد احتواءه (حماية Path Traversal — إصلاح S4).
 * يرمي خطأً إن خرج المسار عن الجذر.
 */
export function resolveWithin(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const rel = path.relative(resolvedRoot, target);
  if (rel === '' ) return target; // نفس الجذر
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('محاولة الوصول خارج جذر التخزين مرفوضة');
  }
  return target;
}
