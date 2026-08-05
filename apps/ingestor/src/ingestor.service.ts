import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { appConfig } from '@shared/config/env';
import { MediaService } from '@shared/services/media.service';
import { TelegramNotifierService } from '@shared/services/telegram-notifier.service';
import { QueueService, RedisLease } from '@shared/queue/queue.service';
import { TelegramGateway, TelegramReconciliationContext } from '@shared/telegram/telegram-gateway';
import { PrismaService } from '@shared/db/prisma.service';
import { IncomingMessage } from '@shared/types/telegram';
import { logger } from '@shared/utils/logger';
import { rewindMessageCursor } from '@shared/utils/reconciliation';
import { ChatType, Prisma, UserTu, UserTuStatus } from '@prisma/client';

type HandleIncomingOptions = {
  notifyUnknownUploader?: boolean;
  authorization?: ReconciliationAuthorization;
  manageGroupCursor?: boolean;
  throwOnProcessingError?: boolean;
};

type AllowedUser = Pick<UserTu, 'id' | 'tuId' | 'tuName' | 'telegramUserId' | 'telegramChatId' | 'username'>;

type ReconciliationAuthorization = {
  bySender: Map<string, AllowedUser>;
  byUsername: Map<string, AllowedUser>;
};

type ReconciliationGroup = {
  chatId: bigint;
  title: string;
  chatType: ChatType;
  lastMessageId: bigint;
  lastReconciledAt: Date | null;
};

type ReconciliationMetrics = {
  chatsSelected: number;
  chatsCompleted: number;
  chatsDeferred: number;
  historyPages: number;
  rawMessages: number;
  mediaMessages: number;
  historyFailures: number;
};

type ReconciliationGroupResult = {
  completed: boolean;
  deferred: boolean;
  historyPages: number;
  rawMessages: number;
  mediaMessages: number;
  historyFailed: boolean;
};

const RECONCILIATION_LEASE_KEY = 'tele-autoupload:reconciliation:lease';

@Injectable()
export class IngestorService implements OnModuleInit, OnModuleDestroy {
  private reconnecting = false;
  private readonly unknownUserNotifyCooldownMs = 10 * 60 * 1000;
  private readonly unknownUserLastNotifiedAt = new Map<string, number>();

  constructor(
    private readonly telegramGateway: TelegramGateway,
    private readonly mediaService: MediaService,
    private readonly prisma: PrismaService,
    private readonly telegramNotifier: TelegramNotifierService,
    private readonly queueService: QueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.telegramGateway.connect();
    this.telegramGateway.onNewMessage(async (msg) => this.handleIncoming(msg));
    this.telegramGateway.onEditedMessage(async (msg) => this.handleIncoming(msg));
    logger.info('ingestor started');
  }

  async onModuleDestroy(): Promise<void> {
    await this.telegramGateway.disconnect();
  }

  private async handleIncoming(message: IncomingMessage, options: HandleIncomingOptions = {}): Promise<void> {
    logger.debug(
      {
        chatId: message.chatId.toString(),
        messageId: message.messageId.toString(),
        groupedId: message.groupedId?.toString(),
        senderId: message.senderId?.toString(),
        senderUsername: message.senderUsername,
        mediaCount: message.media.length,
      },
      'handleIncoming invoked',
    );
    if (!message.senderId && !message.senderUsername) {
      return;
    }

    const chatIdsForLookup = this.chatIdLookupAliases(message.chatId);

    const allowedUser = options.authorization
      ? this.matchAuthorizedUser(message, chatIdsForLookup, options.authorization)
      : await this.findAuthorizedUser(message, chatIdsForLookup);

    if (!allowedUser) {
      logger.info(
        {
          senderId: message.senderId?.toString(),
          senderUsername: message.senderUsername,
          chatId: message.chatId.toString(),
          chatIdAliases: chatIdsForLookup.map((id) => id.toString()),
          chatType: message.chatType,
          chatTitle: message.chatTitle,
          messageId: message.messageId.toString(),
          groupedId: message.groupedId?.toString(),
          mediaCount: message.media.length,
        },
        'message from unregistered or inactive user — skipped',
      );
      if (options.notifyUnknownUploader ?? true) {
        await this.notifyUnknownUploader(message);
      }
      return;
    }

    const patchData: Prisma.UserTuUpdateInput = {};
    // If the record was matched by username but the stored telegram_user_id doesn't match
    // the actual sender, back-fill it so future lookups use the faster numeric ID.
    if (message.senderId && allowedUser.telegramUserId !== message.senderId) {
      patchData.telegramUserId = message.senderId;
    }
    if (message.senderUsername && allowedUser.username !== message.senderUsername) {
      patchData.username = message.senderUsername;
    }
    // Auto-normalize old chat IDs to canonical bot-api format (-100...).
    if (allowedUser.telegramChatId !== message.chatId) {
      patchData.telegramChatId = message.chatId;
    }
    if (Object.keys(patchData).length) {
      const previousIdentity = {
        telegramUserId: allowedUser.telegramUserId,
        telegramChatId: allowedUser.telegramChatId,
        username: allowedUser.username,
      };
      const updatedUser = await this.prisma.userTu.update({
        where: { id: allowedUser.id },
        data: {
          ...patchData,
          updatedAt: new Date(),
        },
      });
      Object.assign(allowedUser, {
        telegramUserId: updatedUser.telegramUserId,
        telegramChatId: updatedUser.telegramChatId,
        username: updatedUser.username,
      });
      if (options.authorization) {
        this.unindexAuthorizedUser(options.authorization, previousIdentity);
        this.indexAuthorizedUser(options.authorization, allowedUser);
      }
      logger.info(
        {
          userTuId: allowedUser.id,
          tuId: allowedUser.tuId,
          tuName: allowedUser.tuName,
          oldTelegramUserId: previousIdentity.telegramUserId.toString(),
          newTelegramUserId: message.senderId?.toString(),
          oldTelegramChatId: previousIdentity.telegramChatId.toString(),
          newTelegramChatId: message.chatId.toString(),
          oldTelegramUsername: previousIdentity.username,
          newTelegramUsername: message.senderUsername,
        },
        'back-filled user_tu identifiers from incoming message',
      );
    }

    logger.info(
      {
        userTuId: allowedUser.id,
        tuId: allowedUser.tuId,
        tuName: allowedUser.tuName,
        chatId: message.chatId.toString(),
        chatIdAliases: chatIdsForLookup.map((id) => id.toString()),
        chatType: message.chatType,
        chatTitle: message.chatTitle,
        senderId: message.senderId?.toString(),
        senderUsername: message.senderUsername,
        messageId: message.messageId.toString(),
        groupedId: message.groupedId?.toString(),
        mediaCount: message.media.length,
      },
      'matched incoming media message to active uploader',
    );

    try {
      await this.mediaService.processIncomingMessage(
        message,
        {
          userTuId: allowedUser.id,
          tuId: allowedUser.tuId,
          tuName: allowedUser.tuName,
        },
        { manageGroupCursor: options.manageGroupCursor },
      );
    } catch (error) {
      logger.error({ err: error, chatId: message.chatId.toString(), messageId: message.messageId.toString() }, 'failed to process incoming message');
      if (options.throwOnProcessingError) {
        throw error;
      }
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcile(): Promise<void> {
    const intervalMs = appConfig.reconciliationIntervalMin * 60_000;
    const startedAt = Date.now();
    const deadlineAt = startedAt + appConfig.reconciliation.runBudgetMs;
    const lease = await this.queueService.acquireLease(
      RECONCILIATION_LEASE_KEY,
      appConfig.reconciliation.leaseTtlMs,
    );
    if (!lease) {
      logger.info({ leaseKey: RECONCILIATION_LEASE_KEY }, 'reconciliation skipped because another run owns the lease');
      return;
    }

    let leaseLost = false;
    const metrics: ReconciliationMetrics = {
      chatsSelected: 0,
      chatsCompleted: 0,
      chatsDeferred: 0,
      historyPages: 0,
      rawMessages: 0,
      mediaMessages: 0,
      historyFailures: 0,
    };
    const renewTimer = setInterval(() => {
      void this.renewReconciliationLease(lease, () => { leaseLost = true; });
    }, appConfig.reconciliation.leaseRenewalMs);
    const canStartWork = (): boolean => !leaseLost && Date.now() < deadlineAt;

    try {
      logger.info(
        {
          deadlineAt,
          runBudgetMs: appConfig.reconciliation.runBudgetMs,
          chatConcurrency: appConfig.reconciliation.chatConcurrency,
        },
        'reconciliation run started',
      );
      if (appConfig.reconciliation.staleBudgetMs > 0 && canStartWork()) {
        const recoveredCount = await this.mediaService.recoverStaleMediaItems({
          olderThanMs: intervalMs,
          deadlineAt: Math.min(deadlineAt, Date.now() + appConfig.reconciliation.staleBudgetMs),
          shouldContinue: canStartWork,
        });
        if (recoveredCount > 0) {
          logger.warn({ recoveredCount, staleThresholdMs: intervalMs }, 'stale media recovery sweep completed before reconciliation');
        }
      }

      if (!canStartWork()) {
        logger.info({ leaseLost, deadlineAt }, 'reconciliation stopped before history work');
        return;
      }

      const [activeGroups, activeUsers] = await Promise.all([
        this.prisma.groupState.findMany({ where: { isActive: true } }),
        this.prisma.userTu.findMany({
          where: { status: UserTuStatus.active },
          select: {
            id: true,
            tuId: true,
            tuName: true,
            telegramUserId: true,
            telegramChatId: true,
            username: true,
          },
          orderBy: { id: 'asc' },
        }),
      ]);
      const authorization = this.buildReconciliationAuthorization(activeUsers);
      const candidates = this.selectReconciliationCandidates(
        this.buildReconciliationGroups(activeGroups, activeUsers),
        startedAt,
        intervalMs,
      );
      metrics.chatsSelected = candidates.length;
      const context = this.telegramGateway.createReconciliationContext(deadlineAt);

      await this.runBounded(
        candidates,
        appConfig.reconciliation.chatConcurrency,
        async (group) => {
          const groupStartedAt = Date.now();
          const result = await this.reconcileGroup(group, authorization, context, intervalMs, canStartWork);
          metrics.chatsCompleted += result.completed ? 1 : 0;
          metrics.chatsDeferred += result.deferred ? 1 : 0;
          metrics.historyPages += result.historyPages;
          metrics.rawMessages += result.rawMessages;
          metrics.mediaMessages += result.mediaMessages;
          metrics.historyFailures += result.historyFailed ? 1 : 0;
          logger.info(
            {
              chatId: group.chatId.toString(),
              durationMs: Date.now() - groupStartedAt,
              ...result,
            },
            'reconciliation chat completed',
          );
        },
        canStartWork,
      );
    } catch (err) {
      logger.error({ err }, 'reconciliation run failed');
    } finally {
      clearInterval(renewTimer);
      try {
        await this.queueService.releaseLease(lease);
      } catch (err) {
        logger.error({ err, leaseKey: lease.key }, 'failed to release reconciliation lease');
      }
      logger.info(
        {
          durationMs: Date.now() - startedAt,
          deadlineExceeded: Date.now() >= deadlineAt,
          leaseLost,
          ...metrics,
        },
        'reconciliation run completed',
      );
    }
  }

  private async renewReconciliationLease(lease: RedisLease, markLost: () => void): Promise<void> {
    try {
      if (!await this.queueService.renewLease(lease)) {
        markLost();
        logger.error({ leaseKey: lease.key }, 'reconciliation lease ownership was lost');
      }
    } catch (err) {
      markLost();
      logger.error({ err, leaseKey: lease.key }, 'reconciliation lease renewal failed');
    }
  }

  private buildReconciliationGroups(
    activeGroups: Array<{
      chatId: bigint;
      title: string;
      chatType: ChatType;
      lastMessageId: bigint;
      lastReconciledAt: Date | null;
    }>,
    activeUsers: AllowedUser[],
  ): ReconciliationGroup[] {
    const groupsByChatId = new Map<string, ReconciliationGroup>();
    for (const group of activeGroups) {
      this.mergeReconciliationGroup(groupsByChatId, {
        ...group,
        chatId: this.canonicalReconciliationChatId(group.chatId),
      });
    }
    for (const user of activeUsers) {
      const chatId = this.canonicalReconciliationChatId(user.telegramChatId);
      if (groupsByChatId.has(chatId.toString())) {
        continue;
      }
      this.mergeReconciliationGroup(groupsByChatId, {
        chatId,
        title: `chat_${chatId.toString()}`,
        chatType: this.inferChatTypeFromChatId(chatId),
        lastMessageId: 0n,
        lastReconciledAt: null,
      });
    }
    return [...groupsByChatId.values()];
  }

  private selectReconciliationCandidates(
    groups: ReconciliationGroup[],
    now: number,
    intervalMs: number,
  ): ReconciliationGroup[] {
    const currentScheduleWindow = Math.floor(now / intervalMs);
    const dueGroups = groups
      .filter((group) => !group.lastReconciledAt || Math.floor(group.lastReconciledAt.getTime() / intervalMs) < currentScheduleWindow)
      .sort((left, right) => left.chatId.toString().localeCompare(right.chatId.toString()));
    if (!dueGroups.length) {
      return [];
    }

    // Rotate by one whole run cohort. This prevents permanently failing or
    // never-reconciled chats from occupying the first 500 slots forever.
    const runNumber = Math.floor(now / intervalMs);
    const startIndex = (runNumber * appConfig.reconciliation.maxChatsPerRun) % dueGroups.length;
    return [...dueGroups.slice(startIndex), ...dueGroups.slice(0, startIndex)]
      .slice(0, appConfig.reconciliation.maxChatsPerRun);
  }

  private async reconcileGroup(
    group: ReconciliationGroup,
    authorization: ReconciliationAuthorization,
    context: TelegramReconciliationContext,
    intervalMs: number,
    canStartWork: () => boolean,
  ): Promise<ReconciliationGroupResult> {
    const result: ReconciliationGroupResult = {
      completed: false,
      deferred: false,
      historyPages: 0,
      rawMessages: 0,
      mediaMessages: 0,
      historyFailed: false,
    };
    if (!canStartWork()) {
      result.deferred = true;
      return result;
    }

    const overdue = !group.lastReconciledAt || Date.now() - group.lastReconciledAt.getTime() > intervalMs * 2;
    let afterMessageId = rewindMessageCursor(
      group.lastMessageId,
      overdue
        ? appConfig.reconciliation.recoveryLookbackMessages
        : appConfig.reconciliation.normalLookbackMessages,
    );

    for (let pageNumber = 0; pageNumber < appConfig.reconciliation.maxPagesPerChat; pageNumber += 1) {
      if (!canStartWork()) {
        result.deferred = true;
        return result;
      }

      let page;
      try {
        page = await this.telegramGateway.fetchHistoryPageAfter({
          chatId: group.chatId,
          afterMessageId,
          limit: appConfig.reconciliation.historyPageSize,
        }, context);
      } catch (err) {
        result.historyFailed = true;
        logger.warn(
          {
            err,
            chatId: group.chatId.toString(),
            lastMessageId: group.lastMessageId.toString(),
            afterMessageId: afterMessageId.toString(),
          },
          'reconcile: history page failed; cursor was not advanced',
        );
        return result;
      }

      try {
        for (const message of page.messages) {
          if (!canStartWork()) {
            result.deferred = true;
            return result;
          }
          await this.handleIncoming(message, {
            notifyUnknownUploader: false,
            authorization,
            manageGroupCursor: false,
            throwOnProcessingError: true,
          });
          result.mediaMessages += 1;
        }
      } catch (err) {
        result.historyFailed = true;
        logger.warn(
          { err, chatId: group.chatId.toString(), afterMessageId: afterMessageId.toString() },
          'reconcile: history page processing failed; cursor was not advanced',
        );
        return result;
      }

      if (!canStartWork()) {
        result.deferred = true;
        return result;
      }
      try {
        await this.checkpointHistoryPage(group, page.maxSeenMessageId);
      } catch (err) {
        result.historyFailed = true;
        logger.warn(
          { err, chatId: group.chatId.toString(), afterMessageId: afterMessageId.toString() },
          'reconcile: history checkpoint failed; cursor was not advanced',
        );
        return result;
      }
      result.historyPages += 1;
      result.rawMessages += page.rawMessageCount;
      group.lastMessageId = page.maxSeenMessageId > group.lastMessageId
        ? page.maxSeenMessageId
        : group.lastMessageId;
      group.lastReconciledAt = new Date();

      if (!page.hasMore) {
        result.completed = true;
        return result;
      }
      afterMessageId = page.maxSeenMessageId;
    }

    result.deferred = true;
    logger.info(
      { chatId: group.chatId.toString(), maxPagesPerChat: appConfig.reconciliation.maxPagesPerChat },
      'reconcile: chat page limit reached; remaining history will be resumed later',
    );
    return result;
  }

  private async checkpointHistoryPage(group: ReconciliationGroup, maxSeenMessageId: bigint): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.groupState.upsert({
        where: { chatId: group.chatId },
        update: {
          title: group.title,
          chatType: group.chatType,
          isActive: true,
          lastReconciledAt: now,
          updatedAt: now,
        },
        create: {
          chatId: group.chatId,
          title: group.title,
          chatType: group.chatType,
          isActive: true,
          lastMessageId: maxSeenMessageId,
          lastReconciledAt: now,
          updatedAt: now,
        },
      });
      await tx.$executeRaw(
        Prisma.sql`UPDATE "group_state"
          SET "last_message_id" = GREATEST("last_message_id", ${maxSeenMessageId}), "updated_at" = ${now}
          WHERE "chat_id" = ${group.chatId}`,
      );
    });
  }

  private buildReconciliationAuthorization(users: AllowedUser[]): ReconciliationAuthorization {
    const authorization: ReconciliationAuthorization = {
      bySender: new Map(),
      byUsername: new Map(),
    };
    for (const user of users) {
      this.indexAuthorizedUser(authorization, user);
    }
    return authorization;
  }

  private indexAuthorizedUser(authorization: ReconciliationAuthorization, user: AllowedUser): void {
    authorization.bySender.set(this.authorizationKey(user.telegramChatId, user.telegramUserId.toString()), user);
    if (user.username) {
      authorization.byUsername.set(this.authorizationKey(user.telegramChatId, this.normalizeUsername(user.username)), user);
    }
  }

  private unindexAuthorizedUser(
    authorization: ReconciliationAuthorization,
    user: Pick<AllowedUser, 'telegramUserId' | 'telegramChatId' | 'username'>,
  ): void {
    authorization.bySender.delete(this.authorizationKey(user.telegramChatId, user.telegramUserId.toString()));
    if (user.username) {
      authorization.byUsername.delete(this.authorizationKey(user.telegramChatId, this.normalizeUsername(user.username)));
    }
  }

  private matchAuthorizedUser(
    message: IncomingMessage,
    chatIds: bigint[],
    authorization: ReconciliationAuthorization,
  ): AllowedUser | null {
    if (message.senderId) {
      for (const chatId of chatIds) {
        const user = authorization.bySender.get(this.authorizationKey(chatId, message.senderId.toString()));
        if (user) return user;
      }
    }
    if (message.senderUsername) {
      const username = this.normalizeUsername(message.senderUsername);
      for (const chatId of chatIds) {
        const user = authorization.byUsername.get(this.authorizationKey(chatId, username));
        if (user) return user;
      }
    }
    return null;
  }

  private async findAuthorizedUser(message: IncomingMessage, chatIds: bigint[]): Promise<AllowedUser | null> {
    const select = {
      id: true,
      tuId: true,
      tuName: true,
      telegramUserId: true,
      telegramChatId: true,
      username: true,
    } as const;
    if (message.senderId) {
      const bySender = await this.prisma.userTu.findFirst({
        where: {
          telegramChatId: { in: chatIds },
          status: UserTuStatus.active,
          telegramUserId: message.senderId,
        },
        select,
      });
      if (bySender) return bySender;
    }
    if (message.senderUsername) {
      return this.prisma.userTu.findFirst({
        where: {
          telegramChatId: { in: chatIds },
          status: UserTuStatus.active,
          username: message.senderUsername,
        },
        select,
      });
    }
    return null;
  }

  private authorizationKey(chatId: bigint, identity: string): string {
    return `${chatId.toString()}:${identity}`;
  }

  private normalizeUsername(value: string): string {
    return value.trim().replace(/^@+/, '').toLowerCase();
  }

  private async runBounded<T>(
    items: T[],
    concurrency: number,
    work: (item: T) => Promise<void>,
    canStartWork: () => boolean,
  ): Promise<void> {
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (canStartWork()) {
        const item = items[nextIndex];
        nextIndex += 1;
        if (item === undefined) return;
        try {
          await work(item);
        } catch (err) {
          logger.error({ err }, 'reconciliation worker failed for a chat; continuing with remaining work');
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  }

  private mergeReconciliationGroup(
    groupsByChatId: Map<string, ReconciliationGroup>,
    candidate: ReconciliationGroup,
  ): void {
    const existing = groupsByChatId.get(candidate.chatId.toString());
    if (!existing) {
      groupsByChatId.set(candidate.chatId.toString(), candidate);
      return;
    }

    if (candidate.lastMessageId > existing.lastMessageId) {
      existing.lastMessageId = candidate.lastMessageId;
    }
    if (!existing.lastReconciledAt || (
      candidate.lastReconciledAt && candidate.lastReconciledAt > existing.lastReconciledAt
    )) {
      existing.lastReconciledAt = candidate.lastReconciledAt;
    }
    if (existing.title.startsWith('chat_') && !candidate.title.startsWith('chat_')) {
      existing.title = candidate.title;
      existing.chatType = candidate.chatType;
    }
  }

  private canonicalReconciliationChatId(chatId: bigint): bigint {
    if (chatId >= 0n) {
      return chatId;
    }
    const positiveId = -chatId;
    if (positiveId > 1_000_000_000_000n) {
      return chatId;
    }
    // Negative IDs above the basic-group range are legacy MTProto channel IDs.
    // Do not infer channels from small `-100...` basic-group IDs.
    if (positiveId > 2_147_483_647n) {
      return -(1_000_000_000_000n + positiveId);
    }
    return chatId;
  }

  async triggerReconnect(): Promise<void> {
    if (this.reconnecting) {
      return;
    }

    this.reconnecting = true;
    try {
      await this.telegramGateway.disconnect();
      await this.telegramGateway.connect();
    } finally {
      this.reconnecting = false;
    }
  }

  private async notifyUnknownUploader(message: IncomingMessage): Promise<void> {
    if (this.isWhitelistedUnknownUploader(message.senderUsername)) {
      logger.info(
        {
          senderUsername: message.senderUsername,
          senderId: message.senderId?.toString(),
          chatId: message.chatId.toString(),
          messageId: message.messageId.toString(),
          groupedId: message.groupedId?.toString(),
        },
        'unknown uploader matched whitelist username; notification skipped',
      );
      return;
    }

    const senderKey = message.senderId?.toString() ?? `username:${message.senderUsername ?? 'unknown'}`;
    const key = `${message.chatId.toString()}_${senderKey}`;
    const now = Date.now();
    const last = this.unknownUserLastNotifiedAt.get(key);
    if (last && now - last < this.unknownUserNotifyCooldownMs) {
      return;
    }

    // Keep map bounded over time.
    for (const [k, ts] of this.unknownUserLastNotifiedAt.entries()) {
      if (now - ts > this.unknownUserNotifyCooldownMs * 2) {
        this.unknownUserLastNotifiedAt.delete(k);
      }
    }

    this.unknownUserLastNotifiedAt.set(key, now);

    const senderId = message.senderId?.toString() ?? 'unknown';
    const senderUsername = message.senderUsername ? `@${message.senderUsername}` : 'unknown';
    const groupTitle = message.chatTitle?.trim() || 'unknown';
    const groupTuHint = await this.buildGroupTuHint(message.chatId);
    await this.telegramNotifier.notify(
      `⚠️ Unregistered uploader detected: chatId=${message.chatId.toString()}, group=${groupTitle}, tu_in_group=${groupTuHint}, senderId=${senderId}, username=${senderUsername}, messageId=${message.messageId.toString()}. User may have changed username or is not in user_tu.`,
    );
  }

  private isWhitelistedUnknownUploader(senderUsername?: string): boolean {
    if (!senderUsername) {
      return false;
    }
    const normalized = senderUsername.toLowerCase().replace(/^@+/, '');
    return appConfig.unregisteredUploaderUsernameWhitelist.includes(normalized);
  }

  private chatIdLookupAliases(chatId: bigint): bigint[] {
    const values = new Map<string, bigint>();
    const add = (id: bigint): void => {
      values.set(id.toString(), id);
    };

    add(chatId);
    if (chatId >= 0n) {
      return [...values.values()];
    }

    const positiveId = -chatId;
    if (positiveId > 1_000_000_000_000n) {
      const channelId = positiveId - 1_000_000_000_000n;
      add(-channelId); // legacy form
      add(BigInt(`-100${channelId.toString()}`)); // malformed historic form
      return [...values.values()];
    }

    if (positiveId > 2_147_483_647n) {
      const channelId = positiveId;
      add(-(1_000_000_000_000n + channelId)); // canonical form
      add(BigInt(`-100${channelId.toString()}`)); // malformed historic form
      return [...values.values()];
    }

    const asText = positiveId.toString();
    if (asText.startsWith('100') && asText.length > 3) {
      const channelId = BigInt(asText.slice(3));
      if (channelId > 0n) {
        add(-(1_000_000_000_000n + channelId)); // canonical form
        add(-channelId); // legacy form
      }
    }

    return [...values.values()];
  }

  private async buildGroupTuHint(chatId: bigint): Promise<string> {
    const rows = await this.prisma.userTu.findMany({
      where: {
        status: UserTuStatus.active,
        telegramChatId: { in: this.chatIdLookupAliases(chatId) },
      },
      select: {
        tuId: true,
        tuName: true,
      },
      orderBy: { id: 'asc' },
      take: 6,
    });

    if (!rows.length) {
      return 'none';
    }

    const preview = rows.slice(0, 5).map((row) => `[${row.tuId}] ${row.tuName}`).join(' | ');
    if (rows.length > 5) {
      return `${preview} | ...`;
    }
    return preview;
  }

  private inferChatTypeFromChatId(chatId: bigint): ChatType {
    if (chatId < 0n && -chatId > 1_000_000_000_000n) {
      return ChatType.supergroup;
    }
    if (chatId < 0n) {
      return ChatType.group;
    }
    return ChatType.group;
  }
}
