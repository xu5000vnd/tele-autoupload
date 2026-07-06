import { BadRequestException, Injectable } from '@nestjs/common';
import { MediaStatus, UserTu, UserTuStatus } from '@prisma/client';
import { PrismaService } from '@shared/db/prisma.service';
import { MediaService, ResolvedUploaderContext } from '@shared/services/media.service';
import { TelegramGateway } from '@shared/telegram/telegram-gateway';
import { IncomingMessage } from '@shared/types/telegram';

type BackfillInput = {
  chatId: bigint;
  fromDate: Date;
  toDate: Date;
  dryRun: boolean;
};

type BackfillUser = Pick<UserTu, 'id' | 'tuId' | 'tuName' | 'telegramUserId' | 'telegramChatId' | 'username'>;

type UnknownSenderSummary = {
  sender_id: string | null;
  sender_username: string | null;
  message_count: number;
  media_count: number;
};

type MediaScanSummary = {
  missing: number;
  failed: number;
  existing: number;
};

@Injectable()
export class MediaBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramGateway: TelegramGateway,
    private readonly mediaService: MediaService,
  ) {}

  async backfill(input: BackfillInput): Promise<Record<string, unknown>> {
    if (input.toDate < input.fromDate) {
      throw new BadRequestException('to_date must be after from_date');
    }

    const chatAliases = this.chatIdLookupAliases(input.chatId);
    const activeUsers = await this.prisma.userTu.findMany({
      where: {
        status: UserTuStatus.active,
        telegramChatId: { in: chatAliases },
      },
      orderBy: { tuName: 'asc' },
    });

    const selectedUsers = activeUsers;
    if (!selectedUsers.length) {
      throw new BadRequestException('no active users found in this group');
    }

    await this.telegramGateway.connect({ withUpdates: false });
    const fetched = await this.telegramGateway.fetchHistoryAfter({
      chatId: input.chatId,
      afterMessageId: 0n,
    });
    const messages = fetched.messages.filter((message) => (
      message.date >= input.fromDate && message.date <= input.toDate
    ));

    const userBySenderKey = new Map<string, BackfillUser>();
    const userByUsernameKey = new Map<string, BackfillUser>();
    for (const user of selectedUsers) {
      chatAliases.forEach((chatId) => {
        userBySenderKey.set(this.senderKey(user.telegramUserId, chatId), user);
      });
      if (user.username) {
        userByUsernameKey.set(this.normalizeToken(user.username), user);
      }
    }

    const unknownSenders = new Map<string, UnknownSenderSummary>();
    let matchedMessages = 0;
    let mediaFound = 0;
    let queuedMedia = 0;
    let retriedFailed = 0;
    let skippedExisting = 0;
    let processedMessages = 0;

    for (const message of messages) {
      const matchedUser = this.matchMessageUser(message, userBySenderKey, userByUsernameKey);
      if (!matchedUser) {
        this.addUnknownSender(unknownSenders, message);
        continue;
      }

      matchedMessages += 1;
      mediaFound += message.media.length;
      const mediaScan = await this.scanMedia(message);
      queuedMedia += mediaScan.missing;
      retriedFailed += mediaScan.failed;
      skippedExisting += mediaScan.existing;

      if ((!mediaScan.missing && !mediaScan.failed) || input.dryRun) {
        continue;
      }

      const patchedUser = await this.patchUserIdentifiers(matchedUser, message);
      await this.mediaService.processIncomingMessage(message, this.uploaderContext(patchedUser));
      processedMessages += 1;
    }

    return {
      dry_run: input.dryRun,
      chat_id: input.chatId.toString(),
      from_date: input.fromDate.toISOString(),
      to_date: input.toDate.toISOString(),
      selected_users: selectedUsers.map((user) => ({
        id: user.id,
        tu_id: user.tuId,
        tu_name: user.tuName,
        telegram_user_id: user.telegramUserId.toString(),
        telegram_chat_id: user.telegramChatId.toString(),
        telegram_username: user.username,
      })),
      scanned_messages: messages.length,
      matched_messages: matchedMessages,
      media_found: mediaFound,
      queued_media: queuedMedia,
      retried_failed: retriedFailed,
      skipped_existing: skippedExisting,
      unknown_senders: [...unknownSenders.values()],
      processed_messages: processedMessages,
      max_seen_message_id: fetched.maxSeenMessageId.toString(),
    };
  }

  private async scanMedia(message: IncomingMessage): Promise<MediaScanSummary> {
    const summary: MediaScanSummary = {
      missing: 0,
      failed: 0,
      existing: 0,
    };

    for (const media of message.media) {
      const existing = await this.prisma.mediaItem.findUnique({
        where: {
          chatId_messageId_mediaIndex: {
            chatId: message.chatId,
            messageId: message.messageId,
            mediaIndex: media.mediaIndex,
          },
        },
        select: { id: true, status: true },
      });
      if (!existing) {
        summary.missing += 1;
        continue;
      }

      if (existing.status === MediaStatus.failed) {
        summary.failed += 1;
        continue;
      }

      summary.existing += 1;
    }

    return summary;
  }

  private matchMessageUser(
    message: IncomingMessage,
    userBySenderKey: Map<string, BackfillUser>,
    userByUsernameKey: Map<string, BackfillUser>,
  ): BackfillUser | undefined {
    if (message.senderId) {
      const matched = userBySenderKey.get(this.senderKey(message.senderId, message.chatId));
      if (matched) {
        return matched;
      }
    }
    if (message.senderUsername) {
      return userByUsernameKey.get(this.normalizeToken(message.senderUsername));
    }
    return undefined;
  }

  private addUnknownSender(unknownSenders: Map<string, UnknownSenderSummary>, message: IncomingMessage): void {
    const key = `${message.senderId?.toString() ?? 'unknown'}:${this.normalizeToken(message.senderUsername)}`;
    const current = unknownSenders.get(key) ?? {
      sender_id: message.senderId?.toString() ?? null,
      sender_username: message.senderUsername ?? null,
      message_count: 0,
      media_count: 0,
    };
    current.message_count += 1;
    current.media_count += message.media.length;
    unknownSenders.set(key, current);
  }

  private uploaderContext(user: BackfillUser): ResolvedUploaderContext {
    return {
      userTuId: user.id,
      tuId: user.tuId,
      tuName: user.tuName,
    };
  }

  private async patchUserIdentifiers(user: BackfillUser, message: IncomingMessage): Promise<BackfillUser> {
    const data: { telegramUserId?: bigint; telegramChatId?: bigint; username?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };

    if (message.senderId && user.telegramUserId !== message.senderId) {
      data.telegramUserId = message.senderId;
    }
    if (user.telegramChatId !== message.chatId) {
      data.telegramChatId = message.chatId;
    }
    if (message.senderUsername && user.username !== message.senderUsername) {
      data.username = message.senderUsername;
    }

    if (Object.keys(data).length === 1) {
      return user;
    }

    return this.prisma.userTu.update({
      where: { id: user.id },
      data,
      select: {
        id: true,
        tuId: true,
        tuName: true,
        telegramUserId: true,
        telegramChatId: true,
        username: true,
      },
    });
  }

  private senderKey(senderId: bigint, chatId: bigint): string {
    return `${senderId.toString()}_${chatId.toString()}`;
  }

  private normalizeToken(value: string | number | null | undefined): string {
    return String(value ?? '')
      .trim()
      .replace(/^@/, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
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
      add(-channelId);
      add(BigInt(`-100${channelId.toString()}`));
      return [...values.values()];
    }

    if (positiveId > 2_147_483_647n) {
      const channelId = positiveId;
      add(-(1_000_000_000_000n + channelId));
      add(BigInt(`-100${channelId.toString()}`));
      return [...values.values()];
    }

    const asText = positiveId.toString();
    if (asText.startsWith('100') && asText.length > 3) {
      const channelId = BigInt(asText.slice(3));
      if (channelId > 0n) {
        add(-(1_000_000_000_000n + channelId));
        add(-channelId);
      }
    }

    return [...values.values()];
  }
}
