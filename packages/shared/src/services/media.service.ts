import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ChatType, MediaStatus, MediaType } from '@prisma/client';
import { appConfig } from '@shared/config/env';
import { PrismaService } from '@shared/db/prisma.service';
import { QueueService } from '@shared/queue/queue.service';
import { JobEventLogService } from '@shared/services/job-event-log.service';
import { TelegramGateway } from '@shared/telegram/telegram-gateway';
import { IncomingMessage } from '@shared/types/telegram';
import { makeDeterministicFileName } from '@shared/utils/file-naming';
import { hashFileSha256 } from '@shared/utils/hash';
import { logger } from '@shared/utils/logger';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly eventLogService: JobEventLogService,
    private readonly telegramGateway: TelegramGateway,
  ) {}

  async processIncomingMessage(message: IncomingMessage): Promise<void> {
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

      // Skip if already downloaded or uploaded (idempotent re-processing)
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
        if (mediaItem.localPath && mediaItem.sizeBytes) {
          await this.queueService.enqueueUpload({
            mediaItemId: mediaItem.id,
            localPath: mediaItem.localPath,
            chatId: message.chatId.toString(),
            messageId: message.messageId.toString(),
            mediaType: media.type,
            sizeBytes: mediaItem.sizeBytes.toString(),
          });
        }
        continue;
      }

      // Determine final local path
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
        data: { status: MediaStatus.downloading },
      });
      await this.eventLogService.log(mediaItem.id, 'download_start', {});

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
          data: { status: MediaStatus.downloaded, localPath, sizeBytes, sha256 },
        });

        await this.eventLogService.log(mediaItem.id, 'download_done', {
          localPath,
          sizeBytes: sizeBytes.toString(),
        });

        await this.queueService.enqueueUpload({
          mediaItemId: mediaItem.id,
          localPath,
          chatId: message.chatId.toString(),
          messageId: message.messageId.toString(),
          mediaType: media.type,
          sizeBytes: sizeBytes.toString(),
        });
      } catch (err) {
        logger.error({ err, mediaItemId: mediaItem.id }, 'download failed');
        await this.prisma.mediaItem.update({
          where: { id: mediaItem.id },
          data: {
            status: MediaStatus.failed,
            error: (err as Error).message,
            failedAt: new Date(),
            retryCount: { increment: 1 },
            lastRetryAt: new Date(),
          },
        });
        await this.eventLogService.log(mediaItem.id, 'failed', { error: (err as Error).message });
      }
    }
  }
}
