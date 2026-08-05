import { Module } from '@nestjs/common';
import { SharedModule } from '@shared/services/shared.module';
import { DownloaderService } from './downloader.service';

@Module({
  imports: [SharedModule],
  providers: [DownloaderService],
})
export class AppModule {}
