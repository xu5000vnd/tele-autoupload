import { BotTelegramService } from '@shared/telegram/bot-telegram.service';
import { UploadSummaryService } from '@shared/services/upload-summary.service';
import { Global, Module } from '@nestjs/common';
import { PrismaService } from '@shared/db/prisma.service';
import { QueueService } from '@shared/queue/queue.service';
import { JobEventLogService } from '@shared/services/job-event-log.service';
import { MediaService } from '@shared/services/media.service';
import { TelegramGateway } from '@shared/telegram/telegram-gateway';
import { DriveApiStrategy } from '@shared/drive/drive-api.strategy';
import { DriveDesktopStrategy } from '@shared/drive/drive-desktop.strategy';
import { PlaywrightStrategy } from '@shared/drive/playwright.strategy';
import { UploaderFactoryService } from '@shared/drive/uploader-factory.service';
import { TelegramNotifierService } from '@shared/services/telegram-notifier.service';

@Global()
@Module({
  providers: [
    PrismaService,
    BotTelegramService,
    UploadSummaryService,
    QueueService,
    JobEventLogService,
    MediaService,
    TelegramGateway,
    DriveApiStrategy,
    DriveDesktopStrategy,
    PlaywrightStrategy,
    UploaderFactoryService,
    TelegramNotifierService,
  ],
  exports: [
    PrismaService,
    BotTelegramService,
    UploadSummaryService,
    QueueService,
    JobEventLogService,
    MediaService,
    TelegramGateway,
    UploaderFactoryService,
    TelegramNotifierService,
  ],
})
export class SharedModule {}
