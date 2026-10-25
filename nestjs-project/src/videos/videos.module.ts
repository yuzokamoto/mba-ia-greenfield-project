import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import { PublicIdGenerator } from './public-id';
import { StartVideoUploadService } from './uploads/start-video-upload.service';
import { VideoPersistenceModule } from './video-persistence.module';
import { VideosController } from './videos.controller';
import { UploadPartsService } from './uploads/upload-parts.service';

@Module({
  imports: [ChannelsModule, StorageModule, VideoPersistenceModule],
  providers: [PublicIdGenerator, StartVideoUploadService, UploadPartsService],
  controllers: [VideosController],
  exports: [StartVideoUploadService, UploadPartsService],
})
export class VideosModule {}
