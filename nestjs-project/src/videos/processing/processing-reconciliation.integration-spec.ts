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
import {
  putLifecyclePart,
  seedLifecycleUpload,
} from '../../test/upload-lifecycle-test-data';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideoProcessingProducer } from '../queue/video-processing-producer.service';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_QUEUE_REGISTRATION,
} from '../queue/video-queue.constants';
import { CompleteVideoUploadService } from '../uploads/complete-video-upload.service';
import { UploadFinalizationService } from '../uploads/upload-finalization.service';
import { VideoRecordsService } from '../video-records.service';
import { MediaInspectionService } from './media-inspection.service';
import { VideoReconcilerService } from './video-reconciler.service';

describe('Processing reconciliation (integration)', () => {
  let context: Awaited<ReturnType<typeof createVideoWorkerTestContext>>;
  let media: Awaited<ReturnType<typeof createVideoTestMedia>>;
  let events: QueueEvents;
  let reconciler: VideoReconcilerService;
  let producer: VideoProcessingProducer;
  beforeAll(async () => {
    context = await createVideoWorkerTestContext();
    reconciler = context.app.get(VideoReconcilerService);
    producer = context.app.get(VideoProcessingProducer);
    media = await createVideoTestMedia();
    const config = queueConfig();
    events = new QueueEvents(config.name, {
      connection: { ...config.connection, maxRetriesPerRequest: null },
    });
    await events.waitUntilReady();
  });
  beforeEach(async () => {
    await context.clean();
    await context.processor.worker.pause();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await events.close();
    await context.close();
    await media.cleanup();
  });
  async function fixture(attempts = 0, invalid = false) {
    return await createProcessingFixture(
      context,
      await readFile(invalid ? media.invalidVideoPath : media.validVideoPath),
      attempts,
    );
  }
  async function row(id: string) {
    return await context.dataSource
      .getRepository(Video)
      .findOneByOrFail({ id });
  }
  async function finish(id: string) {
    const job = await context.queue.getJob(`video-${id}`);
    expect(job).toBeDefined();
    context.processor.worker.resume();
    await job!.waitUntilFinished(events, 30000);
    return await waitForVideoStatus(context.dataSource, id, VideoStatus.READY);
  }
  it('should recover publication after a real producer disconnect following completion commit', async () => {
    const bytes = new Uint8Array(await readFile(media.validVideoPath));
    const upload = await seedLifecycleUpload(
      { ...context, module: context.app },
      bytes.length,
    );
    const part = await putLifecyclePart(context.storage, upload, 1, bytes);
    const apiComplete = new CompleteVideoUploadService(
      context.app.get(UploadFinalizationService),
      producer,
      context.app.get(VideoRecordsService),
    );
    const queue = context.app.get<Queue>(
      getQueueToken(VIDEO_QUEUE_REGISTRATION),
    );
    const client = await queue.client;
    client.disconnect();
    try {
      expect(
        (
          await apiComplete.complete(upload.video.public_id, upload.userId, [
            part,
          ])
        ).status,
      ).toBe('processing');
      await reconciler.tick();
      expect((await row(upload.video.id)).status).toBe('processing');
      expect(
        await context.queue.getJob(`video-${upload.video.id}`),
      ).toBeUndefined();
    } finally {
      await client.connect();
    }
    await reconciler.tick();
    expect((await finish(upload.video.id)).processing_attempts).toBe(1);
  });
  it('should recreate lost Redis intent with only one remaining durable attempt', async () => {
    const video = await fixture(2);
    await producer.enqueue(video.id);
    await context.queue.obliterate({ force: true });
    await reconciler.tick();
    const recovered = await context.queue.getJob(`video-${video.id}`);
    expect(recovered!.opts.attempts).toBe(1);
    expect((await finish(video.id)).processing_attempts).toBe(3);
  });
  it.each([false, true])(
    'should terminate exhausted missing/completed intent, completed evidence: %s',
    async (completed) => {
      const video = await fixture(completed ? 0 : 3);
      if (completed) {
        await producer.enqueue(video.id);
        await finish(video.id);
        await context.processor.worker.pause();
        await context.dataSource.getRepository(Video).update(video.id, {
          status: VideoStatus.PROCESSING,
          processing_attempts: 3,
        });
      }
      await reconciler.tick();
      expect(await row(video.id)).toMatchObject({
        status: 'error',
        failure_reason: 'processing_failed',
        processing_attempts: 3,
      });
      if (completed)
        expect(
          await (await context.queue.getJob(`video-${video.id}`))!.getState(),
        ).toBe('completed');
      else
        expect(await context.queue.getJob(`video-${video.id}`)).toBeUndefined();
    },
  );
  it('should replace inspected completed evidence when its ready write was missed', async () => {
    const video = await fixture();
    await producer.enqueue(video.id);
    await finish(video.id);
    await context.processor.worker.pause();
    await context.dataSource
      .getRepository(Video)
      .update(video.id, { status: VideoStatus.PROCESSING });
    await reconciler.tick();
    const recovered = await context.queue.getJob(`video-${video.id}`);
    expect(await recovered!.getState()).toBe('waiting');
    expect(recovered!.opts.attempts).toBe(2);
    expect((await finish(video.id)).processing_attempts).toBe(2);
  }, 30000);
  it('should repair a missed invalid-media terminal write from retained failed evidence', async () => {
    const video = await fixture(0, true);
    const job = await producer.enqueue(video.id);
    context.processor.worker.resume();
    await expect(job.waitUntilFinished(events, 30000)).rejects.toThrow(
      'invalid_media',
    );
    await context.processor.worker.pause();
    await context.dataSource.getRepository(Video).update(video.id, {
      status: VideoStatus.PROCESSING,
      failure_reason: null,
    });
    await reconciler.tick();
    expect(await row(video.id)).toMatchObject({
      status: 'error',
      failure_reason: 'invalid_media',
      processing_attempts: 1,
    });
    expect(await (await context.queue.getJob(job.id!))!.getState()).toBe(
      'failed',
    );
  });
  it.each([0, 60000])(
    'should preserve a live waiting/delayed job with delay %i',
    async (delay) => {
      const video = await fixture();
      const job = await context.queue.add(
        PROCESS_VIDEO_JOB,
        { videoId: video.id },
        { jobId: `video-${video.id}`, attempts: 3, delay },
      );
      const enqueue = jest.spyOn(producer, 'enqueue');
      await reconciler.tick();
      expect(await job.getState()).toBe(delay ? 'delayed' : 'waiting');
      expect(enqueue).not.toHaveBeenCalled();
      expect(await row(video.id)).toMatchObject({
        status: 'processing',
        processing_attempts: 0,
      });
    },
  );
  it('should preserve a real active job while native inspection is held at a controlled boundary', async () => {
    const video = await fixture();
    const inspection = context.app.get(MediaInspectionService);
    const inspect = jest.spyOn(inspection, 'inspect');
    let started!: () => void;
    let release!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    inspect.mockImplementationOnce(async (...args) => {
      started();
      await held;
      inspect.mockRestore();
      return await inspection.inspect(...args);
    });
    const job = await producer.enqueue(video.id);
    context.processor.worker.resume();
    try {
      await active;
      const enqueue = jest.spyOn(producer, 'enqueue');
      await reconciler.tick();
      expect(await job.getState()).toBe('active');
      expect(enqueue).not.toHaveBeenCalled();
      expect((await row(video.id)).status).toBe('processing');
    } finally {
      release();
    }
    await job.waitUntilFinished(events, 30000);
    expect((await row(video.id)).processing_attempts).toBe(1);
  });
  it('should preserve ready/error rows even when stale deterministic jobs are waiting', async () => {
    const ready = await fixture();
    const error = await fixture(3);
    await context.dataSource.getRepository(Video).update(ready.id, {
      status: VideoStatus.READY,
      duration: 1,
      metadata: { video: { codec: 'h264' } },
      thumbnail_key: `videos/${ready.id}/thumbnail.jpg`,
    });
    await context.dataSource
      .getRepository(Video)
      .update(error.id, { status: VideoStatus.ERROR });
    await producer.enqueue(ready.id);
    await producer.enqueue(error.id);
    const enqueue = jest.spyOn(producer, 'enqueue');
    await reconciler.tick();
    expect(enqueue).not.toHaveBeenCalled();
    expect((await row(ready.id)).status).toBe('ready');
    expect((await row(error.id)).status).toBe('error');
  });
  it('should recover through its actual positive timer and close it with the worker context', async () => {
    const scheduled = await createVideoWorkerTestContext(20);
    try {
      await scheduled.processor.worker.pause();
      const video = await createProcessingFixture(
        scheduled,
        await readFile(media.validVideoPath),
      );
      scheduled.processor.worker.resume();
      const ready = await waitForVideoStatus(
        scheduled.dataSource,
        video.id,
        VideoStatus.READY,
      );
      expect(ready.processing_attempts).toBe(1);
      const job = await scheduled.queue.getJob(`video-${video.id}`);
      await job!.waitUntilFinished(events, 30000);
    } finally {
      await scheduled.close();
    }
  });
});
