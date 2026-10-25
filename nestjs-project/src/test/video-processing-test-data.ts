import type { DataSource } from 'typeorm';
import type { S3Client } from '@aws-sdk/client-s3';
import { setTimeout as delay } from 'node:timers/promises';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { createVideoFixture } from './video-test-data';
import { uploadVideoTestMultipart } from './video-test-storage';

export async function createProcessingFixture(
  context: { dataSource: DataSource; client: S3Client },
  body: Buffer,
  attempts = 0,
) {
  const video = await createVideoFixture(context.dataSource, {
    declared_size: String(body.length),
    status: VideoStatus.PROCESSING,
    processing_attempts: attempts,
  });
  await uploadVideoTestMultipart(context.client, video.original_key, [body]);
  return video;
}

export async function waitForVideoStatus(
  dataSource: DataSource,
  id: string,
  status: VideoStatus,
): Promise<Video> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const video = await dataSource.getRepository(Video).findOneByOrFail({ id });
    if (video.status === status) return video;
    await delay(20);
  }
  throw new Error(`Video did not reach ${status}`);
}
