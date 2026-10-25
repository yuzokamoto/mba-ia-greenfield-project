import request from 'supertest';
import { StorageUnavailableException } from '../src/common/exceptions/storage-unavailable.exception';
import { StorageService } from '../src/storage/storage.service';
import type { SignUploadPartsResponseDto } from '../src/videos/dto/sign-upload-parts-response.dto';
import {
  UploadSession,
  UploadSessionStatus,
} from '../src/videos/entities/upload-session.entity';
import {
  createVideoE2eContext,
  type HttpErrorBody,
  type HttpResponse,
} from './helpers/video-e2e-context';

describe('videos-upload-parts-sign', () => {
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
  const path = (publicId: string) => `/videos/${publicId}/upload/parts`;

  test('sign-only-requested-parts-with-bounded-expiry', async () => {
    const upload = await context.seedUpload(2 * 67108864 + 1);
    const before = Date.now();
    const result: HttpResponse<SignUploadPartsResponseDto> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .send({ part_numbers: [3, 1] })
      .expect(200);
    expect(Object.keys(result.body)).toEqual(['parts']);
    expect(result.body.parts.map((part) => part.part_number).sort()).toEqual([
      1, 3,
    ]);
    for (const part of result.body.parts) {
      expect(Object.keys(part).sort()).toEqual(
        ['part_number', 'url', 'expires_at'].sort(),
      );
      const url = new URL(part.url);
      expect(url.origin).toBe(process.env.S3_PUBLIC_ENDPOINT);
      expect(url.searchParams.get('partNumber')).toBe(String(part.part_number));
      expect(url.searchParams.get('uploadId')).toBe(upload.session.upload_id);
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(Date.parse(part.expires_at)).toBeGreaterThan(before);
      expect(Date.parse(part.expires_at)).toBeLessThanOrEqual(
        Date.now() + 900000,
      );
      expect(Date.parse(part.expires_at)).toBeLessThanOrEqual(
        upload.session.expires_at.getTime(),
      );
    }
    const final = result.body.parts.find((part) => part.part_number === 3)!;
    const put = await fetch(final.url, {
      method: 'PUT',
      body: new Uint8Array([1]),
      signal: AbortSignal.timeout(30000),
    });
    await put.arrayBuffer();
    expect(put.status).toBe(200);
    const etag = put.headers.get('etag');
    expect(etag).toBeTruthy();
    expect(
      await context.storageParts(
        upload.video.original_key,
        upload.session.upload_id,
      ),
    ).toEqual([{ partNumber: 3, etag, size: 1 }]);
  });

  test('renew-missing-part-without-replacing-session', async () => {
    const upload = await context.seedUpload();
    const deadline = new Date(Date.now() + 60000);
    await context.dataSource
      .getRepository(UploadSession)
      .update(upload.session.id, { expires_at: deadline });
    for (let index = 0; index < 2; index++) {
      const result: HttpResponse<SignUploadPartsResponseDto> = await request(
        context.app.getHttpServer(),
      )
        .post(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .send({ part_numbers: [2] })
        .expect(200);
      expect(result.body.parts).toHaveLength(1);
      expect(result.body.parts[0].part_number).toBe(2);
      expect(Date.parse(result.body.parts[0].expires_at)).toBeLessThanOrEqual(
        deadline.getTime(),
      );
      expect(
        new URL(result.body.parts[0].url).searchParams.get('uploadId'),
      ).toBe(upload.session.upload_id);
    }
    const session = await context.dataSource
      .getRepository(UploadSession)
      .findOneByOrFail({ video_id: upload.video.id });
    expect(session.id).toBe(upload.session.id);
    expect(session.upload_id).toBe(upload.session.upload_id);
    expect(session.expires_at.getTime()).toBe(deadline.getTime());
    expect(await context.counts()).toEqual({
      videos: 1,
      sessions: 1,
      uploads: 1,
    });
  });

  test('reject-malformed-part-requests-and-public-id', async () => {
    const upload = await context.seedUpload();
    for (const body of [
      { part_numbers: [1, 1] },
      { part_numbers: '1' },
      { part_numbers: [] },
      { part_numbers: [1.5] },
      { part_numbers: [0] },
      { part_numbers: [161] },
      { part_numbers: [1], key: 'foreign' },
      { part_numbers: [1], channel_id: 'foreign' },
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
      expect(response.body).not.toHaveProperty('parts');
    }
    const malformed: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path('bad-id'))
      .auth(upload.token, { type: 'bearer' })
      .send({ part_numbers: [1] })
      .expect(400);
    expect(malformed.body.error).toBe('VALIDATION_ERROR');
  });

  test('reject-parts-outside-server-derived-inventory', async () => {
    const upload = await context.seedUpload();
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .send({ part_numbers: [3] })
      .expect(409);
    expect(response.body).toEqual({
      statusCode: 409,
      error: 'UPLOAD_PARTS_INVALID',
      message: 'Uploaded parts do not match the expected upload',
    });
  });

  test('enforce-token-and-owner-scope', async () => {
    const upload = await context.seedUpload();
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
        .send({ part_numbers: [1] })
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
        .send({ part_numbers: [1] })
        .expect(404);
      expect(response.body).toEqual({
        statusCode: 404,
        error: 'VIDEO_NOT_FOUND',
        message: 'Video not found',
      });
    }
  });

  test('reject-closed-or-deadline-passed-session', async () => {
    const upload = await context.seedUpload();
    for (const status of [
      UploadSessionStatus.COMPLETED,
      UploadSessionStatus.ABORTED,
      UploadSessionStatus.EXPIRED,
      UploadSessionStatus.ACTIVE,
    ]) {
      await context.dataSource
        .getRepository(UploadSession)
        .update(upload.session.id, {
          status,
          expires_at:
            status === UploadSessionStatus.ACTIVE
              ? new Date(Date.now() - 1)
              : upload.session.expires_at,
        });
      const response: HttpResponse<HttpErrorBody> = await request(
        context.app.getHttpServer(),
      )
        .post(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .send({ part_numbers: [1] })
        .expect(409);
      expect(response.body).toEqual({
        statusCode: 409,
        error: 'UPLOAD_NOT_ACTIVE',
        message: 'Upload session is not active',
      });
    }
    expect(await context.counts()).toEqual({
      videos: 1,
      sessions: 1,
      uploads: 1,
    });
  });

  test('report-signing-storage-failure', async () => {
    const upload = await context.seedUpload();
    jest
      .spyOn(context.app.get(StorageService), 'signPart')
      .mockRejectedValueOnce(
        new StorageUnavailableException(
          new Error('private signing diagnostic'),
        ),
      );
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .send({ part_numbers: [1] })
      .expect(503);
    expect(response.body).toEqual({
      statusCode: 503,
      error: 'STORAGE_UNAVAILABLE',
      message: 'Storage is temporarily unavailable',
    });
  });

  test('retain-inherited-throttler-response', async () => {
    const upload = await context.seedUpload();
    for (let index = 0; index < 10; index++)
      await request(context.app.getHttpServer())
        .post(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .send({ part_numbers: [1] })
        .expect(200);
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .post(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .send({ part_numbers: [1] })
      .expect(429);
    expect(response.body).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
  });
});
