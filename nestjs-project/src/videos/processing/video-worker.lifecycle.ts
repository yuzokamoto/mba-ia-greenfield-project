import type { INestApplicationContext } from '@nestjs/common';
import { MediaProcessService } from './media-process.service';
import { VideoProcessor } from './video.processor';
import { VideoReconcilerService } from './video-reconciler.service';

export async function closeVideoWorker(
  app: INestApplicationContext,
): Promise<void> {
  await app.get(VideoReconcilerService).onModuleDestroy();
  const processor = app.get(VideoProcessor);
  await processor.worker.pause(true);
  await app.get(MediaProcessService).onModuleDestroy();
  await processor.worker.close();
  await app.close();
}
