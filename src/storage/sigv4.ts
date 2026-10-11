/** موقّع AWS Signature V4 (نقي: node:crypto فقط) للتخزين المتوافق مع S3. */
import { createHash, createHmac } from 'node:crypto';

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** ترميز RFC3986 لكل بايت عدا A-Za-z0-9-_.~ */
export function uriEncode(input: string, encodeSlash = true): string {
  let out = '';
  for (const byte of Buffer.from(input, 'utf8')) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(ch)) out += ch;
    else if (ch === '/' && !encodeSlash) out += ch;
    else out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

function canonicalUri(path: string): string {
  if (!path || path === '/') return '/';
  return path
    .split('/')
    .map((seg) => uriEncode(seg, true))
    .join('/');
}

function canonicalQuery(query: Record<string, string>): string {
  const keys = Object.keys(query).sort();
  return keys.map((k) => `${uriEncode(k)}=${uriEncode(query[k] ?? '')}`).join('&');
}

export interface SignInput {
  method: string;
  host: string;
  path: string;
  query?: Record<string, string>;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  amzDate: string; // YYYYMMDDTHHMMSSZ
}

export interface SignResult {
  authorization: string;
  signedHeaders: string;
  signature: string;
  canonicalRequest: string;
  stringToSign: string;
}

/** يحسب توقيع SigV4 ويعيد ترويسة Authorization. */
export function signRequestV4(input: SignInput): SignResult {
  const datestamp = input.amzDate.slice(0, 8);
  const scope = `${datestamp}/${input.region}/${input.service}/aws4_request`;

  // ادمج x-amz-date ضمن الترويسات الموقّعة
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) headers[k.toLowerCase()] = String(v).trim();
  headers['x-amz-date'] = input.amzDate;

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(input.path),
    canonicalQuery(input.query ?? {}),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    input.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${input.secretAccessKey}`, datestamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, signedHeaders, signature, canonicalRequest, stringToSign };
}

/** الطابع الزمني بصيغة AMZ من Date. */
export function amzDate(date = new Date()): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

export { sha256Hex };
