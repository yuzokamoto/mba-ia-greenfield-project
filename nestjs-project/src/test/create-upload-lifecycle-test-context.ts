import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runtimeConfigOptions } from '../config/runtime-config';
import { StorageService } from '../storage/storage.service';
import { UploadFinalizationService } from '../videos/uploads/upload-finalization.service';
import { UploadLifecycleModule } from '../videos/uploads/upload-lifecycle.module';
import {
  cleanAllTables,
  createTestDataSource,
} from './create-test-data-source';
import { VIDEO_TEST_ENTITIES } from './video-test-data';
import {
  cleanVideoTestStorage,
  createVideoTestStorage,
} from './video-test-storage';

export async function createUploadLifecycleTestContext() {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(runtimeConfigOptions),
      TypeOrmModule.forRoot(
        createTestDataSource(VIDEO_TEST_ENTITIES, { synchronize: false })
          .options,
      ),
      UploadLifecycleModule,
    ],
  }).compile();
  const dataSource = module.get(DataSource);
  const client = createVideoTestStorage();
  return {
    module,
    dataSource,
    client,
    storage: module.get(StorageService),
    finalizer: module.get(UploadFinalizationService),
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
