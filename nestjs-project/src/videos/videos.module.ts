import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import { PublicIdGenerator } from './public-id';
import { StartVideoUploadService } from './uploads/start-video-upload.service';
import { VideoPersistenceModule } from './video-persistence.module';
import { VideosController } from './videos.controller';
import { UploadPartsService } from './uploads/upload-parts.service';
import { UploadLifecycleModule } from './uploads/upload-lifecycle.module';
import { CompleteVideoUploadService } from './uploads/complete-video-upload.service';
import { VideoQueueModule } from './queue/video-queue.module';
import { AbortVideoUploadService } from './uploads/abort-video-upload.service';

@Module({
  imports: [
    ChannelsModule,
    StorageModule,
    VideoPersistenceModule,
    UploadLifecycleModule,
    VideoQueueModule,
  ],
  providers: [
    PublicIdGenerator,
    StartVideoUploadService,
    UploadPartsService,
    CompleteVideoUploadService,
    AbortVideoUploadService,
  ],
  controllers: [VideosController],
  exports: [
    StartVideoUploadService,
    UploadPartsService,
    CompleteVideoUploadService,
    AbortVideoUploadService,
  ],
})
export class VideosModule {}
