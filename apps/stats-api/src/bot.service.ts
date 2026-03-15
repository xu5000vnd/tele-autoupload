import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Bot } from 'grammy';
import { appConfig } from '@shared/config/env';
import { logger } from '@shared/utils/logger';
import { StatsService } from './stats.service';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private bot?: Bot;

  constructor(private readonly statsService: StatsService) {}

  async onModuleInit(): Promise<void> {
    if (!appConfig.botToken) {
      logger.info('BOT_TOKEN not set — Telegram bot disabled');
      return;
    }

    this.bot = new Bot(appConfig.botToken);

    this.bot.command('start', async (ctx) => {
      await ctx.reply(
        '👋 Hello! I\'m your upload summary bot.\n\n' +
        'Commands:\n' +
        '/today — summary for today\n' +
        '/today 2026-02-25 — summary for a specific date',
      );
    });

    // /today  or  /today 2026-02-25
    this.bot.command('today', async (ctx) => {
      const dateArg = ctx.match?.trim() || undefined;
      try {
        const rows = await this.statsService.today(dateArg);
        await ctx.reply(this.formatSummary(rows, dateArg), { parse_mode: 'HTML' });
      } catch (err) {
        logger.error({ err }, 'bot: failed to fetch today stats');
        await ctx.reply('⚠️ Failed to fetch stats. Please try again.');
      }
    });

    // Start long-polling in the background (do NOT await — it runs forever)
    this.bot.start({ drop_pending_updates: true }).catch((err) => {
      logger.error({ err }, 'bot polling stopped unexpectedly');
    });

    logger.info('telegram bot started (long-polling)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.bot?.stop();
    logger.info('telegram bot stopped');
  }

  // Send an automatic daily summary at 09:00 UTC every day
  @Cron('0 9 * * *')
  async sendDailySummary(): Promise<void> {
    if (!this.bot || !appConfig.botReportChatId) return;

    try {
      const rows = await this.statsService.today();
      await this.bot.api.sendMessage(
        appConfig.botReportChatId,
        this.formatSummary(rows),
        { parse_mode: 'HTML' },
      );
      logger.info('daily summary sent via bot');
    } catch (err) {
      logger.error({ err }, 'bot: failed to send daily summary');
    }
  }

  private formatSummary(rows: Record<string, unknown>[], dateArg?: string): string {
    const date = rows[0]
      ? (rows[0] as { date: string }).date
      : (dateArg ?? new Date().toISOString().slice(0, 10));

    const activeRows = rows
      .map((r) => r as {
        tu_name: string;
        telegram_username: string | null;
        media: { image: number; video: number; total: number };
        status_uploaded: { success: number; failed: number };
      })
      .filter((row) => row.media.total > 0);

    if (!activeRows.length) {
      return `📭 <b>No users uploaded media on ${date}.</b>`;
    }

    const lines = activeRows.map((row) => {
      const handle = row.telegram_username ? `@${row.telegram_username}` : 'no username';
      return (
        `👤 <b>${row.tu_name}</b> (${handle})\n` +
        `   🖼 ${row.media.image} images  🎬 ${row.media.video} videos  📦 Total: <b>${row.media.total}</b>\n` +
        `   ✅ Uploaded: ${row.status_uploaded.success}  ❌ Failed: ${row.status_uploaded.failed}`
      );
    });

    return `📊 <b>Summary — ${date}</b>\n\n${lines.join('\n\n')}`;
  }
}
