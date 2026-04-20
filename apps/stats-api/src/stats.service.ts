import { BadRequestException, Injectable } from '@nestjs/common';
import { MediaStatus, UserTuStatus } from '@prisma/client';
import { appConfig } from '@shared/config/env';
import { PrismaService } from '@shared/db/prisma.service';
import { QueueService } from '@shared/queue/queue.service';
import { stagingUsage } from '@shared/utils/disk';
import { logger } from '@shared/utils/logger';
import { REPORTING_CYCLE_START_DAY } from './reporting-cycle';

type SortOrder = 'asc' | 'desc';

type ActiveUser = {
  id: number;
  tuId: string;
  tuName: string;
  telegramUserId: bigint;
  telegramChatId: bigint;
  username: string | null;
};

type UserMediaBucket = {
  photo: number;
  video: number;
  document: number;
  total: number;
};

type MonthWindow = {
  year: number;
  monthIndex: number;
  monthKey: string;
  label: string;
  startUtc: Date;
  endUtc: Date;
  cycleStartDate: string;
  cycleEndDate: string;
};

@Injectable()
export class StatsService {
  private readonly analyticsTimezone = 'Asia/Ho_Chi_Minh';
  private readonly analyticsOffsetMs = 7 * 60 * 60 * 1000;
  private readonly monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  private readonly reportingCycleStartDay = REPORTING_CYCLE_START_DAY;

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

  private shiftToAnalyticsTimezone(value: Date): Date {
    return new Date(value.getTime() + this.analyticsOffsetMs);
  }

  private formatAnalyticsDate(value: Date): string {
    return this.shiftToAnalyticsTimezone(value).toISOString().slice(0, 10);
  }

  private currentAnalyticsYear(): number {
    return Number(this.currentAnalyticsMonthKey().slice(0, 4));
  }

  private currentAnalyticsMonthKey(): string {
    return this.monthKeyFromDate(new Date());
  }

  private formatMonthKey(year: number, monthIndex: number): string {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  }

  private formatMonthLabel(year: number, monthIndex: number): string {
    return `${this.monthLabels[monthIndex]} ${year}`;
  }

  private monthWindowFromParts(year: number, monthIndex: number): MonthWindow {
    const startUtc = new Date(
      Date.UTC(year, monthIndex - 1, this.reportingCycleStartDay) - this.analyticsOffsetMs,
    );
    const nextCycleStartUtc = new Date(
      Date.UTC(year, monthIndex, this.reportingCycleStartDay) - this.analyticsOffsetMs,
    );

    return {
      year,
      monthIndex,
      monthKey: this.formatMonthKey(year, monthIndex),
      label: this.formatMonthLabel(year, monthIndex),
      startUtc,
      endUtc: new Date(nextCycleStartUtc.getTime() - 1),
      cycleStartDate: this.formatAnalyticsDate(startUtc),
      cycleEndDate: this.formatAnalyticsDate(new Date(nextCycleStartUtc.getTime() - 1)),
    };
  }

  private parseYear(yearRaw?: string): number {
    if (!yearRaw || !yearRaw.trim()) {
      return this.currentAnalyticsYear();
    }

    if (!/^\d{4}$/.test(yearRaw.trim())) {
      throw new BadRequestException('year must be in YYYY format');
    }

    return Number(yearRaw);
  }

  private parseMonthKey(monthKey: string): MonthWindow {
    const normalized = monthKey.trim();
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(normalized);
    if (!match) {
      throw new BadRequestException('monthKey must be in YYYY-MM format');
    }

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    return this.monthWindowFromParts(year, monthIndex);
  }

  private normalizeSortOrder(sortOrder?: string): SortOrder {
    return sortOrder === 'asc' ? 'asc' : 'desc';
  }

  private normalizeLimit(limitRaw?: number): number {
    const limit = Number(limitRaw);
    if (!Number.isFinite(limit)) {
      return 50;
    }
    return Math.min(Math.max(Math.trunc(limit), 1), 500);
  }

  private normalizeOffset(offsetRaw?: number): number {
    const offset = Number(offsetRaw);
    if (!Number.isFinite(offset)) {
      return 0;
    }
    return Math.max(Math.trunc(offset), 0);
  }

  private compareValues(a: string | number | null, b: string | number | null, sortOrder: SortOrder): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return sortOrder === 'asc' ? a - b : b - a;
    }

    const left = String(a ?? '').toLowerCase();
    const right = String(b ?? '').toLowerCase();
    const comparison = left.localeCompare(right);
    return sortOrder === 'asc' ? comparison : -comparison;
  }

  private compareMonthUserRows(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    sortBy: string,
    sortOrder: SortOrder,
  ): number {
    const primary = this.compareValues(
      (a[sortBy] as string | number | null | undefined) ?? null,
      (b[sortBy] as string | number | null | undefined) ?? null,
      sortOrder,
    );
    if (primary !== 0) {
      return primary;
    }

    return this.compareValues(
      (a.tu_name as string | null | undefined) ?? null,
      (b.tu_name as string | null | undefined) ?? null,
      'asc',
    );
  }

  private compositeUserKey(senderId: bigint, chatId: bigint): string {
    return `${senderId.toString()}_${chatId.toString()}`;
  }

  private monthKeyFromDate(value: Date): string {
    const shifted = this.shiftToAnalyticsTimezone(value);
    const dayOfMonth = shifted.getUTCDate();
    const labelDate = new Date(
      Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth() + (dayOfMonth >= this.reportingCycleStartDay ? 1 : 0),
        1,
      ),
    );

    return this.formatMonthKey(labelDate.getUTCFullYear(), labelDate.getUTCMonth());
  }

  private async loadActiveUsers(): Promise<ActiveUser[]> {
    return this.prisma.userTu.findMany({
      where: { status: UserTuStatus.active },
      select: {
        id: true,
        tuId: true,
        tuName: true,
        telegramUserId: true,
        telegramChatId: true,
        username: true,
      },
      orderBy: { tuName: 'asc' },
    });
  }

  private async loadUploadedMediaBuckets(window: MonthWindow): Promise<Map<string, UserMediaBucket>> {
    const rows = await this.prisma.mediaItem.groupBy({
      by: ['senderId', 'chatId', 'mediaType'],
      where: {
        status: MediaStatus.uploaded,
        date: { gte: window.startUtc, lte: window.endUtc },
        senderId: { not: null },
      },
      _count: { id: true },
    });

    const buckets = new Map<string, UserMediaBucket>();
    for (const row of rows) {
      if (!row.senderId) {
        continue;
      }

      const key = this.compositeUserKey(row.senderId, row.chatId);
      const bucket = buckets.get(key) ?? { photo: 0, video: 0, document: 0, total: 0 };
      const count = Number(row._count.id);

      if (row.mediaType === 'photo') {
        bucket.photo += count;
      } else if (row.mediaType === 'video') {
        bucket.video += count;
      } else if (row.mediaType === 'document') {
        bucket.document += count;
      }

      bucket.total += count;
      buckets.set(key, bucket);
    }

    return buckets;
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
      const bucket = countMap.get(key)!;
      const count = row._count.id;

      if (row.mediaType === 'photo') bucket.photo += count;
      if (row.mediaType === 'video') bucket.video += count;
      if (row.status === 'uploaded') bucket.success += count;
      if (row.status === 'failed') bucket.failed += count;
    }

    return users.map((user) => {
      const key = `${user.telegramUserId}_${user.telegramChatId}`;
      const bucket = countMap.get(key) ?? { photo: 0, video: 0, success: 0, failed: 0 };
      return {
        tu_id: user.tuId,
        tu_name: user.tuName,
        path: user.path ?? null,
        telegram_user_id: user.telegramUserId.toString(),
        telegram_username: user.username ?? null,
        telegram_chat_id: user.telegramChatId.toString(),
        media: {
          image: bucket.photo,
          video: bucket.video,
          total: bucket.photo + bucket.video,
        },
        status_uploaded: {
          success: bucket.success,
          failed: bucket.failed,
        },
        date: targetDate,
      };
    });
  }

  async monthlyHeatmap(yearRaw?: string): Promise<Record<string, unknown>> {
    const year = this.parseYear(yearRaw);
    const firstWindow = this.monthWindowFromParts(year, 0);
    const lastWindow = this.monthWindowFromParts(year, 11);

    const rows = await this.prisma.mediaItem.findMany({
      where: {
        status: MediaStatus.uploaded,
        date: {
          gte: firstWindow.startUtc,
          lte: lastWindow.endUtc,
        },
      },
      select: {
        date: true,
        senderId: true,
        chatId: true,
      },
    });

    const monthMap = new Map<string, { label: string; total_media: number; uploaders: Set<string> }>();
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const window = this.monthWindowFromParts(year, monthIndex);
      monthMap.set(window.monthKey, {
        label: window.label,
        total_media: 0,
        uploaders: new Set<string>(),
      });
    }

    for (const row of rows) {
      const monthKey = this.monthKeyFromDate(row.date);
      const bucket = monthMap.get(monthKey);
      if (!bucket) {
        continue;
      }

      bucket.total_media += 1;
      if (row.senderId) {
        bucket.uploaders.add(this.compositeUserKey(row.senderId, row.chatId));
      }
    }

    return {
      year,
      timezone: this.analyticsTimezone,
      cycle_start_day: this.reportingCycleStartDay,
      months: Array.from(monthMap.entries()).map(([monthKey, value]) => ({
        month_key: monthKey,
        label: value.label,
        total_media: value.total_media,
        active_users: value.uploaders.size,
        cycle_start: this.monthWindowFromParts(
          Number(monthKey.slice(0, 4)),
          Number(monthKey.slice(5, 7)) - 1,
        ).cycleStartDate,
        cycle_end: this.monthWindowFromParts(
          Number(monthKey.slice(0, 4)),
          Number(monthKey.slice(5, 7)) - 1,
        ).cycleEndDate,
      })),
    };
  }

  async monthUsers(
    monthKey: string,
    sortByRaw?: string,
    sortOrderRaw?: string,
    limitRaw?: number,
    offsetRaw?: number,
  ): Promise<Record<string, unknown>> {
    const window = this.parseMonthKey(monthKey);
    const sortBy = sortByRaw ?? 'total_media';
    const sortOrder = this.normalizeSortOrder(sortOrderRaw);
    const limit = this.normalizeLimit(limitRaw);
    const offset = this.normalizeOffset(offsetRaw);

    const allowedSortFields = new Set([
      'tu_name',
      'telegram_username',
      'total_media',
      'image_count',
      'video_count',
      'document_count',
    ]);
    if (!allowedSortFields.has(sortBy)) {
      throw new BadRequestException('unsupported sortBy value');
    }

    const [activeUsers, buckets] = await Promise.all([
      this.loadActiveUsers(),
      this.loadUploadedMediaBuckets(window),
    ]);

    const items = activeUsers
      .map((user) => {
        const key = this.compositeUserKey(user.telegramUserId, user.telegramChatId);
        const bucket = buckets.get(key) ?? { photo: 0, video: 0, document: 0, total: 0 };

        return {
          user_tu_id: user.id,
          tu_id: user.tuId,
          tu_name: user.tuName,
          telegram_username: user.username,
          telegram_chat_id: user.telegramChatId.toString(),
          total_media: bucket.total,
          image_count: bucket.photo,
          video_count: bucket.video,
          document_count: bucket.document,
        };
      })
      .sort((a, b) => this.compareMonthUserRows(a, b, sortBy, sortOrder));

    const paginatedItems = items.slice(offset, offset + limit);
    const totalMedia = items.reduce((sum, item) => sum + item.total_media, 0);

    return {
      month: window.monthKey,
      timezone: this.analyticsTimezone,
      cycle_start_day: this.reportingCycleStartDay,
      cycle_start: window.cycleStartDate,
      cycle_end: window.cycleEndDate,
      total: items.length,
      limit,
      offset,
      summary: {
        total_media: totalMedia,
        active_users: activeUsers.length,
      },
      items: paginatedItems,
    };
  }

  async currentMonthMissingImageUsers(
    sortByRaw?: string,
    sortOrderRaw?: string,
    limitRaw?: number,
    offsetRaw?: number,
  ): Promise<Record<string, unknown>> {
    const window = this.parseMonthKey(this.currentAnalyticsMonthKey());
    const sortBy = sortByRaw ?? 'tu_name';
    const sortOrder = this.normalizeSortOrder(sortOrderRaw);
    const limit = this.normalizeLimit(limitRaw);
    const offset = this.normalizeOffset(offsetRaw);

    const allowedSortFields = new Set([
      'tu_name',
      'telegram_username',
      'telegram_chat_id',
    ]);
    if (!allowedSortFields.has(sortBy)) {
      throw new BadRequestException('unsupported sortBy value');
    }

    const [activeUsers, buckets] = await Promise.all([
      this.loadActiveUsers(),
      this.loadUploadedMediaBuckets(window),
    ]);

    const items = activeUsers
      .map((user) => {
        const key = this.compositeUserKey(user.telegramUserId, user.telegramChatId);
        const bucket = buckets.get(key);
        const imageUploadCount = bucket?.photo ?? 0;
        if (imageUploadCount > 0) {
          return null;
        }

        return {
          user_tu_id: user.id,
          tu_id: user.tuId,
          tu_name: user.tuName,
          telegram_username: user.username,
          telegram_chat_id: user.telegramChatId.toString(),
          image_upload_count: imageUploadCount,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => this.compareMonthUserRows(a, b, sortBy, sortOrder));

    return {
      month: window.monthKey,
      timezone: this.analyticsTimezone,
      cycle_start_day: this.reportingCycleStartDay,
      cycle_start: window.cycleStartDate,
      cycle_end: window.cycleEndDate,
      total: items.length,
      limit,
      offset,
      items: items.slice(offset, offset + limit),
    };
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

    const totalReceived = Array.from(statusCounts.values()).reduce((acc, count) => acc + count, 0);

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
