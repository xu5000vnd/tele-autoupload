import { Injectable } from '@nestjs/common';
import { MediaStatus } from '@prisma/client';
import { appConfig } from '@shared/config/env';
import { PrismaService } from '@shared/db/prisma.service';
import { QueueService } from '@shared/queue/queue.service';
import { stagingUsage } from '@shared/utils/disk';
import { logger } from '@shared/utils/logger';

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  private get prismaAny(): any {
    return this.prisma as any;
  }

  private hasCampaignStorage(): boolean {
    return Boolean(
      this.prismaAny?.messageCampaign &&
      this.prismaAny?.messageCampaignMedia,
    );
  }

  private isCampaignStoragePrismaError(err: unknown): boolean {
    if (!err || typeof err !== 'object') {
      return false;
    }
    const maybeCode = 'code' in err ? String((err as Record<string, unknown>).code ?? '') : '';
    if (maybeCode === 'P2021' || maybeCode === 'P2022') {
      return true;
    }
    const maybeMessage = 'message' in err ? String((err as Record<string, unknown>).message ?? '') : '';
    return maybeMessage.includes('message_campaign');
  }

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

  async dashboardOverview(): Promise<Record<string, unknown>> {
    const today = new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${today}T00:00:00.000Z`);
    const dayEnd = new Date(`${today}T23:59:59.999Z`);

    const [uploadCounts, staging, mediaCountsByStatus, topUploadersRows, activeUploaderRows, recentActivityRows, recentFailureRows, activeUsers] = await Promise.all([
      this.queueService.uploadQueue.getJobCounts(),
      stagingUsage({ stagingDir: appConfig.stagingDir, maxGb: appConfig.maxStagingSizeGb }),
      this.prisma.mediaItem.groupBy({
        by: ['status'],
        where: { date: { gte: dayStart, lte: dayEnd } },
        _count: { id: true },
      }),
      this.prisma.mediaItem.groupBy({
        by: ['senderId', 'chatId'],
        where: {
          date: { gte: dayStart, lte: dayEnd },
          senderId: { not: null },
        },
        _count: { id: true },
        orderBy: {
          _count: { id: 'desc' },
        },
        take: 5,
      }),
      this.prisma.mediaItem.groupBy({
        by: ['senderId', 'chatId'],
        where: {
          date: { gte: dayStart, lte: dayEnd },
          senderId: { not: null },
        },
        _count: { id: true },
      }),
      this.prisma.mediaItem.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          senderId: true,
          chatId: true,
          mediaType: true,
          status: true,
          fileName: true,
          error: true,
        },
      }),
      this.prisma.mediaItem.groupBy({
        by: ['error'],
        where: {
          status: MediaStatus.failed,
          error: { not: null },
        },
        _count: { id: true },
        _max: { createdAt: true },
        orderBy: {
          _count: { id: 'desc' },
        },
        take: 10,
      }),
      this.prisma.userTu.findMany({
        where: { status: 'active' },
        select: {
          tuName: true,
          username: true,
          telegramUserId: true,
          telegramChatId: true,
        },
      }),
    ]);

    const statusCounts = new Map<string, number>();
    for (const row of mediaCountsByStatus) {
      statusCounts.set(row.status, row._count.id);
    }

    const userKeyMap = new Map(
      activeUsers.map((u) => [
        `${u.telegramUserId.toString()}_${u.telegramChatId.toString()}`,
        u,
      ]),
    );

    const topUploaders = topUploadersRows.map((row) => {
      const key = `${row.senderId?.toString() ?? 'unknown'}_${row.chatId.toString()}`;
      const matched = userKeyMap.get(key);
      return {
        tu_name: matched?.tuName ?? 'Unknown',
        telegram_username: matched?.username ?? null,
        sender_id: row.senderId?.toString() ?? null,
        chat_id: row.chatId.toString(),
        total: row._count.id,
      };
    });

    let campaigns: Array<Record<string, unknown>> = [];
    if (this.hasCampaignStorage()) {
      try {
        const rows = await this.prismaAny.messageCampaign.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            _count: { select: { medias: true } },
          },
        });
        campaigns = rows.map((row: any) => ({
          campaign_id: row.id,
          status: row.status,
          total_targets: row.totalTargets,
          success_targets: row.successTargets,
          failed_targets: row.failedTargets,
          media_count: row._count.medias,
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt?.toISOString() ?? null,
        }));
      } catch (err) {
        if (this.isCampaignStoragePrismaError(err)) {
          logger.warn({ err }, 'dashboard campaign snapshot unavailable; campaign storage not ready');
          campaigns = [];
        } else {
          throw err;
        }
      }
    }

    const totalReceived = Array.from(statusCounts.values()).reduce((acc, n) => acc + n, 0);

    return {
      generated_at: new Date().toISOString(),
      health: {
        status: staging.usedPct >= appConfig.highWatermarkPct ? 'degraded' : 'healthy',
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
      },
      today_summary: {
        date: today,
        total_received: totalReceived,
        total_uploaded: statusCounts.get(MediaStatus.uploaded) ?? 0,
        total_failed: statusCounts.get(MediaStatus.failed) ?? 0,
        active_users: activeUploaderRows.length,
        top_uploaders: topUploaders,
      },
      recent_activity: recentActivityRows.map((row) => ({
        id: row.id,
        created_at: row.createdAt.toISOString(),
        sender_id: row.senderId?.toString() ?? null,
        chat_id: row.chatId.toString(),
        media_type: row.mediaType,
        status: row.status,
        file_name: row.fileName,
        error: row.error,
      })),
      recent_failures: recentFailureRows.map((row) => ({
        error: row.error,
        count: row._count.id,
        last_at: row._max.createdAt?.toISOString() ?? null,
      })),
      campaigns,
    };
  }

}
