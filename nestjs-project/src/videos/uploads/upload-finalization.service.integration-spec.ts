import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { StorageUnavailableException } from '../../common/exceptions/storage-unavailable.exception';
import { createVideoTestContext } from '../../test/create-video-test-context';
import {
  putLifecyclePart,
  seedLifecycleUpload,
} from '../../test/upload-lifecycle-test-data';
import { UploadSession } from '../entities/upload-session.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideoProcessingProducer } from '../queue/video-processing-producer.service';
import { VIDEO_QUEUE_REGISTRATION } from '../queue/video-queue.constants';
import { VideoRecordsService } from '../video-records.service';
import { CompleteVideoUploadService } from './complete-video-upload.service';
import { UploadFinalizationService } from './upload-finalization.service';
import { UploadSessionsService } from './upload-sessions.service';

describe('UploadFinalizationService (integration)', () => {
  let context: Awaited<ReturnType<typeof createVideoTestContext>>;
  let complete: CompleteVideoUploadService;
  let finalizer: UploadFinalizationService;
  beforeAll(async () => {
    context = await createVideoTestContext();
    complete = context.module.get(CompleteVideoUploadService);
    finalizer = context.module.get(UploadFinalizationService);
  });
  beforeEach(async () => {
    await context.clean();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await context.close();
  });
  async function populated(size = 1) {
    const upload = await seedLifecycleUpload(context, size);
    const part = await putLifecyclePart(
      context.storage,
      upload,
      1,
      new Uint8Array(size),
    );
    return { ...upload, parts: [part] };
  }
  async function states(videoId: string) {
    return {
      video: await context.dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: videoId }),
      session: await context.dataSource
        .getRepository(UploadSession)
        .findOneByOrFail({ video_id: videoId }),
    };
  }
  it('should publish exact deterministic intent only after the pair is committed and keep repeated terminal results', async () => {
    const upload = await populated();
    const producer = context.module.get(VideoProcessingProducer);
    const original = producer.enqueue.bind(
      producer,
    ) as VideoProcessingProducer['enqueue'];
    const enqueue = jest
      .spyOn(producer, 'enqueue')
      .mockImplementationOnce(async (videoId) => {
        const persisted = await states(videoId);
        expect(persisted.session.status).toBe('completed');
        expect(persisted.video.status).toBe('processing');
        return await original(videoId);
      });
    expect(
      (
        await complete.complete(
          upload.video.public_id,
          upload.userId,
          upload.parts,
        )
      ).status,
    ).toBe('processing');
    const job = await context.queue.getJob(`video-${upload.video.id}`);
    expect(job!.data).toEqual({ videoId: upload.video.id });
    expect(job!.opts.attempts).toBe(3);
    const records = context.module.get(VideoRecordsService);
    await records.updateState(
      upload.video.id,
      VideoStatus.PROCESSING,
      VideoStatus.READY,
      {
        thumbnail_key: `videos/${upload.video.id}/thumbnail.jpg`,
        duration: 1,
        metadata: { codec: 'h264' },
      },
    );
    expect(
      (
        await complete.complete(
          upload.video.public_id,
          upload.userId,
          upload.parts,
        )
      ).status,
    ).toBe('ready');
    expect(await context.queue.count()).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it('should recover an actually completed S3 object after the completion response is lost', async () => {
    const upload = await populated();
    const original = context.storage.completeMultipart.bind(
      context.storage,
    ) as typeof context.storage.completeMultipart;
    jest
      .spyOn(context.storage, 'completeMultipart')
      .mockImplementationOnce(async (reference, parts) => {
        await original(reference, parts);
        throw new StorageUnavailableException(new Error('lost S3 response'));
      });
    expect(
      (
        await complete.complete(
          upload.video.public_id,
          upload.userId,
          upload.parts,
        )
      ).status,
    ).toBe('processing');
    expect((await states(upload.video.id)).session.id).toBe(upload.session.id);
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toMatchObject({ size: 1 });
  });
  it('should recover the S3-before-commit failure window without allocating a new upload', async () => {
    const upload = await populated();
    const original = context.dataSource.createQueryRunner.bind(
      context.dataSource,
    ) as typeof context.dataSource.createQueryRunner;
    jest
      .spyOn(context.dataSource, 'createQueryRunner')
      .mockImplementationOnce((mode) => {
        const runner = original(mode);
        jest
          .spyOn(runner, 'commitTransaction')
          .mockRejectedValueOnce(new Error('commit failed'));
        return runner;
      });
    await expect(
      complete.complete(upload.video.public_id, upload.userId, upload.parts),
    ).rejects.toThrow('commit failed');
    const undecided = await states(upload.video.id);
    expect(undecided.session.status).toBe('active');
    expect(undecided.video.status).toBe('draft');
    expect(await context.queue.count()).toBe(0);
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toMatchObject({ size: 1 });
    expect(
      (
        await complete.complete(
          upload.video.public_id,
          upload.userId,
          upload.parts,
        )
      ).status,
    ).toBe('processing');
    expect((await states(upload.video.id)).session.id).toBe(upload.session.id);
  });
  it('should hold a real session row lock and serialize concurrent completion into one transition/job', async () => {
    const upload = await populated();
    let entered!: () => void;
    let release!: () => void;
    const entering = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = context.storage.completeMultipart.bind(
      context.storage,
    ) as typeof context.storage.completeMultipart;
    const completion = jest
      .spyOn(context.storage, 'completeMultipart')
      .mockImplementationOnce(async (ref, parts) => {
        entered();
        await gate;
        return await original(ref, parts);
      });
    const first = complete.complete(
      upload.video.public_id,
      upload.userId,
      upload.parts,
    );
    await entering;
    const contender = context.dataSource.createQueryRunner();
    await contender.connect();
    await contender.startTransaction();
    try {
      await contender.query("SET LOCAL lock_timeout = '100ms'");
      await expect(
        context.module
          .get(UploadSessionsService)
          .lockForVideo(upload.video.id, contender.manager),
      ).rejects.toMatchObject({ driverError: { code: '55P03' } });
    } finally {
      await contender.rollbackTransaction();
      await contender.release();
      release();
    }
    const second = complete.complete(
      upload.video.public_id,
      upload.userId,
      upload.parts,
    );
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.status)).toEqual([
      'processing',
      'processing',
    ]);
    expect(completion).toHaveBeenCalledTimes(1);
    expect(await context.queue.count()).toBe(1);
  });
  it('should validate real paginated exact part sizes while all source bytes transfer outside SQL transactions', async () => {
    const upload = await seedLifecycleUpload(context, 67108865);
    const transaction = jest.spyOn(context.dataSource, 'transaction');
    const first = await putLifecyclePart(
      context.storage,
      upload,
      1,
      new Uint8Array(67108864),
    );
    const second = await putLifecyclePart(
      context.storage,
      upload,
      2,
      new Uint8Array([1]),
    );
    expect(transaction).not.toHaveBeenCalled();
    const original = context.storage.listParts.bind(
      context.storage,
    ) as typeof context.storage.listParts;
    jest
      .spyOn(context.storage, 'listParts')
      .mockImplementation(async (reference) => await original(reference, 1));
    expect(
      (
        await complete.complete(upload.video.public_id, upload.userId, [
          second,
          first,
        ])
      ).status,
    ).toBe('processing');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toMatchObject({ size: 67108865 });
  }, 30000);
  it('should reject incorrect actual part sizes before storage completion without publishing', async () => {
    const upload = await seedLifecycleUpload(context, 2);
    const part = await putLifecyclePart(
      context.storage,
      upload,
      1,
      new Uint8Array([1]),
    );
    await expect(
      complete.complete(upload.video.public_id, upload.userId, [part]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_PARTS_INVALID' });
    expect((await states(upload.video.id)).session.status).toBe('active');
    expect(await context.queue.count()).toBe(0);
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toBeNull();
  });
  it('should delete a mismatching completed object and durably reject it with a safe reason', async () => {
    const upload = await seedLifecycleUpload(context, 2);
    const part = await putLifecyclePart(
      context.storage,
      upload,
      1,
      new Uint8Array([1]),
    );
    await context.storage.completeMultipart(
      { key: upload.video.original_key, uploadId: upload.session.upload_id },
      [{ partNumber: part.part_number, etag: part.etag }],
    );
    await expect(
      complete.complete(upload.video.public_id, upload.userId, [part]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_SIZE_MISMATCH' });
    const persisted = await states(upload.video.id);
    expect(persisted.video.status).toBe('error');
    expect(persisted.video.failure_reason).toBe('processing_failed');
    expect(persisted.session.status).toBe('aborted');
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toBeNull();
    expect(await context.queue.count()).toBe(0);
  });
  it('should leave verification pending on unavailable HeadObject and recover on a later call', async () => {
    const upload = await populated();
    jest
      .spyOn(context.storage, 'headObject')
      .mockRejectedValueOnce(
        new StorageUnavailableException(new Error('offline')),
      );
    await expect(
      finalizer.complete(upload.video.public_id, upload.userId, upload.parts),
    ).rejects.toMatchObject({ errorCode: 'STORAGE_UNAVAILABLE' });
    expect((await states(upload.video.id)).session.status).toBe('active');
    expect(await context.queue.count()).toBe(0);
    expect(
      (
        await complete.complete(
          upload.video.public_id,
          upload.userId,
          upload.parts,
        )
      ).status,
    ).toBe('processing');
  });
  it('should return promptly with durable intent when an established producer loses Redis', async () => {
    const upload = await populated();
    const queue = context.module.get<Queue>(
      getQueueToken(VIDEO_QUEUE_REGISTRATION),
    );
    const client = await queue.client;
    expect(client.status).toBe('ready');
    const ended = new Promise<void>((resolve) => {
      client.once('end', resolve);
    });
    client.disconnect();
    await ended;
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const started = performance.now();
    expect(
      (
        await complete.complete(
          upload.video.public_id,
          upload.userId,
          upload.parts,
        )
      ).status,
    ).toBe('processing');
    expect(performance.now() - started).toBeLessThan(3000);
    expect((await states(upload.video.id)).session.status).toBe('completed');
    expect(await context.queue.count()).toBe(0);
    expect(warn.mock.calls).toContainEqual([
      'Video processing publication deferred',
    ]);
  }, 10000);
});
