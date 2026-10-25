import { getQueueToken } from '@nestjs/bullmq';
import { QueueEvents, type Queue } from 'bullmq';
import { readFile } from 'node:fs/promises';
import queueConfig from '../../config/queue.config';
import { createVideoWorkerTestContext } from '../../test/create-video-worker-test-context';
import {
  createProcessingFixture,
  waitForVideoStatus,
} from '../../test/video-processing-test-data';
import { createVideoTestMedia } from '../../test/video-test-media';
import { VIDEO_TEST_QUEUE } from '../../test/video-test-environment';
import { VideoStatus } from '../entities/video.entity';
import { VIDEO_QUEUE_REGISTRATION } from '../queue/video-queue.constants';

// Force the former DI collision while keeping every real client on the test queue.
jest.mock('../queue/video-queue.constants', () => ({
  ...jest.requireActual<typeof import('../queue/video-queue.constants')>(
    '../queue/video-queue.constants',
  ),
  VIDEO_QUEUE_REGISTRATION: 'video-processing-test',
}));

describe('Video worker connection isolation (integration)', () => {
  it('should consume jobs with its own blocking connection even when producer registration matches the Redis queue name', async () => {
    const context = await createVideoWorkerTestContext();
    const media = await createVideoTestMedia();
    const config = queueConfig();
    const events = new QueueEvents(config.name, {
      connection: { ...config.connection, maxRetriesPerRequest: null },
    });
    try {
      await context.clean();
      await events.waitUntilReady();
      expect(String(VIDEO_QUEUE_REGISTRATION)).toBe(VIDEO_TEST_QUEUE);
      const producerQueue = context.app.get<Queue>(
        getQueueToken(VIDEO_QUEUE_REGISTRATION),
      );
      expect((await producerQueue.client).options.commandTimeout).toBe(2000);
      const workerConnection = context.processor.worker.opts.connection;
      expect(workerConnection).toMatchObject({ maxRetriesPerRequest: null });
      expect(workerConnection).not.toHaveProperty('commandTimeout');
      expect(workerConnection).not.toHaveProperty('enableOfflineQueue', false);
      const client = await context.processor.worker.client;
      expect(client.options.maxRetriesPerRequest).toBeNull();
      expect(client.options.commandTimeout).toBeUndefined();
      expect(client.options.enableOfflineQueue).toBe(true);
      const video = await createProcessingFixture(
        context,
        await readFile(media.validVideoPath),
      );
      const job = await context.queue.add(
        'process-video',
        { videoId: video.id },
        { jobId: `video-${video.id}` },
      );
      await job.waitUntilFinished(events, 30000);
      expect(
        (
          await waitForVideoStatus(
            context.dataSource,
            video.id,
            VideoStatus.READY,
          )
        ).processing_attempts,
      ).toBe(1);
    } finally {
      await events.close();
      await context.close();
      await media.cleanup();
    }
  }, 30000);
});
