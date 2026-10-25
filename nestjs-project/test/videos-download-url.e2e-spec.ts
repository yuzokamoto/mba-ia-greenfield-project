import request from 'supertest';
import { setTimeout as delay } from 'node:timers/promises';
import { StorageUnavailableException } from '../src/common/exceptions/storage-unavailable.exception';
import { StorageService } from '../src/storage/storage.service';
import { createVideoTestMedia } from '../src/test/video-test-media';
import type { SignedUrlResponseDto } from '../src/videos/dto/signed-url-response.dto';
import {
  Video,
  VideoFailureReason,
  VideoStatus,
} from '../src/videos/entities/video.entity';
import {
  expectSignedUrlResponse,
  seedReadyVideo,
} from './helpers/video-access-e2e';
import {
  createVideoE2eContext,
  type HttpErrorBody,
  type HttpResponse,
} from './helpers/video-e2e-context';

describe('videos-download-url', () => {
  let context: Awaited<ReturnType<typeof createVideoE2eContext>>;
  let media: Awaited<ReturnType<typeof createVideoTestMedia>>;
  beforeAll(async () => {
    context = await createVideoE2eContext({
      playbackUrlTtlSeconds: 11,
      downloadUrlTtlSeconds: 5,
    });
    media = await createVideoTestMedia();
  });
  beforeEach(async () => {
    await context.clean();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await context.close();
    await media.cleanup();
  });
  const path = (publicId: string) => `/videos/${publicId}/download-url`;
  async function issue(
    publicId: string,
    token: string,
  ): Promise<HttpResponse<SignedUrlResponseDto>> {
    return await request(context.app.getHttpServer())
      .get(path(publicId))
      .auth(token, { type: 'bearer' })
      .expect(200);
  }
  test('download-original-through-signed-attachment-url', async () => {
    const upload = await seedReadyVideo(context, media, 'example.mp4');
    const response = await issue(upload.video.public_id, upload.token);
    expectSignedUrlResponse(response, 5);
    const stored = await fetch(response.body.url, {
      signal: AbortSignal.timeout(30000),
    });
    expect(stored.status).toBe(200);
    const disposition = stored.headers.get('content-disposition')!;
    expect(disposition).toMatch(/^attachment;/);
    expect(decodeURIComponent(disposition.split("UTF-8''")[1])).toBe(
      'example.mp4',
    );
    expect(Buffer.from(await stored.arrayBuffer())).toEqual(upload.bytes);
  });
  test('sanitize-filename-without-changing-object-or-injecting-headers', async () => {
    for (const [input, expected] of [
      ['../../directory/source.mp4', 'source.mp4'],
      ['C:\\folder\\vidéo\t\u0085.mp4', 'vidéo.mp4'],
      [
        'quote "video"\r\nX-Injected: yes.mp4',
        'quote "video"X-Injected: yes.mp4',
      ],
    ]) {
      const upload = await seedReadyVideo(context, media, input);
      const before = await context.dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: upload.video.id });
      const signed = await issue(upload.video.public_id, upload.token);
      expectSignedUrlResponse(signed, 5);
      const url = new URL(signed.body.url);
      expect(decodeURIComponent(url.pathname)).toBe(
        `/${process.env.S3_BUCKET}/${upload.video.original_key}`,
      );
      const stored = await fetch(signed.body.url, {
        signal: AbortSignal.timeout(30000),
      });
      expect(stored.status).toBe(200);
      expect(stored.headers.get('x-injected')).toBeNull();
      const disposition = stored.headers.get('content-disposition')!;
      expect(disposition).toMatch(
        /^attachment; filename="video"; filename\*=UTF-8''/,
      );
      expect(decodeURIComponent(disposition.split("UTF-8''")[1])).toBe(
        expected,
      );
      expect(disposition).not.toMatch(/[\\/\r\n]/);
      expect(Buffer.from(await stored.arrayBuffer())).toEqual(upload.bytes);
      expect(
        await context.dataSource
          .getRepository(Video)
          .findOneByOrFail({ id: upload.video.id }),
      ).toEqual(before);
    }
  });
  test('reject-every-non-ready-state', async () => {
    const videos = context.dataSource.getRepository(Video);
    for (const status of [
      VideoStatus.DRAFT,
      VideoStatus.PROCESSING,
      VideoStatus.ERROR,
    ]) {
      const upload = await context.seedUpload(1);
      await videos.update(upload.video.id, {
        status,
        ...(status === VideoStatus.ERROR
          ? { failure_reason: VideoFailureReason.INVALID_MEDIA }
          : {}),
      });
      const response: HttpResponse<HttpErrorBody> = await request(
        context.app.getHttpServer(),
      )
        .get(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .expect(409);
      expect(response.body).toEqual({
        statusCode: 409,
        error: 'VIDEO_NOT_READY',
        message: 'Video is not ready',
      });
    }
  });
  test('enforce-token-and-owner-scope', async () => {
    const upload = await seedReadyVideo(context, media);
    const expired = await context.jwt.signAsync(
      { sub: upload.user.id },
      { expiresIn: -1 },
    );
    for (const token of [undefined, 'invalid', expired]) {
      const call = request(context.app.getHttpServer()).get(
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
    for (const publicId of [upload.video.public_id, 'missing_1234']) {
      const response: HttpResponse<HttpErrorBody> = await request(
        context.app.getHttpServer(),
      )
        .get(path(publicId))
        .auth(foreign.token, { type: 'bearer' })
        .expect(404);
      expect(response.body).toEqual({
        statusCode: 404,
        error: 'VIDEO_NOT_FOUND',
        message: 'Video not found',
      });
    }
  });
  test('reject-malformed-public-id', async () => {
    const owner = await context.seedUser();
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .get(path('short'))
      .auth(owner.token, { type: 'bearer' })
      .expect(400);
    expect(Object.keys(response.body).sort()).toEqual([
      'error',
      'message',
      'statusCode',
    ]);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
    });
    expect(Array.isArray(response.body.message)).toBe(true);
  });
  test('report-storage-signing-unavailability', async () => {
    const upload = await seedReadyVideo(context, media);
    jest
      .spyOn(context.app.get(StorageService), 'signPublicGet')
      .mockRejectedValueOnce(
        new StorageUnavailableException(
          new Error('private signing diagnostic'),
        ),
      );
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .get(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .expect(503);
    expect(response.body).toEqual({
      statusCode: 503,
      error: 'STORAGE_UNAVAILABLE',
      message: 'Storage is temporarily unavailable',
    });
  });
  test('enforce-download-bearer-expiry-and-owner-renewal', async () => {
    const upload = await seedReadyVideo(context, media);
    const before = await context.dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: upload.video.id });
    const token = await context.jwt.signAsync(
      { sub: upload.user.id, email: upload.user.email },
      { expiresIn: 2 },
    );
    const signed = await issue(upload.video.public_id, token);
    expectSignedUrlResponse(signed, 5);
    const stored = await fetch(signed.body.url, {
      signal: AbortSignal.timeout(30000),
    });
    expect(stored.status).toBe(200);
    expect(stored.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(Buffer.from(await stored.arrayBuffer())).toEqual(upload.bytes);
    const payload = context.jwt.decode<{ exp: number }>(token);
    await delay(Math.max(0, payload.exp * 1000 - Date.now() + 200));
    const stillValid = await fetch(signed.body.url, {
      signal: AbortSignal.timeout(30000),
    });
    await stillValid.arrayBuffer();
    expect(stillValid.status).toBe(200);
    const rejected: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .get(path(upload.video.public_id))
      .auth(token, { type: 'bearer' })
      .expect(401);
    expect(rejected.body).toEqual({ message: 'Unauthorized', statusCode: 401 });
    await delay(
      Math.max(0, Date.parse(signed.body.expires_at) - Date.now() + 1100),
    );
    const expired = await fetch(signed.body.url, {
      signal: AbortSignal.timeout(30000),
    });
    await expired.arrayBuffer();
    expect(expired.status).toBe(403);
    const renewed = await issue(upload.video.public_id, upload.token);
    expectSignedUrlResponse(renewed, 5);
    const restored = await fetch(renewed.body.url, {
      signal: AbortSignal.timeout(30000),
    });
    expect(Buffer.from(await restored.arrayBuffer())).toEqual(upload.bytes);
    expect(restored.status).toBe(200);
    expect(
      await context.dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: upload.video.id }),
    ).toEqual(before);
    await request(context.app.getHttpServer())
      .get(path(upload.video.public_id))
      .expect(401);
    const foreign = await context.seedUser();
    await request(context.app.getHttpServer())
      .get(path(upload.video.public_id))
      .auth(foreign.token, { type: 'bearer' })
      .expect(404);
  }, 15000);
  test('retain-inherited-throttler-response', async () => {
    const upload = await seedReadyVideo(context, media);
    for (let index = 0; index < 10; index++)
      await issue(upload.video.public_id, upload.token);
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .get(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .expect(429);
    expect(response.body).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
  });
});
