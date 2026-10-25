import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import {
  createVideoFixture,
  VIDEO_TEST_ENTITIES,
} from '../../test/video-test-data';
import { UPLOAD_MAX_BYTES } from '../videos.constants';
import { Video, VideoStatus } from './video.entity';

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  beforeAll(async () => {
    dataSource = createTestDataSource(VIDEO_TEST_ENTITIES, {
      synchronize: false,
    });
    await dataSource.initialize();
  });
  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });
  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should reserve unique base64url identifiers and keep default processing state', async () => {
    const video = await createVideoFixture(dataSource);
    const persisted = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(persisted.status).toBe(VideoStatus.DRAFT);
    expect(persisted.processing_attempts).toBe(0);
    expect(persisted.failure_reason).toBeNull();
    expect(persisted.created_at).toBeInstanceOf(Date);
    await expect(
      createVideoFixture(dataSource, { public_id: video.public_id }),
    ).rejects.toMatchObject({
      driverError: { code: '23505', constraint: 'UQ_videos_public_id' },
    });
  });

  it.each(['short', 'abcdefghijklM', '!!!!!!!!!!!!'])(
    'should reject malformed public ID %s',
    async (public_id) => {
      await expect(
        createVideoFixture(dataSource, { public_id }),
      ).rejects.toThrow();
    },
  );

  it('should prevent ORM updates from replacing the reserved public identifier', async () => {
    const video = await createVideoFixture(dataSource);
    await dataSource.getRepository(Video).update(video.id, {
      title: 'Updated fixture title',
      public_id: 'new_publicId',
    });
    expect(
      (await dataSource.getRepository(Video).findOneByOrFail({ id: video.id }))
        .public_id,
    ).toBe(video.public_id);
  });

  it.each(['0', '-1', String(UPLOAD_MAX_BYTES + 1)])(
    'should reject declared size %s',
    async (declared_size) => {
      await expect(
        createVideoFixture(dataSource, { declared_size }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    },
  );

  it('should round-trip the exact 10 GiB boundary as a decimal string and retain JSON metadata', async () => {
    const metadata = {
      format: 'mov,mp4',
      codec: 'h264',
      nested: { width: 160 },
    };
    const video = await createVideoFixture(dataSource, {
      declared_size: String(UPLOAD_MAX_BYTES),
      metadata,
    });
    const found = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(found.declared_size).toBe(String(UPLOAD_MAX_BYTES));
    expect(found.metadata).toEqual(metadata);
  });

  it.each([-1, 4])('should reject attempts %s', async (processing_attempts) => {
    await expect(
      createVideoFixture(dataSource, { processing_attempts }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });

  it.each([0, -1, Infinity, -Infinity, NaN])(
    'should reject non-positive or non-finite duration %s',
    async (duration) => {
      await expect(
        createVideoFixture(dataSource, { duration }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    },
  );

  it('should reject readiness until metadata, duration and thumbnail are present', async () => {
    await expect(
      createVideoFixture(dataSource, { status: VideoStatus.READY }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    const video = await createVideoFixture(dataSource, {
      status: VideoStatus.READY,
      duration: 0.25,
      metadata: { format: 'mp4', codec: 'h264' },
      thumbnail_key: 'known-thumbnail',
    });
    expect(video.status).toBe(VideoStatus.READY);
    await expect(
      dataSource.query('UPDATE videos SET failure_reason = $1 WHERE id = $2', [
        'invalid_media',
        video.id,
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });

  it('should constrain safe failure codes and channel ownership references', async () => {
    await expect(
      createVideoFixture(dataSource, { channel_id: randomUUID() }),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    const video = await createVideoFixture(dataSource);
    await expect(
      dataSource.query('UPDATE videos SET failure_reason = $1 WHERE id = $2', [
        'raw diagnostic',
        video.id,
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });
});
