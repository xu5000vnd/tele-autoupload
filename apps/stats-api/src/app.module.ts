import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SharedModule } from '@shared/services/shared.module';
import { BearerAuthGuard } from './auth.guard';
import { BotService } from './bot.service';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [SharedModule, ScheduleModule.forRoot()],
  controllers: [StatsController],
  providers: [StatsService, BearerAuthGuard, BotService],
})
export class AppModule {}
