import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { MediaStatus } from '@prisma/client';
import { BearerAuthGuard } from './auth.guard';
import { StatsService } from './stats.service';

@UseGuards(BearerAuthGuard)
@Controller('api')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('stats/overview')
  overview(): Promise<Record<string, unknown>> {
    return this.statsService.overview();
  }

  @Get('dashboard/overview')
  dashboardOverview(): Promise<Record<string, unknown>> {
    return this.statsService.dashboardOverview();
  }

  @Get('stats/today')
  today(
    @Query('date') date?: string,
  ): Promise<Record<string, unknown>[]> {
    return this.statsService.today(date);
  }

  @Get('stats/groups/:chatId/media')
  groupMedia(
    @Param('chatId') chatId: string,
    @Query('status') status?: MediaStatus,
    @Query('mediaType') mediaType?: 'photo' | 'video' | 'document',
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ): Promise<Record<string, unknown>> {
    return this.statsService.groupMedia({
      chatId: BigInt(chatId),
      status,
      mediaType,
      limit: Number(limit),
      offset: Number(offset),
    });
  }

  @Get('health')
  health(): Promise<Record<string, unknown>> {
    return this.statsService.health();
  }
}
