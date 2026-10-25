import { createVideoTestContext } from '../test/create-video-test-context';
import { StartVideoUploadService } from './uploads/start-video-upload.service';

describe('VideosModule (integration)', () => {
  it('should resolve the API initiation use case with real persistence and storage', async () => {
    const context = await createVideoTestContext();
    try {
      expect(context.module.get(StartVideoUploadService)).toBe(context.start);
    } finally {
      await context.close();
    }
  });
});
