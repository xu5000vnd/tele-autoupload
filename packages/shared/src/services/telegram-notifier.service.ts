import { Injectable } from '@nestjs/common';
import { BotTelegramService } from '@shared/telegram/bot-telegram.service';
import { appConfig } from '@shared/config/env';
import { logger } from '@shared/utils/logger';

@Injectable()
export class TelegramNotifierService {
  constructor(private readonly bot: BotTelegramService) {}

  async notify(text: string): Promise<void> {
    if (!appConfig.botReportChatId) return;

    try {
      await this.bot.call('sendMessage', { chat_id: appConfig.botReportChatId, text });
    } catch (err) {
      logger.error({ err, reportChatId: appConfig.botReportChatId }, 'failed to send bot notification');
    }
  }
}
