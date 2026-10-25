import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videoConfig from '../../config/video.config';
import { VideoFailureReason, VideoStatus } from '../entities/video.entity';
import { VideoProcessingProducer } from '../queue/video-processing-producer.service';
import { VIDEO_PROCESSING_ATTEMPTS } from '../queue/video-queue.constants';
import { UploadSessionsService } from '../uploads/upload-sessions.service';
import { UploadTerminationService } from '../uploads/upload-termination.service';
import { VideoRecordsService } from '../video-records.service';

@Injectable()
export class VideoReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoReconcilerService.name);
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly sessions: UploadSessionsService,
    private readonly termination: UploadTerminationService,
    private readonly records: VideoRecordsService,
    private readonly producer: VideoProcessingProducer,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.reconcileIntervalMs);
  }

  tick(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (!this.inFlight) {
      this.inFlight = this.reconcile().finally(() => {
        this.inFlight = undefined;
      });
    }
    return this.inFlight;
  }

  private async reconcile(): Promise<void> {
    try {
      const sessions = await this.sessions.findExpiredActive(new Date());
      for (const session of sessions) {
        if (this.stopping) return;
        try {
          const result = await this.termination.resolveExpired(
            session.video_id,
          );
          // The resolver has committed both records before this queue operation.
          if (result?.publish) await this.producer.enqueue(result.video.id);
        } catch {
          this.logger.warn(
            'Upload reconciliation deferred; dependency inspection or publication failed',
          );
        }
      }
      const videos = await this.records.findProcessing();
      for (const video of videos) {
        if (this.stopping) return;
        try {
          await this.reconcileProcessing(video.id);
        } catch {
          this.logger.warn(
            'Processing reconciliation deferred; dependency inspection or publication failed',
          );
        }
      }
    } catch {
      this.logger.warn('Video reconciliation scan deferred');
    }
  }

  private async reconcileProcessing(videoId: string): Promise<void> {
    const job = await this.producer.findJob(videoId);
    const state = job ? await job.getState() : undefined;
    // Unknown/disappearing evidence is undecided until the next inspection.
    if (job && state !== 'failed' && state !== 'completed') return;
    const video = await this.records.findById(videoId);
    if (video?.status !== VideoStatus.PROCESSING) return;
    if (state === 'failed') {
      await this.fail(
        videoId,
        job!.failedReason === 'invalid_media'
          ? VideoFailureReason.INVALID_MEDIA
          : VideoFailureReason.PROCESSING_FAILED,
      );
      return;
    }
    const remaining = VIDEO_PROCESSING_ATTEMPTS - video.processing_attempts;
    if (remaining <= 0) {
      await this.fail(videoId, VideoFailureReason.PROCESSING_FAILED);
      return;
    }
    // Only an inspected completed record can be removed for same-ID recovery.
    if (job) await job.remove();
    await this.producer.enqueue(videoId, remaining);
  }

  private async fail(
    videoId: string,
    reason: VideoFailureReason,
  ): Promise<void> {
    await this.records.updateState(
      videoId,
      VideoStatus.PROCESSING,
      VideoStatus.ERROR,
      { failure_reason: reason },
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }
}
