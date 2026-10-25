import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
import { runtimeConfigOptions } from '../../config/runtime-config';
import { StorageService } from '../../storage/storage.service';
import { createVideoTestMedia } from '../../test/video-test-media';
import {
  cleanVideoTestStorage,
  createVideoTestStorage,
  uploadVideoTestMultipart,
} from '../../test/video-test-storage';
import { MediaInspectionModule } from './media-inspection.module';
import { MediaInspectionService } from './media-inspection.service';
import { MediaProcessService } from './media-process.service';
import { MediaSourceService } from './media-source.service';

describe('MediaInspectionService (integration)', () => {
  let module: Awaited<
    ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
  >;
  let fixtures: Awaited<ReturnType<typeof createVideoTestMedia>>;
  let client: ReturnType<typeof createVideoTestStorage>;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(runtimeConfigOptions),
        MediaInspectionModule,
      ],
    }).compile();
    fixtures = await createVideoTestMedia();
    client = createVideoTestStorage();
  });
  beforeEach(async () => {
    await cleanVideoTestStorage(client);
  });
  afterAll(async () => {
    await cleanVideoTestStorage(client);
    client.destroy();
    await module.close();
    await fixtures.cleanup();
  });
  it('should inspect generated remote media using Range and write a JPEG without a playback derivative', async () => {
    const storage = module.get(StorageService);
    const body = await readFile(fixtures.validVideoPath);
    await uploadVideoTestMultipart(client, 'videos/valid/original', [body]);
    const signed = await storage.signInternalGet('videos/valid/original');
    const range = await fetch(signed.url, { headers: { range: 'bytes=0-31' } });
    expect(range.status).toBe(206);
    await range.arrayBuffer();
    const result = await module
      .get(MediaInspectionService)
      .inspect('valid', 'videos/valid/original');
    expect(result.duration).toBeGreaterThan(0);
    expect(result.metadata).toMatchObject({
      container: expect.any(String) as unknown,
      video: { codec: 'h264' },
    });
    const jpeg = await storage.signInternalGet(result.thumbnailKey);
    const response = await fetch(jpeg.url);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect([...bytes.subarray(0, 2)]).toEqual([255, 216]);
    expect(await storage.headObject('videos/valid/original')).toMatchObject({
      size: body.length,
    });
    expect(await storage.headObject('videos/valid/playback.mp4')).toBeNull();
  }, 30000);
  it('should reject invalid media and reference playlists without fetching their target', async () => {
    let externalRequests = 0;
    const external = createServer((_req, res) => {
      externalRequests++;
      res.end('external');
    });
    await new Promise<void>((resolve) =>
      external.listen(0, '0.0.0.0', resolve),
    );
    const address = external.address();
    if (!address || typeof address === 'string')
      throw new Error('Test server failed');
    try {
      for (const [name, body] of [
        ['invalid', await readFile(fixtures.invalidVideoPath)],
        [
          'playlist',
          Buffer.from(
            `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://nestjs-api:${address.port}/external.ts\n#EXT-X-ENDLIST\n`,
          ),
        ],
      ] as const) {
        await uploadVideoTestMultipart(client, `videos/${name}/original`, [
          body,
        ]);
        await expect(
          module
            .get(MediaInspectionService)
            .inspect(name, `videos/${name}/original`),
        ).rejects.toThrow('invalid_media');
      }
      expect(externalRequests).toBe(0);
    } finally {
      await new Promise<void>((resolve) => external.close(() => resolve()));
    }
  }, 30000);
  it('should inspect a non-MOV container without imposing a browser/container allowlist', async () => {
    const path = join(fixtures.directory, 'valid.webm');
    await promisify(execFile)(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-i',
        fixtures.validVideoPath,
        '-c:v',
        'libvpx-vp9',
        '-threads',
        '1',
        '-f',
        'webm',
        path,
      ],
      { encoding: 'buffer', timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    await uploadVideoTestMultipart(client, 'videos/webm/original', [
      await readFile(path),
    ]);
    expect(
      (
        await module
          .get(MediaInspectionService)
          .inspect('webm', 'videos/webm/original')
      ).metadata,
    ).toMatchObject({ video: { codec: 'vp9' } });
  }, 30000);
  it('should close a running native child during shutdown', async () => {
    let connected!: () => void;
    const connection = new Promise<void>((resolve) => {
      connected = resolve;
    });
    const server = createServer(() => {
      connected();
    });
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Test server failed');
    const childModule = await Test.createTestingModule({
      providers: [MediaProcessService],
    }).compile();
    const runner = childModule.get(MediaProcessService);
    const result = runner.run(
      'ffprobe',
      ['-v', 'error', `http://nestjs-api:${address.port}/slow`],
      30000,
      1024,
    );
    const rejected = expect(result).rejects.toMatchObject({
      reason: 'shutdown',
    });
    try {
      await connection;
      await childModule.close();
      await rejected;
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('should fence proxy requests to the exact known signed source', async () => {
    const storage = module.get(StorageService);
    const signed = await storage.signInternalGet('known');
    const source = await module.get(MediaSourceService).open(signed.url, 1000);
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const call = request(
          source.proxy,
          { path: 'http://mailpit:8025/api/v1/info' },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        call.on('error', reject);
        call.end();
      });
      expect(status).toBe(403);
      expect(source.blocked()).toBe(true);
    } finally {
      await source.close();
    }
  });
  it('should terminate a real stalled native process on timeout', async () => {
    const server = createServer(() => undefined);
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Test server failed');
    try {
      await expect(
        module
          .get(MediaProcessService)
          .run(
            'ffprobe',
            ['-v', 'error', `http://nestjs-api:${address.port}/slow`],
            100,
            1024,
          ),
      ).rejects.toMatchObject({ reason: 'timeout' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
