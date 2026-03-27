import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

function parseUsernameWhitelist(raw: string): string[] {
  return raw
    .split(/[,\n;]+/)
    .map((v) => v.trim().toLowerCase())
    .map((v) => v.replace(/^@+/, ''))
    .filter(Boolean);
}

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  TG_API_ID: z.coerce.number().int().positive(),
  TG_API_HASH: z.string().min(1),
  TG_SESSION_STRING: z.string().min(1),
  TG_NUMBER: z.string().min(1),
  REDIS_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  STAGING_DIR: z.string().min(1),
  UPLOAD_STRATEGY: z.enum(['drive_api', 'drive_desktop', 'playwright']),
  UPLOAD_CONCURRENCY: z.coerce.number().int().positive().default(6),
  UPLOAD_RATE_LIMIT_PER_SEC: z.coerce.number().int().positive().default(10),
  UPLOAD_MAX_RETRIES: z.coerce.number().int().min(0).default(8),
  UPLOAD_INITIAL_BACKOFF_MS: z.coerce.number().int().positive().default(10000),
  MAX_STAGING_SIZE_GB: z.coerce.number().positive().default(50),
  HIGH_WATERMARK_PCT: z.coerce.number().min(1).max(99).default(80),
  CLEANUP_AFTER_HOURS: z.coerce.number().positive().default(2),
  RECONCILIATION_INTERVAL_MIN: z.coerce.number().int().positive().default(10),
  STATS_API_PORT: z.coerce.number().int().positive().default(3100),
  STATS_API_AUTH_TOKEN: z.string().default(''),
  STATS_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  BOT_TOKEN: z.string().optional(),
  BOT_REPORT_CHAT_ID: z.string().optional(),
  UNREGISTERED_UPLOADER_USERNAME_WHITELIST: z.string().default(''),
  DRIVE_ROOT_FOLDER_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  DRIVE_SYNC_FOLDER: z.string().optional(),
  UPLOAD_DATE_BUCKET_ENABLED: z.string().default('true').transform((value, ctx) => {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'UPLOAD_DATE_BUCKET_ENABLED must be one of: true/false/1/0/yes/no/on/off',
    });
    return z.NEVER;
  }),
  UPLOAD_DATE_BUCKET_DAYS: z.coerce.number().int().min(2).max(31).default(10),
  PLAYWRIGHT_PROFILE_DIR: z.string().optional(),
});

export type AppConfig = ReturnType<typeof parseEnv>;

export function parseEnv(): {
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  telegram: {
    apiId: number;
    apiHash: string;
    session: string;
    phoneNumber: string;
  };
  redisUrl: string;
  databaseUrl: string;
  stagingDir: string;
  uploadStrategy: 'drive_api' | 'drive_desktop' | 'playwright';
  uploadConcurrency: number;
  uploadRateLimitPerSec: number;
  uploadMaxRetries: number;
  uploadInitialBackoffMs: number;
  maxStagingSizeGb: number;
  highWatermarkPct: number;
  cleanupAfterHours: number;
  reconciliationIntervalMin: number;
  statsApiPort: number;
  statsApiAuthToken: string;
  statsRetentionDays: number;
  botToken?: string;
  botReportChatId?: string;
  unregisteredUploaderUsernameWhitelist: string[];
  drive: {
    rootFolderId?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    syncFolder?: string;
    dateBucketEnabled: boolean;
    dateBucketDays: number;
    playwrightProfileDir?: string;
  };
} {
  const env = baseSchema.parse(process.env);

  if (env.UPLOAD_STRATEGY === 'drive_api') {
    if (!env.DRIVE_ROOT_FOLDER_ID || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
      throw new Error('drive_api strategy requires DRIVE_ROOT_FOLDER_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN');
    }
  }

  if (env.UPLOAD_STRATEGY === 'drive_desktop' && !env.DRIVE_SYNC_FOLDER) {
    throw new Error('drive_desktop strategy requires DRIVE_SYNC_FOLDER');
  }

  if (env.UPLOAD_STRATEGY === 'playwright' && !env.PLAYWRIGHT_PROFILE_DIR) {
    throw new Error('playwright strategy requires PLAYWRIGHT_PROFILE_DIR');
  }

  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    telegram: {
      apiId: env.TG_API_ID,
      apiHash: env.TG_API_HASH,
      session: env.TG_SESSION_STRING,
      phoneNumber: env.TG_NUMBER,
    },
    redisUrl: env.REDIS_URL,
    databaseUrl: env.DATABASE_URL,
    stagingDir: env.STAGING_DIR,
    uploadStrategy: env.UPLOAD_STRATEGY,
    uploadConcurrency: env.UPLOAD_CONCURRENCY,
    uploadRateLimitPerSec: env.UPLOAD_RATE_LIMIT_PER_SEC,
    uploadMaxRetries: env.UPLOAD_MAX_RETRIES,
    uploadInitialBackoffMs: env.UPLOAD_INITIAL_BACKOFF_MS,
    maxStagingSizeGb: env.MAX_STAGING_SIZE_GB,
    highWatermarkPct: env.HIGH_WATERMARK_PCT,
    cleanupAfterHours: env.CLEANUP_AFTER_HOURS,
    reconciliationIntervalMin: env.RECONCILIATION_INTERVAL_MIN,
    statsApiPort: env.STATS_API_PORT,
    statsApiAuthToken: env.STATS_API_AUTH_TOKEN,
    statsRetentionDays: env.STATS_RETENTION_DAYS,
    botToken: env.BOT_TOKEN,
    botReportChatId: env.BOT_REPORT_CHAT_ID,
    unregisteredUploaderUsernameWhitelist: parseUsernameWhitelist(env.UNREGISTERED_UPLOADER_USERNAME_WHITELIST),
    drive: {
      rootFolderId: env.DRIVE_ROOT_FOLDER_ID,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_REFRESH_TOKEN,
      syncFolder: env.DRIVE_SYNC_FOLDER,
      dateBucketEnabled: env.UPLOAD_DATE_BUCKET_ENABLED,
      dateBucketDays: env.UPLOAD_DATE_BUCKET_DAYS,
      playwrightProfileDir: env.PLAYWRIGHT_PROFILE_DIR,
    },
  };
}

export const appConfig = parseEnv();
