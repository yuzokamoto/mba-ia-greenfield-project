import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { envValidationSchema } from './env.validation';
import { runtimeConfigOptions } from './runtime-config';
import queueConfig from './queue.config';
import storageConfig from './storage.config';
import videoConfig from './video.config';
import type { ValidationError } from 'joi';

const requiredEnv = parseEnv(
  readFileSync(join(__dirname, '../../.env.example'), 'utf8'),
);

const validate = (
  env: Record<string, string>,
): { value: Record<string, unknown>; error?: ValidationError } =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('video runtime configuration', () => {
  const originalEnv = process.env;
  const videoKeys = Object.keys(requiredEnv).filter((key) =>
    /^(S3_|MINIO_|REDIS_|VIDEO_)/.test(key),
  );

  beforeEach(() => {
    process.env = { ...requiredEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const compileConfig = async () =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ...runtimeConfigOptions, ignoreEnvFile: true }),
      ],
    }).compile();

  it('should load the reviewed local values through the shared API/worker initialization', async () => {
    const module = await compileConfig();
    try {
      const storage = module.get<ConfigType<typeof storageConfig>>(
        storageConfig.KEY,
      );
      const queue = module.get<ConfigType<typeof queueConfig>>(queueConfig.KEY);
      const video = module.get<ConfigType<typeof videoConfig>>(videoConfig.KEY);
      expect(storage.internalEndpoint).toBe('http://minio:9000');
      expect(storage.publicEndpoint).toBe('http://localhost:9000');
      expect(storage.forcePathStyle).toBe(true);
      expect(queue.connection).toMatchObject({
        host: 'redis',
        port: 6379,
        db: 0,
      });
      expect(queue.connection.username).toBeUndefined();
      expect(queue.connection.password).toBeUndefined();
      expect(video.mediaReadUrlTtlSeconds * 1000).toBeGreaterThanOrEqual(
        video.mediaTimeoutMs,
      );
    } finally {
      await module.close();
    }
  });

  it.each(videoKeys)(
    'should fail startup when required %s is omitted',
    async (key) => {
      delete process.env[key];
      await expect(compileConfig()).rejects.toThrow(key);
    },
  );

  it.each([
    ['S3_INTERNAL_ENDPOINT', 'ftp://minio:9000'],
    ['S3_PUBLIC_ENDPOINT', 'not-a-url'],
    ['S3_FORCE_PATH_STYLE', 'yes'],
    ['S3_CORS_ALLOWED_ORIGINS', '*'],
    ['S3_CORS_ALLOWED_ORIGINS', 'http://*.example.com'],
    ['S3_CORS_ALLOWED_ORIGINS', 'http://localhost:3001/path'],
    ['S3_CORS_ALLOWED_ORIGINS', 'https://user:pass@example.com'],
    ['S3_CORS_ALLOWED_ORIGINS', 'http://localhost:3001,'],
    ['REDIS_HOST', 'redis:6379'],
    ['REDIS_PORT', '0'],
    ['REDIS_PORT', '65536'],
    ['REDIS_PORT', '6379.5'],
    ['REDIS_DB', '-1'],
    ['REDIS_DB', '0.5'],
    ['VIDEO_PROCESSING_QUEUE', 'video:processing'],
    ['VIDEO_PROCESSING_BACKOFF_MS', '0'],
    ['VIDEO_RECONCILE_INTERVAL_MS', '-1'],
    ['VIDEO_PLAYBACK_URL_TTL_SECONDS', '604801'],
    ['VIDEO_DOWNLOAD_URL_TTL_SECONDS', '0'],
    ['VIDEO_MEDIA_READ_URL_TTL_SECONDS', '604801'],
    ['VIDEO_MEDIA_TIMEOUT_MS', '1.5'],
    ['VIDEO_WORKER_CPUS', '0'],
    ['VIDEO_WORKER_MEMORY', '0g'],
    ['VIDEO_WORKER_MEMORY', 'unlimited'],
    ['VIDEO_WORKER_MEMORY', '2gbb'],
  ])('should reject invalid %s=%s at startup', async (key, value) => {
    process.env[key] = value;
    await expect(compileConfig()).rejects.toThrow(key);
  });

  it('should reject a media URL that expires before the operation timeout', async () => {
    process.env.VIDEO_MEDIA_READ_URL_TTL_SECONDS = '599';
    await expect(compileConfig()).rejects.toThrow(
      'VIDEO_MEDIA_READ_URL_TTL_SECONDS',
    );
  });

  it('should accept an exact timeout lifetime, multiple origins, and optional Redis credentials', async () => {
    process.env.VIDEO_MEDIA_READ_URL_TTL_SECONDS = '600';
    process.env.S3_CORS_ALLOWED_ORIGINS =
      'http://localhost:3001,https://stream.example.com';
    process.env.REDIS_USERNAME = 'worker';
    process.env.REDIS_PASSWORD = 'local-test-password';
    const module = await compileConfig();
    try {
      expect(
        module.get<ConfigType<typeof queueConfig>>(queueConfig.KEY).connection,
      ).toMatchObject({ username: 'worker', password: 'local-test-password' });
      expect(
        module.get<ConfigType<typeof storageConfig>>(storageConfig.KEY)
          .corsAllowedOrigins,
      ).toEqual(['http://localhost:3001', 'https://stream.example.com']);
    } finally {
      await module.close();
    }
  });
});
