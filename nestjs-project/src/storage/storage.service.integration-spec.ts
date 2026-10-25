import { S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import storageConfig from '../config/storage.config';
import { StorageUnavailableException } from '../common/exceptions/storage-unavailable.exception';
import { createStorageTestContext } from '../test/create-storage-test-context';
import { MAX_THUMBNAIL_BYTES } from './storage.constants';
import type { SignedStorageUrl } from './storage.types';

describe('StorageService (integration)', () => {
  let context: Awaited<ReturnType<typeof createStorageTestContext>>;
  beforeAll(async () => {
    context = await createStorageTestContext();
  });
  afterAll(async () => {
    await context?.close();
  });

  async function put(signed: SignedStorageUrl, body: Buffer): Promise<string> {
    const response = await fetch(signed.url, {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: signed.headers,
    });
    await response.arrayBuffer();
    expect(response.status).toBe(200);
    return response.headers.get('etag')!;
  }

  it('should create, paginate, complete, inspect and delete multipart data using preserved ETags', async () => {
    const reference = await context.storage.createMultipart(
      `original-${randomUUID()}`,
      'video/mp4',
    );
    expect(await context.storage.listParts(reference)).toEqual([]);
    const bodies = [Buffer.alloc(5 * 1024 ** 2, 3), Buffer.from('last part')];
    const etags = [] as string[];
    for (let index = 0; index < bodies.length; index++) {
      etags.push(
        await put(
          await context.storage.signPart(reference, index + 1),
          bodies[index],
        ),
      );
    }
    const parts = await context.storage.listParts(reference, 1);
    expect(parts).toEqual(
      bodies.map((body, index) => ({
        partNumber: index + 1,
        etag: etags[index],
        size: body.length,
      })),
    );
    expect(await context.storage.completeMultipart(reference, parts!)).toBe(
      'completed',
    );
    expect(await context.storage.headObject(reference.key)).toMatchObject({
      size: bodies[0].length + bodies[1].length,
      contentType: 'video/mp4',
    });
    expect(await context.storage.listParts(reference)).toBeNull();
    expect(await context.storage.completeMultipart(reference, parts!)).toBe(
      'missing',
    );
    await context.storage.deleteObject(reference.key);
    expect(await context.storage.headObject(reference.key)).toBeNull();
  });

  it('should abort an active upload and distinguish NoSuchUpload from empty parts', async () => {
    const reference = await context.storage.createMultipart(
      `abort-${randomUUID()}`,
      'video/mp4',
    );
    expect(await context.storage.abortMultipart(reference)).toBe('aborted');
    // This pinned S3 implementation acknowledges repeated aborts with 204.
    expect(await context.storage.abortMultipart(reference)).toBe('aborted');
    expect(await context.storage.listParts(reference)).toBeNull();
  });

  it('should upload bounded JPEG bytes without permitting large source-video bodies', async () => {
    const key = `thumbnail-${randomUUID()}.jpg`;
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    await context.storage.uploadJpeg(key, bytes);
    expect(await context.storage.headObject(key)).toMatchObject({
      size: bytes.length,
      contentType: 'image/jpeg',
    });
    await expect(
      context.storage.uploadJpeg(key, Buffer.alloc(MAX_THUMBNAIL_BYTES + 1)),
    ).rejects.toThrow(RangeError);
    await expect(
      context.storage.uploadJpeg(key, Buffer.alloc(0)),
    ).rejects.toThrow(RangeError);
  });

  it('should map a real unreachable S3 boundary to STORAGE_UNAVAILABLE and retain its cause', async () => {
    const config = storageConfig();
    const unreachable = new S3Client({
      ...config,
      endpoint: 'http://minio:1',
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 200, requestTimeout: 500 },
    });
    const failed = await createStorageTestContext({
      internalClient: unreachable,
    });
    try {
      await expect(failed.storage.headObject('missing')).rejects.toMatchObject({
        errorCode: 'STORAGE_UNAVAILABLE',
        cause: expect.any(Error) as unknown,
      });
    } finally {
      await failed.close();
    }
  });

  it('should propagate a real permission error instead of disguising it as absence or outage', async () => {
    const config = storageConfig();
    const denied = new S3Client({
      endpoint: config.internalEndpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'unrecognized',
        secretAccessKey: 'unrecognized',
      },
      maxAttempts: 1,
    });
    const failed = await createStorageTestContext({ internalClient: denied });
    try {
      await expect(failed.storage.headObject('missing')).rejects.toBeInstanceOf(
        S3ServiceException,
      );
      await expect(
        failed.storage.headObject('missing'),
      ).rejects.not.toBeInstanceOf(StorageUnavailableException);
    } finally {
      await failed.close();
    }
  });
});
