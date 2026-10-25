import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import { Channel } from '../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import {
  createVideoFixture,
  VIDEO_TEST_ENTITIES,
} from '../test/video-test-data';
import { VideoStatus } from './entities/video.entity';
import { VideoNotFoundException } from './exceptions/video.exceptions';
import { VideoPersistenceModule } from './video-persistence.module';
import { VideoRecordsService } from './video-records.service';

describe('VideoRecordsService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideoRecordsService;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(
          createTestDataSource(VIDEO_TEST_ENTITIES, { synchronize: false })
            .options,
        ),
        VideoPersistenceModule,
      ],
    }).compile();
    dataSource = module.get(DataSource);
    service = module.get(VideoRecordsService);
  });
  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });
  afterAll(async () => {
    await module.close();
  });

  it('should find the owner through the real channel join and hide foreign or absent videos identically', async () => {
    const owned = await createVideoFixture(dataSource);
    const other = await createVideoFixture(dataSource);
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ id: owned.channel_id });
    expect(
      (await service.findOwnedByPublicId(owned.public_id, channel.user_id)).id,
    ).toBe(owned.id);
    await expect(
      service.findOwnedByPublicId(other.public_id, channel.user_id),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    await expect(
      service.findOwnedByPublicId('no_video_123', channel.user_id),
    ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND', httpStatus: 404 });
    expect(await service.findById(owned.id)).toMatchObject({ id: owned.id });
    expect(await service.findById(randomUUID())).toBeNull();
  });

  it('should create and query a draft only through the supplied manager and roll it back', async () => {
    const seed = await createVideoFixture(dataSource);
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ id: seed.channel_id });
    const id = randomUUID();
    await expect(
      dataSource.transaction(async (manager) => {
        const video = await service.createDraft(
          {
            id,
            channelId: channel.id,
            publicId: randomBytes(9).toString('base64url'),
            title: 'Atomic draft',
            originalFilename: 'untrusted-name.mp4',
            contentType: 'video/mp4',
            declaredSize: 10,
          },
          manager,
        );
        expect(video.original_key).toBe(`videos/${id}/original`);
        expect(
          (
            await service.findOwnedByPublicId(
              video.public_id,
              channel.user_id,
              manager,
            )
          ).id,
        ).toBe(id);
        expect(await service.findById(id)).toBeNull();
        throw new Error('rollback draft');
      }),
    ).rejects.toThrow('rollback draft');
    expect(await service.findById(id)).toBeNull();
  });

  it('should use conditional state writes and never regress a terminal record', async () => {
    const video = await createVideoFixture(dataSource);
    expect(
      await service.updateState(
        video.id,
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
      ),
    ).toBe(true);
    expect(
      await service.updateState(
        video.id,
        VideoStatus.PROCESSING,
        VideoStatus.READY,
        {
          duration: 1.2,
          metadata: { format: 'mp4', codec: 'h264' },
          thumbnail_key: `videos/${video.id}/thumbnail.jpg`,
          failure_reason: null,
        },
      ),
    ).toBe(true);
    expect(
      await service.updateState(
        video.id,
        VideoStatus.PROCESSING,
        VideoStatus.ERROR,
      ),
    ).toBe(false);
    expect((await service.findById(video.id))!.status).toBe(VideoStatus.READY);
  });

  it('should roll back manager-bound state updates with the calling transaction', async () => {
    const video = await createVideoFixture(dataSource);
    await expect(
      dataSource.transaction(async (manager) => {
        expect(
          await service.updateState(
            video.id,
            VideoStatus.DRAFT,
            VideoStatus.PROCESSING,
            {},
            manager,
          ),
        ).toBe(true);
        throw new Error('rollback state');
      }),
    ).rejects.toThrow('rollback state');
    expect((await service.findById(video.id))!.status).toBe(VideoStatus.DRAFT);
  });
});
