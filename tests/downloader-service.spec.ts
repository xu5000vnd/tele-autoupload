import { describe, expect, it, vi } from 'vitest';
import { DownloaderService } from '../apps/worker-downloader/src/downloader.service';

vi.mock('@shared/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('DownloaderService', () => {
  it('runs bot download work without an account connection and shuts down cleanly', async () => {
    const worker = {
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    let processor: ((job: {
      data: { mediaItemId: string };
      attemptsMade: number;
      opts: { attempts?: number };
    }) => Promise<void>) | undefined;
    const queueService = {
      createDownloadWorker: vi.fn((callback) => {
        processor = callback;
        return worker;
      }),
    };
    const mediaService = {
      downloadMediaItem: vi.fn().mockResolvedValue(undefined),
    };
    const service = new DownloaderService(
      queueService as never,
      mediaService as never,
    );

    await service.onModuleInit();

    expect(queueService.createDownloadWorker).toHaveBeenCalledOnce();
    expect(worker.on).toHaveBeenCalledWith('failed', expect.any(Function));

    await processor?.({
      data: { mediaItemId: 'media-1' },
      attemptsMade: 2,
      opts: { attempts: 3 },
    });

    expect(mediaService.downloadMediaItem).toHaveBeenCalledWith('media-1', {
      attemptsMade: 2,
      maxAttempts: 3,
    });

    await service.onModuleDestroy();

    expect(worker.close).toHaveBeenCalledOnce();
  });
});
