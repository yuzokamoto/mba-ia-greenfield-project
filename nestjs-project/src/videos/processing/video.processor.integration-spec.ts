import { QueueEvents } from 'bullmq';
import { readFile } from 'node:fs/promises';
import queueConfig from '../../config/queue.config';
import { createVideoWorkerTestContext } from '../../test/create-video-worker-test-context';
import {
  createProcessingFixture,
  waitForVideoStatus,
} from '../../test/video-processing-test-data';
import { createVideoTestMedia } from '../../test/video-test-media';
import { VideoStatus } from '../entities/video.entity';
import { PROCESS_VIDEO_JOB } from '../queue/video-queue.constants';
import { MediaInspectionService } from './media-inspection.service';

describe('VideoProcessor (integration)', () => {
  let context: Awaited<ReturnType<typeof createVideoWorkerTestContext>>;
  let media: Awaited<ReturnType<typeof createVideoTestMedia>>;
  let events: QueueEvents;
  beforeAll(async () => {
    context = await createVideoWorkerTestContext();
    media = await createVideoTestMedia();
    const config = queueConfig();
    events = new QueueEvents(config.name, {
      connection: { ...config.connection, maxRetriesPerRequest: null },
    });
    await events.waitUntilReady();
  });
  beforeEach(async () => {
    await context.clean();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await events.close();
    await context.close();
    await media.cleanup();
  });
  it('should process a valid real job and ignore terminal redelivery', async () => {
    const video = await createProcessingFixture(
      context,
      await readFile(media.validVideoPath),
    );
    const job = await context.queue.add(
      PROCESS_VIDEO_JOB,
      { videoId: video.id },
      { jobId: `video-${video.id}`, attempts: 3 },
    );
    await job.waitUntilFinished(events, 30000);
    const ready = await waitForVideoStatus(
      context.dataSource,
      video.id,
      VideoStatus.READY,
    );
    const redelivery = await context.queue.add(
      PROCESS_VIDEO_JOB,
      { videoId: video.id },
      { jobId: `redelivery-${video.id}` },
    );
    await redelivery.waitUntilFinished(events, 30000);
    expect(
      (
        await waitForVideoStatus(
          context.dataSource,
          video.id,
          VideoStatus.READY,
        )
      ).processing_attempts,
    ).toBe(ready.processing_attempts);
  }, 30000);
  it('should fail invalid media after one durable attempt without retries', async () => {
    const video = await createProcessingFixture(
      context,
      await readFile(media.invalidVideoPath),
    );
    const job = await context.queue.add(
      PROCESS_VIDEO_JOB,
      { videoId: video.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 10 } },
    );
    await expect(job.waitUntilFinished(events, 30000)).rejects.toThrow(
      'invalid_media',
    );
    const row = await waitForVideoStatus(
      context.dataSource,
      video.id,
      VideoStatus.ERROR,
    );
    expect(row.processing_attempts).toBe(1);
    expect(row.failure_reason).toBe('invalid_media');
    expect((await context.queue.getJob(job.id!))!.attemptsMade).toBe(1);
  });
  it('should exhaust transient failures with three total durable attempts and retained evidence', async () => {
    const video = await createProcessingFixture(
      context,
      await readFile(media.validVideoPath),
    );
    jest
      .spyOn(context.app.get(MediaInspectionService), 'inspect')
      .mockRejectedValue(new Error('transient private diagnostic'));
    const job = await context.queue.add(
      PROCESS_VIDEO_JOB,
      { videoId: video.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10 },
        removeOnFail: false,
      },
    );
    await expect(job.waitUntilFinished(events, 30000)).rejects.toThrow(
      'processing_failed',
    );
    const row = await waitForVideoStatus(
      context.dataSource,
      video.id,
      VideoStatus.ERROR,
    );
    expect(row.processing_attempts).toBe(3);
    expect(row.failure_reason).toBe('processing_failed');
    expect((await context.queue.getJob(job.id!))!.attemptsMade).toBe(3);
  });
});
