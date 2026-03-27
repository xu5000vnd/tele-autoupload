import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { UserTuStatus } from '@prisma/client';
import { appConfig } from '@shared/config/env';
import { PrismaService } from '@shared/db/prisma.service';
import { TelegramGateway } from '@shared/telegram/telegram-gateway';
import { logger } from '@shared/utils/logger';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

interface MediaInput {
  fileName: string;
  mimeType?: string;
  base64: string;
}

interface CreateCampaignInput {
  targetIds: number[];
  body: string;
  media: MediaInput[];
  createdBy?: string;
}

@Injectable()
export class MessagesService implements OnModuleInit, OnModuleDestroy {
  private readonly dispatchingCampaigns = new Set<string>();
  private readonly dispatchConcurrency = 5;
  private readonly CampaignStatus = {
    pending: 'pending',
    running: 'running',
    completed: 'completed',
    partial_failed: 'partial_failed',
    failed: 'failed',
  } as const;
  private readonly DeliveryStatus = {
    queued: 'queued',
    sending: 'sending',
    sent: 'sent',
    failed: 'failed',
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramGateway: TelegramGateway,
  ) {}

  private get prismaAny(): any {
    return this.prisma as any;
  }

  private hasCampaignStorage(): boolean {
    return Boolean(
      this.prismaAny?.messageCampaign &&
      this.prismaAny?.messageCampaignTarget &&
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

  private emptyHistoriesPayload(limit: number, offset: number): Record<string, unknown> {
    return {
      total: 0,
      limit,
      offset,
      items: [],
    };
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.telegramGateway.connect({ withUpdates: false });
      logger.info('messages service telegram gateway connected');
    } catch (err) {
      logger.error({ err }, 'messages service failed to connect telegram gateway');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.telegramGateway.disconnect();
  }

  async listTargets(query?: string): Promise<Record<string, unknown>[]> {
    const q = query?.trim();
    const users = await this.prisma.userTu.findMany({
      where: {
        status: UserTuStatus.active,
        ...(q
          ? {
              OR: [
                { tuName: { contains: q, mode: 'insensitive' } },
                { username: { contains: q.toLowerCase(), mode: 'insensitive' } },
                { tuId: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        tuId: true,
        tuName: true,
        telegramChatId: true,
        telegramUserId: true,
        username: true,
      },
      orderBy: { tuName: 'asc' },
      take: 500,
    });

    return users.map((u) => ({
      id: u.id,
      tu_id: u.tuId,
      tu_name: u.tuName,
      telegram_chat_id: u.telegramChatId.toString(),
      telegram_user_id: u.telegramUserId.toString(),
      telegram_username: u.username ?? null,
    }));
  }

  async createCampaign(input: CreateCampaignInput): Promise<Record<string, unknown>> {
    if (!this.hasCampaignStorage()) {
      throw new ServiceUnavailableException(
        'message campaign storage is not initialized (run prisma migrate + prisma generate)',
      );
    }

    const targetIds = [...new Set(input.targetIds)].filter((id) => Number.isInteger(id) && id > 0);
    if (!targetIds.length) {
      throw new BadRequestException('targetIds is required');
    }

    const bodyTemplate = (input.body ?? '').trim();
    const mediaInputs = input.media ?? [];
    if (!bodyTemplate && !mediaInputs.length) {
      throw new BadRequestException('body or media is required');
    }

    const targets = await this.prisma.userTu.findMany({
      where: {
        id: { in: targetIds },
        status: UserTuStatus.active,
      },
      select: {
        id: true,
        tuId: true,
        tuName: true,
        telegramChatId: true,
        telegramUserId: true,
        username: true,
      },
    });

    if (!targets.length) {
      throw new BadRequestException('no active targets found');
    }

    const uniqueTargets = [...new Map(targets.map((t) => [t.telegramChatId.toString(), t])).values()];
    const campaignId = randomUUID();
    await this.prismaAny.messageCampaign.create({
      data: {
        id: campaignId,
        bodyTemplate,
        createdBy: input.createdBy ?? null,
        status: this.CampaignStatus.pending,
        totalTargets: uniqueTargets.length,
        updatedAt: new Date(),
      },
    });

    const mediaRecords = await this.persistMediaFiles(campaignId, mediaInputs);
    if (mediaRecords.length) {
      await this.prismaAny.messageCampaignMedia.createMany({
        data: mediaRecords,
      });
    }

    await this.prismaAny.messageCampaignTarget.createMany({
      data: uniqueTargets.map((target) => ({
        campaignId,
        userTuId: target.id,
        telegramChatId: target.telegramChatId,
        tuNameSnapshot: target.tuName,
        renderedBody: this.renderBodyTemplate(bodyTemplate, {
          tu_name: target.tuName,
          tu_id: target.tuId,
          telegram_username: target.username ?? '',
          telegram_user_id: target.telegramUserId.toString(),
          telegram_chat_id: target.telegramChatId.toString(),
        }),
        status: this.DeliveryStatus.queued,
      })),
    });

    setTimeout(() => {
      void this.dispatchCampaign(campaignId);
    }, 0);

    return {
      campaign_id: campaignId,
      total_targets: uniqueTargets.length,
      media_count: mediaRecords.length,
      status: 'queued',
    };
  }

  async listHistories(limit = 20, offset = 0): Promise<Record<string, unknown>> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = Math.max(offset, 0);

    if (!this.hasCampaignStorage()) {
      logger.warn('message campaign prisma delegates are not available; returning empty histories');
      return this.emptyHistoriesPayload(safeLimit, safeOffset);
    }

    let total: number;
    let campaigns: any[];
    try {
      [total, campaigns] = await Promise.all([
        this.prismaAny.messageCampaign.count(),
        this.prismaAny.messageCampaign.findMany({
          take: safeLimit,
          skip: safeOffset,
          orderBy: { createdAt: 'desc' },
          include: {
            _count: { select: { targets: true, medias: true } },
          },
        }),
      ]);
    } catch (err) {
      if (this.isCampaignStoragePrismaError(err)) {
        logger.warn({ err }, 'message campaign storage is not ready; returning empty histories');
        return this.emptyHistoriesPayload(safeLimit, safeOffset);
      }
      throw err;
    }

    return {
      total,
      limit: safeLimit,
      offset: safeOffset,
      items: campaigns.map((c: any) => ({
        campaign_id: c.id,
        body_template: c.bodyTemplate,
        created_by: c.createdBy,
        status: c.status,
        total_targets: c.totalTargets,
        success_targets: c.successTargets,
        failed_targets: c.failedTargets,
        target_count: c._count.targets,
        media_count: c._count.medias,
        created_at: c.createdAt.toISOString(),
        updated_at: c.updatedAt?.toISOString() ?? null,
      })),
    };
  }

  async getHistoryDetail(campaignId: string): Promise<Record<string, unknown>> {
    if (!this.hasCampaignStorage()) {
      throw new BadRequestException('message campaign storage is not initialized yet');
    }

    const campaign = await this.prismaAny.messageCampaign.findUnique({
      where: { id: campaignId },
      include: {
        medias: {
          orderBy: { orderIndex: 'asc' },
        },
        targets: {
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!campaign) {
      throw new BadRequestException('campaign not found');
    }

    return {
      campaign_id: campaign.id,
      body_template: campaign.bodyTemplate,
      created_by: campaign.createdBy,
      status: campaign.status,
      total_targets: campaign.totalTargets,
      success_targets: campaign.successTargets,
      failed_targets: campaign.failedTargets,
      created_at: campaign.createdAt.toISOString(),
      updated_at: campaign.updatedAt?.toISOString() ?? null,
      medias: campaign.medias.map((m: any) => ({
        id: m.id,
        file_name: m.fileName,
        mime_type: m.mimeType,
        order_index: m.orderIndex,
        local_path: m.localPath,
      })),
      targets: campaign.targets.map((t: any) => ({
        id: t.id,
        user_tu_id: t.userTuId,
        telegram_chat_id: t.telegramChatId.toString(),
        tu_name: t.tuNameSnapshot,
        rendered_body: t.renderedBody,
        status: t.status,
        attempt_count: t.attemptCount,
        error: t.error,
        sent_at: t.sentAt?.toISOString() ?? null,
        failed_at: t.failedAt?.toISOString() ?? null,
      })),
    };
  }

  private async dispatchCampaign(campaignId: string): Promise<void> {
    if (this.dispatchingCampaigns.has(campaignId)) {
      return;
    }
    this.dispatchingCampaigns.add(campaignId);

    try {
      await this.telegramGateway.connect({ withUpdates: false });
      await this.prismaAny.messageCampaign.update({
        where: { id: campaignId },
        data: { status: this.CampaignStatus.running, updatedAt: new Date() },
      });

      const [targets, medias] = await Promise.all([
        this.prismaAny.messageCampaignTarget.findMany({
          where: {
            campaignId,
            status: this.DeliveryStatus.queued,
          },
          orderBy: { id: 'asc' },
        }),
        this.prismaAny.messageCampaignMedia.findMany({
          where: { campaignId },
          orderBy: { orderIndex: 'asc' },
        }),
      ]);

      const mediaPaths = medias.map((m: any) => m.localPath);
      await this.runWithConcurrency(
        targets,
        this.dispatchConcurrency,
        async (target: any) => this.deliverTarget(target.id, target.telegramChatId, target.renderedBody, mediaPaths),
      );

      await this.refreshCampaignStatus(campaignId);
    } catch (err) {
      logger.error({ err, campaignId }, 'campaign dispatch failed');
      await this.prismaAny.messageCampaign.update({
        where: { id: campaignId },
        data: {
          status: this.CampaignStatus.failed,
          updatedAt: new Date(),
        },
      });
    } finally {
      this.dispatchingCampaigns.delete(campaignId);
    }
  }

  private async deliverTarget(
    targetId: number,
    chatId: bigint,
    renderedBody: string,
    mediaPaths: string[],
  ): Promise<void> {
    await this.prismaAny.messageCampaignTarget.update({
      where: { id: targetId },
      data: {
        status: this.DeliveryStatus.sending,
        attemptCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    try {
      if (mediaPaths.length) {
        await this.telegramGateway.sendMedia(chatId, mediaPaths, renderedBody || undefined);
      } else {
        await this.telegramGateway.sendText(chatId, renderedBody);
      }

      await this.prismaAny.messageCampaignTarget.update({
        where: { id: targetId },
        data: {
          status: this.DeliveryStatus.sent,
          error: null,
          sentAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown send error';
      await this.prismaAny.messageCampaignTarget.update({
        where: { id: targetId },
        data: {
          status: this.DeliveryStatus.failed,
          error: message,
          failedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      logger.error({ err, targetId, chatId: chatId.toString() }, 'target delivery failed');
    }
  }

  private async refreshCampaignStatus(campaignId: string): Promise<void> {
    const grouped = await this.prismaAny.messageCampaignTarget.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { id: true },
    });

    const counts = new Map<string, number>(grouped.map((g: any) => [g.status, Number(g._count.id)]));
    const queued = counts.get(this.DeliveryStatus.queued) ?? 0;
    const sending = counts.get(this.DeliveryStatus.sending) ?? 0;
    const sent = counts.get(this.DeliveryStatus.sent) ?? 0;
    const failed = counts.get(this.DeliveryStatus.failed) ?? 0;

    let campaignStatus: string = this.CampaignStatus.running;
    if (queued === 0 && sending === 0) {
      if (sent > 0 && failed > 0) {
        campaignStatus = this.CampaignStatus.partial_failed;
      } else if (sent > 0 && failed === 0) {
        campaignStatus = this.CampaignStatus.completed;
      } else {
        campaignStatus = this.CampaignStatus.failed;
      }
    }

    await this.prismaAny.messageCampaign.update({
      where: { id: campaignId },
      data: {
        status: campaignStatus,
        successTargets: sent,
        failedTargets: failed,
        updatedAt: new Date(),
      },
    });
  }

  private renderBodyTemplate(template: string, context: Record<string, string>): string {
    return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => context[key] ?? '');
  }

  private sanitizeFileName(input: string): string {
    return input
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'file';
  }

  private async persistMediaFiles(campaignId: string, mediaInputs: MediaInput[]): Promise<Array<{
    campaignId: string;
    fileName: string;
    mimeType?: string;
    localPath: string;
    orderIndex: number;
  }>> {
    if (!mediaInputs.length) {
      return [];
    }

    const maxMedia = 10;
    if (mediaInputs.length > maxMedia) {
      throw new BadRequestException(`media limit is ${maxMedia}`);
    }

    const campaignDir = path.join(appConfig.stagingDir, 'broadcast', campaignId);
    await fs.mkdir(campaignDir, { recursive: true });

    const records: Array<{
      campaignId: string;
      fileName: string;
      mimeType?: string;
      localPath: string;
      orderIndex: number;
    }> = [];

    for (let i = 0; i < mediaInputs.length; i++) {
      const media = mediaInputs[i];
      if (!media.base64) {
        throw new BadRequestException(`media[${i}] base64 is required`);
      }

      const base64Payload = media.base64.includes(',') ? media.base64.split(',').pop() ?? '' : media.base64;
      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64Payload, 'base64');
      } catch {
        throw new BadRequestException(`media[${i}] base64 is invalid`);
      }
      if (!buffer.length) {
        throw new BadRequestException(`media[${i}] is empty`);
      }

      const safeName = this.sanitizeFileName(media.fileName || `media_${i + 1}`);
      const localPath = path.join(campaignDir, `${String(i + 1).padStart(3, '0')}_${safeName}`);
      await fs.writeFile(localPath, buffer);

      records.push({
        campaignId,
        fileName: safeName,
        mimeType: media.mimeType,
        localPath,
        orderIndex: i,
      });
    }

    return records;
  }

  private async runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
    if (!items.length) return;
    const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
    let cursor = 0;

    const runners = Array.from({ length: safeConcurrency }, async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= items.length) {
          return;
        }
        await worker(items[idx]);
      }
    });

    await Promise.all(runners);
  }
}
