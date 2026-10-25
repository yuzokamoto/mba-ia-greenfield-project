import { ListMultipartUploadsCommand } from '@aws-sdk/client-s3';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { ChannelsService } from '../../src/channels/channels.service';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import { StorageService } from '../../src/storage/storage.service';
import { cleanAllTables } from '../../src/test/create-test-data-source';
import { VIDEO_TEST_BUCKET } from '../../src/test/video-test-environment';
import {
  cleanVideoTestStorage,
  createVideoTestStorage,
} from '../../src/test/video-test-storage';
import { User } from '../../src/users/entities/user.entity';
import { UploadSession } from '../../src/videos/entities/upload-session.entity';
import { Video } from '../../src/videos/entities/video.entity';
import { StartVideoUploadService } from '../../src/videos/uploads/start-video-upload.service';
import {
  cleanVideoTestQueue,
  createVideoTestQueue,
} from '../../src/test/video-test-queue';

export type HttpResponse<T> = Omit<Response, 'body'> & { body: T };
export interface HttpErrorBody {
  statusCode: number;
  error?: string;
  message: string | string[];
}

export const startUploadBody = {
  title: 'Example',
  original_filename: 'example.mp4',
  content_type: 'video/mp4',
  declared_size: 67108865,
};

export async function createVideoE2eContext() {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app: INestApplication<App> = module.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();
  const dataSource = app.get(DataSource);
  const client = createVideoTestStorage();
  const queue = createVideoTestQueue();
  await queue.waitUntilReady();
  const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
  const jwt = app.get(JwtService);
  async function seedUser(withChannel = true) {
    const user = await dataSource.getRepository(User).save({
      email: `${randomUUID()}@example.com`,
      password: 'fixture-hash',
      is_confirmed: true,
    });
    const channel = withChannel
      ? await app.get(ChannelsService).createChannel(user.id, user.email)
      : null;
    const token = await jwt.signAsync({ sub: user.id, email: user.email });
    return { user, channel, token };
  }
  return {
    app,
    dataSource,
    client,
    queue,
    jwt,
    throttler,
    async storageParts(key: string, uploadId: string) {
      return await app.get(StorageService).listParts({ key, uploadId });
    },
    seedUser,
    async seedUpload(declaredSize = startUploadBody.declared_size) {
      const owner = await seedUser();
      const response = await app
        .get(StartVideoUploadService)
        .start(owner.user.id, {
          ...startUploadBody,
          declared_size: declaredSize,
        });
      const video = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: response.video.id });
      const session = await dataSource
        .getRepository(UploadSession)
        .findOneByOrFail({ video_id: video.id });
      return { ...owner, video, session, response };
    },
    async uploads() {
      return (
        (
          await client.send(
            new ListMultipartUploadsCommand({ Bucket: VIDEO_TEST_BUCKET }),
          )
        ).Uploads ?? []
      );
    },
    async counts() {
      return {
        videos: await dataSource.getRepository(Video).count(),
        sessions: await dataSource.getRepository(UploadSession).count(),
        uploads: (
          (
            await client.send(
              new ListMultipartUploadsCommand({ Bucket: VIDEO_TEST_BUCKET }),
            )
          ).Uploads ?? []
        ).length,
      };
    },
    async clean(): Promise<void> {
      await cleanAllTables(dataSource);
      await cleanVideoTestStorage(client);
      await cleanVideoTestQueue(queue);
      throttler.storage.clear();
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
            await app.close();
          } finally {
            await queue.close();
          }
        }
      }
    },
  };
}
