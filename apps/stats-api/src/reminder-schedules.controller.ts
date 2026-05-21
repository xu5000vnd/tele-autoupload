import { BadRequestException, Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { BearerAuthGuard } from './auth.guard';
import { ReminderSchedulesService } from './reminder-schedules.service';

type ScheduleBody = Record<string, unknown>;

@Controller('api/reminder-schedules')
@UseGuards(BearerAuthGuard)
export class ReminderSchedulesController {
  constructor(private readonly reminderSchedulesService: ReminderSchedulesService) {}

  @Get()
  list(): Promise<Record<string, unknown>[]> {
    return this.reminderSchedulesService.listSchedules();
  }

  @Post()
  create(@Body() body: ScheduleBody): Promise<Record<string, unknown>> {
    return this.reminderSchedulesService.createSchedule(parseScheduleBody(body));
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() body: ScheduleBody,
  ): Promise<Record<string, unknown>> {
    return this.reminderSchedulesService.updateSchedule(parsePositiveInt(id, 'id'), parseScheduleBody(body));
  }

  @Post(':id/run-now')
  runNow(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.reminderSchedulesService.runNow(parsePositiveInt(id, 'id'));
  }
}

function parseScheduleBody(body: ScheduleBody): {
  name?: string;
  status?: 'active' | 'inactive';
  daysOfMonth?: number[];
  sendTime?: string;
  timezone?: string;
  targetRule?: 'no_media_current_period' | 'all_active_users';
  messageTemplate?: string;
} {
  return {
    ...(body.name !== undefined ? { name: readString(body, 'name') } : {}),
    ...(body.status !== undefined ? { status: readStatus(body.status) } : {}),
    ...(body.days_of_month !== undefined ? { daysOfMonth: readNumberArray(body.days_of_month, 'days_of_month') } : {}),
    ...(body.send_time !== undefined ? { sendTime: readString(body, 'send_time') } : {}),
    ...(body.timezone !== undefined ? { timezone: readString(body, 'timezone') } : {}),
    ...(body.target_rule !== undefined ? { targetRule: readTargetRule(body.target_rule) } : {}),
    ...(body.message_template !== undefined ? { messageTemplate: readString(body, 'message_template') } : {}),
  };
}

function readString(body: ScheduleBody, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') {
    throw new BadRequestException(`${key} must be a string`);
  }
  return value;
}

function readNumberArray(value: unknown, key: string): number[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${key} must be an array`);
  }
  return value.map(Number);
}

function readStatus(value: unknown): 'active' | 'inactive' {
  if (value === 'active' || value === 'inactive') {
    return value;
  }
  throw new BadRequestException('status must be active or inactive');
}

function readTargetRule(value: unknown): 'no_media_current_period' | 'all_active_users' {
  if (
    value === 'no_media_current_period' ||
    value === 'all_active_users'
  ) {
    return value;
  }
  throw new BadRequestException('target_rule is invalid');
}

function parsePositiveInt(value: string, field: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  return id;
}
