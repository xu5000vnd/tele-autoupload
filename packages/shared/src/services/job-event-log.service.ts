import { Injectable } from '@nestjs/common';
import { JobEventType } from '@prisma/client';
import { PrismaService } from '@shared/db/prisma.service';

@Injectable()
export class JobEventLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(mediaItemId: string, eventType: JobEventType, details?: Record<string, unknown>): Promise<void> {
    await this.prisma.jobEventLog.create({
      data: {
        mediaItemId,
        eventType,
        details: details as any,
      },
    });
  }
}
