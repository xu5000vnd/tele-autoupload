import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { appConfig } from '@shared/config/env';
import { DestinationInfo, DestinationRef, UploadMeta, UploadResult, UploadStrategy } from '@shared/drive/strategy';
import { dateFolderPath, dateFolderPathDdMmYy, dateFolderPathDdMmYyBucketed, sanitizeGroupTitle } from '@shared/utils/file-naming';

@Injectable()
export class DriveDesktopStrategy implements UploadStrategy {
  async ensureDestination(dest: DestinationInfo): Promise<DestinationRef> {
    const dateFolder = appConfig.drive.dateBucketEnabled
      ? dateFolderPathDdMmYyBucketed(dest.date, appConfig.drive.dateBucketDays)
      : dateFolderPathDdMmYy(dest.date);

    const folderPath = dest.userPath
      ? path.join(
          appConfig.drive.syncFolder ?? '',
          dest.userPath.replace(/^[/\\]+/, ''),
          dateFolder,
        )
      : path.join(
          appConfig.drive.syncFolder ?? '',
          `${sanitizeGroupTitle(dest.chatTitle)}__${dest.chatId}`,
          dateFolderPath(dest.date),
        );
    await fs.mkdir(folderPath, { recursive: true });
    return { folderId: folderPath, folderPath };
  }

  async upload(localPath: string, destRef: DestinationRef, meta: UploadMeta): Promise<UploadResult> {
    const target = path.join(destRef.folderPath, meta.fileName);
    await fs.copyFile(localPath, target);
    const stat = await fs.stat(localPath);
    return {
      remoteRef: target,
      status: 'pending_sync',
      bytesUploaded: BigInt(stat.size),
    };
  }

  async verify(): Promise<boolean> {
    return true;
  }
}
