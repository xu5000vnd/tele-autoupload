import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { MediaStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/config/env', () => ({
  appConfig: {
    uploadStrategy: 'drive_desktop',
    cleanupAfterHours: 2,
    drive: { syncFolder: '/tmp/drive-sync' },
    unregisteredUploaderUsernameWhitelist: [],
  },
}));

vi.mock('@shared/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { appConfig } from '@shared/config/env';
import { UploaderService } from '../apps/worker-uploader/src/uploader.service';

describe('UploaderService whitelisted admin media', () => {
  beforeEach(() => {
    appConfig.unregisteredUploaderUsernameWhitelist = [];
  });

  function createService(input: {
    item?: Record<string, unknown>;
    resolvedIds?: bigint[];
  } = {}) {
    const item = input.item ?? {
      id: 'media-1',
      chatId: -1003500431080n,
      messageId: 17n,
      senderId: 42n,
      status: MediaStatus.failed,
      localPath: '/tmp/staged.jpg',
      date: new Date('2026-08-17T00:00:00.000Z'),
      mimeType: 'image/jpeg',
    };
    const prisma = {
      mediaItem: {
        findUnique: vi.fn().mockResolvedValue(item),
        update: vi.fn().mockResolvedValue(item),
        findMany: vi.fn().mockResolvedValue([]),
      },
      userTu: { findFirst: vi.fn().mockResolvedValue(null) },
      groupState: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const eventLogService = { log: vi.fn().mockResolvedValue(undefined) };
    const strategy = { ensureDestination: vi.fn(), upload: vi.fn() };
    const telegramGateway = {
      connect: vi.fn().mockResolvedValue(undefined),
      resolvePublicUserOrBotUsername: vi.fn().mockImplementation(async () => ({
        telegramUserId: input.resolvedIds?.shift() ?? 42n,
        isBot: false,
      })),
    };
    const service = new UploaderService(
      { createUploadWorker: vi.fn() } as never,
      prisma as never,
      eventLogService as never,
      { getStrategy: vi.fn().mockReturnValue(strategy) } as never,
      { rememberDateFolder: vi.fn() } as never,
      { notify: vi.fn() } as never,
      telegramGateway as never,
    );

    return { eventLogService, prisma, service, strategy, telegramGateway };
  }

  async function process(service: UploaderService, mediaItemId = 'media-1'): Promise<void> {
    await (service as any).processJob({
      data: { mediaItemId, localPath: '/tmp/staged.jpg' },
      attemptsMade: 0,
    });
  }

  it('skips a missing mapping when a configured username resolves to the sender, including bots', async () => {
    appConfig.unregisteredUploaderUsernameWhitelist = ['admin_bot'];
    const { eventLogService, prisma, service, strategy, telegramGateway } = createService({
      resolvedIds: [42n],
    });
    telegramGateway.resolvePublicUserOrBotUsername.mockResolvedValue({ telegramUserId: 42n, isBot: true });

    await process(service);

    expect(telegramGateway.connect).toHaveBeenCalledWith({ withUpdates: false });
    expect(telegramGateway.resolvePublicUserOrBotUsername).toHaveBeenCalledWith('admin_bot');
    expect(prisma.mediaItem.update).toHaveBeenCalledWith({
      where: { id: 'media-1' },
      data: expect.objectContaining({
        status: MediaStatus.skipped,
        error: null,
        failedAt: null,
        retryCount: 0,
        lastRetryAt: null,
      }),
    });
    expect(eventLogService.log).toHaveBeenCalledWith('media-1', 'skipped', {
      reason: 'whitelisted_admin_sender',
      senderId: '42',
    });
    expect(strategy.upload).not.toHaveBeenCalled();
  });

  it('preserves a missing user_tu failure when no configured username matches the sender', async () => {
    appConfig.unregisteredUploaderUsernameWhitelist = ['admin'];
    const { eventLogService, prisma, service, telegramGateway } = createService({
      resolvedIds: [99n],
    });

    await expect(process(service)).rejects.toThrow('Missing user_tu row for media item media-1');

    expect(telegramGateway.resolvePublicUserOrBotUsername).toHaveBeenCalledWith('admin');
    expect(prisma.mediaItem.update).not.toHaveBeenCalled();
    expect(eventLogService.log).not.toHaveBeenCalled();
  });

  it('keeps confirmed admin media skipped when its event record cannot be written', async () => {
    appConfig.unregisteredUploaderUsernameWhitelist = ['admin'];
    const { eventLogService, prisma, service } = createService({ resolvedIds: [42n] });
    eventLogService.log.mockRejectedValueOnce(new Error('event log unavailable'));

    await expect(process(service)).resolves.toBeUndefined();

    expect(prisma.mediaItem.update).toHaveBeenCalledWith({
      where: { id: 'media-1' },
      data: expect.objectContaining({ status: MediaStatus.skipped }),
    });
  });

  it('does not connect to Telegram when the username whitelist is empty', async () => {
    const { service, telegramGateway } = createService();

    await expect(process(service)).rejects.toThrow('Missing user_tu row for media item media-1');

    expect(telegramGateway.connect).not.toHaveBeenCalled();
    expect(telegramGateway.resolvePublicUserOrBotUsername).not.toHaveBeenCalled();
  });

  it('fails closed when the configured whitelist cannot be fully resolved', async () => {
    appConfig.unregisteredUploaderUsernameWhitelist = ['admin', 'unavailable'];
    const { prisma, service, telegramGateway } = createService({ resolvedIds: [42n] });
    telegramGateway.resolvePublicUserOrBotUsername
      .mockResolvedValueOnce({ telegramUserId: 42n, isBot: false })
      .mockRejectedValueOnce(new Error('USERNAME_NOT_OCCUPIED'));

    await expect(process(service)).rejects.toThrow('Missing user_tu row for media item media-1');

    expect(prisma.mediaItem.update).not.toHaveBeenCalled();
  });

  it('caches an unavailable whitelist lookup for the uploader lifetime', async () => {
    appConfig.unregisteredUploaderUsernameWhitelist = ['unavailable'];
    const { service, telegramGateway } = createService();
    telegramGateway.resolvePublicUserOrBotUsername.mockRejectedValue(new Error('USERNAME_NOT_OCCUPIED'));

    await expect(process(service)).rejects.toThrow('Missing user_tu row for media item media-1');
    await expect(process(service)).rejects.toThrow('Missing user_tu row for media item media-1');

    expect(telegramGateway.connect).toHaveBeenCalledOnce();
    expect(telegramGateway.resolvePublicUserOrBotUsername).toHaveBeenCalledOnce();
  });

  it('resolves the configured whitelist once per uploader process', async () => {
    appConfig.unregisteredUploaderUsernameWhitelist = ['admin'];
    const firstItem = {
      id: 'media-1',
      chatId: -1003500431080n,
      messageId: 17n,
      senderId: 42n,
      status: MediaStatus.failed,
      localPath: '/tmp/first.jpg',
      date: new Date('2026-08-17T00:00:00.000Z'),
      mimeType: 'image/jpeg',
    };
    const secondItem = { ...firstItem, id: 'media-2', messageId: 18n, localPath: '/tmp/second.jpg' };
    const { service, prisma, telegramGateway } = createService({ item: firstItem, resolvedIds: [42n] });
    prisma.mediaItem.findUnique.mockResolvedValueOnce(firstItem).mockResolvedValueOnce(secondItem);

    await process(service, 'media-1');
    await process(service, 'media-2');

    expect(telegramGateway.connect).toHaveBeenCalledOnce();
    expect(telegramGateway.resolvePublicUserOrBotUsername).toHaveBeenCalledOnce();
  });

  it('cleans retained staging files for skipped media on the normal cleanup schedule', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'tele-autoupload-uploader-'));
    const localPath = path.join(directory, 'skipped.jpg');
    await fs.writeFile(localPath, 'staged');
    const { prisma, service } = createService();
    prisma.mediaItem.findMany.mockResolvedValue([{ id: 'media-skipped', localPath }]);

    try {
      await service.cleanupUploadedFiles();

      await expect(fs.access(localPath)).rejects.toThrow();
      expect(prisma.mediaItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [MediaStatus.uploaded, MediaStatus.skipped] },
        }),
      }));
      expect(prisma.mediaItem.update).toHaveBeenCalledWith({
        where: { id: 'media-skipped' },
        data: { localPath: null },
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
