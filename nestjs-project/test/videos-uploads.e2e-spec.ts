import request from 'supertest';
import { StorageUnavailableException } from '../src/common/exceptions/storage-unavailable.exception';
import { StorageService } from '../src/storage/storage.service';
import type { StartVideoUploadResponseDto } from '../src/videos/dto/start-video-upload-response.dto';
import { UploadSession } from '../src/videos/entities/upload-session.entity';
import { Video } from '../src/videos/entities/video.entity';
import { PublicIdGenerator } from '../src/videos/public-id';
import {
  createVideoE2eContext,
  startUploadBody,
  type HttpResponse,
  type HttpErrorBody,
} from './helpers/video-e2e-context';

describe('videos-uploads', () => {
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

  test('create-draft-and-active-session', async () => {
    const owner = await context.seedUser();
    const before = Date.now();
    const response: HttpResponse<StartVideoUploadResponseDto> = await request(
      context.app.getHttpServer(),
    )
      .post('/videos/uploads')
      .auth(owner.token, { type: 'bearer' })
      .send(startUploadBody)
      .expect(201);
    const { video, upload_session: session } = response.body;
    expect(Object.keys(response.body).sort()).toEqual([
      'upload_session',
      'video',
    ]);
    expect(Object.keys(video).sort()).toEqual(
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
    for (const id of [video.id, video.channel_id, session.id])
      expect(id).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    expect(video.public_id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(video).toMatchObject({
      ...startUploadBody,
      channel_id: owner.channel!.id,
      status: 'draft',
      failure_reason: null,
      duration: null,
      metadata: null,
    });
    expect(Number.isFinite(Date.parse(video.created_at))).toBe(true);
    expect(Number.isFinite(Date.parse(video.updated_at))).toBe(true);
    expect(Object.keys(session).sort()).toEqual(
      ['id', 'status', 'part_size', 'total_parts', 'expires_at'].sort(),
    );
    expect(session).toMatchObject({
      status: 'active',
      part_size: 67108864,
      total_parts: 2,
    });
    expect(Date.parse(session.expires_at)).toBeGreaterThanOrEqual(
      before + 86400000,
    );
    expect(Date.parse(session.expires_at)).toBeLessThanOrEqual(
      Date.now() + 86400000,
    );
    const persisted = await context.dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    const persistedSession = await context.dataSource
      .getRepository(UploadSession)
      .findOneByOrFail({ video_id: video.id });
    expect(persisted.channel_id).toBe(owner.channel!.id);
    expect(persistedSession.id).toBe(session.id);
    expect(
      await context.storageParts(
        persisted.original_key,
        persistedSession.upload_id,
      ),
    ).toEqual([]);
    expect(await context.counts()).toEqual({
      videos: 1,
      sessions: 1,
      uploads: 1,
    });
    const second: HttpResponse<StartVideoUploadResponseDto> = await request(
      context.app.getHttpServer(),
    )
      .post('/videos/uploads')
      .auth(owner.token, { type: 'bearer' })
      .send(startUploadBody)
      .expect(201);
    expect(second.body.video.id).not.toBe(video.id);
    expect(second.body.video.public_id).not.toBe(video.public_id);
    expect(second.body.upload_session.id).not.toBe(session.id);
    expect(
      (
        await context.dataSource
          .getRepository(Video)
          .findOneByOrFail({ id: video.id })
      ).public_id,
    ).toBe(video.public_id);
    expect(
      (
        await context.dataSource
          .getRepository(UploadSession)
          .findOneByOrFail({ video_id: video.id })
      ).id,
    ).toBe(session.id);
    expect(await context.counts()).toEqual({
      videos: 2,
      sessions: 2,
      uploads: 2,
    });
  });

  test('reject-missing-invalid-and-expired-token', async () => {
    const owner = await context.seedUser();
    const expired = await context.jwt.signAsync(
      { sub: owner.user.id, email: owner.user.email },
      { expiresIn: -1 },
    );
    for (const token of [undefined, 'invalid-token', expired]) {
      const call = request(context.app.getHttpServer()).post('/videos/uploads');
      if (token) call.auth(token, { type: 'bearer' });
      const response: HttpResponse<HttpErrorBody> = await call
        .send(startUploadBody)
        .expect(401);
      expect(response.body).toEqual({
        message: 'Unauthorized',
        statusCode: 401,
      });
    }
    expect(await context.counts()).toEqual({
      videos: 0,
      sessions: 0,
      uploads: 0,
    });
  });

  test('reject-invalid-metadata-and-client-owned-references', async () => {
    const owner = await context.seedUser();
    const foreign = await context.seedUser();
    const missingTitle: Partial<typeof startUploadBody> = {
      ...startUploadBody,
    };
    delete missingTitle.title;
    const invalidBodies = [
      missingTitle,
      ...Object.entries({
        channel_id: foreign.channel!.id,
        user_id: foreign.user.id,
        public_id: 'abcdefghijkl',
        bucket: 'foreign',
        key: 'foreign-key',
        UploadId: 'foreign-upload',
      }).map(([key, value]) => ({ ...startUploadBody, [key]: value })),
    ];
    for (const body of invalidBodies) {
      const response: HttpResponse<HttpErrorBody> = await request(
        context.app.getHttpServer(),
      )
        .post('/videos/uploads')
        .auth(owner.token, { type: 'bearer' })
        .send(body)
        .expect(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        error: 'VALIDATION_ERROR',
      });
      expect(Array.isArray(response.body.message)).toBe(true);
    }
    const multipart: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post('/videos/uploads')
      .auth(owner.token, { type: 'bearer' })
      .attach('video', Buffer.from('source-bytes'), 'video.mp4')
      .expect(400);
    expect(multipart.body.error).toBe('VALIDATION_ERROR');
    expect(Array.isArray(multipart.body.message)).toBe(true);
    expect(await context.counts()).toEqual({
      videos: 0,
      sessions: 0,
      uploads: 0,
    });
  });

  test('enforce-exact-declared-byte-limit', async () => {
    const owner = await context.seedUser();
    const maximum: HttpResponse<StartVideoUploadResponseDto> = await request(
      context.app.getHttpServer(),
    )
      .post('/videos/uploads')
      .auth(owner.token, { type: 'bearer' })
      .send({ ...startUploadBody, declared_size: 10737418240 })
      .expect(201);
    expect(maximum.body.upload_session).toMatchObject({
      part_size: 67108864,
      total_parts: 160,
    });
    const rejected: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post('/videos/uploads')
      .auth(owner.token, { type: 'bearer' })
      .send({ ...startUploadBody, declared_size: 10737418241 })
      .expect(400);
    expect(rejected.body.error).toBe('VALIDATION_ERROR');
    expect(await context.counts()).toEqual({
      videos: 1,
      sessions: 1,
      uploads: 1,
    });
  });

  test('reject-initiator-without-own-channel', async () => {
    const owner = await context.seedUser(false);
    await context.seedUser();
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post('/videos/uploads')
      .auth(owner.token, { type: 'bearer' })
      .send(startUploadBody)
      .expect(404);
    expect(response.body).toEqual({
      statusCode: 404,
      error: 'CHANNEL_NOT_FOUND',
      message: 'Channel not found',
    });
    expect(await context.counts()).toEqual({
      videos: 0,
      sessions: 0,
      uploads: 0,
    });
  });

  test('report-storage-initiation-unavailability', async () => {
    const owner = await context.seedUser();
    jest
      .spyOn(context.app.get(StorageService), 'createMultipart')
      .mockRejectedValueOnce(
        new StorageUnavailableException(
          new Error('private credentials and diagnostic'),
        ),
      );
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post('/videos/uploads')
      .auth(owner.token, { type: 'bearer' })
      .send(startUploadBody)
      .expect(503);
    expect(response.body).toEqual({
      statusCode: 503,
      error: 'STORAGE_UNAVAILABLE',
      message: 'Storage is temporarily unavailable',
    });
    expect(await context.counts()).toEqual({
      videos: 0,
      sessions: 0,
      uploads: 0,
    });
  });

  test('report-public-id-allocation-exhaustion', async () => {
    const owner = await context.seedUser();
    const first: HttpResponse<StartVideoUploadResponseDto> = await request(
      context.app.getHttpServer(),
    )
      .post('/videos/uploads')
      .auth(owner.token, { type: 'bearer' })
      .send(startUploadBody)
      .expect(201);
    const generate = jest
      .spyOn(context.app.get(PublicIdGenerator), 'generate')
      .mockReturnValue(first.body.video.public_id);
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post('/videos/uploads')
      .auth(owner.token, { type: 'bearer' })
      .send(startUploadBody)
      .expect(500);
    expect(response.body).toEqual({
      statusCode: 500,
      error: 'VIDEO_ID_ALLOCATION_FAILED',
      message: 'Video identifier could not be allocated',
    });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(await context.counts()).toEqual({
      videos: 1,
      sessions: 1,
      uploads: 1,
    });
    expect(
      (
        await context.dataSource
          .getRepository(Video)
          .findOneByOrFail({ id: first.body.video.id })
      ).public_id,
    ).toBe(first.body.video.public_id);
  });

  test('retain-inherited-throttler-response', async () => {
    const owner = await context.seedUser();
    for (let index = 0; index < 10; index++)
      await request(context.app.getHttpServer())
        .post('/videos/uploads')
        .auth(owner.token, { type: 'bearer' })
        .send(startUploadBody)
        .expect(201);
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post('/videos/uploads')
      .auth(owner.token, { type: 'bearer' })
      .send(startUploadBody)
      .expect(429);
    expect(response.body).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
    expect(await context.counts()).toEqual({
      videos: 10,
      sessions: 10,
      uploads: 10,
    });
  });
});
