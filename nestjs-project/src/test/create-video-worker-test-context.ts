import { getQueueToken } from '@nestjs/bullmq';
import { NestFactory } from '@nestjs/core';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import {
  VideoWorkerModule,
  VIDEO_WORKER_QUEUE,
} from '../videos/processing/video-worker.module';
import { closeVideoWorker } from '../videos/processing/video-worker.lifecycle';
import { VideoProcessor } from '../videos/processing/video.processor';
import { cleanAllTables } from './create-test-data-source';
import { cleanVideoTestQueue, createVideoTestQueue } from './video-test-queue';
import {
  cleanVideoTestStorage,
  createVideoTestStorage,
} from './video-test-storage';

export async function createVideoWorkerTestContext(
  reconcileIntervalMs?: number,
) {
  const previous = process.env.VIDEO_RECONCILE_INTERVAL_MS;
  if (reconcileIntervalMs !== undefined)
    process.env.VIDEO_RECONCILE_INTERVAL_MS = String(reconcileIntervalMs);
  const app = await NestFactory.createApplicationContext(VideoWorkerModule, {
    logger: false,
  }).finally(() => {
    if (previous === undefined) delete process.env.VIDEO_RECONCILE_INTERVAL_MS;
    else process.env.VIDEO_RECONCILE_INTERVAL_MS = previous;
  });
  const processor = app.get(VideoProcessor);
  await processor.worker.waitUntilReady();
  const queue = createVideoTestQueue();
  await queue.waitUntilReady();
  const client = createVideoTestStorage();
  const dataSource = app.get(DataSource);
  return {
    app,
    processor,
    queue,
    client,
    dataSource,
    storage: app.get(StorageService),
    workerQueue: app.get<Queue>(getQueueToken(VIDEO_WORKER_QUEUE)),
    async clean(): Promise<void> {
      await processor.worker.pause();
      await cleanAllTables(dataSource);
      await cleanVideoTestStorage(client);
      await cleanVideoTestQueue(queue);
      processor.worker.resume();
    },
    async close(): Promise<void> {
      await closeVideoWorker(app);
      try {
        await cleanVideoTestStorage(client);
        await cleanVideoTestQueue(queue);
      } finally {
        client.destroy();
        await queue.close();
      }
    },
  };
}
