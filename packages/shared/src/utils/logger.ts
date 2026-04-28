import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { appConfig } from '@shared/config/env';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface AppLogger {
  debug(arg1?: unknown, arg2?: string): void;
  info(arg1?: unknown, arg2?: string): void;
  warn(arg1?: unknown, arg2?: string): void;
  error(arg1?: unknown, arg2?: string): void;
}

const logDir = path.resolve(appConfig.logDir);
fs.mkdirSync(logDir, { recursive: true });

const baseLogger = winston.createLogger({
  level: appConfig.logLevel,
  defaultMeta: {
    service: 'tele-autoupload',
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf((info) => {
          const renderedMeta = info.meta && Object.keys(info.meta).length
            ? ` ${JSON.stringify(info.meta)}`
            : '';
          return `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}${renderedMeta}`;
        }),
      ),
    }),
    new DailyRotateFile({
      dirname: logDir,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: `${appConfig.logRetentionDays}d`,
      level: appConfig.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    }),
    new DailyRotateFile({
      dirname: logDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: `${appConfig.logRetentionDays}d`,
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    }),
  ],
});

function write(level: LogLevel, arg1?: unknown, arg2?: string): void {
  const { message, meta } = normalizeArgs(arg1, arg2);
  baseLogger.log({
    level,
    message,
    meta,
  });
}

function normalizeArgs(arg1?: unknown, arg2?: string): { message: string; meta?: Record<string, unknown> } {
  if (typeof arg1 === 'string') {
    return {
      message: arg1,
      meta: arg2 ? { detail: arg2 } : undefined,
    };
  }

  if (arg1 && typeof arg1 === 'object') {
    return {
      message: arg2 ?? '',
      meta: serializeRecord(arg1),
    };
  }

  if (arg1 === undefined || arg1 === null) {
    return {
      message: arg2 ?? '',
    };
  }

  return {
    message: String(arg1),
    meta: arg2 ? { detail: arg2 } : undefined,
  };
}

function serializeRecord(input: unknown): Record<string, unknown> {
  const serialized = serializeValue(input);
  if (serialized && typeof serialized === 'object' && !Array.isArray(serialized)) {
    return serialized as Record<string, unknown>;
  }
  return { value: serialized };
}

function serializeValue(input: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof input === 'bigint') {
    return input.toString();
  }

  if (input instanceof Error) {
    return {
      name: input.name,
      message: input.message,
      stack: input.stack,
    };
  }

  if (Array.isArray(input)) {
    return input.map((item) => serializeValue(item, seen));
  }

  if (input && typeof input === 'object') {
    if (seen.has(input)) {
      return '[Circular]';
    }
    seen.add(input);

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      result[key] = serializeValue(value, seen);
    }
    seen.delete(input);
    return result;
  }

  return input;
}

export const logger: AppLogger = {
  debug(arg1?: unknown, arg2?: string): void {
    write('debug', arg1, arg2);
  },
  info(arg1?: unknown, arg2?: string): void {
    write('info', arg1, arg2);
  },
  warn(arg1?: unknown, arg2?: string): void {
    write('warn', arg1, arg2);
  },
  error(arg1?: unknown, arg2?: string): void {
    write('error', arg1, arg2);
  },
};
