/** مساعد تشغيل العمليات الخارجية عبر spawn (مصفوفة وسائط، بلا صدفة — حماية من حقن الأوامر). */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  cwd?: string;
  maxBuffer?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * يقتل العملية وشجرتها.
 * على Windows لا يقتل SIGKILL سوى العملية المباشرة، فتبقى عمليات ffmpeg التي أطلقها
 * yt-dlp حيّة وتمسك الملفّات (تفشل إزالة مجلّد العمل). نستخدم taskkill /T لهذا.
 */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    } catch {
      /* نكمل إلى kill العادي */
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* تجاهل */
  }
}

/** يشغّل أمرًا ويلتقط stdout/stderr (للأوامر القصيرة مثل probe/version). */
export function runCapture(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = { cwd: opts.cwd, shell: false, windowsHide: true, env: opts.env };
    const child = spawn(cmd, args, spawnOpts);
    const maxBuffer = opts.maxBuffer ?? 32 * 1024 * 1024;
    let stdout = '';
    let stderr = '';
    let killed = false;
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killed = true;
          killTree(child);
        }, opts.timeoutMs)
      : null;

    const onAbort = (): void => {
      killed = true;
      killTree(child);
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
      if (stdout.length > maxBuffer) {
        killTree(child);
        settle(() => reject(new Error('تجاوز الإخراج الحدّ المسموح')));
      }
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
      if (stderr.length > maxBuffer) stderr = stderr.slice(-maxBuffer);
    });

    child.on('error', (err) => {
      settle(() => reject(err));
    });
    child.on('close', (code) => {
      settle(() => {
        if (killed) reject(new Error(opts.signal?.aborted ? 'أُلغيت العملية' : 'انتهت مهلة العملية'));
        else resolve({ code, stdout, stderr });
      });
    });

    if (opts.input !== undefined && child.stdin) {
      child.stdin.end(opts.input);
    }
  });
}

/** يتحقّق من توفّر أمر خارجي (يعيد true/false). */
export async function commandExists(cmd: string, versionArg = '--version'): Promise<boolean> {
  try {
    const r = await runCapture(cmd, [versionArg], { timeoutMs: 8000 });
    return r.code === 0 || r.stdout.length > 0 || r.stderr.length > 0;
  } catch {
    return false;
  }
}
