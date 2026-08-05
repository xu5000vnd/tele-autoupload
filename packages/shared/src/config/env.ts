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
  LOG_DIR: z.string().default('logs'),
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  TG_API_ID: z.coerce.number().int().positive(),
  TG_API_HASH: z.string().min(1),
  TG_SESSION_STRING: z.string().min(1),
  TG_NUMBER: z.string().min(1),
  TG_USE_WSS: z.string().default('true').transform((value, ctx) => {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'TG_USE_WSS must be one of: true/false/1/0/yes/no/on/off',
    });
    return z.NEVER;
  }),
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
  RECONCILIATION_LEASE_TTL_MS: z.coerce.number().int().positive().default(540_000),
  RECONCILIATION_LEASE_RENEWAL_MS: z.coerce.number().int().positive().default(30_000),
  RECONCILIATION_RUN_BUDGET_MS: z.coerce.number().int().positive().default(480_000),
  RECONCILIATION_STALE_BUDGET_MS: z.coerce.number().int().nonnegative().default(60_000),
  RECONCILIATION_MAX_CHATS_PER_RUN: z.coerce.number().int().positive().default(500),
  RECONCILIATION_MAX_PAGES_PER_CHAT: z.coerce.number().int().positive().default(3),
  // GramJS retrieves history in 100-message chunks. Keeping this at one chunk
  // makes each page one rate-gated Telegram operation.
  RECONCILIATION_HISTORY_PAGE_SIZE: z.coerce.number().int().positive().max(100).default(100),
  RECONCILIATION_NORMAL_LOOKBACK_MESSAGES: z.coerce.number().int().nonnegative().default(50),
  RECONCILIATION_RECOVERY_LOOKBACK_MESSAGES: z.coerce.number().int().nonnegative().default(200),
  RECONCILIATION_CHAT_CONCURRENCY: z.coerce.number().int().min(1).max(3).default(3),
  RECONCILIATION_TELEGRAM_REQUESTS_PER_SEC: z.coerce.number().int().positive().default(5),
  TELEGRAM_REQUEST_SLOT_TTL_MS: z.coerce.number().int().min(1_000).default(120_000),
  DOWNLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(3).default(3),
  DOWNLOAD_MAX_RETRIES: z.coerce.number().int().min(0).default(8),
  DOWNLOAD_INITIAL_BACKOFF_MS: z.coerce.number().int().positive().default(10000),
  DOWNLOAD_HEARTBEAT_MS: z.coerce.number().int().min(1_000).default(60_000),
  STATS_API_PORT: z.coerce.number().int().positive().default(3100),
  STATS_API_AUTH_TOKEN: z.string().default(''),
  ADMIN_WEB_USERNAME: z.string().default(''),
  ADMIN_WEB_PASSWORD: z.string().default(''),
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
  logDir: string;
  logRetentionDays: number;
  telegram: {
    apiId: number;
    apiHash: string;
    session: string;
    phoneNumber: string;
    useWss: boolean;
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
  reconciliation: {
    leaseTtlMs: number;
    leaseRenewalMs: number;
    runBudgetMs: number;
    staleBudgetMs: number;
    maxChatsPerRun: number;
    maxPagesPerChat: number;
    historyPageSize: number;
    normalLookbackMessages: bigint;
    recoveryLookbackMessages: bigint;
    chatConcurrency: number;
    telegramRequestsPerSec: number;
    requestSlotTtlMs: number;
  };
  downloadConcurrency: number;
  downloadMaxRetries: number;
  downloadInitialBackoffMs: number;
  downloadHeartbeatMs: number;
  statsApiPort: number;
  statsApiAuthToken: string;
  adminWebUsername: string;
  adminWebPassword: string;
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

  if (env.RECONCILIATION_LEASE_RENEWAL_MS >= env.RECONCILIATION_LEASE_TTL_MS) {
    throw new Error('RECONCILIATION_LEASE_RENEWAL_MS must be less than RECONCILIATION_LEASE_TTL_MS');
  }
  if (env.RECONCILIATION_RUN_BUDGET_MS >= env.RECONCILIATION_LEASE_TTL_MS) {
    throw new Error('RECONCILIATION_RUN_BUDGET_MS must be less than RECONCILIATION_LEASE_TTL_MS');
  }
  if (env.RECONCILIATION_RUN_BUDGET_MS >= env.RECONCILIATION_INTERVAL_MIN * 60_000) {
    throw new Error('RECONCILIATION_RUN_BUDGET_MS must be less than the reconciliation interval');
  }
  if (env.RECONCILIATION_STALE_BUDGET_MS >= env.RECONCILIATION_RUN_BUDGET_MS) {
    throw new Error('RECONCILIATION_STALE_BUDGET_MS must be less than RECONCILIATION_RUN_BUDGET_MS');
  }
  if (env.RECONCILIATION_NORMAL_LOOKBACK_MESSAGES > env.RECONCILIATION_RECOVERY_LOOKBACK_MESSAGES) {
    throw new Error('RECONCILIATION_NORMAL_LOOKBACK_MESSAGES must not exceed RECONCILIATION_RECOVERY_LOOKBACK_MESSAGES');
  }

  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    logDir: env.LOG_DIR,
    logRetentionDays: env.LOG_RETENTION_DAYS,
    telegram: {
      apiId: env.TG_API_ID,
      apiHash: env.TG_API_HASH,
      session: env.TG_SESSION_STRING,
      phoneNumber: env.TG_NUMBER,
      useWss: env.TG_USE_WSS,
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
    reconciliation: {
      leaseTtlMs: env.RECONCILIATION_LEASE_TTL_MS,
      leaseRenewalMs: env.RECONCILIATION_LEASE_RENEWAL_MS,
      runBudgetMs: env.RECONCILIATION_RUN_BUDGET_MS,
      staleBudgetMs: env.RECONCILIATION_STALE_BUDGET_MS,
      maxChatsPerRun: env.RECONCILIATION_MAX_CHATS_PER_RUN,
      maxPagesPerChat: env.RECONCILIATION_MAX_PAGES_PER_CHAT,
      historyPageSize: env.RECONCILIATION_HISTORY_PAGE_SIZE,
      normalLookbackMessages: BigInt(env.RECONCILIATION_NORMAL_LOOKBACK_MESSAGES),
      recoveryLookbackMessages: BigInt(env.RECONCILIATION_RECOVERY_LOOKBACK_MESSAGES),
      chatConcurrency: env.RECONCILIATION_CHAT_CONCURRENCY,
      telegramRequestsPerSec: env.RECONCILIATION_TELEGRAM_REQUESTS_PER_SEC,
      requestSlotTtlMs: env.TELEGRAM_REQUEST_SLOT_TTL_MS,
    },
    downloadConcurrency: env.DOWNLOAD_CONCURRENCY,
    downloadMaxRetries: env.DOWNLOAD_MAX_RETRIES,
    downloadInitialBackoffMs: env.DOWNLOAD_INITIAL_BACKOFF_MS,
    downloadHeartbeatMs: env.DOWNLOAD_HEARTBEAT_MS,
    statsApiPort: env.STATS_API_PORT,
    statsApiAuthToken: env.STATS_API_AUTH_TOKEN,
    adminWebUsername: env.ADMIN_WEB_USERNAME,
    adminWebPassword: env.ADMIN_WEB_PASSWORD,
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
