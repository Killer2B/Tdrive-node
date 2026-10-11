/** هندسة تقسيم الملف إلى أجزاء للرفع المجزّأ القابل للاستئناف. نقي. */

export interface ChunkPlan {
  size: number;
  chunkSize: number;
  totalChunks: number;
  lastChunkSize: number;
}

/**
 * يحسب خطّة التقسيم. ملف فارغ ⇒ جزء واحد بحجم صفر (متوافق مع البروتوتايب).
 * الصيغة متطابقة بين العميل والخادم: totalChunks = max(1, ceil(size/chunk)).
 */
export function planChunks(size: number, chunkSize: number): ChunkPlan {
  if (!Number.isInteger(size) || size < 0) throw new Error('size must be a non-negative integer');
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error('chunkSize must be a positive integer');
  const totalChunks = Math.max(1, Math.ceil(size / chunkSize));
  const lastChunkSize = size === 0 ? 0 : size - (totalChunks - 1) * chunkSize;
  return { size, chunkSize, totalChunks, lastChunkSize };
}

/** إزاحة بداية الجزء رقم index (يبدأ من 0). */
export function offsetOfChunk(index: number, chunkSize: number): number {
  return index * chunkSize;
}

/** الحجم المتوقّع للجزء رقم index ضمن خطّة. */
export function sizeOfChunk(plan: ChunkPlan, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= plan.totalChunks) {
    throw new Error(`chunk index out of range: ${index}`);
  }
  return index === plan.totalChunks - 1 ? plan.lastChunkSize : plan.chunkSize;
}

/** يتحقّق أن طول الجزء المستلَم يطابق المتوقّع. */
export function isValidChunkLength(plan: ChunkPlan, index: number, receivedLength: number): boolean {
  return sizeOfChunk(plan, index) === receivedLength;
}

/**
 * يحوّل مجموعة فهارس مُستلَمة إلى مدَيات مضغوطة [start,end] لتوفير حجم الاستجابة.
 * بدل مصفوفة ضخمة من الفهارس (إصلاح L4 في AUDIT).
 */
export function toRanges(indices: Iterable<number>): Array<[number, number]> {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const idx of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && idx === last[1] + 1) last[1] = idx;
    else ranges.push([idx, idx]);
  }
  return ranges;
}

/** يحسب الفهارس الناقصة بالنظر للمستلَمة وإجمالي الأجزاء. */
export function missingChunks(received: Iterable<number>, totalChunks: number): number[] {
  const have = new Set(received);
  const missing: number[] = [];
  for (let i = 0; i < totalChunks; i++) if (!have.has(i)) missing.push(i);
  return missing;
}
