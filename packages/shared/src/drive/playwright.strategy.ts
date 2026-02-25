import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { DestinationInfo, DestinationRef, UploadMeta, UploadResult, UploadStrategy } from '@shared/drive/strategy';

@Injectable()
export class PlaywrightStrategy implements UploadStrategy {
  async ensureDestination(dest: DestinationInfo): Promise<DestinationRef> {
    return {
      folderId: `${dest.chatId}`,
      folderPath: `${dest.chatTitle}/${dest.date.toISOString().slice(0, 10)}`,
    };
  }

  async upload(localPath: string, destRef: DestinationRef, meta: UploadMeta): Promise<UploadResult> {
    void destRef;
    void meta;
    const stat = await fs.stat(localPath);
    throw new Error(`Playwright upload is not implemented yet. bytes=${stat.size}`);
  }
}
