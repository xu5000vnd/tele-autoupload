import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BotTelegramService, chatIdAliases } from '@shared/telegram/bot-telegram.service';
import { appConfig } from '@shared/config/env';
import { MediaService } from '@shared/services/media.service';
import { TelegramNotifierService } from '@shared/services/telegram-notifier.service';
import { QueueService } from '@shared/queue/queue.service';
import { PrismaService } from '@shared/db/prisma.service';
import { IncomingMessage } from '@shared/types/telegram';
import { logger } from '@shared/utils/logger';
import { Prisma, UserTu, UserTuStatus } from '@prisma/client';

type HandleIncomingOptions = {
  notifyUnknownUploader?: boolean;
  manageGroupCursor?: boolean;
  throwOnProcessingError?: boolean;
};

type AllowedUser = Pick<UserTu, 'id' | 'tuId' | 'tuName' | 'telegramUserId' | 'telegramChatId' | 'username'>;

const RECONCILIATION_LEASE_KEY = 'tele-autoupload:reconciliation:lease';

@Injectable()
export class IngestorService implements OnModuleInit, OnModuleDestroy {
  private readonly unknownUserNotifyCooldownMs = 10 * 60 * 1000;
  private readonly unknownUserLastNotifiedAt = new Map<string, number>();

  constructor(
    private readonly mediaService: MediaService,
    private readonly prisma: PrismaService,
    private readonly telegramNotifier: TelegramNotifierService,
    private readonly queueService: QueueService,
    private readonly botTelegram: BotTelegramService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.botTelegram.start(async (message) => this.handleIncoming(message, { manageGroupCursor: false, throwOnProcessingError: true }));
    logger.info('bot ingestor started');
  }

  async onModuleDestroy(): Promise<void> {
    await this.botTelegram.stop();
  }

  private async handleIncoming(message: IncomingMessage, options: HandleIncomingOptions = {}): Promise<boolean> {
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
      return false;
    }

    const chatIdsForLookup = this.chatIdLookupAliases(message.chatId);

    const allowedUser = await this.findAuthorizedUser(message, chatIdsForLookup);

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
      return false;
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
    return true;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcile(): Promise<void> {
    const lease = await this.queueService.acquireLease(RECONCILIATION_LEASE_KEY, appConfig.reconciliation.leaseTtlMs);
    if (!lease) return;
    let owned = true;
    const deadlineAt = Date.now() + appConfig.reconciliation.staleBudgetMs;
    const renewal = setInterval(() => {
      void this.queueService.renewLease(lease).then((result) => { if (!result) owned = false; }).catch(() => { owned = false; });
    }, appConfig.reconciliation.leaseRenewalMs);
    try {
      await this.mediaService.recoverStaleMediaItems({ olderThanMs: appConfig.reconciliationIntervalMin * 60_000,
        deadlineAt, shouldContinue: () => owned && Date.now() < deadlineAt });
    } finally {
      clearInterval(renewal);
      await this.queueService.releaseLease(lease);
    }
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

  async triggerReconnect(): Promise<void> {
    await this.botTelegram.stop();
    this.botTelegram.start(async (message) => this.handleIncoming(message, { manageGroupCursor: false, throwOnProcessingError: true }));
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
    return chatIdAliases(chatId);
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
}
