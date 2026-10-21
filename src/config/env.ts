/** إعدادات التطبيق: تُقرأ من البيئة وتُتحقّق بـ zod. مصدر الحقيقة الوحيد للحدود. */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { mbToBytes, gbToBytes } from '../lib/bytes.ts';

let dotenvLoaded = false;

/** مُحمِّل .env بسيط بلا تبعيات؛ لا يطغى على متغيّرات البيئة الحقيقية. */
function ensureDotenv(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  const file = path.resolve(process.cwd(), '.env');
  if (!existsSync(file)) return;
  try {
    const content = readFileSync(file, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const withoutExport = line.startsWith('export ') ? line.slice(7) : line;
      const eq = withoutExport.indexOf('=');
      if (eq === -1) continue;
      const key = withoutExport.slice(0, eq).trim();
      let value = withoutExport.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* تجاهل أخطاء قراءة .env */
  }
}

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

/** يقسّم وسائط نصّية مع احترام الاقتباس: `--extractor-args "youtube:player_client=default"`. */
function splitArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const token = m[1] ?? m[2] ?? m[3];
    if (token) out.push(token);
  }
  return out;
}

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  OWNER_USERNAME: z.string().min(1).default('owner'),
  OWNER_PASSWORD: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET يجب أن يكون 16 محرفًا على الأقل'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./data/storage'),
  TMP_DIR: z.string().default('./data/tmp'),

  // قاعدة البيانات: Supabase/Postgres فقط (لا تخزين محلّي).
  // الصيغة: postgresql://postgres.<ref>:<password>@<host>:5432/postgres
  SUPABASE_DB_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  DB_SCHEMA: z.string().default('tdrive'),
  DB_SSL: boolish.default(true),
  DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolish.default(true),

  // backend التخزين الدائم للمحتوى: telegram (أساسي) أو local (القرص دائم)
  CONTENT_BACKEND: z.enum(['telegram', 'local']).default('telegram'),
  TG_BOT_TOKEN: z.string().optional(),
  TG_CHAT_ID: z.string().optional(),
  TG_MIN_GAP_MS: z.coerce.number().int().nonnegative().default(3000),
  TG_API_BASE: z.string().default('https://api.telegram.org'),
  // سقف كاش القطع على القرص (GB) — يُخلى تلقائيًّا للقطع المؤكّدة على Telegram
  CACHE_CAP_GB: z.coerce.number().positive().default(4),

  CHUNK_SIZE_MB: z.coerce.number().positive().default(18),
  MAX_FILE_SIZE_GB: z.coerce.number().nonnegative().default(0),
  MAX_PART_BODY_MB: z.coerce.number().positive().default(20),

  DOWNLOAD_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().max(50).default(5),
  HTTP_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  HTTP_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  YTDLP_PATH: z.string().default('yt-dlp'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  THUMBNAILS_ENABLED: boolish.default(true),
  // ملف كوكيز (cookies.txt) لتجاوز "تأكيد أنك لست روبوتًا" في YouTube على خوادم الاستضافة
  YTDLP_COOKIES: z.string().optional(),
  // وسائط إضافية لـ yt-dlp مفصولة بمسافات (مثل: --extractor-args youtube:player_client=default)
  YTDLP_EXTRA_ARGS: z.string().default(''),
  // مهلة قراءة بيانات الرابط (ms) — يوتيوب البطيء يحتاج أكثر من 15 ثانية أحيانًا
  YTDLP_PROBE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // إن لم يُرسل yt-dlp أي تقدّم خلال هذه المدّة يُنهى التحميل العالق (ms)
  YTDLP_STALL_TIMEOUT_MS: z.coerce.number().int().min(30_000).default(300_000),

  BACKUP_ENABLED: boolish.default(false),
  BACKUP_INTERVAL_HOURS: z.coerce.number().positive().default(18),
  MYSQL_BACKUP_URL: z.string().optional(),
  BACKUP_RETENTION: z.coerce.number().int().positive().default(14),
  BACKUP_PREFIX: z.string().default('_system/backups'),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  CORS_ORIGINS: z.string().default(''),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface Config {
  nodeEnv: string;
  isProd: boolean;
  host: string;
  port: number;
  publicUrl: string;
  logLevel: RawEnv['LOG_LEVEL'];
  owner: { username: string; password?: string };
  session: { secret: string; ttlMs: number };
  storage: {
    driver: 'local' | 's3';
    localDir: string;
    tmpDir: string;
    s3: {
      endpoint?: string;
      region: string;
      bucket?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      forcePathStyle: boolean;
    };
  };
  db: {
    url: string;
    schema: string;
    ssl: boolean;
    poolMax: number;
    connectTimeoutMs: number;
  };
  content: { backend: 'telegram' | 'local' };
  telegram: { token?: string; chatId?: string; minGapMs: number; apiBase: string };
  cache: { capBytes: number };
  upload: { chunkSize: number; maxFileSize: number; maxPartBody: number };
  queue: {
    downloadConcurrency: number;
    jobMaxAttempts: number;
    httpConnectTimeoutMs: number;
    httpIdleTimeoutMs: number;
  };
  tools: {
    ytdlpPath: string;
    ffmpegPath: string;
    ffprobePath: string;
    thumbnailsEnabled: boolean;
    cookies?: string;
    extraArgs: string[];
    probeTimeoutMs: number;
    stallTimeoutMs: number;
  };
  backup: {
    enabled: boolean;
    intervalHours: number;
    mysqlUrl?: string;
    retention: number;
    prefix: string;
  };
  security: { rateLimitMax: number; rateLimitWindow: string; corsOrigins: string[] };
}

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  ensureDotenv();
  // بيئات الاستضافة المُدارة (Pterodactyl/HidenCloud) تحقن المنفذ عبر SERVER_PORT
  if (!process.env.PORT && process.env.SERVER_PORT) process.env.PORT = process.env.SERVER_PORT;
  const source = env === process.env ? process.env : env;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`إعدادات البيئة غير صالحة:\n${issues}\nراجع .env.example`);
  }
  const e = parsed.data;

  if (e.STORAGE_DRIVER === 's3') {
    for (const [k, v] of Object.entries({
      S3_ENDPOINT: e.S3_ENDPOINT,
      S3_BUCKET: e.S3_BUCKET,
      S3_ACCESS_KEY_ID: e.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: e.S3_SECRET_ACCESS_KEY,
    })) {
      if (!v) throw new Error(`التخزين S3 مفعّل لكن ${k} غير مضبوط`);
    }
  }
  if (e.BACKUP_ENABLED && !e.MYSQL_BACKUP_URL) {
    throw new Error('BACKUP_ENABLED=true لكن MYSQL_BACKUP_URL غير مضبوط');
  }
  if (e.CONTENT_BACKEND === 'telegram') {
    if (!e.TG_BOT_TOKEN) throw new Error('CONTENT_BACKEND=telegram لكن TG_BOT_TOKEN غير مضبوط');
    if (!e.TG_CHAT_ID) throw new Error('CONTENT_BACKEND=telegram لكن TG_CHAT_ID غير مضبوط');
  }
  const dbUrl = e.SUPABASE_DB_URL ?? e.DATABASE_URL;
  if (!dbUrl) {
    throw new Error(
      'SUPABASE_DB_URL غير مضبوط: التطبيق يعمل على Supabase/Postgres فقط. ' +
        'انسخ سلسلة الاتصال (Session pooler) من لوحة Supabase إلى .env',
    );
  }

  cached = {
    nodeEnv: e.NODE_ENV,
    isProd: e.NODE_ENV === 'production',
    host: e.HOST,
    port: e.PORT,
    publicUrl: e.PUBLIC_URL.replace(/\/+$/, ''),
    logLevel: e.LOG_LEVEL,
    owner: { username: e.OWNER_USERNAME, password: e.OWNER_PASSWORD },
    session: { secret: e.SESSION_SECRET, ttlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000 },
    storage: {
      driver: e.STORAGE_DRIVER,
      localDir: e.LOCAL_STORAGE_DIR,
      tmpDir: e.TMP_DIR,
      s3: {
        endpoint: e.S3_ENDPOINT,
        region: e.S3_REGION,
        bucket: e.S3_BUCKET,
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
        forcePathStyle: e.S3_FORCE_PATH_STYLE,
      },
    },
    db: {
      url: dbUrl,
      schema: e.DB_SCHEMA,
      ssl: e.DB_SSL,
      poolMax: e.DB_POOL_MAX,
      connectTimeoutMs: e.DB_CONNECT_TIMEOUT_MS,
    },
    content: { backend: e.CONTENT_BACKEND },
    telegram: {
      token: e.TG_BOT_TOKEN,
      chatId: e.TG_CHAT_ID,
      minGapMs: e.TG_MIN_GAP_MS,
      apiBase: e.TG_API_BASE.replace(/\/+$/, ''),
    },
    cache: { capBytes: gbToBytes(e.CACHE_CAP_GB) },
    upload: {
      chunkSize: mbToBytes(e.CHUNK_SIZE_MB),
      maxFileSize: e.MAX_FILE_SIZE_GB > 0 ? gbToBytes(e.MAX_FILE_SIZE_GB) : 0,
      maxPartBody: mbToBytes(e.MAX_PART_BODY_MB),
    },
    queue: {
      downloadConcurrency: e.DOWNLOAD_CONCURRENCY,
      jobMaxAttempts: e.JOB_MAX_ATTEMPTS,
      httpConnectTimeoutMs: e.HTTP_CONNECT_TIMEOUT_MS,
      httpIdleTimeoutMs: e.HTTP_IDLE_TIMEOUT_MS,
    },
    tools: {
      ytdlpPath: e.YTDLP_PATH,
      ffmpegPath: e.FFMPEG_PATH,
      ffprobePath: e.FFPROBE_PATH,
      thumbnailsEnabled: e.THUMBNAILS_ENABLED,
      cookies: e.YTDLP_COOKIES,
      extraArgs: splitArgs(e.YTDLP_EXTRA_ARGS),
      probeTimeoutMs: e.YTDLP_PROBE_TIMEOUT_MS,
      stallTimeoutMs: e.YTDLP_STALL_TIMEOUT_MS,
    },
    backup: {
      enabled: e.BACKUP_ENABLED,
      intervalHours: e.BACKUP_INTERVAL_HOURS,
      mysqlUrl: e.MYSQL_BACKUP_URL,
      retention: e.BACKUP_RETENTION,
      prefix: e.BACKUP_PREFIX.replace(/^\/+|\/+$/g, ''),
    },
    security: {
      rateLimitMax: e.RATE_LIMIT_MAX,
      rateLimitWindow: e.RATE_LIMIT_WINDOW,
      corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    },
  };
  return cached;
}

/** للاختبارات: يعيد ضبط النسخة المخبّأة. */
export function resetConfigCache(): void {
  cached = null;
}
