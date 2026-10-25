import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { VideoWorkerModule } from './videos/processing/video-worker.module';
import { closeVideoWorker } from './videos/processing/video-worker.lifecycle';
import { VideoProcessor } from './videos/processing/video.processor';

async function bootstrap(): Promise<void> {
  const logger = new Logger('VideoWorker');
  const app = await NestFactory.createApplicationContext(VideoWorkerModule);
  await app.get(VideoProcessor).worker.waitUntilReady();
  logger.log('Video worker ready');
  let stopping = false;
  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    try {
      await closeVideoWorker(app);
      logger.log('Video worker stopped');
    } catch {
      logger.error('Video worker shutdown failed');
      process.exitCode = 1;
    }
  }
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
}
void bootstrap();
