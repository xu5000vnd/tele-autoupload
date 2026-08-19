import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ChatType, MediaItem, MediaStatus, MediaType } from '@prisma/client';
import { appConfig } from '@shared/config/env';
import { PrismaService } from '@shared/db/prisma.service';
import { QueueService } from '@shared/queue/queue.service';
import { JobEventLogService } from '@shared/services/job-event-log.service';
import { TelegramGateway, TelegramMediaDownloadError, TelegramReconciliationContext } from '@shared/telegram/telegram-gateway';
import { IncomingMedia, IncomingMessage } from '@shared/types/telegram';
import { makeDeterministicFileName } from '@shared/utils/file-naming';
import { hashFileSha256 } from '@shared/utils/hash';
import { logger } from '@shared/utils/logger';

export interface ResolvedUploaderContext {
  userTuId: number;
  tuId: string;
  tuName: string;
}

export type ProcessIncomingMessageOptions = {
  manageGroupCursor?: boolean;
};

export type StaleRecoveryOptions = {
  olderThanMs?: number;
  deadlineAt?: number;
  maxItems?: number;
  shouldContinue?: () => boolean;
};

export type DownloadAttemptMetadata = {
  attemptsMade: number;
  maxAttempts: number;
};

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly eventLogService: JobEventLogService,
    private readonly telegramGateway: TelegramGateway,
  ) {}

  async processIncomingMessage(
    message: IncomingMessage,
    uploader?: ResolvedUploaderContext,
    options: ProcessIncomingMessageOptions = {},
  ): Promise<void> {
    const manageGroupCursor = options.manageGroupCursor ?? true;
    const existingGroup = await this.prisma.groupState.findUnique({
      where: { chatId: message.chatId },
      select: { lastMessageId: true },
    });
    const nextLastMessageId = existingGroup && existingGroup.lastMessageId > message.messageId
      ? existingGroup.lastMessageId
      : message.messageId;

    const groupState = await this.prisma.groupState.upsert({
      where: { chatId: message.chatId },
      update: {
        title: message.chatTitle,
        chatType: message.chatType as ChatType,
        ...(manageGroupCursor ? { lastMessageId: nextLastMessageId } : {}),
      },
      create: {
        chatId: message.chatId,
        title: message.chatTitle,
        chatType: message.chatType as ChatType,
        lastMessageId: manageGroupCursor ? message.messageId : 0n,
      },
    });

    if (!groupState.isActive || !message.media.length) {
      return;
    }

    for (const media of message.media) {
      const mediaType = media.type as MediaType;
      const uniqueField = media.uniqueId ?? `idx:${media.mediaIndex}`;
      const uniqueWhere = {
        chatId_messageId_mediaIndex: {
          chatId: message.chatId,
          messageId: message.messageId,
          mediaIndex: media.mediaIndex,
        },
      };
      const existedBefore = await this.prisma.mediaItem.findUnique({
        where: uniqueWhere,
        select: { id: true },
      });

      const mediaItem = await this.prisma.mediaItem.upsert({
        where: uniqueWhere,
        update: {
          senderId: message.senderId,
          mimeType: media.mimeType,
          fileName: media.fileName,
          tgFileId: media.fileId,
          tgFileUniqueId: uniqueField,
        },
        create: {
          chatId: message.chatId,
          messageId: message.messageId,
          groupedId: message.groupedId,
          mediaIndex: media.mediaIndex,
          date: message.date,
          senderId: message.senderId,
          mediaType,
          mimeType: media.mimeType,
          tgFileId: media.fileId,
          tgFileUniqueId: uniqueField,
          fileName: media.fileName,
          sizeBytes: media.size,
          status: MediaStatus.queued,
          priority: mediaType === 'photo' ? 0 : 5,
        },
      });

      if (mediaItem.status === MediaStatus.deleted) {
        logger.info(
          this.buildLogContext({
            message,
            media,
            uploader,
            mediaItemId: mediaItem.id,
            tgFileUniqueId: uniqueField,
            mediaStatus: mediaItem.status,
          }),
          'deleted media item skipped by idempotency guard',
        );
        continue;
      }

      await this.eventLogService.log(mediaItem.id, 'queued', {
        chatId: message.chatId.toString(),
        messageId: message.messageId.toString(),
        fileId: media.fileId,
      });

      logger.info(
        this.buildLogContext({
          message,
          media,
          uploader,
          mediaItemId: mediaItem.id,
          tgFileUniqueId: uniqueField,
          mediaStatus: mediaItem.status,
        }),
        'media item queued for processing',
      );

      if (existedBefore && (mediaItem.status === MediaStatus.uploaded || mediaItem.status === MediaStatus.downloaded || mediaItem.status === MediaStatus.uploading)) {
        logger.info(
          this.buildLogContext({
            message,
            media,
            uploader,
            mediaItemId: mediaItem.id,
            tgFileUniqueId: uniqueField,
            mediaStatus: mediaItem.status,
            localPath: mediaItem.localPath ?? undefined,
          }),
          'media item reprocessing skipped by idempotency guard',
        );

        if (mediaItem.status !== MediaStatus.uploaded) {
          const stagedFileExists = mediaItem.localPath ? await this.pathExists(mediaItem.localPath) : false;
          if (this.canResumeUpload(mediaItem, stagedFileExists)) {
            await this.enqueueUploadFromStoredFile(message, media, mediaItem, uploader, 'existing-local-media');
          } else {
            await this.enqueueDownload(message, media, mediaItem, uploader, 'missing-staged-media');
          }
        }
        continue;
      }

      await this.enqueueDownload(message, media, mediaItem, uploader, existedBefore ? 'replayed-media' : 'new-media');
    }
  }

  async recoverStaleMediaItems(input: number | StaleRecoveryOptions = appConfig.reconciliationIntervalMin * 60_000): Promise<number> {
    const options = typeof input === 'number' ? { olderThanMs: input } : input;
    const olderThanMs = options.olderThanMs ?? appConfig.reconciliationIntervalMin * 60_000;
    const cutoff = new Date(Date.now() - olderThanMs);
    const staleItems = await this.prisma.mediaItem.findMany({
      where: {
        status: {
          in: [
            MediaStatus.queued,
            MediaStatus.downloading,
            MediaStatus.downloaded,
            MediaStatus.uploading,
            MediaStatus.failed,
          ],
        },
        OR: [
          { updatedAt: { lt: cutoff } },
          {
            AND: [
              { updatedAt: null },
              { createdAt: { lt: cutoff } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: options.maxItems ?? 50,
    });

    if (!staleItems.length) {
      return 0;
    }

    logger.warn(
      {
        count: staleItems.length,
        cutoffIso: cutoff.toISOString(),
      },
      'found stale media items eligible for recovery',
    );

    let recoveredCount = 0;
    for (const item of staleItems) {
      if (
        (options.deadlineAt && Date.now() >= options.deadlineAt) ||
        (options.shouldContinue && !options.shouldContinue())
      ) {
        break;
      }
      try {
        if (await this.recoverMediaItem(item)) {
          recoveredCount += 1;
        }
      } catch (err) {
        logger.error(
          {
            err,
            mediaItemId: item.id,
            chatId: item.chatId.toString(),
            messageId: item.messageId.toString(),
            mediaStatus: item.status,
          },
          'stale media item recovery failed',
        );
      }
    }

    return recoveredCount;
  }

  private async recoverMediaItem(snapshot: MediaItem): Promise<boolean> {
    // Re-read before mutating so a stale sweep cannot overwrite an item that
    // completed after the initial query.
    const item = await this.prisma.mediaItem.findUnique({ where: { id: snapshot.id } });
    if (!item || !this.isRecoverableStatus(item.status)) {
      return false;
    }
    const uploader = await this.resolveUploaderContext(item.senderId, item.chatId);
    const message = await this.buildMessageFromMediaItem(item);

    if (!message) {
      logger.warn(
        {
          mediaItemId: item.id,
          chatId: item.chatId.toString(),
          messageId: item.messageId.toString(),
          mediaStatus: item.status,
        },
        'stale media item recovery skipped because group metadata is unavailable',
      );
      return false;
    }

    const media = this.buildMediaFromItem(item);
    const fileExists = item.localPath ? await this.pathExists(item.localPath) : false;
    const resumeUpload = this.canResumeUpload(item, fileExists);

    logger.warn(
      {
        recoveryAction: resumeUpload ? 'resume-upload' : 'resume-download',
        recoveryReason: 'stale-item-timeout',
        ...this.buildLogContext({
          message,
          media,
          uploader,
          mediaItemId: item.id,
          tgFileUniqueId: item.tgFileUniqueId ?? `idx:${item.mediaIndex}`,
          mediaStatus: item.status,
          localPath: item.localPath ?? undefined,
          sizeBytes: item.sizeBytes ?? undefined,
        }),
      },
      'recovering stale media item',
    );

    const updatedAt = new Date();
    const updateResult = await this.prisma.mediaItem.updateMany({
      where: {
        id: item.id,
        // Claim against the originally selected stale row. A heartbeat or
        // another worker's transition after the sweep began invalidates it.
        status: snapshot.status,
        updatedAt: snapshot.updatedAt,
      },
      data: {
        status: resumeUpload ? MediaStatus.downloaded : MediaStatus.queued,
        downloadLeaseToken: null,
        error: resumeUpload ? null : 'stale media item queued for download recovery',
        failedAt: null,
        lastRetryAt: updatedAt,
        retryCount: { increment: 1 },
        updatedAt,
      },
    });
    if (updateResult.count !== 1) {
      logger.debug({ mediaItemId: item.id }, 'stale media item changed before recovery claim; skipping');
      return false;
    }

    if (resumeUpload) {
      await this.eventLogService.log(item.id, 'retried', {
        reason: 'stale-upload-recovery',
      });
      await this.enqueueUploadFromStoredFile(message, media, item, uploader, 'stale-upload-recovery');
      return true;
    }

    await this.eventLogService.log(item.id, 'retried', {
      reason: 'stale-download-recovery',
    });
    await this.enqueueDownload(message, media, item, uploader, 'stale-download-recovery');
    return true;
  }

  async downloadMediaItem(
    mediaItemId: string,
    context?: TelegramReconciliationContext,
    attempt?: DownloadAttemptMetadata,
  ): Promise<void> {
    const mediaItem = await this.prisma.mediaItem.findUnique({ where: { id: mediaItemId } });
    if (!mediaItem || mediaItem.status === MediaStatus.uploaded || mediaItem.status === MediaStatus.deleted) {
      return;
    }

    const message = await this.buildMessageFromMediaItem(mediaItem);
    if (!message) {
      throw new Error(`Missing active group metadata for media item ${mediaItem.id}`);
    }
    const uploader = await this.resolveUploaderContext(mediaItem.senderId, mediaItem.chatId);
    const media = this.buildMediaFromItem(mediaItem);
    const stagedFileExists = mediaItem.localPath ? await this.pathExists(mediaItem.localPath) : false;
    if (this.canResumeUpload(mediaItem, stagedFileExists)) {
      await this.enqueueUploadFromStoredFile(message, media, mediaItem, uploader, 'download-job-existing-local-media');
      return;
    }
    if (mediaItem.status === MediaStatus.downloading || mediaItem.status === MediaStatus.uploading) {
      return;
    }
    await this.downloadAndQueueMedia(message, media, mediaItem, uploader, context, attempt);
  }

  private async downloadAndQueueMedia(
    message: IncomingMessage,
    media: IncomingMedia,
    mediaItem: MediaItem,
    uploader?: ResolvedUploaderContext,
    context?: TelegramReconciliationContext,
    attempt?: DownloadAttemptMetadata,
  ): Promise<void> {
    const fileName = makeDeterministicFileName({
      date: mediaItem.date,
      messageId: mediaItem.messageId,
      mediaType: mediaItem.mediaType,
      mediaIndex: mediaItem.mediaIndex,
      fileName: mediaItem.fileName ?? undefined,
      mimeType: mediaItem.mimeType ?? undefined,
    });
    const chatDir = path.join(appConfig.stagingDir, `chat_${message.chatId.toString()}`);
    const localPath = path.join(chatDir, fileName);

    const claimTime = new Date();
    const downloadLeaseToken = randomUUID();
    const claimResult = await this.prisma.mediaItem.updateMany({
      where: {
        id: mediaItem.id,
        status: mediaItem.status,
        updatedAt: mediaItem.updatedAt,
      },
      data: {
        status: MediaStatus.downloading,
        downloadLeaseToken,
        error: null,
        failedAt: null,
        updatedAt: claimTime,
      },
    });
    if (claimResult.count !== 1) {
      logger.debug({ mediaItemId: mediaItem.id }, 'download job skipped because another worker owns the media item');
      return;
    }

    let downloadPersisted = false;
    let telegramDownloadFailed = false;
    let completedAt: Date | undefined;
    const heartbeat = setInterval(() => {
      void this.refreshDownloadHeartbeat(mediaItem.id, downloadLeaseToken);
    }, appConfig.downloadHeartbeatMs);
    try {
      await this.eventLogService.log(mediaItem.id, 'download_start', {});
      await fs.mkdir(chatDir, { recursive: true });

      logger.info(
        this.buildLogContext({
          message,
          media,
          uploader,
          mediaItemId: mediaItem.id,
          tgFileUniqueId: mediaItem.tgFileUniqueId ?? `idx:${mediaItem.mediaIndex}`,
          mediaStatus: MediaStatus.downloading,
          localPath,
        }),
        'media download starting',
      );

      let sizeBytes: bigint;
      try {
        ({ sizeBytes } = await this.telegramGateway.downloadMediaToFile({
          chatId: message.chatId,
          messageId: Number(message.messageId),
          mediaIndex: media.mediaIndex,
          destinationPath: localPath,
        }, context));
      } catch (err) {
        telegramDownloadFailed = err instanceof TelegramMediaDownloadError;
        throw err;
      }

      const sha256 = await hashFileSha256(localPath);

      const completionTime = new Date();
      const completionResult = await this.prisma.mediaItem.updateMany({
        where: {
          id: mediaItem.id,
          status: MediaStatus.downloading,
          downloadLeaseToken,
        },
        data: {
          status: MediaStatus.downloaded,
          downloadLeaseToken: null,
          localPath,
          sizeBytes,
          sha256,
          error: null,
          failedAt: null,
          updatedAt: completionTime,
        },
      });
      if (completionResult.count !== 1) {
        logger.warn(
          { mediaItemId: mediaItem.id },
          'download completed after media item ownership was lost; skipping handoff',
        );
        return;
      }
      downloadPersisted = true;
      completedAt = completionTime;

      await this.eventLogService.log(mediaItem.id, 'download_done', {
        localPath,
        sizeBytes: sizeBytes.toString(),
      });

      logger.info(
        this.buildLogContext({
          message,
          media,
          uploader,
          mediaItemId: mediaItem.id,
          tgFileUniqueId: mediaItem.tgFileUniqueId ?? `idx:${mediaItem.mediaIndex}`,
          mediaStatus: MediaStatus.downloaded,
          localPath,
          sizeBytes,
          sha256,
        }),
        'media download completed',
      );

      await this.enqueueUploadFromStoredFile(
        message,
        media,
        {
          ...mediaItem,
          localPath,
          sizeBytes,
          status: MediaStatus.downloaded,
        },
        uploader,
        'download-complete',
      );
    } catch (err) {
      const errorMessage = (err as Error).message;
      const terminalDownloadFailure = telegramDownloadFailed && this.isFinalDownloadAttempt(attempt);
      logger.error(
        {
          err,
          ...this.buildLogContext({
            message,
            media,
            uploader,
            mediaItemId: mediaItem.id,
            tgFileUniqueId: mediaItem.tgFileUniqueId ?? `idx:${mediaItem.mediaIndex}`,
            mediaStatus: downloadPersisted
              ? MediaStatus.downloaded
              : terminalDownloadFailure
                ? MediaStatus.deleted
                : MediaStatus.failed,
            localPath,
          }),
        },
        'media download failed',
      );
      await this.recordDownloadFailure(
        mediaItem.id,
        errorMessage,
        downloadPersisted,
        downloadLeaseToken,
        completedAt,
        terminalDownloadFailure,
      );
      if (terminalDownloadFailure) {
        try {
          await fs.rm(localPath, { force: true });
        } catch (cleanupError) {
          logger.warn({ err: cleanupError, mediaItemId: mediaItem.id, localPath }, 'failed to remove incomplete terminal download');
        }
      }
      throw err;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async refreshDownloadHeartbeat(mediaItemId: string, downloadLeaseToken: string): Promise<void> {
    try {
      await this.prisma.mediaItem.updateMany({
        where: {
          id: mediaItemId,
          status: MediaStatus.downloading,
          downloadLeaseToken,
        },
        data: { updatedAt: new Date() },
      });
    } catch (err) {
      logger.warn({ err, mediaItemId }, 'failed to refresh active download heartbeat');
    }
  }

  private async recordDownloadFailure(
    mediaItemId: string,
    errorMessage: string,
    downloadPersisted: boolean,
    downloadLeaseToken: string,
    completedAt?: Date,
    terminalDownloadFailure = false,
  ): Promise<void> {
    const now = new Date();
    try {
      if (downloadPersisted && !completedAt) {
        logger.error({ mediaItemId }, 'missing completion timestamp while recording post-download failure');
        return;
      }
      const result = await this.prisma.mediaItem.updateMany({
        where: downloadPersisted
          ? {
            id: mediaItemId,
            status: MediaStatus.downloaded,
            updatedAt: completedAt,
          }
          : {
            id: mediaItemId,
            status: MediaStatus.downloading,
            downloadLeaseToken,
          },
        data: {
          // Once the staged file is durable, downstream queue/log failures must
          // not discard it or force another Telegram download.
          status: downloadPersisted
            ? MediaStatus.downloaded
            : terminalDownloadFailure
              ? MediaStatus.deleted
              : MediaStatus.failed,
          downloadLeaseToken: null,
          error: errorMessage,
          failedAt: downloadPersisted ? null : now,
          retryCount: { increment: 1 },
          lastRetryAt: now,
          updatedAt: now,
        },
      });
      if (result.count === 1) {
        await this.eventLogService.log(mediaItemId, downloadPersisted ? 'retried' : 'failed', {
          error: errorMessage,
          reason: downloadPersisted ? 'post-download-handoff-failed' : undefined,
        });
      }
    } catch (recordError) {
      logger.error({ err: recordError, mediaItemId }, 'failed to record media download failure');
    }
  }

  private async enqueueDownload(
    message: IncomingMessage,
    media: IncomingMedia,
    mediaItem: Pick<MediaItem, 'id' | 'status' | 'mediaIndex' | 'tgFileUniqueId'>,
    uploader: ResolvedUploaderContext | undefined,
    reason: string,
  ): Promise<void> {
    await this.queueService.enqueueDownload({
      mediaItemId: mediaItem.id,
    });

    logger.info(
      {
        enqueueReason: reason,
        ...this.buildLogContext({
          message,
          media,
          uploader,
          mediaItemId: mediaItem.id,
          tgFileUniqueId: mediaItem.tgFileUniqueId ?? `idx:${mediaItem.mediaIndex}`,
          mediaStatus: mediaItem.status,
        }),
      },
      'download job enqueued for media item',
    );
  }

  private async enqueueUploadFromStoredFile(
    message: IncomingMessage,
    media: IncomingMedia,
    mediaItem: Pick<MediaItem, 'id' | 'localPath' | 'sizeBytes' | 'tgFileUniqueId' | 'mediaIndex' | 'status'>,
    uploader: ResolvedUploaderContext | undefined,
    reason: string,
  ): Promise<void> {
    if (!mediaItem.localPath || !mediaItem.sizeBytes) {
      return;
    }

    await this.queueService.enqueueUpload({
      mediaItemId: mediaItem.id,
      localPath: mediaItem.localPath,
      chatId: message.chatId.toString(),
      messageId: message.messageId.toString(),
      mediaType: media.type,
      sizeBytes: mediaItem.sizeBytes.toString(),
    });

    logger.info(
      {
        enqueueReason: reason,
        ...this.buildLogContext({
          message,
          media,
          uploader,
          mediaItemId: mediaItem.id,
          tgFileUniqueId: mediaItem.tgFileUniqueId ?? `idx:${mediaItem.mediaIndex}`,
          mediaStatus: mediaItem.status,
          localPath: mediaItem.localPath,
          sizeBytes: mediaItem.sizeBytes,
        }),
      },
      'upload job enqueued for media item',
    );
  }

  private async buildMessageFromMediaItem(item: MediaItem): Promise<IncomingMessage | null> {
    const groupState = await this.prisma.groupState.findUnique({
      where: { chatId: item.chatId },
      select: {
        title: true,
        chatType: true,
        isActive: true,
      },
    });

    if (!groupState?.isActive) {
      return null;
    }

    return {
      chatId: item.chatId,
      chatTitle: groupState.title,
      chatType: groupState.chatType as IncomingMessage['chatType'],
      messageId: item.messageId,
      groupedId: item.groupedId ?? undefined,
      senderId: item.senderId ?? undefined,
      date: item.date,
      media: [this.buildMediaFromItem(item)],
    };
  }

  private buildMediaFromItem(item: MediaItem): IncomingMedia {
    return {
      type: item.mediaType as IncomingMedia['type'],
      fileId: item.tgFileId,
      uniqueId: item.tgFileUniqueId ?? undefined,
      fileName: item.fileName ?? undefined,
      mimeType: item.mimeType ?? undefined,
      size: item.sizeBytes ?? undefined,
      mediaIndex: item.mediaIndex,
    };
  }

  private async resolveUploaderContext(senderId: bigint | null, chatId: bigint): Promise<ResolvedUploaderContext | undefined> {
    if (!senderId) {
      return undefined;
    }

    const userTu = await this.prisma.userTu.findFirst({
      where: {
        telegramUserId: senderId,
        telegramChatId: chatId,
      },
      select: {
        id: true,
        tuId: true,
        tuName: true,
      },
    });

    if (!userTu) {
      return undefined;
    }

    return {
      userTuId: userTu.id,
      tuId: userTu.tuId,
      tuName: userTu.tuName,
    };
  }

  private async pathExists(absPath: string): Promise<boolean> {
    try {
      await fs.access(absPath);
      return true;
    } catch {
      return false;
    }
  }

  private isRecoverableStatus(status: MediaStatus): boolean {
    return status === MediaStatus.queued ||
      status === MediaStatus.downloading ||
      status === MediaStatus.downloaded ||
      status === MediaStatus.uploading ||
      status === MediaStatus.failed;
  }

  private isFinalDownloadAttempt(attempt?: DownloadAttemptMetadata): boolean {
    return !!attempt && attempt.attemptsMade + 1 >= attempt.maxAttempts;
  }

  private canResumeUpload(item: MediaItem, fileExists: boolean): boolean {
    return (
      (item.status === MediaStatus.downloaded ||
        item.status === MediaStatus.uploading ||
        item.status === MediaStatus.failed) &&
      !!item.localPath &&
      fileExists &&
      !!item.sizeBytes
    );
  }

  private buildLogContext(input: {
    message: IncomingMessage;
    media: IncomingMedia;
    uploader?: ResolvedUploaderContext;
    mediaItemId: string;
    tgFileUniqueId: string;
    mediaStatus: MediaStatus;
    localPath?: string;
    sizeBytes?: bigint;
    sha256?: string;
  }): Record<string, unknown> {
    return {
      mediaItemId: input.mediaItemId,
      mediaStatus: input.mediaStatus,
      userTuId: input.uploader?.userTuId,
      tuId: input.uploader?.tuId,
      tuName: input.uploader?.tuName,
      chatId: input.message.chatId.toString(),
      chatTitle: input.message.chatTitle,
      chatType: input.message.chatType,
      messageId: input.message.messageId.toString(),
      groupedId: input.message.groupedId?.toString(),
      senderId: input.message.senderId?.toString(),
      senderUsername: input.message.senderUsername,
      mediaIndex: input.media.mediaIndex,
      mediaType: input.media.type,
      tgFileId: input.media.fileId,
      tgFileUniqueId: input.tgFileUniqueId,
      mimeType: input.media.mimeType,
      fileName: input.media.fileName,
      declaredSizeBytes: input.media.size?.toString(),
      sizeBytes: input.sizeBytes?.toString(),
      localPath: input.localPath,
      sha256: input.sha256,
    };
  }
}
