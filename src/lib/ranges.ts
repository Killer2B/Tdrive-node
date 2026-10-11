/** تحليل ترويسة HTTP Range لبثّ الفيديو. نقي (بلا تبعيات). */

export interface ByteRange {
  start: number;
  end: number; // شامل
}

export type RangeParseResult =
  | { type: 'full' } // لا توجد ترويسة Range
  | { type: 'ok'; range: ByteRange }
  | { type: 'unsatisfiable' }; // يجب الردّ بـ 416

/**
 * يحلّل `Range: bytes=...` لحجم معروف.
 * يدعم: bytes=start-end، bytes=start-، bytes=-suffix.
 * نتعامل مع نطاق واحد فقط (المتصفّحات ترسل نطاقًا واحدًا للفيديو).
 */
export function parseRange(header: string | undefined, size: number): RangeParseResult {
  if (!header) return { type: 'full' };
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith('bytes=')) return { type: 'unsatisfiable' };

  const spec = trimmed.slice(6).trim();
  // ارفض النطاقات المتعدّدة (نحتاج نطاقًا واحدًا للبثّ المباشر)
  if (spec.includes(',')) return { type: 'unsatisfiable' };

  const dash = spec.indexOf('-');
  if (dash === -1) return { type: 'unsatisfiable' };

  const startStr = spec.slice(0, dash).trim();
  const endStr = spec.slice(dash + 1).trim();

  if (size <= 0) {
    // لا بايتات لنقدّمها
    return { type: 'unsatisfiable' };
  }

  // suffix: bytes=-N (آخر N بايت)
  if (startStr === '') {
    if (endStr === '') return { type: 'unsatisfiable' };
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix <= 0) return { type: 'unsatisfiable' };
    const start = Math.max(0, size - suffix);
    return { type: 'ok', range: { start, end: size - 1 } };
  }

  const start = Number(startStr);
  if (!Number.isInteger(start) || start < 0) return { type: 'unsatisfiable' };
  if (start >= size) return { type: 'unsatisfiable' };

  let end: number;
  if (endStr === '') {
    end = size - 1;
  } else {
    const e = Number(endStr);
    if (!Number.isInteger(e) || e < start) return { type: 'unsatisfiable' };
    end = Math.min(e, size - 1);
  }

  return { type: 'ok', range: { start, end } };
}
