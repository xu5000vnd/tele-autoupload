import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { appConfig } from '@shared/config/env';
import { BotTelegramService } from '@shared/telegram/bot-telegram.service';
import { UploadSummaryService } from '@shared/services/upload-summary.service';
import { logger } from '@shared/utils/logger';

@Injectable()
export class BotService {
  constructor(private readonly bot: BotTelegramService, private readonly summary: UploadSummaryService) {}

  @Cron('0 9 * * *')
  async sendDailySummary(): Promise<void> {
    if (!appConfig.botReportChatId) return;
    try {
      await this.bot.sendSummary(appConfig.botReportChatId, this.summary.formatSummary(await this.summary.today()));
    } catch (err) {
      logger.error({ err }, 'daily bot summary failed');
    }
  }
}
