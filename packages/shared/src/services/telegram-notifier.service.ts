import { Injectable } from '@nestjs/common';
import { Bot } from 'grammy';
import { appConfig } from '@shared/config/env';
import { logger } from '@shared/utils/logger';

@Injectable()
export class TelegramNotifierService {
  private readonly bot?: Bot;
  private readonly reportChatId?: string;

  constructor() {
    if (!appConfig.botToken || !appConfig.botReportChatId) {
      return;
    }

    this.bot = new Bot(appConfig.botToken);
    this.reportChatId = appConfig.botReportChatId;
  }

  async notify(text: string): Promise<void> {
    if (!this.bot || !this.reportChatId) return;

    try {
      await this.bot.api.sendMessage(this.reportChatId, text);
    } catch (err) {
      logger.error({ err, reportChatId: this.reportChatId }, 'failed to send bot notification');
    }
  }
}
