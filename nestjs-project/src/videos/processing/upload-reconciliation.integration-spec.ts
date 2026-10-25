import { StorageUnavailableException } from '../../common/exceptions/storage-unavailable.exception';
import { createVideoWorkerTestContext } from '../../test/create-video-worker-test-context';
import {
  putLifecyclePart,
  seedLifecycleUpload,
} from '../../test/upload-lifecycle-test-data';
import {
  UploadSession,
  UploadSessionStatus,
} from '../entities/upload-session.entity';
import { Video } from '../entities/video.entity';
import { VideoProcessingProducer } from '../queue/video-processing-producer.service';
import { CompleteVideoUploadService } from '../uploads/complete-video-upload.service';
import { UploadFinalizationService } from '../uploads/upload-finalization.service';
import { UploadSessionsService } from '../uploads/upload-sessions.service';
import { UploadTerminationService } from '../uploads/upload-termination.service';
import { VideoRecordsService } from '../video-records.service';
import { VideoReconcilerService } from './video-reconciler.service';

describe('Upload reconciliation (integration)', () => {
  let context: Awaited<ReturnType<typeof createVideoWorkerTestContext>>;
  let reconciler: VideoReconcilerService;
  beforeAll(async () => {
    context = await createVideoWorkerTestContext();
    reconciler = context.app.get(VideoReconcilerService);
  });
  beforeEach(async () => {
    await context.clean();
    await context.processor.worker.pause();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await context.close();
  });
  async function seed(completed = true, declaredSize = 1) {
    const upload = await seedLifecycleUpload(
      { ...context, module: context.app },
      declaredSize,
    );
    const part = await putLifecyclePart(
      context.storage,
      upload,
      1,
      new Uint8Array([1]),
    );
    if (completed)
      await context.storage.completeMultipart(
        { key: upload.video.original_key, uploadId: upload.session.upload_id },
        [{ partNumber: 1, etag: part.etag }],
      );
    await context.dataSource
      .getRepository(UploadSession)
      .update(upload.session.id, { expires_at: new Date(Date.now() - 1) });
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
  it('should recover an S3-completed active session without a client retry or replacement record', async () => {
    const upload = await seed();
    await reconciler.tick();
    const result = await states(upload.video.id);
    expect(result.session.id).toBe(upload.session.id);
    expect(result.session.status).toBe('completed');
    expect(result.video.public_id).toBe(upload.video.public_id);
    expect(result.video.status).toBe('processing');
    expect(
      await context.queue.getJob(`video-${upload.video.id}`),
    ).toBeDefined();
    await reconciler.tick();
    expect(await context.queue.count()).toBe(1);
    expect(await context.dataSource.getRepository(UploadSession).count()).toBe(
      1,
    );
  });
  it('should delete a mismatched original and expire the same session without a job', async () => {
    const upload = await seed(true, 2);
    await reconciler.tick();
    const result = await states(upload.video.id);
    expect(result.session.status).toBe('expired');
    expect(result.video).toMatchObject({
      status: 'error',
      failure_reason: 'upload_expired',
    });
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toBeNull();
    expect(await context.queue.count()).toBe(0);
  });
  it.each([false, true])(
    'should expire an incomplete upload, already aborted in S3: %s',
    async (alreadyAborted) => {
      const upload = await seed(false);
      const reference = {
        key: upload.video.original_key,
        uploadId: upload.session.upload_id,
      };
      if (alreadyAborted) await context.storage.abortMultipart(reference);
      await reconciler.tick();
      expect((await states(upload.video.id)).session.status).toBe('expired');
      expect((await states(upload.video.id)).video.failure_reason).toBe(
        'upload_expired',
      );
      expect(await context.storage.listParts(reference)).toBeNull();
      expect(await context.queue.count()).toBe(0);
    },
  );
  it('should preserve active intent on storage inspection failure and retry it later', async () => {
    const upload = await seed();
    jest
      .spyOn(context.storage, 'headObject')
      .mockRejectedValueOnce(
        new StorageUnavailableException(new Error('offline')),
      );
    await reconciler.tick();
    expect((await states(upload.video.id)).session.status).toBe('active');
    expect((await states(upload.video.id)).video.status).toBe('draft');
    expect(await context.queue.count()).toBe(0);
    await reconciler.tick();
    expect((await states(upload.video.id)).session.status).toBe('completed');
  });
  it('should exclude unexpired and terminal sessions from the active expiry scan', async () => {
    const future = await seed(false);
    const terminal = await seed(false);
    await context.dataSource
      .getRepository(UploadSession)
      .update(future.session.id, { expires_at: new Date(Date.now() + 60000) });
    await context.dataSource
      .getRepository(UploadSession)
      .update(terminal.session.id, { status: UploadSessionStatus.ABORTED });
    expect(
      await context.app
        .get(UploadSessionsService)
        .findExpiredActive(new Date()),
    ).toEqual([]);
    await reconciler.tick();
    expect((await states(future.video.id)).session.status).toBe('active');
    expect((await states(terminal.video.id)).session.status).toBe('aborted');
    expect(await context.queue.count()).toBe(0);
  });
  it('should serialize reconciler, API completion and abort into one durable decision and job', async () => {
    const upload = await seed();
    const transitions = jest.spyOn(
      context.app.get(UploadSessionsService),
      'transitionActive',
    );
    const complete = new CompleteVideoUploadService(
      context.app.get(UploadFinalizationService),
      context.app.get(VideoProcessingProducer),
      context.app.get(VideoRecordsService),
    );
    const outcomes = await Promise.allSettled([
      reconciler.tick(),
      complete.complete(upload.video.public_id, upload.userId, upload.parts),
      context.app
        .get(UploadTerminationService)
        .abort(upload.video.public_id, upload.userId),
    ]);
    expect(outcomes[0].status).toBe('fulfilled');
    expect(outcomes[1].status).toBe('fulfilled');
    // If abort wins recovery it returns a conflict intent; publication is repaired by a subsequent tick.
    await reconciler.tick();
    expect(transitions).toHaveBeenCalledTimes(1);
    const result = await states(upload.video.id);
    expect(result.session.status).toBe('completed');
    expect(result.video.status).toBe('processing');
    expect(await context.queue.count()).toBe(1);
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toMatchObject({ size: 1 });
  });
});
