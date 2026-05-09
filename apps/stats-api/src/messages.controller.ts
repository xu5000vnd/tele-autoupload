import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { UserTuStatus } from '@prisma/client';
import { BearerAuthGuard } from './auth.guard';
import { MessagesService } from './messages.service';

type TargetBody = Record<string, unknown>;

type TargetInput = {
  tuId?: string;
  tuName?: string;
  path?: string | null;
  telegramUserId?: bigint;
  telegramChatId?: bigint;
  username?: string | null;
  status?: UserTuStatus;
};

@Controller('api/messages')
@UseGuards(BearerAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('targets')
  async targets(
    @Query('query') query?: string,
    @Query('status') status?: string,
  ): Promise<Record<string, unknown>[]> {
    return this.messagesService.listTargets(query, parseTargetStatus(status));
  }

  @Post('targets')
  async createTarget(@Body() body: TargetBody): Promise<Record<string, unknown>> {
    return this.messagesService.createTarget(parseTargetBody(body, true));
  }

  @Put('targets/:id')
  async updateTarget(
    @Param('id') id: string,
    @Body() body: TargetBody,
  ): Promise<Record<string, unknown>> {
    return this.messagesService.updateTarget(parsePositiveInt(id, 'id'), parseTargetBody(body, false));
  }

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const targetIds = Array.isArray(body.targetIds)
      ? body.targetIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      : [];

    const messageBody = typeof body.body === 'string' ? body.body : '';
    const mediaRaw = Array.isArray(body.media) ? body.media : [];
    const media = mediaRaw.map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException(`media[${index}] is invalid`);
      }
      const x = item as Record<string, unknown>;
      const fileName = typeof x.fileName === 'string' ? x.fileName : `media_${index + 1}`;
      const mimeType = typeof x.mimeType === 'string' ? x.mimeType : undefined;
      const base64 = typeof x.base64 === 'string' ? x.base64 : '';
      return { fileName, mimeType, base64 };
    });

    const createdBy = typeof body.createdBy === 'string' ? body.createdBy : undefined;

    return this.messagesService.createCampaign({
      targetIds,
      body: messageBody,
      media,
      createdBy,
    });
  }

  @Get('histories')
  async histories(
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
  ): Promise<Record<string, unknown>> {
    return this.messagesService.listHistories(Number(limit), Number(offset));
  }

  @Get('histories/:campaignId')
  async historyDetail(@Param('campaignId') campaignId: string): Promise<Record<string, unknown>> {
    return this.messagesService.getHistoryDetail(campaignId);
  }
}

function parseTargetBody(body: TargetBody, requireCoreFields: boolean): TargetInput {
  const input: TargetInput = {};

  const tuId = readString(body, 'tu_id', requireCoreFields);
  if (tuId !== undefined) {
    input.tuId = tuId;
  }

  const tuName = readString(body, 'tu_name', requireCoreFields);
  if (tuName !== undefined) {
    input.tuName = tuName;
  }

  const path = readNullableString(body, 'path');
  if (path !== undefined) {
    input.path = path;
  }

  const telegramUserId = readBigInt(body, 'telegram_user_id', requireCoreFields);
  if (telegramUserId !== undefined) {
    input.telegramUserId = telegramUserId;
  }

  const telegramChatId = readBigInt(body, 'telegram_chat_id', requireCoreFields);
  if (telegramChatId !== undefined) {
    input.telegramChatId = telegramChatId;
  }

  const username = readNullableString(body, 'telegram_username');
  if (username !== undefined) {
    input.username = username?.replace(/^@+/, '') || null;
  }

  const status = readStatus(body);
  if (status !== undefined) {
    input.status = status;
  }

  return input;
}

function readString(body: TargetBody, key: string, required: boolean): string | undefined {
  const value = body[key];
  if (value === undefined) {
    if (required) {
      throw new BadRequestException(`${key} is required`);
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`${key} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new BadRequestException(`${key} is required`);
  }
  return trimmed;
}

function readNullableString(body: TargetBody, key: string): string | null | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`${key} must be a string or null`);
  }

  return value.trim() || null;
}

function readBigInt(body: TargetBody, key: string, required: boolean): bigint | undefined {
  const value = body[key];
  if (value === undefined) {
    if (required) {
      throw new BadRequestException(`${key} is required`);
    }
    return undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`${key} must be a number string`);
  }

  const raw = String(value).trim();
  if (!/^-?\d+$/.test(raw)) {
    throw new BadRequestException(`${key} must be an integer`);
  }

  return BigInt(raw);
}

function readStatus(body: TargetBody): UserTuStatus | undefined {
  const value = body.status;
  if (value === undefined) {
    return undefined;
  }
  if (value === UserTuStatus.active || value === UserTuStatus.inactive) {
    return value;
  }
  throw new BadRequestException('status must be active or inactive');
}

function parseTargetStatus(value?: string): UserTuStatus | 'all' | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (value === 'all' || value === UserTuStatus.active || value === UserTuStatus.inactive) {
    return value;
  }
  throw new BadRequestException('status must be all, active, or inactive');
}

function parsePositiveInt(value: string, field: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  return id;
}
