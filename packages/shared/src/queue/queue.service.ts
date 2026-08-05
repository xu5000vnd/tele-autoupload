import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { appConfig } from '@shared/config/env';
import { DOWNLOAD_QUEUE_NAME, UPLOAD_QUEUE_NAME } from '@shared/constants/queues';
import { DownloadJobPayload, UploadJobPayload } from '@shared/types/jobs';

export type RedisLease = {
  key: string;
  token: string;
  ttlMs: number;
};

export type TelegramRequestPermit = {
  token: string;
  ttlMs: number;
};

export interface TelegramRequestCoordinator {
  acquireTelegramRequestPermit(deadlineAt?: number): Promise<TelegramRequestPermit>;
  renewTelegramRequestPermit(permit: TelegramRequestPermit): Promise<boolean>;
  releaseTelegramRequestPermit(permit: TelegramRequestPermit): Promise<void>;
  deferTelegramRequests(delayMs: number): Promise<void>;
}

const RENEW_LEASE_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
  end
  return 0
`;

const RELEASE_LEASE_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

const TELEGRAM_FLOOD_UNTIL_KEY = 'tele-autoupload:telegram:flood-until';
const TELEGRAM_NEXT_REQUEST_AT_KEY = 'tele-autoupload:telegram:next-request-at';
const TELEGRAM_REQUEST_SLOTS_KEY = 'tele-autoupload:telegram:request-slots';

const ACQUIRE_TELEGRAM_REQUEST_SCRIPT = `
  local redisTime = redis.call('TIME')
  local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
  local requestIntervalMs = tonumber(ARGV[1])
  local maxConcurrency = tonumber(ARGV[2])
  local token = ARGV[3]
  local slotTtlMs = tonumber(ARGV[4])
  local floodUntil = tonumber(redis.call('GET', KEYS[1]) or '0')

  if floodUntil > now then
    return {0, floodUntil - now}
  end

  redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now)
  if redis.call('ZCARD', KEYS[3]) >= maxConcurrency then
    return {0, 25}
  end

  local nextRequestAt = tonumber(redis.call('GET', KEYS[2]) or '0')
  if nextRequestAt > now then
    return {0, nextRequestAt - now}
  end

  redis.call('ZADD', KEYS[3], now + slotTtlMs, token)
  redis.call('PEXPIRE', KEYS[3], slotTtlMs)
  redis.call('SET', KEYS[2], now + requestIntervalMs, 'PX', math.max(slotTtlMs, requestIntervalMs * 2))
  return {1, 0}
`;

const RENEW_TELEGRAM_REQUEST_SCRIPT = `
  local redisTime = redis.call('TIME')
  local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
  local token = ARGV[1]
  local slotTtlMs = tonumber(ARGV[2])
  if not redis.call('ZSCORE', KEYS[1], token) then
    return 0
  end
  redis.call('ZADD', KEYS[1], now + slotTtlMs, token)
  redis.call('PEXPIRE', KEYS[1], slotTtlMs)
  return 1
`;

const DEFER_TELEGRAM_REQUESTS_SCRIPT = `
  local redisTime = redis.call('TIME')
  local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
  local delayMs = tonumber(ARGV[1])
  local requestedUntil = now + delayMs
  local currentUntil = tonumber(redis.call('GET', KEYS[1]) or '0')
  if requestedUntil > currentUntil then
    redis.call('SET', KEYS[1], requestedUntil, 'PX', delayMs + 60000)
  end
  return math.max(requestedUntil, currentUntil)
`;

@Injectable()
export class QueueService implements OnModuleDestroy, TelegramRequestCoordinator {
  private readonly redis = new Redis(appConfig.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  readonly uploadQueue = new Queue<UploadJobPayload>(UPLOAD_QUEUE_NAME, {
    connection: this.redis,
    defaultJobOptions: {
      attempts: appConfig.uploadMaxRetries,
      backoff: { type: 'exponential', delay: appConfig.uploadInitialBackoffMs },
      removeOnComplete: 5000,
      removeOnFail: 5000,
    },
  });

  readonly uploadQueueEvents = new QueueEvents(UPLOAD_QUEUE_NAME, { connection: this.redis });

  readonly downloadQueue = new Queue<DownloadJobPayload>(DOWNLOAD_QUEUE_NAME, {
    connection: this.redis,
    defaultJobOptions: {
      attempts: appConfig.downloadMaxRetries,
      backoff: { type: 'exponential', delay: appConfig.downloadInitialBackoffMs },
      removeOnComplete: 5000,
      removeOnFail: 5000,
    },
  });

  readonly downloadQueueEvents = new QueueEvents(DOWNLOAD_QUEUE_NAME, { connection: this.redis });

  async enqueueUpload(payload: UploadJobPayload): Promise<Job<UploadJobPayload>> {
    return this.uploadQueue.add(`up:${payload.mediaItemId}`, payload, {
      priority: payload.mediaType === 'photo' ? 0 : 5,
      deduplication: { id: payload.mediaItemId },
    });
  }

  async enqueueDownload(payload: DownloadJobPayload): Promise<Job<DownloadJobPayload>> {
    return this.downloadQueue.add(`down:${payload.mediaItemId}`, payload, {
      deduplication: { id: payload.mediaItemId },
    });
  }

  async acquireLease(key: string, ttlMs: number): Promise<RedisLease | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? { key, token, ttlMs } : null;
  }

  async renewLease(lease: RedisLease): Promise<boolean> {
    const result = await this.redis.eval(
      RENEW_LEASE_SCRIPT,
      1,
      lease.key,
      lease.token,
      lease.ttlMs.toString(),
    );
    return Number(result) === 1;
  }

  async releaseLease(lease: RedisLease): Promise<void> {
    await this.redis.eval(RELEASE_LEASE_SCRIPT, 1, lease.key, lease.token);
  }

  async acquireTelegramRequestPermit(deadlineAt?: number): Promise<TelegramRequestPermit> {
    const token = randomUUID();
    const requestIntervalMs = Math.ceil(1000 / appConfig.reconciliation.telegramRequestsPerSec);
    const maxConcurrency = appConfig.reconciliation.chatConcurrency;
    const slotTtlMs = appConfig.reconciliation.requestSlotTtlMs;

    while (true) {
      if (deadlineAt && Date.now() >= deadlineAt) {
        throw new Error('Telegram request deadline exceeded before a shared permit was acquired');
      }
      const result = await this.redis.eval(
        ACQUIRE_TELEGRAM_REQUEST_SCRIPT,
        3,
        TELEGRAM_FLOOD_UNTIL_KEY,
        TELEGRAM_NEXT_REQUEST_AT_KEY,
        TELEGRAM_REQUEST_SLOTS_KEY,
        requestIntervalMs.toString(),
        maxConcurrency.toString(),
        token,
        slotTtlMs.toString(),
      ) as [number | string, number | string];
      if (Number(result[0]) === 1) {
        return { token, ttlMs: slotTtlMs };
      }

      const requestedWaitMs = Math.min(Math.max(Number(result[1]) || 25, 25), 1000);
      const waitMs = deadlineAt
        ? Math.min(requestedWaitMs, Math.max(deadlineAt - Date.now(), 0))
        : requestedWaitMs;
      if (waitMs <= 0) {
        throw new Error('Telegram request deadline exceeded while waiting for a shared permit');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }

  async renewTelegramRequestPermit(permit: TelegramRequestPermit): Promise<boolean> {
    const result = await this.redis.eval(
      RENEW_TELEGRAM_REQUEST_SCRIPT,
      1,
      TELEGRAM_REQUEST_SLOTS_KEY,
      permit.token,
      permit.ttlMs.toString(),
    );
    return Number(result) === 1;
  }

  async releaseTelegramRequestPermit(permit: TelegramRequestPermit): Promise<void> {
    await this.redis.zrem(TELEGRAM_REQUEST_SLOTS_KEY, permit.token);
  }

  async deferTelegramRequests(delayMs: number): Promise<void> {
    await this.redis.eval(
      DEFER_TELEGRAM_REQUESTS_SCRIPT,
      1,
      TELEGRAM_FLOOD_UNTIL_KEY,
      Math.max(delayMs, 0).toString(),
    );
  }

  createUploadWorker(
    processor: (job: Job<UploadJobPayload>) => Promise<void>,
  ): Worker<UploadJobPayload> {
    return new Worker(UPLOAD_QUEUE_NAME, processor, {
      connection: this.redis,
      concurrency: appConfig.uploadConcurrency,
      limiter: { max: appConfig.uploadRateLimitPerSec, duration: 1000 },
    });
  }

  createDownloadWorker(
    processor: (job: Job<DownloadJobPayload>) => Promise<void>,
  ): Worker<DownloadJobPayload> {
    return new Worker(DOWNLOAD_QUEUE_NAME, processor, {
      connection: this.redis,
      concurrency: appConfig.downloadConcurrency,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.uploadQueue.close();
    await this.uploadQueueEvents.close();
    await this.downloadQueue.close();
    await this.downloadQueueEvents.close();
    await this.redis.quit();
  }
}
