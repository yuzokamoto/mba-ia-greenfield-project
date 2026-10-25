import { QueueEvents, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import queueConfig from '../../config/queue.config';
import { createVideoQueueTestContext } from '../../test/create-video-queue-test-context';
import { cleanVideoTestQueue } from '../../test/video-test-queue';
import { VideoQueueUnavailableError } from './video-queue-unavailable.error';

describe('VideoProcessingProducer (integration)', () => {
  let context: Awaited<ReturnType<typeof createVideoQueueTestContext>>;
  beforeAll(async () => {
    context = await createVideoQueueTestContext();
  });
  beforeEach(async () => {
    await cleanVideoTestQueue(context.admin);
  });
  afterAll(async () => {
    await context?.close();
  });

  it('should publish the exact deterministic job, minimal payload, and three-attempt exponential budget', async () => {
    const videoId = randomUUID();
    const job = await context.producer.enqueue(videoId);
    const stored = await context.admin.getJob(job.id!);
    expect(stored!.name).toBe('process-video');
    expect(stored!.data).toEqual({ videoId });
    expect(stored!.id).toBe(`video-${videoId}`);
    expect(stored!.id).not.toContain(':');
    expect(stored!.opts).toMatchObject({
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: queueConfig().processingBackoffMs,
      },
      removeOnComplete: false,
      removeOnFail: false,
    });
    expect((await context.producer.findJob(videoId))!.id).toBe(stored!.id);
    expect(await context.producer.findJob(randomUUID())).toBeUndefined();
  });

  it('should not duplicate existing work or reset its stored remaining retry budget', async () => {
    const videoId = randomUUID();
    await context.producer.enqueue(videoId, 2);
    await context.producer.enqueue(videoId);
    const stored = await context.producer.findJob(videoId);
    expect(stored!.opts.attempts).toBe(2);
    expect(await context.admin.getJobCounts('waiting')).toMatchObject({
      waiting: 1,
    });
  });

  it.each([0, 4, 1.5])(
    'should reject invalid remaining budget %s as a programming error',
    async (budget) => {
      await expect(
        context.producer.enqueue(randomUUID(), budget),
      ).rejects.toBeInstanceOf(RangeError);
      expect(await context.admin.count()).toBe(0);
    },
  );

  it('should reject malformed payloads without classifying them as Redis outages', async () => {
    await expect(
      context.producer.enqueue('malformed:id'),
    ).rejects.toBeInstanceOf(TypeError);
    expect(await context.admin.count()).toBe(0);
  });

  it.each(['completed', 'failed'] as const)(
    'should retain %s job evidence through duplicate publication',
    async (terminal) => {
      const config = queueConfig();
      const connection = { ...config.connection, maxRetriesPerRequest: null };
      const events = new QueueEvents(config.name, { connection });
      const worker = new Worker(
        config.name,
        () =>
          terminal === 'failed'
            ? Promise.reject(new Error('processing_failed'))
            : Promise.resolve('processed'),
        { connection, concurrency: 1 },
      );
      try {
        await events.waitUntilReady();
        await worker.waitUntilReady();
        const videoId = randomUUID();
        const job = await context.producer.enqueue(videoId, 1);
        if (terminal === 'failed')
          await expect(job.waitUntilFinished(events, 5000)).rejects.toThrow(
            'processing_failed',
          );
        else await job.waitUntilFinished(events, 5000);
        await context.producer.enqueue(videoId);
        const stored = await context.producer.findJob(videoId);
        expect(await stored!.getState()).toBe(terminal);
        expect(stored!.opts.attempts).toBe(1);
        expect(stored!.attemptsMade).toBe(1);
        expect(await context.admin.getJobCounts(terminal)).toMatchObject({
          [terminal]: 1,
        });
      } finally {
        await worker.close();
        await events.close();
      }
    },
  );

  it('should propagate an unrelated real Redis command failure', async () => {
    const client = await context.admin.client;
    const key = context.queue.toKey('wait');
    await client.set(key, 'wrong-type');
    try {
      await expect(context.producer.enqueue(randomUUID())).rejects.toThrow(
        'WRONGTYPE',
      );
      await expect(
        context.producer.enqueue(randomUUID()),
      ).rejects.not.toBeInstanceOf(VideoQueueUnavailableError);
    } finally {
      await client.del(key);
    }
  });

  it('should fail promptly after an established producer connection disconnects', async () => {
    const isolated = await createVideoQueueTestContext();
    try {
      await isolated.producer.enqueue(randomUUID());
      const client = await isolated.queue.client;
      expect(client.status).toBe('ready');
      const ended = new Promise<void>((resolve) => {
        client.once('end', resolve);
      });
      client.disconnect();
      await ended;
      const start = performance.now();
      await expect(
        isolated.producer.enqueue(randomUUID()),
      ).rejects.toBeInstanceOf(VideoQueueUnavailableError);
      expect(performance.now() - start).toBeLessThan(3000);
    } finally {
      await isolated.close();
    }
  }, 10000);
});
