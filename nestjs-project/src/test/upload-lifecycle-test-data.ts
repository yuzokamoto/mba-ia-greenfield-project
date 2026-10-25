import type { TestingModule } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import type { StorageService } from '../storage/storage.service';
import type { UploadSession } from '../videos/entities/upload-session.entity';
import type { Video } from '../videos/entities/video.entity';
import { UploadSessionsService } from '../videos/uploads/upload-sessions.service';
import { createVideoFixture } from './video-test-data';

export async function seedLifecycleUpload(
  context: {
    dataSource: DataSource;
    module: TestingModule;
    storage: StorageService;
  },
  declaredSize = 1,
) {
  const video = await createVideoFixture(context.dataSource, {
    declared_size: String(declaredSize),
  });
  const reference = await context.storage.createMultipart(
    video.original_key,
    video.content_type,
  );
  const session = await context.dataSource.transaction(
    async (manager) =>
      await context.module
        .get(UploadSessionsService)
        .create(video.id, reference.uploadId, manager),
  );
  const owners: { user_id: string }[] = await context.dataSource.query(
    'SELECT user_id FROM channels WHERE id=$1',
    [video.channel_id],
  );
  return { video, session, userId: owners[0].user_id };
}

export async function putLifecyclePart(
  storage: StorageService,
  upload: { video: Video; session: UploadSession },
  partNumber: number,
  body: Uint8Array<ArrayBuffer>,
) {
  const signed = await storage.signPart(
    { key: upload.video.original_key, uploadId: upload.session.upload_id },
    partNumber,
  );
  const response = await fetch(signed.url, {
    method: 'PUT',
    body,
    headers: signed.headers,
    signal: AbortSignal.timeout(30000),
  });
  await response.arrayBuffer();
  const etag = response.headers.get('etag');
  if (!response.ok || !etag)
    throw new Error(`Test part upload failed: ${response.status}`);
  return { part_number: partNumber, etag };
}
