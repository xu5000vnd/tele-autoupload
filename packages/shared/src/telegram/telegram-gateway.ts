import { Injectable } from '@nestjs/common';
import bigInt, { BigInteger } from 'big-integer';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage } from 'telegram/events';
import { promises as fs } from 'node:fs';
import { appConfig } from '@shared/config/env';
import { logger } from '@shared/utils/logger';
import { IncomingMedia, IncomingMessage, MessageHandler } from '@shared/types/telegram';

function biToNative(v: BigInteger): bigint {
  return BigInt(v.toString());
}

function nativeToBi(v: bigint): BigInteger {
  return bigInt(v.toString());
}

@Injectable()
export class TelegramGateway {
  private client!: TelegramClient;
  private newMessageHandlers: MessageHandler[] = [];
  private editMessageHandlers: MessageHandler[] = [];
  private updatesRegistered = false;
  private dialogsCacheWarmed = false;

  private buildClient(): TelegramClient {
    const { apiId, apiHash, session } = appConfig.telegram;
    const validSession = session.startsWith('1') ? session : '';
    if (!validSession) {
      logger.warn('TG_SESSION_STRING is missing or invalid — starting without an existing session. Run the session-generator script to obtain a valid value.');
    }
    return new TelegramClient(
      new StringSession(validSession),
      apiId,
      apiHash,
      { connectionRetries: 5 },
    );
  }

  // Connection for ingest or outbound send. `withUpdates=true` registers update handlers.
  async connect(options: { withUpdates?: boolean } = {}): Promise<void> {
    const withUpdates = options.withUpdates ?? true;

    if (!this.client?.connected) {
      this.client = this.buildClient();
      await this.client.connect();
      await this.warmDialogsCache();
      logger.info('telegram gateway connected');
    }

    if (withUpdates) {
      this.registerUpdateHandlers();
    }
  }

  private registerUpdateHandlers(): void {
    if (this.updatesRegistered) {
      return;
    }
    this.updatesRegistered = true;

    this.client.addEventHandler(async (event: { message: Api.Message }) => {
      logger.info({
        hasMessage: !!event.message,
        messageId: event.message?.id,
        hasMedia: !!event.message?.media,
        mediaType: event.message?.media?.className,
        peerId: event.message?.peerId?.className,
      }, 'raw new message event received');

      if (!event.message) return;

      try {
        const msg = await this.parseMessage(event.message);
        if (!msg) {
          logger.info({ messageId: event.message.id }, 'message dropped by parseMessage (no media or unsupported type)');
          return;
        }
        for (const handler of this.newMessageHandlers) {
          await handler(msg);
        }
      } catch (err) {
        logger.error({ err }, 'error in new message handler');
      }
    }, new NewMessage({}));

    this.client.addEventHandler(async (update: Api.TypeUpdate) => {
      if (
        !(update instanceof Api.UpdateEditChannelMessage) &&
        !(update instanceof Api.UpdateEditMessage)
      ) return;

      const apiMsg = update.message;
      if (!(apiMsg instanceof Api.Message)) return;

      try {
        const msg = await this.parseMessage(apiMsg);
        if (!msg) return;
        for (const handler of this.editMessageHandlers) {
          await handler(msg);
        }
      } catch (err) {
        logger.error({ err }, 'error in edited message handler');
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.client?.connected) {
      await this.client.disconnect();
    }
    this.dialogsCacheWarmed = false;
    logger.info('telegram gateway disconnected');
  }

  private async warmDialogsCache(): Promise<void> {
    if (this.dialogsCacheWarmed) {
      return;
    }
    try {
      // Warm entity cache so PeerChannel resolution has access hashes for joined groups.
      await this.client.getDialogs({ limit: 1000 });
      this.dialogsCacheWarmed = true;
      logger.info('telegram dialogs cache warmed');
    } catch (err) {
      logger.warn({ err }, 'failed to warm telegram dialogs cache');
    }
  }

  async sendText(chatId: bigint, text: string): Promise<void> {
    if (!this.client?.connected) {
      throw new Error('Telegram gateway is not connected');
    }
    await this.withPeerFallback(chatId, 'sendText', async (peer) => {
      await this.client.sendMessage(peer, { message: text });
    });
  }

  async sendMedia(chatId: bigint, localPaths: string[], caption?: string): Promise<void> {
    if (!this.client?.connected) {
      throw new Error('Telegram gateway is not connected');
    }
    if (!localPaths.length) {
      if (caption) {
        await this.sendText(chatId, caption);
      }
      return;
    }

    await this.withPeerFallback(chatId, 'sendMedia', async (peer) => {
      if (localPaths.length === 1) {
        await this.client.sendFile(peer, {
          file: localPaths[0],
          caption,
        });
        return;
      }

      await this.client.sendFile(peer, {
        file: localPaths,
        caption: caption ?? '',
        forceDocument: false,
      });
    });
  }

  onNewMessage(handler: MessageHandler): void {
    this.newMessageHandlers.push(handler);
  }

  onEditedMessage(handler: MessageHandler): void {
    this.editMessageHandlers.push(handler);
  }

  async emitNewMessage(message: IncomingMessage): Promise<void> {
    for (const handler of this.newMessageHandlers) {
      await handler(message);
    }
  }

  async emitEditedMessage(message: IncomingMessage): Promise<void> {
    for (const handler of this.editMessageHandlers) {
      await handler(message);
    }
  }

  async downloadMediaToFile(input: {
    chatId: bigint;
    messageId: number;
    mediaIndex: number;
    destinationPath: string;
  }): Promise<{ sizeBytes: bigint }> {
    const messages = await this.withPeerFallback(input.chatId, 'downloadMediaToFile/getMessages', async (peer) => {
      return this.client.getMessages(peer, {
        ids: [input.messageId],
      });
    });

    const message = messages[0];
    if (!message?.media) {
      throw new Error(
        `No media found: chatId=${input.chatId}, messageId=${input.messageId}`,
      );
    }

    const buffer = await this.client.downloadMedia(message, {}) as Buffer;
    if (!buffer || buffer.length === 0) {
      throw new Error(
        `Downloaded empty buffer: chatId=${input.chatId}, messageId=${input.messageId}`,
      );
    }

    await fs.writeFile(input.destinationPath, buffer);
    return { sizeBytes: BigInt(buffer.length) };
  }

  async fetchHistoryAfter(input: {
    chatId: bigint;
    afterMessageId: bigint;
  }): Promise<{ messages: IncomingMessage[]; maxSeenMessageId: bigint }> {
    const maxBackfillMessages = 3000;
    const fromMessageId = Number(input.afterMessageId);
    const collected = await this.withPeerFallback(input.chatId, 'fetchHistoryAfter/iterMessages', async (peer) => {
      const rows: Api.Message[] = [];
      for await (const raw of this.client.iterMessages(peer, {
        minId: fromMessageId,
        reverse: true,
        limit: maxBackfillMessages,
      })) {
        if (raw instanceof Api.Message) {
          rows.push(raw);
        }
      }
      return rows;
    });

    let maxSeenMessageId = input.afterMessageId;
    const results: IncomingMessage[] = [];
    for (const raw of collected) {
      if (BigInt(raw.id) > maxSeenMessageId) {
        maxSeenMessageId = BigInt(raw.id);
      }
      const parsed = await this.parseMessage(raw);
      if (parsed) results.push(parsed);
    }

    if (collected.length >= maxBackfillMessages) {
      logger.warn(
        {
          chatId: input.chatId.toString(),
          afterMessageId: input.afterMessageId.toString(),
          fetched: collected.length,
          maxBackfillMessages,
        },
        'history backfill hit batch cap; consider reducing reconciliation interval',
      );
    }

    return {
      messages: results,
      maxSeenMessageId,
    };
  }

  private async parseMessage(msg: Api.Message): Promise<IncomingMessage | null> {
    if (!msg.media || !msg.peerId) return null;

    const media = this.extractMedia(msg);
    if (!media.length) return null;

    const chatId = this.peerToChatId(msg.peerId);
    const senderId = msg.fromId ? this.peerToChatId(msg.fromId) : undefined;

    let chatTitle = '';
    let chatType: IncomingMessage['chatType'] = 'supergroup';

    try {
      const entity = await this.client.getEntity(msg.peerId);
      if (entity instanceof Api.Channel) {
        chatTitle = entity.title;
        chatType = entity.megagroup ? 'supergroup' : 'channel';
      } else if (entity instanceof Api.Chat) {
        chatTitle = entity.title;
        chatType = 'group';
      }
    } catch {
      logger.warn({ chatId: chatId.toString() }, 'failed to resolve chat entity');
    }

    // Resolve sender username (Telegram users may or may not have one)
    let senderUsername: string | undefined;
    if (msg.fromId) {
      try {
        const senderEntity = await this.client.getEntity(msg.fromId);
        if ('username' in senderEntity && typeof senderEntity.username === 'string' && senderEntity.username) {
          senderUsername = senderEntity.username.toLowerCase();
        }
      } catch {
        logger.warn({ senderId: senderId?.toString() }, 'failed to resolve sender entity');
      }
    }

    return {
      chatId,
      chatTitle,
      chatType,
      messageId: BigInt(msg.id),
      groupedId: msg.groupedId ? biToNative(msg.groupedId) : undefined,
      senderId,
      senderUsername,
      date: new Date(msg.date * 1000),
      media,
    };
  }

  private extractMedia(msg: Api.Message): IncomingMedia[] {
    if (
      msg.media instanceof Api.MessageMediaPhoto &&
      msg.media.photo instanceof Api.Photo
    ) {
      const photo = msg.media.photo;
      const photoId = photo.id.toString();
      return [{
        type: 'photo',
        fileId: photoId,
        uniqueId: photoId,
        mimeType: 'image/jpeg',
        mediaIndex: 0,
      }];
    }

    if (
      msg.media instanceof Api.MessageMediaDocument &&
      msg.media.document instanceof Api.Document
    ) {
      const doc = msg.media.document;
      const fileNameAttr = doc.attributes.find(
        (a): a is Api.DocumentAttributeFilename =>
          a instanceof Api.DocumentAttributeFilename,
      );
      const isVideo = doc.attributes.some(
        (a) => a instanceof Api.DocumentAttributeVideo,
      );

      const docId = doc.id.toString();
      return [{
        type: isVideo ? 'video' : 'document',
        fileId: docId,
        uniqueId: docId,
        fileName: fileNameAttr?.fileName,
        mimeType: doc.mimeType,
        size: biToNative(doc.size),
        mediaIndex: 0,
      }];
    }

    return [];
  }

  private peerToChatId(peer: Api.TypePeer): bigint {
    if (peer instanceof Api.PeerChannel) {
      return -(1_000_000_000_000n + biToNative(peer.channelId));
    }
    if (peer instanceof Api.PeerChat) {
      return -biToNative(peer.chatId);
    }
    if (peer instanceof Api.PeerUser) {
      return biToNative(peer.userId);
    }
    throw new Error(`Unknown peer type: ${(peer as { className?: string }).className}`);
  }

  private toShortPrefixedChannelChatId(channelId: bigint): bigint {
    return BigInt(`-100${channelId.toString()}`);
  }

  private expandChatIdAliases(chatId: bigint): bigint[] {
    const values = new Map<string, bigint>();
    const add = (id: bigint): void => {
      values.set(id.toString(), id);
    };

    add(chatId);
    if (chatId >= 0n) {
      return [...values.values()];
    }

    const positiveId = -chatId;

    // Canonical bot-api channel/supergroup chat ID: -100xxxxxxxxxx (internally 1e12 + channelId).
    if (positiveId > 1_000_000_000_000n) {
      const channelId = positiveId - 1_000_000_000_000n;
      add(-channelId); // legacy/mtproto-style storage
      add(this.toShortPrefixedChannelChatId(channelId)); // malformed historic "prefix-only" storage
      return [...values.values()];
    }

    // Legacy negative channel ID (without bot-api 1e12 offset).
    if (positiveId > 2_147_483_647n) {
      const channelId = positiveId;
      add(-(1_000_000_000_000n + channelId)); // canonical bot-api form
      add(this.toShortPrefixedChannelChatId(channelId)); // malformed historic "prefix-only" storage
      return [...values.values()];
    }

    // Malformed historic form: -100<channelId> but without 1e12 offset.
    const asText = positiveId.toString();
    if (asText.startsWith('100') && asText.length > 3) {
      const channelId = BigInt(asText.slice(3));
      if (channelId > 0n) {
        add(-(1_000_000_000_000n + channelId)); // canonical bot-api form
        add(-channelId); // legacy/mtproto-style storage
      }
    }

    return [...values.values()];
  }

  private async withPeerFallback<T>(
    chatId: bigint,
    operation: string,
    worker: (peer: Api.TypePeer) => Promise<T>,
  ): Promise<T> {
    const candidateIds = this.expandChatIdAliases(chatId);
    let lastErr: unknown;

    for (const candidateId of candidateIds) {
      try {
        return await worker(this.chatIdToPeer(candidateId));
      } catch (err) {
        lastErr = err;
        const info = this.rpcErrorInfo(err);
        logger.debug(
          {
            operation,
            inputChatId: chatId.toString(),
            candidateChatId: candidateId.toString(),
            rpcCode: info.code,
            rpcMessage: info.errorMessage,
          },
          'telegram peer candidate failed',
        );
      }
    }

    const info = this.rpcErrorInfo(lastErr);
    logger.warn(
      {
        operation,
        inputChatId: chatId.toString(),
        candidates: candidateIds.map((x) => x.toString()),
        rpcCode: info.code,
        rpcMessage: info.errorMessage,
      },
      'all telegram peer candidates failed',
    );
    throw (lastErr instanceof Error ? lastErr : new Error(`Failed ${operation} for chatId=${chatId.toString()}`));
  }

  private rpcErrorInfo(err: unknown): { code?: number; errorMessage?: string } {
    if (!err || typeof err !== 'object') {
      return {};
    }
    const raw = err as Record<string, unknown>;
    const code = typeof raw.code === 'number' ? raw.code : undefined;
    const errorMessage = typeof raw.errorMessage === 'string'
      ? raw.errorMessage
      : typeof raw.message === 'string'
        ? raw.message
        : undefined;
    return { code, errorMessage };
  }

  private chatIdToPeer(chatId: bigint): Api.TypePeer {
    if (chatId > 0n) {
      return new Api.PeerUser({ userId: nativeToBi(chatId) });
    }
    const positiveId = -chatId;
    if (positiveId > 1_000_000_000_000n) {
      return new Api.PeerChannel({ channelId: nativeToBi(positiveId - 1_000_000_000_000n) });
    }
    // Backward compatibility for legacy stored channel IDs like `-5241895841`
    // (missing bot-api `-100` prefix). Values above 32-bit chat range are channels.
    if (positiveId > 2_147_483_647n) {
      return new Api.PeerChannel({ channelId: nativeToBi(positiveId) });
    }
    return new Api.PeerChat({ chatId: nativeToBi(positiveId) });
  }
}
