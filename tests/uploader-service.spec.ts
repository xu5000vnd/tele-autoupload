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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      userTu: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      botUpdateInbox: { findMany: vi.fn().mockResolvedValue((input.resolvedIds ?? [42n]).map((senderId) => ({ senderId }))) },
      groupState: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const eventLogService = { log: vi.fn().mockResolvedValue(undefined) };
    const strategy = { ensureDestination: vi.fn(), upload: vi.fn() };
    const botTelegram = { getMe: vi.fn().mockResolvedValue({ id: 7, username: 'upload_bot' }) };
    const service = new UploaderService(
      { createUploadWorker: vi.fn() } as never,
      prisma as never,
      eventLogService as never,
      { getStrategy: vi.fn().mockReturnValue(strategy) } as never,
      { rememberDateFolder: vi.fn() } as never,
      { notify: vi.fn() } as never,
      botTelegram as never,
    );

    return { eventLogService, prisma, service, strategy, botTelegram };
  }

  async function process(service: UploaderService, mediaItemId = 'media-1'): Promise<void> {
    await (service as any).processJob({
      data: { mediaItemId, localPath: '/tmp/staged.jpg' },
      attemptsMade: 0,
    });
  }

  it('skips missing mappings using bot-scoped observed sender identities', async () => {
    appConfig.unregisteredUploaderUsernameWhitelist = ['admin_bot'];
    const { eventLogService, prisma, service, strategy, botTelegram } = createService({
      resolvedIds: [42n],
    });

    await process(service);

    expect(botTelegram.getMe).toHaveBeenCalledOnce();
    expect(prisma.botUpdateInbox.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ botId: 7n, senderUsername: { in: ['admin_bot'] } }) }));
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
    const { eventLogService, prisma, service, botTelegram } = createService({
      resolvedIds: [99n],
    });

    await expect(process(service)).rejects.toThrow('Missing user_tu row for media item media-1');

    expect(botTelegram.getMe).toHaveBeenCalled();
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
    const { service, botTelegram } = createService();

    await expect(process(service)).rejects.toThrow('Missing user_tu row for media item media-1');

    expect(botTelegram.getMe).not.toHaveBeenCalled();
  });

  it('does not upload an old queued path after a bot edit invalidates staging', async () => {
    const { service, prisma, strategy } = createService({ item: { id: 'media-1', transport: 'bot', status: MediaStatus.queued, localPath: null } });
    await process(service);
    expect(prisma.mediaItem.updateMany).not.toHaveBeenCalled();
    expect(strategy.upload).not.toHaveBeenCalled();
  });

  it('abandons a bot upload when an edit changes the slot before its claim', async () => {
    const { service, prisma, strategy } = createService({ item: { id: 'media-1', senderId: 42n, chatId: -1001234567890n,
      transport: 'bot', sourceRevision: 1n, status: MediaStatus.downloaded, localPath: '/tmp/staged.jpg' } });
    prisma.userTu.findFirst.mockResolvedValue({ id: 1, tuId: 'tu1', path: 'fixture', tuName: 'Fixture' } as never);
    vi.spyOn(service as any, 'resolveDesktopUserPath').mockResolvedValue('fixture');
    prisma.mediaItem.updateMany.mockResolvedValue({ count: 0 });
    await process(service);
    expect(strategy.upload).not.toHaveBeenCalled();
  });

  it('retries a failed bot upload using its retained staged artifact', async () => {
    const { service, prisma, strategy } = createService({ item: { id: 'media-1', senderId: 42n, chatId: -1001234567890n, messageId: 17n, date: new Date(),
      transport: 'bot', sourceRevision: 1n, status: MediaStatus.failed, localPath: '/tmp/staged.jpg' } });
    prisma.userTu.findFirst.mockResolvedValue({ id: 1, tuId: 'tu1', path: 'fixture', tuName: 'Fixture' } as never);
    vi.spyOn(service as any, 'resolveDesktopUserPath').mockResolvedValue('fixture');
    strategy.ensureDestination.mockResolvedValue({ folderId: 'destination', folderPath: '/tmp/destination' });
    strategy.upload.mockRejectedValue(new Error('retry reached upload transport'));
    await expect(process(service)).rejects.toThrow('retry reached upload transport');
    expect(strategy.upload).toHaveBeenCalledOnce();
  });

  it('fails closed when the configured whitelist cannot be fully resolved', async () => {
    appConfig.unregisteredUploaderUsernameWhitelist = ['admin', 'unavailable'];
    const { prisma, service, botTelegram } = createService({ resolvedIds: [42n] });
    botTelegram.getMe.mockRejectedValue(new Error('Local API unavailable'));

    await expect(process(service)).rejects.toThrow('Missing user_tu row for media item media-1');

    expect(prisma.mediaItem.update).not.toHaveBeenCalled();
  });

  it('retries an unavailable bot identity instead of caching failure', async () => {
    appConfig.unregisteredUploaderUsernameWhitelist = ['unavailable'];
    const { service, botTelegram } = createService();
    botTelegram.getMe.mockRejectedValue(new Error('Local API unavailable'));

    await expect(process(service)).rejects.toThrow('Missing user_tu row for media item media-1');
    await expect(process(service)).rejects.toThrow('Missing user_tu row for media item media-1');

    expect(botTelegram.getMe).toHaveBeenCalledTimes(2);
  });

  it('refreshes observed whitelist identities for following jobs', async () => {
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
    const { service, prisma, botTelegram } = createService({ item: firstItem, resolvedIds: [42n] });
    prisma.mediaItem.findUnique.mockResolvedValueOnce(firstItem).mockResolvedValueOnce(secondItem);

    await process(service, 'media-1');
    await process(service, 'media-2');

    expect(botTelegram.getMe).toHaveBeenCalledTimes(2);
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
