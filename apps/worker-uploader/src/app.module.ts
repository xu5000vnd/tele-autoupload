import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SharedModule } from '@shared/services/shared.module';
import { FolderResolverService } from './folder-resolver.service';
import { UploaderService } from './uploader.service';

@Module({
  imports: [SharedModule, ScheduleModule.forRoot()],
  providers: [UploaderService, FolderResolverService],
})
export class AppModule {}
