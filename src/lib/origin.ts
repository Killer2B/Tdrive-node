/** تحقّق أصل الطلب (CSRF) بتسامح: نقي وقابل للاختبار. */

/** يستخرج المضيف من URL أو يعيد null عند الفشل. */
export function hostOf(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * هل الأصل (Origin) مسموح؟ يقبل عند تطابق المضيف مع أيّ من القيم المسموحة
 * (روابط كاملة أو مضيفات مجرّدة). لا يرفض عند تعذّر تحليل الأصل — الكوكي SameSite هو
 * الحماية الأساسية، وفحص الأصل دفاع بالعمق فقط.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: Array<string | undefined>): boolean {
  if (!origin) return true; // غير متصفّح/بلا أصل: الكوكي + SameSite يكفيان
  const originHost = hostOf(origin);
  if (!originHost) return true; // أصل غير قابل للتحليل: لا نرفض (نتجنّب الإيجابيات الكاذبة)

  const hosts = new Set<string>();
  for (const a of allowed) {
    if (!a) continue;
    const h = hostOf(a) ?? a.split('/')[0].trim();
    if (h) hosts.add(h.toLowerCase());
  }
  return hosts.has(originHost.toLowerCase());
}
