import request from 'supertest';
import { StorageUnavailableException } from '../src/common/exceptions/storage-unavailable.exception';
import { StorageService } from '../src/storage/storage.service';
import { putLifecyclePart } from '../src/test/upload-lifecycle-test-data';
import {
  UploadSession,
  UploadSessionStatus,
} from '../src/videos/entities/upload-session.entity';
import {
  Video,
  VideoFailureReason,
  VideoStatus,
} from '../src/videos/entities/video.entity';
import {
  createVideoE2eContext,
  type HttpErrorBody,
  type HttpResponse,
} from './helpers/video-e2e-context';

describe('videos-upload-abort', () => {
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
  const path = (publicId: string) => `/videos/${publicId}/upload/abort`;
  async function populated() {
    const upload = await context.seedUpload(1);
    const part = await putLifecyclePart(
      context.app.get(StorageService),
      upload,
      1,
      new Uint8Array([1]),
    );
    return { ...upload, parts: [part] };
  }
  async function completedObject() {
    const upload = await populated();
    await context.app.get(StorageService).completeMultipart(
      { key: upload.video.original_key, uploadId: upload.session.upload_id },
      upload.parts.map((part) => ({
        partNumber: part.part_number,
        etag: part.etag,
      })),
    );
    return upload;
  }

  test('abort-active-session-and-retain-draft', async () => {
    const upload = await populated();
    const response = await request(context.app.getHttpServer())
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .expect(204);
    expect(response.text).toBe('');
    expect(
      await context.storageParts(
        upload.video.original_key,
        upload.session.upload_id,
      ),
    ).toBeNull();
    const session = await context.dataSource
      .getRepository(UploadSession)
      .findOneByOrFail({ video_id: upload.video.id });
    expect(session.status).toBe('aborted');
    expect(session.id).toBe(upload.session.id);
    expect(session.expires_at.getTime()).toBe(
      upload.session.expires_at.getTime(),
    );
    const video = await context.dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: upload.video.id });
    expect(video.public_id).toBe(upload.video.public_id);
    expect(video.status).toBe('draft');
    expect(video.failure_reason).toBeNull();
    expect(await context.dataSource.getRepository(UploadSession).count()).toBe(
      1,
    );
  });

  test('repeat-abort-for-aborted-and-expired-sessions', async () => {
    for (const status of [
      UploadSessionStatus.ABORTED,
      UploadSessionStatus.EXPIRED,
    ]) {
      const upload = await populated();
      await context.app.get(StorageService).abortMultipart({
        key: upload.video.original_key,
        uploadId: upload.session.upload_id,
      });
      await context.dataSource
        .getRepository(UploadSession)
        .update(upload.session.id, { status });
      if (status === UploadSessionStatus.EXPIRED)
        await context.dataSource.getRepository(Video).update(upload.video.id, {
          status: VideoStatus.ERROR,
          failure_reason: VideoFailureReason.UPLOAD_EXPIRED,
        });
      const before = await context.dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: upload.video.id });
      for (let index = 0; index < 2; index++) {
        const response = await request(context.app.getHttpServer())
          .post(path(upload.video.public_id))
          .auth(upload.token, { type: 'bearer' })
          .expect(204);
        expect(response.text).toBe('');
      }
      const session = await context.dataSource
        .getRepository(UploadSession)
        .findOneByOrFail({ video_id: upload.video.id });
      expect(session.id).toBe(upload.session.id);
      expect(session.status).toBe(status);
      expect(session.expires_at.getTime()).toBe(
        upload.session.expires_at.getTime(),
      );
      expect(
        await context.dataSource
          .getRepository(Video)
          .findOneByOrFail({ id: upload.video.id }),
      ).toEqual(before);
    }
    expect(await context.queue.count()).toBe(0);
    expect(await context.dataSource.getRepository(UploadSession).count()).toBe(
      2,
    );
  });

  test('reject-abort-after-completion', async () => {
    const upload = await completedObject();
    await context.dataSource
      .getRepository(UploadSession)
      .update(upload.session.id, { status: UploadSessionStatus.COMPLETED });
    await context.dataSource
      .getRepository(Video)
      .update(upload.video.id, { status: VideoStatus.PROCESSING });
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .expect(409);
    expect(response.body).toEqual({
      statusCode: 409,
      error: 'UPLOAD_NOT_ACTIVE',
      message: 'Upload session is not active',
    });
    expect(
      await context.app
        .get(StorageService)
        .headObject(upload.video.original_key),
    ).toMatchObject({ size: 1 });
    expect(
      (
        await context.dataSource
          .getRepository(UploadSession)
          .findOneByOrFail({ id: upload.session.id })
      ).status,
    ).toBe('completed');
    expect(
      (
        await context.dataSource
          .getRepository(Video)
          .findOneByOrFail({ id: upload.video.id })
      ).status,
    ).toBe('processing');
  });

  test('preserve-completed-object-when-abort-observes-no-such-upload', async () => {
    const upload = await completedObject();
    const storage = context.app.get(StorageService);
    const original = storage.headObject.bind(
      storage,
    ) as StorageService['headObject'];
    // Model a completion racing the first object observation, then inspect again.
    jest
      .spyOn(storage, 'headObject')
      .mockResolvedValueOnce(null)
      .mockImplementation(async (key) => await original(key));
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .expect(409);
    expect(response.body).toEqual({
      statusCode: 409,
      error: 'UPLOAD_NOT_ACTIVE',
      message: 'Upload session is not active',
    });
    expect(
      await context.storageParts(
        upload.video.original_key,
        upload.session.upload_id,
      ),
    ).toBeNull();
    expect(await storage.headObject(upload.video.original_key)).toMatchObject({
      size: 1,
    });
    expect(
      (
        await context.dataSource
          .getRepository(UploadSession)
          .findOneByOrFail({ id: upload.session.id })
      ).status,
    ).toBe('completed');
    expect(
      (
        await context.dataSource
          .getRepository(Video)
          .findOneByOrFail({ id: upload.video.id })
      ).status,
    ).toBe('processing');
    expect(await context.queue.count()).toBe(1);
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
      const response: HttpResponse<HttpErrorBody> = await call.expect(401);
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
    expect(
      await context.storageParts(
        upload.video.original_key,
        upload.session.upload_id,
      ),
    ).toEqual([{ partNumber: 1, etag: upload.parts[0].etag, size: 1 }]);
  });

  test('reject-malformed-public-id', async () => {
    const upload = await populated();
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path('bad-id'))
      .auth(upload.token, { type: 'bearer' })
      .expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
    });
    expect(Array.isArray(response.body.message)).toBe(true);
    expect(
      (
        await context.dataSource
          .getRepository(UploadSession)
          .findOneByOrFail({ id: upload.session.id })
      ).status,
    ).toBe('active');
  });

  test('report-storage-abort-unavailability', async () => {
    const upload = await populated();
    jest
      .spyOn(context.app.get(StorageService), 'abortMultipart')
      .mockRejectedValueOnce(
        new StorageUnavailableException(
          new Error('private storage diagnostics'),
        ),
      );
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
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
      await context.storageParts(
        upload.video.original_key,
        upload.session.upload_id,
      ),
    ).toEqual([{ partNumber: 1, etag: upload.parts[0].etag, size: 1 }]);
  });

  test('retain-inherited-throttler-response', async () => {
    const upload = await populated();
    for (let index = 0; index < 10; index++)
      await request(context.app.getHttpServer())
        .post(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .expect(204);
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .expect(429);
    expect(response.body).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
  });
});
