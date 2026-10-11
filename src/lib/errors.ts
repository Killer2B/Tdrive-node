/**
 * أخطاء التطبيق مع رسائل عربية موجّهة للمستخدم + تفاصيل تقنية للسجلّ.
 * المعالجة المركزية (routes/error-handler) تُرجع userMessage فقط للعميل.
 */

export interface AppErrorOptions {
  code: string;
  statusCode: number;
  /** رسالة واضحة بالعربية تظهر للمستخدم. */
  userMessage: string;
  /** تفاصيل تقنية تُسجَّل ولا تُرسل للعميل. */
  details?: unknown;
  /** الخطأ الأصلي للتسلسل. */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly userMessage: string;
  readonly details?: unknown;

  constructor(opts: AppErrorOptions) {
    super(opts.userMessage, { cause: opts.cause });
    this.name = 'AppError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.userMessage = opts.userMessage;
    this.details = opts.details;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export const errors = {
  badRequest: (userMessage = 'طلب غير صالح.', details?: unknown) =>
    new AppError({ code: 'BadRequest', statusCode: 400, userMessage, details }),

  unauthorized: (userMessage = 'يجب تسجيل الدخول أولًا.', details?: unknown) =>
    new AppError({ code: 'Unauthorized', statusCode: 401, userMessage, details }),

  forbidden: (userMessage = 'ليست لديك صلاحية لهذا الإجراء.', details?: unknown) =>
    new AppError({ code: 'Forbidden', statusCode: 403, userMessage, details }),

  notFound: (userMessage = 'العنصر المطلوب غير موجود.', details?: unknown) =>
    new AppError({ code: 'NotFound', statusCode: 404, userMessage, details }),

  conflict: (userMessage = 'تعارض مع الحالة الحالية.', details?: unknown) =>
    new AppError({ code: 'Conflict', statusCode: 409, userMessage, details }),

  payloadTooLarge: (userMessage = 'حجم البيانات أكبر من المسموح.', details?: unknown) =>
    new AppError({ code: 'PayloadTooLarge', statusCode: 413, userMessage, details }),

  rangeNotSatisfiable: (userMessage = 'نطاق البايتات المطلوب غير صالح.', details?: unknown) =>
    new AppError({ code: 'RangeNotSatisfiable', statusCode: 416, userMessage, details }),

  unprocessable: (userMessage = 'تعذّر معالجة المدخلات.', details?: unknown) =>
    new AppError({ code: 'Unprocessable', statusCode: 422, userMessage, details }),

  tooManyRequests: (userMessage = 'طلبات كثيرة جدًّا، حاول لاحقًا.', details?: unknown) =>
    new AppError({ code: 'TooManyRequests', statusCode: 429, userMessage, details }),

  internal: (userMessage = 'حدث خطأ غير متوقّع في الخادم.', details?: unknown) =>
    new AppError({ code: 'Internal', statusCode: 500, userMessage, details }),

  badGateway: (userMessage = 'تعذّر الوصول إلى المصدر الخارجي.', details?: unknown) =>
    new AppError({ code: 'BadGateway', statusCode: 502, userMessage, details }),

  serviceUnavailable: (userMessage = 'الخدمة غير متاحة مؤقّتًا.', details?: unknown) =>
    new AppError({ code: 'ServiceUnavailable', statusCode: 503, userMessage, details }),
};
