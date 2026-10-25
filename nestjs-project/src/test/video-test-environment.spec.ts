import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import {
  applyVideoTestEnvironment,
  assertVideoTestEnvironment,
} from './video-test-environment';

describe('video test environment', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should apply overrides before configuration factories are evaluated', async () => {
    Object.assign(process.env, {
      S3_BUCKET: 'streamtube-videos',
      VIDEO_PROCESSING_QUEUE: 'video-processing',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
    });
    const environment = applyVideoTestEnvironment();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [storageConfig, queueConfig],
        }),
      ],
    }).compile();
    environment.addCleanup(async () => {
      await module.close();
    });
    try {
      const storage = module.get<ConfigType<typeof storageConfig>>(
        storageConfig.KEY,
      );
      expect(storage.bucket).toBe('streamtube-videos-test');
      expect(storage.publicEndpoint).toBe(process.env.S3_INTERNAL_ENDPOINT);
      expect(
        module.get<ConfigType<typeof queueConfig>>(queueConfig.KEY).name,
      ).toBe('video-processing-test');
    } finally {
      await environment.cleanup();
    }
    expect(process.env.S3_BUCKET).toBe('streamtube-videos');
    expect(process.env.VIDEO_PROCESSING_QUEUE).toBe('video-processing');
    expect(process.env.S3_PUBLIC_ENDPOINT).toBe('http://localhost:9000');
  });

  it('should delete originally absent values on restoration', () => {
    delete process.env.S3_BUCKET;
    delete process.env.VIDEO_PROCESSING_QUEUE;
    delete process.env.S3_PUBLIC_ENDPOINT;
    const environment = applyVideoTestEnvironment();
    environment.restore();
    expect(process.env).not.toHaveProperty('S3_BUCKET');
    expect(process.env).not.toHaveProperty('VIDEO_PROCESSING_QUEUE');
    expect(process.env).not.toHaveProperty('S3_PUBLIC_ENDPOINT');
  });

  it('should leave unrelated settings unchanged and restore idempotently', () => {
    const internalEndpoint = process.env.S3_INTERNAL_ENDPOINT;
    const environment = applyVideoTestEnvironment();
    environment.restore();
    process.env.S3_BUCKET = 'later-value';
    environment.restore();
    expect(process.env.S3_BUCKET).toBe('later-value');
    expect(process.env.S3_INTERNAL_ENDPOINT).toBe(internalEndpoint);
  });

  it('should reject setup before dotenv supplies the internal endpoint without changing values', () => {
    delete process.env.S3_INTERNAL_ENDPOINT;
    const before = { ...process.env };
    expect(() => applyVideoTestEnvironment()).toThrow('S3_INTERNAL_ENDPOINT');
    expect(process.env).toEqual(before);
  });

  it('should close resources in reverse order and restore values even if one cleanup fails', async () => {
    process.env.S3_BUCKET = 'original-bucket';
    const environment = applyVideoTestEnvironment();
    const calls: number[] = [];
    const failure = new Error('fixture cleanup failed');
    environment.addCleanup(() => {
      calls.push(1);
    });
    environment.addCleanup(() => {
      calls.push(2);
      throw failure;
    });
    environment.addCleanup(() => {
      calls.push(3);
    });
    await expect(environment.cleanup()).rejects.toMatchObject({
      errors: [failure],
    });
    expect(calls).toEqual([3, 2, 1]);
    expect(process.env.S3_BUCKET).toBe('original-bucket');
    await environment.cleanup();
    expect(calls).toEqual([3, 2, 1]);
  });

  it.each([
    ['S3_BUCKET', 'streamtube-videos'],
    ['VIDEO_PROCESSING_QUEUE', 'video-processing'],
    ['S3_PUBLIC_ENDPOINT', 'http://localhost:9000'],
  ])('should refuse external clients with unsafe %s', (key, value) => {
    const environment = applyVideoTestEnvironment();
    process.env[key] = value;
    expect(() => assertVideoTestEnvironment()).toThrow(
      'isolated video test environment',
    );
    environment.restore();
  });
});
