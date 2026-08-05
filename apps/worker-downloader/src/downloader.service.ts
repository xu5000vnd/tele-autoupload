import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueService } from '@shared/queue/queue.service';
import { MediaService } from '@shared/services/media.service';
import { TelegramGateway, TelegramReconciliationContext } from '@shared/telegram/telegram-gateway';
import { DownloadJobPayload } from '@shared/types/jobs';
import { logger } from '@shared/utils/logger';

@Injectable()
export class DownloaderService implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<DownloadJobPayload>;
  private context?: TelegramReconciliationContext;

  constructor(
    private readonly queueService: QueueService,
    private readonly mediaService: MediaService,
    private readonly telegramGateway: TelegramGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.telegramGateway.connect({ withUpdates: false });
    this.context = this.telegramGateway.createReconciliationContext();
    this.worker = this.queueService.createDownloadWorker(async (job) => this.processJob(job));
    this.worker.on('failed', (job, error) => {
      if (!job) return;
      logger.error(
        {
          err: error,
          mediaItemId: job.data.mediaItemId,
          attemptsMade: job.attemptsMade,
        },
        'download job attempt failed',
      );
    });
    logger.info('downloader worker started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
    await this.telegramGateway.disconnect();
  }

  private async processJob(job: Job<DownloadJobPayload>): Promise<void> {
    if (!this.context) {
      throw new Error('downloader telegram context is not initialized');
    }
    await this.mediaService.downloadMediaItem(job.data.mediaItemId, this.context);
  }
}
