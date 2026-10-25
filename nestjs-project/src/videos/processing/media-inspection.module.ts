import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import videoConfig from '../../config/video.config';
import storageConfig from '../../config/storage.config';
import { StorageModule } from '../../storage/storage.module';
import { MediaInspectionService } from './media-inspection.service';
import { MediaProcessService } from './media-process.service';
import { MediaSourceService } from './media-source.service';

@Module({
  imports: [
    ConfigModule.forFeature(videoConfig),
    ConfigModule.forFeature(storageConfig),
    StorageModule,
  ],
  providers: [MediaInspectionService, MediaProcessService, MediaSourceService],
  exports: [MediaInspectionService],
})
export class MediaInspectionModule {}
