import pino from 'pino';
import { appConfig } from '@shared/config/env';

export const logger = pino({
  level: appConfig.logLevel,
  transport:
    appConfig.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
      : undefined,
});
