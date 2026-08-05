import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const redis = {
    set: vi.fn(),
    eval: vi.fn(),
    zrem: vi.fn(),
    quit: vi.fn(),
  };
  const queueAdd = vi.fn();
  const queueClose = vi.fn();
  const queueEventsClose = vi.fn();
  const queues: Array<{ name: string; options: unknown }> = [];

  class Queue {
    constructor(name: string, options: unknown) {
      queues.push({ name, options });
    }

    add = queueAdd;
    close = queueClose;
  }

  class QueueEvents {
    close = queueEventsClose;
  }

  class Worker {}

  return {
    redis,
    queueAdd,
    queueClose,
    queueEventsClose,
    queues,
    Queue,
    QueueEvents,
    Worker,
  };
});

vi.mock('ioredis', () => ({
  default: class Redis {
    constructor() {
      return mocks.redis;
    }
  },
}));

vi.mock('bullmq', () => ({
  Queue: mocks.Queue,
  QueueEvents: mocks.QueueEvents,
  Worker: mocks.Worker,
}));

vi.mock('@shared/config/env', () => ({
  appConfig: {
    redisUrl: 'redis://queue-test',
    uploadMaxRetries: 8,
    uploadInitialBackoffMs: 10_000,
    uploadConcurrency: 6,
    uploadRateLimitPerSec: 10,
    downloadMaxRetries: 8,
    downloadInitialBackoffMs: 10_000,
    downloadConcurrency: 3,
    reconciliation: {
      telegramRequestsPerSec: 5,
      chatConcurrency: 3,
      requestSlotTtlMs: 120_000,
    },
  },
}));

import { QueueService } from '@shared/queue/queue.service';

describe('QueueService', () => {
  beforeEach(() => {
    mocks.redis.set.mockReset();
    mocks.redis.eval.mockReset();
    mocks.redis.zrem.mockReset();
    mocks.redis.quit.mockReset();
    mocks.queueAdd.mockReset();
    mocks.queueClose.mockReset();
    mocks.queueEventsClose.mockReset();
    mocks.queues.length = 0;
  });

  it('uses an ownership token for lease acquisition, renewal, and release', async () => {
    mocks.redis.set.mockResolvedValue('OK');
    mocks.redis.eval
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    const service = new QueueService();

    const lease = await service.acquireLease('tele-autoupload:reconciliation:lease', 54_000);

    expect(lease).toMatchObject({
      key: 'tele-autoupload:reconciliation:lease',
      ttlMs: 54_000,
      token: expect.any(String),
    });
    expect(mocks.redis.set).toHaveBeenCalledWith(
      'tele-autoupload:reconciliation:lease',
      lease?.token,
      'PX',
      54_000,
      'NX',
    );

    await expect(service.renewLease(lease!)).resolves.toBe(true);
    await service.releaseLease(lease!);

    const [renewScript, renewKeyCount, renewKey, renewToken, renewTtl] = mocks.redis.eval.mock.calls[0];
    expect(renewScript).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
    expect(renewScript).toContain("redis.call('PEXPIRE', KEYS[1], ARGV[2])");
    expect([renewKeyCount, renewKey, renewToken, renewTtl]).toEqual([
      1,
      'tele-autoupload:reconciliation:lease',
      lease?.token,
      '54000',
    ]);

    const [releaseScript, releaseKeyCount, releaseKey, releaseToken] = mocks.redis.eval.mock.calls[1];
    expect(releaseScript).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
    expect(releaseScript).toContain("redis.call('DEL', KEYS[1])");
    expect([releaseKeyCount, releaseKey, releaseToken]).toEqual([
      1,
      'tele-autoupload:reconciliation:lease',
      lease?.token,
    ]);
  });

  it('returns null when another reconciliation run holds the lease', async () => {
    mocks.redis.set.mockResolvedValue(null);
    const service = new QueueService();

    await expect(service.acquireLease('tele-autoupload:reconciliation:lease', 54_000)).resolves.toBeNull();
  });

  it('adds a deduplicated download job keyed by the media item', async () => {
    const queuedJob = { id: 'down:media-1' };
    mocks.queueAdd.mockResolvedValue(queuedJob);
    const service = new QueueService();
    const payload = { mediaItemId: 'media-1' };

    await expect(service.enqueueDownload(payload)).resolves.toBe(queuedJob);

    expect(mocks.queues).toContainEqual(expect.objectContaining({ name: 'media_download' }));
    expect(mocks.queueAdd).toHaveBeenCalledWith('down:media-1', payload, {
      deduplication: { id: 'media-1' },
    });
  });
});
