import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ChatType, MediaItem, MediaStatus, MediaType } from '@prisma/client';
import { appConfig } from '@shared/config/env';
import { PrismaService } from '@shared/db/prisma.service';
import { QueueService } from '@shared/queue/queue.service';
import { JobEventLogService } from '@shared/services/job-event-log.service';
import { TelegramGateway } from '@shared/telegram/telegram-gateway';
import { IncomingMedia, IncomingMessage } from '@shared/types/telegram';
import { makeDeterministicFileName } from '@shared/utils/file-naming';
import { hashFileSha256 } from '@shared/utils/hash';
import { logger } from '@shared/utils/logger';

export interface ResolvedUploaderContext {
  userTuId: number;
  tuId: string;
  tuName: string;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly eventLogService: JobEventLogService,
    private readonly telegramGateway: TelegramGateway,
  ) {}

  async processIncomingMessage(message: IncomingMessage, uploader?: ResolvedUploaderContext): Promise<void> {
    const groupState = await this.prisma.groupState.upsert({
      where: { chatId: message.chatId },
      update: {
        title: message.chatTitle,
        chatType: message.chatType as ChatType,
        lastMessageId: message.messageId,
      },
      create: {
        chatId: message.chatId,
        title: message.chatTitle,
        chatType: message.chatType as ChatType,
        lastMessageId: message.messageId,
      },
    });

    if (!groupState.isActive || !message.media.length) {
      return;
    }

    for (const media of message.media) {
      const mediaType = media.type as MediaType;
      const uniqueField = media.uniqueId ?? `idx:${media.mediaIndex}`;
      const uniqueWhere = {
        chatId_messageId_tgFileUniqueId: {
          chatId: message.chatId,
          messageId: message.messageId,
          tgFileUniqueId: uniqueField,
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

      if (
        existedBefore &&
        (
          mediaItem.status === MediaStatus.queued ||
          mediaItem.status === MediaStatus.downloading ||
          mediaItem.status === MediaStatus.uploading ||
          mediaItem.status === MediaStatus.downloaded ||
          mediaItem.status === MediaStatus.uploaded
        )
      ) {
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

        if (mediaItem.localPath && mediaItem.sizeBytes) {
          await this.enqueueUploadFromStoredFile(message, media, mediaItem, uploader, 'existing-local-media');
        }
        continue;
      }

      await this.downloadAndQueueMedia(message, media, mediaItem, uploader);
    }
  }

  async recoverStaleMediaItems(olderThanMs = appConfig.reconciliationIntervalMin * 60_000): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const staleItems = await this.prisma.mediaItem.findMany({
      where: {
        status: {
          in: [
            MediaStatus.queued,
            MediaStatus.downloading,
            MediaStatus.downloaded,
            MediaStatus.uploading,
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
      take: 50,
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

    for (const item of staleItems) {
      try {
        await this.recoverMediaItem(item);
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

    return staleItems.length;
  }

  private async recoverMediaItem(item: MediaItem): Promise<void> {
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
      return;
    }

    const media = this.buildMediaFromItem(item);
    const fileExists = item.localPath ? await this.pathExists(item.localPath) : false;

    logger.warn(
      {
        recoveryAction: this.recoveryActionForItem(item.status, fileExists),
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

    if (
      (item.status === MediaStatus.downloaded || item.status === MediaStatus.uploading) &&
      item.localPath &&
      fileExists &&
      item.sizeBytes
    ) {
      await this.prisma.mediaItem.update({
        where: { id: item.id },
        data: {
          status: MediaStatus.downloaded,
          error: null,
          failedAt: null,
          lastRetryAt: new Date(),
          retryCount: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      await this.eventLogService.log(item.id, 'retried', {
        reason: 'stale-upload-recovery',
      });
      await this.enqueueUploadFromStoredFile(message, media, item, uploader, 'stale-upload-recovery');
      return;
    }

    await this.prisma.mediaItem.update({
      where: { id: item.id },
      data: {
        status: MediaStatus.failed,
        error: 'stale media item reset for recovery',
        failedAt: new Date(),
        lastRetryAt: new Date(),
        retryCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    await this.eventLogService.log(item.id, 'retried', {
      reason: 'stale-download-recovery',
    });
    await this.downloadAndQueueMedia(message, media, item, uploader);
  }

  private async downloadAndQueueMedia(
    message: IncomingMessage,
    media: IncomingMedia,
    mediaItem: MediaItem,
    uploader?: ResolvedUploaderContext,
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
    await fs.mkdir(chatDir, { recursive: true });
    const localPath = path.join(chatDir, fileName);

    await this.prisma.mediaItem.update({
      where: { id: mediaItem.id },
      data: {
        status: MediaStatus.downloading,
        error: null,
        failedAt: null,
        updatedAt: new Date(),
      },
    });
    await this.eventLogService.log(mediaItem.id, 'download_start', {});

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

    try {
      const { sizeBytes } = await this.telegramGateway.downloadMediaToFile({
        chatId: message.chatId,
        messageId: Number(message.messageId),
        mediaIndex: media.mediaIndex,
        destinationPath: localPath,
      });

      const sha256 = await hashFileSha256(localPath);

      await this.prisma.mediaItem.update({
        where: { id: mediaItem.id },
        data: {
          status: MediaStatus.downloaded,
          localPath,
          sizeBytes,
          sha256,
          error: null,
          failedAt: null,
          updatedAt: new Date(),
        },
      });

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
      logger.error(
        {
          err,
          ...this.buildLogContext({
            message,
            media,
            uploader,
            mediaItemId: mediaItem.id,
            tgFileUniqueId: mediaItem.tgFileUniqueId ?? `idx:${mediaItem.mediaIndex}`,
            mediaStatus: MediaStatus.failed,
            localPath,
          }),
        },
        'media download failed',
      );
      await this.prisma.mediaItem.update({
        where: { id: mediaItem.id },
        data: {
          status: MediaStatus.failed,
          error: (err as Error).message,
          failedAt: new Date(),
          retryCount: { increment: 1 },
          lastRetryAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await this.eventLogService.log(mediaItem.id, 'failed', { error: (err as Error).message });
    }
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

  private recoveryActionForItem(status: MediaStatus, fileExists: boolean): 'resume-upload' | 'resume-download' {
    if ((status === MediaStatus.downloaded || status === MediaStatus.uploading) && fileExists) {
      return 'resume-upload';
    }
    return 'resume-download';
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
