import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Message, Update, User } from 'grammy/types';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { appConfig } from '@shared/config/env';
import { PrismaService } from '@shared/db/prisma.service';
import { QueueService, RedisLease } from '@shared/queue/queue.service';
import { UploadSummaryService } from '@shared/services/upload-summary.service';
import { IncomingMedia, IncomingMessage } from '@shared/types/telegram';
import { logger } from '@shared/utils/logger';

export class BotApiError extends Error {
  constructor(readonly code: number, readonly retryAfter?: number) {
    super(`Local Telegram Bot API request failed (${code})`);
  }
}

export function chatIdAliases(chatId: bigint): bigint[] {
  const ids = new Set([chatId]);
  const positive = -chatId;
  if (positive > 1_000_000_000_000n) {
    const raw = positive - 1_000_000_000_000n;
    ids.add(-raw);
    ids.add(BigInt(`-100${raw}`));
  } else if (positive > 2_147_483_647n) {
    ids.add(-(1_000_000_000_000n + positive));
    ids.add(BigInt(`-100${positive}`));
  } else if (positive.toString().startsWith('100') && positive.toString().length > 3) {
    const raw = BigInt(positive.toString().slice(3));
    ids.add(-raw);
    ids.add(-(1_000_000_000_000n + raw));
  }
  return [...ids];
}

export function botMessage(update: Update): Message | undefined {
  return update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
}

export function parseBotMedia(update: Update, botId: bigint, revision: bigint): IncomingMessage | null {
  const message = botMessage(update);
  if (!message || message.chat.type === 'private') return null;
  const media: IncomingMedia[] = [];
  const add = (file: { file_id: string; file_unique_id: string; file_size?: number; file_name?: string; mime_type?: string }, type: IncomingMedia['type'], mimeType?: string) => {
    media.push({ type, fileId: file.file_id, uniqueId: file.file_unique_id,
      fileName: file.file_name, mimeType: file.mime_type ?? mimeType,
      size: file.file_size === undefined ? undefined : BigInt(file.file_size), mediaIndex: 0 });
  };
  if (message.photo?.length) {
    const largest = [...message.photo].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    add(largest, 'photo', 'image/jpeg');
  } else if (message.video) add(message.video, 'video');
  else if (message.animation) add(message.animation, 'video');
  else if (message.document) add(message.document, 'document');
  else if (message.audio) add(message.audio, 'document');
  else if (message.voice) add(message.voice, 'document');
  else if (message.video_note) add(message.video_note, 'video', 'video/mp4');
  else if (message.sticker) add(message.sticker, message.sticker.is_video ? 'video' : 'document', message.sticker.is_video ? 'video/webm' : message.sticker.is_animated ? 'application/x-tgsticker' : 'image/webp');
  if (!media.length) return null;
  return {
    chatId: BigInt(message.chat.id), chatTitle: message.chat.title,
    chatType: message.chat.type, messageId: BigInt(message.message_id),
    albumId: message.media_group_id, transport: 'bot', botId, sourceRevision: revision,
    senderId: message.sender_chat || !message.from ? undefined : BigInt(message.from.id),
    senderUsername: message.sender_chat ? undefined : message.from?.username?.toLowerCase(),
    date: new Date(message.date * 1000), media,
  };
}

@Injectable()
export class BotTelegramService {
  private identity?: Promise<User>;
  private stopped = true;
  private loop?: Promise<void>;
  private dispatchLoop?: Promise<void>;
  private controller?: AbortController;
  private blockedUntil = 0;
  private captureCheckedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly summary: UploadSummaryService,
  ) {}

  async call<T>(method: string, parameters: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    if (Date.now() < this.blockedUntil) throw new BotApiError(429, Math.ceil((this.blockedUntil - Date.now()) / 1000));
    let body: { ok: boolean; result: T; error_code?: number; parameters?: { retry_after?: number } };
    try {
      const response = await fetch(`${appConfig.botApiRoot}/bot${appConfig.botToken}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parameters), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout((appConfig.botPollTimeoutSec + 10) * 1000)]) : AbortSignal.timeout(method === 'getFile' ? 30 * 60_000 : 30_000),
      });
      body = await response.json() as typeof body;
      if (!response.ok && body.ok) throw new Error('Invalid Bot API response');
    } catch {
      throw new BotApiError(503);
    }
    if (!body.ok) {
      const retryAfter = body.parameters?.retry_after;
      if (retryAfter) this.blockedUntil = Date.now() + retryAfter * 1000;
      throw new BotApiError(body.error_code ?? 502, retryAfter);
    }
    return body.result;
  }

  async getMe(): Promise<User> {
    if (!this.identity) {
      this.identity = this.call<User>('getMe').catch((error) => { this.identity = undefined; throw error; });
    }
    return this.identity;
  }

  async sendSummary(chatId: string | number, html: string): Promise<void> {
    if (html.length <= 4000) {
      await this.call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML' });
      return;
    }
    // Long reports use plain text so chunk boundaries cannot break HTML entities/tags.
    let text = html.replace(/<\/?b>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    while (text.length) {
      let end = Math.min(text.length, 4000);
      if (end < text.length) {
        const newline = text.lastIndexOf('\n', end);
        if (newline > 0) end = newline;
        else if (/[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
      }
      await this.call('sendMessage', { chat_id: chatId, text: text.slice(0, end) });
      text = text.slice(end).replace(/^\n/, '');
    }
  }

  async download(reference: { fileId: string; botId: bigint }, destinationPath: string): Promise<{ sizeBytes: bigint }> {
    if (reference.botId !== BigInt((await this.getMe()).id)) throw new Error('Media belongs to another bot; resubmit it to the configured bot');
    const file = await this.call<{ file_path?: string }>('getFile', { file_id: reference.fileId });
    if (!file.file_path || !path.isAbsolute(file.file_path)) throw new Error('Local Bot API must run in local mode with a shared absolute file path');
    const cacheRoot = await fs.realpath(appConfig.botApiCacheDir);
    const source = await fs.realpath(file.file_path);
    const relative = path.relative(cacheRoot, source);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Bot file path is outside BOT_API_CACHE_DIR');
    await fs.copyFile(source, destinationPath);
    const sizeBytes = (await fs.stat(destinationPath, { bigint: true })).size;
    if (!sizeBytes) throw new Error('Local Bot API returned an empty file');
    return { sizeBytes };
  }

  async isConfiguredChat(chatId: bigint): Promise<boolean> {
    const aliases = chatIdAliases(chatId);
    const groups = await this.prisma.groupState.findMany({ where: { chatId: { in: aliases } }, select: { isActive: true } });
    if (groups.some((group) => !group.isActive)) return false;
    if (groups.length) return true;
    return (await this.prisma.userTu.count({ where: { telegramChatId: { in: aliases } } })) > 0;
  }

  start(handler: (message: IncomingMessage) => Promise<boolean>): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.loop = this.receive().catch((error) => logger.error({ err: error }, 'bot receiver stopped'));
    this.dispatchLoop = this.dispatch(handler).catch((error) => logger.error({ err: error }, 'bot inbox dispatcher stopped'));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.controller?.abort();
    await Promise.all([this.loop, this.dispatchLoop]);
  }

  private async pause(milliseconds: number): Promise<void> {
    for (let elapsed = 0; !this.stopped && elapsed < milliseconds; elapsed += 100) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, milliseconds - elapsed)));
    }
  }

  private async receive(): Promise<void> {
    while (!this.stopped) {
      let lease: RedisLease | null = null;
      let renewal: NodeJS.Timeout | undefined;
      let botId: bigint | undefined;
      let ownsLease = true;
      try {
        botId = BigInt((await this.getMe()).id);
        lease = await this.queue.acquireLease(`tele-autoupload:bot-receiver:${botId}`, appConfig.botReceiverLeaseTtlMs);
        if (!lease) { await this.pause(1000); continue; }
        const activeLease = lease;
        const loseOwnership = () => { ownsLease = false; this.controller?.abort(); };
        renewal = setInterval(() => {
          void this.queue.renewLease(activeLease).then((owned) => { if (!owned) loseOwnership(); }).catch(loseOwnership);
        }, Math.floor(appConfig.botReceiverLeaseTtlMs / 3));
        let state = await this.prisma.botReceiverState.upsert({ where: { botId }, create: { botId, leaseToken: lease.token }, update: { leaseToken: lease.token } });
        while (!this.stopped && ownsLease) {
          // Reset before a long poll can cross Telegram's one-week idle boundary.
          if (state.nextOffset > 0 && Date.now() - state.lastUpdateAt.getTime() >= 7 * 86400_000 - 60_000) {
            const lastUpdateAt = new Date();
            const reset = await this.prisma.botReceiverState.updateMany({ where: { botId, leaseToken: lease.token },
              data: { nextOffset: 0, epoch: { increment: 1 }, lastUpdateAt } });
            if (reset.count !== 1) throw new Error('Bot receiver ownership lost before resetting an idle offset');
            state = { ...state, nextOffset: 0, epoch: state.epoch + 1, lastUpdateAt };
          }
          await this.recordCaptureStarts(botId);
          if (this.stopped || !ownsLease) break;
          this.controller = new AbortController();
          const poll = await this.prisma.botReceiverState.updateMany({ where: { botId, leaseToken: lease.token }, data: { lastPollAt: new Date() } });
          if (poll.count !== 1) throw new Error('Bot receiver ownership lost before polling');
          const updates = await this.call<Update[]>('getUpdates', { offset: state.nextOffset, timeout: appConfig.botPollTimeoutSec, limit: 100,
            allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post', 'my_chat_member'] }, this.controller.signal);
          if (this.stopped || !ownsLease || !await this.queue.renewLease(lease)) break;
          state = await this.persistBatch(botId, state.epoch, updates, lease.token, state.nextOffset);
        }
      } catch (error) {
        logger.warn({ err: error }, 'bot polling deferred');
        if (botId && lease && ownsLease) {
          await this.prisma.botReceiverState.updateMany({ where: { botId, leaseToken: lease.token }, data: { lastError: 'Bot polling failed' } }).catch(() => undefined);
        }
        await this.pause(error instanceof BotApiError && error.retryAfter ? error.retryAfter * 1000 : 1000);
      } finally {
        if (renewal) clearInterval(renewal);
        this.controller = undefined;
        if (lease) await this.queue.releaseLease(lease).catch(() => undefined);
      }
    }
  }

  private async recordCaptureStarts(botId: bigint): Promise<void> {
    if (Date.now() - this.captureCheckedAt < 60_000) return;
    const [groups, users] = await Promise.all([
      this.prisma.groupState.findMany({ where: { isActive: true }, select: { chatId: true } }),
      this.prisma.userTu.findMany({ select: { telegramChatId: true } }),
    ]);
    for (const chatId of new Set([...groups.map((g) => g.chatId), ...users.map((u) => u.telegramChatId)])) {
      if (await this.isConfiguredChat(chatId)) await this.prisma.botChatCapture.upsert({ where: { botId_chatId: { botId, chatId } }, create: { botId, chatId }, update: {} });
    }
    this.captureCheckedAt = Date.now();
  }

  async persistBatch(botId: bigint, epoch: number, updates: Update[], leaseToken: string, previousOffset: number) {
    const accepted: Array<{ update: Update; message?: Message }> = [];
    for (const update of updates) {
      const message = botMessage(update);
      if (message && (await this.isCommand(message) || (parseBotMedia(update, botId, 0n) && await this.isConfiguredChat(BigInt(message.chat.id))))) accepted.push({ update, message });
      else if (update.my_chat_member && await this.isConfiguredChat(BigInt(update.my_chat_member.chat.id))) accepted.push({ update });
    }
    const nextOffset = updates.length ? Math.max(...updates.map((u) => u.update_id)) + 1 : previousOffset;
    const lastUpdateAt = updates.length ? new Date(Math.max(...updates.map((update) => {
      const message = botMessage(update);
      const generatedAt = message?.edit_date ?? message?.date ?? update.my_chat_member?.date;
      // Unknown queued update kinds may already be a full retention window old.
      return generatedAt === undefined ? Date.now() - 86400_000 : Math.min(Date.now(), generatedAt * 1000);
    }))) : undefined;
    return this.prisma.$transaction(async (tx) => {
      for (const { update, message } of accepted) {
        if (update.my_chat_member) {
          const chatId = BigInt(update.my_chat_member.chat.id);
          await tx.botChatCapture.upsert({ where: { botId_chatId: { botId, chatId } },
            create: { botId, chatId, membershipStatus: update.my_chat_member.new_chat_member.status },
            update: { membershipStatus: update.my_chat_member.new_chat_member.status } });
        }
        await tx.botUpdateInbox.upsert({ where: { botId_epoch_updateId: { botId, epoch, updateId: update.update_id } }, update: {}, create: {
          botId, epoch, updateId: update.update_id, payload: update as unknown as Prisma.InputJsonValue,
          chatId: message ? BigInt(message.chat.id) : null, messageId: message ? BigInt(message.message_id) : null,
          messageDate: message ? new Date(message.date * 1000) : null,
          senderId: message?.from && !message.sender_chat ? BigInt(message.from.id) : null,
          senderUsername: message?.sender_chat ? null : message?.from?.username?.toLowerCase(),
        } });
      }
      const result = await tx.botReceiverState.updateMany({ where: { botId, leaseToken }, data: { nextOffset, lastSuccessAt: new Date(), lastError: null, ...(lastUpdateAt ? { lastUpdateAt } : {}) } });
      if (result.count !== 1) throw new Error('Bot receiver ownership lost before committing updates');
      return tx.botReceiverState.findUniqueOrThrow({ where: { botId } });
    });
  }

  private async isCommand(message: Message): Promise<boolean> {
    const match = /^\/(start|today)(?:@(\w+))?(?:\s|$)/.exec(message.text ?? '');
    if (!match) return false;
    if (match[2] && match[2].toLowerCase() !== (await this.getMe()).username?.toLowerCase()) return false;
    return message.chat.type === 'private' || String(message.chat.id) === appConfig.botReportChatId || await this.isConfiguredChat(BigInt(message.chat.id));
  }

  async processPending(handler: (message: IncomingMessage) => Promise<boolean>, botId: bigint, shouldContinue: () => boolean): Promise<void> {
    const rows = await this.prisma.botUpdateInbox.findMany({ where: { botId, status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: new Date() } }, orderBy: { id: 'asc' }, take: 100 });
    for (const row of rows) {
      if (!shouldContinue()) return;
      const receiptWhere = { id: row.id, status: row.status, attempts: row.attempts };
      let command = false;
      try {
        const update = row.payload as unknown as Update;
        const raw = botMessage(update);
        let status = 'ignored';
        command = !!raw && await this.isCommand(raw);
        if (raw && command) {
          const text = raw.text ?? '';
          const dateArg = text.split(/\s+/)[1];
          let reply: string;
          try {
            reply = text.startsWith('/today')
              ? this.summary.formatSummary(await this.summary.today(dateArg), dateArg)
              : '👋 Hello! I\'m your upload summary bot.\n\nCommands:\n/today — summary for today\n/today 2026-02-25 — summary for a specific date';
          } catch {
            reply = '⚠️ Failed to fetch stats. Please try again.';
          }
          await this.sendSummary(raw.chat.id, reply);
          status = 'processed';
        } else {
          const message = parseBotMedia(update, botId, row.id);
          if (message && await this.isConfiguredChat(message.chatId)) status = await handler(message) ? 'processed' : 'unmatched';
        }
        if (!shouldContinue()) return;
        await this.prisma.botUpdateInbox.updateMany({ where: receiptWhere, data: { status, attempts: { increment: 1 }, lastError: null } });
      } catch (error) {
        if (!shouldContinue()) return;
        if (command && error instanceof BotApiError && (error.code === 400 || error.code === 403)) {
          await this.prisma.botUpdateInbox.updateMany({ where: receiptWhere, data: { status: 'ignored', attempts: { increment: 1 }, lastError: 'Bot command delivery was rejected' } });
          continue;
        }
        await this.prisma.botUpdateInbox.updateMany({ where: receiptWhere, data: { status: 'failed', attempts: { increment: 1 }, lastError: 'Captured update processing failed', nextAttemptAt: new Date(Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(row.attempts + 1, 9))) } });
        logger.warn({ err: error, receiptId: row.id.toString() }, 'bot inbox update deferred');
      }
    }
  }

  private async dispatch(handler: (message: IncomingMessage) => Promise<boolean>): Promise<void> {
    while (!this.stopped) {
      let lease: RedisLease | null = null;
      let renewal: NodeJS.Timeout | undefined;
      let ownsLease = true;
      try {
        const botId = BigInt((await this.getMe()).id);
        lease = await this.queue.acquireLease(`tele-autoupload:bot-dispatch:${botId}`, appConfig.botReceiverLeaseTtlMs);
        if (lease) {
          const activeLease = lease;
          renewal = setInterval(() => { void this.queue.renewLease(activeLease).then((owned) => { if (!owned) ownsLease = false; }).catch(() => { ownsLease = false; }); }, Math.floor(appConfig.botReceiverLeaseTtlMs / 3));
          await this.processPending(handler, botId, () => !this.stopped && ownsLease);
        }
      } catch (error) { logger.warn({ err: error }, 'bot dispatch deferred'); }
      finally {
        if (renewal) clearInterval(renewal);
        if (lease) await this.queue.releaseLease(lease).catch(() => undefined);
      }
      await this.pause(1000);
    }
  }

  async readiness(): Promise<{ ready: boolean; api_ready: boolean; receiver_last_success_at: string | null; error: string | null }> {
    try {
      const me = await this.call<User>('getMe');
      const state = await this.prisma.botReceiverState.findUnique({ where: { botId: BigInt(me.id) } });
      const denied = await this.prisma.botChatCapture.findMany({ where: { botId: BigInt(me.id), membershipStatus: { in: ['left', 'kicked'] } }, select: { chatId: true } });
      let deniedSource = false;
      for (const chat of denied) {
        if (await this.isConfiguredChat(chat.chatId)) { deniedSource = true; break; }
      }
      const ready = !deniedSource && !!state?.lastSuccessAt && !state.lastError && Date.now() - state.lastSuccessAt.getTime() < appConfig.botReceiverLeaseTtlMs;
      return { ready, api_ready: true, receiver_last_success_at: state?.lastSuccessAt?.toISOString() ?? null, error: deniedSource ? 'Bot has left a configured source chat' : state?.lastError ?? null };
    } catch { return { ready: false, api_ready: false, receiver_last_success_at: null, error: 'Local Bot API unavailable' }; }
  }
}
