import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runtimeConfigOptions } from '../config/runtime-config';
import { StorageService } from '../storage/storage.service';
import { StartVideoUploadService } from '../videos/uploads/start-video-upload.service';
import { VideosModule } from '../videos/videos.module';
import {
  cleanAllTables,
  createTestDataSource,
} from './create-test-data-source';
import { VIDEO_TEST_ENTITIES } from './video-test-data';
import {
  cleanVideoTestStorage,
  createVideoTestStorage,
} from './video-test-storage';

export async function createVideoTestContext() {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(runtimeConfigOptions),
      TypeOrmModule.forRoot(
        createTestDataSource(VIDEO_TEST_ENTITIES, { synchronize: false })
          .options,
      ),
      VideosModule,
    ],
  }).compile();
  const dataSource = module.get(DataSource);
  const client = createVideoTestStorage();
  return {
    module,
    dataSource,
    client,
    storage: module.get(StorageService),
    start: module.get(StartVideoUploadService),
    async clean(): Promise<void> {
      await cleanAllTables(dataSource);
      await cleanVideoTestStorage(client);
    },
    async close(): Promise<void> {
      try {
        await cleanVideoTestStorage(client);
      } finally {
        client.destroy();
        await module.close();
      }
    },
  };
}
