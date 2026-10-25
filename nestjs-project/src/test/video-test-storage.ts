import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';
import { UPLOAD_PART_URL_TTL_SECONDS } from '../videos/videos.constants';
import {
  assertVideoTestEnvironment,
  VIDEO_TEST_BUCKET,
} from './video-test-environment';

export function createVideoTestStorage(): S3Client {
  assertVideoTestEnvironment();
  const config = storageConfig();
  return new S3Client({
    endpoint: config.internalEndpoint,
    region: config.region,
    credentials: config.credentials,
    forcePathStyle: config.forcePathStyle,
  });
}

export async function cleanVideoTestStorage(client: S3Client): Promise<void> {
  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;
  do {
    const page = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: VIDEO_TEST_BUCKET,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      }),
    );
    for (const upload of page.Uploads ?? []) {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: VIDEO_TEST_BUCKET,
          Key: upload.Key,
          UploadId: upload.UploadId,
        }),
      );
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
  } while (keyMarker);

  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: VIDEO_TEST_BUCKET,
        ContinuationToken: continuationToken,
      }),
    );
    if (page.Contents?.length) {
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: VIDEO_TEST_BUCKET,
          Delete: { Objects: page.Contents.map(({ Key }) => ({ Key })) },
        }),
      );
      if (result.Errors?.length) {
        throw new Error('Could not remove all test storage objects');
      }
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);
}

export async function uploadVideoTestMultipart(
  client: S3Client,
  key: string,
  parts: readonly Uint8Array[],
): Promise<CompletedPart[]> {
  assertVideoTestEnvironment();
  const upload = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: VIDEO_TEST_BUCKET,
      Key: key,
      ContentType: 'video/mp4',
    }),
  );
  if (!upload.UploadId) throw new Error('Test multipart upload ID is missing');
  const completedParts: CompletedPart[] = [];
  try {
    for (const [index, part] of parts.entries()) {
      const partNumber = index + 1;
      const body = Buffer.from(part);
      const url = await getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: VIDEO_TEST_BUCKET,
          Key: key,
          UploadId: upload.UploadId,
          PartNumber: partNumber,
          Body: body,
        }),
        { expiresIn: UPLOAD_PART_URL_TTL_SECONDS },
      );
      if (
        new URL(url).origin !==
        new URL(process.env.S3_INTERNAL_ENDPOINT!).origin
      ) {
        throw new Error(
          'Test multipart URL must use the internal storage origin',
        );
      }
      const response = await fetch(url, {
        method: 'PUT',
        body,
        signal: AbortSignal.timeout(30000),
      });
      const etag = response.headers.get('etag');
      await response.arrayBuffer();
      if (!response.ok || !etag) {
        throw new Error(
          `Test multipart PUT failed with status ${response.status}`,
        );
      }
      completedParts.push({ PartNumber: partNumber, ETag: etag });
    }
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: VIDEO_TEST_BUCKET,
        Key: key,
        UploadId: upload.UploadId,
        MultipartUpload: { Parts: completedParts },
      }),
    );
    return completedParts;
  } catch (error) {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: VIDEO_TEST_BUCKET,
        Key: key,
        UploadId: upload.UploadId,
      }),
    );
    throw error;
  }
}
