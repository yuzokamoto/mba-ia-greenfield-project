import request from 'supertest';
import type { DeepPartial } from 'typeorm';
import { createVideoFixture } from '../src/test/video-test-data';
import type { VideoResponseDto } from '../src/videos/dto/video-response.dto';
import {
  Video,
  VideoFailureReason,
  VideoStatus,
} from '../src/videos/entities/video.entity';
import { UploadSessionsService } from '../src/videos/uploads/upload-sessions.service';
import {
  createVideoE2eContext,
  type HttpErrorBody,
  type HttpResponse,
} from './helpers/video-e2e-context';
import { expectVideoProjection } from './helpers/video-projection';

describe('videos-list', () => {
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
  async function seed(channelId: string, overrides: DeepPartial<Video> = {}) {
    const video = await createVideoFixture(context.dataSource, {
      channel_id: channelId,
      ...overrides,
    });
    await context.dataSource.transaction(
      async (manager) =>
        await context.app
          .get(UploadSessionsService)
          .create(video.id, 'private-upload-id', manager),
    );
    return video;
  }
  async function list(
    token: string,
  ): Promise<HttpResponse<VideoResponseDto[]>> {
    return await request(context.app.getHttpServer())
      .get('/videos')
      .auth(token, { type: 'bearer' })
      .expect(200);
  }
  test('list-only-own-videos-in-deterministic-order', async () => {
    const owner = await context.seedUser();
    const foreign = await context.seedUser();
    const oldest = await seed(owner.channel!.id, {
      created_at: new Date('2024-01-01T00:00:00Z'),
    });
    const lower = await seed(owner.channel!.id, {
      id: '00000000-0000-4000-8000-000000000001',
      created_at: new Date('2025-01-01T00:00:00Z'),
      status: VideoStatus.PROCESSING,
    });
    await seed(foreign.channel!.id, {
      created_at: new Date('2025-01-01T00:00:01Z'),
    });
    const higher = await seed(owner.channel!.id, {
      id: '00000000-0000-4000-8000-000000000002',
      created_at: new Date('2025-01-01T00:00:00Z'),
      status: VideoStatus.READY,
      duration: 1,
      metadata: { container: 'mov' },
      thumbnail_key: 'private-thumbnail',
    });
    const newest = await seed(owner.channel!.id, {
      created_at: new Date('2026-01-01T00:00:00Z'),
      status: VideoStatus.ERROR,
      failure_reason: VideoFailureReason.INVALID_MEDIA,
    });
    const response = await list(owner.token);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.map((video) => video.id)).toEqual([
      newest.id,
      higher.id,
      lower.id,
      oldest.id,
    ]);
    for (const [index, seeded] of [newest, higher, lower, oldest].entries())
      expectVideoProjection(response.body[index], seeded);
  });
  test('return-empty-collection-for-caller-without-videos', async () => {
    await context.seedUpload(1);
    for (const withChannel of [true, false]) {
      const empty = await context.seedUser(withChannel);
      expect((await list(empty.token)).body).toEqual([]);
    }
  });
  test('reject-missing-invalid-and-expired-token', async () => {
    const owner = await context.seedUser();
    const expired = await context.jwt.signAsync(
      { sub: owner.user.id, email: owner.user.email },
      { expiresIn: -1 },
    );
    for (const token of [undefined, 'invalid', expired]) {
      const call = request(context.app.getHttpServer()).get('/videos');
      if (token) call.auth(token, { type: 'bearer' });
      const response: HttpResponse<HttpErrorBody> = await call.expect(401);
      expect(response.body).toEqual({
        message: 'Unauthorized',
        statusCode: 401,
      });
    }
  });
  test('serialize-safe-collection-and-preserve-owner-authority', async () => {
    const owner = await context.seedUser();
    const foreign = await context.seedUser();
    const own = await seed(owner.channel!.id, {
      status: VideoStatus.ERROR,
      failure_reason: VideoFailureReason.PROCESSING_FAILED,
      declared_size: '10737418240',
      processing_attempts: 3,
      thumbnail_key: 'private stderr credential X-Amz-Signature=secret',
    });
    await seed(foreign.channel!.id);
    const response = await list(owner.token);
    expect(response.body).toHaveLength(1);
    expectVideoProjection(response.body[0], own);
    expect(JSON.stringify(response.body)).not.toMatch(
      /private|stderr|credential|X-Amz|processing_attempts|upload_id|original_key|thumbnail_key|url/,
    );
    const before = await context.dataSource
      .getRepository(Video)
      .find({ order: { id: 'ASC' } });
    for (const selector of [
      {
        owner_id: foreign.user.id,
        channel_id: foreign.channel!.id,
        user_id: foreign.user.id,
      },
      {
        owner: foreign.user.id,
        channel: foreign.channel!.id,
        user: foreign.user.id,
      },
    ]) {
      const attempted: HttpResponse<VideoResponseDto[]> = await request(
        context.app.getHttpServer(),
      )
        .get('/videos')
        .query(selector)
        .send(selector)
        .auth(owner.token, { type: 'bearer' })
        .expect(200);
      expect(attempted.body.map((video) => video.id)).toEqual([own.id]);
    }
    expect(
      await context.dataSource
        .getRepository(Video)
        .find({ order: { id: 'ASC' } }),
    ).toEqual(before);
  });
  test('retain-inherited-throttler-response', async () => {
    const owner = await context.seedUser();
    for (let index = 0; index < 10; index++) await list(owner.token);
    const response: HttpResponse<HttpErrorBody> = await request(
      context.app.getHttpServer(),
    )
      .get('/videos')
      .auth(owner.token, { type: 'bearer' })
      .expect(429);
    expect(response.body).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
  });
});
