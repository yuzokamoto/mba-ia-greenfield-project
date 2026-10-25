import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { runtimeConfigOptions } from '../config/runtime-config';
import {
  VideoProcessingProducer,
  type VideoProcessingPayload,
} from '../videos/queue/video-processing-producer.service';
import { VIDEO_QUEUE_REGISTRATION } from '../videos/queue/video-queue.constants';
import { VideoQueueModule } from '../videos/queue/video-queue.module';
import { cleanVideoTestQueue, createVideoTestQueue } from './video-test-queue';

export async function createVideoQueueTestContext() {
  const module = await Test.createTestingModule({
    imports: [ConfigModule.forRoot(runtimeConfigOptions), VideoQueueModule],
  }).compile();
  await module.init();
  const queue = module.get<Queue<VideoProcessingPayload>>(
    getQueueToken(VIDEO_QUEUE_REGISTRATION),
  );
  const admin = createVideoTestQueue();
  await admin.waitUntilReady();
  return {
    module,
    queue,
    admin,
    producer: module.get(VideoProcessingProducer),
    async close(): Promise<void> {
      try {
        await cleanVideoTestQueue(admin);
      } finally {
        try {
          await module.close();
        } finally {
          await admin.close();
        }
      }
    },
  };
}
