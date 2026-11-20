import { describe, expect, it, vi } from 'vitest';
import { Update } from 'grammy/types';
import { IngestorService } from '../apps/ingestor/src/ingestor.service';
import { MediaBackfillService } from '../apps/stats-api/src/media-backfill.service';
import { BotApiError, BotTelegramService, parseBotMedia } from '@shared/telegram/bot-telegram.service';
import { UploadSummaryService } from '@shared/services/upload-summary.service';
import { appConfig } from '@shared/config/env';

function update(id = 1, fileId = 'original'): Update {
  return { update_id: id, message: { message_id: 17, date: 1795046400,
    chat: { id: -1001234567890, type: 'supergroup', title: 'Source' },
    from: { id: 42, is_bot: false, first_name: 'Alice', username: 'Alice' },
    photo: [{ file_id: fileId, file_unique_id: `unique-${fileId}`, width: 100, height: 100 }],
  } };
}
function bot(prisma: Record<string, unknown> = {}, queue: Record<string, unknown> = {}) {
  return new BotTelegramService(prisma as never, queue as never, {} as never);
}

describe('durable bot reception and recovery', () => {
  it('selects one largest photo and preserves opaque album identifiers', () => {
    const event = update();
    event.message!.media_group_id = 'album:opaque';
    event.message!.photo!.push({ file_id: 'large', file_unique_id: 'large-id', width: 900, height: 900 });
    expect(parseBotMedia(event, 7n, 99n)).toMatchObject({ albumId: 'album:opaque', botId: 7n,
      sourceRevision: 99n, senderId: 42n, senderUsername: 'alice', media: [{ fileId: 'large', mediaIndex: 0 }] });
  });

  it('does not authorize anonymous placeholders or forwarded original senders', () => {
    const event = update();
    event.message!.sender_chat = { id: -1001234567890, type: 'supergroup', title: 'Source' };
    expect(parseBotMedia(event, 7n, 1n)?.senderId).toBeUndefined();
    expect(parseBotMedia(event, 7n, 1n)?.senderUsername).toBeUndefined();
  });

  it('blocks explicitly inactive chat aliases even when registered users exist', async () => {
    const prisma = { groupState: { findMany: vi.fn().mockResolvedValue([{ isActive: false }]) }, userTu: { count: vi.fn().mockResolvedValue(1) } };
    expect(await bot(prisma).isConfiguredChat(-1001234567890n)).toBe(false);
    expect(prisma.userTu.count).not.toHaveBeenCalled();
  });

  it('admits a source registered through user chat aliases', async () => {
    const prisma = { groupState: { findMany: vi.fn().mockResolvedValue([]) }, userTu: { count: vi.fn().mockResolvedValue(1) } };
    expect(await bot(prisma).isConfiguredChat(-1001234567890n)).toBe(true);
    expect(prisma.userTu.count).toHaveBeenCalledWith({ where: { telegramChatId: { in: expect.arrayContaining([-1001234567890n, -1234567890n]) } } });
  });

  it('commits inbox entries and the receipt offset in the same transaction without resetting redelivery status', async () => {
    const tx = { botUpdateInbox: { upsert: vi.fn().mockResolvedValue({}) }, botReceiverState: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ nextOffset: 2 }) } };
    const prisma = { $transaction: vi.fn((work) => work(tx)) };
    const service = bot(prisma);
    vi.spyOn(service, 'isConfiguredChat').mockResolvedValue(true);
    await expect(service.persistBatch(7n, 0, [update()], 'lease-token', 0)).resolves.toEqual({ nextOffset: 2 });
    expect(tx.botUpdateInbox.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {}, where: { botId_epoch_updateId: { botId: 7n, epoch: 0, updateId: 1 } } }));
    expect(tx.botReceiverState.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { botId: 7n, leaseToken: 'lease-token' }, data: expect.objectContaining({ nextOffset: 2 }) }));
    expect(tx.botReceiverState.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastUpdateAt: new Date(update().message!.date * 1000) }) }));
  });

  it('does not advance the receipt offset when inbox persistence fails', async () => {
    const tx = { botUpdateInbox: { upsert: vi.fn().mockRejectedValue(new Error('database unavailable')) }, botReceiverState: { updateMany: vi.fn() } };
    const service = bot({ $transaction: vi.fn((work) => work(tx)) });
    vi.spyOn(service, 'isConfiguredChat').mockResolvedValue(true);
    await expect(service.persistBatch(7n, 0, [update()], 'token', 0)).rejects.toThrow('database unavailable');
    expect(tx.botReceiverState.updateMany).not.toHaveBeenCalled();
  });

  it('acknowledges ordinary source text without retaining unrelated conversation bodies', async () => {
    const event = update();
    delete event.message!.photo;
    event.message!.text = 'ordinary group conversation';
    const tx = { botUpdateInbox: { upsert: vi.fn() }, botReceiverState: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ nextOffset: 2 }) } };
    const service = bot({ $transaction: vi.fn((work) => work(tx)) });
    await service.persistBatch(7n, 0, [event], 'token', 0);
    expect(tx.botUpdateInbox.upsert).not.toHaveBeenCalled();
    expect(tx.botReceiverState.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ nextOffset: 2 }) }));
  });

  it('rolls back intake when the persisted receiver ownership token changed', async () => {
    const tx = { botUpdateInbox: { upsert: vi.fn().mockResolvedValue({}) }, botReceiverState: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const service = bot({ $transaction: vi.fn((work) => work(tx)) });
    vi.spyOn(service, 'isConfiguredChat').mockResolvedValue(true);
    await expect(service.persistBatch(7n, 0, [update()], 'old-token', 0)).rejects.toThrow('ownership lost');
  });

  it('retains unknown uploaders for explicit replay without blocking following receipts', async () => {
    const prisma = { botUpdateInbox: { findMany: vi.fn().mockResolvedValue([
      { id: 1n, payload: update(), attempts: 0 }, { id: 2n, payload: update(2), attempts: 0 }]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const service = bot(prisma);
    vi.spyOn(service, 'isConfiguredChat').mockResolvedValue(true);
    const handler = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await service.processPending(handler, 7n, () => true);
    expect(prisma.botUpdateInbox.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ id: 1n }), data: expect.objectContaining({ status: 'unmatched' }) }));
    expect(prisma.botUpdateInbox.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ status: 'processed' }) }));
  });

  it('schedules failed handoffs for retry and stops dispatch after lease loss', async () => {
    const prisma = { botUpdateInbox: { findMany: vi.fn().mockResolvedValue([{ id: 1n, payload: update(), attempts: 0 }]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const service = bot(prisma);
    vi.spyOn(service, 'isConfiguredChat').mockResolvedValue(true);
    const handler = vi.fn().mockRejectedValue(new Error('Redis unavailable'));
    await service.processPending(handler, 7n, () => true);
    expect(prisma.botUpdateInbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed', nextAttemptAt: expect.any(Date) }) }));
    handler.mockClear();
    await service.processPending(handler, 7n, () => false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not overwrite a successor receipt outcome after its handler loses ownership', async () => {
    const prisma = { botUpdateInbox: { findMany: vi.fn().mockResolvedValue([{ id: 1n, status: 'pending', payload: update(), attempts: 0 }]), updateMany: vi.fn() } };
    const service = bot(prisma);
    vi.spyOn(service, 'isConfiguredChat').mockResolvedValue(true);
    let owned = true;
    await service.processPending(async () => { owned = false; throw new Error('old handler failed'); }, 7n, () => owned);
    expect(prisma.botUpdateInbox.updateMany).not.toHaveBeenCalled();
  });

  it('ignores membership losses from retired sources when reporting receiver readiness', async () => {
    const prisma = { botReceiverState: { findUnique: vi.fn().mockResolvedValue({ lastSuccessAt: new Date(), lastError: null }) },
      botChatCapture: { findMany: vi.fn().mockResolvedValue([{ chatId: -1001234567890n }]) } };
    const service = bot(prisma);
    vi.spyOn(service, 'call').mockResolvedValue({ id: 7 });
    vi.spyOn(service, 'isConfiguredChat').mockResolvedValue(false);
    expect(await service.readiness()).toMatchObject({ ready: true, api_ready: true });
    vi.mocked(service.isConfiguredChat).mockResolvedValue(true);
    expect(await service.readiness()).toMatchObject({ ready: false, error: 'Bot has left a configured source chat' });
  });

  it('abandons a polled batch after losing the receiver lease', async () => {
    const state = { nextOffset: 0, epoch: 0, lastUpdateAt: new Date() };
    const prisma = { botReceiverState: { upsert: vi.fn().mockResolvedValue(state), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const queue = { acquireLease: vi.fn().mockResolvedValue({ key: 'receiver', token: 'token', ttlMs: 60000 }), renewLease: vi.fn().mockResolvedValue(false), releaseLease: vi.fn() };
    const service = bot(prisma, queue);
    (service as any).stopped = false;
    queue.releaseLease.mockImplementation(async () => { (service as any).stopped = true; });
    vi.spyOn(service, 'getMe').mockResolvedValue({ id: 7 } as never);
    vi.spyOn(service as any, 'recordCaptureStarts').mockResolvedValue(undefined);
    vi.spyOn(service, 'call').mockResolvedValue([update()]);
    const persist = vi.spyOn(service, 'persistBatch');
    await (service as any).receive();
    expect(persist).not.toHaveBeenCalled();
    expect(queue.releaseLease).toHaveBeenCalledOnce();
  });

  it('resets a stale offset using last nonempty receipt time despite recent empty polls', async () => {
    const oldState = { nextOffset: 9000, epoch: 0, lastUpdateAt: new Date(Date.now() - 8 * 86400_000), lastSuccessAt: new Date() };
    const prisma = { botReceiverState: { upsert: vi.fn().mockResolvedValue(oldState), update: vi.fn().mockResolvedValue({ ...oldState, nextOffset: 0, epoch: 1 }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const queue = { acquireLease: vi.fn().mockResolvedValue({ key: 'receiver', token: 'token', ttlMs: 60000 }), renewLease: vi.fn().mockResolvedValue(false), releaseLease: vi.fn() };
    const service = bot(prisma, queue);
    (service as any).stopped = false;
    queue.releaseLease.mockImplementation(async () => { (service as any).stopped = true; });
    vi.spyOn(service, 'getMe').mockResolvedValue({ id: 7 } as never);
    vi.spyOn(service as any, 'recordCaptureStarts').mockResolvedValue(undefined);
    vi.spyOn(service, 'call').mockResolvedValue([]);
    await (service as any).receive();
    expect(prisma.botReceiverState.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { botId: 7n, leaseToken: 'token' }, data: expect.objectContaining({ nextOffset: 0, epoch: { increment: 1 } }) }));
    expect(service.call).toHaveBeenCalledWith('getUpdates', expect.objectContaining({ offset: 0 }), expect.any(AbortSignal));
  });

  it('resets idle offsets while the same receiver keeps polling across the weekly boundary', async () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      const state = { nextOffset: 9000, epoch: 0, lastUpdateAt: new Date(now) };
      const prisma = { botReceiverState: { upsert: vi.fn().mockResolvedValue(state), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
      const queue = { acquireLease: vi.fn().mockResolvedValue({ key: 'receiver', token: 'token', ttlMs: 60000 }),
        renewLease: vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false), releaseLease: vi.fn() };
      const service = bot(prisma, queue);
      (service as any).stopped = false;
      queue.releaseLease.mockImplementation(async () => { (service as any).stopped = true; });
      vi.spyOn(service, 'getMe').mockResolvedValue({ id: 7 } as never);
      vi.spyOn(service as any, 'recordCaptureStarts').mockResolvedValue(undefined);
      vi.spyOn(service, 'persistBatch').mockResolvedValue(state as never);
      vi.spyOn(service, 'call').mockImplementationOnce(async () => { vi.setSystemTime(now + 7 * 86400_000 - 30_000); return [] as never; }).mockResolvedValue([]);
      await (service as any).receive();
      expect(service.call).toHaveBeenNthCalledWith(2, 'getUpdates', expect.objectContaining({ offset: 0 }), expect.any(AbortSignal));
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts only the bot receiver and keeps recovery free of history RPCs', async () => {
    const media = { recoverStaleMediaItems: vi.fn().mockResolvedValue(0) };
    const receiver = { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) };
    const queue = { acquireLease: vi.fn().mockResolvedValue({ token: 'token' }), releaseLease: vi.fn().mockResolvedValue(undefined), renewLease: vi.fn() };
    const service = new IngestorService(media as never, {} as never, {} as never, queue as never, receiver as never);
    await service.onModuleInit();
    await service.reconcile();
    await service.onModuleDestroy();
    expect(receiver.start).toHaveBeenCalledOnce();
    expect(media.recoverStaleMediaItems).toHaveBeenCalledWith(expect.objectContaining({ shouldContinue: expect.any(Function) }));
    expect(receiver.stop).toHaveBeenCalledOnce();
  });

  it('does no recovery work when another ingestor owns the lease', async () => {
    const media = { recoverStaleMediaItems: vi.fn() };
    const service = new IngestorService(media as never, {} as never, {} as never, { acquireLease: vi.fn().mockResolvedValue(null) } as never, {} as never);
    await service.reconcile();
    expect(media.recoverStaleMediaItems).not.toHaveBeenCalled();
  });

  it('never restores recovery ownership from an older delayed renewal response', async () => {
    vi.useFakeTimers();
    const originalRenewal = appConfig.reconciliation.leaseRenewalMs;
    let finish: ((value: number) => void) | undefined;
    let run: Promise<void> | undefined;
    try {
      appConfig.reconciliation.leaseRenewalMs = 1;
      let shouldContinue: (() => boolean) | undefined;
      let first: ((value: boolean) => void) | undefined;
      let second: ((value: boolean) => void) | undefined;
      const queue = { acquireLease: vi.fn().mockResolvedValue({ token: 'token' }), releaseLease: vi.fn(),
        renewLease: vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { first = resolve; }))
          .mockImplementationOnce(() => new Promise<boolean>((resolve) => { second = resolve; })) };
      const media = { recoverStaleMediaItems: vi.fn((options) => {
        shouldContinue = options.shouldContinue;
        return new Promise<number>((resolve) => { finish = resolve; });
      }) };
      const service = new IngestorService(media as never, {} as never, {} as never, queue as never, {} as never);
      run = service.reconcile();
      await vi.advanceTimersByTimeAsync(2);
      second!(false);
      await Promise.resolve();
      expect(shouldContinue!()).toBe(false);
      first!(true);
      await Promise.resolve();
      expect(shouldContinue!()).toBe(false);
    } finally {
      finish?.(0);
      await run;
      appConfig.reconciliation.leaseRenewalMs = originalRenewal;
      vi.useRealTimers();
    }
  });

  it('escapes summary fields and splits large reports into valid plain-text messages', async () => {
    const summary = new UploadSummaryService({} as never);
    const row = { tu_name: '<Alice> & Bob', telegram_username: 'alice', date: '2026-11-20', media: { image: 1, video: 0, total: 1 }, status_uploaded: { success: 1, failed: 0 } };
    expect(summary.formatSummary([row])).toContain('&lt;Alice&gt; &amp; Bob');
    const service = bot();
    vi.spyOn(service, 'call').mockResolvedValue({});
    await service.sendSummary(42, summary.formatSummary([{ ...row, tu_name: '😀'.repeat(2500) }]));
    expect(vi.mocked(service.call).mock.calls.length).toBeGreaterThan(1);
    for (const [, parameters] of vi.mocked(service.call).mock.calls) {
      const text = String(parameters!.text);
      expect(text.length).toBeLessThanOrEqual(4000);
      expect(/[\uD800-\uDBFF]$/.test(text)).toBe(false);
      expect(parameters).not.toHaveProperty('parse_mode');
    }
  });

  it('does not endlessly retry a summary rejected by a blocked recipient', async () => {
    const event = update();
    event.message!.text = '/today';
    const prisma = { botUpdateInbox: { findMany: vi.fn().mockResolvedValue([{ id: 1n, status: 'pending', attempts: 0, payload: event }]), updateMany: vi.fn() } };
    const service = new BotTelegramService(prisma as never, {} as never, { today: vi.fn().mockResolvedValue([]), formatSummary: vi.fn().mockReturnValue('No media') } as never);
    vi.spyOn(service, 'isConfiguredChat').mockResolvedValue(true);
    vi.spyOn(service, 'call').mockRejectedValue(new BotApiError(403));
    await service.processPending(async () => true, 7n, () => true);
    expect(prisma.botUpdateInbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ignored', lastError: 'Bot command delivery was rejected' }) }));
  });
});

describe('captured media replay', () => {
  function replayService() {
    const user = { id: 1, tuId: 'tu1', tuName: 'Alice', telegramUserId: 42n, telegramChatId: -1001234567890n, username: 'alice' };
    const prisma = { userTu: { findMany: vi.fn().mockResolvedValue([user]) },
      botUpdateInbox: { findMany: vi.fn().mockResolvedValue([{ id: 1n, payload: update() }, { id: 2n, payload: update(2, 'edited') }]) },
      botChatCapture: { findFirst: vi.fn().mockResolvedValue({ startedAt: new Date('2026-11-19T00:00:00Z') }) },
      mediaItem: { findUnique: vi.fn().mockResolvedValue(null) } };
    const media = { processIncomingMessage: vi.fn().mockResolvedValue(undefined) };
    const receiver = { getMe: vi.fn().mockResolvedValue({ id: 7 }), isConfiguredChat: vi.fn().mockResolvedValue(true) };
    return { service: new MediaBackfillService(prisma as never, media as never, receiver as never), media, prisma };
  }
  const input = { chatId: -1001234567890n, fromDate: new Date('2026-11-18T00:00:00Z'), toDate: new Date('2026-11-20T00:00:00Z'), dryRun: true };

  it('previews latest captured edits only and reports incomplete coverage without writing media', async () => {
    const { service, media } = replayService();
    const result = await service.backfill(input);
    expect(result).toMatchObject({ source: 'bot_inbox', coverage: 'partial', scanned_messages: 1, queued_media: 1 });
    expect(media.processIncomingMessage).not.toHaveBeenCalled();
  });

  it('replays the newest receipt using the normal media lifecycle without moving history cursors', async () => {
    const { service, media } = replayService();
    await service.backfill({ ...input, dryRun: false });
    expect(media.processIncomingMessage).toHaveBeenCalledWith(expect.objectContaining({ sourceRevision: 2n, media: [expect.objectContaining({ fileId: 'edited' })] }), expect.any(Object), { manageGroupCursor: false });
  });

  it('refreshes a queued slot from a newer captured edit even when it already exists', async () => {
    const { service, media, prisma } = replayService();
    prisma.mediaItem.findUnique.mockResolvedValue({ status: 'queued', sourceRevision: 1n } as never);
    await service.backfill({ ...input, dryRun: false });
    expect(media.processIncomingMessage).toHaveBeenCalledWith(expect.objectContaining({ sourceRevision: 2n }), expect.any(Object), { manageGroupCursor: false });
  });
});
