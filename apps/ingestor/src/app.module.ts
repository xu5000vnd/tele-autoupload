import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SharedModule } from '@shared/services/shared.module';
import { IngestorService } from './ingestor.service';

@Module({
  imports: [SharedModule, ScheduleModule.forRoot()],
  providers: [IngestorService],
})
export class AppModule {}
