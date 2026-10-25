import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import {
  createVideoFixture,
  VIDEO_TEST_ENTITIES,
} from '../../test/video-test-data';
import {
  UploadSession,
  UploadSessionStatus,
} from '../entities/upload-session.entity';
import { VideoStatus } from '../entities/video.entity';
import { VideoPersistenceModule } from '../video-persistence.module';
import { VideoRecordsService } from '../video-records.service';
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_PART_SIZE_BYTES,
  UPLOAD_SESSION_TTL_SECONDS,
} from '../videos.constants';
import { UploadSessionsService } from './upload-sessions.service';

describe('UploadSessionsService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let sessions: UploadSessionsService;
  let records: VideoRecordsService;
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
    sessions = module.get(UploadSessionsService);
    records = module.get(VideoRecordsService);
  });
  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });
  afterAll(async () => {
    await module.close();
  });

  async function pair() {
    const video = await createVideoFixture(dataSource);
    const session = await dataSource.transaction(
      async (manager) =>
        await sessions.create(video.id, 'server-upload-id', manager),
    );
    return { video, session };
  }

  it('should create one active session with fixed parts/deadline and reject a replacement session', async () => {
    const started = Date.now();
    const { video, session } = await pair();
    expect(session.part_size).toBe(UPLOAD_PART_SIZE_BYTES);
    expect(session.expires_at.getTime()).toBeGreaterThanOrEqual(
      started + UPLOAD_SESSION_TTL_SECONDS * 1000,
    );
    expect((await sessions.findForVideo(video.id))!.id).toBe(session.id);
    await expect(
      dataSource.transaction(
        async (manager) =>
          await sessions.create(video.id, 'replacement', manager),
      ),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    expect(await dataSource.getRepository(UploadSession).count()).toBe(1);
  });

  it('should roll back draft and session together without writes escaping the manager', async () => {
    const seed = await createVideoFixture(dataSource);
    const id = randomUUID();
    await expect(
      dataSource.transaction(async (manager) => {
        const video = await records.createDraft(
          {
            id,
            channelId: seed.channel_id,
            publicId: randomBytes(9).toString('base64url'),
            title: 'Atomic pair',
            originalFilename: 'video.mp4',
            contentType: 'video/mp4',
            declaredSize: 10,
          },
          manager,
        );
        await sessions.create(video.id, 'upload', manager);
        expect(await sessions.findForVideo(id)).toBeNull();
        expect((await sessions.findForVideo(id, manager))!.status).toBe(
          UploadSessionStatus.ACTIVE,
        );
        throw new Error('rollback pair');
      }),
    ).rejects.toThrow('rollback pair');
    expect(await records.findById(id)).toBeNull();
    expect(await sessions.findForVideo(id)).toBeNull();
  });

  it('should serialize actual concurrent session access with PostgreSQL row locks', async () => {
    const { video } = await pair();
    const first = dataSource.createQueryRunner();
    const second = dataSource.createQueryRunner();
    await first.connect();
    await second.connect();
    try {
      await first.startTransaction();
      await second.startTransaction();
      await sessions.lockActiveForVideo(video.id, first.manager);
      await second.query("SET LOCAL lock_timeout = '100ms'");
      await expect(
        sessions.lockActiveForVideo(video.id, second.manager),
      ).rejects.toMatchObject({ driverError: { code: '55P03' } });
      await second.rollbackTransaction();
      await first.commitTransaction();
      await second.startTransaction();
      expect(
        (await sessions.lockActiveForVideo(video.id, second.manager)).video_id,
      ).toBe(video.id);
      await second.commitTransaction();
    } finally {
      if (first.isTransactionActive) await first.rollbackTransaction();
      if (second.isTransactionActive) await second.rollbackTransaction();
      await first.release();
      await second.release();
    }
  });

  it.each([
    UploadSessionStatus.COMPLETED,
    UploadSessionStatus.ABORTED,
    UploadSessionStatus.EXPIRED,
  ])(
    'should expose %s for idempotent application checks while rejecting active-only locking',
    async (status) => {
      const { video, session } = await pair();
      await dataSource
        .getRepository(UploadSession)
        .update(session.id, { status });
      await dataSource.transaction(async (manager) => {
        expect((await sessions.lockForVideo(video.id, manager))!.status).toBe(
          status,
        );
      });
      await expect(
        dataSource.transaction(
          async (manager) =>
            await sessions.lockActiveForVideo(video.id, manager),
        ),
      ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
    },
  );

  it('should refuse locks outside transactions and return explicit missing-session results', async () => {
    const { video } = await pair();
    await expect(
      sessions.lockForVideo(video.id, dataSource.manager),
    ).rejects.toThrow('active transaction');
    expect(await sessions.findForVideo(randomUUID())).toBeNull();
    await expect(
      dataSource.transaction(
        async (manager) =>
          await sessions.lockActiveForVideo(randomUUID(), manager),
      ),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_NOT_ACTIVE' });
  });

  it('should commit the active-session transition and video processing intent in one manager', async () => {
    const { video, session } = await pair();
    await dataSource.transaction(async (manager) => {
      await sessions.lockActiveForVideo(video.id, manager);
      expect(
        await sessions.transitionActive(
          session.id,
          UploadSessionStatus.COMPLETED,
          manager,
        ),
      ).toBe(true);
      expect(
        await records.updateState(
          video.id,
          VideoStatus.DRAFT,
          VideoStatus.PROCESSING,
          {},
          manager,
        ),
      ).toBe(true);
      expect(
        await sessions.transitionActive(
          session.id,
          UploadSessionStatus.ABORTED,
          manager,
        ),
      ).toBe(false);
    });
    expect((await sessions.findForVideo(video.id))!.status).toBe(
      UploadSessionStatus.COMPLETED,
    );
    expect((await records.findById(video.id))!.status).toBe(
      VideoStatus.PROCESSING,
    );
  });

  it('should map the public session response without S3 upload references', async () => {
    const { session } = await pair();
    const response = sessions.toResponse(session, String(UPLOAD_MAX_BYTES));
    expect(response.total_parts).toBe(160);
    expect(response.expires_at).toBe(session.expires_at.toISOString());
    expect(Object.keys(response).sort()).toEqual(
      ['id', 'status', 'part_size', 'total_parts', 'expires_at'].sort(),
    );
    expect(JSON.stringify(response)).not.toContain('server-upload-id');
    expect(() =>
      sessions.toResponse({ ...session, part_size: 0 }, '1'),
    ).toThrow(RangeError);
  });
});
