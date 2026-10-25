import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { readFile } from 'node:fs/promises';
import { runtimeConfigOptions } from '../config/runtime-config';
import videoConfig from '../config/video.config';
import { StorageModule } from '../storage/storage.module';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { VIDEO_TEST_ENTITIES } from '../test/video-test-data';
import { createProcessingFixture } from '../test/video-processing-test-data';
import { createVideoTestMedia } from '../test/video-test-media';
import {
  cleanVideoTestStorage,
  createVideoTestStorage,
} from '../test/video-test-storage';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { VideoAccessService } from './video-access.service';
import { VideoPersistenceModule } from './video-persistence.module';

describe('VideoAccessService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideoAccessService;
  let client: ReturnType<typeof createVideoTestStorage>;
  let media: Awaited<ReturnType<typeof createVideoTestMedia>>;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(runtimeConfigOptions),
        TypeOrmModule.forRoot(
          createTestDataSource(VIDEO_TEST_ENTITIES, { synchronize: false })
            .options,
        ),
        VideoPersistenceModule,
        StorageModule,
      ],
      providers: [VideoAccessService],
    })
      .overrideProvider(videoConfig.KEY)
      .useValue({
        ...videoConfig(),
        playbackUrlTtlSeconds: 120,
        downloadUrlTtlSeconds: 240,
      })
      .compile();
    dataSource = module.get(DataSource);
    service = module.get(VideoAccessService);
    client = createVideoTestStorage();
    media = await createVideoTestMedia();
  });
  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await cleanVideoTestStorage(client);
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  afterAll(async () => {
    await cleanVideoTestStorage(client);
    client.destroy();
    await module.close();
    await media.cleanup();
  });
  async function ready(original_filename = 'source.mp4') {
    const bytes = await readFile(media.validVideoPath);
    const video = await createProcessingFixture({ dataSource, client }, bytes);
    const videos = dataSource.getRepository(Video);
    await videos.update(video.id, {
      status: VideoStatus.READY,
      duration: 1,
      metadata: { container: 'mov', video: { codec: 'h264' } },
      thumbnail_key: `videos/${video.id}/thumbnail.jpg`,
      original_filename,
    });
    const owner = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ id: video.channel_id });
    return { video, userId: owner.user_id, bytes };
  }
  it('should serve independent original byte ranges inline with the configured playback TTL and no fixed Range signature', async () => {
    const { video, userId, bytes } = await ready();
    const before = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    const signed = await service.playback(video.public_id, userId);
    const url = new URL(signed.url);
    expect(url.host).toBe('minio:9000');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).not.toMatch(/range/i);
    expect(
      Math.abs(Date.parse(signed.expires_at) - Date.now() - 120000),
    ).toBeLessThan(3000);
    for (const [start, end] of [
      [0, 31],
      [32, 63],
    ]) {
      const response = await fetch(signed.url, {
        headers: { Range: `bytes=${start}-${end}` },
        signal: AbortSignal.timeout(30000),
      });
      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe(
        `bytes ${start}-${end}/${bytes.length}`,
      );
      expect(response.headers.get('content-disposition')).toMatch(/^inline;/);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(
        bytes.subarray(start, end + 1),
      );
    }
    expect(
      await dataSource.getRepository(Video).findOneByOrFail({ id: video.id }),
    ).toEqual(before);
  });
  it('should return a safe attachment filename and original bytes with an independent download TTL', async () => {
    const { video, userId, bytes } = await ready(
      'C:\\private\\../vidéo "clip"\r\n.mp4',
    );
    const signed = await service.download(video.public_id, userId);
    expect(new URL(signed.url).searchParams.get('X-Amz-Expires')).toBe('240');
    expect(
      Math.abs(Date.parse(signed.expires_at) - Date.now() - 240000),
    ).toBeLessThan(3000);
    const response = await fetch(signed.url, {
      signal: AbortSignal.timeout(30000),
    });
    const disposition = response.headers.get('content-disposition')!;
    expect(response.status).toBe(200);
    expect(disposition).toMatch(
      /^attachment; filename="video"; filename\*=UTF-8''/,
    );
    expect(decodeURIComponent(disposition.split("UTF-8''")[1])).toBe(
      'vidéo "clip".mp4',
    );
    expect(disposition).not.toMatch(/[\\/\r\n]/);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
  it('should reject real signature tampering and expired URLs while issuing fresh authorized access', async () => {
    const { video, userId } = await ready();
    const valid = await service.playback(video.public_id, userId);
    const tampered = new URL(valid.url);
    tampered.searchParams.set('response-content-disposition', 'attachment');
    const invalid = await fetch(tampered, {
      signal: AbortSignal.timeout(30000),
    });
    await invalid.arrayBuffer();
    expect(invalid.status).toBe(403);
    jest.useFakeTimers({
      now: Date.now() - 3600000,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'clearTimeout',
        'performance',
      ],
    });
    let expired: string;
    try {
      expired = (await service.playback(video.public_id, userId)).url;
    } finally {
      jest.useRealTimers();
    }
    const denied = await fetch(expired, { signal: AbortSignal.timeout(30000) });
    await denied.arrayBuffer();
    expect(denied.status).toBe(403);
    const fresh = await fetch(
      (await service.playback(video.public_id, userId)).url,
      { signal: AbortSignal.timeout(30000) },
    );
    await fresh.arrayBuffer();
    expect(fresh.status).toBe(200);
  });
});
