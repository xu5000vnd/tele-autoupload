import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { BearerAuthGuard } from './auth.guard';
import { MessagesService } from './messages.service';

@Controller('api/messages')
@UseGuards(BearerAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('targets')
  async targets(@Query('query') query?: string): Promise<Record<string, unknown>[]> {
    return this.messagesService.listTargets(query);
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
