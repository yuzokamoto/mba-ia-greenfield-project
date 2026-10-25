import { WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { PROCESS_VIDEO_JOB } from '../queue/video-queue.constants';
import { VideoProcessingService } from './video-processing.service';

export class VideoProcessor extends WorkerHost {
  constructor(private readonly processing: VideoProcessingService) {
    super();
  }
  async process(job: Job<unknown>): Promise<void> {
    const data = job.data as { videoId?: unknown } | null;
    if (
      job.name !== PROCESS_VIDEO_JOB ||
      !data ||
      Object.keys(data).length !== 1 ||
      typeof data.videoId !== 'string' ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(data.videoId)
    )
      throw new UnrecoverableError('processing_failed');
    await this.processing.process(data.videoId);
  }
}
