import { S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import storageConfig from '../config/storage.config';
import { createStorageTestContext } from '../test/create-storage-test-context';
import { INTERNAL_S3_CLIENT, PUBLIC_S3_CLIENT } from './storage.constants';

describe('storage signing (integration)', () => {
  let context: Awaited<ReturnType<typeof createStorageTestContext>>;
  beforeAll(async () => {
    context = await createStorageTestContext();
  });
  afterAll(async () => {
    await context?.close();
  });

  it('should sign the configured public host independently from the internal media host', async () => {
    const endpoints = await createStorageTestContext({
      publicEndpoint: 'http://localhost:9000',
    });
    try {
      const ref = await endpoints.storage.createMultipart(
        `hosts-${randomUUID()}`,
        'video/mp4',
      );
      const part = await endpoints.storage.signPart(ref, 1);
      expect(new URL(part.url).host).toBe('localhost:9000');
      expect(
        new URL((await endpoints.storage.signInternalGet(ref.key)).url).host,
      ).toBe('minio:9000');
      expect(new URL(part.url).searchParams.get('X-Amz-Expires')).toBe('900');
      expect(new URL(part.url).searchParams.get('X-Amz-SignedHeaders')).toBe(
        'host',
      );
      expect(part.headers).toEqual({});
      expect(
        Math.abs(part.expiresAt.getTime() - Date.now() - 900000),
      ).toBeLessThan(3000);
      await expect(endpoints.storage.signPart(ref, 1, 901)).rejects.toThrow(
        RangeError,
      );
      await endpoints.storage.abortMultipart(ref);
    } finally {
      await endpoints.close();
    }
  });

  it('should PUT without implicit empty-body checksums and serve reusable ranges and dispositions', async () => {
    const reference = await context.storage.createMultipart(
      `range-${randomUUID()}`,
      'video/mp4',
    );
    const signed = await context.storage.signPart(reference, 1, 30);
    const response = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: Buffer.from('0123456789'),
    });
    await response.arrayBuffer();
    expect(response.status).toBe(200);
    await context.storage.completeMultipart(reference, [
      { partNumber: 1, etag: response.headers.get('etag')! },
    ]);
    for (const disposition of ['inline', 'attachment'] as const) {
      const get = await context.storage.signPublicGet(
        reference.key,
        'my "video"\r\n.mp4',
        disposition,
      );
      for (const range of ['bytes=0-2', 'bytes=7-9']) {
        const result = await fetch(get.url, { headers: { Range: range } });
        expect(result.status).toBe(206);
        expect(result.headers.get('content-range')).toBe(
          `${range.replace('=', ' ')}/10`,
        );
        expect(result.headers.get('content-disposition')).toContain(
          disposition,
        );
        expect(await result.text()).toBe(range === 'bytes=0-2' ? '012' : '789');
      }
    }
    const internal = await fetch(
      (await context.storage.signInternalGet(reference.key)).url,
    );
    expect(await internal.text()).toBe('0123456789');
  });

  it('should reject a tampered signature and an expired signature at real storage', async () => {
    const key = `expiry-${randomUUID()}`;
    await context.storage.uploadJpeg(
      key,
      Buffer.from('small thumbnail fixture'),
    );
    const signed = await context.storage.signInternalGet(key);
    const tampered = new URL(signed.url);
    tampered.pathname += '-tampered';
    const denied = await fetch(tampered);
    await denied.arrayBuffer();
    expect(denied.status).toBe(403);
    // Sign using a past clock, while retaining real SDK credentials and HTTP verification.
    jest.useFakeTimers({
      now: Date.now() - 2 * 60 * 60 * 1000,
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
      expired = (await context.storage.signInternalGet(key)).url;
    } finally {
      jest.useRealTimers();
    }
    const old = await fetch(expired);
    await old.arrayBuffer();
    expect(old.status).toBe(403);
  });

  it('should cap URL expiration at temporary signing credential expiration', async () => {
    const config = storageConfig();
    const expiration = new Date(Date.now() + 120000);
    const temporary = new S3Client({
      endpoint: config.publicEndpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { ...config.credentials, expiration },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    const scoped = await createStorageTestContext({ publicClient: temporary });
    try {
      const signed = await scoped.storage.signPublicGet(
        'known-key',
        'video.mp4',
        'inline',
      );
      expect(
        Number(new URL(signed.url).searchParams.get('X-Amz-Expires')),
      ).toBeLessThanOrEqual(120);
      expect(signed.expiresAt.getTime()).toBeLessThanOrEqual(
        expiration.getTime(),
      );
      const internal = scoped.module.get<S3Client>(INTERNAL_S3_CLIENT);
      const publicClient = scoped.module.get<S3Client>(PUBLIC_S3_CLIENT);
      expect(internal).not.toBe(publicClient);
    } finally {
      await scoped.close();
    }
  });
});
