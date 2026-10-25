import { readFile } from 'node:fs/promises';
import { createVideoWorkerTestContext } from '../../test/create-video-worker-test-context';
import { createProcessingFixture } from '../../test/video-processing-test-data';
import { createVideoTestMedia } from '../../test/video-test-media';
import {
  Video,
  VideoFailureReason,
  VideoStatus,
} from '../entities/video.entity';
import { VideoRecordsService } from '../video-records.service';
import { MediaInspectionService } from './media-inspection.service';
import { VideoProcessingService } from './video-processing.service';

describe('VideoProcessingService (integration)', () => {
  let context: Awaited<ReturnType<typeof createVideoWorkerTestContext>>;
  let media: Awaited<ReturnType<typeof createVideoTestMedia>>;
  beforeAll(async () => {
    context = await createVideoWorkerTestContext();
    media = await createVideoTestMedia();
  });
  beforeEach(async () => {
    await context.clean();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await context.close();
    await media.cleanup();
  });
  it('should persist real native ready fields and keep the original as the playback source', async () => {
    const video = await createProcessingFixture(
      context,
      await readFile(media.validVideoPath),
    );
    await context.app.get(VideoProcessingService).process(video.id);
    const ready = await context.dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(ready.status).toBe('ready');
    expect(ready.processing_attempts).toBe(1);
    expect(ready.duration).toBeGreaterThan(0);
    expect(ready.metadata).toMatchObject({ video: { codec: 'h264' } });
    expect(
      await context.storage.headObject(ready.thumbnail_key!),
    ).toMatchObject({ contentType: 'image/jpeg' });
    expect(ready.original_key).toBe(video.original_key);
  });
  it('should atomically reserve at most three attempts under concurrent claims', async () => {
    const video = await createProcessingFixture(
      context,
      await readFile(media.validVideoPath),
    );
    const records = context.app.get(VideoRecordsService);
    const claims = await Promise.all(
      Array.from(
        { length: 6 },
        async () => await records.reserveProcessingAttempt(video.id),
      ),
    );
    expect(claims.filter((claim) => claim !== null).sort()).toEqual([1, 2, 3]);
    expect((await records.findById(video.id))!.processing_attempts).toBe(3);
  });
  it('should discard stale media results after another terminal decision', async () => {
    const video = await createProcessingFixture(
      context,
      await readFile(media.validVideoPath),
    );
    const records = context.app.get(VideoRecordsService);
    jest
      .spyOn(context.app.get(MediaInspectionService), 'inspect')
      .mockImplementationOnce(async () => {
        await records.updateState(
          video.id,
          VideoStatus.PROCESSING,
          VideoStatus.ERROR,
          { failure_reason: VideoFailureReason.PROCESSING_FAILED },
        );
        return { duration: 1, metadata: {}, thumbnailKey: 'stale' };
      });
    await context.app.get(VideoProcessingService).process(video.id);
    const row = await records.findById(video.id);
    expect(row!.status).toBe('error');
    expect(row!.thumbnail_key).toBeNull();
  });
});
