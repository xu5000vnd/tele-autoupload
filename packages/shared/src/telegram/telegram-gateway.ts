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

  // Full connection: receives updates + registers event handlers (ingestor)
  async connect(): Promise<void> {
    this.client = this.buildClient();
    await this.client.connect();
    logger.info('telegram gateway connected');

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
    logger.info('telegram gateway disconnected');
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
    const peer = this.chatIdToPeer(input.chatId);
    const messages = await this.client.getMessages(peer, {
      ids: [input.messageId],
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
  }): Promise<IncomingMessage[]> {
    const peer = this.chatIdToPeer(input.chatId);
    const messages = await this.client.getMessages(peer, {
      minId: Number(input.afterMessageId),
      limit: 100,
    });

    const results: IncomingMessage[] = [];
    for (const raw of messages) {
      if (!(raw instanceof Api.Message)) continue;
      const parsed = await this.parseMessage(raw);
      if (parsed) results.push(parsed);
    }
    return results;
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

  private chatIdToPeer(chatId: bigint): Api.TypePeer {
    if (chatId > 0n) {
      return new Api.PeerUser({ userId: nativeToBi(chatId) });
    }
    const positiveId = -chatId;
    if (positiveId > 1_000_000_000_000n) {
      return new Api.PeerChannel({ channelId: nativeToBi(positiveId - 1_000_000_000_000n) });
    }
    return new Api.PeerChat({ chatId: nativeToBi(positiveId) });
  }
}
