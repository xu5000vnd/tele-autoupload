import { Injectable } from '@nestjs/common';
import { MediaStatus } from '@prisma/client';
import { appConfig } from '@shared/config/env';
import { PrismaService } from '@shared/db/prisma.service';
import { QueueService } from '@shared/queue/queue.service';
import { stagingUsage } from '@shared/utils/disk';

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  async overview(): Promise<Record<string, unknown>> {
    const [uploadCounts, staging] = await Promise.all([
      this.queueService.uploadQueue.getJobCounts(),
      stagingUsage({ stagingDir: appConfig.stagingDir, maxGb: appConfig.maxStagingSizeGb }),
    ]);

    return {
      uptime_seconds: Math.floor(process.uptime()),
      telegram_connected: true,
      queues: {
        upload: uploadCounts,
      },
      staging: {
        used_gb: Number(staging.usedGb.toFixed(2)),
        cap_gb: appConfig.maxStagingSizeGb,
        used_pct: Number(staging.usedPct.toFixed(2)),
        backpressure_active: staging.usedPct >= appConfig.highWatermarkPct,
      },
    };
  }

  async groupMedia(input: {
    chatId: bigint;
    status?: MediaStatus;
    mediaType?: 'photo' | 'video' | 'document';
    limit: number;
    offset: number;
  }): Promise<Record<string, unknown>> {
    const where: Record<string, unknown> = {
      chatId: input.chatId,
    };
    if (input.status) where.status = input.status;
    if (input.mediaType) where.mediaType = input.mediaType;

    const [total, items] = await Promise.all([
      this.prisma.mediaItem.count({ where: where as never }),
      this.prisma.mediaItem.findMany({
        where: where as never,
        take: input.limit,
        skip: input.offset,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { total, items };
  }

  async health(): Promise<Record<string, unknown>> {
    const [dbOk, redisOk, staging] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`,
      this.queueService.uploadQueue.getJobCounts(),
      stagingUsage({ stagingDir: appConfig.stagingDir, maxGb: appConfig.maxStagingSizeGb }),
    ]);

    void dbOk;
    void redisOk;

    const degraded = staging.usedPct >= appConfig.highWatermarkPct;

    return {
      status: degraded ? 'degraded' : 'healthy',
      checks: {
        postgres: { status: 'up' },
        redis: { status: 'up' },
        staging_disk: { status: degraded ? 'warning' : 'ok', used_pct: Number(staging.usedPct.toFixed(2)) },
      },
      started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    };
  }

  async today(dateStr?: string): Promise<Record<string, unknown>[]> {
    const targetDate = dateStr ?? new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${targetDate}T00:00:00.000Z`);
    const dayEnd = new Date(`${targetDate}T23:59:59.999Z`);

    const [users, counts] = await Promise.all([
      this.prisma.userTu.findMany({ where: { status: 'active' } }),
      // Single GROUP BY including status so we can derive both media counts and upload outcomes
      this.prisma.mediaItem.groupBy({
        by: ['senderId', 'chatId', 'mediaType', 'status'],
        where: { date: { gte: dayStart, lte: dayEnd } },
        _count: { id: true },
      }),
    ]);

    type Bucket = { photo: number; video: number; success: number; failed: number };
    const countMap = new Map<string, Bucket>();

    for (const row of counts) {
      if (!row.senderId) continue;
      const key = `${row.senderId}_${row.chatId}`;
      if (!countMap.has(key)) countMap.set(key, { photo: 0, video: 0, success: 0, failed: 0 });
      const b = countMap.get(key)!;
      const n = row._count.id;

      if (row.mediaType === 'photo') b.photo += n;
      if (row.mediaType === 'video') b.video += n;
      if (row.status === 'uploaded') b.success += n;
      if (row.status === 'failed')   b.failed  += n;
    }

    return users.map((user) => {
      const key = `${user.telegramUserId}_${user.telegramChatId}`;
      const b = countMap.get(key) ?? { photo: 0, video: 0, success: 0, failed: 0 };
      return {
        tu_id: user.tuId,
        tu_name: user.tuName,
        path: user.path ?? null,
        telegram_user_id: user.telegramUserId.toString(),
        telegram_username: user.username ?? null,
        telegram_chat_id: user.telegramChatId.toString(),
        media: {
          image: b.photo,
          video: b.video,
          total: b.photo + b.video,
        },
        status_uploaded: {
          success: b.success,
          failed:  b.failed,
        },
        date: targetDate,
      };
    });
  }

}
