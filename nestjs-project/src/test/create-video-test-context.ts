import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runtimeConfigOptions } from '../config/runtime-config';
import { StorageService } from '../storage/storage.service';
import { StartVideoUploadService } from '../videos/uploads/start-video-upload.service';
import { cleanVideoTestQueue, createVideoTestQueue } from './video-test-queue';
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
  await module.init();
  const dataSource = module.get(DataSource);
  const client = createVideoTestStorage();
  const queue = createVideoTestQueue();
  await queue.waitUntilReady();
  return {
    module,
    dataSource,
    client,
    queue,
    storage: module.get(StorageService),
    start: module.get(StartVideoUploadService),
    async clean(): Promise<void> {
      await cleanAllTables(dataSource);
      await cleanVideoTestStorage(client);
      await cleanVideoTestQueue(queue);
    },
    async close(): Promise<void> {
      try {
        await cleanVideoTestStorage(client);
      } finally {
        client.destroy();
        try {
          await cleanVideoTestQueue(queue);
        } finally {
          try {
            await module.close();
          } finally {
            await queue.close();
          }
        }
      }
    },
  };
}
