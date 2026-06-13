import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { BearerAuthGuard } from './auth.guard';
import { MediaBackfillService } from './media-backfill.service';

type BackfillBody = Record<string, unknown>;

@Controller('api/backfill')
@UseGuards(BearerAuthGuard)
export class MediaBackfillController {
  constructor(private readonly mediaBackfillService: MediaBackfillService) {}

  @Post('media')
  media(@Body() body: BackfillBody): Promise<Record<string, unknown>> {
    return this.mediaBackfillService.backfill({
      chatId: readBigInt(body.chat_id, 'chat_id'),
      fromDate: readDate(body.from_date, 'from_date', 'start'),
      toDate: readDate(body.to_date, 'to_date', 'end'),
      dryRun: body.dry_run !== false,
    });
  }
}

function readBigInt(value: unknown, field: string): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new BadRequestException(`${field} is required`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new BadRequestException(`${field} must be a valid integer`);
  }
}

function readDate(value: unknown, field: string, boundary: 'start' | 'end'): Date {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${field} is required`);
  }

  const trimmed = value.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}+07:00`)
    : new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} must be a valid date`);
  }
  return date;
}
