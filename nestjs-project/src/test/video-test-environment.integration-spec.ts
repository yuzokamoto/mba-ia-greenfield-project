import {
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import queueConfig from '../config/queue.config';
import { runtimeConfigOptions } from '../config/runtime-config';
import storageConfig from '../config/storage.config';
import { createTestDataSource } from './create-test-data-source';
import {
  applyVideoTestEnvironment,
  VIDEO_TEST_BUCKET,
  VIDEO_TEST_QUEUE,
  type VideoTestEnvironment,
} from './video-test-environment';
import { createVideoTestMedia, type VideoTestMedia } from './video-test-media';
import { cleanVideoTestQueue, createVideoTestQueue } from './video-test-queue';
import {
  cleanVideoTestStorage,
  createVideoTestStorage,
  uploadVideoTestMultipart,
} from './video-test-storage';

const run = promisify(execFile);

describe('video test fixtures (integration)', () => {
  let environment: VideoTestEnvironment;
  let module: TestingModule;
  let client: S3Client;
  let queue: Queue;
  let media: VideoTestMedia;
  const developmentBucket = 'streamtube-videos';

  beforeAll(async () => {
    environment = applyVideoTestEnvironment();
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(runtimeConfigOptions)],
    }).compile();
    environment.addCleanup(async () => {
      await module.close();
    });
    client = createVideoTestStorage();
    environment.addCleanup(() => {
      client.destroy();
    });
    environment.addCleanup(async () => {
      await cleanVideoTestStorage(client);
    });
    queue = createVideoTestQueue();
    environment.addCleanup(async () => {
      await queue.close();
    });
    environment.addCleanup(async () => {
      await cleanVideoTestQueue(queue);
    });
    await queue.waitUntilReady();
    await cleanVideoTestStorage(client);
    await cleanVideoTestQueue(queue);
    media = await createVideoTestMedia();
    environment.addCleanup(media.cleanup);
  }, 30000);

  afterAll(async () => {
    await environment?.cleanup();
  });

  it('should configure internal URL consumers and find both private environment buckets', async () => {
    const storage = module.get<ConfigType<typeof storageConfig>>(
      storageConfig.KEY,
    );
    expect(storage.bucket).toBe(VIDEO_TEST_BUCKET);
    expect(storage.publicEndpoint).toBe('http://minio:9000');
    expect(new URL(storage.publicEndpoint).hostname).toBe('minio');
    expect(
      module.get<ConfigType<typeof queueConfig>>(queueConfig.KEY).name,
    ).toBe(VIDEO_TEST_QUEUE);
    for (const bucket of [VIDEO_TEST_BUCKET, developmentBucket]) {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    }
  });

  it('should generate small valid media with a video stream and invalid media that ffprobe rejects', async () => {
    const { stdout } = await run(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        media.validVideoPath,
      ],
      { timeout: 10000, maxBuffer: 64 * 1024 },
    );
    const probe = JSON.parse(stdout) as {
      streams: { codec_type: string }[];
      format: { duration: string };
    };
    expect(probe.streams.some((stream) => stream.codec_type === 'video')).toBe(
      true,
    );
    expect(Number(probe.format.duration)).toBeGreaterThan(0);
    await expect(
      run('ffprobe', ['-v', 'error', media.invalidVideoPath], {
        timeout: 10000,
        maxBuffer: 64 * 1024,
      }),
    ).rejects.toThrow();
    expect((await readFile(media.validVideoPath)).length).toBeLessThan(
      1024 * 1024,
    );
  });

  it('should remove all generated media through extensible cleanup hooks', async () => {
    const temporaryEnvironment = applyVideoTestEnvironment();
    const temporaryMedia = await createVideoTestMedia();
    temporaryEnvironment.addCleanup(temporaryMedia.cleanup);
    await temporaryEnvironment.cleanup();
    await expect(access(temporaryMedia.directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('should PUT multipart bodies to internally signed URLs and preserve their ETags', async () => {
    const key = `multipart-${randomUUID()}.mp4`;
    const first = Buffer.alloc(5 * 1024 ** 2, 7);
    const last = await readFile(media.validVideoPath);
    const parts = await uploadVideoTestMultipart(client, key, [first, last]);
    expect(parts.map((part) => part.PartNumber)).toEqual([1, 2]);
    expect(parts.every((part) => Boolean(part.ETag))).toBe(true);
    const object = await client.send(
      new GetObjectCommand({ Bucket: VIDEO_TEST_BUCKET, Key: key }),
    );
    const bytes = await object.Body!.transformToByteArray();
    expect(Buffer.from(bytes)).toEqual(Buffer.concat([first, last]));
  });

  it('should clean test objects and incomplete multipart uploads while preserving development objects', async () => {
    const sentinelKey = `fixture-preservation-${randomUUID()}`;
    await client.send(
      new PutObjectCommand({
        Bucket: developmentBucket,
        Key: sentinelKey,
        Body: 'development sentinel',
      }),
    );
    environment.addCleanup(async () => {
      await client.send(
        new DeleteObjectCommand({
          Bucket: developmentBucket,
          Key: sentinelKey,
        }),
      );
    });
    await client.send(
      new PutObjectCommand({
        Bucket: VIDEO_TEST_BUCKET,
        Key: 'cleanup-object',
        Body: 'test',
      }),
    );
    await client.send(
      new CreateMultipartUploadCommand({
        Bucket: VIDEO_TEST_BUCKET,
        Key: 'cleanup-upload',
      }),
    );
    await cleanVideoTestStorage(client);
    expect(
      (
        await client.send(
          new ListObjectsV2Command({ Bucket: VIDEO_TEST_BUCKET }),
        )
      ).Contents ?? [],
    ).toHaveLength(0);
    expect(
      (
        await client.send(
          new ListMultipartUploadsCommand({ Bucket: VIDEO_TEST_BUCKET }),
        )
      ).Uploads ?? [],
    ).toHaveLength(0);
    expect(
      (
        await client.send(
          new HeadObjectCommand({
            Bucket: developmentBucket,
            Key: sentinelKey,
          }),
        )
      ).ContentLength,
    ).toBe(Buffer.byteLength('development sentinel'));
  });

  it('should clean only the isolated queue and refuse development queue cleanup', async () => {
    const developmentQueue = new Queue('video-processing', {
      connection: queueConfig().connection,
    });
    environment.addCleanup(async () => {
      await developmentQueue.close();
    });
    const sentinel = await developmentQueue.add(
      'fixture-preservation',
      {},
      { delay: 7 * 24 * 60 * 60 * 1000 },
    );
    environment.addCleanup(async () => {
      await sentinel.remove();
    });
    await queue.add('fixture', {});
    await cleanVideoTestQueue(queue);
    expect(
      await queue.getJobCounts('waiting', 'delayed', 'active'),
    ).toMatchObject({ waiting: 0, delayed: 0, active: 0 });
    expect(await developmentQueue.getJob(sentinel.id!)).toBeDefined();
    await expect(cleanVideoTestQueue(developmentQueue)).rejects.toThrow(
      'development queue',
    );
    expect(await developmentQueue.getJob(sentinel.id!)).toBeDefined();
  });

  it('should reuse the existing database helper and close its connection through cleanup hooks', async () => {
    const databaseEnvironment = applyVideoTestEnvironment();
    const dataSource = createTestDataSource([], { synchronize: false });
    await dataSource.initialize();
    databaseEnvironment.addCleanup(async () => {
      await dataSource.destroy();
    });
    try {
      expect(await dataSource.query('SELECT 1 AS ready')).toEqual([
        { ready: 1 },
      ]);
    } finally {
      await databaseEnvironment.cleanup();
    }
    expect(dataSource.isInitialized).toBe(false);
  });
});
