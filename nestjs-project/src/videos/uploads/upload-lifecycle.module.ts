import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { VideoPersistenceModule } from '../video-persistence.module';
import { UploadFinalizationService } from './upload-finalization.service';
import { UploadTerminationService } from './upload-termination.service';

@Module({
  imports: [StorageModule, VideoPersistenceModule],
  providers: [UploadFinalizationService, UploadTerminationService],
  exports: [UploadFinalizationService, UploadTerminationService],
})
export class UploadLifecycleModule {}
