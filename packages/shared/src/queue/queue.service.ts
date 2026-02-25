import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { appConfig } from '@shared/config/env';
import { UPLOAD_QUEUE_NAME } from '@shared/constants/queues';
import { UploadJobPayload } from '@shared/types/jobs';

@Injectable()
export class QueueService implements OnModuleDestroy {
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

  async enqueueUpload(payload: UploadJobPayload): Promise<Job<UploadJobPayload>> {
    return this.uploadQueue.add(`up:${payload.mediaItemId}`, payload, {
      priority: payload.mediaType === 'photo' ? 0 : 5,
      deduplication: { id: payload.mediaItemId },
    });
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

  async onModuleDestroy(): Promise<void> {
    await this.uploadQueue.close();
    await this.uploadQueueEvents.close();
    await this.redis.quit();
  }
}
