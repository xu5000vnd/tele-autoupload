import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { MediaItem, MediaStatus } from '@prisma/client';
import { appConfig } from '@shared/config/env';
import { MediaService } from '@shared/services/media.service';
import { BotApiError, BotTelegramService } from '@shared/telegram/bot-telegram.service';
import { IncomingMessage } from '@shared/types/telegram';

describe('MediaService', () => {
  it('does not regress a newer bot file reference during older replay', async () => {
    const item = makeMediaItem({ sourceRevision: 2n });
    const prisma = { mediaItem: { upsert: vi.fn().mockResolvedValue(item), updateMany: vi.fn() } };
    const service = new MediaService(prisma as never, {} as never, {} as never, {} as never);
    const result = await (service as any).persistBotMedia({ chatId: item.chatId, messageId: item.messageId,
      botId: 1n, sourceRevision: 1n, date: item.date }, { type: 'photo', fileId: 'older', mediaIndex: 0 });
    expect(result).toBeNull();
    expect(prisma.mediaItem.updateMany).not.toHaveBeenCalled();
  });

  it('invalidates an active download when a newer captured edit replaces its reference', async () => {
    const item = makeMediaItem({ sourceRevision: 1n, status: MediaStatus.downloading, downloadLeaseToken: 'old-token' });
    const prisma = { mediaItem: { upsert: vi.fn().mockResolvedValue(item), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue({ ...item, sourceRevision: 2n, status: MediaStatus.queued }) } };
    const service = new MediaService(prisma as never, {} as never, {} as never, {} as never);
    await (service as any).persistBotMedia({ chatId: item.chatId, messageId: item.messageId,
      botId: 1n, sourceRevision: 2n, date: item.date }, { type: 'photo', fileId: 'edited', mediaIndex: 0 });
    expect(prisma.mediaItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sourceRevision: 1n, status: MediaStatus.downloading }),
      data: expect.objectContaining({ tgFileId: 'edited', sourceRevision: 2n, status: MediaStatus.queued, downloadLeaseToken: null }),
    }));
  });

  it('copies a large local API file without deleting the server cache', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'tele-bot-large-'));
    const originalRoot = appConfig.botApiCacheDir;
    appConfig.botApiCacheDir = directory;
    const source = path.join(directory, 'large.mp4');
    const destination = path.join(directory, 'staged.mp4');
    const handle = await fs.open(source, 'w');
    await handle.truncate(21 * 1024 * 1024);
    await handle.close();
    const service = new BotTelegramService({} as never, {} as never, {} as never);
    vi.spyOn(service, 'getMe').mockResolvedValue({ id: 1 } as never);
    vi.spyOn(service, 'call').mockResolvedValue({ file_path: source });
    try {
      await expect(service.download({ fileId: 'opaque-bot-id', botId: 1n }, destination)).resolves.toEqual({ sizeBytes: 22020096n });
      expect((await fs.stat(source)).size).toBe(22020096);
      await expect(service.download({ fileId: 'wrong-bot-id', botId: 2n }, destination)).rejects.toThrow('another bot');
      expect(service.call).toHaveBeenCalledTimes(1);
    } finally {
      appConfig.botApiCacheDir = originalRoot;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a local API path that escapes the shared cache through a symlink', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'tele-bot-path-'));
    const cache = path.join(directory, 'cache');
    await fs.mkdir(cache);
    await fs.writeFile(path.join(directory, 'outside'), 'media');
    await fs.symlink(path.join(directory, 'outside'), path.join(cache, 'linked'));
    const originalRoot = appConfig.botApiCacheDir;
    appConfig.botApiCacheDir = cache;
    const service = new BotTelegramService({} as never, {} as never, {} as never);
    vi.spyOn(service, 'getMe').mockResolvedValue({ id: 1 } as never);
    vi.spyOn(service, 'call').mockResolvedValue({ file_path: path.join(cache, 'linked') });
    try {
      await expect(service.download({ fileId: 'opaque', botId: 1n }, path.join(directory, 'staged'))).rejects.toThrow('outside BOT_API_CACHE_DIR');
    } finally {
      appConfig.botApiCacheDir = originalRoot;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('honors retry_after without issuing another request or exposing the bot token', async () => {
    const service = new BotTelegramService({} as never, {} as never, {} as never);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 30 } }) } as Response);
    try {
      await expect(service.call('getFile')).rejects.toMatchObject({ code: 429, retryAfter: 30 });
      await expect(service.call('getFile')).rejects.toThrow('Local Telegram Bot API request failed (429)');
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally { fetchMock.mockRestore(); }
  });

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
    const telegramGateway = { download: vi.fn() };
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
    expect(telegramGateway.download).not.toHaveBeenCalled();
  });

  it('replaces obsolete staged bytes when a newer bot edit arrives before upload starts', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'tele-edit-staged-'));
    const oldPath = path.join(directory, 'old.jpg');
    await fs.writeFile(oldPath, 'old attachment');
    try {
      let item = makeMediaItem({ status: MediaStatus.downloaded, localPath: oldPath, sizeBytes: 14n, sha256: 'old-hash' });
      const prisma = {
        groupState: { findUnique: vi.fn().mockResolvedValue({ lastMessageId: item.messageId }), upsert: vi.fn().mockResolvedValue({ isActive: true }) },
        mediaItem: {
          findUnique: vi.fn().mockImplementation(async () => item),
          upsert: vi.fn().mockImplementation(async () => item),
          updateMany: vi.fn().mockImplementation(async ({ data }) => { item = { ...item, ...data }; return { count: 1 }; }),
        },
      };
      const queue = { enqueueDownload: vi.fn().mockResolvedValue(undefined), enqueueUpload: vi.fn() };
      const service = new MediaService(prisma as never, queue as never, { log: vi.fn() } as never, {} as never);
      await service.processIncomingMessage({ chatId: item.chatId, chatTitle: 'Source', chatType: 'supergroup', messageId: item.messageId,
        date: item.date, transport: 'bot', botId: 1n, sourceRevision: 2n,
        media: [{ type: 'photo', fileId: 'edited', uniqueId: 'edited-unique', mediaIndex: 0 }] });
      expect(item).toMatchObject({ status: MediaStatus.queued, localPath: null, sha256: null, tgFileId: 'edited', sourceRevision: 2n });
      expect(queue.enqueueDownload).toHaveBeenCalledWith({ mediaItemId: item.id });
      expect(queue.enqueueUpload).not.toHaveBeenCalled();
      await expect(fs.stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('defers replacement while an upload owns the artifact and preserves uploaded-slot behavior', async () => {
    const item = makeMediaItem({ status: MediaStatus.uploading });
    const prisma = { mediaItem: { upsert: vi.fn().mockResolvedValue(item), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue(item) } };
    const service = new MediaService(prisma as never, {} as never, {} as never, {} as never);
    const media = { type: 'photo' as const, fileId: 'edited', uniqueId: 'edited', mediaIndex: 0 };
    const message: IncomingMessage = { chatId: item.chatId, chatTitle: 'Source', chatType: 'supergroup', messageId: item.messageId,
      date: item.date, transport: 'bot', botId: 1n, sourceRevision: 2n, media: [media] };
    await expect((service as any).persistBotMedia(message, media)).rejects.toThrow('upload is in progress');
    expect(prisma.mediaItem.updateMany).not.toHaveBeenCalled();
    item.status = MediaStatus.uploaded;
    await (service as any).persistBotMedia(message, media);
    expect(prisma.mediaItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ status: MediaStatus.queued }) }));
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
    const telegramGateway = { download: vi.fn() };
    const service = new MediaService(
      prisma as never,
      queueService as never,
      eventLogService as never,
      telegramGateway as never,
    );

    await service.downloadMediaItem(item.id);

    expect(prisma.mediaItem.updateMany).toHaveBeenCalledOnce();
    expect(telegramGateway.download).not.toHaveBeenCalled();
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
      download: vi.fn().mockImplementation(async (_reference, targetPath) => {
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
      await expect(fs.access(destinationPath)).rejects.toThrow();
      expect(telegramGateway.download).toHaveBeenCalledWith({ fileId: item.tgFileId, botId: 1n }, destinationPath);
    } finally {
      if (destinationPath) {
        await fs.rm(destinationPath, { force: true });
      }
    }
  });

  it.each([
    {
      name: 'keeps a non-final Telegram download failure retryable',
      attemptsMade: 1,
      maxAttempts: 3,
      expectedStatus: MediaStatus.failed,
      error: new BotApiError(503),
      writePartialMedia: true,
    },
    {
      name: 'keeps final bot transport failure recoverable',
      attemptsMade: 2,
      maxAttempts: 3,
      expectedStatus: MediaStatus.failed,
      error: new BotApiError(503),
      writePartialMedia: true,
    },
    {
      name: 'keeps a final local staging failure retryable',
      attemptsMade: 2,
      maxAttempts: 3,
      expectedStatus: MediaStatus.failed,
      error: new Error('Staging disk full'),
      writePartialMedia: false,
    },
  ])('$name', async ({ attemptsMade, maxAttempts, expectedStatus, error, writePartialMedia }) => {
    const stagingDir = await fs.mkdtemp(path.join(tmpdir(), 'tele-autoupload-download-failure-'));
    const originalStagingDir = appConfig.stagingDir;
    appConfig.stagingDir = stagingDir;
    const item = makeMediaItem({
      localPath: null,
      sizeBytes: null,
      status: MediaStatus.queued,
    });
    const prisma = {
      mediaItem: {
        findUnique: vi.fn().mockResolvedValue(item),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
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
    let destinationPath = '';
    const telegramGateway = {
      download: vi.fn().mockImplementation(async (_reference, targetPath) => {
        destinationPath = targetPath;
        if (writePartialMedia) {
          await fs.writeFile(destinationPath, 'partial-media');
        }
        throw error;
      }),
    };
    const service = new MediaService(
      prisma as never,
      { enqueueDownload: vi.fn(), enqueueUpload: vi.fn() } as never,
      { log: vi.fn().mockResolvedValue(undefined) } as never,
      telegramGateway as never,
    );

    try {
      await expect(service.downloadMediaItem(item.id, {
        attemptsMade,
        maxAttempts,
      })).rejects.toThrow(error.message);

      expect(prisma.mediaItem.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: expect.objectContaining({
          id: item.id,
          status: MediaStatus.downloading,
          downloadLeaseToken: expect.any(String),
        }),
        data: expect.objectContaining({
          status: expectedStatus,
          downloadLeaseToken: null,
          error: error.message,
          failedAt: expect.any(Date),
        }),
      }));
      if (expectedStatus === MediaStatus.deleted) {
        await expect(fs.access(destinationPath)).rejects.toThrow();
      }
    } finally {
      appConfig.stagingDir = originalStagingDir;
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });

  it('keeps downloaded media after upload handoff fails on a final download attempt', async () => {
    const stagingDir = await fs.mkdtemp(path.join(tmpdir(), 'tele-autoupload-handoff-'));
    const originalStagingDir = appConfig.stagingDir;
    appConfig.stagingDir = stagingDir;
    const item = makeMediaItem({
      localPath: null,
      sizeBytes: null,
      status: MediaStatus.queued,
    });
    const prisma = {
      mediaItem: {
        findUnique: vi.fn().mockResolvedValue(item),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
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
      enqueueUpload: vi.fn().mockRejectedValue(new Error('upload queue unavailable')),
    };
    const telegramGateway = {
      download: vi.fn().mockImplementation(async (_reference, destinationPath) => {
        await fs.writeFile(destinationPath, 'downloaded-media');
        return { sizeBytes: 16n };
      }),
    };
    const service = new MediaService(
      prisma as never,
      queueService as never,
      { log: vi.fn().mockResolvedValue(undefined) } as never,
      telegramGateway as never,
    );

    try {
      await expect(service.downloadMediaItem(item.id, {
        attemptsMade: 2,
        maxAttempts: 3,
      })).rejects.toThrow('upload queue unavailable');

      expect(prisma.mediaItem.updateMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
        where: expect.objectContaining({ id: item.id, status: MediaStatus.downloaded }),
        data: expect.objectContaining({
          status: MediaStatus.downloaded,
          downloadLeaseToken: null,
          error: 'upload queue unavailable',
          failedAt: null,
        }),
      }));
    } finally {
      appConfig.stagingDir = originalStagingDir;
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  });

  it('does not requeue a deleted media item during message replay', async () => {
    const prisma = {
      groupState: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ isActive: true }),
      },
      mediaItem: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          id: 'media-deleted',
          status: MediaStatus.deleted,
          localPath: null,
          sizeBytes: null,
        }),
      },
    };
    const queueService = {
      enqueueDownload: vi.fn(),
      enqueueUpload: vi.fn(),
    };
    const eventLogService = { log: vi.fn().mockResolvedValue(undefined) };
    const service = new MediaService(
      prisma as never,
      queueService as never,
      eventLogService as never,
      { download: vi.fn() } as never,
    );

    await service.processIncomingMessage({
      chatId: -1003839814010n,
      chatTitle: 'Monthly Media',
      chatType: 'supergroup',
      messageId: 20n,
      senderId: 1935597038n,
      date: new Date('2026-07-05T17:43:39.715Z'),
      media: [{
        type: 'photo',
        fileId: 'deleted-photo',
        uniqueId: 'deleted-photo',
        mimeType: 'image/jpeg',
        mediaIndex: 0,
      }],
    });

    expect(queueService.enqueueDownload).not.toHaveBeenCalled();
    expect(queueService.enqueueUpload).not.toHaveBeenCalled();
    expect(eventLogService.log).not.toHaveBeenCalled();
  });

  it('does not recover deleted media items', async () => {
    const item = makeMediaItem({
      localPath: null,
      sizeBytes: null,
      status: MediaStatus.deleted,
    });
    const prisma = {
      mediaItem: {
        findMany: vi.fn().mockResolvedValue([item]),
        findUnique: vi.fn().mockResolvedValue(item),
        updateMany: vi.fn(),
      },
    };
    const queueService = { enqueueDownload: vi.fn(), enqueueUpload: vi.fn() };
    const service = new MediaService(
      prisma as never,
      queueService as never,
      { log: vi.fn() } as never,
      {} as never,
    );

    const recovered = await service.recoverStaleMediaItems({ olderThanMs: 60_000 });

    expect(recovered).toBe(0);
    expect(prisma.mediaItem.findMany.mock.calls[0][0].where.status.in).not.toContain(MediaStatus.deleted);
    expect(prisma.mediaItem.updateMany).not.toHaveBeenCalled();
    expect(queueService.enqueueDownload).not.toHaveBeenCalled();
  });

  it('does not download a deleted item that was already queued', async () => {
    const item = makeMediaItem({
      localPath: null,
      sizeBytes: null,
      status: MediaStatus.deleted,
    });
    const prisma = {
      mediaItem: {
        findUnique: vi.fn().mockResolvedValue(item),
      },
      groupState: { findUnique: vi.fn() },
    };
    const telegramGateway = { download: vi.fn() };
    const service = new MediaService(
      prisma as never,
      { enqueueDownload: vi.fn(), enqueueUpload: vi.fn() } as never,
      { log: vi.fn() } as never,
      telegramGateway as never,
    );

    await expect(service.downloadMediaItem(item.id)).resolves.toBeUndefined();

    expect(prisma.groupState.findUnique).not.toHaveBeenCalled();
    expect(telegramGateway.download).not.toHaveBeenCalled();
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

function makeMediaItem(overrides: Partial<MediaItem>): MediaItem {
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
    transport: 'bot',
    botId: 1n,
    albumId: null,
    sourceRevision: 1n,
    tgFileId: 'photo-stale',
    tgFileUniqueId: 'photo-stale',
    fileName: null,
    sha256: null,
    localPath: null,
    sizeBytes: null,
    status: MediaStatus.queued,
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
    ...overrides,
  };
}
