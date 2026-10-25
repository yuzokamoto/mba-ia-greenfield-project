import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { StorageUnavailableException } from '../src/common/exceptions/storage-unavailable.exception';
import { StorageService } from '../src/storage/storage.service';
import { putLifecyclePart } from '../src/test/upload-lifecycle-test-data';
import type { VideoResponseDto } from '../src/videos/dto/video-response.dto';
import {
  UploadSession,
  UploadSessionStatus,
} from '../src/videos/entities/upload-session.entity';
import {
  Video,
  VideoFailureReason,
  VideoStatus,
} from '../src/videos/entities/video.entity';
import { VideoProcessingProducer } from '../src/videos/queue/video-processing-producer.service';
import { VIDEO_QUEUE_REGISTRATION } from '../src/videos/queue/video-queue.constants';
import {
  createVideoE2eContext,
  type HttpErrorBody,
  type HttpResponse,
} from './helpers/video-e2e-context';

describe('videos-upload-complete', () => {
  let context: Awaited<ReturnType<typeof createVideoE2eContext>>;
  beforeAll(async () => {
    context = await createVideoE2eContext();
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
  const path = (publicId: string) => `/videos/${publicId}/upload/complete`;
  async function populated(
    ctx = context,
    declaredSize = 1,
    body = new Uint8Array([1]),
  ) {
    const upload = await ctx.seedUpload(declaredSize);
    const part = await putLifecyclePart(
      ctx.app.get(StorageService),
      upload,
      1,
      body,
    );
    return { ...upload, parts: [part] };
  }

  test('complete-verified-upload-and-commit-processing-intent', async () => {
    const upload = await context.seedUpload(67108865);
    const storage = context.app.get(StorageService);
    const first = await putLifecyclePart(
      storage,
      upload,
      1,
      new Uint8Array(67108864),
    );
    const second = await putLifecyclePart(
      storage,
      upload,
      2,
      new Uint8Array([1]),
    );
    const originalList = storage.listParts.bind(
      storage,
    ) as StorageService['listParts'];
    jest
      .spyOn(storage, 'listParts')
      .mockImplementation(
        async (reference) => await originalList(reference, 1),
      );
    const producer = context.app.get(VideoProcessingProducer);
    const original = producer.enqueue.bind(
      producer,
    ) as VideoProcessingProducer['enqueue'];
    const enqueue = jest
      .spyOn(producer, 'enqueue')
      .mockImplementationOnce(async (id) => {
        expect(
          (
            await context.dataSource
              .getRepository(UploadSession)
              .findOneByOrFail({ video_id: id })
          ).status,
        ).toBe('completed');
        expect(
          (
            await context.dataSource
              .getRepository(Video)
              .findOneByOrFail({ id })
          ).status,
        ).toBe('processing');
        return await original(id);
      });
    const response: HttpResponse<VideoResponseDto> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .send({ parts: [second, first] })
      .expect(202);
    expect(Object.keys(response.body).sort()).toEqual(
      [
        'id',
        'public_id',
        'channel_id',
        'title',
        'status',
        'failure_reason',
        'original_filename',
        'content_type',
        'declared_size',
        'duration',
        'metadata',
        'created_at',
        'updated_at',
      ].sort(),
    );
    expect(response.body).toMatchObject({
      id: upload.video.id,
      public_id: upload.video.public_id,
      channel_id: upload.video.channel_id,
      title: upload.video.title,
      original_filename: upload.video.original_filename,
      content_type: upload.video.content_type,
      declared_size: 67108865,
      status: 'processing',
      failure_reason: null,
      duration: null,
      metadata: null,
    });
    expect(Number.isFinite(Date.parse(response.body.created_at))).toBe(true);
    expect(Number.isFinite(Date.parse(response.body.updated_at))).toBe(true);
    expect(await storage.headObject(upload.video.original_key)).toMatchObject({
      size: 67108865,
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(
      (await context.queue.getJob(`video-${upload.video.id}`))!.data,
    ).toEqual({ videoId: upload.video.id });
  }, 30000);

  test('reject-malformed-manifest-and-path', async () => {
    const upload = await populated();
    for (const body of [
      { parts: [] },
      { parts: [{ part_number: 1 }] },
      { parts: [upload.parts[0], upload.parts[0]] },
      { parts: upload.parts, key: 'foreign-key' },
      { parts: [{ ...upload.parts[0], UploadId: 'foreign-upload' }] },
    ]) {
      const response: HttpResponse<HttpErrorBody> = await request(
        context.app.getHttpServer(),
      )
        .post(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .send(body)
        .expect(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        error: 'VALIDATION_ERROR',
      });
      expect(Array.isArray(response.body.message)).toBe(true);
    }
    const malformed: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path('bad-id'))
      .auth(upload.token, { type: 'bearer' })
      .send({ parts: upload.parts })
      .expect(400);
    expect(malformed.body.error).toBe('VALIDATION_ERROR');
    expect(await context.queue.count()).toBe(0);
    expect(
      (
        await context.dataSource
          .getRepository(UploadSession)
          .findOneByOrFail({ id: upload.session.id })
      ).status,
    ).toBe('active');
  });

  test('reject-inventory-conflicts', async () => {
    const omitted = await context.seedUpload(67108865);
    const omittedPart = await putLifecyclePart(
      context.app.get(StorageService),
      omitted,
      2,
      new Uint8Array([1]),
    );
    const outside = await populated();
    const wrongTag = await populated();
    const wrongSize = await populated(context, 2);
    const attempts = [
      { upload: omitted, parts: [omittedPart] },
      {
        upload: outside,
        parts: [{ part_number: 2, etag: outside.parts[0].etag }],
      },
      { upload: wrongTag, parts: [{ part_number: 1, etag: 'wrong' }] },
      { upload: wrongSize, parts: wrongSize.parts },
    ];
    for (const attempt of attempts) {
      const response: HttpResponse<HttpErrorBody> = await request(
        context.app.getHttpServer(),
      )
        .post(path(attempt.upload.video.public_id))
        .auth(attempt.upload.token, { type: 'bearer' })
        .send({ parts: attempt.parts })
        .expect(409);
      expect(response.body).toEqual({
        statusCode: 409,
        error: 'UPLOAD_PARTS_INVALID',
        message: 'Uploaded parts do not match the expected upload',
      });
      expect(
        await context.app
          .get(StorageService)
          .headObject(attempt.upload.video.original_key),
      ).toBeNull();
      expect(
        (
          await context.dataSource
            .getRepository(UploadSession)
            .findOneByOrFail({ id: attempt.upload.session.id })
        ).status,
      ).toBe('active');
    }
    expect(await context.queue.count()).toBe(0);
  });

  test('reject-final-object-size-mismatch', async () => {
    const upload = await populated();
    const storage = context.app.get(StorageService);
    jest.spyOn(storage, 'headObject').mockResolvedValueOnce({ size: 2 });
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .send({ parts: upload.parts })
      .expect(409);
    expect(response.body).toEqual({
      statusCode: 409,
      error: 'UPLOAD_SIZE_MISMATCH',
      message: 'Uploaded size does not match the declared size',
    });
    expect(await storage.headObject(upload.video.original_key)).toBeNull();
    expect(
      await storage.listParts({
        key: upload.video.original_key,
        uploadId: upload.session.upload_id,
      }),
    ).toBeNull();
    const persisted = await context.dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: upload.video.id });
    expect(persisted.status).toBe('error');
    expect(persisted.failure_reason).toBe('processing_failed');
    expect(await context.queue.count()).toBe(0);
  });

  test('acknowledge-durable-intent-after-established-redis-outage', async () => {
    const isolated = await createVideoE2eContext();
    try {
      const upload = await populated(isolated);
      const queue = isolated.app.get<Queue>(
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
      const response: HttpResponse<VideoResponseDto> = await request(
        isolated.app.getHttpServer(),
      )
        .post(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .send({ parts: upload.parts })
        .expect(202);
      expect(performance.now() - started).toBeLessThan(3000);
      expect(response.body.status).toBe('processing');
      expect(
        (
          await isolated.dataSource
            .getRepository(UploadSession)
            .findOneByOrFail({ id: upload.session.id })
        ).status,
      ).toBe('completed');
      expect(
        (
          await isolated.dataSource
            .getRepository(Video)
            .findOneByOrFail({ id: upload.video.id })
        ).status,
      ).toBe('processing');
      expect(
        await isolated.app
          .get(StorageService)
          .headObject(upload.video.original_key),
      ).toMatchObject({ size: 1 });
      expect(await isolated.queue.count()).toBe(0);
      expect(warn.mock.calls).toContainEqual([
        'Video processing publication deferred',
      ]);
    } finally {
      await isolated.close();
    }
  }, 10000);

  test('repeat-completion-without-regressing-current-state', async () => {
    for (const status of [
      VideoStatus.PROCESSING,
      VideoStatus.READY,
      VideoStatus.ERROR,
    ]) {
      const upload = await populated();
      const storage = context.app.get(StorageService);
      await storage.completeMultipart(
        { key: upload.video.original_key, uploadId: upload.session.upload_id },
        upload.parts.map((part) => ({
          partNumber: part.part_number,
          etag: part.etag,
        })),
      );
      await context.dataSource
        .getRepository(UploadSession)
        .update(upload.session.id, { status: UploadSessionStatus.COMPLETED });
      const fields =
        status === VideoStatus.READY
          ? {
              duration: 1,
              metadata: { codec: 'h264' },
              thumbnail_key: `videos/${upload.video.id}/thumbnail.jpg`,
            }
          : status === VideoStatus.ERROR
            ? { failure_reason: VideoFailureReason.PROCESSING_FAILED }
            : {};
      await context.dataSource
        .getRepository(Video)
        .update(upload.video.id, { status, ...fields });
      const response: HttpResponse<VideoResponseDto> = await request(
        context.app.getHttpServer(),
      )
        .post(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .send({ parts: upload.parts })
        .expect(202);
      expect(response.body).toMatchObject({
        id: upload.video.id,
        public_id: upload.video.public_id,
        status,
      });
      if (status === VideoStatus.READY)
        expect(response.body).toMatchObject({
          duration: 1,
          metadata: { codec: 'h264' },
          failure_reason: null,
        });
      if (status === VideoStatus.ERROR)
        expect(response.body.failure_reason).toBe('processing_failed');
      expect(
        (
          await context.dataSource
            .getRepository(UploadSession)
            .findOneByOrFail({ id: upload.session.id })
        ).status,
      ).toBe('completed');
    }
    expect(await context.queue.count()).toBe(0);
  });

  test('recover-matching-object-at-passed-deadline', async () => {
    const upload = await populated();
    const storage = context.app.get(StorageService);
    await storage.completeMultipart(
      { key: upload.video.original_key, uploadId: upload.session.upload_id },
      upload.parts.map((part) => ({
        partNumber: part.part_number,
        etag: part.etag,
      })),
    );
    await context.dataSource
      .getRepository(UploadSession)
      .update(upload.session.id, { expires_at: new Date(Date.now() - 1) });
    const completeStorage = jest.spyOn(storage, 'completeMultipart');
    const response: HttpResponse<VideoResponseDto> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .send({ parts: upload.parts })
      .expect(202);
    expect(response.body).toMatchObject({
      id: upload.video.id,
      public_id: upload.video.public_id,
      status: 'processing',
    });
    expect(completeStorage).not.toHaveBeenCalled();
    expect(
      (
        await context.dataSource
          .getRepository(UploadSession)
          .findOneByOrFail({ id: upload.session.id })
      ).status,
    ).toBe('completed');
    expect(await context.queue.count()).toBe(1);
  });

  test('reject-aborted-and-expired-session', async () => {
    for (const status of [
      UploadSessionStatus.ABORTED,
      UploadSessionStatus.EXPIRED,
    ]) {
      const upload = await populated();
      await context.dataSource
        .getRepository(UploadSession)
        .update(upload.session.id, { status });
      const response: HttpResponse<HttpErrorBody> = await request(
        context.app.getHttpServer(),
      )
        .post(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .send({ parts: upload.parts })
        .expect(409);
      expect(response.body).toEqual({
        statusCode: 409,
        error: 'UPLOAD_NOT_ACTIVE',
        message: 'Upload session is not active',
      });
    }
    expect(await context.queue.count()).toBe(0);
  });

  test('enforce-token-and-owner-scope', async () => {
    const upload = await populated();
    const expired = await context.jwt.signAsync(
      { sub: upload.user.id, email: upload.user.email },
      { expiresIn: -1 },
    );
    for (const token of [undefined, 'invalid', expired]) {
      const call = request(context.app.getHttpServer()).post(
        path(upload.video.public_id),
      );
      if (token) call.auth(token, { type: 'bearer' });
      const response: HttpResponse<HttpErrorBody> = await call
        .send({ parts: upload.parts })
        .expect(401);
      expect(response.body).toEqual({
        message: 'Unauthorized',
        statusCode: 401,
      });
    }
    const foreign = await context.seedUser();
    for (const publicId of [upload.video.public_id, 'aaaaaaaaaaaa']) {
      const response: HttpResponse<HttpErrorBody> = await request(
        context.app.getHttpServer(),
      )
        .post(path(publicId))
        .auth(foreign.token, { type: 'bearer' })
        .send({ parts: upload.parts })
        .expect(404);
      expect(response.body).toEqual({
        statusCode: 404,
        error: 'VIDEO_NOT_FOUND',
        message: 'Video not found',
      });
    }
    expect(
      (
        await context.dataSource
          .getRepository(UploadSession)
          .findOneByOrFail({ id: upload.session.id })
      ).status,
    ).toBe('active');
    expect(await context.queue.count()).toBe(0);
  });

  test('recover-lost-storage-completion-response', async () => {
    const upload = await populated();
    const storage = context.app.get(StorageService);
    const original = storage.completeMultipart.bind(
      storage,
    ) as StorageService['completeMultipart'];
    jest
      .spyOn(storage, 'completeMultipart')
      .mockImplementationOnce(async (reference, parts) => {
        await original(reference, parts);
        throw new StorageUnavailableException(new Error('lost response'));
      });
    const response: HttpResponse<VideoResponseDto> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .send({ parts: upload.parts })
      .expect(202);
    expect(response.body).toMatchObject({
      id: upload.video.id,
      public_id: upload.video.public_id,
      status: 'processing',
    });
    expect(await storage.headObject(upload.video.original_key)).toMatchObject({
      size: 1,
    });
    expect(
      (
        await context.dataSource
          .getRepository(UploadSession)
          .findOneByOrFail({ video_id: upload.video.id })
      ).id,
    ).toBe(upload.session.id);
    expect(await context.queue.count()).toBe(1);
  });

  test('report-storage-failure-before-durable-acknowledgment', async () => {
    const upload = await populated();
    const storage = context.app.get(StorageService);
    jest
      .spyOn(storage, 'completeMultipart')
      .mockRejectedValueOnce(
        new StorageUnavailableException(new Error('unavailable diagnostic')),
      );
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .send({ parts: upload.parts })
      .expect(503);
    expect(response.body).toEqual({
      statusCode: 503,
      error: 'STORAGE_UNAVAILABLE',
      message: 'Storage is temporarily unavailable',
    });
    expect(
      (
        await context.dataSource
          .getRepository(UploadSession)
          .findOneByOrFail({ id: upload.session.id })
      ).status,
    ).toBe('active');
    expect(
      (
        await context.dataSource
          .getRepository(Video)
          .findOneByOrFail({ id: upload.video.id })
      ).status,
    ).toBe('draft');
    expect(await context.queue.count()).toBe(0);
  });

  test('retain-inherited-throttler-response', async () => {
    const upload = await populated();
    for (let index = 0; index < 10; index++)
      await request(context.app.getHttpServer())
        .post(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .send({ parts: upload.parts })
        .expect(202);
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .send({ parts: upload.parts })
      .expect(429);
    expect(response.body).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
  });
});
