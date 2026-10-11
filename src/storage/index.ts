/** مصنع طبقة التخزين: يختار LocalDisk أو S3 حسب الإعدادات. */
import { loadConfig } from '../config/env.ts';
import type { StorageAdapter } from './adapter.ts';
import { LocalDiskStorage } from './local.ts';
import { S3Storage } from './s3.ts';

let singleton: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (singleton) return singleton;
  const cfg = loadConfig();
  if (cfg.storage.driver === 's3') {
    const s = cfg.storage.s3;
    singleton = new S3Storage({
      endpoint: s.endpoint!,
      region: s.region,
      bucket: s.bucket!,
      accessKeyId: s.accessKeyId!,
      secretAccessKey: s.secretAccessKey!,
      forcePathStyle: s.forcePathStyle,
    });
  } else {
    singleton = new LocalDiskStorage(cfg.storage.localDir);
  }
  return singleton;
}

export type { StorageAdapter } from './adapter.ts';
