import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MediaStatus, UserTuStatus } from '@prisma/client';
import { PrismaService } from '@shared/db/prisma.service';
import { logger } from '@shared/utils/logger';
import { randomUUID } from 'node:crypto';
import { REPORTING_CYCLE_START_DAY } from './reporting-cycle';
import { MessagesService } from './messages.service';

type ScheduleStatus = 'active' | 'inactive';
type TargetRule = 'no_media_current_period' | 'all_active_users';
type TriggerType = 'scheduled' | 'manual';

type ScheduleInput = {
  name?: string;
  status?: ScheduleStatus;
  daysOfMonth?: number[];
  sendTime?: string;
  timezone?: string;
  targetRule?: TargetRule;
  messageTemplate?: string;
};

type LocalDateParts = {
  date: string;
  day: number;
  time: string;
};

const VALID_TARGET_RULES = new Set<TargetRule>([
  'no_media_current_period',
  'all_active_users',
]);

@Injectable()
export class ReminderSchedulesService {
  private readonly analyticsOffsetMs = 7 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messagesService: MessagesService,
  ) {}

  private get prismaAny(): any {
    return this.prisma as any;
  }

  private hasScheduleStorage(): boolean {
    return Boolean(this.prismaAny?.reminderSchedule && this.prismaAny?.reminderScheduleRun);
  }

  private assertScheduleStorage(): void {
    if (!this.hasScheduleStorage()) {
      throw new ServiceUnavailableException('reminder schedule storage is not initialized');
    }
  }

  async listSchedules(): Promise<Record<string, unknown>[]> {
    this.assertScheduleStorage();

    const rows = await this.prismaAny.reminderSchedule.findMany({
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: {
        runs: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return rows.map((row: any) => this.schedulePayload(row));
  }

  async createSchedule(input: ScheduleInput): Promise<Record<string, unknown>> {
    this.assertScheduleStorage();
    const data = this.parseScheduleInput(input, true);

    const created = await this.prismaAny.reminderSchedule.create({
      data: {
        name: data.name,
        status: data.status ?? 'active',
        daysOfMonth: data.daysOfMonth,
        sendTime: data.sendTime,
        timezone: data.timezone ?? 'Asia/Ho_Chi_Minh',
        targetRule: data.targetRule ?? 'no_media_current_period',
        messageTemplate: data.messageTemplate,
        updatedAt: new Date(),
      },
      include: {
        runs: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return this.schedulePayload(created);
  }

  async updateSchedule(id: number, input: ScheduleInput): Promise<Record<string, unknown>> {
    this.assertScheduleStorage();
    const data = this.parseScheduleInput(input, false);
    if (!Object.keys(data).length) {
      throw new BadRequestException('at least one field is required');
    }

    try {
      const updated = await this.prismaAny.reminderSchedule.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.daysOfMonth !== undefined ? { daysOfMonth: data.daysOfMonth } : {}),
          ...(data.sendTime !== undefined ? { sendTime: data.sendTime } : {}),
          ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
          ...(data.targetRule !== undefined ? { targetRule: data.targetRule } : {}),
          ...(data.messageTemplate !== undefined ? { messageTemplate: data.messageTemplate } : {}),
          updatedAt: new Date(),
        },
        include: {
          runs: {
            take: 5,
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      return this.schedulePayload(updated);
    } catch (err) {
      if (this.isRecordMissingError(err)) {
        throw new NotFoundException('schedule not found');
      }
      throw err;
    }
  }

  async runNow(id: number): Promise<Record<string, unknown>> {
    this.assertScheduleStorage();
    const schedule = await this.prismaAny.reminderSchedule.findUnique({ where: { id } });
    if (!schedule) {
      throw new NotFoundException('schedule not found');
    }

    return this.executeSchedule(schedule, 'manual');
  }

  @Cron('* * * * *')
  async runDueSchedules(): Promise<void> {
    if (!this.hasScheduleStorage()) {
      return;
    }

    const now = new Date();
    const schedules = await this.prismaAny.reminderSchedule.findMany({
      where: { status: 'active' },
      orderBy: { id: 'asc' },
    });

    for (const schedule of schedules) {
      if (!this.isScheduleDue(schedule, now)) {
        continue;
      }

      try {
        await this.executeSchedule(schedule, 'scheduled', now);
      } catch (err) {
        logger.error({ err, scheduleId: schedule.id }, 'scheduled reminder failed');
      }
    }
  }

  private async executeSchedule(
    schedule: any,
    triggerType: TriggerType,
    now = new Date(),
  ): Promise<Record<string, unknown>> {
    const local = this.localDateParts(now, schedule.timezone);
    const runKey = triggerType === 'scheduled' ? local.date : `${local.date}:${randomUUID()}`;
    let run: any;

    try {
      run = await this.prismaAny.reminderScheduleRun.create({
        data: {
          scheduleId: schedule.id,
          runKey,
          runDate: local.date,
          triggerType,
          status: 'running',
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err) && triggerType === 'scheduled') {
        return {
          schedule_id: schedule.id,
          status: 'skipped_duplicate',
          run_date: local.date,
          trigger_type: triggerType,
        };
      }
      throw err;
    }

    try {
      const targetIds = await this.resolveTargetIds(schedule.targetRule);
      if (!targetIds.length) {
        const updatedRun = await this.prismaAny.reminderScheduleRun.update({
          where: { id: run.id },
          data: {
            status: 'no_targets',
            targetCount: 0,
            updatedAt: new Date(),
          },
        });
        await this.markScheduleRan(schedule.id);
        return this.runPayload(updatedRun);
      }

      const campaign = await this.messagesService.createCampaign({
        targetIds,
        body: schedule.messageTemplate,
        media: [],
        createdBy: `system:reminder-schedule:${schedule.id}:${triggerType}:${local.date}`,
      });

      const updatedRun = await this.prismaAny.reminderScheduleRun.update({
        where: { id: run.id },
        data: {
          status: 'queued',
          campaignId: String(campaign.campaign_id),
          targetCount: Number(campaign.total_targets ?? targetIds.length),
          updatedAt: new Date(),
        },
      });
      await this.markScheduleRan(schedule.id);

      return this.runPayload(updatedRun);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failedRun = await this.prismaAny.reminderScheduleRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error: message,
          updatedAt: new Date(),
        },
      });
      throw new BadRequestException(this.runPayload(failedRun));
    }
  }

  private async resolveTargetIds(targetRule: TargetRule): Promise<number[]> {
    const activeUsers = await this.prisma.userTu.findMany({
      where: { status: UserTuStatus.active },
      select: {
        id: true,
        telegramUserId: true,
        telegramChatId: true,
      },
      orderBy: { tuName: 'asc' },
    });

    if (targetRule === 'all_active_users') {
      return activeUsers.map((user) => user.id);
    }

    const window = this.currentReportingWindow();
    const rows = await this.prisma.mediaItem.groupBy({
      by: ['senderId', 'chatId'],
      where: {
        status: MediaStatus.uploaded,
        senderId: { not: null },
        date: { gte: window.startUtc, lte: window.endUtc },
      },
      _count: { id: true },
    });

    const uploadedKeys = new Set(
      rows
        .filter((row) => row.senderId)
        .map((row) => `${row.senderId!.toString()}_${row.chatId.toString()}`),
    );

    return activeUsers
      .filter((user) => !uploadedKeys.has(`${user.telegramUserId.toString()}_${user.telegramChatId.toString()}`))
      .map((user) => user.id);
  }

  private currentReportingWindow(): { startUtc: Date; endUtc: Date; startDate: string; endDate: string } {
    const shifted = new Date(Date.now() + this.analyticsOffsetMs);
    const dayOfMonth = shifted.getUTCDate();
    const cycleMonthOffset = dayOfMonth >= REPORTING_CYCLE_START_DAY ? 0 : -1;
    const startUtc = new Date(
      Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth() + cycleMonthOffset,
        REPORTING_CYCLE_START_DAY,
      ) - this.analyticsOffsetMs,
    );
    const nextStartUtc = new Date(
      Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth() + cycleMonthOffset + 1,
        REPORTING_CYCLE_START_DAY,
      ) - this.analyticsOffsetMs,
    );

    return {
      startUtc,
      endUtc: new Date(nextStartUtc.getTime() - 1),
      startDate: this.formatAnalyticsDate(startUtc),
      endDate: this.formatAnalyticsDate(new Date(nextStartUtc.getTime() - 1)),
    };
  }

  private formatAnalyticsDate(value: Date): string {
    return new Date(value.getTime() + this.analyticsOffsetMs).toISOString().slice(0, 10);
  }

  private isScheduleDue(schedule: any, now: Date): boolean {
    const local = this.localDateParts(now, schedule.timezone);
    return schedule.daysOfMonth.includes(local.day) && schedule.sendTime === local.time;
  }

  private localDateParts(value: Date, timezone: string): LocalDateParts {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = new Map(formatter.formatToParts(value).map((part) => [part.type, part.value]));
    const year = parts.get('year') ?? '1970';
    const month = parts.get('month') ?? '01';
    const day = parts.get('day') ?? '01';
    const hour = parts.get('hour') ?? '00';
    const minute = parts.get('minute') ?? '00';

    return {
      date: `${year}-${month}-${day}`,
      day: Number(day),
      time: `${hour}:${minute}`,
    };
  }

  private parseScheduleInput(input: ScheduleInput, requireFields: boolean): ScheduleInput {
    const data: ScheduleInput = {};

    if (input.name !== undefined || requireFields) {
      data.name = this.readString(input.name, 'name');
    }
    if (input.status !== undefined) {
      data.status = this.readStatus(input.status);
    }
    if (input.daysOfMonth !== undefined || requireFields) {
      data.daysOfMonth = this.readDaysOfMonth(input.daysOfMonth);
    }
    if (input.sendTime !== undefined || requireFields) {
      data.sendTime = this.readSendTime(input.sendTime);
    }
    if (input.timezone !== undefined || requireFields) {
      data.timezone = this.readString(input.timezone ?? 'Asia/Ho_Chi_Minh', 'timezone');
    }
    if (input.targetRule !== undefined || requireFields) {
      data.targetRule = this.readTargetRule(input.targetRule ?? 'no_media_current_period');
    }
    if (input.messageTemplate !== undefined || requireFields) {
      data.messageTemplate = this.readString(input.messageTemplate, 'message_template');
    }

    return data;
  }

  private readString(value: unknown, field: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }
    return trimmed;
  }

  private readStatus(value: unknown): ScheduleStatus {
    if (value === 'active' || value === 'inactive') {
      return value;
    }
    throw new BadRequestException('status must be active or inactive');
  }

  private readTargetRule(value: unknown): TargetRule {
    if (typeof value === 'string' && VALID_TARGET_RULES.has(value as TargetRule)) {
      return value as TargetRule;
    }
    throw new BadRequestException('target_rule is invalid');
  }

  private readDaysOfMonth(value: unknown): number[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException('days_of_month must be an array');
    }
    const days = [...new Set(value.map((item) => Number(item)))]
      .filter((item) => Number.isInteger(item))
      .sort((a, b) => a - b);
    if (!days.length || days.some((day) => day < 1 || day > 31)) {
      throw new BadRequestException('days_of_month must contain values from 1 to 31');
    }
    return days;
  }

  private readSendTime(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
      throw new BadRequestException('send_time must use HH:mm format');
    }
    const [hour, minute] = value.split(':').map(Number);
    if (hour > 23 || minute > 59) {
      throw new BadRequestException('send_time must use HH:mm format');
    }
    return value;
  }

  private schedulePayload(row: any): Record<string, unknown> {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      days_of_month: row.daysOfMonth,
      send_time: row.sendTime,
      timezone: row.timezone,
      target_rule: row.targetRule,
      message_template: row.messageTemplate,
      last_run_at: row.lastRunAt?.toISOString() ?? null,
      next_run_label: this.nextRunLabel(row),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt?.toISOString() ?? null,
      recent_runs: (row.runs ?? []).map((run: any) => this.runPayload(run)),
    };
  }

  private runPayload(row: any): Record<string, unknown> {
    return {
      id: row.id,
      schedule_id: row.scheduleId,
      run_key: row.runKey,
      run_date: row.runDate,
      trigger_type: row.triggerType,
      status: row.status,
      campaign_id: row.campaignId,
      target_count: row.targetCount,
      error: row.error,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt?.toISOString() ?? null,
    };
  }

  private nextRunLabel(row: any): string | null {
    if (row.status !== 'active' || !row.daysOfMonth?.length) {
      return null;
    }

    const now = new Date();
    const nowLocal = this.localDateParts(now, row.timezone);
    for (let i = 0; i < 370; i += 1) {
      const candidate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const local = this.localDateParts(candidate, row.timezone);
      if (row.daysOfMonth.includes(local.day)) {
        if (local.date === nowLocal.date && row.sendTime <= nowLocal.time) {
          continue;
        }
        return `${local.date} ${row.sendTime} ${row.timezone}`;
      }
    }

    return null;
  }

  private async markScheduleRan(scheduleId: number): Promise<void> {
    await this.prismaAny.reminderSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && err.code === 'P2002');
  }

  private isRecordMissingError(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && err.code === 'P2025');
  }
}
