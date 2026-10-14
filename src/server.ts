/** مصنع خادم Fastify: الإضافات، المعالجة المركزية للأخطاء، والمسارات. */
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import { getLogger } from './lib/logger.ts';
import { isAppError } from './lib/errors.ts';
import { registerSecurity } from './plugins/security.ts';
import { registerRoutes } from './routes/index.ts';

function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (isAppError(error)) {
    if (error.statusCode >= 500) request.log.error({ err: error, details: error.details }, error.code);
    else request.log.warn({ code: error.code, details: error.details }, error.userMessage);
    reply.code(error.statusCode).send({ error: { code: error.code, message: error.userMessage } });
    return;
  }

  // أخطاء التحقّق من Fastify أو تجاوز الحجم أو التقنين
  const status = error.statusCode ?? 500;
  if (status >= 500) request.log.error({ err: error }, 'خطأ غير معالَج');
  else request.log.warn({ err: error.message }, 'طلب مرفوض');

  const message =
    status === 429
      ? 'طلبات كثيرة جدًّا، حاول لاحقًا.'
      : status === 413
        ? 'حجم البيانات أكبر من المسموح.'
        : status < 500
          ? error.message || 'طلب غير صالح.'
          : 'حدث خطأ غير متوقّع في الخادم.';
  reply.code(status).send({ error: { code: error.code ?? 'Error', message } });
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: getLogger() as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024, // 2MB لأجسام JSON؛ أجزاء الرفع تُعالَج كتدفّق octet-stream
  });

  await registerSecurity(app);
  app.setErrorHandler(errorHandler);
  await registerRoutes(app);

  return app;
}
