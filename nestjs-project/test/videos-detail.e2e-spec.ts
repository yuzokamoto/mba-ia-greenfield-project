import request from 'supertest';
import type { OwnVideoResponseDto } from '../src/videos/dto/own-video-response.dto';
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
import { expectVideoProjection } from './helpers/video-projection';

describe('videos-detail', () => {
  let context: Awaited<ReturnType<typeof createVideoE2eContext>>;
  beforeAll(async () => {
    context = await createVideoE2eContext();
  });
  beforeEach(async () => {
    await context.clean();
  });
  afterAll(async () => {
    await context.close();
  });
  const path = (publicId: string) => `/videos/${publicId}`;
  async function detail(
    publicId: string,
    token: string,
  ): Promise<HttpResponse<OwnVideoResponseDto>> {
    return await request(context.app.getHttpServer())
      .get(path(publicId))
      .auth(token, { type: 'bearer' })
      .expect(200);
  }
  test('retrieve-each-lifecycle-state-with-exact-projection', async () => {
    for (const status of Object.values(VideoStatus)) {
      const upload = await context.seedUpload(10737418240);
      await context.dataSource.getRepository(Video).update(upload.video.id, {
        status,
        ...(status === VideoStatus.READY
          ? {
              duration: 1.5,
              metadata: { container: 'mov', video: { codec: 'h264' } },
              thumbnail_key: `videos/${upload.video.id}/thumbnail.jpg`,
            }
          : {}),
        ...(status === VideoStatus.ERROR
          ? { failure_reason: VideoFailureReason.INVALID_MEDIA }
          : {}),
      });
      const sessionStatus =
        status === VideoStatus.DRAFT
          ? UploadSessionStatus.ACTIVE
          : UploadSessionStatus.COMPLETED;
      await context.dataSource
        .getRepository(UploadSession)
        .update(upload.session.id, { status: sessionStatus });
      const seeded = await context.dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: upload.video.id });
      const response = await detail(upload.video.public_id, upload.token);
      expect(Object.keys(response.body).sort()).toEqual([
        'upload_session',
        'video',
      ]);
      expectVideoProjection(response.body.video, seeded);
      expect(response.body.upload_session).toEqual({
        id: upload.session.id,
        status: sessionStatus,
        part_size: 67108864,
        total_parts: 160,
        expires_at: upload.session.expires_at.toISOString(),
      });
      expect(JSON.stringify(response.body)).not.toContain(
        upload.session.upload_id,
      );
      expect(JSON.stringify(response.body)).not.toContain(
        upload.video.original_key,
      );
      expect(JSON.stringify(response.body)).not.toMatch(
        /processing_attempts|thumbnail_key|X-Amz/,
      );
    }
  });
  test('expose-only-safe-processing-failure-reasons', async () => {
    const videos = context.dataSource.getRepository(Video);
    for (const failure_reason of Object.values(VideoFailureReason)) {
      const upload = await context.seedUpload(1);
      await videos.update(upload.video.id, {
        status: VideoStatus.ERROR,
        failure_reason,
        processing_attempts: 3,
        thumbnail_key:
          'private ffmpeg stderr credential=X-Amz-Signature=secret',
      });
      const response = await detail(upload.video.public_id, upload.token);
      expect(response.body.video).toMatchObject({
        status: 'error',
        failure_reason,
        duration: null,
        metadata: null,
      });
      expectVideoProjection(
        response.body.video,
        await context.dataSource
          .getRepository(Video)
          .findOneByOrFail({ id: upload.video.id }),
      );
      expect(JSON.stringify(response.body)).not.toMatch(
        /private|stderr|credential|X-Amz|processing_attempts|upload_id/,
      );
    }
  });
  test('enforce-token-and-owner-scope', async () => {
    const upload = await context.seedUpload(1);
    const outsider = await context.seedUser();
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
    for (const publicId of [upload.video.public_id, 'missing_1234']) {
      const response: HttpResponse<HttpErrorBody> = await request(
        context.app.getHttpServer(),
      )
        .get(path(publicId))
        .auth(outsider.token, { type: 'bearer' })
        .expect(404);
      expect(response.body).toEqual({
        statusCode: 404,
        error: 'VIDEO_NOT_FOUND',
        message: 'Video not found',
      });
    }
  });
  test('reject-malformed-public-id', async () => {
    const upload = await context.seedUpload(1);
    for (const publicId of ['short', 'invalid!____', upload.video.id]) {
      const response: HttpResponse<HttpErrorBody> = await request(
        context.app.getHttpServer(),
      )
        .get(path(publicId))
        .auth(upload.token, { type: 'bearer' })
        .expect(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        error: 'VALIDATION_ERROR',
      });
      expect(Object.keys(response.body).sort()).toEqual([
        'error',
        'message',
        'statusCode',
      ]);
      expect(Array.isArray(response.body.message)).toBe(true);
    }
  });
  test('keep-repeated-retrieval-read-only', async () => {
    for (const aborted of [false, true]) {
      const upload = await context.seedUpload(1);
      if (aborted)
        await request(context.app.getHttpServer())
          .post(`${path(upload.video.public_id)}/upload/abort`)
          .auth(upload.token, { type: 'bearer' })
          .expect(204);
      else {
        await context.dataSource
          .getRepository(Video)
          .update(upload.video.id, { status: VideoStatus.PROCESSING });
        await context.queue.add(
          'process-video',
          { videoId: upload.video.id },
          { jobId: `video-${upload.video.id}` },
        );
      }
      const videos = await context.dataSource.getRepository(Video).find();
      const sessions = await context.dataSource
        .getRepository(UploadSession)
        .find();
      const jobs = await context.queue.getJobCounts();
      for (let index = 0; index < 3; index++) {
        const response = await detail(upload.video.public_id, upload.token);
        expect(response.body.video).toMatchObject({
          id: upload.video.id,
          public_id: upload.video.public_id,
          status: aborted ? 'draft' : 'processing',
        });
        expect(response.body.upload_session).toMatchObject({
          id: upload.session.id,
          status: aborted ? 'aborted' : 'active',
          expires_at: upload.session.expires_at.toISOString(),
        });
      }
      expect(await context.dataSource.getRepository(Video).find()).toEqual(
        videos,
      );
      expect(
        await context.dataSource.getRepository(UploadSession).find(),
      ).toEqual(sessions);
      expect(await context.queue.getJobCounts()).toEqual(jobs);
    }
  });
  test('retain-inherited-throttler-response', async () => {
    const upload = await context.seedUpload(1);
    for (let index = 0; index < 10; index++)
      await detail(upload.video.public_id, upload.token);
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
