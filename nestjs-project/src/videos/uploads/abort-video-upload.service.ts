import { Injectable, Logger } from '@nestjs/common';
import { VideoProcessingProducer } from '../queue/video-processing-producer.service';
import { VideoQueueUnavailableError } from '../queue/video-queue-unavailable.error';
import { UploadTerminationService } from './upload-termination.service';

@Injectable()
export class AbortVideoUploadService {
  private readonly logger = new Logger(AbortVideoUploadService.name);
  constructor(
    private readonly termination: UploadTerminationService,
    private readonly publisher: VideoProcessingProducer,
  ) {}

  async abort(publicId: string, userId: string): Promise<void> {
    const result = await this.termination.abort(publicId, userId);
    if (result.publish) {
      try {
        await this.publisher.enqueue(result.video.id);
      } catch (error: unknown) {
        if (!(error instanceof VideoQueueUnavailableError)) throw error;
        this.logger.warn('Video processing publication deferred');
      }
    }
    if (result.rejection) throw result.rejection;
  }
}
