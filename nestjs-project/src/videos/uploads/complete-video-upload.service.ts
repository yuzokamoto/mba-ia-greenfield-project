import { Injectable, Logger } from '@nestjs/common';
import type { VideoResponseDto } from '../dto/video-response.dto';
import { VideoProcessingProducer } from '../queue/video-processing-producer.service';
import { VideoQueueUnavailableError } from '../queue/video-queue-unavailable.error';
import { VideoRecordsService } from '../video-records.service';
import {
  UploadFinalizationService,
  type CompletionPart,
} from './upload-finalization.service';

@Injectable()
export class CompleteVideoUploadService {
  private readonly logger = new Logger(CompleteVideoUploadService.name);
  constructor(
    private readonly finalizer: UploadFinalizationService,
    private readonly publisher: VideoProcessingProducer,
    private readonly records: VideoRecordsService,
  ) {}

  async complete(
    publicId: string,
    userId: string,
    parts: readonly CompletionPart[],
  ): Promise<VideoResponseDto> {
    const result = await this.finalizer.complete(publicId, userId, parts);
    if (result.publish) {
      try {
        await this.publisher.enqueue(result.video.id);
      } catch (error: unknown) {
        if (!(error instanceof VideoQueueUnavailableError)) throw error;
        // Processing is already durable; reconciliation can publish it later.
        this.logger.warn('Video processing publication deferred');
      }
    }
    return this.records.toResponse(result.video);
  }
}
