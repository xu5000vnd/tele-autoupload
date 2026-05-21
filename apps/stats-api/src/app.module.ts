import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SharedModule } from '@shared/services/shared.module';
import { AuthController } from './auth.controller';
import { BearerAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { BotService } from './bot.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ReminderSchedulesController } from './reminder-schedules.controller';
import { ReminderSchedulesService } from './reminder-schedules.service';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [SharedModule, ScheduleModule.forRoot()],
  controllers: [AuthController, StatsController, MessagesController, ReminderSchedulesController],
  providers: [AuthService, StatsService, MessagesService, ReminderSchedulesService, BearerAuthGuard, BotService],
})
export class AppModule {}
