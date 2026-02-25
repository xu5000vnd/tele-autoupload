import { Injectable } from '@nestjs/common';
import { appConfig } from '@shared/config/env';
import { DriveApiStrategy } from '@shared/drive/drive-api.strategy';
import { DriveDesktopStrategy } from '@shared/drive/drive-desktop.strategy';
import { PlaywrightStrategy } from '@shared/drive/playwright.strategy';
import { UploadStrategy } from '@shared/drive/strategy';

@Injectable()
export class UploaderFactoryService {
  constructor(
    private readonly driveApiStrategy: DriveApiStrategy,
    private readonly driveDesktopStrategy: DriveDesktopStrategy,
    private readonly playwrightStrategy: PlaywrightStrategy,
  ) {}

  getStrategy(): UploadStrategy {
    switch (appConfig.uploadStrategy) {
      case 'drive_api':
        return this.driveApiStrategy;
      case 'drive_desktop':
        return this.driveDesktopStrategy;
      case 'playwright':
        return this.playwrightStrategy;
      default:
        throw new Error(`unsupported upload strategy: ${appConfig.uploadStrategy as string}`);
    }
  }
}
