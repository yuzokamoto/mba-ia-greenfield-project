import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_PART_SIZE_BYTES,
  UPLOAD_PART_URL_TTL_SECONDS,
  UPLOAD_SESSION_TTL_SECONDS,
} from '../videos/videos.constants';
import queueConfig from './queue.config';
import storageConfig from './storage.config';
import videoConfig from './video.config';

describe('video configuration factories', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = parseEnv(
      readFileSync(join(__dirname, '../../.env.example'), 'utf8'),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should map supplied deployment values into injectable typed namespaces', async () => {
    Object.assign(process.env, {
      S3_INTERNAL_ENDPOINT: 'https://storage.internal.example',
      S3_PUBLIC_ENDPOINT: 'https://storage.example.com',
      S3_REGION: 'eu-west-1',
      S3_BUCKET: 'deployment-videos',
      S3_FORCE_PATH_STYLE: 'false',
      REDIS_PORT: '6380',
      REDIS_DB: '2',
      VIDEO_PROCESSING_BACKOFF_MS: '17',
      VIDEO_RECONCILE_INTERVAL_MS: '29',
      VIDEO_PLAYBACK_URL_TTL_SECONDS: '41',
      VIDEO_DOWNLOAD_URL_TTL_SECONDS: '43',
      VIDEO_MEDIA_READ_URL_TTL_SECONDS: '47',
      VIDEO_MEDIA_TIMEOUT_MS: '11000',
      VIDEO_WORKER_CPUS: '0.5',
      VIDEO_WORKER_MEMORY: '512m',
    });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [storageConfig, queueConfig, videoConfig],
        }),
      ],
    }).compile();
    try {
      const storage = module.get<ConfigType<typeof storageConfig>>(
        storageConfig.KEY,
      );
      expect(storage).toMatchObject({
        internalEndpoint: 'https://storage.internal.example',
        publicEndpoint: 'https://storage.example.com',
        region: 'eu-west-1',
        bucket: 'deployment-videos',
        forcePathStyle: false,
        credentials: {
          accessKeyId: 'streamtube',
          secretAccessKey: 'streamtube-minio',
        },
      });
      expect(
        module.get<ConfigType<typeof queueConfig>>(queueConfig.KEY),
      ).toMatchObject({
        connection: { host: 'redis', port: 6380, db: 2 },
        name: 'video-processing',
        processingBackoffMs: 17,
      });
      expect(
        module.get<ConfigType<typeof videoConfig>>(videoConfig.KEY),
      ).toEqual({
        reconcileIntervalMs: 29,
        playbackUrlTtlSeconds: 41,
        downloadUrlTtlSeconds: 43,
        mediaReadUrlTtlSeconds: 47,
        mediaTimeoutMs: 11000,
        workerCpus: 0.5,
        workerMemory: '512m',
      });
    } finally {
      await module.close();
    }
  });

  it('should map the case-insensitive boolean accepted by Joi', () => {
    process.env.S3_FORCE_PATH_STYLE = 'TRUE';
    expect(storageConfig().forcePathStyle).toBe(true);
  });

  it('should keep fixed upload policy independent of environment overrides', () => {
    Object.assign(process.env, {
      UPLOAD_MAX_BYTES: '1',
      UPLOAD_PART_SIZE_BYTES: '1',
      UPLOAD_SESSION_TTL_SECONDS: '1',
      UPLOAD_PART_URL_TTL_SECONDS: '1',
    });
    expect(UPLOAD_MAX_BYTES).toBe(10 * 1024 ** 3);
    expect(UPLOAD_PART_SIZE_BYTES).toBe(64 * 1024 ** 2);
    expect(UPLOAD_SESSION_TTL_SECONDS).toBe(24 * 60 * 60);
    expect(UPLOAD_PART_URL_TTL_SECONDS).toBe(15 * 60);
  });
});
