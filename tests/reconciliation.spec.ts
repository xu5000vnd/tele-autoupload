import { describe, expect, it, vi } from 'vitest';
import { ChatType } from '@prisma/client';
import { IngestorService } from '../apps/ingestor/src/ingestor.service';
import { rewindMessageCursor } from '@shared/utils/reconciliation';

describe('reconciliation cursor', () => {
  it('rewinds by the configured lookback window', () => {
    expect(rewindMessageCursor(1000n, 50n)).toBe(950n);
  });

  it('does not rewind below zero', () => {
    expect(rewindMessageCursor(50n, 50n)).toBe(0n);
  });

  it('keeps the current cursor when lookback is disabled', () => {
    expect(rewindMessageCursor(1000n, 0n)).toBe(1000n);
  });

  it('keeps bounded workers alive after an individual chat fails', async () => {
    const service = new IngestorService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const completed: number[] = [];
    let activeWorkers = 0;
    let peakWorkers = 0;

    await (service as any).runBounded(
      [1, 2, 3, 4],
      2,
      async (chat: number) => {
        activeWorkers += 1;
        peakWorkers = Math.max(peakWorkers, activeWorkers);
        try {
          await Promise.resolve();
          if (chat === 2) {
            throw new Error('history request failed');
          }
          completed.push(chat);
        } finally {
          activeWorkers -= 1;
        }
      },
      () => true,
    );

    expect(peakWorkers).toBeLessThanOrEqual(2);
    expect(completed).toEqual(expect.arrayContaining([1, 3, 4]));
  });

  it('does not checkpoint a page after its reconciliation lease or deadline is lost', async () => {
    const prisma = {
      groupState: { upsert: vi.fn() },
      $executeRaw: vi.fn(),
    };
    const service = new IngestorService(
      {
        fetchHistoryPageAfter: vi.fn().mockResolvedValue({
          messages: [],
          maxSeenMessageId: 15n,
          rawMessageCount: 1,
          hasMore: false,
        }),
      } as never,
      {} as never,
      prisma as never,
      {} as never,
      {} as never,
    );
    let checks = 0;

    const result = await (service as any).reconcileGroup(
      {
        chatId: -1003839814010n,
        title: 'Monthly Media',
        chatType: ChatType.supergroup,
        lastMessageId: 10n,
        lastReconciledAt: new Date(),
      },
      { bySender: new Map(), byUsername: new Map() },
      {},
      600_000,
      () => ++checks < 3,
    );

    expect(result.deferred).toBe(true);
    expect(prisma.groupState.upsert).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('folds Telegram chat aliases and rotates capped candidate cohorts fairly', () => {
    const service = new IngestorService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const canonicalChatId = -1003839814010n;
    const legacyChatId = -3839814010n;
    const groups = (service as any).buildReconciliationGroups(
      [
        {
          chatId: canonicalChatId,
          title: 'Canonical',
          chatType: ChatType.supergroup,
          lastMessageId: 10n,
          lastReconciledAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          chatId: legacyChatId,
          title: 'Legacy',
          chatType: ChatType.supergroup,
          lastMessageId: 20n,
          lastReconciledAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      chatId: canonicalChatId,
      lastMessageId: 20n,
      lastReconciledAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    const dueGroups = Array.from({ length: 501 }, (_, index) => ({
      chatId: BigInt(index + 1),
      title: `chat_${index + 1}`,
      chatType: ChatType.group,
      lastMessageId: 0n,
      lastReconciledAt: null,
    }));
    const firstCohort = (service as any).selectReconciliationCandidates(dueGroups, 0, 600_000);
    const secondCohort = (service as any).selectReconciliationCandidates(dueGroups, 600_000, 600_000);

    expect(firstCohort).toHaveLength(500);
    expect(secondCohort).toHaveLength(500);
    expect(secondCohort.some((group: { chatId: bigint }) => group.chatId === 501n)).toBe(true);
  });

  it('runs a chat once per schedule window instead of every other tick', () => {
    const service = new IngestorService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const group = {
      chatId: 1n,
      title: 'chat_1',
      chatType: ChatType.group,
      lastMessageId: 0n,
      lastReconciledAt: new Date(1_199_999),
    };

    expect((service as any).selectReconciliationCandidates([group], 1_199_999, 600_000)).toEqual([]);
    expect((service as any).selectReconciliationCandidates([group], 1_200_000, 600_000)).toHaveLength(1);
  });

  it('does no work when another ingestor owns the reconciliation lease', async () => {
    const mediaService = { recoverStaleMediaItems: vi.fn() };
    const prisma = {
      groupState: { findMany: vi.fn() },
      userTu: { findMany: vi.fn() },
    };
    const queueService = { acquireLease: vi.fn().mockResolvedValue(null) };
    const service = new IngestorService(
      {} as never,
      mediaService as never,
      prisma as never,
      {} as never,
      queueService as never,
    );

    await service.reconcile();

    expect(queueService.acquireLease).toHaveBeenCalledOnce();
    expect(mediaService.recoverStaleMediaItems).not.toHaveBeenCalled();
    expect(prisma.groupState.findMany).not.toHaveBeenCalled();
  });

  it('removes stale authorization aliases after an identity is back-filled', () => {
    const service = new IngestorService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const previous = {
      id: 1,
      tuId: 'tu-1',
      tuName: 'Uploader',
      telegramUserId: 10n,
      telegramChatId: -1003839814010n,
      username: 'old_name',
    };
    const updated = { ...previous, telegramUserId: 20n, username: 'new_name' };
    const authorization = (service as any).buildReconciliationAuthorization([previous]);

    (service as any).unindexAuthorizedUser(authorization, previous);
    (service as any).indexAuthorizedUser(authorization, updated);

    expect((service as any).matchAuthorizedUser(
      { chatId: previous.telegramChatId, senderId: 10n },
      [previous.telegramChatId],
      authorization,
    )).toBeNull();
    expect((service as any).matchAuthorizedUser(
      { chatId: previous.telegramChatId, senderId: 20n },
      [previous.telegramChatId],
      authorization,
    )).toBe(updated);
  });
});
