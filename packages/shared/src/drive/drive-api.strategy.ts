import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { google } from 'googleapis';
import { appConfig } from '@shared/config/env';
import { DestinationInfo, DestinationRef, UploadMeta, UploadResult, UploadStrategy } from '@shared/drive/strategy';
import { dateFolderPath, sanitizeGroupTitle } from '@shared/utils/file-naming';

@Injectable()
export class DriveApiStrategy implements UploadStrategy {
  private readonly oauthClient = new google.auth.OAuth2(
    appConfig.drive.clientId,
    appConfig.drive.clientSecret,
  );

  constructor() {
    if (appConfig.drive.refreshToken) {
      this.oauthClient.setCredentials({ refresh_token: appConfig.drive.refreshToken });
    }
  }

  async ensureDestination(dest: DestinationInfo): Promise<DestinationRef> {
    const safeGroup = `${sanitizeGroupTitle(dest.chatTitle)}__${dest.chatId}`;
    const folderPath = `${safeGroup}/${dateFolderPath(dest.date)}`;
    return {
      folderId: appConfig.drive.rootFolderId ?? 'root',
      folderPath,
    };
  }

  async upload(localPath: string, destRef: DestinationRef, meta: UploadMeta): Promise<UploadResult> {
    const drive = google.drive({ version: 'v3', auth: this.oauthClient });
    const stat = await fs.stat(localPath);

    const response = await drive.files.create({
      requestBody: {
        name: meta.fileName,
        parents: [destRef.folderId],
      },
      media: {
        mimeType: meta.mimeType,
        body: (await import('node:fs')).createReadStream(localPath),
      },
      fields: 'id,webViewLink',
      supportsAllDrives: true,
    });

    return {
      remoteRef: response.data.id ?? path.basename(localPath),
      webUrl: response.data.webViewLink ?? undefined,
      status: 'uploaded',
      bytesUploaded: BigInt(stat.size),
    };
  }
}
