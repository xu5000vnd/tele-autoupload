import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { appConfig } from '@shared/config/env';
import { MediaService } from '@shared/services/media.service';
import { TelegramNotifierService } from '@shared/services/telegram-notifier.service';
import { TelegramGateway } from '@shared/telegram/telegram-gateway';
import { PrismaService } from '@shared/db/prisma.service';
import { IncomingMessage } from '@shared/types/telegram';
import { logger } from '@shared/utils/logger';
import { Prisma, UserTuStatus } from '@prisma/client';

@Injectable()
export class IngestorService implements OnModuleInit, OnModuleDestroy {
  private reconnecting = false;
  private logger = new Logger(IngestorService.name);
  private readonly unknownUserNotifyCooldownMs = 10 * 60 * 1000;
  private readonly unknownUserLastNotifiedAt = new Map<string, number>();

  constructor(
    private readonly telegramGateway: TelegramGateway,
    private readonly mediaService: MediaService,
    private readonly prisma: PrismaService,
    private readonly telegramNotifier: TelegramNotifierService,
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

  private async handleIncoming(message: IncomingMessage): Promise<void> {
    this.logger.log('handleIncoming', message);
    if (!message.senderId && !message.senderUsername) {
      return;
    }

    // Match by numeric user ID or by Telegram username (case-insensitive, stored lowercase)
    const orConditions: object[] = [];
    if (message.senderId) {
      orConditions.push({ telegramUserId: message.senderId });
    }
    if (message.senderUsername) {
      orConditions.push({ username: message.senderUsername });
    }

    const chatIdsForLookup = this.chatIdLookupAliases(message.chatId);

    const allowedUser = await this.prisma.userTu.findFirst({
      where: {
        telegramChatId: { in: chatIdsForLookup },
        status: UserTuStatus.active,
        OR: orConditions,
      },
    });

    if (!allowedUser) {
      logger.info(
        { senderId: message.senderId?.toString(), senderUsername: message.senderUsername, chatId: message.chatId.toString() },
        'message from unregistered or inactive user — skipped',
      );
      await this.notifyUnknownUploader(message);
      return;
    }

    const patchData: Prisma.UserTuUpdateInput = {};
    // If the record was matched by username but the stored telegram_user_id doesn't match
    // the actual sender, back-fill it so future lookups use the faster numeric ID.
    if (message.senderId && allowedUser.telegramUserId !== message.senderId) {
      patchData.telegramUserId = message.senderId;
    }
    // Auto-normalize old chat IDs to canonical bot-api format (-100...).
    if (allowedUser.telegramChatId !== message.chatId) {
      patchData.telegramChatId = message.chatId;
    }
    if (Object.keys(patchData).length) {
      await this.prisma.userTu.update({
        where: { id: allowedUser.id },
        data: {
          ...patchData,
          updatedAt: new Date(),
        },
      });
      logger.info(
        {
          userTuId: allowedUser.id,
          oldTelegramUserId: allowedUser.telegramUserId.toString(),
          newTelegramUserId: message.senderId?.toString(),
          oldTelegramChatId: allowedUser.telegramChatId.toString(),
          newTelegramChatId: message.chatId.toString(),
        },
        'back-filled user_tu identifiers from incoming message',
      );
    }

    try {
      await this.mediaService.processIncomingMessage(message);
    } catch (error) {
      logger.error({ err: error, chatId: message.chatId.toString(), messageId: message.messageId.toString() }, 'failed to process incoming message');
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcile(): Promise<void> {
    const intervalMs = appConfig.reconciliationIntervalMin * 60_000;
    const now = Date.now();

    const activeGroups = await this.prisma.groupState.findMany({ where: { isActive: true } });
    for (const group of activeGroups) {
      if (group.lastReconciledAt && now - group.lastReconciledAt.getTime() < intervalMs) {
        continue;
      }

      let messages: IncomingMessage[] = [];
      try {
        messages = await this.telegramGateway.fetchHistoryAfter({
          chatId: group.chatId,
          afterMessageId: group.lastMessageId,
        });
      } catch (err) {
        logger.warn(
          {
            err,
            chatId: group.chatId.toString(),
            lastMessageId: group.lastMessageId.toString(),
          },
          'reconcile: failed to fetch history for group; skipping this cycle',
        );
        await this.prisma.groupState.update({
          where: { chatId: group.chatId },
          data: { lastReconciledAt: new Date() },
        });
        continue;
      }

      for (const message of messages) {
        await this.handleIncoming(message);
      }

      const maxMessageId = messages.reduce<bigint>((acc, item) => (item.messageId > acc ? item.messageId : acc), group.lastMessageId);

      await this.prisma.groupState.update({
        where: { chatId: group.chatId },
        data: {
          lastMessageId: maxMessageId,
          lastReconciledAt: new Date(),
        },
      });
    }
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
        { senderUsername: message.senderUsername, chatId: message.chatId.toString() },
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
    await this.telegramNotifier.notify(
      `⚠️ Unregistered uploader detected: chatId=${message.chatId.toString()}, senderId=${senderId}, username=${senderUsername}, messageId=${message.messageId.toString()}. User may have changed username or is not in user_tu.`,
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
}
