import type { S3Client } from '@aws-sdk/client-s3';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import {
  INTERNAL_S3_CLIENT,
  PUBLIC_S3_CLIENT,
} from '../storage/storage.constants';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanVideoTestStorage,
  createVideoTestStorage,
} from './video-test-storage';

export async function createStorageTestContext(
  options: {
    publicEndpoint?: string;
    internalClient?: S3Client;
    publicClient?: S3Client;
  } = {},
) {
  const builder = Test.createTestingModule({ imports: [StorageModule] });
  if (options.publicEndpoint) {
    builder
      .overrideProvider(storageConfig.KEY)
      .useValue({ ...storageConfig(), publicEndpoint: options.publicEndpoint });
  }
  if (options.internalClient)
    builder
      .overrideProvider(INTERNAL_S3_CLIENT)
      .useValue(options.internalClient);
  if (options.publicClient)
    builder.overrideProvider(PUBLIC_S3_CLIENT).useValue(options.publicClient);
  const module = await builder.compile();
  const client = createVideoTestStorage();
  return {
    module,
    client,
    storage: module.get(StorageService),
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
