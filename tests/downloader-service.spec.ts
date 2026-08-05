import { describe, expect, it, vi } from 'vitest';
import { DownloaderService } from '../apps/worker-downloader/src/downloader.service';

vi.mock('@shared/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('DownloaderService', () => {
  it('connects without updates, wires download work, and shuts down cleanly', async () => {
    const context = { requestGate: {} };
    const worker = {
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    let processor: ((job: { data: { mediaItemId: string } }) => Promise<void>) | undefined;
    const queueService = {
      createDownloadWorker: vi.fn((callback) => {
        processor = callback;
        return worker;
      }),
    };
    const mediaService = {
      downloadMediaItem: vi.fn().mockResolvedValue(undefined),
    };
    const telegramGateway = {
      connect: vi.fn().mockResolvedValue(undefined),
      createReconciliationContext: vi.fn().mockReturnValue(context),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const service = new DownloaderService(
      queueService as never,
      mediaService as never,
      telegramGateway as never,
    );

    await service.onModuleInit();

    expect(telegramGateway.connect).toHaveBeenCalledWith({ withUpdates: false });
    expect(telegramGateway.createReconciliationContext).toHaveBeenCalledOnce();
    expect(queueService.createDownloadWorker).toHaveBeenCalledOnce();
    expect(worker.on).toHaveBeenCalledWith('failed', expect.any(Function));

    await processor?.({ data: { mediaItemId: 'media-1' } });

    expect(mediaService.downloadMediaItem).toHaveBeenCalledWith('media-1', context);

    await service.onModuleDestroy();

    expect(worker.close).toHaveBeenCalledOnce();
    expect(telegramGateway.disconnect).toHaveBeenCalledOnce();
  });
});
