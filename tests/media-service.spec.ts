import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
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

  it('persists a new media item and enqueues download work without downloading inline', async () => {
    const prisma = {
      groupState: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ isActive: true }),
      },
      mediaItem: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          id: 'media-new',
          status: MediaStatus.queued,
          localPath: null,
          sizeBytes: null,
        }),
      },
    };
    const queueService = {
      enqueueDownload: vi.fn().mockResolvedValue(undefined),
      enqueueUpload: vi.fn().mockResolvedValue(undefined),
    };
    const eventLogService = { log: vi.fn().mockResolvedValue(undefined) };
    const telegramGateway = { downloadMediaToFile: vi.fn() };
    const service = new MediaService(
      prisma as never,
      queueService as never,
      eventLogService as never,
      telegramGateway as never,
    );

    await service.processIncomingMessage({
      chatId: -1003839814010n,
      chatTitle: 'Monthly Media',
      chatType: 'supergroup',
      messageId: 19n,
      senderId: 1935597038n,
      date: new Date('2026-07-05T17:43:39.715Z'),
      media: [{
        type: 'photo',
        fileId: 'photo-new',
        uniqueId: 'photo-new',
        mimeType: 'image/jpeg',
        mediaIndex: 0,
      }],
    });

    expect(prisma.mediaItem.upsert).toHaveBeenCalledOnce();
    expect(queueService.enqueueDownload).toHaveBeenCalledWith({ mediaItemId: 'media-new' });
    expect(queueService.enqueueUpload).not.toHaveBeenCalled();
    expect(telegramGateway.downloadMediaToFile).not.toHaveBeenCalled();
  });

  it('does not reclaim a download refreshed by a heartbeat after stale selection', async () => {
    const staleItem = makeMediaItem({
      localPath: '/tmp/already-staged.jpg',
      sizeBytes: 12n,
      status: MediaStatus.failed,
    });
    const refreshedItem = {
      ...staleItem,
      updatedAt: new Date(),
    };
    const prisma = {
      mediaItem: {
        findMany: vi.fn().mockResolvedValue([staleItem]),
        findUnique: vi.fn().mockResolvedValue(refreshedItem),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      groupState: {
        findUnique: vi.fn().mockResolvedValue({
          title: 'Monthly Media',
          chatType: 'supergroup',
          isActive: true,
        }),
      },
      userTu: { findFirst: vi.fn() },
    };
    const queueService = {
      enqueueDownload: vi.fn(),
      enqueueUpload: vi.fn(),
    };
    const eventLogService = { log: vi.fn() };
    const service = new MediaService(
      prisma as never,
      queueService as never,
      eventLogService as never,
      {} as never,
    );

    const recovered = await service.recoverStaleMediaItems({ olderThanMs: 60_000 });

    expect(recovered).toBe(0);
    expect(prisma.mediaItem.updateMany).toHaveBeenCalledOnce();
    expect(prisma.mediaItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: staleItem.status,
        updatedAt: staleItem.updatedAt,
      }),
    }));
    expect(eventLogService.log).not.toHaveBeenCalled();
    expect(queueService.enqueueDownload).not.toHaveBeenCalled();
    expect(queueService.enqueueUpload).not.toHaveBeenCalled();
  });

  it('resumes upload for a failed item with a durable staged file', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(tmpdir(), 'tele-autoupload-media-'));
    const localPath = path.join(temporaryDirectory, 'staged.jpg');
    await fs.writeFile(localPath, 'staged-media');
    try {
      const staleItem = makeMediaItem({
        localPath,
        sizeBytes: 12n,
        status: MediaStatus.failed,
      });
      const prisma = {
        mediaItem: {
          findMany: vi.fn().mockResolvedValue([staleItem]),
          findUnique: vi.fn().mockResolvedValue(staleItem),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        groupState: {
          findUnique: vi.fn().mockResolvedValue({
            title: 'Monthly Media',
            chatType: 'supergroup',
            isActive: true,
          }),
        },
        userTu: { findFirst: vi.fn() },
      };
      const queueService = {
        enqueueDownload: vi.fn(),
        enqueueUpload: vi.fn().mockResolvedValue(undefined),
      };
      const eventLogService = { log: vi.fn().mockResolvedValue(undefined) };
      const service = new MediaService(
        prisma as never,
        queueService as never,
        eventLogService as never,
        {} as never,
      );

      const recovered = await service.recoverStaleMediaItems({ olderThanMs: 60_000 });

      expect(recovered).toBe(1);
      expect(prisma.mediaItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: staleItem.id, status: MediaStatus.failed }),
        data: expect.objectContaining({ status: MediaStatus.downloaded }),
      }));
      expect(queueService.enqueueUpload).toHaveBeenCalledWith({
        mediaItemId: staleItem.id,
        localPath,
        chatId: staleItem.chatId.toString(),
        messageId: staleItem.messageId.toString(),
        mediaType: 'photo',
        sizeBytes: '12',
      });
      expect(queueService.enqueueDownload).not.toHaveBeenCalled();
      expect(eventLogService.log).toHaveBeenCalledWith(staleItem.id, 'retried', {
        reason: 'stale-upload-recovery',
      });
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('does not download when another worker wins the media-item claim', async () => {
    const item = makeMediaItem({
      localPath: null,
      sizeBytes: null,
      status: MediaStatus.queued,
    });
    const prisma = {
      mediaItem: {
        findUnique: vi.fn().mockResolvedValue(item),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      groupState: {
        findUnique: vi.fn().mockResolvedValue({
          title: 'Monthly Media',
          chatType: 'supergroup',
          isActive: true,
        }),
      },
      userTu: { findFirst: vi.fn() },
    };
    const queueService = { enqueueDownload: vi.fn(), enqueueUpload: vi.fn() };
    const eventLogService = { log: vi.fn() };
    const telegramGateway = { downloadMediaToFile: vi.fn() };
    const service = new MediaService(
      prisma as never,
      queueService as never,
      eventLogService as never,
      telegramGateway as never,
    );

    await service.downloadMediaItem(item.id);

    expect(prisma.mediaItem.updateMany).toHaveBeenCalledOnce();
    expect(telegramGateway.downloadMediaToFile).not.toHaveBeenCalled();
    expect(eventLogService.log).not.toHaveBeenCalled();
    expect(queueService.enqueueUpload).not.toHaveBeenCalled();
  });

  it('does not hand off a download when its ownership token is no longer current', async () => {
    const item = makeMediaItem({
      localPath: null,
      sizeBytes: null,
      status: MediaStatus.queued,
    });
    let destinationPath = '';
    const prisma = {
      mediaItem: {
        findUnique: vi.fn().mockResolvedValue(item),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
      groupState: {
        findUnique: vi.fn().mockResolvedValue({
          title: 'Monthly Media',
          chatType: 'supergroup',
          isActive: true,
        }),
      },
      userTu: { findFirst: vi.fn() },
    };
    const queueService = { enqueueDownload: vi.fn(), enqueueUpload: vi.fn() };
    const eventLogService = { log: vi.fn().mockResolvedValue(undefined) };
    const telegramGateway = {
      downloadMediaToFile: vi.fn().mockImplementation(async ({ destinationPath: targetPath }) => {
        destinationPath = targetPath;
        await fs.writeFile(targetPath, 'downloaded-media');
        return { sizeBytes: 16n };
      }),
    };
    const service = new MediaService(
      prisma as never,
      queueService as never,
      eventLogService as never,
      telegramGateway as never,
    );

    try {
      await service.downloadMediaItem(item.id);

      expect(prisma.mediaItem.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: expect.objectContaining({
          id: item.id,
          status: MediaStatus.downloading,
          downloadLeaseToken: expect.any(String),
        }),
      }));
      expect(queueService.enqueueUpload).not.toHaveBeenCalled();
    } finally {
      if (destinationPath) {
        await fs.rm(destinationPath, { force: true });
      }
    }
  });

  it('stops stale recovery before claiming any item when run ownership is lost', async () => {
    const staleItem = makeMediaItem({
      localPath: null,
      sizeBytes: null,
      status: MediaStatus.queued,
    });
    const prisma = {
      mediaItem: {
        findMany: vi.fn().mockResolvedValue([staleItem]),
        findUnique: vi.fn(),
      },
    };
    const service = new MediaService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const recovered = await service.recoverStaleMediaItems({
      olderThanMs: 60_000,
      shouldContinue: () => false,
    });

    expect(recovered).toBe(0);
    expect(prisma.mediaItem.findUnique).not.toHaveBeenCalled();
  });
});

function makeMediaItem(overrides: {
  localPath: string | null;
  sizeBytes: bigint | null;
  status: MediaStatus;
}) {
  const timestamp = new Date('2026-07-05T17:43:39.715Z');
  return {
    id: 'media-stale',
    chatId: -1003839814010n,
    messageId: 18n,
    groupedId: null,
    mediaIndex: 0,
    date: timestamp,
    senderId: null,
    mediaType: 'photo',
    mimeType: 'image/jpeg',
    tgFileId: 'photo-stale',
    tgFileUniqueId: 'photo-stale',
    fileName: null,
    sha256: null,
    localPath: overrides.localPath,
    sizeBytes: overrides.sizeBytes,
    status: overrides.status,
    retryCount: 0,
    lastRetryAt: null,
    driveFileId: null,
    driveWebUrl: null,
    error: 'previous download failed',
    failedAt: timestamp,
    downloadLeaseToken: null,
    priority: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
