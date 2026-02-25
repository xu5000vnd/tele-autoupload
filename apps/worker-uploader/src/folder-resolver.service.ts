import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/db/prisma.service';
import { dateFolderPath } from '@shared/utils/file-naming';

@Injectable()
export class FolderResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async rememberDateFolder(chatId: bigint, date: Date, driveFolderId: string): Promise<void> {
    await this.prisma.driveDateFolderCache.upsert({
      where: {
        chatId_datePath: {
          chatId,
          datePath: dateFolderPath(date),
        },
      },
      update: {
        driveFolderId,
      },
      create: {
        chatId,
        datePath: dateFolderPath(date),
        driveFolderId,
      },
    });
  }
}
