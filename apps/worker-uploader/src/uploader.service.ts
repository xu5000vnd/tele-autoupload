import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MediaStatus } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { appConfig } from '@shared/config/env';
import { UploaderFactoryService } from '@shared/drive/uploader-factory.service';
import { PrismaService } from '@shared/db/prisma.service';
import { QueueService } from '@shared/queue/queue.service';
import { JobEventLogService } from '@shared/services/job-event-log.service';
import { TelegramNotifierService } from '@shared/services/telegram-notifier.service';
import { UploadJobPayload } from '@shared/types/jobs';
import { logger } from '@shared/utils/logger';
import { FolderResolverService } from './folder-resolver.service';

@Injectable()
export class UploaderService implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<UploadJobPayload>;
  private readonly pendingNotifications = new Map<string, {
    tuName: string;
    chatId: string;
    success: number;
    failed: number;
    errors: Map<string, number>;
  }>();

  constructor(
    private readonly queueService: QueueService,
    private readonly prisma: PrismaService,
    private readonly eventLogService: JobEventLogService,
    private readonly uploaderFactory: UploaderFactoryService,
    private readonly folderResolverService: FolderResolverService,
    private readonly telegramNotifier: TelegramNotifierService,
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
    const userTu = item.senderId
      ? await this.prisma.userTu.findFirst({
          where: {
            telegramUserId: item.senderId,
            telegramChatId: item.chatId,
          },
          select: { path: true, tuName: true },
        })
      : null;

    if (appConfig.uploadStrategy === 'drive_desktop') {
      if (!userTu?.path) {
        throw new Error(`Missing user_tu.path for media item ${item.id}`);
      }

      const expectedBasePath = path.join(
        appConfig.drive.syncFolder ?? '',
        userTu.path.replace(/^[/\\]+/, ''),
      );
      try {
        await fs.access(expectedBasePath, fsConstants.F_OK);
      } catch {
        throw new Error(`Path folder not found: ${expectedBasePath}`);
      }
    }

    const destination = await strategy.ensureDestination({
      chatId: item.chatId,
      chatTitle,
      date: item.date,
      userPath: userTu?.path ?? null,
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

    this.recordUploadSuccess({
      tuName: userTu?.tuName ?? 'unknown',
      chatId: item.chatId.toString(),
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
    const failedItem = await this.prisma.mediaItem.update({
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

    const failedUser = failedItem.senderId
      ? await this.prisma.userTu.findFirst({
          where: {
            telegramUserId: failedItem.senderId,
            telegramChatId: failedItem.chatId,
          },
          select: { tuName: true },
        })
      : null;

    this.recordUploadFailure({
      tuName: failedUser?.tuName ?? 'unknown',
      chatId: failedItem.chatId.toString(),
      error: error.message,
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async flushUploadNotifications(): Promise<void> {
    if (!this.pendingNotifications.size) {
      return;
    }

    const lines: string[] = [];
    for (const bucket of this.pendingNotifications.values()) {
      const topErrors = [...bucket.errors.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([msg, count]) => `${count}x ${msg}`);

      const errPart = topErrors.length ? `, errors: ${topErrors.join(' | ')}` : '';
      lines.push(
        `• ${bucket.tuName} (chat ${bucket.chatId}) -> ✅ ${bucket.success}, ❌ ${bucket.failed}${errPart}`,
      );
    }

    this.pendingNotifications.clear();
    await this.telegramNotifier.notify(`📊 Upload summary (last 1 minute)\n${lines.join('\n')}`);
  }

  private recordUploadSuccess(input: { tuName: string; chatId: string }): void {
    const key = `${input.tuName}_${input.chatId}`;
    const bucket = this.pendingNotifications.get(key) ?? {
      tuName: input.tuName,
      chatId: input.chatId,
      success: 0,
      failed: 0,
      errors: new Map<string, number>(),
    };
    bucket.success += 1;
    this.pendingNotifications.set(key, bucket);
  }

  private recordUploadFailure(input: { tuName: string; chatId: string; error: string }): void {
    const key = `${input.tuName}_${input.chatId}`;
    const bucket = this.pendingNotifications.get(key) ?? {
      tuName: input.tuName,
      chatId: input.chatId,
      success: 0,
      failed: 0,
      errors: new Map<string, number>(),
    };
    bucket.failed += 1;
    const normalizedError = input.error.replace(/\s+/g, ' ').slice(0, 120);
    bucket.errors.set(normalizedError, (bucket.errors.get(normalizedError) ?? 0) + 1);
    this.pendingNotifications.set(key, bucket);
  }
}
