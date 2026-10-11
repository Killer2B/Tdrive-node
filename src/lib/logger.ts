/** مُسجِّل منظّم (pino) مع مستويات، pretty في التطوير إن توفّر pino-pretty. */
import { createRequire } from 'node:module';
import pino, { type Logger } from 'pino';
import { loadConfig } from '../config/env.ts';

const require = createRequire(import.meta.url);

let logger: Logger | null = null;

function prettyAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

export function getLogger(): Logger {
  if (logger) return logger;
  const cfg = loadConfig();
  const options: pino.LoggerOptions = {
    level: cfg.logLevel,
    base: { service: 'tdrive' },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password', 'secret', '*.secret'],
      censor: '[محجوب]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (!cfg.isProd && prettyAvailable()) {
    logger = pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' },
      },
    });
  } else {
    logger = pino(options);
  }
  return logger;
}
