import { readFile } from 'node:fs/promises';
import type { VideoTestMedia } from '../../src/test/video-test-media';
import { putLifecyclePart } from '../../src/test/upload-lifecycle-test-data';
import { StorageService } from '../../src/storage/storage.service';
import { Video, VideoStatus } from '../../src/videos/entities/video.entity';
import {
  UploadSession,
  UploadSessionStatus,
} from '../../src/videos/entities/upload-session.entity';
import type { SignedUrlResponseDto } from '../../src/videos/dto/signed-url-response.dto';
import type { createVideoE2eContext, HttpResponse } from './video-e2e-context';

export async function seedReadyVideo(
  context: Awaited<ReturnType<typeof createVideoE2eContext>>,
  media: VideoTestMedia,
  original_filename?: string,
) {
  const bytes = await readFile(media.validVideoPath);
  const upload = await context.seedUpload(bytes.length);
  const storage = context.app.get(StorageService);
  const part = await putLifecyclePart(
    storage,
    upload,
    1,
    new Uint8Array(bytes),
  );
  await storage.completeMultipart(
    { key: upload.video.original_key, uploadId: upload.session.upload_id },
    [{ partNumber: 1, etag: part.etag }],
  );
  await context.dataSource.getRepository(Video).update(upload.video.id, {
    status: VideoStatus.READY,
    duration: 1,
    metadata: { container: 'mov', video: { codec: 'h264' } },
    thumbnail_key: `videos/${upload.video.id}/thumbnail.jpg`,
    ...(original_filename === undefined ? {} : { original_filename }),
  });
  await context.dataSource
    .getRepository(UploadSession)
    .update(upload.session.id, { status: UploadSessionStatus.COMPLETED });
  return { ...upload, bytes };
}

export function expectSignedUrlResponse(
  response: HttpResponse<SignedUrlResponseDto>,
  lifetime: number,
): void {
  expect(Object.keys(response.body).sort()).toEqual(['expires_at', 'url']);
  expect(response.headers['content-type']).toMatch(/application\/json/);
  expect(response.headers.location).toBeUndefined();
  const url = new URL(response.body.url);
  expect(url.origin).toBe(process.env.S3_PUBLIC_ENDPOINT);
  expect(Number(url.searchParams.get('X-Amz-Expires'))).toBe(lifetime);
  expect(new Date(response.body.expires_at).toISOString()).toBe(
    response.body.expires_at,
  );
  expect(
    Math.abs(
      Date.parse(response.body.expires_at) - Date.now() - lifetime * 1000,
    ),
  ).toBeLessThan(1500);
}
