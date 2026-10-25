import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type DeepPartial } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import {
  createVideoFixture,
  VIDEO_TEST_ENTITIES,
} from '../test/video-test-data';
import {
  UploadSession,
  UploadSessionStatus,
} from './entities/upload-session.entity';
import {
  Video,
  VideoFailureReason,
  VideoStatus,
} from './entities/video.entity';
import { OwnVideosService } from './own-videos.service';
import { UploadSessionsService } from './uploads/upload-sessions.service';
import { VideoPersistenceModule } from './video-persistence.module';
import { UPLOAD_MAX_BYTES } from './videos.constants';

describe('OwnVideosService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: OwnVideosService;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(
          createTestDataSource(VIDEO_TEST_ENTITIES, { synchronize: false })
            .options,
        ),
        VideoPersistenceModule,
      ],
      providers: [OwnVideosService],
    }).compile();
    dataSource = module.get(DataSource);
    service = module.get(OwnVideosService);
  });
  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });
  afterAll(async () => {
    await module.close();
  });
  async function seed(
    overrides: DeepPartial<Video> = {},
    status = UploadSessionStatus.ACTIVE,
  ) {
    const video = await createVideoFixture(dataSource, overrides);
    const session = await dataSource.transaction(
      async (manager) =>
        await module
          .get(UploadSessionsService)
          .create(video.id, 'private-upload-id', manager),
    );
    await dataSource
      .getRepository(UploadSession)
      .update(session.id, { status });
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ id: video.channel_id });
    return { video, session, userId: channel.user_id };
  }
  it.each(Object.values(VideoStatus))(
    'should project %s with exact safe nullable result and session fields',
    async (status) => {
      const ready = status === VideoStatus.READY;
      const error = status === VideoStatus.ERROR;
      const { video, session, userId } = await seed({
        status,
        declared_size: String(UPLOAD_MAX_BYTES),
        ...(ready
          ? {
              duration: 1.5,
              metadata: { container: 'mov', video: { codec: 'h264' } },
              thumbnail_key: 'private-thumbnail',
            }
          : {}),
        ...(error ? { failure_reason: VideoFailureReason.INVALID_MEDIA } : {}),
      });
      const detail = await service.detail(video.public_id, userId);
      expect(detail).toEqual({
        video: {
          id: video.id,
          public_id: video.public_id,
          channel_id: video.channel_id,
          title: video.title,
          status,
          failure_reason: error ? 'invalid_media' : null,
          original_filename: video.original_filename,
          content_type: video.content_type,
          declared_size: UPLOAD_MAX_BYTES,
          duration: ready ? 1.5 : null,
          metadata: ready
            ? { container: 'mov', video: { codec: 'h264' } }
            : null,
          created_at: video.created_at.toISOString(),
          updated_at: video.updated_at.toISOString(),
        },
        upload_session: {
          id: session.id,
          status: 'active',
          part_size: 67108864,
          total_parts: 160,
          expires_at: session.expires_at.toISOString(),
        },
      });
      expect(await service.list(userId)).toEqual([detail.video]);
      expect(JSON.stringify(detail)).not.toMatch(
        /private-upload-id|private-thumbnail|original_key|processing_attempts|upload_id/,
      );
    },
  );
  it('should hide foreign and missing videos with the same safe exception', async () => {
    const owner = await seed();
    const foreign = await seed();
    for (const publicId of [foreign.video.public_id, 'missing_1234'])
      await expect(
        service.detail(publicId, owner.userId),
      ).rejects.toMatchObject({
        errorCode: 'VIDEO_NOT_FOUND',
        httpStatus: 404,
        message: 'Video not found',
      });
    expect(await service.list(owner.userId)).toHaveLength(1);
  });
  it('should order by creation descending then UUID descending while excluding other owners', async () => {
    const owner = await seed({ created_at: new Date('2025-01-01T00:00:00Z') });
    const lower = await seed({
      id: '00000000-0000-4000-8000-000000000001',
      channel_id: owner.video.channel_id,
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
    const higher = await seed({
      id: '00000000-0000-4000-8000-000000000002',
      channel_id: owner.video.channel_id,
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
    await seed({ created_at: new Date('2027-01-01T00:00:00Z') });
    expect((await service.list(owner.userId)).map((video) => video.id)).toEqual(
      [higher.video.id, lower.video.id, owner.video.id],
    );
  });
  it('should preserve the aborted session deadline and draft identity for the owner', async () => {
    const { video, session, userId } = await seed(
      {},
      UploadSessionStatus.ABORTED,
    );
    expect(await service.detail(video.public_id, userId)).toMatchObject({
      video: { id: video.id, status: 'draft', failure_reason: null },
      upload_session: {
        id: session.id,
        status: 'aborted',
        expires_at: session.expires_at.toISOString(),
      },
    });
  });
  it('should return an empty array for users with no videos or channel', async () => {
    await seed();
    expect(await service.list(randomUUID())).toEqual([]);
    expect(await service.list('')).toEqual([]);
  });
  it('should propagate a broken persisted session invariant instead of inventing a response', async () => {
    const { video, session, userId } = await seed();
    await dataSource.getRepository(UploadSession).delete(session.id);
    await expect(service.detail(video.public_id, userId)).rejects.toThrow(
      'Persisted video has no upload session',
    );
  });
});
