/** مساعد تشغيل العمليات الخارجية عبر spawn (مصفوفة وسائط، بلا صدفة — حماية من حقن الأوامر). */
import { spawn, type SpawnOptions } from 'node:child_process';

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
}

/** يشغّل أمرًا ويلتقط stdout/stderr (للأوامر القصيرة مثل probe/version). */
export function runCapture(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = { cwd: opts.cwd, shell: false, windowsHide: true };
    const child = spawn(cmd, args, spawnOpts);
    const maxBuffer = opts.maxBuffer ?? 32 * 1024 * 1024;
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killed = true;
          child.kill('SIGKILL');
        }, opts.timeoutMs)
      : null;

    const onAbort = (): void => {
      killed = true;
      child.kill('SIGKILL');
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
      if (stdout.length > maxBuffer) {
        child.kill('SIGKILL');
        reject(new Error('تجاوز الإخراج الحدّ المسموح'));
      }
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
      if (stderr.length > maxBuffer) stderr = stderr.slice(-maxBuffer);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (killed) reject(new Error(opts.signal?.aborted ? 'أُلغيت العملية' : 'انتهت مهلة العملية'));
      else resolve({ code, stdout, stderr });
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
