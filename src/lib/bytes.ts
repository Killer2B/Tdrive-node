/** صياغة/تحليل أحجام البايتات. نقي (بلا تبعيات). */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** يصيغ عدد بايتات إلى نص مقروء (أساس 1024). */
export function formatBytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1) return '0 B';
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  const fixed = i === 0 ? 0 : decimals;
  return `${Number(value.toFixed(fixed))} ${UNITS[i]}`;
}

/** يحوّل MB إلى بايت. */
export function mbToBytes(mb: number): number {
  return Math.round(mb * 1024 * 1024);
}

/** يحوّل GB إلى بايت. */
export function gbToBytes(gb: number): number {
  return Math.round(gb * 1024 * 1024 * 1024);
}

/** يحلّل نصًّا مثل "18MB" أو "2 gb" إلى بايتات، أو null عند الفشل. */
export function parseBytes(input: string): number | null {
  const m = /^\s*([\d.]+)\s*(b|kb|mb|gb|tb|pb)?\s*$/i.exec(input);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (m[2] ?? 'b').toUpperCase();
  const idx = UNITS.indexOf(unit as (typeof UNITS)[number]);
  if (idx === -1) return null;
  return Math.round(value * Math.pow(1024, idx));
}
