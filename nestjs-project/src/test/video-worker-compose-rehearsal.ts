import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  applyVideoTestEnvironment,
  VIDEO_TEST_BUCKET,
} from './video-test-environment';
import {
  createTestDataSource,
  cleanAllTables,
} from './create-test-data-source';
import { VIDEO_TEST_ENTITIES } from './video-test-data';
import { createVideoTestMedia } from './video-test-media';
import { createVideoTestQueue, cleanVideoTestQueue } from './video-test-queue';
import {
  createVideoTestStorage,
  cleanVideoTestStorage,
} from './video-test-storage';
import {
  createProcessingFixture,
  waitForVideoStatus,
} from './video-processing-test-data';
import { VideoStatus } from '../videos/entities/video.entity';

// Run only with the standalone Compose worker configured for the isolated test queue.
async function rehearse(): Promise<void> {
  const environment = applyVideoTestEnvironment();
  const dataSource = createTestDataSource(VIDEO_TEST_ENTITIES, {
    synchronize: false,
  });
  const queue = createVideoTestQueue();
  const client = createVideoTestStorage();
  const media = await createVideoTestMedia();
  try {
    await dataSource.initialize();
    await queue.waitUntilReady();
    await cleanAllTables(dataSource);
    await cleanVideoTestQueue(queue);
    await cleanVideoTestStorage(client);
    const video = await createProcessingFixture(
      { dataSource, client },
      await readFile(media.validVideoPath),
    );
    const job = await queue.add(
      'process-video',
      { videoId: video.id },
      {
        jobId: `video-${video.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10 },
      },
    );
    const ready = await waitForVideoStatus(
      dataSource,
      video.id,
      VideoStatus.READY,
    );
    assert.equal(ready.processing_attempts, 1);
    assert.ok(ready.duration! > 0);
    assert.equal(ready.original_key, video.original_key);
    assert.ok(ready.thumbnail_key);
    const thumbnail = await client.send(
      new GetObjectCommand({
        Bucket: VIDEO_TEST_BUCKET,
        Key: ready.thumbnail_key,
      }),
    );
    assert.equal(thumbnail.ContentType, 'image/jpeg');
    const jpeg = await thumbnail.Body!.transformToByteArray();
    assert.deepEqual(Array.from(jpeg.slice(0, 2)), [255, 216]);
    const deadline = Date.now() + 5000;
    while ((await job.getState()) !== 'completed') {
      assert.ok(
        Date.now() < deadline,
        'Worker must retain completed job evidence',
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    console.log(
      JSON.stringify({
        queue: queue.name,
        status: ready.status,
        attempts: ready.processing_attempts,
        thumbnail: thumbnail.ContentType,
        job: 'completed',
      }),
    );
  } finally {
    await cleanVideoTestQueue(queue);
    await cleanVideoTestStorage(client);
    if (dataSource.isInitialized) {
      await cleanAllTables(dataSource);
      await dataSource.destroy();
    }
    await queue.close();
    client.destroy();
    await media.cleanup();
    environment.restore();
  }
}
void rehearse().catch(() => {
  console.error('Standalone video worker rehearsal failed');
  process.exitCode = 1;
});
