import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { StorageService } from '../../storage/storage.service';
import { VideoFailureReason, VideoStatus } from '../entities/video.entity';
import { VideoRecordsService } from '../video-records.service';
import { parseDeclaredSize } from '../videos.mapping';
import { MediaInspectionService } from './media-inspection.service';
import { InvalidMediaError } from './media.errors';

@Injectable()
export class VideoProcessingService {
  constructor(
    private readonly records: VideoRecordsService,
    private readonly storage: StorageService,
    private readonly media: MediaInspectionService,
  ) {}

  async process(videoId: string): Promise<void> {
    const video = await this.records.findById(videoId);
    if (!video || video.status !== VideoStatus.PROCESSING) return;
    const attempt = await this.records.reserveProcessingAttempt(video.id);
    if (attempt === null) {
      const current = await this.records.findById(video.id);
      if (current?.status !== VideoStatus.PROCESSING) return;
      await this.records.updateState(
        video.id,
        VideoStatus.PROCESSING,
        VideoStatus.ERROR,
        { failure_reason: VideoFailureReason.PROCESSING_FAILED },
      );
      throw new UnrecoverableError('processing_failed');
    }
    try {
      const original = await this.storage.headObject(video.original_key);
      if (!original || original.size !== parseDeclaredSize(video.declared_size))
        throw new Error('Original object cannot be verified');
      const result = await this.media.inspect(video.id, video.original_key);
      const verified = await this.storage.headObject(video.original_key);
      if (!verified || verified.size !== parseDeclaredSize(video.declared_size))
        throw new Error('Original object changed during inspection');
      // A stale/redelivered result cannot overwrite any terminal row.
      await this.records.updateState(
        video.id,
        VideoStatus.PROCESSING,
        VideoStatus.READY,
        {
          duration: result.duration,
          metadata: result.metadata,
          thumbnail_key: result.thumbnailKey,
          failure_reason: null,
        },
      );
    } catch (error: unknown) {
      if (error instanceof InvalidMediaError) {
        await this.records.updateState(
          video.id,
          VideoStatus.PROCESSING,
          VideoStatus.ERROR,
          { failure_reason: VideoFailureReason.INVALID_MEDIA },
        );
        throw new UnrecoverableError('invalid_media');
      }
      if (attempt >= 3) {
        await this.records.updateState(
          video.id,
          VideoStatus.PROCESSING,
          VideoStatus.ERROR,
          { failure_reason: VideoFailureReason.PROCESSING_FAILED },
        );
        throw new UnrecoverableError('processing_failed');
      }
      throw new Error('processing_failed', { cause: error });
    }
  }
}
