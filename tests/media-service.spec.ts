import { describe, expect, it, vi } from 'vitest';
import { MediaStatus } from '@prisma/client';
import { MediaService } from '@shared/services/media.service';
import { IncomingMessage } from '@shared/types/telegram';

describe('MediaService', () => {
  it('upserts media by message slot and refreshes Telegram file identity', async () => {
    const prisma = {
      groupState: {
        findUnique: vi.fn().mockResolvedValue({ lastMessageId: 18n }),
        upsert: vi.fn().mockResolvedValue({ isActive: true }),
      },
      mediaItem: {
        findUnique: vi.fn().mockResolvedValue({ id: 'media-1' }),
        upsert: vi.fn().mockResolvedValue({
          id: 'media-1',
          status: MediaStatus.uploaded,
          localPath: null,
          sizeBytes: null,
        }),
      },
    };
    const eventLogService = {
      log: vi.fn().mockResolvedValue(undefined),
    };
    const service = new MediaService(
      prisma as never,
      { enqueueUpload: vi.fn() } as never,
      eventLogService as never,
      {} as never,
    );

    const message: IncomingMessage = {
      chatId: -1003839814010n,
      chatTitle: 'Monthly Media',
      chatType: 'supergroup',
      messageId: 18n,
      senderId: 1935597038n,
      date: new Date('2026-07-05T17:43:39.715Z'),
      media: [{
        type: 'photo',
        fileId: 'photo-2',
        uniqueId: 'photo-2',
        mimeType: 'image/jpeg',
        mediaIndex: 0,
      }],
    };

    await service.processIncomingMessage(message);

    expect(prisma.mediaItem.findUnique).toHaveBeenCalledWith({
      where: {
        chatId_messageId_mediaIndex: {
          chatId: -1003839814010n,
          messageId: 18n,
          mediaIndex: 0,
        },
      },
      select: { id: true },
    });
    expect(prisma.mediaItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        chatId_messageId_mediaIndex: {
          chatId: -1003839814010n,
          messageId: 18n,
          mediaIndex: 0,
        },
      },
      update: expect.objectContaining({
        tgFileId: 'photo-2',
        tgFileUniqueId: 'photo-2',
      }),
    }));
    expect(eventLogService.log).toHaveBeenCalledWith('media-1', 'queued', expect.any(Object));
  });
});
