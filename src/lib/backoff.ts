/** تراجع أسّي مع jitter لإعادة المحاولة. نقي (بلا تبعيات). */

export interface BackoffOptions {
  baseMs?: number;
  factor?: number;
  maxMs?: number;
  /** نسبة التشويش العشوائي 0..1 (0.2 = ±20%). */
  jitter?: number;
}

/**
 * يحسب تأخير المحاولة رقم attempt (ابتداءً من 1).
 * attempt=1 ⇒ ~base، ثم يتضاعف حتى maxMs، مع jitter.
 */
export function backoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 1000;
  const factor = opts.factor ?? 2;
  const max = opts.maxMs ?? 60_000;
  const jitter = opts.jitter ?? 0.2;

  const n = Math.max(1, Math.floor(attempt));
  const raw = base * Math.pow(factor, n - 1);
  const capped = Math.min(max, raw);
  if (jitter <= 0) return Math.round(capped);

  const delta = capped * jitter;
  const min = capped - delta;
  const span = delta * 2;
  return Math.round(min + Math.random() * span);
}

/** الحدّ الأقصى الحتميّ للتأخير (بلا jitter) لاختباره. */
export function backoffCeiling(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 1000;
  const factor = opts.factor ?? 2;
  const max = opts.maxMs ?? 60_000;
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(max, base * Math.pow(factor, n - 1));
}

/** ينام مدّة ms (قابل للإلغاء عبر AbortSignal). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
