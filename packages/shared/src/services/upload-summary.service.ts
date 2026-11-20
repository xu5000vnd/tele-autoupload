import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/db/prisma.service';

@Injectable()
export class UploadSummaryService {
  constructor(private readonly prisma: PrismaService) {}

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

  formatSummary(rows: Record<string, unknown>[], dateArg?: string): string {
    const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const date = escapeHtml(rows[0]
      ? (rows[0] as { date: string }).date
      : (dateArg ?? new Date().toISOString().slice(0, 10)));

    const activeRows = rows
      .map((r) => r as {
        tu_name: string;
        telegram_username: string | null;
        media: { image: number; video: number; total: number };
        status_uploaded: { success: number; failed: number };
      })
      .filter((row) => row.media.total > 0);

    if (!activeRows.length) {
      return `📭 <b>No users uploaded media on ${date}.</b>`;
    }

    const lines = activeRows.map((row) => {
      const handle = row.telegram_username ? `@${escapeHtml(row.telegram_username)}` : 'no username';
      return (
        `👤 <b>${escapeHtml(row.tu_name)}</b> (${handle})\n` +
        `   🖼 ${row.media.image} images  🎬 ${row.media.video} videos  📦 Total: <b>${row.media.total}</b>\n` +
        `   ✅ Uploaded: ${row.status_uploaded.success}  ❌ Failed: ${row.status_uploaded.failed}`
      );
    });

    return `📊 <b>Summary — ${date}</b>\n\n${lines.join('\n\n')}`;
  }
}
