import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { StorageUnavailableException } from '../common/exceptions/storage-unavailable.exception';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { UPLOAD_PART_URL_TTL_SECONDS } from '../videos/videos.constants';
import {
  INTERNAL_S3_CLIENT,
  MAX_THUMBNAIL_BYTES,
  PUBLIC_S3_CLIENT,
} from './storage.constants';
import type {
  MultipartReference,
  SignedStorageUrl,
  StoragePart,
} from './storage.types';

@Injectable()
export class StorageService implements OnModuleDestroy {
  constructor(
    @Inject(INTERNAL_S3_CLIENT) private readonly internal: S3Client,
    @Inject(PUBLIC_S3_CLIENT) private readonly publicSigner: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
    @Inject(videoConfig.KEY)
    private readonly video: ConfigType<typeof videoConfig>,
  ) {}

  async createMultipart(
    key: string,
    contentType: string,
  ): Promise<MultipartReference> {
    const result = await this.execute(async () =>
      this.internal.send(
        new CreateMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          ContentType: contentType,
        }),
      ),
    );
    if (!result.UploadId)
      throw new Error('Storage did not return a multipart upload ID');
    return { key, uploadId: result.UploadId };
  }

  async listParts(
    reference: MultipartReference,
    pageSize = 1000,
  ): Promise<StoragePart[] | null> {
    const parts: StoragePart[] = [];
    let marker: string | undefined;
    try {
      do {
        const page = await this.execute(async () =>
          this.internal.send(
            new ListPartsCommand({
              Bucket: this.config.bucket,
              Key: reference.key,
              UploadId: reference.uploadId,
              PartNumberMarker: marker,
              MaxParts: pageSize,
            }),
          ),
        );
        for (const part of page.Parts ?? []) {
          if (
            part.PartNumber === undefined ||
            part.ETag === undefined ||
            part.Size === undefined
          ) {
            throw new Error('Storage returned an incomplete part record');
          }
          parts.push({
            partNumber: part.PartNumber,
            etag: part.ETag,
            size: part.Size,
          });
        }
        marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
        if (page.IsTruncated && marker === undefined)
          throw new Error('Storage omitted the next part marker');
      } while (marker !== undefined);
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === 'NoSuchUpload')
        return null;
      throw error;
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipart(
    reference: MultipartReference,
    parts: readonly Pick<StoragePart, 'partNumber' | 'etag'>[],
  ): Promise<'completed' | 'missing'> {
    try {
      await this.execute(async () =>
        this.internal.send(
          new CompleteMultipartUploadCommand({
            Bucket: this.config.bucket,
            Key: reference.key,
            UploadId: reference.uploadId,
            MultipartUpload: {
              Parts: parts.map((part) => ({
                PartNumber: part.partNumber,
                ETag: part.etag,
              })),
            },
          }),
        ),
      );
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === 'NoSuchUpload')
        return 'missing';
      throw error;
    }
    return 'completed';
  }

  async abortMultipart(
    reference: MultipartReference,
  ): Promise<'aborted' | 'missing'> {
    try {
      await this.execute(async () =>
        this.internal.send(
          new AbortMultipartUploadCommand({
            Bucket: this.config.bucket,
            Key: reference.key,
            UploadId: reference.uploadId,
          }),
        ),
      );
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === 'NoSuchUpload')
        return 'missing';
      throw error;
    }
    return 'aborted';
  }

  async headObject(
    key: string,
  ): Promise<{ size: number; etag?: string; contentType?: string } | null> {
    try {
      const object = await this.execute(async () =>
        this.internal.send(
          new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
        ),
      );
      if (object.ContentLength === undefined)
        throw new Error('Storage omitted object size');
      return {
        size: object.ContentLength,
        etag: object.ETag,
        contentType: object.ContentType,
      };
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        ['NotFound', 'NoSuchKey'].includes(error.name)
      )
        return null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.execute(async () =>
      this.internal.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      ),
    );
  }

  async uploadJpeg(key: string, body: Buffer): Promise<void> {
    if (body.length === 0 || body.length > MAX_THUMBNAIL_BYTES)
      throw new RangeError('Thumbnail size exceeds storage adapter bounds');
    await this.execute(async () =>
      this.internal.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: 'image/jpeg',
        }),
      ),
    );
  }

  async signPart(
    reference: MultipartReference,
    partNumber: number,
    ttlSeconds: number = UPLOAD_PART_URL_TTL_SECONDS,
  ): Promise<SignedStorageUrl> {
    if (
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 1 ||
      ttlSeconds > UPLOAD_PART_URL_TTL_SECONDS
    )
      throw new RangeError('Invalid part URL lifetime');
    return await this.sign(
      this.publicSigner,
      new UploadPartCommand({
        Bucket: this.config.bucket,
        Key: reference.key,
        UploadId: reference.uploadId,
        PartNumber: partNumber,
      }),
      ttlSeconds,
    );
  }

  async signInternalGet(key: string): Promise<SignedStorageUrl> {
    return await this.sign(
      this.internal,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      this.video.mediaReadUrlTtlSeconds,
    );
  }

  async signPublicGet(
    key: string,
    filename: string,
    disposition: 'inline' | 'attachment',
  ): Promise<SignedStorageUrl> {
    const encoded = encodeURIComponent(filename.replace(/[\r\n]/g, '')).replace(
      /['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return await this.sign(
      this.publicSigner,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ResponseContentDisposition: `${disposition}; filename="video"; filename*=UTF-8''${encoded}`,
      }),
      disposition === 'inline'
        ? this.video.playbackUrlTtlSeconds
        : this.video.downloadUrlTtlSeconds,
    );
  }

  private async sign(
    client: S3Client,
    command: GetObjectCommand | UploadPartCommand,
    ttl: number,
  ): Promise<SignedStorageUrl> {
    return await this.execute(async () => {
      const now = new Date();
      const credentials = await client.config.credentials();
      const lifetime = Math.min(
        ttl,
        credentials.expiration
          ? Math.floor(
              (credentials.expiration.getTime() - now.getTime()) / 1000,
            )
          : ttl,
      );
      if (lifetime < 1)
        throw new StorageUnavailableException(
          new Error('Signing credentials expired'),
        );
      const url = await getSignedUrl(client, command, {
        expiresIn: lifetime,
        signingDate: now,
      });
      return {
        url,
        expiresAt: new Date(now.getTime() + lifetime * 1000),
        headers: {},
      };
    });
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const transient =
        error instanceof S3ServiceException
          ? (error.$metadata.httpStatusCode ?? 0) >= 500 ||
            error.$metadata.httpStatusCode === 429 ||
            Boolean(error.$retryable)
          : (error instanceof Error &&
              [
                'ECONNREFUSED',
                'ECONNRESET',
                'ETIMEDOUT',
                'EAI_AGAIN',
                'ENOTFOUND',
                'TimeoutError',
                'RequestTimeout',
              ].includes('code' in error ? String(error.code) : error.name)) ||
            // Smithy's retry wrapper can erase cross-realm Node error properties.
            (error instanceof Error &&
              /^AWS SDK error wrapper for Error: .*\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b/.test(
                error.message,
              ));
      if (transient) throw new StorageUnavailableException(error);
      throw error;
    }
  }

  onModuleDestroy(): void {
    this.internal.destroy();
    this.publicSigner.destroy();
  }
}
