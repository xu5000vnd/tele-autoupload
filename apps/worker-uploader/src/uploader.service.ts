import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MediaStatus } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { appConfig } from '@shared/config/env';
import { UploaderFactoryService } from '@shared/drive/uploader-factory.service';
import { PrismaService } from '@shared/db/prisma.service';
import { QueueService } from '@shared/queue/queue.service';
import { JobEventLogService } from '@shared/services/job-event-log.service';
import { UploadJobPayload } from '@shared/types/jobs';
import { logger } from '@shared/utils/logger';
import { FolderResolverService } from './folder-resolver.service';

@Injectable()
export class UploaderService implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<UploadJobPayload>;

  constructor(
    private readonly queueService: QueueService,
    private readonly prisma: PrismaService,
    private readonly eventLogService: JobEventLogService,
    private readonly uploaderFactory: UploaderFactoryService,
    private readonly folderResolverService: FolderResolverService,
  ) {}

  onModuleInit(): void {
    this.worker = this.queueService.createUploadWorker(async (job) => this.processJob(job));
    this.worker.on('failed', async (job, error) => {
      if (!job) return;
      await this.failJob(job.data.mediaItemId, error);
    });
    logger.info('uploader worker started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private async processJob(job: Job<UploadJobPayload>): Promise<void> {
    const item = await this.prisma.mediaItem.findUnique({ where: { id: job.data.mediaItemId } });
    if (!item) {
      return;
    }

    if (item.status === MediaStatus.uploaded && item.driveFileId) {
      return;
    }

    await this.prisma.mediaItem.update({
      where: { id: item.id },
      data: { status: MediaStatus.uploading },
    });

    await this.eventLogService.log(item.id, 'upload_start', { attempt: job.attemptsMade + 1 });

    const strategy = this.uploaderFactory.getStrategy();
    const group = await this.prisma.groupState.findUnique({ where: { chatId: item.chatId } });
    const chatTitle = group?.title ?? item.chatId.toString();

    const destination = await strategy.ensureDestination({
      chatId: item.chatId,
      chatTitle,
      date: item.date,
    });

    await this.folderResolverService.rememberDateFolder(item.chatId, item.date, destination.folderId);

    const fileName = path.basename(item.localPath ?? job.data.localPath);
    const result = await strategy.upload(item.localPath ?? job.data.localPath, destination, {
      fileName,
      mimeType: item.mimeType ?? undefined,
    });

    await this.prisma.mediaItem.update({
      where: { id: item.id },
      data: {
        status: MediaStatus.uploaded,
        driveFileId: result.remoteRef,
        driveWebUrl: result.webUrl,
      },
    });

    await this.eventLogService.log(item.id, 'upload_done', {
      remoteRef: result.remoteRef,
      bytesUploaded: result.bytesUploaded.toString(),
    });

    if (item.localPath) {
      await fs.rm(item.localPath, { force: true });
    }
  }

  @Cron('0 */15 * * * *')
  async cleanupUploadedFiles(): Promise<void> {
    const threshold = new Date(Date.now() - appConfig.cleanupAfterHours * 3600_000);

    const items = await this.prisma.mediaItem.findMany({
      where: {
        status: MediaStatus.uploaded,
        localPath: { not: null },
        updatedAt: { lt: threshold },
      },
      select: { id: true, localPath: true },
      take: 1000,
    });

    for (const item of items) {
      if (item.localPath) {
        await fs.rm(item.localPath, { force: true });
      }
      await this.prisma.mediaItem.update({
        where: { id: item.id },
        data: { localPath: null },
      });
    }
  }

  private async failJob(mediaItemId: string, error: Error): Promise<void> {
    await this.prisma.mediaItem.update({
      where: { id: mediaItemId },
      data: {
        status: MediaStatus.failed,
        error: error.message,
        failedAt: new Date(),
        retryCount: { increment: 1 },
        lastRetryAt: new Date(),
      },
    });

    await this.eventLogService.log(mediaItemId, 'failed', { error: error.message });
  }
}
