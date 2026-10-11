/** مسار SSE لبثّ تقدّم المهام والأحداث اللحظية للمستخدم. */
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.ts';
import { subscribe, type ProgressEvent } from '../services/progress.ts';
import { Jobs } from '../db/repo.ts';
import { toApiJob } from '../services/queue.ts';

export default async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/events', async (request, reply) => {
    const user = requireUser(request);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write('retry: 3000\n\n');

    const send = (e: ProgressEvent): void => {
      raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
    };

    // لقطة أوّلية للمهام النشطة
    for (const job of Jobs.listByUser(user.id, ['queued', 'running'])) {
      send({ type: 'job', data: toApiJob(job) });
    }

    const unsub = subscribe(user.id, send);
    const ping = setInterval(() => {
      try {
        raw.write('event: ping\ndata: {}\n\n');
      } catch {
        /* تجاهل */
      }
    }, 25_000);

    const close = (): void => {
      clearInterval(ping);
      unsub();
      try {
        raw.end();
      } catch {
        /* تجاهل */
      }
    };
    request.raw.on('close', close);
    request.raw.on('error', close);
  });
}
