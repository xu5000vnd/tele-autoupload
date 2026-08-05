import { Injectable } from '@nestjs/common';
import bigInt, { BigInteger } from 'big-integer';
import { TelegramClient, Api } from 'telegram';
import { FloodWaitError } from 'telegram/errors';
import { StringSession } from 'telegram/sessions';
import { NewMessage } from 'telegram/events';
import { promises as fs } from 'node:fs';
import { appConfig } from '@shared/config/env';
import { QueueService, TelegramRequestCoordinator, TelegramRequestPermit } from '@shared/queue/queue.service';
import { logger } from '@shared/utils/logger';
import { IncomingMedia, IncomingMessage, MessageHandler } from '@shared/types/telegram';

type CachedChatMetadata = Pick<IncomingMessage, 'chatTitle' | 'chatType'>;
type TelegramRequestWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  deadlineAt?: number;
  timeout?: NodeJS.Timeout;
};

export function telegramFloodWaitSeconds(err: unknown): number | undefined {
  if (err instanceof FloodWaitError) {
    return err.seconds;
  }
  const raw = err as { errorMessage?: unknown; message?: unknown } | undefined;
  const message = typeof raw?.errorMessage === 'string'
    ? raw.errorMessage
    : typeof raw?.message === 'string'
      ? raw.message
      : '';
  const match = /FLOOD(?:_PREMIUM)?_WAIT_(\d+)/.exec(message);
  return match ? Number(match[1]) : undefined;
}

export class TelegramRequestGate {
  private inFlight = 0;
  private readonly waiters: TelegramRequestWaiter[] = [];
  private nextRequestAt = 0;
  private blockedUntil = 0;
  private wakeTimer?: NodeJS.Timeout;

  constructor(
    private readonly concurrency: number,
    private readonly requestsPerSecond: number,
    private readonly coordinator?: TelegramRequestCoordinator,
  ) {}

  async run<T>(work: () => Promise<T>, deadlineAt?: number): Promise<T> {
    await this.acquire(deadlineAt);
    let permit: TelegramRequestPermit | undefined;
    let renewalTimer: NodeJS.Timeout | undefined;
    try {
      permit = await this.coordinator?.acquireTelegramRequestPermit(deadlineAt);
      if (permit) {
        renewalTimer = setInterval(() => {
          void this.renewPermit(permit!);
        }, Math.max(1_000, Math.floor(permit.ttlMs / 2)));
      }
      return await work();
    } catch (err) {
      const seconds = telegramFloodWaitSeconds(err);
      if (seconds) {
        this.deferFor(seconds * 1000);
        try {
          await this.coordinator?.deferTelegramRequests(seconds * 1000);
        } catch (deferError) {
          logger.error({ err: deferError }, 'failed to share Telegram FloodWait backoff through Redis');
        }
        logger.warn({ seconds }, 'telegram FloodWait received; Telegram requests paused');
      }
      throw err;
    } finally {
      if (renewalTimer) {
        clearInterval(renewalTimer);
      }
      if (permit) {
        try {
          await this.coordinator?.releaseTelegramRequestPermit(permit);
        } catch (releaseError) {
          logger.error({ err: releaseError }, 'failed to release Telegram request permit');
        }
      }
      this.inFlight -= 1;
      this.drain();
    }
  }

  deferFor(delayMs: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delayMs);
    this.drain();
  }

  private async acquire(deadlineAt?: number): Promise<void> {
    if (deadlineAt && Date.now() >= deadlineAt) {
      throw new Error('Telegram request deadline exceeded before entering the request gate');
    }
    return new Promise((resolve, reject) => {
      const waiter: TelegramRequestWaiter = { resolve, reject, deadlineAt };
      if (deadlineAt) {
        waiter.timeout = setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) {
            this.waiters.splice(index, 1);
            reject(new Error('Telegram request deadline exceeded while waiting for the request gate'));
          }
        }, deadlineAt - Date.now());
      }
      this.waiters.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = undefined;
    }

    while (this.inFlight < this.concurrency && this.waiters.length) {
      const now = Date.now();
      const waiter = this.waiters[0];
      if (waiter.deadlineAt && now >= waiter.deadlineAt) {
        this.waiters.shift();
        if (waiter.timeout) clearTimeout(waiter.timeout);
        waiter.reject(new Error('Telegram request deadline exceeded while waiting for the request gate'));
        continue;
      }
      const readyAt = Math.max(this.nextRequestAt, this.blockedUntil);
      if (readyAt > now) {
        const deadlineDelay = waiter.deadlineAt ? Math.max(waiter.deadlineAt - now, 0) : Number.POSITIVE_INFINITY;
        this.wakeTimer = setTimeout(() => this.drain(), Math.min(readyAt - now, deadlineDelay));
        return;
      }

      this.nextRequestAt = now + Math.ceil(1000 / this.requestsPerSecond);
      this.inFlight += 1;
      this.waiters.shift();
      if (waiter.timeout) clearTimeout(waiter.timeout);
      waiter.resolve();
    }
  }

  private async renewPermit(permit: TelegramRequestPermit): Promise<void> {
    try {
      if (!await this.coordinator?.renewTelegramRequestPermit(permit)) {
        logger.warn('Telegram request permit was lost before the request completed');
      }
    } catch (err) {
      logger.error({ err }, 'failed to renew Telegram request permit');
    }
  }
}

export class TelegramReconciliationContext {
  readonly chatMetadata = new Map<string, CachedChatMetadata>();
  readonly senderUsernames = new Map<string, string | undefined>();

  constructor(readonly deadlineAt?: number) {}
}

export type TelegramHistoryPage = {
  messages: IncomingMessage[];
  maxSeenMessageId: bigint;
  rawMessageCount: number;
  hasMore: boolean;
};

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
  private readonly unresolvedSenderEntityWarnings = new Set<string>();
  private readonly requestGate: TelegramRequestGate;

  constructor(queueService: QueueService) {
    this.requestGate = new TelegramRequestGate(
      appConfig.reconciliation.chatConcurrency,
      appConfig.reconciliation.telegramRequestsPerSec,
      queueService,
    );
  }

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
      {
        connectionRetries: 10000,
        useWSS: appConfig.telegram.useWss,
      },
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
      logger.info(this.buildRawMessageLogContext(event.message), 'raw new message event received');

      if (!event.message) return;

      try {
        const msg = await this.parseMessage(event.message);
        if (!msg) {
          logger.info(this.buildRawMessageLogContext(event.message), 'message dropped by parseMessage (no media or unsupported type)');
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

      logger.info(this.buildRawMessageLogContext(apiMsg), 'raw edited message event received');

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
      await this.runTelegramRequest(undefined, () => this.client.getDialogs({ limit: 1000 }));
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
  }, context?: TelegramReconciliationContext): Promise<{ sizeBytes: bigint }> {
    const messages = await this.withPeerFallback(input.chatId, 'downloadMediaToFile/getMessages', async (peer) => {
      return this.client.getMessages(peer, {
        ids: [input.messageId],
      });
    }, context);

    const message = messages[0];
    if (!message?.media) {
      throw new Error(
        `No media found: chatId=${input.chatId}, messageId=${input.messageId}`,
      );
    }

    const buffer = await this.runTelegramRequest(
      context,
      async () => this.client.downloadMedia(message, {}) as Promise<Buffer>,
    );
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
    const page = await this.fetchHistoryPageAfter({
      ...input,
      limit: 3000,
    });
    return {
      messages: page.messages,
      maxSeenMessageId: page.maxSeenMessageId,
    };
  }

  createReconciliationContext(deadlineAt?: number): TelegramReconciliationContext {
    return new TelegramReconciliationContext(deadlineAt);
  }

  async fetchHistoryPageAfter(input: {
    chatId: bigint;
    afterMessageId: bigint;
    limit: number;
  }, context?: TelegramReconciliationContext): Promise<TelegramHistoryPage> {
    const pageSize = Math.min(100, Math.max(1, input.limit));
    const fromMessageId = Number(input.afterMessageId);
    const collected = await this.withPeerFallback(input.chatId, 'fetchHistoryPageAfter/iterMessages', async (peer) => {
      const rows: Api.Message[] = [];
      for await (const raw of this.client.iterMessages(peer, {
        minId: fromMessageId,
        reverse: true,
        limit: pageSize,
      })) {
        if (raw instanceof Api.Message) {
          rows.push(raw);
        }
      }
      return rows;
    }, context);

    let maxSeenMessageId = input.afterMessageId;
    const results: IncomingMessage[] = [];
    for (const raw of collected) {
      if (BigInt(raw.id) > maxSeenMessageId) {
        maxSeenMessageId = BigInt(raw.id);
      }
      const parsed = await this.parseMessage(raw, context);
      if (parsed) results.push(parsed);
    }

    if (collected.length >= pageSize) {
      logger.warn(
        {
          chatId: input.chatId.toString(),
          afterMessageId: input.afterMessageId.toString(),
          fetched: collected.length,
          pageSize,
        },
        'history page hit configured cap; additional pages may remain',
      );
    }

    return {
      messages: results,
      maxSeenMessageId,
      rawMessageCount: collected.length,
      hasMore: collected.length >= pageSize,
    };
  }

  private async parseMessage(msg: Api.Message, context?: TelegramReconciliationContext): Promise<IncomingMessage | null> {
    if (!msg.media || !msg.peerId) return null;

    const media = this.extractMedia(msg);
    if (!media.length) return null;

    const chatId = this.peerToChatId(msg.peerId);
    const senderId = msg.fromId ? this.peerToChatId(msg.fromId) : undefined;

    let chatTitle = '';
    let chatType: IncomingMessage['chatType'] = 'supergroup';
    const cachedChat = context?.chatMetadata.get(chatId.toString());
    if (cachedChat) {
      chatTitle = cachedChat.chatTitle;
      chatType = cachedChat.chatType;
    } else {
      try {
          const entity = await this.runTelegramRequest(context, () => this.client.getEntity(msg.peerId));
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
      context?.chatMetadata.set(chatId.toString(), { chatTitle, chatType });
    }

    // Resolve sender username (Telegram users may or may not have one)
    let senderUsername: string | undefined;
    if (msg.fromId) {
      const senderKey = senderId?.toString() ?? msg.fromId.className;
      if (context?.senderUsernames.has(senderKey)) {
        senderUsername = context.senderUsernames.get(senderKey);
      } else {
        let senderEntityResolved = false;
        try {
          const senderEntity = await this.runTelegramRequest(context, () => this.client.getEntity(msg.fromId!));
          senderEntityResolved = true;
          if ('username' in senderEntity && typeof senderEntity.username === 'string' && senderEntity.username) {
            senderUsername = senderEntity.username.toLowerCase();
          }
        } catch {
          if (!this.unresolvedSenderEntityWarnings.has(senderKey)) {
            this.unresolvedSenderEntityWarnings.add(senderKey);
            logger.warn({ senderId: senderId?.toString() }, 'failed to resolve sender entity');
          }
        }
        // Cache a confirmed missing username, but retry a transient entity
        // lookup failure on the next message in the same reconciliation run.
        if (senderEntityResolved) {
          context?.senderUsernames.set(senderKey, senderUsername);
        }
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

  private async runTelegramRequest<T>(
    context: TelegramReconciliationContext | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.requestGate.run(work, context?.deadlineAt);
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

  private buildRawMessageLogContext(message?: Api.Message): Record<string, unknown> {
    const chatId = message?.peerId ? this.tryPeerToChatId(message.peerId) : undefined;
    const senderId = message?.fromId ? this.tryPeerToChatId(message.fromId) : undefined;
    const groupedId = message?.groupedId ? biToNative(message.groupedId) : undefined;

    return {
      hasMessage: !!message,
      messageId: message?.id,
      groupedId: groupedId?.toString(),
      hasMedia: !!message?.media,
      mediaType: message?.media?.className,
      peerId: message?.peerId?.className,
      chatId: chatId?.toString(),
      senderPeerType: message?.fromId?.className,
      senderId: senderId?.toString(),
    };
  }

  private tryPeerToChatId(peer: Api.TypePeer): bigint | undefined {
    try {
      return this.peerToChatId(peer);
    } catch {
      return undefined;
    }
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
    context?: TelegramReconciliationContext,
  ): Promise<T> {
    const candidateIds = this.expandChatIdAliases(chatId);
    let lastErr: unknown;

    for (const candidateId of candidateIds) {
      try {
        return await this.runTelegramRequest(context, () => worker(this.chatIdToPeer(candidateId)));
      } catch (err) {
        lastErr = err;
        if (telegramFloodWaitSeconds(err)) {
          throw err;
        }
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
    const resolutionHint = this.peerResolutionHint(chatId, info.errorMessage);
    logger.warn(
      {
        operation,
        inputChatId: chatId.toString(),
        candidates: candidateIds.map((x) => x.toString()),
        rpcCode: info.code,
        rpcMessage: info.errorMessage,
        resolutionHint,
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

  private peerResolutionHint(chatId: bigint, errorMessage?: string): string | undefined {
    if (!errorMessage?.includes('Could not find the input entity')) {
      return undefined;
    }
    if (chatId >= 0n) {
      return undefined;
    }
    return 'Telegram session cannot resolve this chat entity. Ensure the session account is a member of the chat, then regenerate or warm the session dialogs.';
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
