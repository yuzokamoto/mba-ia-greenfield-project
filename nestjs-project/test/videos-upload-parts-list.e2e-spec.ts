import request from 'supertest';
import { StorageUnavailableException } from '../src/common/exceptions/storage-unavailable.exception';
import { StorageService } from '../src/storage/storage.service';
import type { ListUploadedPartsResponseDto } from '../src/videos/dto/list-uploaded-parts-response.dto';
import {
  UploadSession,
  UploadSessionStatus,
} from '../src/videos/entities/upload-session.entity';
import {
  createVideoE2eContext,
  type HttpErrorBody,
  type HttpResponse,
} from './helpers/video-e2e-context';

describe('videos-upload-parts-list', () => {
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
  type Upload = Awaited<ReturnType<typeof context.seedUpload>>;
  async function put(
    upload: Upload,
    partNumber: number,
    body: Uint8Array<ArrayBuffer>,
  ) {
    const signed = await context.app
      .get(StorageService)
      .signPart(
        { key: upload.video.original_key, uploadId: upload.session.upload_id },
        partNumber,
      );
    const result = await fetch(signed.url, {
      method: 'PUT',
      body,
      headers: signed.headers,
      signal: AbortSignal.timeout(30000),
    });
    await result.arrayBuffer();
    expect(result.status).toBe(200);
    const etag = result.headers.get('etag');
    if (!etag) throw new Error('Storage omitted PUT ETag');
    return { part_number: partNumber, etag, size: body.byteLength };
  }

  test('resume-from-real-storage-etags-and-sizes', async () => {
    const upload = await context.seedUpload(2 * 67108864 + 1);
    const uploaded = await put(upload, 3, new Uint8Array([1]));
    const result: HttpResponse<ListUploadedPartsResponseDto> = await request(
      context.app.getHttpServer(),
    )
      .get(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .expect(200);
    expect(Object.keys(result.body).sort()).toEqual(
      ['upload_session', 'parts'].sort(),
    );
    expect(Object.keys(result.body.upload_session).sort()).toEqual(
      ['id', 'status', 'part_size', 'total_parts', 'expires_at'].sort(),
    );
    expect(result.body.upload_session).toEqual({
      id: upload.session.id,
      status: 'active',
      part_size: 67108864,
      total_parts: 3,
      expires_at: upload.session.expires_at.toISOString(),
    });
    expect(result.body.parts).toEqual([uploaded]);
    const uploadedNumbers = new Set(
      result.body.parts.map((part) => part.part_number),
    );
    expect(
      Array.from(
        { length: result.body.upload_session.total_parts },
        (_, index) => index + 1,
      ).filter((number) => !uploadedNumbers.has(number)),
    ).toEqual([1, 2]);
    const empty = await context.seedUpload();
    const emptyResult: HttpResponse<ListUploadedPartsResponseDto> =
      await request(context.app.getHttpServer())
        .get(path(empty.video.public_id))
        .auth(empty.token, { type: 'bearer' })
        .expect(200);
    expect(emptyResult.body.parts).toEqual([]);
    expect(emptyResult.body.upload_session.id).toBe(empty.session.id);
    expect(emptyResult.body.upload_session.status).toBe('active');
    expect(emptyResult.body.upload_session.expires_at).toBe(
      empty.session.expires_at.toISOString(),
    );
    const persisted = await context.dataSource
      .getRepository(UploadSession)
      .findOneByOrFail({ id: upload.session.id });
    expect(persisted.expires_at.getTime()).toBe(
      upload.session.expires_at.getTime(),
    );
    expect(await context.counts()).toEqual({
      videos: 2,
      sessions: 2,
      uploads: 2,
    });
  });

  test('aggregate-every-storage-page', async () => {
    const upload = await context.seedUpload();
    const second = await put(upload, 2, new Uint8Array([2]));
    const first = await put(upload, 1, new Uint8Array(67108864));
    const storage = context.app.get(StorageService);
    const original = storage.listParts.bind(
      storage,
    ) as StorageService['listParts'];
    jest
      .spyOn(storage, 'listParts')
      .mockImplementation(async (reference) => await original(reference, 1));
    const result: HttpResponse<ListUploadedPartsResponseDto> = await request(
      context.app.getHttpServer(),
    )
      .get(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .expect(200);
    expect(result.body.parts).toEqual([first, second]);
    expect(Object.keys(result.body).sort()).toEqual(
      ['upload_session', 'parts'].sort(),
    );
    for (const part of result.body.parts)
      expect(Object.keys(part).sort()).toEqual(
        ['part_number', 'etag', 'size'].sort(),
      );
    expect(result.body).not.toHaveProperty('continuation_token');
  }, 30000);

  test('keep-storage-references-server-owned', async () => {
    const own = await context.seedUpload();
    const foreign = await context.seedUpload();
    const first = await put(own, 2, new Uint8Array([1]));
    const second = await put(foreign, 2, new Uint8Array([2]));
    const before: HttpResponse<ListUploadedPartsResponseDto> = await request(
      context.app.getHttpServer(),
    )
      .get(path(own.video.public_id))
      .auth(own.token, { type: 'bearer' })
      .expect(200);
    expect(before.body.parts).toEqual([first]);
    const references = {
      bucket: 'other-bucket',
      key: foreign.video.original_key,
      UploadId: foreign.session.upload_id,
      'continuation-token': foreign.session.upload_id,
    };
    for (const [key, value] of Object.entries(references)) {
      const result: HttpResponse<ListUploadedPartsResponseDto> = await request(
        context.app.getHttpServer(),
      )
        .get(path(own.video.public_id))
        .query({ [key]: value })
        .auth(own.token, { type: 'bearer' })
        .expect(200);
      expect(result.body).toEqual(before.body);
      expect(JSON.stringify(result.body)).not.toContain(
        foreign.session.upload_id,
      );
      expect(JSON.stringify(result.body)).not.toContain(
        foreign.video.original_key,
      );
    }
    const bodyAttempt: HttpResponse<ListUploadedPartsResponseDto> =
      await request(context.app.getHttpServer())
        .get(path(own.video.public_id))
        .auth(own.token, { type: 'bearer' })
        .send(references)
        .expect(200);
    expect(bodyAttempt.body).toEqual(before.body);
    expect(
      await context.storageParts(own.video.original_key, own.session.upload_id),
    ).toEqual([{ partNumber: 2, etag: first.etag, size: 1 }]);
    expect(
      await context.storageParts(
        foreign.video.original_key,
        foreign.session.upload_id,
      ),
    ).toEqual([{ partNumber: 2, etag: second.etag, size: 1 }]);
    for (const upload of [own, foreign]) {
      const session = await context.dataSource
        .getRepository(UploadSession)
        .findOneByOrFail({ id: upload.session.id });
      expect(session.status).toBe('active');
      expect(session.upload_id).toBe(upload.session.upload_id);
      expect(session.expires_at.getTime()).toBe(
        upload.session.expires_at.getTime(),
      );
    }
  });

  test('reject-closed-or-deadline-passed-session', async () => {
    const upload = await context.seedUpload(1);
    const part = await put(upload, 1, new Uint8Array([1]));
    await context.app
      .get(StorageService)
      .completeMultipart(
        { key: upload.video.original_key, uploadId: upload.session.upload_id },
        [{ partNumber: 1, etag: part.etag }],
      );
    expect(
      await context.storageParts(
        upload.video.original_key,
        upload.session.upload_id,
      ),
    ).toBeNull();
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
        .get(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .expect(409);
      expect(response.body).toEqual({
        statusCode: 409,
        error: 'UPLOAD_NOT_ACTIVE',
        message: 'Upload session is not active',
      });
    }
    await context.dataSource
      .getRepository(UploadSession)
      .update(upload.session.id, { expires_at: upload.session.expires_at });
    const missingStorage: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .get(path(upload.video.public_id))
      .auth(upload.token, { type: 'bearer' })
      .expect(409);
    expect(missingStorage.body.error).toBe('UPLOAD_NOT_ACTIVE');
  });

  test('enforce-token-and-owner-scope', async () => {
    const upload = await context.seedUpload();
    const expired = await context.jwt.signAsync(
      { sub: upload.user.id, email: upload.user.email },
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
    for (const publicId of [upload.video.public_id, 'aaaaaaaaaaaa']) {
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
      .get(path('bad-id'))
      .auth(owner.token, { type: 'bearer' })
      .expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
    });
    expect(Array.isArray(response.body.message)).toBe(true);
  });

  test('report-storage-inventory-unavailability', async () => {
    const upload = await context.seedUpload();
    jest
      .spyOn(context.app.get(StorageService), 'listParts')
      .mockRejectedValueOnce(
        new StorageUnavailableException(
          new Error('private inventory diagnostic'),
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

  test('retain-inherited-throttler-response', async () => {
    const upload = await context.seedUpload();
    for (let index = 0; index < 10; index++)
      await request(context.app.getHttpServer())
        .get(path(upload.video.public_id))
        .auth(upload.token, { type: 'bearer' })
        .expect(200);
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
