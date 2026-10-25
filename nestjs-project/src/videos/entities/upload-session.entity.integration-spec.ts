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
import { UPLOAD_PART_SIZE_BYTES } from '../videos.constants';
import { UploadSession, UploadSessionStatus } from './upload-session.entity';

describe('UploadSession entity (integration)', () => {
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

  async function create(
    part_size: number = UPLOAD_PART_SIZE_BYTES,
    videoId?: string,
  ) {
    const video = videoId ? undefined : await createVideoFixture(dataSource);
    return await dataSource.getRepository(UploadSession).save({
      video_id: videoId ?? video!.id,
      upload_id: 'storage-upload',
      part_size,
      expires_at: new Date('2026-11-01T00:00:00.000Z'),
    });
  }

  it('should retain one session per video, active defaults, timestamps and UTC expiry', async () => {
    const session = await create();
    const found = await dataSource
      .getRepository(UploadSession)
      .findOneByOrFail({ id: session.id });
    expect(found.status).toBe(UploadSessionStatus.ACTIVE);
    expect(found.part_size).toBe(UPLOAD_PART_SIZE_BYTES);
    expect(found.expires_at.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(found.created_at).toBeInstanceOf(Date);
    await expect(
      create(UPLOAD_PART_SIZE_BYTES, session.video_id),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });

  it.each([0, -1])(
    'should reject non-positive part size %s',
    async (part_size) => {
      await expect(create(part_size)).rejects.toMatchObject({
        driverError: { code: '23514' },
      });
    },
  );

  it('should accept a positive part size without requiring equality to current policy', async () => {
    expect((await create(1)).part_size).toBe(1);
  });

  it('should reject unknown status and missing video references', async () => {
    await expect(
      create(UPLOAD_PART_SIZE_BYTES, randomUUID()),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    const session = await create();
    await expect(
      dataSource.query('UPDATE upload_sessions SET status = $1 WHERE id = $2', [
        'unknown',
        session.id,
      ]),
    ).rejects.toThrow();
    for (const status of [
      UploadSessionStatus.COMPLETED,
      UploadSessionStatus.ABORTED,
      UploadSessionStatus.EXPIRED,
    ]) {
      await dataSource
        .getRepository(UploadSession)
        .update(session.id, { status });
      expect(
        (
          await dataSource
            .getRepository(UploadSession)
            .findOneByOrFail({ id: session.id })
        ).status,
      ).toBe(status);
    }
  });
});
