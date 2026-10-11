/** واجهة طبقة التخزين المجرّدة (Storage Adapter). */
import type { Readable } from 'node:stream';

export interface StatResult {
  key: string;
  size: number;
  etag?: string;
  lastModified?: number;
  contentType?: string;
}

export interface PutOptions {
  contentType?: string;
  /** الحجم الكلّي المعروف مسبقًا (مطلوب لبعض الخلفيّات مثل S3). */
  size?: number;
}

export interface ByteRange {
  start: number;
  end: number; // شامل
}

/**
 * واجهة موحّدة لكل خلفيّات التخزين. كل العمليات تدفّقية حيثما أمكن.
 * المفاتيح (keys) تستخدم `/` كفاصل، وتُحقّق ضدّ الـ traversal في كل تنفيذ.
 */
export interface StorageAdapter {
  readonly name: string;

  /** يكتب كائنًا من تدفّق أو مخزَن مؤقّت. يُعيد وصف الكائن النهائي. */
  put(key: string, data: Readable | Buffer, opts?: PutOptions): Promise<StatResult>;

  /** يكتب كائنًا من ملف على القرص (قد يستخدم rename سريعًا محليًّا). يُستهلك ملف المصدر. */
  putFile(key: string, sourcePath: string, opts?: PutOptions): Promise<StatResult>;

  /** يقرأ كائنًا صغيرًا كاملًا (للصور المصغّرة/النسخ الاحتياطي فقط — لا للملفّات الكبيرة). */
  get(key: string): Promise<Buffer>;

  /** تدفّق قراءة مع دعم Range (للبثّ 206). */
  createReadStream(key: string, range?: ByteRange): Promise<Readable>;

  /** بيانات وصفية أو null إن لم يوجد. */
  stat(key: string): Promise<StatResult | null>;

  /** يحذف كائنًا (لا يفشل إن لم يوجد). */
  delete(key: string): Promise<void>;

  /** يسرد الكائنات تحت بادئة. */
  list(prefix: string): Promise<StatResult[]>;
}

const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

/** يتحقّق أن مفتاح التخزين آمن (بلا traversal ولا محارف غريبة). */
export function assertValidKey(key: string): void {
  if (!key || key.length > 1024) throw new Error('مفتاح تخزين غير صالح (طول)');
  if (key.includes('..') || key.includes('//') || key.startsWith('/') || key.endsWith('/')) {
    throw new Error('مفتاح تخزين غير صالح (مسار)');
  }
  if (!KEY_RE.test(key)) throw new Error('مفتاح تخزين يحوي محارف غير مسموحة');
}
