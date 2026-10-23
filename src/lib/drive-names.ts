import { MAX_NAME_LENGTH, sanitizeFileName, splitExt } from './paths.ts';
import { errors } from './errors.ts';

/** One namespace for files and folders; reserve suffix space before truncating. */
export async function availableName(
  desired: string,
  type: 'file' | 'folder',
  occupied: (name: string) => Promise<boolean>,
): Promise<string> {
  const safe = sanitizeFileName(desired);
  if (!await occupied(safe)) return safe;
  const parts = type === 'file' ? splitExt(safe) : { stem: safe, ext: '' };
  const ext = parts.ext.length <= 16 ? parts.ext : '';
  for (let n = 1; n < 10_000; n++) {
    const suffix = ` (${n})`;
    const candidate = `${parts.stem.slice(0, MAX_NAME_LENGTH - suffix.length - ext.length)}${suffix}${ext}`;
    if (!await occupied(candidate)) return candidate;
  }
  throw errors.conflict('No available name remains in this folder.');
}
