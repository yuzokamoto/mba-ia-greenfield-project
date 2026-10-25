import { createVideoTestContext } from '../../test/create-video-test-context';
import { createVideoFixture } from '../../test/video-test-data';
import {
  UploadSession,
  UploadSessionStatus,
} from '../entities/upload-session.entity';
import { Video } from '../entities/video.entity';
import { UploadPartsService } from './upload-parts.service';

describe('UploadPartsService (integration)', () => {
  let context: Awaited<ReturnType<typeof createVideoTestContext>>;
  let service: UploadPartsService;
  beforeAll(async () => {
    context = await createVideoTestContext();
    service = context.module.get(UploadPartsService);
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
  async function pair() {
    const seed = await createVideoFixture(context.dataSource);
    const rows: { user_id: string }[] = await context.dataSource.query(
      'SELECT user_id FROM channels WHERE id=$1',
      [seed.channel_id],
    );
    const userId = rows[0].user_id;
    const response = await context.start.start(userId, {
      title: 'Parts',
      original_filename: 'parts.mp4',
      content_type: 'video/mp4',
      declared_size: 67108865,
    });
    const video = await context.dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: response.video.id });
    const session = await context.dataSource
      .getRepository(UploadSession)
      .findOneByOrFail({ video_id: video.id });
    return { userId, video, session };
  }
  async function put(url: string, body: Buffer) {
    const result = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(30000),
    });
    await result.arrayBuffer();
    expect(result.status).toBe(200);
    const etag = result.headers.get('etag');
    if (!etag) throw new Error('Storage omitted PUT ETag');
    return etag;
  }
  it('should renew only the missing expected part and resume actual ETags/sizes across real pagination', async () => {
    const { userId, video, session } = await pair();
    expect((await service.list(video.public_id, userId)).parts).toEqual([]);
    const first = await service.sign(video.public_id, userId, [1]);
    expect(new URL(first.parts[0].url).origin).toBe(
      process.env.S3_PUBLIC_ENDPOINT,
    );
    const etag1 = await put(
      first.parts[0].url,
      Buffer.from('first part bytes'),
    );
    const interrupted = await service.list(video.public_id, userId);
    expect(interrupted.parts).toEqual([
      { part_number: 1, etag: etag1, size: 16 },
    ]);
    const second = await service.sign(video.public_id, userId, [2]);
    const etag2 = await put(second.parts[0].url, Buffer.from('x'));
    const original = context.storage.listParts.bind(
      context.storage,
    ) as typeof context.storage.listParts;
    jest
      .spyOn(context.storage, 'listParts')
      .mockImplementation(async (reference) => await original(reference, 1));
    const result = await service.list(video.public_id, userId);
    expect(result.parts).toEqual([
      { part_number: 1, etag: etag1, size: 16 },
      { part_number: 2, etag: etag2, size: 1 },
    ]);
    expect(result.upload_session).toMatchObject({
      id: session.id,
      status: 'active',
      total_parts: 2,
      part_size: 67108864,
    });
    expect(result.upload_session.expires_at).toBe(
      session.expires_at.toISOString(),
    );
    expect(JSON.stringify(result)).not.toContain(session.upload_id);
    expect(result).not.toHaveProperty('original_key');
  });
  it('should cap actual signatures at the persisted deadline and reject elapsed sessions', async () => {
    const { userId, video, session } = await pair();
    const deadline = new Date(Date.now() + 65000);
    await context.dataSource
      .getRepository(UploadSession)
      .update(session.id, { expires_at: deadline });
    const signed = (await service.sign(video.public_id, userId, [1])).parts[0];
    expect(
      Number(new URL(signed.url).searchParams.get('X-Amz-Expires')),
    ).toBeLessThanOrEqual(65);
    expect(Date.parse(signed.expires_at)).toBeLessThanOrEqual(
      deadline.getTime(),
    );
    await put(signed.url, Buffer.from('x'));
    await context.dataSource
      .getRepository(UploadSession)
      .update(session.id, { expires_at: new Date(Date.now() - 1) });
    await expect(
      service.sign(video.public_id, userId, [2]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
    await expect(service.list(video.public_id, userId)).rejects.toMatchObject({
      errorCode: 'UPLOAD_NOT_ACTIVE',
    });
  });
  it('should reject foreign and nonexistent videos through the same owner-scoped lookup', async () => {
    const { video } = await pair();
    const foreignSeed = await createVideoFixture(context.dataSource);
    const rows: { user_id: string }[] = await context.dataSource.query(
      'SELECT user_id FROM channels WHERE id=$1',
      [foreignSeed.channel_id],
    );
    for (const publicId of [video.public_id, 'aaaaaaaaaaaa']) {
      await expect(
        service.sign(publicId, rows[0].user_id, [1]),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
      await expect(
        service.list(publicId, rows[0].user_id),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    }
  });
  it.each([
    UploadSessionStatus.COMPLETED,
    UploadSessionStatus.ABORTED,
    UploadSessionStatus.EXPIRED,
  ])('should reject persisted %s sessions', async (status) => {
    const { userId, video, session } = await pair();
    await context.dataSource
      .getRepository(UploadSession)
      .update(session.id, { status });
    await expect(
      service.sign(video.public_id, userId, [1]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
    await expect(service.list(video.public_id, userId)).rejects.toMatchObject({
      errorCode: 'UPLOAD_NOT_ACTIVE',
    });
  });
  it('should return a closed-upload conflict when S3 no longer has the active database upload', async () => {
    const { userId, video, session } = await pair();
    await context.storage.abortMultipart({
      key: video.original_key,
      uploadId: session.upload_id,
    });
    await expect(
      service.sign(video.public_id, userId, [1]),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
    await expect(service.list(video.public_id, userId)).rejects.toMatchObject({
      errorCode: 'UPLOAD_NOT_ACTIVE',
    });
  });
});
