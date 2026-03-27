import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SharedModule } from '@shared/services/shared.module';
import { BearerAuthGuard } from './auth.guard';
import { BotService } from './bot.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [SharedModule, ScheduleModule.forRoot()],
  controllers: [StatsController, MessagesController],
  providers: [StatsService, MessagesService, BearerAuthGuard, BotService],
})
export class AppModule {}
