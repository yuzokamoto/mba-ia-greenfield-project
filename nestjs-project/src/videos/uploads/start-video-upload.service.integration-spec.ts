import { ListMultipartUploadsCommand } from '@aws-sdk/client-s3';
import { createVideoTestContext } from '../../test/create-video-test-context';
import { createVideoFixture } from '../../test/video-test-data';
import { VIDEO_TEST_BUCKET } from '../../test/video-test-environment';
import { UploadSession } from '../entities/upload-session.entity';
import { Video } from '../entities/video.entity';
import { PublicIdGenerator } from '../public-id';
import { UploadSessionsService } from './upload-sessions.service';

describe('StartVideoUploadService (integration)', () => {
  let context: Awaited<ReturnType<typeof createVideoTestContext>>;
  const input = {
    title: 'New video',
    original_filename: 'video.mp4',
    content_type: 'video/mp4',
    declared_size: 67108865,
  };
  beforeAll(async () => {
    context = await createVideoTestContext();
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
  async function owner() {
    const seed = await createVideoFixture(context.dataSource);
    const row: { user_id: string }[] = await context.dataSource.query(
      'SELECT user_id FROM channels WHERE id = $1',
      [seed.channel_id],
    );
    return { seed, userId: row[0].user_id };
  }
  async function allocations() {
    return (
      (
        await context.client.send(
          new ListMultipartUploadsCommand({ Bucket: VIDEO_TEST_BUCKET }),
        )
      ).Uploads ?? []
    );
  }
  it('should durably create one draft/session per call with fixed parts and a 24-hour deadline', async () => {
    const { userId } = await owner();
    const before = Date.now();
    const response = await context.start.start(userId, input);
    expect(response.video).toMatchObject({
      status: 'draft',
      declared_size: input.declared_size,
      title: input.title,
    });
    expect(response.upload_session).toMatchObject({
      status: 'active',
      part_size: 67108864,
      total_parts: 2,
    });
    expect(
      Date.parse(response.upload_session.expires_at),
    ).toBeGreaterThanOrEqual(before + 86400000);
    expect(Date.parse(response.upload_session.expires_at)).toBeLessThanOrEqual(
      Date.now() + 86400000,
    );
    await context.start.start(userId, input);
    expect(await context.dataSource.getRepository(Video).count()).toBe(3);
    expect(await context.dataSource.getRepository(UploadSession).count()).toBe(
      2,
    );
    expect(await allocations()).toHaveLength(2);
    expect(response.video).not.toHaveProperty('original_key');
    expect(response.upload_session).not.toHaveProperty('upload_id');
  });
  it('should roll back an inserted draft and abort its real S3 allocation on session failure', async () => {
    const { userId } = await owner();
    const failure = new Error('session persistence failed');
    jest
      .spyOn(context.module.get(UploadSessionsService), 'create')
      .mockRejectedValueOnce(failure);
    await expect(context.start.start(userId, input)).rejects.toBe(failure);
    expect(await context.dataSource.getRepository(Video).count()).toBe(1);
    expect(await context.dataSource.getRepository(UploadSession).count()).toBe(
      0,
    );
    expect(await allocations()).toHaveLength(0);
  });
  it('should retry real concurrent collisions in fresh transactions without partial sessions', async () => {
    const { userId, seed } = await owner();
    jest
      .spyOn(context.module.get(PublicIdGenerator), 'generate')
      .mockReturnValueOnce(seed.public_id)
      .mockReturnValueOnce(seed.public_id);
    const results = await Promise.all([
      context.start.start(userId, input),
      context.start.start(userId, input),
    ]);
    expect(new Set(results.map((r) => r.video.public_id)).size).toBe(2);
    expect(await context.dataSource.getRepository(Video).count()).toBe(3);
    expect(await context.dataSource.getRepository(UploadSession).count()).toBe(
      2,
    );
    expect(await allocations()).toHaveLength(2);
  });
  it('should exhaust exactly three real UNIQUE conflicts and abort storage allocation', async () => {
    const { userId, seed } = await owner();
    const generator = jest
      .spyOn(context.module.get(PublicIdGenerator), 'generate')
      .mockReturnValue(seed.public_id);
    await expect(context.start.start(userId, input)).rejects.toMatchObject({
      errorCode: 'VIDEO_ID_ALLOCATION_FAILED',
    });
    expect(generator).toHaveBeenCalledTimes(3);
    expect(await context.dataSource.getRepository(Video).count()).toBe(1);
    expect(await context.dataSource.getRepository(UploadSession).count()).toBe(
      0,
    );
    expect(await allocations()).toHaveLength(0);
  });
});
