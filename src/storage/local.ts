/** تنفيذ التخزين على القرص المحلّي (الافتراضي). */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat as fsStat, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveWithin } from '../lib/paths.ts';
import { assertValidKey, type ByteRange, type PutOptions, type StatResult, type StorageAdapter } from './adapter.ts';

export class LocalDiskStorage implements StorageAdapter {
  readonly name = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private pathFor(key: string): string {
    assertValidKey(key);
    return resolveWithin(this.root, ...key.split('/'));
  }

  async put(key: string, data: Readable | Buffer, _opts?: PutOptions): Promise<StatResult> {
    const target = this.pathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    // كتابة إلى ملف مؤقّت ثم إعادة تسمية ذرّية لتجنّب كائن نصفيّ عند الانقطاع
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    const source = Buffer.isBuffer(data) ? Readable.from(data) : data;
    try {
      await pipeline(source, createWriteStream(tmp));
      const { rename } = await import('node:fs/promises');
      await rename(tmp, target);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    const st = await fsStat(target);
    return { key, size: st.size, lastModified: st.mtimeMs };
  }

  async putFile(key: string, sourcePath: string, _opts?: PutOptions): Promise<StatResult> {
    const target = this.pathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    const { rename, copyFile, rm: rmFile, stat: statFile } = await import('node:fs/promises');
    try {
      await rename(sourcePath, target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(sourcePath, target);
        await rmFile(sourcePath, { force: true });
      } else {
        throw e;
      }
    }
    const s = await statFile(target);
    return { key, size: s.size, lastModified: s.mtimeMs };
  }

  async get(key: string): Promise<Buffer> {
    const target = this.pathFor(key);
    const { readFile } = await import('node:fs/promises');
    return readFile(target);
  }

  async createReadStream(key: string, range?: ByteRange): Promise<Readable> {
    const target = this.pathFor(key);
    // تأكّد من وجوده أولًا حتى نرمي خطأً واضحًا بدل انبعاث error في منتصف البثّ
    await fsStat(target);
    if (range) return createReadStream(target, { start: range.start, end: range.end });
    return createReadStream(target);
  }

  async stat(key: string): Promise<StatResult | null> {
    const target = this.pathFor(key);
    try {
      const st = await fsStat(target);
      if (!st.isFile()) return null;
      return { key, size: st.size, lastModified: st.mtimeMs };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.pathFor(key);
    await rm(target, { force: true });
  }

  async list(prefix: string): Promise<StatResult[]> {
    // البادئة قد تكون جزئية؛ نسرد المجلّد الأب ونصفّي
    const safePrefix = prefix.replace(/[^A-Za-z0-9._/-]/g, '');
    const dir = resolveWithin(this.root, ...safePrefix.split('/').filter(Boolean));
    const out: StatResult[] = [];
    const walk = async (abs: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (ent.name.endsWith('.tmp') || ent.name.includes('.tmp-')) continue;
        const childRel = rel ? `${rel}/${ent.name}` : ent.name;
        const childAbs = path.join(abs, ent.name);
        if (ent.isDirectory()) await walk(childAbs, childRel);
        else {
          const st = await fsStat(childAbs);
          out.push({ key: childRel, size: st.size, lastModified: st.mtimeMs });
        }
      }
    };
    await walk(dir, safePrefix.replace(/\/+$/, ''));
    return out;
  }
}
