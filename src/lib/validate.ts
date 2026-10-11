/** مساعد تحقّق المدخلات بـ zod. */
import type { ZodType } from 'zod';
import { errors } from './errors.ts';

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw errors.unprocessable('مدخلات غير صالحة.', r.error.issues);
  }
  return r.data;
}
