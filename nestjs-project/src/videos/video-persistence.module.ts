import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadSession } from './entities/upload-session.entity';
import { Video } from './entities/video.entity';
import { VideoRecordsService } from './video-records.service';
import { UploadSessionsService } from './uploads/upload-sessions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Video, UploadSession])],
  providers: [VideoRecordsService, UploadSessionsService],
  exports: [TypeOrmModule, VideoRecordsService, UploadSessionsService],
})
export class VideoPersistenceModule {}
