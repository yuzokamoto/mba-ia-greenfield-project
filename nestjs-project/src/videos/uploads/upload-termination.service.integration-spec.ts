import { StorageUnavailableException } from '../../common/exceptions/storage-unavailable.exception';
import { createVideoTestContext } from '../../test/create-video-test-context';
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
import { AbortVideoUploadService } from './abort-video-upload.service';
import { CompleteVideoUploadService } from './complete-video-upload.service';
import { UploadSessionsService } from './upload-sessions.service';
import { UploadTerminationService } from './upload-termination.service';

describe('UploadTerminationService (integration)', () => {
  let context: Awaited<ReturnType<typeof createVideoTestContext>>;
  let termination: UploadTerminationService;
  let abort: AbortVideoUploadService;
  beforeAll(async () => {
    context = await createVideoTestContext();
    termination = context.module.get(UploadTerminationService);
    abort = context.module.get(AbortVideoUploadService);
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
  async function populated(declaredSize = 1) {
    const upload = await seedLifecycleUpload(context, declaredSize);
    const part = await putLifecyclePart(
      context.storage,
      upload,
      1,
      new Uint8Array([1]),
    );
    return { ...upload, parts: [part] };
  }
  async function completedObject(declaredSize = 1) {
    const upload = await populated(declaredSize);
    await context.storage.completeMultipart(
      { key: upload.video.original_key, uploadId: upload.session.upload_id },
      upload.parts.map((part) => ({
        partNumber: part.part_number,
        etag: part.etag,
      })),
    );
    return upload;
  }
  async function expire(id: string) {
    await context.dataSource
      .getRepository(UploadSession)
      .update(id, { expires_at: new Date(Date.now() - 1) });
  }
  async function states(id: string) {
    return {
      video: await context.dataSource
        .getRepository(Video)
        .findOneByOrFail({ id }),
      session: await context.dataSource
        .getRepository(UploadSession)
        .findOneByOrFail({ video_id: id }),
    };
  }

  it('should retain the draft identity and failure reason after idempotent voluntary abort', async () => {
    const upload = await populated();
    await abort.abort(upload.video.public_id, upload.userId);
    await abort.abort(upload.video.public_id, upload.userId);
    const result = await states(upload.video.id);
    expect(result.session.status).toBe('aborted');
    expect(result.video.status).toBe('draft');
    expect(result.video.failure_reason).toBeNull();
    expect(result.video.public_id).toBe(upload.video.public_id);
    expect(
      await context.storage.listParts({
        key: upload.video.original_key,
        uploadId: upload.session.upload_id,
      }),
    ).toBeNull();
    expect(await context.queue.count()).toBe(0);
  });
  it('should recover matching completed objects at expiry without any repeated client completion', async () => {
    const upload = await completedObject();
    await expire(upload.session.id);
    expect((await termination.resolveExpired(upload.video.id))!.publish).toBe(
      true,
    );
    expect(await termination.resolveExpired(upload.video.id)).toBeNull();
    const result = await states(upload.video.id);
    expect(result.session.status).toBe('completed');
    expect(result.video.status).toBe('processing');
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toMatchObject({ size: 1 });
  });
  it('should delete wrong-length completed objects before committing expired/error', async () => {
    const upload = await completedObject(2);
    await expire(upload.session.id);
    expect((await termination.resolveExpired(upload.video.id))!.publish).toBe(
      false,
    );
    const result = await states(upload.video.id);
    expect(result.session.status).toBe('expired');
    expect(result.video.status).toBe('error');
    expect(result.video.failure_reason).toBe('upload_expired');
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toBeNull();
    expect(await context.queue.count()).toBe(0);
  });
  it('should abort unfinished storage at expiry and tolerate an already absent upload', async () => {
    for (const alreadyAbsent of [false, true]) {
      const upload = await populated();
      if (alreadyAbsent)
        await context.storage.abortMultipart({
          key: upload.video.original_key,
          uploadId: upload.session.upload_id,
        });
      await expire(upload.session.id);
      await termination.resolveExpired(upload.video.id);
      const result = await states(upload.video.id);
      expect(result.session.status).toBe('expired');
      expect(result.video.failure_reason).toBe('upload_expired');
      expect(
        await context.storage.listParts({
          key: upload.video.original_key,
          uploadId: upload.session.upload_id,
        }),
      ).toBeNull();
    }
  });
  it('should leave cleanup failures undecided and retry the same original session', async () => {
    const upload = await completedObject(2);
    await expire(upload.session.id);
    jest
      .spyOn(context.storage, 'deleteObject')
      .mockRejectedValueOnce(
        new StorageUnavailableException(new Error('offline')),
      );
    await expect(
      termination.resolveExpired(upload.video.id),
    ).rejects.toMatchObject({ errorCode: 'STORAGE_UNAVAILABLE' });
    expect((await states(upload.video.id)).session.status).toBe('active');
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toMatchObject({ size: 1 });
    await termination.resolveExpired(upload.video.id);
    expect((await states(upload.video.id)).session.status).toBe('expired');
  });
  it('should protect and publish a known completed object when abort discovers completion', async () => {
    const upload = await completedObject();
    await expect(
      abort.abort(upload.video.public_id, upload.userId),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
    expect((await states(upload.video.id)).session.status).toBe('completed');
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toMatchObject({ size: 1 });
    expect(await context.queue.count()).toBe(1);
  });
  it('should serialize competing completion, abort and expiry into exactly one terminal decision', async () => {
    const upload = await completedObject();
    await expire(upload.session.id);
    const transition = jest.spyOn(
      context.module.get(UploadSessionsService),
      'transitionActive',
    );
    const outcomes = await Promise.allSettled([
      context.module
        .get(CompleteVideoUploadService)
        .complete(upload.video.public_id, upload.userId, upload.parts),
      abort.abort(upload.video.public_id, upload.userId),
      termination.resolveExpired(upload.video.id),
    ]);
    expect(outcomes[0].status).toBe('fulfilled');
    expect(outcomes[1].status).toBe('rejected');
    expect(outcomes[2].status).toBe('fulfilled');
    const expiry = outcomes[2];
    if (
      expiry.status === 'fulfilled' &&
      typeof expiry.value === 'object' &&
      expiry.value !== null &&
      'publish' in expiry.value &&
      expiry.value.publish
    )
      await context.module
        .get(VideoProcessingProducer)
        .enqueue(upload.video.id);
    const result = await states(upload.video.id);
    expect(result.session.status).toBe('completed');
    expect(result.video.status).toBe('processing');
    expect(transition).toHaveBeenCalledTimes(1);
    expect(await context.queue.count()).toBe(1);
    expect(
      await context.storage.headObject(upload.video.original_key),
    ).toMatchObject({ size: 1 });
  });
  it('should let only one of unexpired abort and completion win without a mixed durable state', async () => {
    const upload = await populated();
    const outcomes = await Promise.allSettled([
      abort.abort(upload.video.public_id, upload.userId),
      context.module
        .get(CompleteVideoUploadService)
        .complete(upload.video.public_id, upload.userId, upload.parts),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    const result = await states(upload.video.id);
    if (result.session.status === UploadSessionStatus.ABORTED) {
      expect(result.video.status).toBe('draft');
      expect(await context.queue.count()).toBe(0);
      expect(
        await context.storage.headObject(upload.video.original_key),
      ).toBeNull();
    } else {
      expect(result.session.status).toBe('completed');
      expect(result.video.status).toBe('processing');
      expect(await context.queue.count()).toBe(1);
    }
  });
});
