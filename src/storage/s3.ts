/** تنفيذ التخزين المتوافق مع S3 (R2/MinIO/S3) عبر undici + توقيع SigV4. */
import { Readable } from 'node:stream';
import { request } from 'undici';
import {
  assertValidKey,
  type ByteRange,
  type PutOptions,
  type StatResult,
  type StorageAdapter,
} from './adapter.ts';
import { signRequestV4, uriEncode, amzDate, sha256Hex, EMPTY_SHA256, UNSIGNED_PAYLOAD } from './sigv4.ts';

export interface S3Options {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

interface SignedCall {
  method: string;
  key?: string;
  query?: Record<string, string>;
  extraHeaders?: Record<string, string>;
  body?: Readable | Buffer;
  payloadHash: string;
}

export class S3Storage implements StorageAdapter {
  readonly name = 's3';
  private readonly opt: S3Options;
  private readonly url: URL;

  constructor(opt: S3Options) {
    this.opt = opt;
    this.url = new URL(opt.endpoint);
  }

  private hostHeader(): string {
    return this.opt.forcePathStyle ? this.url.host : `${this.opt.bucket}.${this.url.host}`;
  }

  private rawPath(key?: string): string {
    const segs = key ? key.split('/') : [];
    if (this.opt.forcePathStyle) return '/' + [this.opt.bucket, ...segs].join('/');
    return '/' + segs.join('/');
  }

  private encodedPath(key?: string): string {
    return this.rawPath(key)
      .split('/')
      .map((s) => uriEncode(s, true))
      .join('/');
  }

  private queryString(query: Record<string, string>): string {
    return Object.keys(query)
      .sort()
      .map((k) => `${uriEncode(k)}=${uriEncode(query[k] ?? '')}`)
      .join('&');
  }

  private async call(c: SignedCall) {
    if (c.key) assertValidKey(c.key);
    const date = amzDate();
    const host = this.hostHeader();
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': c.payloadHash,
      ...c.extraHeaders,
    };
    const signed = signRequestV4({
      method: c.method,
      host,
      path: this.rawPath(c.key),
      query: c.query,
      headers,
      payloadHash: c.payloadHash,
      region: this.opt.region,
      service: 's3',
      accessKeyId: this.opt.accessKeyId,
      secretAccessKey: this.opt.secretAccessKey,
      amzDate: date,
    });

    const qs = c.query ? this.queryString(c.query) : '';
    const target = `${this.url.protocol}//${host}${this.encodedPath(c.key)}${qs ? `?${qs}` : ''}`;

    return request(target, {
      method: c.method as never,
      headers: {
        ...headers,
        'x-amz-date': date,
        authorization: signed.authorization,
      },
      body: c.body,
    });
  }

  async put(key: string, data: Readable | Buffer, opts?: PutOptions): Promise<StatResult> {
    const extraHeaders: Record<string, string> = {};
    if (opts?.contentType) extraHeaders['content-type'] = opts.contentType;

    let payloadHash: string;
    if (Buffer.isBuffer(data)) {
      payloadHash = data.length === 0 ? EMPTY_SHA256 : sha256Hex(data);
      extraHeaders['content-length'] = String(data.length);
    } else {
      payloadHash = UNSIGNED_PAYLOAD;
      if (opts?.size === undefined) {
        throw new Error('رفع تدفّقي إلى S3 يتطلّب تمرير الحجم (size)');
      }
      extraHeaders['content-length'] = String(opts.size);
    }

    const res = await this.call({ method: 'PUT', key, body: data, payloadHash, extraHeaders });
    await drain(res.body);
    if (res.statusCode >= 300) throw new Error(`S3 put فشل: HTTP ${res.statusCode}`);
    return {
      key,
      size: opts?.size ?? (Buffer.isBuffer(data) ? data.length : 0),
      etag: asString(res.headers['etag']),
    };
  }

  async putFile(key: string, sourcePath: string, opts?: PutOptions): Promise<StatResult> {
    const { stat } = await import('node:fs/promises');
    const { createReadStream } = await import('node:fs');
    const s = await stat(sourcePath);
    const result = await this.put(key, createReadStream(sourcePath), { ...opts, size: s.size });
    const { rm } = await import('node:fs/promises');
    await rm(sourcePath, { force: true }).catch(() => {});
    return result;
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.call({ method: 'GET', key, payloadHash: EMPTY_SHA256 });
    if (res.statusCode >= 300) {
      await drain(res.body);
      throw new Error(`S3 get فشل: HTTP ${res.statusCode}`);
    }
    const ab = await res.body.arrayBuffer();
    return Buffer.from(ab);
  }

  async createReadStream(key: string, range?: ByteRange): Promise<Readable> {
    const extraHeaders: Record<string, string> = {};
    if (range) extraHeaders['range'] = `bytes=${range.start}-${range.end}`;
    const res = await this.call({ method: 'GET', key, payloadHash: EMPTY_SHA256, extraHeaders });
    if (res.statusCode >= 300) {
      await drain(res.body);
      throw new Error(`S3 get(stream) فشل: HTTP ${res.statusCode}`);
    }
    return res.body as unknown as Readable;
  }

  async stat(key: string): Promise<StatResult | null> {
    const res = await this.call({ method: 'HEAD', key, payloadHash: EMPTY_SHA256 });
    await drain(res.body);
    if (res.statusCode === 404) return null;
    if (res.statusCode >= 300) return null;
    const size = Number(asString(res.headers['content-length']) ?? '0');
    const lm = asString(res.headers['last-modified']);
    return {
      key,
      size,
      etag: asString(res.headers['etag']),
      lastModified: lm ? Date.parse(lm) : undefined,
      contentType: asString(res.headers['content-type']),
    };
  }

  async delete(key: string): Promise<void> {
    const res = await this.call({ method: 'DELETE', key, payloadHash: EMPTY_SHA256 });
    await drain(res.body);
    if (res.statusCode >= 300 && res.statusCode !== 404) {
      throw new Error(`S3 delete فشل: HTTP ${res.statusCode}`);
    }
  }

  async list(prefix: string): Promise<StatResult[]> {
    const query: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' };
    const res = await this.call({ method: 'GET', query, payloadHash: EMPTY_SHA256 });
    if (res.statusCode >= 300) {
      await drain(res.body);
      throw new Error(`S3 list فشل: HTTP ${res.statusCode}`);
    }
    const xml = Buffer.from(await res.body.arrayBuffer()).toString('utf8');
    return parseListXml(xml);
  }
}

function asString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

async function drain(body: { arrayBuffer(): Promise<ArrayBuffer> } | Readable): Promise<void> {
  try {
    if (typeof (body as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
      await (body as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer();
    }
  } catch {
    /* تجاهل */
  }
}

function parseListXml(xml: string): StatResult[] {
  const out: StatResult[] = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
    const size = /<Size>(\d+)<\/Size>/.exec(block)?.[1];
    const lm = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(block)?.[1];
    const etag = /<ETag>([\s\S]*?)<\/ETag>/.exec(block)?.[1];
    if (!key) continue;
    out.push({
      key: decodeXml(key),
      size: Number(size ?? '0'),
      lastModified: lm ? Date.parse(lm) : undefined,
      etag: etag?.replace(/^&quot;|&quot;$/g, ''),
    });
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
