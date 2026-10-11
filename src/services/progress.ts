/** ناقل التقدّم اللحظي عبر SSE (في العملية). كل مستخدم قناة مستقلّة. */
import { EventEmitter } from 'node:events';
import type { JobRow } from '../db/repo.ts';

export interface ProgressEvent {
  type: 'job' | 'file' | 'ping';
  data: unknown;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

function channel(userId: string): string {
  return `u:${userId}`;
}

export function publish(userId: string, event: ProgressEvent): void {
  bus.emit(channel(userId), event);
}

export function publishJob(job: JobRow): void {
  publish(job.user_id, {
    type: 'job',
    data: {
      id: job.id,
      type: job.type,
      status: job.status,
      name: job.title,
      progress: job.progress,
      speed: job.speed,
      eta: job.eta,
      stage: job.stage,
      totalBytes: job.total_bytes,
      doneBytes: job.done_bytes,
      error: job.error,
      fileId: job.file_id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      updatedAt: job.updated_at,
    },
  });
}

export function subscribe(userId: string, listener: (e: ProgressEvent) => void): () => void {
  const ch = channel(userId);
  bus.on(ch, listener);
  return () => bus.off(ch, listener);
}
